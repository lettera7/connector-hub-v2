/**
 * Float Planning Adapter
 *
 * Bug fix: Float API v3 time-off endpoint is /timeoffs (not /time-off).
 * If even /timeoffs fails, we skip gracefully — time-off is optional.
 *
 * Endpoints used:
 *   /projects        stable ✓
 *   /people          stable ✓
 *   /project-team    optional; some Float tenants return 404
 *   /phases          stable ✓
 *   /timeoffs        stable ✓  (was: /time-off → 404)
 *
 * Team fallback strategy:
 *   1. /project-team
 *   2. /allocations
 *   3. /tasks
 *
 * If project-team is unavailable we reconstruct project/person links from
 * assignment-like endpoints instead of failing the whole planning dashboard.
 */

import type {
  FloatRawProject,
  FloatRawAccount,
  FloatRawPerson,
  FloatRawProjectTeam,
  FloatRawPhase,
  FloatRawTimeOff,
} from "../planning/types";

const BASE = "https://api.float.com/v3";

async function floatGet(apiKey: string, path: string, retries = 3): Promise<unknown[]> {
  const key = apiKey.replace(/^[^a-zA-Z0-9]+/, "");
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, Math.min(2000 * 2 ** attempt, 30_000)));
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Float HTTP ${res.status} on ${path}: ${body.slice(0, 200)}`);
    }
    const j = await res.json();
    return Array.isArray(j) ? j : (j?.data ?? []);
  }
  throw new Error(`Float: too many retries on ${path}`);
}

async function floatPost(apiKey: string, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = apiKey.replace(/^[^a-zA-Z0-9]+/, "");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Float HTTP ${res.status} on ${path}: ${text.slice(0, 200)}`);
  }
  const json = await res.json().catch(() => ({}));
  return typeof json === "object" && json != null ? json as Record<string, unknown> : {};
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

export async function fetchProjects(apiKey: string): Promise<FloatRawProject[]> {
  const raw = await paginateAll<Record<string, unknown>>(apiKey, "/projects");
  return raw.map(r => ({
    project_id: Number(r.project_id ?? r.id ?? 0),
    name: String(r.name ?? ""),
    client_id: r.client_id != null ? Number(r.client_id) : null,
    client_name: r.client_name != null ? String(r.client_name) : null,
    project_code: r.project_code != null ? String(r.project_code) : null,
    active: r.active === true || r.active === 1,
    tentative: r.tentative === true || r.tentative === 1,
    color: r.color != null ? String(r.color) : null,
    tags: Array.isArray(r.tags) ? r.tags.map((t: unknown) =>
      typeof t === "object" && t != null
        ? { tag_id: Number((t as Record<string,unknown>).tag_id ?? 0), name: String((t as Record<string,unknown>).name ?? "") }
        : { tag_id: 0, name: String(t) }
    ) : [],
    start_date: r.start_date != null ? String(r.start_date) : null,
    end_date: r.end_date != null ? String(r.end_date) : null,
    budget_type: r.budget_type != null ? Number(r.budget_type) : null,
    budget_total: r.budget_total != null ? Number(r.budget_total) : null,
    budget_per_phase: r.budget_per_phase === true || r.budget_per_phase === 1,
    project_manager: r.project_manager != null ? Number(r.project_manager) : null,
    non_billable: r.non_billable === true || r.non_billable === 1,
    notes: r.notes != null ? String(r.notes) : null,
  }));
}

export async function fetchPeople(apiKey: string): Promise<FloatRawPerson[]> {
  const raw = await paginateAll<Record<string, unknown>>(apiKey, "/people");
  return raw.map(r => ({
    people_id: Number(r.people_id ?? r.id ?? 0),
    name: String(r.name ?? ""),
    email: r.email != null ? String(r.email) : null,
    job_title: r.job_title != null ? String(r.job_title) : null,
    department: typeof r.department === "object" && r.department != null
      ? { department_id: Number((r.department as Record<string,unknown>).department_id ?? 0), name: String((r.department as Record<string,unknown>).name ?? "") }
      : r.department != null ? String(r.department) : null,
    active: r.active === true || r.active === 1,
    employee_type: (r.employee_type as 1 | 2 | 3) ?? 1,
    avatar_file: r.avatar_file != null ? String(r.avatar_file) : null,
    default_hourly_rate: r.default_hourly_rate != null ? Number(r.default_hourly_rate) : null,
    work_days_hours: r.work_days_hours != null ? (r.work_days_hours as Record<string, number>) : null,
    tags: Array.isArray(r.tags) ? r.tags.map((t: unknown) =>
      typeof t === "object" && t != null
        ? { tag_id: Number((t as Record<string,unknown>).tag_id ?? 0), name: String((t as Record<string,unknown>).name ?? "") }
        : { tag_id: 0, name: String(t) }
    ) : [],
  }));
}

export async function fetchAccounts(apiKey: string): Promise<FloatRawAccount[]> {
  const raw = await paginateAll<Record<string, unknown>>(apiKey, "/accounts");
  return raw.map(r => ({
    account_id: Number(r.account_id ?? r.id ?? 0),
    name: String(r.name ?? ""),
    email: r.email != null ? String(r.email) : null,
    avatar: r.avatar != null ? String(r.avatar) : null,
    active: r.active === true || r.active === 1,
  }));
}

export async function fetchProjectTeam(apiKey: string): Promise<FloatRawProjectTeam[]> {
  const endpointCandidates = ["/project-team", "/allocations", "/tasks"];

  for (const ep of endpointCandidates) {
    try {
      const raw = await paginateAll<Record<string, unknown>>(apiKey, ep);
      const deduped = new Map<string, FloatRawProjectTeam>();

      for (const r of raw) {
        const projectId = Number(r.project_id ?? 0);
        const peopleId = Number(r.people_id ?? r.person_id ?? 0);
        if (!projectId || !peopleId) continue;
        deduped.set(`${projectId}:${peopleId}`, { project_id: projectId, people_id: peopleId });
      }

      const team = Array.from(deduped.values());
      console.log(`[PLANNING] Project team: ${team.length} records from ${ep}`);
      if (team.length > 0 || ep === "/project-team") return team;
    } catch (e) {
      console.log(`[PLANNING] Project team ${ep} failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.warn("[PLANNING] Project team: all endpoints failed, returning empty array");
  return [];
}

export async function fetchPhases(apiKey: string): Promise<FloatRawPhase[]> {
  const raw = await paginateAll<Record<string, unknown>>(apiKey, "/phases");
  return raw.map(r => ({
    phase_id: Number(r.phase_id ?? r.id ?? 0),
    project_id: Number(r.project_id ?? 0),
    name: String(r.name ?? ""),
    start_date: r.start_date != null ? String(r.start_date) : null,
    end_date: r.end_date != null ? String(r.end_date) : null,
    budget: r.budget_total != null ? Number(r.budget_total) : r.budget != null ? Number(r.budget) : null,
    status: r.status != null ? Number(r.status) : null,
  }));
}

export async function fetchUpcomingTimeOff(
  apiKey: string,
  daysAhead = 60
): Promise<FloatRawTimeOff[]> {
  const today = new Date();
  const end = new Date(today); end.setDate(end.getDate() + daysAhead);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  // Float v3 correct endpoint is /timeoffs (not /time-off)
  const endpointCandidates = [
    `/timeoffs?start_date=${fmt(today)}&end_date=${fmt(end)}`,
    `/timeoffs`,
    `/time-off?start_date=${fmt(today)}&end_date=${fmt(end)}`,
    `/time-off`,
  ];

  for (const ep of endpointCandidates) {
    try {
      const raw = await paginateAll<Record<string, unknown>>(apiKey, ep);
      console.log(`[PLANNING] TimeOff: ${raw.length} records from ${ep}`);
      return raw
        .filter(r => r.status !== 2)
        .map(r => ({
          timeoff_id: Number(r.timeoff_id ?? r.id ?? 0),
          people_id: Number(r.people_id ?? 0),
          start_date: String(r.start_date ?? ""),
          end_date: String(r.end_date ?? ""),
          timeoff_type_id: Number(r.timeoff_type_id ?? 0),
          status: Number(r.status ?? 0),
          full_day: r.full_day === true || r.full_day === 1,
        }));
    } catch (e) {
      console.log(`[PLANNING] TimeOff ${ep} failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // All endpoints failed — return empty array (time-off is optional)
  console.warn("[PLANNING] TimeOff: all endpoints failed, returning empty array");
  return [];
}

export interface CreateFloatAllocationInput {
  peopleId: number;
  projectId: number;
  phaseId?: number | null;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  hoursPerDay: number;
  name?: string;
  notes?: string;
}

export async function createFloatAllocation(
  apiKey: string,
  input: CreateFloatAllocationInput,
): Promise<Record<string, unknown>> {
  const startTime = input.startTime ? input.startTime.slice(0, 5) : null;
  const body: Record<string, unknown> = {
    people_id: input.peopleId,
    project_id: input.projectId,
    start_date: input.startDate,
    end_date: input.endDate,
    hours: input.hoursPerDay,
    name: input.name ?? "Planning approvato",
    notes: input.notes ?? "Allocazione creata da Connector Hub",
  };
  if (startTime) body.start_time = startTime;
  if (input.phaseId != null) body.phase_id = input.phaseId;
  return floatPost(apiKey, "/tasks", body);
}
