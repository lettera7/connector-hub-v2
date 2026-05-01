import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateResidualHours,
  generatePlanningProposal,
  getStartOfNextPlanningWeek,
  isInternalProjectName,
} from "../lib/planner/auto-planner";
import { createMockPlannerInput, mockPlannerProjects, mockPlannerResources } from "../lib/planner/mock-data";

test("starts from the next Monday", () => {
  assert.equal(getStartOfNextPlanningWeek("2026-05-01"), "2026-05-04");
  assert.equal(getStartOfNextPlanningWeek("2026-05-04"), "2026-05-11");
});

test("does not assign work in the current week", () => {
  const output = generatePlanningProposal(createMockPlannerInput("2026-05-01"));
  assert.equal(output.planningStartDate, "2026-05-04");
  assert.equal(output.plannedAssignments.some(assignment => assignment.weekStart < output.planningStartDate), false);
});

test("respects the 85 percent capacity limit", () => {
  const output = generatePlanningProposal(createMockPlannerInput("2026-05-01"));
  for (const capacity of output.capacityByResourceWeek) {
    assert.ok(capacity.resultingSaturation <= 0.85, `${capacity.resourceName} ${capacity.weekStart}`);
  }
});

test("assigns Dario only to review or creative direction", () => {
  const output = generatePlanningProposal(createMockPlannerInput("2026-05-01"));
  const darioAssignments = output.plannedAssignments.filter(assignment => assignment.resourceName === "Dario");
  assert.ok(darioAssignments.length > 0);
  for (const assignment of darioAssignments) {
    assert.match(assignment.phaseName, /review|creative direction|direzione creativa|concept|strategy|strategia/i);
  }
});

test("assigns Luca only to PM or administration phases", () => {
  const output = generatePlanningProposal(createMockPlannerInput("2026-05-01"));
  const lucaAssignments = output.plannedAssignments.filter(assignment => assignment.resourceName === "Luca");
  assert.ok(lucaAssignments.length > 0);
  for (const assignment of lucaAssignments) {
    assert.match(assignment.phaseName, /pm|admin|amministrazione|setup|pianificazione|coordinamento/i);
  }
});

test("excludes junior resources from senior work", () => {
  const output = generatePlanningProposal(createMockPlannerInput("2026-05-01"));
  const juniorSeniorAssignments = output.plannedAssignments.filter(assignment =>
    assignment.resourceName === "Stefano" && /strategia|strategy|concept|creative direction|review/i.test(assignment.phaseName)
  );
  assert.equal(juniorSeniorAssignments.length, 0);
});

test("splits a large phase over multiple weeks", () => {
  const output = generatePlanningProposal(createMockPlannerInput("2026-05-01"));
  const catalogAssignments = output.plannedAssignments.filter(assignment => assignment.phaseId === "catalog-delivery");
  const weeks = new Set(catalogAssignments.map(assignment => assignment.weekStart));
  assert.ok(weeks.size > 1);
  assert.equal(catalogAssignments.every(assignment => assignment.proposedHours <= 16), true);
});

test("distributes periodic projects month by month", () => {
  const output = generatePlanningProposal(createMockPlannerInput("2026-05-01"));
  for (const projectName of ["San Salvatore 2026", "Grafica Metelliana"]) {
    const assignments = output.plannedAssignments.filter(assignment => assignment.projectName === projectName);
    const months = assignments.map(assignment => assignment.weekStart.slice(0, 7));
    assert.ok(months.includes("2026-05"), projectName);
    assert.ok(months.includes("2026-06"), projectName);
    assert.equal(new Set(months).size, months.length, `${projectName} should have one allocation per month in horizon`);
  }
});

test("reports unplannable phases without forcing assignments", () => {
  const output = generatePlanningProposal({
    today: "2026-05-01",
    resources: mockPlannerResources.filter(resource => resource.id === "stefano" || resource.id === "luca"),
    projects: mockPlannerProjects.filter(project => project.id === "senior-blocked"),
  });
  assert.equal(output.plannedAssignments.length, 0);
  assert.equal(output.unplannedPhases.length, 1);
  assert.equal(output.unplannedPhases[0]?.phaseId, "blocked-strategy");
});

test("skips internal L7 and LETTERA7 projects", () => {
  assert.equal(isInternalProjectName("L7 | Marketing interno"), true);
  assert.equal(isInternalProjectName("LETTERA7 Amministrazione"), true);
  assert.equal(isInternalProjectName("Cliente L7"), false);

  const output = generatePlanningProposal(createMockPlannerInput("2026-05-01"));
  assert.equal(output.plannedAssignments.some(assignment => assignment.projectId === "internal-l7"), false);
  assert.equal(output.plannedAssignments.some(assignment => assignment.projectId === "internal-lettera7"), false);
  assert.equal(output.warnings.filter(warning => warning.code === "INTERNAL_PROJECT_SKIPPED").length, 2);
});

test("calculates residual hours", () => {
  assert.equal(calculateResidualHours({ budgetHours: 20, scheduledHours: 7.5 }), 12.5);
  assert.equal(calculateResidualHours({ budgetHours: 5, scheduledHours: 15.5 }), 0);
});
