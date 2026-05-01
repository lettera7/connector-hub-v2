import type {
  FloatRawProject, FloatRawAccount, FloatRawPerson, FloatRawProjectTeam, FloatRawPhase, FloatRawTimeOff,
  PlanningProject, PlanningPhase, PersonLoad, ProjectSuggestion, AssignmentCandidate,
  PlanningAlert, ProjectStatus, BudgetAvailability, UpcomingTimeOff, PlanningData, LoadStatus,
  PlanningWeek, ResourceAvailability, WeeklyResourceLoad, PlanningProposal,
  PlanningCommercialSignal, PlanningAllocationPreview,
} from "./types";
import type { FicData, FloatData, QuoteProjectMapping } from "../dashboard/types";

const PERIODIC_PATTERNS = [/^L7\b/i, /^LETTERA7\b/i, /^interno/i, /^internal/i];
const DORMANT_PAST_DAYS = 30;
const FRAG_LOW = 2, FRAG_HIGH = 5, LOAD_YELLOW = 4, LOAD_RED = 6;
const PLANNING_HORIZON_WEEKS = 8;
const DEFAULT_WEEKLY_CAPACITY = 40;
const TARGET_SATURATION = 0.8;
const WARNING_SATURATION = 0.85;
const WORKDAY_START_MINUTES = 9 * 60;
const WORKDAY_END_MINUTES = 18 * 60;
const LUNCH_START_MINUTES = 13 * 60;
const LUNCH_END_MINUTES = 14 * 60;
const SLOT_STEP_MINUTES = 30;
const OWNER_WEEKLY_LOAD = { active: 12, tentative: 8, periodic: 4 };
const SUPPORT_WEEKLY_LOAD = { active: 8, tentative: 5, periodic: 2 };
const LUCA_PILOT_NAME = "luca";
const FALLBACK_PILOT_HOURS = 6;

type PhaseComplexity = "high" | "medium-high" | "medium-low" | "low";
type ResourceRole = "creative-director" | "senior-designer" | "middle-senior-designer" | "designer" | "apprentice-designer" | "pm-admin" | "unknown";
type CapacityState = {
  theoreticalWeeklyCapacity: number;
  alreadyOccupiedHours: number;
  proposedNewHours: number;
  resultingSaturation: number;
  remainingSafeCapacity: number;
  guardrailState: PlanningAllocationPreview["guardrailState"];
};
type ContextState = {
  ownershipCount: number;
  supportCount: number;
  recurringCount: number;
  totalActiveContexts: number;
  fragmentationState: PlanningAllocationPreview["fragmentationState"];
};
type CandidateResource = {
  resource: ResourceAvailability;
  allocationRole: PlanningAllocationPreview["allocationRole"];
  role: ResourceRole;
  score: number;
  continuity: boolean;
};
type PhaseWorkItem = {
  project: PlanningProject;
  phase: PlanningPhase | null;
  budgetHours: number;
  scheduledHours: number;
  remainingHours: number;
  budgetSource: PlanningAllocationPreview["budgetSource"];
  complexity: PhaseComplexity;
};
type TimeInterval = { start: number; end: number };

export function isPeriodicProject(name: string): boolean {
  return PERIODIC_PATTERNS.some(p => p.test(name));
}
function daysDiff(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / 86_400_000); }
function parseDate(s: string | null): Date | null { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d; }
function cloneDate(d: Date): Date { return new Date(d.getTime()); }
function addDays(d: Date, days: number): Date { const out = cloneDate(d); out.setDate(out.getDate() + days); return out; }
function startOfWeek(d: Date): Date {
  const out = cloneDate(d);
  out.setHours(0, 0, 0, 0);
  const day = out.getDay(); // 0 = Sun, 1 = Mon
  const diff = day === 0 ? -6 : 1 - day;
  out.setDate(out.getDate() + diff);
  return out;
}
export function getStartOfNextPlanningWeek(today: Date): Date {
  return addDays(startOfWeek(today), 7);
}
function endOfWeek(d: Date): Date {
  const out = startOfWeek(d);
  out.setDate(out.getDate() + 6);
  out.setHours(23, 59, 59, 999);
  return out;
}
function isoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function formatWeekLabel(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short" });
  const s = fmt.format(start).replace(/\./g, "");
  const e = fmt.format(end).replace(/\./g, "");
  return `${s} - ${e}`;
}
function overlapDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  if (end < start) return 0;
  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
}
function workingDaysBetween(startDate: string, endDate: string): number {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return 0;
  let count = 0;
  const d = cloneDate(start);
  while (d.getTime() <= end.getTime()) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}
function workingDateStringsBetween(startDate: string, endDate: string): string[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return [];
  const dates: string[] = [];
  const d = cloneDate(start);
  while (d.getTime() <= end.getTime()) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) dates.push(isoDate(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}
function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const [hh, mm] = value.split(":");
  const hours = Number(hh);
  const minutes = Number(mm);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}
function formatMinutesAsTime(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.start < b.end && b.start < a.end;
}
function overlapsLunch(interval: TimeInterval): boolean {
  return intervalsOverlap(interval, { start: LUNCH_START_MINUTES, end: LUNCH_END_MINUTES });
}
function overlapWorkingDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = new Date(Math.max(aStart.getTime(), bStart.getTime()));
  const end = new Date(Math.min(aEnd.getTime(), bEnd.getTime()));
  if (end.getTime() < start.getTime()) return 0;
  return workingDaysBetween(isoDate(start), isoDate(end));
}
function buildAllocationDateRange(week: PlanningWeek, phase: PlanningPhase | null): { startDate: string; endDate: string; workingDays: number } | null {
  const weekStart = parseDate(week.startDate);
  const weekFriday = weekStart ? addDays(weekStart, 4) : null;
  if (!weekStart || !weekFriday) return null;

  const phaseStart = parseDate(phase?.startDate ?? null);
  const phaseEnd = parseDate(phase?.endDate ?? null);
  const start = new Date(Math.max(weekStart.getTime(), phaseStart?.getTime() ?? weekStart.getTime()));
  const end = new Date(Math.min(weekFriday.getTime(), phaseEnd?.getTime() ?? weekFriday.getTime()));
  if (end.getTime() < start.getTime()) return null;

  const startDate = isoDate(start);
  const endDate = isoDate(end);
  const workingDays = workingDaysBetween(startDate, endDate);
  return workingDays > 0 ? { startDate, endDate, workingDays } : null;
}
function sumWeeklyHours(workDays: Record<string, number> | null): number {
  if (!workDays) return DEFAULT_WEEKLY_CAPACITY;
  const total = Object.values(workDays).reduce((sum, value) => sum + Number(value ?? 0), 0);
  return total > 0 ? total : DEFAULT_WEEKLY_CAPACITY;
}
function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}
function textSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  return 0;
}
function bestProjectMatch(projects: PlanningProject[], label: string | null | undefined, clientName: string | null | undefined): { project: PlanningProject | null; score: number } {
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel) return { project: null, score: 0 };
  let best: { project: PlanningProject | null; score: number } = { project: null, score: 0 };
  for (const project of projects) {
    const score = Math.max(
      textSimilarity(normalizedLabel, project.name),
      textSimilarity(normalizedLabel, project.clientName),
      textSimilarity(normalizedLabel, clientName),
      textSimilarity(normalizedLabel, project.projectCode),
    );
    if (score > best.score) best = { project, score };
  }
  return best;
}
function projectEffort(project: PlanningProject, role: "owner" | "support"): number {
  if (project.status === "periodic") return role === "owner" ? OWNER_WEEKLY_LOAD.periodic : SUPPORT_WEEKLY_LOAD.periodic;
  if (project.status === "tentative") return role === "owner" ? OWNER_WEEKLY_LOAD.tentative : SUPPORT_WEEKLY_LOAD.tentative;
  return role === "owner" ? OWNER_WEEKLY_LOAD.active : SUPPORT_WEEKLY_LOAD.active;
}
function projectOverlapsWeek(project: PlanningProject, weekStart: Date, weekEnd: Date): boolean {
  const start = parseDate(project.startDate) ?? weekStart;
  const end = parseDate(project.endDate) ?? addDays(weekEnd, 7 * 8);
  if (project.status === "dormant") return false;
  return start.getTime() <= weekEnd.getTime() && end.getTime() >= weekStart.getTime();
}
export function getPlanningHorizon(startWeek: Date, horizonWeeks = PLANNING_HORIZON_WEEKS): PlanningWeek[] {
  return Array.from({ length: horizonWeeks }, (_, index) => {
    const start = addDays(startWeek, index * 7);
    const end = addDays(start, 6);
    return {
      weekKey: isoDate(start),
      label: formatWeekLabel(start, end),
      startDate: isoDate(start),
      endDate: isoDate(end),
      isCurrent: index === 0,
    };
  });
}
function buildPlanningWeeks(today: Date): PlanningWeek[] {
  return getPlanningHorizon(getStartOfNextPlanningWeek(today));
}
function buildResourceAvailability(
  planningProjects: PlanningProject[],
  personLoads: PersonLoad[],
  rawTimeOff: FloatRawTimeOff[],
  weeks: PlanningWeek[],
  today: Date
): ResourceAvailability[] {
  const timeOffByPerson = new Map<number, FloatRawTimeOff[]>();
  for (const to of rawTimeOff) {
    const list = timeOffByPerson.get(to.people_id) ?? [];
    list.push(to);
    timeOffByPerson.set(to.people_id, list);
  }
  const weekRanges = weeks.map(week => ({
    ...week,
    start: parseDate(week.startDate) ?? today,
    end: parseDate(week.endDate) ?? today,
  }));

  return personLoads.map(person => {
    const capacity = person.weeklyCapacityHours;
    const assignments = planningProjects.filter(pr => pr.projectManagerId === person.personId || pr.teamIds.includes(person.personId));
    const timeline: WeeklyResourceLoad[] = weekRanges.map(week => {
      const scheduledProjects = assignments.filter(pr => projectOverlapsWeek(pr, week.start, week.end));
      const bookedHours = scheduledProjects.reduce((sum, pr) => sum + projectEffort(pr, pr.projectManagerId === person.personId ? "owner" : "support"), 0);
      const overlappingTimeOff = (timeOffByPerson.get(person.personId) ?? []).filter(to => {
        const start = parseDate(to.start_date);
        const end = parseDate(to.end_date);
        if (!start || !end) return false;
        return overlapDays(start, end, week.start, week.end) > 0;
      });
      const timeOffHours = overlappingTimeOff.reduce((sum, to) => {
        const start = parseDate(to.start_date);
        const end = parseDate(to.end_date);
        if (!start || !end) return sum;
        const days = overlapDays(start, end, week.start, week.end);
        return sum + Math.min(capacity, (capacity / 7) * days);
      }, 0);
      const scheduledHours = Math.max(0, bookedHours);
      const freeHours = Math.max(0, capacity - scheduledHours - timeOffHours);
      const utilization = capacity > 0 ? Math.min(1, scheduledHours / capacity) : 1;
      return {
        weekKey: week.weekKey,
        weekLabel: week.label,
        capacityHours: capacity,
        scheduledHours: Math.round(scheduledHours * 10) / 10,
        freeHours: Math.round(freeHours * 10) / 10,
        utilization: Math.round(utilization * 100) / 100,
        projectNames: scheduledProjects.map(pr => pr.name),
        timeOffHours: Math.round(timeOffHours * 10) / 10,
      };
    });
    const totalScheduledHours = timeline.reduce((sum, cell) => sum + cell.scheduledHours, 0);
    const totalFreeHours = timeline.reduce((sum, cell) => sum + cell.freeHours, 0);
    return {
      personId: person.personId,
      personName: person.personName,
      role: person.role,
      department: person.department,
      status: person.status,
      statusReason: person.statusReason,
      weeklyCapacityHours: capacity,
      totalScheduledHours: Math.round(totalScheduledHours * 10) / 10,
      totalFreeHours: Math.round(totalFreeHours * 10) / 10,
      timeline,
    };
  });
}
function buildPlanningProposals(
  planningProjects: PlanningProject[],
  personLoads: PersonLoad[],
  resourceAvailability: ResourceAvailability[],
  weeks: PlanningWeek[],
  commercialSignals: PlanningCommercialSignal[],
  floatData: FloatData,
): PlanningProposal[] {
  const resourceByPerson = new Map(resourceAvailability.map(r => [r.personId, r]));
  const commercialByProject = new Map(commercialSignals.map(s => [s.projectId, s]));
  const historicalByProject = new Map<number, Map<number, { personName: string; hours: number }>>();
  for (const assignment of floatData.assignments) {
    const byPerson = historicalByProject.get(assignment.projectId) ?? new Map<number, { personName: string; hours: number }>();
    const current = byPerson.get(assignment.personId) ?? { personName: assignment.personName, hours: 0 };
    current.hours += assignment.totalHours;
    current.personName = assignment.personName;
    byPerson.set(assignment.personId, current);
    historicalByProject.set(assignment.projectId, byPerson);
  }
  const eligible = personLoads.filter(pl => pl.status !== "red");

  const scorePerson = (
    projectId: number,
    pl: PersonLoad,
    isOwner: boolean,
    effortHours: number
  ): { score: number; fitWeekIndex: number; resource: ResourceAvailability | null } => {
    const resource = resourceByPerson.get(pl.personId) ?? null;
    const timeline = resource?.timeline ?? [];
    const fitWeekIndex = timeline.findIndex(cell => cell.freeHours >= effortHours);
    const maxFree = timeline.reduce((max, cell) => Math.max(max, cell.freeHours), 0);
    const history = historicalByProject.get(projectId)?.get(pl.personId) ?? null;
    const commercial = commercialByProject.get(projectId);
    let score = 100;
    if (isOwner) {
      score -= pl.ownerProjectCount * 15;
      score -= pl.fragmentationLevel * 8;
    } else {
      score -= pl.supportProjectCount * 10;
      score -= pl.fragmentationLevel * 6;
    }
    score -= pl.activeProjectCount * 5;
    if (pl.fragmentationLabel === "high") score -= 15;
    if (pl.upcomingTimeOff.some(to => to.daysUntil <= 14)) score -= 10;
    if (pl.status === "yellow") score -= 10;
    if (pl.status === "red") score -= 30;
    if (history) score += Math.min(24, history.hours / 2);
    if (commercial && commercial.score >= 70) score += isOwner ? 8 : 5;
    score += Math.min(24, maxFree);
    if (fitWeekIndex >= 0) score += Math.max(0, 20 - fitWeekIndex * 2);
    else score -= 12;
    return { score: Math.max(0, Math.round(score)), fitWeekIndex, resource };
  };

  const proposals: PlanningProposal[] = [];
  const orderedProjects = planningProjects
    .filter(pr => (pr.status === "active" || pr.status === "tentative") && (!pr.hasOwner || !pr.hasTeam))
    .sort((a, b) => (commercialByProject.get(b.id)?.score ?? 0) - (commercialByProject.get(a.id)?.score ?? 0));
  for (const project of orderedProjects) {
    const commercial = commercialByProject.get(project.id) ?? null;
    const ownerEffortHours = projectEffort(project, "owner");
    const supportEffortHours = projectEffort(project, "support");
    const ownerPool = eligible.map(pl => {
      const meta = scorePerson(project.id, pl, true, ownerEffortHours);
      return { pl, ...meta };
    }).sort((a, b) => b.score - a.score);
    const supportPool = eligible
      .filter(pl => !ownerPool.slice(0, 3).some(item => item.pl.personId === pl.personId))
      .map(pl => {
        const meta = scorePerson(project.id, pl, false, supportEffortHours);
        return { pl, ...meta };
      }).sort((a, b) => b.score - a.score);

    const ownerPick = ownerPool[0] ?? null;
    const supportPick = supportPool[0] ?? null;
    const primaryResource = ownerPick?.resource ?? supportPick?.resource ?? null;
    const weekIndex = ownerPick && ownerPick.fitWeekIndex >= 0
      ? ownerPick.fitWeekIndex
      : supportPick && supportPick.fitWeekIndex >= 0
        ? supportPick.fitWeekIndex
        : primaryResource
          ? primaryResource.timeline.reduce((best, cell, idx, arr) => cell.freeHours > arr[best].freeHours ? idx : best, 0)
          : 0;
    const week = weeks[weekIndex] ?? weeks[0];

    proposals.push({
      projectId: project.id,
      projectName: project.name,
      clientName: project.clientName,
      basis: !project.hasOwner && !project.hasTeam ? "Senza owner e senza team" : !project.hasOwner ? "Senza owner" : "Senza team",
      weekKey: week.weekKey,
      weekLabel: week.label,
      ownerEffortHours,
      supportEffortHours,
      commercialPriority: commercial?.score ?? 0,
      previousAssignees: Array.from(historicalByProject.get(project.id)?.values() ?? [])
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 4)
        .map(p => p.personName),
      ownerCandidate: ownerPick ? {
        personId: ownerPick.pl.personId,
        personName: ownerPick.pl.personName,
        role: ownerPick.pl.role,
        score: ownerPick.score,
        currentActiveProjects: ownerPick.pl.activeProjectCount,
        currentOwnerProjects: ownerPick.pl.ownerProjectCount,
        fragmentationLevel: ownerPick.pl.fragmentationLevel,
        hasUpcomingTimeOff: ownerPick.pl.upcomingTimeOff.some(to => to.daysUntil <= 14),
        reasons: [
          ownerPick.pl.ownerProjectCount === 0 ? "Nessuna ownership attuale" : "",
          ownerPick.pl.status === "green" ? "Carico basso" : "",
          ownerPick.pl.upcomingTimeOff.some(to => to.daysUntil <= 14) ? "Ferie imminenti" : "",
          ownerPick.fitWeekIndex >= 0 ? `Spazio nella settimana ${weeks[ownerPick.fitWeekIndex]?.label ?? "selezionata"}` : ownerPick.resource ? "Da spostare più avanti nel periodo" : "Capacità non disponibile",
          historicalByProject.get(project.id)?.has(ownerPick.pl.personId) ? "Già assegnato in passato" : "",
        ].filter(Boolean),
      } : null,
      supportCandidate: supportPick ? {
        personId: supportPick.pl.personId,
        personName: supportPick.pl.personName,
        role: supportPick.pl.role,
        score: supportPick.score,
        currentActiveProjects: supportPick.pl.activeProjectCount,
        currentOwnerProjects: supportPick.pl.ownerProjectCount,
        fragmentationLevel: supportPick.pl.fragmentationLevel,
        hasUpcomingTimeOff: supportPick.pl.upcomingTimeOff.some(to => to.daysUntil <= 14),
        reasons: [
          supportPick.pl.status === "green" ? "Carico basso" : "",
          supportPick.pl.upcomingTimeOff.some(to => to.daysUntil <= 14) ? "Ferie imminenti" : "",
          supportPick.fitWeekIndex >= 0 ? `Spazio nella settimana ${weeks[supportPick.fitWeekIndex]?.label ?? "selezionata"}` : supportPick.resource ? "Da spostare più avanti nel periodo" : "Capacità non disponibile",
          historicalByProject.get(project.id)?.has(supportPick.pl.personId) ? "Già assegnato in passato" : "",
        ].filter(Boolean),
      } : null,
      rationale: [
        !project.hasOwner ? "Owner mancante" : "",
        !project.hasTeam ? "Team mancante" : "",
        commercial ? `Commerciale ${commercial.revenueNet.toLocaleString("it-IT")}€ net / ${commercial.paid.toLocaleString("it-IT")}€ incassati` : "Nessun match commerciale",
        primaryResource ? `Spazio disponibile nella settimana ${week.label}` : "Spazio non determinato con precisione",
      ].filter(Boolean),
    });
  }

  return proposals.sort((a, b) => {
    const urgency = (p: PlanningProposal) => (!p.ownerCandidate ? 1 : 0) + (!p.supportCandidate && p.basis === "Senza team" ? 1 : 0);
    return (b.commercialPriority - a.commercialPriority) || (urgency(b) - urgency(a));
  });
}

function buildCommercialSignals(
  planningProjects: PlanningProject[],
  fic: FicData,
  floatData: FloatData,
  mappings: QuoteProjectMapping[],
): PlanningCommercialSignal[] {
  const mappingByProject = new Map(mappings.map(m => [m.floatProjectId, m]));
  const mappedProjectIdsByClient = new Map<number, number[]>();
  for (const mapping of mappings) {
    const ids = mappedProjectIdsByClient.get(mapping.ficClientId) ?? [];
    ids.push(mapping.floatProjectId);
    mappedProjectIdsByClient.set(mapping.ficClientId, ids);
  }
  const projectBudgetTotal = (project: PlanningProject) => {
    const phaseBudget = project.phases.reduce((sum, phase) => sum + Number(phase.budget ?? 0), 0);
    return Math.round((phaseBudget || Number(project.budgetValue ?? 0)) * 100) / 100;
  };
  const projectAssignments = new Map<number, Map<number, { personName: string; hours: number }>>();
  for (const assignment of floatData.assignments) {
    const byPerson = projectAssignments.get(assignment.projectId) ?? new Map<number, { personName: string; hours: number }>();
    const current = byPerson.get(assignment.personId) ?? { personName: assignment.personName, hours: 0 };
    current.hours += assignment.totalHours;
    current.personName = assignment.personName;
    byPerson.set(assignment.personId, current);
    projectAssignments.set(assignment.projectId, byPerson);
  }

  type Doc = { label: string | null; net: number; paid: number; due: number; clientId: number | null; clientName: string | null };
  const invoiceDocs: Doc[] = fic.allInvoices.map(inv => ({
    label: inv.subject ?? inv.number,
    net: inv.amountNet,
    paid: inv.amountPaid,
    due: inv.amountDue,
    clientId: inv.clientId,
    clientName: inv.clientName,
  }));
  const quoteDocs: Doc[] = fic.quotes.map(q => ({
    label: q.subject ?? q.number,
    net: q.amountNet,
    paid: 0,
    due: q.amountNet,
    clientId: q.clientId,
    clientName: q.clientName,
  }));

  const signals = planningProjects.map(project => {
    const mapped = mappingByProject.get(project.id) ?? null;
    const invoiceMatch = [
      ...invoiceDocs.map(doc => ({ doc, match: bestProjectMatch(planningProjects, doc.label, doc.clientName) })),
      ...quoteDocs.map(doc => ({ doc, match: bestProjectMatch(planningProjects, doc.label, doc.clientName) })),
    ]
      .filter(item => item.match.project?.id === project.id && item.match.score >= 0.72);

    const invoiceOnly = invoiceMatch.filter(item => item.doc.paid > 0 || item.doc.due > 0 || item.doc.net > 0);
    let revenueNet = invoiceOnly.filter(item => item.doc.net > 0).reduce((sum, item) => sum + item.doc.net, 0);
    let paid = invoiceOnly.reduce((sum, item) => sum + item.doc.paid, 0);
    let due = invoiceOnly.reduce((sum, item) => sum + item.doc.due, 0);
    let invoiceCount = invoiceOnly.length;

    if (mapped) {
      const mappedClientInvoices = invoiceDocs.filter(doc =>
        doc.clientId === mapped.ficClientId ||
        normalizeText(doc.clientName).includes(normalizeText(mapped.ficClientName)) ||
        normalizeText(mapped.ficClientName).includes(normalizeText(doc.clientName))
      );
      const mappedClientQuotes = quoteDocs.filter(doc =>
        doc.clientId === mapped.ficClientId ||
        normalizeText(doc.clientName).includes(normalizeText(mapped.ficClientName)) ||
        normalizeText(mapped.ficClientName).includes(normalizeText(doc.clientName))
      );
      const docs = [...mappedClientInvoices, ...mappedClientQuotes];
      revenueNet = docs.reduce((sum, doc) => sum + doc.net, 0);
      paid = mappedClientInvoices.reduce((sum, doc) => sum + doc.paid, 0);
      due = Math.max(revenueNet - paid, 0);
      invoiceCount = mappedClientInvoices.length;
    }

    const budgetTotal = projectBudgetTotal(project);
    const mappedProjectIds = mapped ? mappedProjectIdsByClient.get(mapped.ficClientId) ?? [project.id] : [project.id];
    const clientBudgetTotal = mappedProjectIds.reduce((sum, projectId) => {
      const mappedProject = planningProjects.find(item => item.id === projectId);
      return sum + (mappedProject ? projectBudgetTotal(mappedProject) : 0);
    }, 0);
    const clientRevenueTotal = mapped
      ? fic.allClients.find(client => client.id === mapped.ficClientId)?.totalRevenue ?? revenueNet
      : revenueNet;
    const revenueToBudgetRatio = clientBudgetTotal > 0 ? clientRevenueTotal / clientBudgetTotal : null;
    const hasCommercialData = revenueNet > 0 || paid > 0 || due > 0 || invoiceCount > 0;
    const collectionRatio = revenueNet > 0 ? paid / revenueNet : 0;
    const rawScore = hasCommercialData
      ? Math.log10(revenueNet + 1) * 42 +
        Math.log10(paid + 1) * 32 +
        collectionRatio * 18 +
        (revenueToBudgetRatio != null ? Math.min(18, revenueToBudgetRatio * 4) : 0) +
        Math.min(8, invoiceCount * 1.5) +
        (project.status === "active" ? 5 : project.status === "tentative" ? 2 : 0)
      : 0;

    const recentAssignments = Array.from(projectAssignments.get(project.id)?.entries() ?? [])
      .map(([personId, info]) => ({ personId, personName: info.personName, hours: Math.round(info.hours * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 4);

    const matchSource: PlanningCommercialSignal["matchSource"] = invoiceCount > 0 ? "similarity" : mapped ? "mapping" : "none";

    return {
      projectId: project.id,
      projectName: project.name,
      clientName: project.clientName,
      ficClientId: mapped?.ficClientId ?? null,
      ficClientName: mapped?.ficClientName ?? null,
      projectBudgetTotal: budgetTotal,
      clientBudgetTotal: Math.round(clientBudgetTotal * 100) / 100,
      clientRevenueTotal: Math.round(clientRevenueTotal * 100) / 100,
      revenueToBudgetRatio: revenueToBudgetRatio == null ? null : Math.round(revenueToBudgetRatio * 1000) / 10,
      revenueNet: Math.round(revenueNet * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      due: Math.round(due * 100) / 100,
      invoiceCount,
      collectionRatio: Math.round(collectionRatio * 1000) / 10,
      score: Math.max(0, Math.min(100, Math.round(rawScore))),
      matchSource,
      recentAssignments,
    };
  });

  const maxScore = Math.max(...signals.map(s => s.score), 1);
  return signals
    .map(s => ({ ...s, score: Math.round((s.score / maxScore) * 100) }))
    .sort((a, b) => b.score - a.score);
}

function enrichProjectsWithCommercial(
  planningProjects: PlanningProject[],
  commercialSignals: PlanningCommercialSignal[],
): PlanningProject[] {
  const byProject = new Map(commercialSignals.map(signal => [signal.projectId, signal]));
  return planningProjects.map(project => {
    const signal = byProject.get(project.id) ?? null;
    const label: PlanningProject["commercialLabel"] =
      signal && signal.score >= 70 ? "high" :
      signal && signal.score >= 40 ? "medium" :
      "low";
    return {
      ...project,
      clientRevenueNet: signal?.revenueNet ?? 0,
      clientPaid: signal?.paid ?? 0,
      clientDue: signal?.due ?? 0,
      clientCollectionRatio: signal?.collectionRatio ?? 0,
      commercialPriority: signal?.score ?? 0,
      commercialLabel: label,
    };
  });
}

export function inferPhaseComplexity(phase: PlanningPhase | null): PhaseComplexity {
  const label = normalizeText(phase?.name);
  if (/strategy|concept|creative direction|direzione creativa|review|revisione/.test(label)) return "high";
  if (/design system|packaging|visual design|brand|identity|identita|capostipi/.test(label)) return "medium-high";
  if (/execution|refinement|refinements|delivery|adaptation|declinazioni|esecutivi|adattamenti|finalizzazione/.test(label)) return "medium-low";
  if (/admin|setup|support|pianificazione|coordinamento/.test(label)) return "low";
  return "medium-high";
}

function resourceRole(resource: ResourceAvailability): ResourceRole {
  const name = normalizeText(resource.personName);
  if (name.includes("dario")) return "creative-director";
  if (name.includes("daniele")) return "senior-designer";
  if (name.includes("martina")) return "middle-senior-designer";
  if (name.includes("domitilla")) return "designer";
  if (name.includes("stefano")) return "apprentice-designer";
  if (name.includes("luca")) return "pm-admin";
  return "unknown";
}

function roleFitScore(role: ResourceRole, complexity: PhaseComplexity): number {
  if (role === "creative-director") return complexity === "high" ? 70 : 15;
  if (role === "senior-designer") return complexity === "high" ? 95 : complexity === "medium-high" ? 90 : 70;
  if (role === "middle-senior-designer") return complexity === "high" ? 65 : complexity === "medium-high" ? 90 : 80;
  if (role === "designer") return complexity === "high" ? 35 : complexity === "medium-high" ? 65 : 90;
  if (role === "apprentice-designer") return complexity === "low" || complexity === "medium-low" ? 70 : 20;
  if (role === "pm-admin") return complexity === "low" ? 65 : 10;
  return 40;
}

function isMainExecutionRole(role: ResourceRole): boolean {
  return role !== "creative-director" && role !== "pm-admin";
}

function isHighLevelPhase(phase: PlanningPhase | null): boolean {
  const name = normalizeText(phase?.name);
  return /strategy|strategia|concept|creative direction|direzione creativa|review|revisione|supervisione|foundation/.test(name);
}

function isPmAdminPhase(phase: PlanningPhase | null): boolean {
  const name = normalizeText(phase?.name);
  return /admin|amministrazione|setup|pianificazione|coordinamento|coordination|pm|call|meeting/.test(name);
}

function isRoleEligibleForPhase(role: ResourceRole, phase: PlanningPhase | null, complexity: PhaseComplexity): boolean {
  if (role === "creative-director") return isHighLevelPhase(phase);
  if (role === "pm-admin") return isPmAdminPhase(phase);
  if (role === "apprentice-designer") return complexity === "low" || complexity === "medium-low";
  return true;
}

function maxRoleWeeklyHours(role: ResourceRole): number {
  if (role === "creative-director") return 4;
  if (role === "pm-admin") return 3;
  if (role === "apprentice-designer") return 16;
  return 30;
}

function isPeriodicNamedProject(project: PlanningProject): boolean {
  const name = normalizeText(project.name);
  return name.includes("san salvatore") || name.includes("grafica metelliana");
}

function isMonthlyDilutedPhase(phase: PlanningPhase | null): boolean {
  const name = normalizeText(phase?.name);
  return /setup|pianificazione|consulenza on brand/.test(name);
}

function monthKeyFromDate(value: string): string {
  return value.slice(0, 7);
}

function monthIndexFromItalianText(value: string): number | null {
  const label = normalizeText(value);
  const months = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const index = months.findIndex(month => label.includes(month));
  return index >= 0 ? index : null;
}

function phaseAppliesToWeek(project: PlanningProject, phase: PlanningPhase | null, week: PlanningWeek): boolean {
  if (!phase) return true;
  const weekStart = parseDate(week.startDate);
  const weekEnd = weekStart ? addDays(weekStart, 4) : parseDate(week.endDate);
  const phaseStart = parseDate(phase.startDate);
  const phaseEnd = parseDate(phase.endDate);
  if (weekStart && weekEnd && phaseStart && phaseEnd) {
    return overlapDays(phaseStart, phaseEnd, weekStart, weekEnd) > 0;
  }
  if (!isPeriodicNamedProject(project)) return true;
  const phaseMonth = monthIndexFromItalianText(phase.name);
  return phaseMonth == null || phaseMonth === (weekStart?.getMonth() ?? phaseMonth);
}

export function computeResourceCapacityState(
  resource: ResourceAvailability,
  occupiedHours: number,
  proposedHours: number,
): CapacityState {
  const capacity = resource.weeklyCapacityHours || DEFAULT_WEEKLY_CAPACITY;
  const resultingHours = occupiedHours + proposedHours;
  const resultingSaturation = capacity > 0 ? Math.round((resultingHours / capacity) * 1000) / 10 : 100;
  const targetRemaining = Math.max(0, capacity * TARGET_SATURATION - occupiedHours);
  return {
    theoreticalWeeklyCapacity: capacity,
    alreadyOccupiedHours: Math.round(occupiedHours * 100) / 100,
    proposedNewHours: Math.round(proposedHours * 100) / 100,
    resultingSaturation,
    remainingSafeCapacity: Math.round(targetRemaining * 100) / 100,
    guardrailState: resultingHours <= capacity * TARGET_SATURATION ? "target" : resultingHours <= capacity * WARNING_SATURATION ? "warning" : "exception",
  };
}

function computeResourceContextState(resource: ResourceAvailability, people: PersonLoad[]): ContextState {
  const person = people.find(p => p.personId === resource.personId);
  const ownershipCount = person?.ownerProjectCount ?? 0;
  const supportCount = person?.supportProjectCount ?? 0;
  const recurringCount = person?.periodicProjectCount ?? 0;
  const totalActiveContexts = Math.max(person?.activeProjectCount ?? 0, ownershipCount + supportCount) + recurringCount;
  return {
    ownershipCount,
    supportCount,
    recurringCount,
    totalActiveContexts,
    fragmentationState: totalActiveContexts <= 3 ? "low" : totalActiveContexts <= 5 ? "medium" : "high",
  };
}

function computeResourceContextStateFromProjectIds(
  resource: ResourceAvailability,
  projects: PlanningProject[],
  activeProjectIds: Set<number>,
): ContextState {
  let ownershipCount = 0;
  let supportCount = 0;
  let recurringCount = 0;
  for (const project of projects) {
    if (!activeProjectIds.has(project.id)) continue;
    if (project.projectManagerId === resource.personId) ownershipCount++;
    else if (project.teamIds.includes(resource.personId)) supportCount++;
    if (isPeriodicNamedProject(project) || project.status === "periodic") recurringCount++;
  }
  const totalActiveContexts = activeProjectIds.size;
  return {
    ownershipCount,
    supportCount,
    recurringCount,
    totalActiveContexts,
    fragmentationState: totalActiveContexts <= 3 ? "low" : totalActiveContexts <= 5 ? "medium" : "high",
  };
}

export function validateAllocationGuardrails(capacity: CapacityState, contexts: ContextState, role: PlanningAllocationPreview["allocationRole"]): boolean {
  if (capacity.guardrailState === "exception") return false;
  if (role === "owner" && contexts.ownershipCount >= 3) return false;
  return true;
}

function findOwnerResource(project: PlanningProject, resourceById: Map<number, ResourceAvailability>, resources: ResourceAvailability[]): ResourceAvailability | null {
  if (project.projectManagerId && resourceById.has(project.projectManagerId)) {
    return resourceById.get(project.projectManagerId) ?? null;
  }
  const ownerName = normalizeText(project.projectManagerName);
  if (!ownerName) return null;
  return resources.find(resource => {
    const resourceName = normalizeText(resource.personName);
    return resourceName === ownerName || resourceName.includes(ownerName) || ownerName.includes(resourceName);
  }) ?? null;
}

export function getRoleBasedCandidateResources(
  phase: PlanningPhase | null,
  project: PlanningProject,
  resources: ResourceAvailability[],
  people: PersonLoad[],
): CandidateResource[] {
  const resourceById = new Map(resources.map(resource => [resource.personId, resource]));
  const complexity = inferPhaseComplexity(phase);
  const owner = findOwnerResource(project, resourceById, resources);
  const ownerId = owner?.personId ?? null;
  const team = project.teamIds
    .map(personId => resourceById.get(personId))
    .filter((resource): resource is ResourceAvailability => resource != null);
  const unique = new Map<number, CandidateResource>();

  const addCandidate = (resource: ResourceAvailability, allocationRole: PlanningAllocationPreview["allocationRole"]) => {
    const role = resourceRole(resource);
    if (!isRoleEligibleForPhase(role, phase, complexity)) return;
    const contexts = computeResourceContextState(resource, people);
    const continuity = resource.timeline.some(cell => cell.projectNames.includes(project.name));
    let score = roleFitScore(role, complexity);
    if (!isMainExecutionRole(role)) score -= 20;
    if (allocationRole === "owner") score += 20;
    if (continuity) score += 18;
    score -= contexts.ownershipCount * 8;
    score -= contexts.totalActiveContexts * 5;
    if (contexts.ownershipCount >= 3 && allocationRole === "owner") score -= 80;
    if (contexts.totalActiveContexts >= 5 && !continuity) score -= 70;
    unique.set(resource.personId, { resource, allocationRole, role, score, continuity });
  };

  if (owner) addCandidate(owner, "owner");
  for (const resource of team) {
    addCandidate(resource, resource.personId === ownerId ? "owner" : "team");
  }
  // If assigned team cannot absorb the remaining hours, allow role-fit fallback resources with lower ranking.
  for (const resource of resources) {
    if (unique.has(resource.personId)) continue;
    addCandidate(resource, "fallback");
    const candidate = unique.get(resource.personId);
    if (candidate) unique.set(resource.personId, { ...candidate, score: candidate.score - 45 });
  }
  if (!owner && team.length === 0) {
    const fallback = resources.find(resource => normalizeText(resource.personName).startsWith(LUCA_PILOT_NAME));
    if (fallback) addCandidate(fallback, "fallback");
  }
  return Array.from(unique.values()).sort((a, b) => b.score - a.score);
}

export function allocatePeriodicProjectHours(project: PlanningProject, phases: PlanningPhase[], monthsRemaining: number): PlanningPhase[] {
  if (!isPeriodicNamedProject(project)) return phases;
  const currentMonth = new Date().getMonth();
  return phases
    .filter(phase => {
      const phaseStart = parseDate(phase.startDate);
      const namedMonth = monthIndexFromItalianText(phase.name);
      const month = phaseStart?.getMonth() ?? namedMonth;
      return month == null || month >= currentMonth;
    })
    .slice(0, Math.max(1, monthsRemaining));
}

function buildPhaseWorkItems(projects: PlanningProject[], floatData: FloatData): PhaseWorkItem[] {
  const budgetScheduledHours = floatData.projectHoursYtd.length > 0 ? floatData.projectHoursYtd : floatData.projectHours;
  const scheduledByProject = new Map(budgetScheduledHours.map(project => [project.projectId, project.totalHours]));
  const scheduledByPhase = new Map(floatData.projectPhaseHours.map(phase => [`${phase.projectId}:${phase.phaseId}`, phase.totalHours]));
  const items: PhaseWorkItem[] = [];
  const now = new Date();
  const monthsRemaining = Math.max(1, 12 - now.getMonth());

  for (const project of projects) {
    if (project.status === "dormant") continue;
    const projectScheduled = Number(scheduledByProject.get(project.id) ?? 0);
    const projectBudget = Number(project.budgetValue ?? 0);
    const phaseBudget = project.phases.reduce((sum, phase) => sum + Number(phase.budget ?? 0), 0);
    const budgetSource: PlanningAllocationPreview["budgetSource"] =
      phaseBudget > 0 ? "phases" : projectBudget > 0 ? "project" : "fallback";
    const totalBudget = phaseBudget || projectBudget;
    if (budgetSource === "fallback" && project.budgetAvailability !== "budget_hours") continue;

    if (project.phases.length > 0) {
      const phases = allocatePeriodicProjectHours(project, project.phases, monthsRemaining)
        .filter(phase => Number(phase.budget ?? 0) > 0 || budgetSource === "fallback")
        .sort((a, b) => {
          const ad = parseDate(a.startDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
          const bd = parseDate(b.startDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
          return ad - bd;
        });
      for (const phase of phases) {
        const rawPhaseBudget = Number(phase.budget ?? 0);
        const exactPhaseScheduled = scheduledByPhase.get(`${project.id}:${phase.id}`);
        const proportionalScheduled = totalBudget > 0 && rawPhaseBudget > 0 ? projectScheduled * (rawPhaseBudget / totalBudget) : 0;
        // Phase budgets must be checked against real phase_id scheduled hours; proportional project totals are only a fallback.
        const scheduledHours = exactPhaseScheduled ?? proportionalScheduled;
        const remainingHours = rawPhaseBudget > 0 ? Math.max(0, rawPhaseBudget - scheduledHours) : FALLBACK_PILOT_HOURS;
        if (remainingHours < 1) continue;
        items.push({
          project,
          phase,
          budgetHours: rawPhaseBudget,
          scheduledHours: Math.round(scheduledHours * 100) / 100,
          remainingHours: Math.round(remainingHours * 100) / 100,
          budgetSource,
          complexity: inferPhaseComplexity(phase),
        });
      }
      continue;
    }

    const remainingHours = totalBudget > 0 ? Math.max(0, totalBudget - projectScheduled) : FALLBACK_PILOT_HOURS;
    if (remainingHours >= 1) {
      items.push({
        project,
        phase: null,
        budgetHours: totalBudget,
        scheduledHours: projectScheduled,
        remainingHours,
        budgetSource,
        complexity: inferPhaseComplexity(null),
      });
    }
  }

  return items.sort((a, b) => {
    const aPeriodic = isPeriodicNamedProject(a.project);
    const bPeriodic = isPeriodicNamedProject(b.project);
    if (aPeriodic !== bPeriodic) return aPeriodic ? -1 : 1;
    const priority = b.project.commercialPriority - a.project.commercialPriority;
    if (priority !== 0) return priority;
    const aDate = parseDate(a.phase?.startDate ?? a.project.startDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bDate = parseDate(b.phase?.startDate ?? b.project.startDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aDate - bDate;
  });
}

export function buildPhaseLevelPlanningProposal(
  projects: PlanningProject[],
  people: PersonLoad[],
  resourceAvailability: ResourceAvailability[],
  weeks: PlanningWeek[],
  floatData: FloatData,
): PlanningAllocationPreview[] {
  const resourceById = new Map(resourceAvailability.map(resource => [resource.personId, resource]));
  const assignmentsByPerson = new Map<number, typeof floatData.assignments>();
  const timedIntervalsByPersonDate = new Map<string, TimeInterval[]>();
  for (const assignment of floatData.assignments) {
    const list = assignmentsByPerson.get(assignment.personId) ?? [];
    list.push(assignment);
    assignmentsByPerson.set(assignment.personId, list);

    const startMinutes = parseTimeToMinutes(assignment.startTime);
    if (startMinutes != null && assignment.hoursPerDay > 0) {
      const interval = { start: startMinutes, end: startMinutes + Math.round(assignment.hoursPerDay * 60) };
      for (const date of workingDateStringsBetween(assignment.startDate, assignment.endDate)) {
        const key = `${assignment.personId}:${date}`;
        const intervals = timedIntervalsByPersonDate.get(key) ?? [];
        intervals.push(interval);
        timedIntervalsByPersonDate.set(key, intervals);
      }
    }
  }

  const buildWeeklyFreeHours = (resource: ResourceAvailability) => weeks.map(week => {
    const personAssignments = assignmentsByPerson.get(resource.personId) ?? [];
    const scheduledHours = personAssignments.reduce((sum, assignment) => {
      const start = parseDate(assignment.startDate);
      const end = parseDate(assignment.endDate);
      const weekStart = parseDate(week.startDate);
      const weekEnd = parseDate(week.endDate);
      if (!start || !end || !weekStart || !weekEnd) return sum;
      const overlap = overlapWorkingDays(start, end, weekStart, weekEnd);
      return overlap > 0 ? sum + overlap * assignment.hoursPerDay : sum;
    }, 0);
    return { week, freeHours: Math.max(0, resource.weeklyCapacityHours - scheduledHours) };
  });

  const freeHoursByPerson = new Map<number, ReturnType<typeof buildWeeklyFreeHours>>();
  for (const resource of resourceAvailability) {
    freeHoursByPerson.set(resource.personId, buildWeeklyFreeHours(resource));
  }
  const horizonStart = parseDate(weeks[0]?.startDate ?? null);
  const horizonEnd = parseDate(weeks[weeks.length - 1]?.endDate ?? null);
  const contextProjectIdsByPerson = new Map<number, Set<number>>();
  if (horizonStart && horizonEnd) {
    for (const assignment of floatData.assignments) {
      const start = parseDate(assignment.startDate);
      const end = parseDate(assignment.endDate);
      if (!start || !end || overlapWorkingDays(start, end, horizonStart, horizonEnd) <= 0) continue;
      const set = contextProjectIdsByPerson.get(assignment.personId) ?? new Set<number>();
      set.add(assignment.projectId);
      contextProjectIdsByPerson.set(assignment.personId, set);
    }
  }

  const workItems = buildPhaseWorkItems(projects, floatData);

  const previews: PlanningAllocationPreview[] = [];
  const allocatedMonthsByWorkItem = new Map<string, Set<string>>();

  const workItemKey = (item: PhaseWorkItem) => `${item.project.id}:${item.phase?.id ?? "project"}`;
  const eligibleMonthsForItem = (item: PhaseWorkItem) => {
    const months = new Set<string>();
    for (const week of weeks) {
      if (!phaseAppliesToWeek(item.project, item.phase, week)) continue;
      const range = buildAllocationDateRange(week, item.phase);
      if (range) months.add(monthKeyFromDate(range.startDate));
    }
    return Math.max(1, months.size);
  };

  const reserveTimeSlot = (
    personId: number,
    startDate: string,
    endDate: string,
    hoursPerDay: number,
  ): { startTime: string; endTime: string } | null => {
    const dates = workingDateStringsBetween(startDate, endDate);
    if (dates.length === 0) return null;
    const duration = Math.ceil(hoursPerDay * 60 / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;
    if (duration <= 0 || duration > WORKDAY_END_MINUTES - WORKDAY_START_MINUTES) return null;

    for (let start = WORKDAY_START_MINUTES; start + duration <= WORKDAY_END_MINUTES; start += SLOT_STEP_MINUTES) {
      const candidate = { start, end: start + duration };
      if (overlapsLunch(candidate)) continue;
      const hasConflict = dates.some(date => {
        const intervals = timedIntervalsByPersonDate.get(`${personId}:${date}`) ?? [];
        return intervals.some(interval => intervalsOverlap(candidate, interval));
      });
      if (hasConflict) continue;

      for (const date of dates) {
        const key = `${personId}:${date}`;
        const intervals = timedIntervalsByPersonDate.get(key) ?? [];
        intervals.push(candidate);
        timedIntervalsByPersonDate.set(key, intervals);
      }
      return { startTime: formatMinutesAsTime(candidate.start), endTime: formatMinutesAsTime(candidate.end) };
    }

    return null;
  };

  const pushPreview = (
    item: PhaseWorkItem,
    candidate: CandidateResource,
    maxHours: number,
  ): number => {
    const resource = candidate.resource;
    const weeklyFreeHours = freeHoursByPerson.get(resource.personId);
    if (!weeklyFreeHours) return 0;
    const itemKey = workItemKey(item);
    const allocatedMonths = allocatedMonthsByWorkItem.get(itemKey) ?? new Set<string>();
    const monthlyDiluted = isMonthlyDilutedPhase(item.phase);
    const weekIndex = weeklyFreeHours.findIndex(cell => {
      if (cell.freeHours < 1 || !phaseAppliesToWeek(item.project, item.phase, cell.week)) return false;
      const range = buildAllocationDateRange(cell.week, item.phase);
      if (!range) return false;
      return !monthlyDiluted || !allocatedMonths.has(monthKeyFromDate(range.startDate));
    });
    if (weekIndex < 0) return 0;

    const slot = weeklyFreeHours[weekIndex];
    const week = slot.week;
    const dateRange = buildAllocationDateRange(week, item.phase);
    if (!dateRange) {
      slot.freeHours = 0;
      return 0;
    }
    const occupiedHours = resource.weeklyCapacityHours - slot.freeHours;
    const warningCapacityLeft = Math.max(0, resource.weeklyCapacityHours * WARNING_SATURATION - occupiedHours);
    const monthlyMaxHours = monthlyDiluted ? Math.ceil(item.remainingHours / eligibleMonthsForItem(item) * 100) / 100 : maxHours;
    const proposedHours = Math.min(maxHours, monthlyMaxHours, slot.freeHours, warningCapacityLeft, dateRange.workingDays * 4, maxRoleWeeklyHours(candidate.role));
    if (proposedHours < 1) return 0;
    const capacity = computeResourceCapacityState(resource, occupiedHours, proposedHours);
    const currentProjectIds = new Set(contextProjectIdsByPerson.get(resource.personId) ?? []);
    currentProjectIds.add(item.project.id);
    const contexts = computeResourceContextStateFromProjectIds(resource, projects, currentProjectIds);
    // Capacity and WIP limits are hard guardrails; continuity affects ranking but cannot overload a person.
    if (capacity.guardrailState === "exception") return 0;
    if (!validateAllocationGuardrails(capacity, contexts, candidate.allocationRole)) return 0;

    const startDate = dateRange.startDate;
    const endDate = dateRange.endDate;
    const hoursPerDay = Math.round((proposedHours / Math.max(1, dateRange.workingDays)) * 100) / 100;
    const timeSlot = reserveTimeSlot(resource.personId, startDate, endDate, hoursPerDay);
    if (!timeSlot) {
      slot.freeHours = 0;
      return 0;
    }
    const roleLabel = candidate.allocationRole === "owner" ? "owner" : candidate.allocationRole === "team" ? "team" : "fallback";

    previews.push({
      id: `${item.project.id}:${item.phase?.id ?? "project"}:${resource.personId}:${startDate}:${endDate}:${timeSlot.startTime}`,
      projectId: item.project.id,
      projectName: item.project.name,
      phaseId: item.phase?.id ?? null,
      phaseName: item.phase?.name ?? null,
      clientName: item.project.clientName,
      personId: resource.personId,
      personName: resource.personName,
      allocationRole: candidate.allocationRole,
      weekKey: week.weekKey,
      weekLabel: week.label,
      startDate,
      endDate,
      startTime: timeSlot.startTime,
      endTime: timeSlot.endTime,
      budgetHours: Math.round(item.budgetHours * 100) / 100,
      scheduledHours: Math.round(item.scheduledHours * 100) / 100,
      remainingHours: Math.round(item.remainingHours * 100) / 100,
      proposedHours: Math.round(proposedHours * 100) / 100,
      hoursPerDay,
      theoreticalWeeklyCapacity: capacity.theoreticalWeeklyCapacity,
      alreadyOccupiedHours: capacity.alreadyOccupiedHours,
      proposedNewHours: capacity.proposedNewHours,
      resultingSaturation: capacity.resultingSaturation,
      remainingSafeCapacity: capacity.remainingSafeCapacity,
      ownershipCount: contexts.ownershipCount,
      supportCount: contexts.supportCount,
      recurringCount: contexts.recurringCount,
      totalActiveContexts: contexts.totalActiveContexts,
      fragmentationState: contexts.fragmentationState,
      guardrailState: capacity.guardrailState,
      hasOwner: item.project.hasOwner,
      ownerName: item.project.projectManagerName,
      hasTeam: item.project.hasTeam,
      teamNames: item.project.teamNames,
      hasPhases: item.project.phases.length > 0,
      phaseCount: item.project.phases.length,
      budgetSource: item.budgetSource,
      basis: item.budgetSource === "fallback"
        ? `Budget ore non valorizzato su Float; blocco test da ${FALLBACK_PILOT_HOURS}h allocato a ${roleLabel}`
        : `${Math.round(item.remainingHours)}h residue su ${item.phase ? `fase "${item.phase.name}"` : `budget ${item.budgetSource === "phases" ? "fasi" : "progetto"}`}, allocazione a ${roleLabel}`,
    });
    slot.freeHours = Math.max(0, slot.freeHours - proposedHours);
    if (monthlyDiluted) {
      allocatedMonths.add(monthKeyFromDate(startDate));
      allocatedMonthsByWorkItem.set(itemKey, allocatedMonths);
    }
    const personProjectIds = contextProjectIdsByPerson.get(resource.personId) ?? new Set<number>();
    personProjectIds.add(item.project.id);
    contextProjectIdsByPerson.set(resource.personId, personProjectIds);
    return proposedHours;
  };

  for (const item of workItems) {
    let remainingToAllocate = item.remainingHours;
    const candidates = getRoleBasedCandidateResources(item.phase, item.project, resourceAvailability, people);
    let madeProgress = true;
    while (remainingToAllocate >= 1 && madeProgress) {
      madeProgress = false;
      for (const candidate of candidates) {
        if (remainingToAllocate < 1) break;
        const allocated = pushPreview(item, candidate, remainingToAllocate);
        if (allocated > 0) {
          remainingToAllocate -= allocated;
          madeProgress = true;
        }
      }
    }
  }

  return previews;
}

function buildAllocationPreviews(
  projects: PlanningProject[],
  people: PersonLoad[],
  resourceAvailability: ResourceAvailability[],
  weeks: PlanningWeek[],
  floatData: FloatData,
): PlanningAllocationPreview[] {
  return buildPhaseLevelPlanningProposal(projects, people, resourceAvailability, weeks, floatData);
}

export function classifyProjectStatus(raw: FloatRawProject, today: Date): ProjectStatus {
  if (isPeriodicProject(raw.name)) return "periodic";
  if (raw.tentative === true || raw.tentative === 1) return "tentative";
  if (!(raw.active === true || raw.active === 1)) return "dormant";
  const end = parseDate(raw.end_date);
  if (end && daysDiff(end, today) > DORMANT_PAST_DAYS) return "dormant";
  return "active";
}

function classifyBudget(raw: FloatRawProject): BudgetAvailability {
  if (raw.budget_per_phase === true || raw.budget_per_phase === 1) return "budget_per_phase";
  const bt = raw.budget_type ?? 0;
  if (bt === 3 || bt === 4) return "budget_hours";
  if (bt === 1 || bt === 2) return "budget_total_fee";
  return "no_budget";
}

export function buildPlanningProjects(
  rawProjects: FloatRawProject[],
  rawTeam: FloatRawProjectTeam[],
  rawPhases: FloatRawPhase[],
  accountsById: Map<number, FloatRawAccount>,
  peopleById: Map<number, FloatRawPerson>,
  today: Date
): PlanningProject[] {
  const teamByProject = new Map<number, number[]>();
  for (const t of rawTeam) { const a = teamByProject.get(t.project_id) ?? []; a.push(t.people_id); teamByProject.set(t.project_id, a); }
  const phasesByProject = new Map<number, FloatRawPhase[]>();
  for (const ph of rawPhases) { const a = phasesByProject.get(ph.project_id) ?? []; a.push(ph); phasesByProject.set(ph.project_id, a); }

  return rawProjects.map(raw => {
    const status = classifyProjectStatus(raw, today);
    const teamIds = teamByProject.get(raw.project_id) ?? [];
    const teamNames = teamIds.map(id => peopleById.get(id)?.name).filter(Boolean) as string[];
    const pmAccount = raw.project_manager ? accountsById.get(raw.project_manager) : null;
    const phases: PlanningPhase[] = (phasesByProject.get(raw.project_id) ?? []).map(ph => ({
      id: ph.phase_id, name: ph.name, startDate: ph.start_date, endDate: ph.end_date, budget: ph.budget,
    }));
    const tags = Array.isArray(raw.tags)
      ? raw.tags.map(t => typeof t === "object" && t != null ? (t as { name: string }).name : String(t))
      : [];
    return {
      id: raw.project_id, name: raw.name, clientName: raw.client_name, status,
      projectCode: raw.project_code ?? null,
      startDate: raw.start_date, endDate: raw.end_date,
      projectManagerId: raw.project_manager, projectManagerName: pmAccount?.name ?? null, projectManagerAvatar: pmAccount?.avatar ?? null,
      teamIds, teamNames,
      budgetAvailability: classifyBudget(raw), budgetValue: raw.budget_total, budgetType: raw.budget_type,
      phases, tags, nonBillable: raw.non_billable === true || raw.non_billable === 1,
      hasOwner: raw.project_manager != null, hasTeam: teamIds.length > 0,
      clientRevenueNet: 0,
      clientPaid: 0,
      clientDue: 0,
      clientCollectionRatio: 0,
      commercialPriority: 0,
      commercialLabel: "low",
    };
  });
}

export function buildPersonLoads(
  rawPeople: FloatRawPerson[],
  planningProjects: PlanningProject[],
  rawTimeOff: FloatRawTimeOff[],
  today: Date
): PersonLoad[] {
  const timeOffByPerson = new Map<number, FloatRawTimeOff[]>();
  for (const to of rawTimeOff) { const a = timeOffByPerson.get(to.people_id) ?? []; a.push(to); timeOffByPerson.set(to.people_id, a); }

  return rawPeople
    .filter(p => p.active === true || p.active === 1)
    .filter(p => p.employee_type !== 3)
    .map(p => {
      const pid = p.people_id;
      const ownerProjects = planningProjects.filter(pr => pr.projectManagerId === pid && pr.status !== "dormant");
      const teamProjects = planningProjects.filter(pr => pr.teamIds.includes(pid) && pr.projectManagerId !== pid && pr.status !== "dormant");
      const allActive = planningProjects.filter(pr => (pr.projectManagerId === pid || pr.teamIds.includes(pid)) && pr.status === "active");
      const periodic = planningProjects.filter(pr => (pr.projectManagerId === pid || pr.teamIds.includes(pid)) && pr.status === "periodic");

      const frag = allActive.length;
      const fragLabel: PersonLoad["fragmentationLabel"] = frag <= FRAG_LOW ? "low" : frag <= FRAG_HIGH - 1 ? "medium" : "high";

      const upcoming: UpcomingTimeOff[] = (timeOffByPerson.get(pid) ?? [])
        .map(to => ({ startDate: to.start_date, endDate: to.end_date, daysUntil: daysDiff(today, parseDate(to.start_date) ?? today) }))
        .filter(to => to.daysUntil >= 0)
        .sort((a, b) => a.daysUntil - b.daysUntil);

      let status: LoadStatus = "green";
      let statusReason = "Carico equilibrato";
      if (frag >= LOAD_RED) { status = "red"; statusReason = `${frag} progetti attivi — sovraccarico`; }
      else if (frag >= LOAD_YELLOW) { status = "yellow"; statusReason = `${frag} progetti attivi — attenzione`; }
      else if (frag === 0 && ownerProjects.length === 0) statusReason = "Nessun progetto attivo — disponibile";
      if (fragLabel === "high" && status === "green") { status = "yellow"; statusReason = "Alta frammentazione"; }

      const dept = typeof p.department === "object" && p.department != null
        ? (p.department as { name: string }).name
        : typeof p.department === "string" ? p.department : null;
      const weeklyCapacityHours = sumWeeklyHours(p.work_days_hours ?? null);

      return {
        personId: pid, personName: p.name, role: p.job_title, department: dept,
        weeklyCapacityHours,
        activeProjectCount: allActive.length, periodicProjectCount: periodic.length,
        ownerProjectCount: ownerProjects.length, supportProjectCount: teamProjects.filter(pr => pr.status === "active").length,
        fragmentationLevel: frag, fragmentationLabel: fragLabel,
        upcomingTimeOff: upcoming,
        projectNames: allActive.map(pr => pr.name), periodicProjectNames: periodic.map(pr => pr.name),
        status, statusReason,
      };
    });
}

export function buildSuggestions(planningProjects: PlanningProject[], personLoads: PersonLoad[]): ProjectSuggestion[] {
  const unmapped = planningProjects.filter(pr => (pr.status === "active" || pr.status === "tentative") && (!pr.hasOwner || !pr.hasTeam));
  return unmapped.map(project => {
    const score = (pl: PersonLoad, isOwner: boolean) => {
      let s = 100;
      if (isOwner) { s -= pl.ownerProjectCount * 15; s -= pl.fragmentationLevel * 8; }
      else { s -= pl.supportProjectCount * 10; s -= pl.fragmentationLevel * 6; }
      s -= pl.activeProjectCount * 5;
      if (pl.fragmentationLabel === "high") s -= 15;
      if (pl.upcomingTimeOff.some(to => to.daysUntil <= 14)) s -= 10;
      if (pl.status === "red") s -= 30;
      if (pl.status === "yellow") s -= 10;
      return Math.max(0, s);
    };
    const toCandidate = (pl: PersonLoad, isOwner: boolean): AssignmentCandidate => ({
      personId: pl.personId, personName: pl.personName, role: pl.role,
      score: score(pl, isOwner),
      currentActiveProjects: pl.activeProjectCount, currentOwnerProjects: pl.ownerProjectCount,
      fragmentationLevel: pl.fragmentationLevel,
      hasUpcomingTimeOff: pl.upcomingTimeOff.some(to => to.daysUntil <= 14),
      reasons: [
        pl.ownerProjectCount === 0 && isOwner ? "Nessuna ownership attuale" : "",
        pl.status === "green" ? "Carico basso" : "",
        pl.upcomingTimeOff.some(to => to.daysUntil <= 14) ? "⚠ Ferie imminenti" : "",
      ].filter(Boolean),
    });
    const eligible = personLoads.filter(pl => pl.status !== "red");
    const ownerCandidates = eligible.map(pl => toCandidate(pl, true)).sort((a, b) => b.score - a.score).slice(0, 3);
    const ownerIds = new Set(ownerCandidates.map(c => c.personId));
    const supportCandidates = eligible.filter(pl => !ownerIds.has(pl.personId)).map(pl => toCandidate(pl, false)).sort((a, b) => b.score - a.score).slice(0, 3);
    return {
      projectId: project.id, projectName: project.name, clientName: project.clientName,
      ownerCandidates, supportCandidates,
      suggestionBasis: !project.hasOwner && !project.hasTeam ? "Senza owner e senza team" : !project.hasOwner ? "Senza owner" : "Senza team",
    };
  });
}

export function buildAlerts(planningProjects: PlanningProject[], personLoads: PersonLoad[]): PlanningAlert[] {
  const alerts: PlanningAlert[] = [];
  for (const pr of planningProjects) {
    if (!pr.hasOwner && (pr.status === "active" || pr.status === "tentative"))
      alerts.push({ type: "no_owner", severity: "critical", title: "Progetto senza owner", detail: `"${pr.name}"${pr.clientName ? ` (${pr.clientName})` : ""} non ha un PM assegnato.`, subjectId: pr.id, subjectName: pr.name });
    if (!pr.hasTeam && pr.status === "active")
      alerts.push({ type: "no_team", severity: "warning", title: "Progetto senza team", detail: `"${pr.name}" è attivo senza risorse assegnate.`, subjectId: pr.id, subjectName: pr.name });
    if (pr.status === "dormant")
      alerts.push({ type: "dormant_open", severity: "warning", title: "Progetto dormiente", detail: `"${pr.name}" risulta attivo su Float${pr.endDate ? ` ma scaduto il ${pr.endDate}` : ""}.`, subjectId: pr.id, subjectName: pr.name });
    if (pr.status === "periodic" && !pr.hasOwner)
      alerts.push({ type: "periodic_no_owner", severity: "info", title: "Periodico senza owner", detail: `"${pr.name}" è periodico senza owner designato.`, subjectId: pr.id, subjectName: pr.name });
    if (pr.status === "tentative" && !pr.hasTeam)
      alerts.push({ type: "tentative_no_team", severity: "info", title: "Tentativo senza team", detail: `"${pr.name}" è tentativo senza risorse.`, subjectId: pr.id, subjectName: pr.name });
  }
  for (const pl of personLoads) {
    if (pl.status === "red")
      alerts.push({ type: "overloaded_person", severity: "critical", title: "Risorsa sovraccarica", detail: `${pl.personName}: ${pl.statusReason}`, subjectId: pl.personId, subjectName: pl.personName });
    if (pl.activeProjectCount === 0 && pl.periodicProjectCount === 0)
      alerts.push({ type: "person_available", severity: "info", title: "Risorsa disponibile", detail: `${pl.personName} non ha progetti attivi.`, subjectId: pl.personId, subjectName: pl.personName });
  }
  const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function assemblePlanningData(
  rawProjects: FloatRawProject[], rawAccounts: FloatRawAccount[], rawPeople: FloatRawPerson[],
  rawTeam: FloatRawProjectTeam[], rawPhases: FloatRawPhase[], rawTimeOff: FloatRawTimeOff[],
  fic: FicData, floatData: FloatData, mappings: QuoteProjectMapping[]
): Omit<PlanningData, "fetchedAt" | "error"> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const accountsById = new Map(rawAccounts.map(a => [a.account_id, a]));
  const peopleById = new Map(rawPeople.map(p => [p.people_id, p]));
  const projectsBase = buildPlanningProjects(rawProjects, rawTeam, rawPhases, accountsById, peopleById, today);
  const commercialSignals = buildCommercialSignals(projectsBase, fic, floatData, mappings);
  const projects = enrichProjectsWithCommercial(projectsBase, commercialSignals);
  const people = buildPersonLoads(rawPeople, projects, rawTimeOff, today);
  const planningWeeks = buildPlanningWeeks(today);
  const resourceAvailability = buildResourceAvailability(projects, people, rawTimeOff, planningWeeks, today);
  const proposals = buildPlanningProposals(projects, people, resourceAvailability, planningWeeks, commercialSignals, floatData);
  const allocationPreviews = buildAllocationPreviews(projects, people, resourceAvailability, planningWeeks, floatData);
  const suggestions = buildSuggestions(projects, people);
  const alerts = buildAlerts(projects, people);
  const ficClients = fic.allClients
    .map(client => ({
      id: client.id,
      name: client.name,
      totalRevenue: Math.round(client.totalRevenue * 100) / 100,
      invoiceCount: client.invoiceCount,
    }));
  return {
    projects, people, suggestions, alerts, planningWeeks, resourceAvailability, proposals, allocationPreviews, commercialSignals,
    ficClients,
    mappings,
    summary: {
      totalProjects: projects.length,
      activeProjects: projects.filter(p => p.status === "active").length,
      tentativeProjects: projects.filter(p => p.status === "tentative").length,
      dormantProjects: projects.filter(p => p.status === "dormant").length,
      periodicProjects: projects.filter(p => p.status === "periodic").length,
      totalPeople: people.length,
      greenPeople: people.filter(p => p.status === "green").length,
      yellowPeople: people.filter(p => p.status === "yellow").length,
      redPeople: people.filter(p => p.status === "red").length,
      criticalAlerts: alerts.filter(a => a.severity === "critical").length,
      warningAlerts: alerts.filter(a => a.severity === "warning").length,
    },
  };
}
