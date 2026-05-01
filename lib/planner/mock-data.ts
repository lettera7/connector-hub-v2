import type { PlannerInput, PlannerProject, PlannerResource } from "./types";

export const mockPlannerResources: PlannerResource[] = [
  { id: "dario", name: "Dario", role: "creative-director", weeklyCapacityHours: 32 },
  { id: "daniele", name: "Daniele", role: "senior-designer", weeklyCapacityHours: 40 },
  { id: "martina", name: "Martina", role: "designer", weeklyCapacityHours: 40 },
  { id: "domitilla", name: "Domitilla", role: "designer", weeklyCapacityHours: 36 },
  { id: "stefano", name: "Stefano", role: "junior-designer", weeklyCapacityHours: 32 },
  { id: "luca", name: "Luca", role: "pm-admin", weeklyCapacityHours: 30 },
];

export const mockPlannerProjects: PlannerProject[] = [
  {
    id: "brand-identity",
    name: "Brand Identity 2026",
    ownerResourceId: "daniele",
    teamResourceIds: ["daniele", "martina", "dario"],
    phases: [
      { id: "brand-review", name: "Creative direction review", budgetHours: 10, scheduledHours: 0 },
      { id: "brand-system", name: "Design system", budgetHours: 80, scheduledHours: 10 },
    ],
  },
  {
    id: "operations",
    name: "Operations Setup",
    ownerResourceId: "luca",
    teamResourceIds: ["luca"],
    phases: [
      { id: "ops-setup", name: "Setup & amministrazione", budgetHours: 12, scheduledHours: 2 },
    ],
  },
  {
    id: "execution-heavy",
    name: "Catalogo Execution",
    ownerResourceId: "martina",
    teamResourceIds: ["martina", "domitilla", "stefano"],
    phases: [
      { id: "catalog-delivery", name: "Execution delivery", budgetHours: 120, scheduledHours: 0 },
    ],
  },
  {
    id: "san-salvatore",
    name: "San Salvatore 2026",
    ownerResourceId: "daniele",
    teamResourceIds: ["daniele", "martina"],
    periodic: "san-salvatore",
    phases: [
      { id: "ss-maggio", name: "Maggio", budgetHours: 40, scheduledHours: 10 },
      { id: "ss-giugno", name: "Giugno", budgetHours: 40, scheduledHours: 0 },
      { id: "ss-luglio", name: "Luglio", budgetHours: 40, scheduledHours: 0 },
    ],
  },
  {
    id: "grafica-metelliana",
    name: "Grafica Metelliana",
    ownerResourceId: "martina",
    teamResourceIds: ["martina", "domitilla"],
    periodic: "grafica-metelliana",
    phases: [
      { id: "gm-maggio", name: "Maggio visual design", budgetHours: 24, scheduledHours: 0 },
      { id: "gm-giugno", name: "Giugno visual design", budgetHours: 24, scheduledHours: 0 },
      { id: "gm-luglio", name: "Luglio visual design", budgetHours: 24, scheduledHours: 0 },
    ],
  },
  {
    id: "internal-l7",
    name: "L7 | Marketing interno",
    ownerResourceId: "daniele",
    teamResourceIds: ["daniele", "martina"],
    phases: [
      { id: "internal-l7-phase", name: "Execution delivery", budgetHours: 40, scheduledHours: 0 },
    ],
  },
  {
    id: "internal-lettera7",
    name: "LETTERA7 Amministrazione",
    ownerResourceId: "luca",
    teamResourceIds: ["luca"],
    phases: [
      { id: "internal-lettera7-phase", name: "Setup & amministrazione", budgetHours: 20, scheduledHours: 0 },
    ],
  },
  {
    id: "senior-blocked",
    name: "Senior Blocked",
    ownerResourceId: "stefano",
    teamResourceIds: ["stefano", "luca"],
    phases: [
      { id: "blocked-strategy", name: "Strategia e concept senior", budgetHours: 30, scheduledHours: 0 },
    ],
  },
];

export function createMockPlannerInput(today = "2026-05-01"): PlannerInput {
  return {
    today,
    resources: mockPlannerResources,
    projects: mockPlannerProjects,
    existingAssignments: [
      { resourceId: "daniele", projectId: "existing", weekStart: "2026-05-04", hours: 12 },
      { resourceId: "martina", projectId: "existing", weekStart: "2026-05-04", hours: 10 },
    ],
  };
}
