/**
 * Float Adapter — native API v3 data only.
 * Fetches people, projects, tasks (for monthly hours).
 * No time-off endpoint (404 on v3). Time-off is handled by planning adapter.
 */

import type { FloatCredentials } from "../config-store";
import type { FloatAccount, FloatData, FloatPerson, FloatProject, FloatAssignment, ProjectHours, ProjectPhaseHours, FloatCapacity } from "../dashboard/types";

const BASE = "https://api.float.com/v3";

// ── HTTP helper ────────────────────────────────────────────
async function floatGet(apiKey: string, path: string): Promise<unknown[]> {
  const key = apiKey.replace(/^[^a-zA-Z0-9]+/, "");
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) { await new Promise(r => setTimeout(r, 3000)); return floatGet(apiKey, path); }
  if (!res.ok) { const b = await res.text().catch(() => ""); throw new Error(`Float HTTP ${res.status} on ${path}: ${b.slice(0, 200)}`); }
  const j = await res.json();
  return Array.isArray(j) ? j : (j?.data ?? []);
}

async function paginateAll<T>(apiKey: string, basePath: string): Promise<T[]> {
  const sep = basePath.includes("?") ? "&" : "?";
  const all: T[] = [];
  let page = 1;
  while (page <= 100) {
    const chunk = await floatGet(apiKey, `${basePath}${sep}per-page=200&page=${page}`) as T[];
    if (!chunk.length) break;
    all.push(...chunk);
    if (chunk.length < 200) break;
    page++;
  }
  return all;
}

async function fetchProjectHoursReport(
  apiKey: string,
  startDate: string,
  endDate: string,
  projects: FloatProject[],
): Promise<ProjectHours[]> {
  const key = apiKey.replace(/^[^a-zA-Z0-9]+/, "");
  const res = await fetch(`${BASE}/reports/projects?start_date=${startDate}&end_date=${endDate}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Float HTTP ${res.status} on /reports/projects: ${body.slice(0, 200)}`);
  }

  const json = await res.json() as { projects?: Array<Record<string, unknown>> };
  const projectById = new Map(projects.map((p) => [p.id, p]));
  return (json.projects ?? [])
    .map((row) => {
      const projectId = Number(row.project_id ?? 0);
      const project = projectById.get(projectId);
      return {
        projectId,
        projectName: project?.name ?? String(row.name ?? "N/D"),
        totalHours: Math.round(Number(row.scheduled ?? 0) * 100) / 100,
      };
    })
    .filter((row) => row.projectId > 0 && row.totalHours > 0);
}

async function fetchRecentProjectActivityIds(
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<number[]> {
  const key = apiKey.replace(/^[^a-zA-Z0-9]+/, "");
  const res = await fetch(`${BASE}/reports/projects?start_date=${startDate}&end_date=${endDate}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Float HTTP ${res.status} on /reports/projects recent: ${body.slice(0, 200)}`);
  }

  const json = await res.json() as { projects?: Array<Record<string, unknown>> };
  return (json.projects ?? [])
    .map((row) => ({ projectId: Number(row.project_id ?? 0), scheduled: Number(row.scheduled ?? 0) }))
    .filter((row) => row.projectId > 0 && row.scheduled > 0)
    .map((row) => row.projectId);
}

async function enrichProjectCodes(
  apiKey: string,
  projects: FloatProject[],
  projectIds: number[],
): Promise<void> {
  const key = apiKey.replace(/^[^a-zA-Z0-9]+/, "");
  const byId = new Map(projects.map((p) => [p.id, p]));
  const pendingIds = Array.from(new Set(projectIds)).filter((projectId) => {
    const project = byId.get(projectId);
    return project != null && !project.projectCode;
  });

  const fetchProjectDetail = async (projectId: number, attempt = 0): Promise<void> => {
    const project = byId.get(projectId);
    if (!project || project.projectCode) return;
    try {
      const res = await fetch(`${BASE}/projects/${projectId}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 429 && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
        return fetchProjectDetail(projectId, attempt + 1);
      }
      if (!res.ok) return;
      const json = await res.json() as Record<string, unknown>;
      if (json.project_code != null && String(json.project_code).trim() !== "") {
        project.projectCode = String(json.project_code);
      }
      if (json.project_manager != null) {
        project.projectManagerId = Number(json.project_manager);
      }
    } catch {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        return fetchProjectDetail(projectId, attempt + 1);
      }
      // Ignore per-project enrichment failures and keep fallback classification.
    }
  };

  // Float is inconsistent when we fan out project-detail requests.
  // Resolve them sequentially so dashboard classification remains stable.
  for (const projectId of pendingIds) {
    await fetchProjectDetail(projectId);
  }
}

async function enrichProjectPhaseSignals(
  apiKey: string,
  projects: FloatProject[],
  projectIds: number[],
): Promise<void> {
  const key = apiKey.replace(/^[^a-zA-Z0-9]+/, "");
  const currentYear = new Date().getFullYear();
  const yearEnd = `${currentYear}-12-31`;
  const byId = new Map(projects.map((p) => [p.id, p]));

  await Promise.all(projectIds.map(async (projectId) => {
    const project = byId.get(projectId);
    if (!project) return;
    try {
      const res = await fetch(`${BASE}/phases?project_id=${projectId}&per_page=200&page=1`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return;
      const json = await res.json();
      const phases = Array.isArray(json) ? json : (json?.data ?? []);
      project.hasAnnualConsultingPhase = phases.some((phase: Record<string, unknown>) => {
        const name = String(phase.name ?? "");
        const startDate = String(phase.start_date ?? "");
        const endDate = String(phase.end_date ?? "");
        return /consulenza/i.test(name) && endDate === yearEnd && startDate <= `${currentYear}-03-31`;
      });
    } catch {
      project.hasAnnualConsultingPhase = false;
    }
  }));
}

function extractHours(r: Record<string, unknown>): number {
  // Try all known Float hour fields
  for (const f of ["hours_pd", "hours_per_day", "hours", "total_hours", "estimated_hours", "allocated_hours"]) {
    const v = r[f];
    if (v != null && !isNaN(Number(v)) && Number(v) > 0) return Number(v);
  }
  return 0;
}

function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function workingDays(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function prorateHours(taskStart: string, taskEnd: string, hours: number, winStart: Date, winEnd: Date): number {
  if (hours <= 0) return 0;
  const tStart = parseDate(taskStart);
  const tEnd = parseDate(taskEnd || taskStart);
  const totalDays = workingDays(tStart, tEnd);
  if (totalDays === 0) return hours;

  const overlapStart = new Date(Math.max(tStart.getTime(), winStart.getTime()));
  const overlapEnd = new Date(Math.min(tEnd.getTime(), winEnd.getTime()));
  const overlapDays = workingDays(overlapStart, overlapEnd);
  if (overlapDays <= 0) return 0;
  if (overlapDays >= totalDays) return hours;

  return Math.round((hours * overlapDays / totalDays) * 100) / 100;
}

// ── People ─────────────────────────────────────────────────
async function fetchPeople(apiKey: string): Promise<FloatPerson[]> {
  const raw = await paginateAll<Record<string, unknown>>(apiKey, "/people");
  return raw.map(r => ({
    id: Number(r.people_id ?? r.id ?? 0),
    name: String(r.name ?? ""),
    email: r.email ? String(r.email) : null,
    jobTitle: r.job_title ? String(r.job_title) : null,
    department: typeof r.department === "object" && r.department
      ? String((r.department as Record<string, unknown>).name ?? "")
      : r.department ? String(r.department) : null,
    active: r.active === true || r.active === 1,
    employeeType: Number(r.employee_type ?? 1),
  }));
}

async function fetchAccounts(apiKey: string): Promise<FloatAccount[]> {
  const raw = await paginateAll<Record<string, unknown>>(apiKey, "/accounts");
  return raw.map(r => ({
    id: Number(r.account_id ?? r.id ?? 0),
    name: String(r.name ?? ""),
    email: r.email ? String(r.email) : null,
    avatar: r.avatar ? String(r.avatar) : null,
    active: r.active === true || r.active === 1,
  }));
}

// ── Projects ───────────────────────────────────────────────
async function fetchProjects(apiKey: string, accountsById: Map<number, FloatAccount>): Promise<FloatProject[]> {
  const raw = await paginateAll<Record<string, unknown>>(apiKey, "/projects");
  return raw.map(r => {
    const bt = Number(r.budget_type ?? 0);
    const projectManagerId = r.project_manager ? Number(r.project_manager) : null;
    const owner = projectManagerId != null ? accountsById.get(projectManagerId) ?? null : null;
    return {
      id: Number(r.project_id ?? r.id ?? 0),
      name: String(r.name ?? ""),
      clientName: r.client_name ? String(r.client_name) : null,
      projectCode: r.project_code != null ? String(r.project_code) : null,
      active: r.active === true || r.active === 1,
      tentative: r.tentative === true || r.tentative === 1,
      budgetType: bt || null,
      budgetTotal: r.budget_total != null ? Number(r.budget_total) : null,
      budgetHours: (bt === 3 || bt === 4) && r.budget_total ? Number(r.budget_total) : null,
      startDate: r.start_date ? String(r.start_date) : null,
      endDate: r.end_date ? String(r.end_date) : null,
      projectManagerId,
      projectOwnerName: owner?.name ?? null,
      projectOwnerAvatar: owner?.avatar ?? null,
    };
  });
}

// ── Tasks / Assignments ────────────────────────────────────
async function fetchTasks(
  apiKey: string,
  projectMap: Map<number, string>,
  peopleMap: Map<number, string>
): Promise<{ assignments: FloatAssignment[] }> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in30 = new Date(today); in30.setDate(in30.getDate() + 30);
  const in60 = new Date(today); in60.setDate(in60.getDate() + 60);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const monthStartStr = formatLocalDate(monthStart);
  const monthEndStr = formatLocalDate(monthEnd);
  const todayStr = formatLocalDate(today);
  const in30Str = formatLocalDate(in30);
  const in60Str = formatLocalDate(in60);

  // Try tasks endpoint with date window
  let raw: Record<string, unknown>[] = [];
  const endpoints = [
    `/tasks?start_date=${todayStr}&end_date=${in60Str}`,
    `/tasks?start_day=${todayStr}&end_day=${in60Str}`,
    `/tasks?start_date=${monthStartStr}&end_date=${monthEndStr}`,
    `/tasks?start_day=${monthStartStr}&end_day=${monthEndStr}`,
    `/tasks`,
    `/allocations?start_date=${todayStr}&end_date=${in60Str}`,
  ];

  for (const ep of endpoints) {
    try {
      const r = await paginateAll<Record<string, unknown>>(apiKey, ep);
      if (r.length > 0) {
        console.log(`[FLOAT] Tasks: ${r.length} records from ${ep}`);
        if (r[0]) console.log(`[FLOAT] Task[0] fields: ${Object.keys(r[0]).join(", ")}`);
        raw = r;
        break;
      }
    } catch (e) {
      console.log(`[FLOAT] ${ep} failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  const assignments: FloatAssignment[] = [];
  const taskById = new Map<number, Record<string, unknown>>();

  for (const r of raw) {
    const taskId = Number(r.task_id ?? r.id ?? 0);
    if (taskId <= 0) continue;
    taskById.set(taskId, r);
  }

  for (const r of Array.from(taskById.values())) {
    const projectId = Number(r.project_id ?? 0);
    const personId  = Number(r.people_id ?? r.person_id ?? 0);
    const startStr  = String(r.start_date ?? r.start_day ?? "");
    const endStr    = String(r.end_date ?? r.end_day ?? startStr);
    if (!startStr) continue;

    const rawHours = Number(r.hours ?? r.total_hours ?? r.allocated_hours ?? 0);
    const hours = rawHours > 0 ? rawHours : extractHours(r);

    // Detailed assignment views stay person-based; project-level unassigned work still contributes to project totals above.
    if (personId <= 0 || !peopleMap.has(personId)) continue;

    // Keep recent assignments on a 30d horizon, but using the same prorated-total-hours model.
    const hours30 = prorateHours(startStr, endStr, hours, parseDate(todayStr), parseDate(in30Str));

    assignments.push({
      id: Number(r.task_id ?? r.id ?? 0),
      projectId, personId,
      phaseId: r.phase_id != null ? Number(r.phase_id) : null,
      projectName: projectMap.get(projectId) ?? "N/D",
      personName: peopleMap.get(personId) ?? "N/D",
      startDate: startStr, endDate: endStr,
      startTime: r.start_time != null ? String(r.start_time) : null,
      hoursPerDay: Math.round(extractHours(r) * 100) / 100,
      totalHours: Math.round(hours30 * 100) / 100,
    });
  }
  return { assignments };
}

async function fetchProjectPhaseHours(apiKey: string, projectMap: Map<number, string>): Promise<ProjectPhaseHours[]> {
  const raw = await paginateAll<Record<string, unknown>>(apiKey, "/tasks");
  const byPhase = new Map<string, ProjectPhaseHours>();

  for (const r of raw) {
    const projectId = Number(r.project_id ?? 0);
    const phaseId = Number(r.phase_id ?? 0);
    if (projectId <= 0 || phaseId <= 0) continue;

    const startStr = String(r.start_date ?? r.start_day ?? "");
    const endStr = String(r.end_date ?? r.end_day ?? startStr);
    const rawHours = Number(r.hours ?? r.total_hours ?? r.allocated_hours ?? 0);
    const hours = rawHours > 0 ? rawHours : extractHours(r);
    if (hours <= 0) continue;

    const totalHours = startStr
      ? prorateHours(startStr, endStr, hours, parseDate("1900-01-01"), parseDate("2999-12-31"))
      : hours;
    const key = `${projectId}:${phaseId}`;
    const current = byPhase.get(key) ?? {
      projectId,
      projectName: projectMap.get(projectId) ?? "N/D",
      phaseId,
      totalHours: 0,
    };
    current.totalHours += totalHours;
    byPhase.set(key, current);
  }

  return Array.from(byPhase.values())
    .map(item => ({ ...item, totalHours: Math.round(item.totalHours * 100) / 100 }))
    .sort((a, b) => b.totalHours - a.totalHours);
}

// ── Main float fetch ───────────────────────────────────────
export async function fetchFloatData(creds: FloatCredentials): Promise<FloatData> {
  const out: FloatData = {
    accounts: [], people: [], projects: [], projectHours: [], projectHoursYtd: [], projectPhaseHours: [], recentProjectActivityIds: [], assignments: [],
    recentAssignments: [], error: null, fetchedAt: new Date().toISOString(),
  };

  try {
    const [accounts, people] = await Promise.all([
      fetchAccounts(creds.apiKey),
      fetchPeople(creds.apiKey),
    ]);
    const accountsById = new Map(accounts.map(account => [account.id, account]));
    const projects = await fetchProjects(creds.apiKey, accountsById);
    out.accounts = accounts;
    out.people = people;
    out.projects = projects;
    console.log(`[FLOAT] Accounts: ${accounts.length}, People: ${people.length}, Projects: ${projects.length}`);

    const projectMap = new Map(projects.map(p => [p.id, p.name]));
    const peopleMap  = new Map(people.map(p => [p.id, p.name]));

    const now = new Date();
    const monthStart = formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEnd = formatLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const yearStart = formatLocalDate(new Date(now.getFullYear(), 0, 1));
    const yearEnd = formatLocalDate(new Date(now.getFullYear(), 11, 31));
    const recentStart = formatLocalDate(new Date(now.getFullYear(), now.getMonth() - 2, 1));
    const [{ assignments }, projectHours, projectHoursYtd, projectPhaseHours, recentProjectActivityIds] = await Promise.all([
      fetchTasks(creds.apiKey, projectMap, peopleMap),
      fetchProjectHoursReport(creds.apiKey, monthStart, monthEnd, projects),
      fetchProjectHoursReport(creds.apiKey, yearStart, yearEnd, projects),
      fetchProjectPhaseHours(creds.apiKey, projectMap),
      fetchRecentProjectActivityIds(creds.apiKey, recentStart, monthEnd),
    ]);
    await enrichProjectCodes(creds.apiKey, projects, projectHours.map((p) => p.projectId));
    await enrichProjectPhaseSignals(creds.apiKey, projects, projectHours.map((p) => p.projectId));
    out.assignments = assignments;
    out.projectHours = [...projectHours].sort((a, b) => b.totalHours - a.totalHours);
    out.projectHoursYtd = [...projectHoursYtd].sort((a, b) => b.totalHours - a.totalHours);
    out.projectPhaseHours = projectPhaseHours;
    out.recentProjectActivityIds = recentProjectActivityIds;
    out.recentAssignments = assignments
      .filter(a => a.totalHours > 0)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, 50);

    console.log(`[FLOAT] Assignments: ${assignments.length}, ProjectHours: ${projectHours.length}`);
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    console.error(`[FLOAT] Fatal: ${out.error}`);
  }

  return out;
}

// ── Capacity (30d) ─────────────────────────────────────────
export async function fetchFloatCapacity(creds: FloatCredentials): Promise<FloatCapacity> {
  const out: FloatCapacity = { byPerson: [], totalCurrentMonthHours: 0, total30dHours: 0, error: null };

  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const in30  = new Date(today); in30.setDate(in30.getDate() + 30);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const fmt = (d: Date) => formatLocalDate(d);

    const [accounts, people] = await Promise.all([
      fetchAccounts(creds.apiKey),
      fetchPeople(creds.apiKey),
    ]);
    const projects = await fetchProjects(creds.apiKey, new Map(accounts.map(account => [account.id, account])));
    const projectMap = new Map(projects.map(p => [p.id, p.name]));
    const peopleMap  = new Map(people.map(p => [p.id, p.name]));

    const activePeople = people.filter(x => x.active && x.employeeType !== 3);
    const emptyRangeMap = () => new Map<number, { scheduled: number; projects: Map<string, number>; capacity: number }>(
      activePeople.map((person) => [person.id, { scheduled: 0, projects: new Map(), capacity: 0 }]),
    );

    const buildRange = async (start: Date, end: Date) => {
      let raw: Record<string, unknown>[] = [];
      const endpoints = [
        `/tasks?start_date=${fmt(start)}&end_date=${fmt(end)}`,
        `/tasks?start_day=${fmt(start)}&end_day=${fmt(end)}`,
      ];
      for (const ep of endpoints) {
        try {
          const r = await paginateAll<Record<string, unknown>>(creds.apiKey, ep);
          if (r.length > 0) { raw = r; break; }
        } catch { /* try next */ }
      }

      const byPerson = emptyRangeMap();
      for (const person of activePeople) {
        const entry = byPerson.get(person.id)!;
        entry.capacity = workingDays(start, end) * 8;
      }

      for (const r of raw) {
        const personId  = Number(r.people_id ?? r.person_id ?? 0);
        const projectId = Number(r.project_id ?? 0);
        const startStr  = String(r.start_date ?? r.start_day ?? "");
        const endStr    = String(r.end_date ?? r.end_day ?? startStr);
        if (!startStr || !byPerson.has(personId)) continue;

        const hpd    = extractHours(r);
        const aStart = new Date(startStr); aStart.setHours(0, 0, 0, 0);
        const aEnd   = new Date(endStr);   aEnd.setHours(0, 0, 0, 0);
        const s = new Date(Math.max(aStart.getTime(), start.getTime()));
        const e = new Date(Math.min(aEnd.getTime(), end.getTime()));
        if (s > e) continue;

        const h = workingDays(s, e) * hpd;
        const entry = byPerson.get(personId)!;
        entry.scheduled += h;
        const pName = projectMap.get(projectId) ?? "N/D";
        entry.projects.set(pName, (entry.projects.get(pName) ?? 0) + h);
      }

      return byPerson;
    };

    const [currentMonthMap, next30dMap] = await Promise.all([
      buildRange(monthStart, monthEnd),
      buildRange(today, in30),
    ]);

    let totalCurrentMonth = 0;
    let total30d = 0;
    for (const person of activePeople) {
      const monthEntry = currentMonthMap.get(person.id)!;
      const nextEntry = next30dMap.get(person.id)!;
      totalCurrentMonth += monthEntry.scheduled;
      total30d += nextEntry.scheduled;
      out.byPerson.push({
        personName: peopleMap.get(person.id) ?? `#${person.id}`,
        currentMonth: {
          capacityHours: monthEntry.capacity,
          scheduledHours: Math.round(monthEntry.scheduled * 100) / 100,
          projects: Array.from(monthEntry.projects.entries()).map(([name, hours]) => ({ name, hours })),
        },
        next30d: {
          capacityHours: nextEntry.capacity,
          scheduledHours: Math.round(nextEntry.scheduled * 100) / 100,
          projects: Array.from(nextEntry.projects.entries()).map(([name, hours]) => ({ name, hours })),
        },
      });
    }
    out.totalCurrentMonthHours = Math.round(totalCurrentMonth * 100) / 100;
    out.total30dHours = Math.round(total30d * 100) / 100;
    console.log(`[FLOAT] Capacity: ${out.byPerson.length} people, month=${out.totalCurrentMonthHours}h next30d=${out.total30dHours}h`);
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    console.error(`[FLOAT] Capacity error: ${out.error}`);
  }

  return out;
}
