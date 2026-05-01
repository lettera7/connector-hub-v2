import type {
  CapacityByResourceWeek,
  ExistingAssignment,
  PhaseComplexity,
  PlannedAssignment,
  PlannedPhaseSummary,
  PlannerInput,
  PlannerOutput,
  PlannerPhase,
  PlannerProject,
  PlannerResource,
  PlannerWarning,
  ResourceRole,
} from "./types";

const DEFAULT_HORIZON_WEEKS = 8;
const HARD_CAPACITY_LIMIT = 0.85;
const MAX_OWNED_CONTEXTS = 3;
const MAX_TOTAL_CONTEXTS = 5;
const DECEMBER_MONTH_INDEX = 11;
const INTERNAL_PROJECT_NAME_PATTERNS = [/^L7\s*\|/i, /^LETTERA7\b/i];

type WorkItem = {
  project: PlannerProject;
  phase: PlannerPhase;
  remainingHours: number;
  complexity: PhaseComplexity;
};

type MutableCapacity = CapacityByResourceWeek & { plannedProjectIds: Set<string>; ownedProjectIds: Set<string> };

function parseDate(value: string | Date): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(`${value}T00:00:00`);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date): Date {
  const out = parseDate(date);
  const day = out.getDay();
  out.setDate(out.getDate() + (day === 0 ? -6 : 1 - day));
  return out;
}

export function getStartOfNextPlanningWeek(today: string | Date): string {
  return isoDate(addDays(startOfWeek(parseDate(today)), 7));
}

export function getPlanningHorizon(startWeek: string | Date, weeks = DEFAULT_HORIZON_WEEKS) {
  const start = parseDate(startWeek);
  const weekStarts = Array.from({ length: weeks }, (_, index) => isoDate(addDays(start, index * 7)));
  return {
    startDate: isoDate(start),
    endDate: isoDate(addDays(start, weeks * 7 - 1)),
    weeks: weekStarts,
  };
}

export function calculateResidualHours(phase: Pick<PlannerPhase, "budgetHours" | "scheduledHours">): number {
  return roundHours(Math.max(0, phase.budgetHours - phase.scheduledHours));
}

export function inferPhaseComplexity(phase: Pick<PlannerPhase, "name" | "complexity">): PhaseComplexity {
  if (phase.complexity) return phase.complexity;
  const name = phase.name.toLowerCase();
  if (/(pm|admin|amministrazione|setup|pianificazione|coordinamento)/i.test(name)) return "pm";
  if (/(strategy|strategia|concept|creative direction|direzione creativa|review|revisione)/i.test(name)) return "high";
  if (/(design system|packaging|visual design|identity|identità|brand)/i.test(name)) return "medium-high";
  if (/(execution|esecutiv|refinement|rifinitur|delivery|consegna|adaptation|adattament)/i.test(name)) return "medium-low";
  if (/(support|supporto|data entry)/i.test(name)) return "low";
  return "medium-low";
}

export function computeResourceCapacityState(input: PlannerInput): CapacityByResourceWeek[] {
  const horizon = getPlanningHorizon(getStartOfNextPlanningWeek(input.today), input.horizonWeeks ?? DEFAULT_HORIZON_WEEKS);
  return Array.from(initializeCapacity(input.resources, horizon.weeks, input.existingAssignments ?? []).values()).map(toPublicCapacity);
}

export function validateAllocationGuardrails(capacity: CapacityByResourceWeek): PlannerWarning[] {
  if (capacity.resultingSaturation <= HARD_CAPACITY_LIMIT) return [];
  return [{
    code: "CAPACITY_LIMIT",
    message: `${capacity.resourceName} supera il limite hard dell'85% nella settimana ${capacity.weekStart}.`,
    resourceId: capacity.resourceId,
  }];
}

export function getRoleBasedCandidateResources(
  phase: PlannerPhase,
  project: PlannerProject,
  resources: PlannerResource[],
): PlannerResource[] {
  const complexity = inferPhaseComplexity(phase);
  const preferredIds = [project.ownerResourceId, ...project.teamResourceIds].filter(Boolean) as string[];
  const ordered = [
    ...preferredIds.map(id => resources.find(resource => resource.id === id)).filter(isPresent),
    ...resources.filter(resource => !preferredIds.includes(resource.id)),
  ];
  return ordered.filter(resource => canResourceWorkOnPhase(resource, complexity, phase));
}

export function allocatePeriodicProjectHours(project: PlannerProject, phases: PlannerPhase[], monthsRemaining: number): WorkItem[] {
  const periodicMonthLimit = Math.max(1, monthsRemaining);
  return phases
    .map(phase => ({ project, phase, remainingHours: calculateResidualHours(phase), complexity: inferPhaseComplexity(phase) }))
    .filter(item => item.remainingHours > 0)
    .map(item => ({ ...item, remainingHours: roundHours(item.remainingHours / periodicMonthLimit) }));
}

export function buildPhaseLevelPlanningProposal(input: PlannerInput): PlannerOutput {
  return generatePlanningProposal(input);
}

export function isInternalProjectName(name: string): boolean {
  return INTERNAL_PROJECT_NAME_PATTERNS.some(pattern => pattern.test(name.trim()));
}

export function generatePlanningProposal(input: PlannerInput): PlannerOutput {
  const planningStartDate = getStartOfNextPlanningWeek(input.today);
  const planningHorizon = getPlanningHorizon(planningStartDate, input.horizonWeeks ?? DEFAULT_HORIZON_WEEKS);
  const capacity = initializeCapacity(input.resources, planningHorizon.weeks, input.existingAssignments ?? []);
  const warnings: PlannerWarning[] = [];
  const plannedAssignments: PlannedAssignment[] = [];
  const partiallyPlannedPhases: PlannedPhaseSummary[] = [];
  const unplannedPhases: PlannedPhaseSummary[] = [];

  for (const project of input.projects.filter(project => project.active !== false)) {
    if (isInternalProjectName(project.name)) {
      warnings.push({
        code: "INTERNAL_PROJECT_SKIPPED",
        message: `${project.name} è un progetto interno e non viene pianificato automaticamente.`,
        projectId: project.id,
      });
      continue;
    }

    if (project.phases.length === 0) {
      warnings.push({
        code: "NO_PHASES",
        message: `${project.name} non ha fasi: allocazione non forzata.`,
        projectId: project.id,
      });
      continue;
    }

    const workItems = buildWorkItems(project, parseDate(planningStartDate));
    for (const item of workItems) {
      let remainingToPlan = item.remainingHours;
      if (remainingToPlan <= 0) {
        warnings.push({
          code: "NO_REMAINING_HOURS",
          message: `${project.name} / ${item.phase.name} non ha ore residue.`,
          projectId: project.id,
          phaseId: item.phase.id,
        });
        continue;
      }

      const phaseAssignments: PlannedAssignment[] = [];
      for (const weekStart of eligibleWeeksForItem(item, planningHorizon.weeks)) {
        if (remainingToPlan <= 0) break;
        const candidate = selectBestCandidate(item, input.resources, capacity, weekStart);
        if (!candidate) continue;

        const cell = capacity.get(capacityKey(candidate.id, weekStart));
        if (!cell) continue;

        const safeCapacity = cell.remainingSafeCapacity;
        if (safeCapacity <= 0) continue;

        const proposedHours = roundHours(Math.min(remainingToPlan, safeCapacity));
        if (proposedHours <= 0) continue;

        cell.proposedNewHours = roundHours(cell.proposedNewHours + proposedHours);
        cell.remainingSafeCapacity = roundHours(Math.max(0, cell.remainingSafeCapacity - proposedHours));
        cell.resultingSaturation = roundRatio((cell.alreadyOccupiedHours + cell.proposedNewHours) / cell.theoreticalWeeklyCapacity);
        cell.plannedProjectIds.add(item.project.id);
        if (candidate.id === item.project.ownerResourceId) cell.ownedProjectIds.add(item.project.id);

        const assignment: PlannedAssignment = {
          projectId: item.project.id,
          projectName: item.project.name,
          phaseId: item.phase.id,
          phaseName: item.phase.name,
          resourceId: candidate.id,
          resourceName: candidate.name,
          role: candidate.role,
          weekStart,
          weekEnd: isoDate(addDays(parseDate(weekStart), 6)),
          proposedHours,
        };
        plannedAssignments.push(assignment);
        phaseAssignments.push(assignment);
        remainingToPlan = roundHours(remainingToPlan - proposedHours);
      }

      const plannedHours = roundHours(phaseAssignments.reduce((sum, assignment) => sum + assignment.proposedHours, 0));
      const summary = buildPhaseSummary(item, plannedHours);
      if (plannedHours === 0) {
        unplannedPhases.push({ ...summary, reason: "Nessuna risorsa eleggibile o capacità disponibile entro i guardrail." });
        warnings.push({
          code: "NO_ELIGIBLE_RESOURCE",
          message: `${item.project.name} / ${item.phase.name} non è pianificabile entro ruolo, seniority e capacità.`,
          projectId: item.project.id,
          phaseId: item.phase.id,
        });
      } else if (remainingToPlan > 0) {
        partiallyPlannedPhases.push({ ...summary, reason: "Capacità insufficiente nel periodo di pianificazione." });
        warnings.push({
          code: "PARTIALLY_PLANNED",
          message: `${item.project.name} / ${item.phase.name} pianificata parzialmente: restano ${remainingToPlan}h.`,
          projectId: item.project.id,
          phaseId: item.phase.id,
        });
      }
    }
  }

  return {
    planningStartDate,
    planningHorizon,
    plannedAssignments,
    partiallyPlannedPhases,
    unplannedPhases,
    capacityByResourceWeek: Array.from(capacity.values()).map(toPublicCapacity),
    warnings,
  };
}

function initializeCapacity(
  resources: PlannerResource[],
  weeks: string[],
  existingAssignments: ExistingAssignment[],
): Map<string, MutableCapacity> {
  const capacity = new Map<string, MutableCapacity>();
  for (const resource of resources) {
    for (const weekStart of weeks) {
      const alreadyOccupiedHours = roundHours(existingAssignments
        .filter(assignment => assignment.resourceId === resource.id && assignment.weekStart === weekStart)
        .reduce((sum, assignment) => sum + assignment.hours, 0));
      const theoreticalWeeklyCapacity = resource.weeklyCapacityHours;
      const maxSafeHours = theoreticalWeeklyCapacity * HARD_CAPACITY_LIMIT;
      capacity.set(capacityKey(resource.id, weekStart), {
        resourceId: resource.id,
        resourceName: resource.name,
        weekStart,
        theoreticalWeeklyCapacity,
        alreadyOccupiedHours,
        proposedNewHours: 0,
        resultingSaturation: roundRatio(alreadyOccupiedHours / theoreticalWeeklyCapacity),
        remainingSafeCapacity: roundHours(Math.max(0, maxSafeHours - alreadyOccupiedHours)),
        plannedProjectIds: new Set(),
        ownedProjectIds: new Set(),
      });
    }
  }
  return capacity;
}

function buildWorkItems(project: PlannerProject, planningStart: Date): WorkItem[] {
  const phaseItems = project.phases
    .map(phase => ({
      project,
      phase,
      remainingHours: calculateResidualHours(phase),
      complexity: inferPhaseComplexity(phase),
    }))
    .filter(item => item.remainingHours > 0);

  if (!project.periodic) return phaseItems.sort(compareWorkItems);

  const monthsRemaining = Math.max(1, DECEMBER_MONTH_INDEX - planningStart.getMonth() + 1);
  return allocatePeriodicProjectHours(project, project.phases, monthsRemaining).sort(compareWorkItems);
}

function compareWorkItems(a: WorkItem, b: WorkItem): number {
  return complexityWeight(b.complexity) - complexityWeight(a.complexity);
}

function eligibleWeeksForItem(item: WorkItem, weeks: string[]): string[] {
  const phaseStart = item.phase.startDate ? parseDate(item.phase.startDate) : null;
  const phaseEnd = item.phase.endDate ? parseDate(item.phase.endDate) : null;
  const filtered = weeks.filter(weekStart => {
    const week = parseDate(weekStart);
    const weekEnd = addDays(week, 6);
    return (!phaseStart || weekEnd >= phaseStart) && (!phaseEnd || week <= phaseEnd);
  });

  if (!item.project.periodic) return filtered;

  // Periodic projects should progress month by month instead of consuming all hours immediately.
  const seenMonths = new Set<string>();
  return filtered.filter(weekStart => {
    const monthKey = weekStart.slice(0, 7);
    if (seenMonths.has(monthKey)) return false;
    seenMonths.add(monthKey);
    return phaseMatchesMonth(item.phase, weekStart) || !hasMonthlyPhaseForProject(item.project, weekStart);
  });
}

function selectBestCandidate(
  item: WorkItem,
  resources: PlannerResource[],
  capacity: Map<string, MutableCapacity>,
  weekStart: string,
): PlannerResource | null {
  const candidates = getRoleBasedCandidateResources(item.phase, item.project, resources)
    .map(resource => {
      const cell = capacity.get(capacityKey(resource.id, weekStart));
      if (!cell || cell.remainingSafeCapacity <= 0) return null;
      const contexts = getContextState(resource, cell, item.project);
      if (contexts.ownedCount > MAX_OWNED_CONTEXTS || contexts.totalCount > MAX_TOTAL_CONTEXTS) return null;
      return {
        resource,
        score:
          roleFitScore(resource.role, item.complexity) +
          (resource.id === item.project.ownerResourceId ? 30 : 0) +
          (cell.plannedProjectIds.has(item.project.id) ? 20 : 0) +
          Math.max(0, 15 - contexts.totalCount * 2) +
          Math.min(10, cell.remainingSafeCapacity),
      };
    })
    .filter(isPresent)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.resource ?? null;
}

function getContextState(resource: PlannerResource, cell: MutableCapacity, project: PlannerProject) {
  const owned = new Set(resource.existingContexts?.ownedProjectIds ?? []);
  const support = new Set(resource.existingContexts?.supportProjectIds ?? []);
  const recurring = new Set(resource.existingContexts?.recurringProjectIds ?? []);
  cell.ownedProjectIds.forEach(projectId => owned.add(projectId));
  cell.plannedProjectIds.forEach(projectId => support.add(projectId));
  if (project.periodic) recurring.add(project.id);
  if (resource.id === project.ownerResourceId) owned.add(project.id);
  else support.add(project.id);
  const total = new Set<string>();
  owned.forEach(projectId => total.add(projectId));
  support.forEach(projectId => total.add(projectId));
  recurring.forEach(projectId => total.add(projectId));
  return { ownedCount: owned.size, totalCount: total.size };
}

function canResourceWorkOnPhase(resource: PlannerResource, complexity: PhaseComplexity, phase: PlannerPhase): boolean {
  if (resource.role === "creative-director") return isCreativeDirectionPhase(phase);
  if (resource.role === "pm-admin") return complexity === "pm";
  if (complexity === "pm") return false;
  if (complexity === "high") return resource.role === "senior-designer";
  if (complexity === "medium-high") return resource.role === "senior-designer" || resource.role === "designer";
  if (complexity === "medium-low") return resource.role === "senior-designer" || resource.role === "designer" || resource.role === "junior-designer";
  return true;
}

function isCreativeDirectionPhase(phase: PlannerPhase): boolean {
  return /(review|revisione|creative direction|direzione creativa|concept|strategy|strategia)/i.test(phase.name);
}

function roleFitScore(role: ResourceRole, complexity: PhaseComplexity): number {
  if (role === "creative-director") return complexity === "high" ? 75 : 0;
  if (role === "pm-admin") return complexity === "pm" ? 90 : 0;
  if (role === "senior-designer") return complexity === "high" ? 90 : 80;
  if (role === "designer") return complexity === "medium-high" ? 85 : 70;
  if (role === "junior-designer") return complexity === "medium-low" || complexity === "low" ? 60 : 0;
  return 0;
}

function phaseMatchesMonth(phase: PlannerPhase, weekStart: string): boolean {
  const monthName = new Intl.DateTimeFormat("it-IT", { month: "long" })
    .format(parseDate(weekStart))
    .toLowerCase();
  return phase.name.toLowerCase().includes(monthName) || phase.name.includes(weekStart.slice(0, 7));
}

function hasMonthlyPhaseForProject(project: PlannerProject, weekStart: string): boolean {
  return project.phases.some(phase => phaseMatchesMonth(phase, weekStart));
}

function buildPhaseSummary(item: WorkItem, plannedHours: number): PlannedPhaseSummary {
  return {
    projectId: item.project.id,
    projectName: item.project.name,
    phaseId: item.phase.id,
    phaseName: item.phase.name,
    remainingHours: item.remainingHours,
    plannedHours,
    unplannedHours: roundHours(Math.max(0, item.remainingHours - plannedHours)),
  };
}

function capacityKey(resourceId: string, weekStart: string): string {
  return `${resourceId}:${weekStart}`;
}

function complexityWeight(complexity: PhaseComplexity): number {
  const weights: Record<PhaseComplexity, number> = { high: 5, "medium-high": 4, "medium-low": 3, pm: 2, low: 1 };
  return weights[complexity];
}

function roundHours(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function toPublicCapacity(cell: MutableCapacity): CapacityByResourceWeek {
  return {
    resourceId: cell.resourceId,
    resourceName: cell.resourceName,
    weekStart: cell.weekStart,
    theoreticalWeeklyCapacity: cell.theoreticalWeeklyCapacity,
    alreadyOccupiedHours: cell.alreadyOccupiedHours,
    proposedNewHours: cell.proposedNewHours,
    resultingSaturation: cell.resultingSaturation,
    remainingSafeCapacity: cell.remainingSafeCapacity,
  };
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
