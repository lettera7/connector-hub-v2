import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPhaseLevelPlanningProposal,
  getPlanningHorizon,
} from "../lib/planning/planning-logic";
import type { FloatData } from "../lib/dashboard/types";
import type { PersonLoad, PlanningProject, ResourceAvailability } from "../lib/planning/types";

const weeks = getPlanningHorizon(new Date("2026-05-04T00:00:00"), 8);

const emptyFloatData: FloatData = {
  accounts: [],
  people: [],
  projects: [],
  projectHours: [],
  projectHoursYtd: [],
  projectPhaseHours: [],
  recentProjectActivityIds: [],
  assignments: [],
  recentAssignments: [],
  error: null,
  fetchedAt: "2026-05-02T00:00:00.000Z",
};

function person(id: number, name: string, skillTags: string[]): PersonLoad {
  return {
    personId: id,
    personName: name,
    role: null,
    department: null,
    skillTags,
    weeklyCapacityHours: 40,
    activeProjectCount: 1,
    periodicProjectCount: 0,
    ownerProjectCount: 0,
    supportProjectCount: 0,
    fragmentationLevel: 1,
    fragmentationLabel: "low",
    upcomingTimeOff: [],
    projectNames: [],
    periodicProjectNames: [],
    status: "green",
    statusReason: "Disponibile",
  };
}

function resource(load: PersonLoad): ResourceAvailability {
  return {
    personId: load.personId,
    personName: load.personName,
    role: load.role,
    department: load.department,
    skillTags: load.skillTags,
    status: load.status,
    statusReason: load.statusReason,
    weeklyCapacityHours: load.weeklyCapacityHours,
    totalScheduledHours: 0,
    totalFreeHours: weeks.length * load.weeklyCapacityHours,
    timeline: weeks.map(week => ({
      weekKey: week.weekKey,
      weekLabel: week.label,
      capacityHours: load.weeklyCapacityHours,
      scheduledHours: 0,
      freeHours: load.weeklyCapacityHours,
      utilization: 0,
      projectNames: [],
      timeOffHours: 0,
    })),
  };
}

test("dashboard planner spreads Consulenza on Brand one hour per month without fallback", () => {
  const people = [
    person(1, "Daniele", ["senior", "brand-design"]),
    person(2, "Luca Vitolo", ["pm-client"]),
    person(3, "Domitilla", ["execution"]),
  ];
  const project: PlanningProject = {
    id: 100,
    name: "ESTRA - Next Step 2026",
    clientName: null,
    status: "active",
    projectCode: "ESTRA-26",
    startDate: "2026-05-01",
    endDate: "2026-12-31",
    projectManagerId: 1,
    projectManagerName: "Daniele",
    projectManagerAvatar: null,
    teamIds: [2],
    teamNames: ["Luca Vitolo"],
    budgetAvailability: "budget_per_phase",
    budgetValue: null,
    budgetType: 1,
    phases: [{
      id: 10,
      name: "Consulenza on Brand / Relazione cliente",
      startDate: "2026-05-01",
      endDate: "2026-12-31",
      budget: 8,
    }],
    tags: [],
    nonBillable: false,
    hasOwner: true,
    hasTeam: true,
    clientRevenueNet: 0,
    clientPaid: 0,
    clientDue: 0,
    clientCollectionRatio: 0,
    commercialPriority: 0,
    commercialLabel: "low",
  };

  const previews = buildPhaseLevelPlanningProposal([project], people, people.map(resource), weeks, emptyFloatData);

  assert.equal(previews.length, 2);
  assert.deepEqual(previews.map(preview => preview.startDate.slice(0, 7)), ["2026-05", "2026-06"]);
  assert.deepEqual(previews.map(preview => preview.proposedHours), [1, 1]);
  assert.equal(previews.every(preview => preview.personName === "Daniele" || preview.personName === "Luca Vitolo"), true);
});

test("dashboard planner uses person skill tags to rank execution candidates", () => {
  const people = [
    person(1, "Martina", ["packaging", "brand-design"]),
    person(2, "Domitilla", ["execution"]),
  ];
  const project: PlanningProject = {
    id: 200,
    name: "Packaging Sprint",
    clientName: null,
    status: "active",
    projectCode: "PACK-26",
    startDate: "2026-05-01",
    endDate: "2026-06-30",
    projectManagerId: null,
    projectManagerName: null,
    projectManagerAvatar: null,
    teamIds: [1, 2],
    teamNames: ["Martina", "Domitilla"],
    budgetAvailability: "budget_per_phase",
    budgetValue: null,
    budgetType: 1,
    phases: [{
      id: 20,
      name: "Packaging visual design",
      startDate: "2026-05-04",
      endDate: "2026-06-30",
      budget: 4,
    }],
    tags: [],
    nonBillable: false,
    hasOwner: false,
    hasTeam: true,
    clientRevenueNet: 0,
    clientPaid: 0,
    clientDue: 0,
    clientCollectionRatio: 0,
    commercialPriority: 0,
    commercialLabel: "low",
  };

  const previews = buildPhaseLevelPlanningProposal([project], people, people.map(resource), weeks, emptyFloatData);

  assert.equal(previews[0]?.personName, "Martina");
});
