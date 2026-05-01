import type { FicQuote, FloatProject, ProjectHours, QuoteProjectMapping, Commission, CommissionStatus } from "../dashboard/types";

const INTERNAL = [/^L7\b/i, /^LETTERA7\b/i, /^interno/i];
export function isInternal(name: string): boolean { return INTERNAL.some(p => p.test(name.trim())); }

function norm(s: string): string { return s.trim().toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " "); }
function similarity(a: string, b: string): number {
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  return 0;
}

export function buildCommissions(
  quotes: FicQuote[],
  projects: FloatProject[],
  projectHours: ProjectHours[],
  mappings: QuoteProjectMapping[],
  projectMetrics: Record<number, { scheduledHours: number }>
): Commission[] {
  const mappingByQuote = new Map(mappings.map(m => [m.ficClientId, m]));
  const hoursById = new Map(projectHours.map(ph => [ph.projectId, ph.totalHours]));

  return quotes.map(q => {
    const mapping = mappingByQuote.get(q.clientId ?? -1);
    let project: FloatProject | undefined;
    if (mapping) { project = projects.find(p => p.id === mapping.floatProjectId); }
    if (!project) {
      const best = projects.filter(p => !isInternal(p.name)).find(p => similarity(p.name, q.subject ?? q.clientName) >= 0.8);
      if (best) project = best;
    }

    const monthHours = project ? (hoursById.get(project.id) ?? 0) : 0;
    const scheduled  = project ? (projectMetrics[project.id]?.scheduledHours ?? 0) : 0;
    const budget     = project?.budgetHours ?? 0;

    let status: CommissionStatus = "active";
    if (!project) status = "dormant";
    else if (budget > 0 && scheduled >= budget * 0.9) status = "completed";
    else if (monthHours === 0 && scheduled === 0) status = "closing";

    return {
      id: q.id,
      projectName: project?.name ?? q.subject ?? q.clientName,
      clientName: q.clientName ?? null,
      budget: project?.budgetHours ?? 0,
      invoiced: q.amountNet ?? 0,
      status,
    };
  });
}
