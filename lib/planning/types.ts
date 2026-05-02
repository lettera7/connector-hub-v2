// Raw Float API shapes
export interface FloatRawProject {
  project_id: number; name: string; client_id: number | null; client_name: string | null;
  project_code?: string | null;
  active: 0 | 1 | boolean; tentative: 0 | 1 | boolean; color: string | null;
  tags: Array<{ tag_id: number; name: string }> | string[];
  start_date: string | null; end_date: string | null;
  budget_type: number | null; budget_total: number | null; budget_per_phase: 0 | 1 | boolean;
  project_manager: number | null; non_billable: 0 | 1 | boolean; notes: string | null;
}
export interface FloatRawAccount {
  account_id: number;
  name: string;
  email: string | null;
  avatar: string | null;
  active: 0 | 1 | boolean;
}
export interface FloatRawPerson {
  people_id: number; name: string; email: string | null; job_title: string | null;
  department: { department_id: number; name: string } | string | null;
  active: 0 | 1 | boolean; employee_type: 1 | 2 | 3;
  avatar_file: string | null; default_hourly_rate: number | null;
  work_days_hours: Record<string, number> | null;
  tags?: Array<{ tag_id: number; name: string }> | string[];
}
export interface FloatRawProjectTeam { project_id: number; people_id: number; }
export interface FloatRawPhase {
  phase_id: number; project_id: number; name: string;
  start_date: string | null; end_date: string | null; budget: number | null; status: number | null;
}
export interface FloatRawTimeOff {
  timeoff_id: number; people_id: number; start_date: string; end_date: string;
  timeoff_type_id: number; status: number; full_day: 0 | 1 | boolean;
}

// Normalized planning shapes
export type ProjectStatus = "active" | "tentative" | "dormant" | "periodic";
export type BudgetAvailability = "budget_total_fee" | "budget_hours" | "budget_per_phase" | "no_budget";
export type LoadStatus = "green" | "yellow" | "red";
export type AlertSeverity = "critical" | "warning" | "info";
export type AlertType = "no_owner" | "no_team" | "overloaded_person" | "dormant_open" | "periodic_no_owner" | "person_available" | "tentative_no_team";

export interface PlanningPhase { id: number; name: string; startDate: string | null; endDate: string | null; budget: number | null; }
export interface PlanningProject {
  id: number; name: string; clientName: string | null; status: ProjectStatus;
  projectCode: string | null;
  startDate: string | null; endDate: string | null;
  projectManagerId: number | null; projectManagerName: string | null;
  projectManagerAvatar: string | null;
  teamIds: number[]; teamNames: string[];
  budgetAvailability: BudgetAvailability; budgetValue: number | null; budgetType: number | null;
  phases: PlanningPhase[]; tags: string[]; nonBillable: boolean;
  hasOwner: boolean; hasTeam: boolean;
  clientRevenueNet: number;
  clientPaid: number;
  clientDue: number;
  clientCollectionRatio: number;
  commercialPriority: number;
  commercialLabel: "high" | "medium" | "low";
}
export interface UpcomingTimeOff { startDate: string; endDate: string; daysUntil: number; }
export interface PersonLoad {
  personId: number; personName: string; role: string | null; department: string | null;
  skillTags: string[];
  weeklyCapacityHours: number;
  activeProjectCount: number; periodicProjectCount: number;
  ownerProjectCount: number; supportProjectCount: number;
  fragmentationLevel: number; fragmentationLabel: "low" | "medium" | "high";
  upcomingTimeOff: UpcomingTimeOff[];
  projectNames: string[]; periodicProjectNames: string[];
  status: LoadStatus; statusReason: string;
}
export interface PlanningWeek {
  weekKey: string;
  label: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}
export interface WeeklyResourceLoad {
  weekKey: string;
  weekLabel: string;
  capacityHours: number;
  scheduledHours: number;
  freeHours: number;
  utilization: number;
  projectNames: string[];
  timeOffHours: number;
}
export interface ResourceAvailability {
  personId: number;
  personName: string;
  role: string | null;
  department: string | null;
  skillTags: string[];
  status: LoadStatus;
  statusReason: string;
  weeklyCapacityHours: number;
  totalScheduledHours: number;
  totalFreeHours: number;
  timeline: WeeklyResourceLoad[];
}
export interface AssignmentCandidate {
  personId: number; personName: string; role: string | null; score: number;
  currentActiveProjects: number; currentOwnerProjects: number; fragmentationLevel: number;
  hasUpcomingTimeOff: boolean; reasons: string[];
}
export interface ProjectSuggestion {
  projectId: number; projectName: string; clientName: string | null;
  ownerCandidates: AssignmentCandidate[]; supportCandidates: AssignmentCandidate[];
  suggestionBasis: string;
}
export interface PlanningAlert {
  type: AlertType; severity: AlertSeverity; title: string; detail: string;
  subjectId: number; subjectName: string;
}
export interface PlanningProposal {
  projectId: number;
  projectName: string;
  clientName: string | null;
  basis: string;
  weekKey: string;
  weekLabel: string;
  ownerCandidate: AssignmentCandidate | null;
  supportCandidate: AssignmentCandidate | null;
  ownerEffortHours: number;
  supportEffortHours: number;
  rationale: string[];
  commercialPriority: number;
  previousAssignees: string[];
}
export interface PlanningCommercialSignal {
  projectId: number;
  projectName: string;
  clientName: string | null;
  ficClientId: number | null;
  ficClientName: string | null;
  projectBudgetTotal: number;
  clientBudgetTotal: number;
  clientRevenueTotal: number;
  revenueToBudgetRatio: number | null;
  revenueNet: number;
  paid: number;
  due: number;
  invoiceCount: number;
  collectionRatio: number;
  score: number;
  matchSource: "mapping" | "similarity" | "none";
  recentAssignments: { personId: number; personName: string; hours: number }[];
}
export interface PlanningFicClient {
  id: number;
  name: string;
  totalRevenue: number;
  invoiceCount: number;
}
export interface PlanningProjectClientMapping {
  floatProjectId: number;
  floatProjectName: string;
  ficClientId: number;
  ficClientName: string;
  mappingSource: "manual" | "automatic";
  updatedAt: string;
}
export interface PlanningAllocationPreview {
  id: string;
  projectId: number;
  projectName: string;
  phaseId: number | null;
  phaseName: string | null;
  clientName: string | null;
  personId: number;
  personName: string;
  allocationRole: "owner" | "team" | "fallback";
  weekKey: string;
  weekLabel: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  budgetHours: number;
  scheduledHours: number;
  remainingHours: number;
  proposedHours: number;
  hoursPerDay: number;
  theoreticalWeeklyCapacity: number;
  alreadyOccupiedHours: number;
  proposedNewHours: number;
  resultingSaturation: number;
  remainingSafeCapacity: number;
  ownershipCount: number;
  supportCount: number;
  recurringCount: number;
  totalActiveContexts: number;
  fragmentationState: "low" | "medium" | "high";
  guardrailState: "target" | "warning" | "exception";
  hasOwner: boolean;
  ownerName: string | null;
  hasTeam: boolean;
  teamNames: string[];
  hasPhases: boolean;
  phaseCount: number;
  budgetSource: "project" | "phases" | "fallback";
  basis: string;
}
export interface PlanningData {
  projects: PlanningProject[]; people: PersonLoad[];
  suggestions: ProjectSuggestion[]; alerts: PlanningAlert[];
  planningWeeks: PlanningWeek[];
  resourceAvailability: ResourceAvailability[];
  proposals: PlanningProposal[];
  allocationPreviews: PlanningAllocationPreview[];
  commercialSignals: PlanningCommercialSignal[];
  ficClients: PlanningFicClient[];
  mappings: PlanningProjectClientMapping[];
  fetchedAt: string; error: string | null;
  summary: {
    totalProjects: number; activeProjects: number; tentativeProjects: number;
    dormantProjects: number; periodicProjects: number;
    totalPeople: number; greenPeople: number; yellowPeople: number; redPeople: number;
    criticalAlerts: number; warningAlerts: number;
  };
}
