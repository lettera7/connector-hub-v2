export type ResourceRole =
  | "creative-director"
  | "senior-designer"
  | "designer"
  | "junior-designer"
  | "pm-admin";

export type PhaseComplexity = "high" | "medium-high" | "medium-low" | "low" | "pm";

export interface PlannerResource {
  id: string;
  name: string;
  role: ResourceRole;
  weeklyCapacityHours: number;
  existingContexts?: {
    ownedProjectIds?: string[];
    supportProjectIds?: string[];
    recurringProjectIds?: string[];
  };
}

export interface PlannerPhase {
  id: string;
  name: string;
  budgetHours: number;
  scheduledHours: number;
  startDate?: string;
  endDate?: string;
  complexity?: PhaseComplexity;
}

export interface PlannerProject {
  id: string;
  name: string;
  ownerResourceId?: string;
  teamResourceIds: string[];
  phases: PlannerPhase[];
  active?: boolean;
  periodic?: "san-salvatore" | "grafica-metelliana";
}

export interface ExistingAssignment {
  resourceId: string;
  projectId?: string;
  phaseId?: string;
  weekStart: string;
  hours: number;
}

export interface PlannerInput {
  today: string | Date;
  resources: PlannerResource[];
  projects: PlannerProject[];
  existingAssignments?: ExistingAssignment[];
  horizonWeeks?: number;
}

export interface PlanningHorizon {
  startDate: string;
  endDate: string;
  weeks: string[];
}

export interface PlannedAssignment {
  projectId: string;
  projectName: string;
  phaseId: string;
  phaseName: string;
  resourceId: string;
  resourceName: string;
  role: ResourceRole;
  weekStart: string;
  weekEnd: string;
  proposedHours: number;
}

export interface PlannedPhaseSummary {
  projectId: string;
  projectName: string;
  phaseId: string;
  phaseName: string;
  remainingHours: number;
  plannedHours: number;
  unplannedHours: number;
  reason?: string;
}

export interface CapacityByResourceWeek {
  resourceId: string;
  resourceName: string;
  weekStart: string;
  theoreticalWeeklyCapacity: number;
  alreadyOccupiedHours: number;
  proposedNewHours: number;
  resultingSaturation: number;
  remainingSafeCapacity: number;
}

export interface PlannerWarning {
  code:
    | "NO_PHASES"
    | "NO_REMAINING_HOURS"
    | "INTERNAL_PROJECT_SKIPPED"
    | "NO_ELIGIBLE_RESOURCE"
    | "PARTIALLY_PLANNED"
    | "CAPACITY_LIMIT"
    | "CONTEXT_LIMIT";
  message: string;
  projectId?: string;
  phaseId?: string;
  resourceId?: string;
}

export interface PlannerOutput {
  planningStartDate: string;
  planningHorizon: PlanningHorizon;
  plannedAssignments: PlannedAssignment[];
  partiallyPlannedPhases: PlannedPhaseSummary[];
  unplannedPhases: PlannedPhaseSummary[];
  capacityByResourceWeek: CapacityByResourceWeek[];
  warnings: PlannerWarning[];
}
