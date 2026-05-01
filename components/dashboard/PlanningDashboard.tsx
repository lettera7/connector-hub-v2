"use client";
import { useState, useEffect, useCallback } from "react";
import type {
  PlanningData,
  PlanningProject,
  PersonLoad,
  ProjectSuggestion,
  ProjectStatus,
  LoadStatus,
  PlanningAllocationPreview,
} from "@/lib/planning/types";

const STATUS_LABEL: Record<ProjectStatus, string> = { active:"Attivo", tentative:"Tentativo", dormant:"Dormiente", periodic:"Periodico" };
const STATUS_COLOR: Record<ProjectStatus, string> = { active:"bg-emerald-100 text-emerald-800", tentative:"bg-amber-100 text-amber-800", dormant:"bg-slate-100 text-slate-600", periodic:"bg-violet-100 text-violet-800" };
const LOAD_DOT: Record<LoadStatus, string> = { green:"bg-emerald-500", yellow:"bg-amber-400", red:"bg-red-500" };
const LOAD_BADGE: Record<LoadStatus, string> = { green:"bg-emerald-100 text-emerald-800", yellow:"bg-amber-100 text-amber-800", red:"bg-red-100 text-red-800" };
const SEV_BG: Record<string, string> = { critical:"border-red-300 bg-red-50", warning:"border-amber-300 bg-amber-50", info:"border-blue-200 bg-blue-50" };
const SEV_DOT: Record<string, string> = { critical:"bg-red-500", warning:"bg-amber-400", info:"bg-blue-400" };

function fmtDate(s: string | null) { if (!s) return "—"; const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; }
function Badge({ label, color }: { label: string; color: string }) { return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{label}</span>; }
const EUR = (value: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);

function ProjectRow({ project }: { project: PlanningProject }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
      <button className="w-full text-left px-4 py-3 hover:bg-slate-50" onClick={() => setOpen(e => !e)}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={STATUS_LABEL[project.status]} color={STATUS_COLOR[project.status]} />
          <span className="font-medium text-slate-800 text-sm">{project.name}</span>
          {project.clientName && <span className="text-xs text-slate-500">— {project.clientName}</span>}
          <Badge
            label={`Priority ${project.commercialPriority}/100`}
            color={project.commercialLabel === "high" ? "bg-emerald-100 text-emerald-800" : project.commercialLabel === "medium" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}
          />
          <div className="ml-auto flex items-center gap-2">
            {!project.hasOwner && <Badge label="Senza owner" color="bg-red-100 text-red-700" />}
            {!project.hasTeam  && <Badge label="Senza team"  color="bg-orange-100 text-orange-700" />}
            <Badge label={project.budgetAvailability==="no_budget"?"No budget":"Budget ✓"} color={project.budgetAvailability==="no_budget"?"bg-slate-100 text-slate-500":"bg-teal-100 text-teal-700"} />
            <span className="text-slate-400 text-xs">{open?"▲":"▼"}</span>
          </div>
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          {[
            ["Owner", project.projectManagerName ?? "—"],
            ["Team", project.teamNames.length>0 ? project.teamNames.join(", ") : "Nessuno"],
            ["Inizio", fmtDate(project.startDate)],
            ["Fine",   fmtDate(project.endDate)],
            ["Commerciale", `${EUR(project.clientRevenueNet)} net / ${EUR(project.clientPaid)} incassati`],
            ["Incasso", `${project.clientCollectionRatio.toFixed(0)}%`],
            ["Budget", project.budgetAvailability==="no_budget"?"Non impostato":project.budgetAvailability==="budget_per_phase"?`Per fase (${project.phases.length} fasi)`:project.budgetAvailability==="budget_hours"?`${project.budgetValue??'?'} ore`:`${project.budgetValue?.toLocaleString("it-IT")??'?'} €`],
            ["Tag", project.tags.length>0?project.tags.join(", "):"—"],
          ].map(([l,v]) => <div key={l}><span className="text-xs font-medium text-slate-500 uppercase tracking-wide block">{l}</span><span className="text-sm text-slate-800">{v}</span></div>)}
        </div>
      )}
    </div>
  );
}

function PersonCard({ person }: { person: PersonLoad }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
      <button className="w-full text-left px-4 py-3 hover:bg-slate-50" onClick={() => setOpen(e => !e)}>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${LOAD_DOT[person.status]}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-slate-800 text-sm">{person.personName}</span>
              {person.role && <span className="text-xs text-slate-400">{person.role}</span>}
              <Badge label={person.statusReason} color={LOAD_BADGE[person.status]} />
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
              <span>🎯 {person.activeProjectCount} attivi</span>
              <span>🔁 {person.periodicProjectCount} periodici</span>
              <span>👤 {person.ownerProjectCount} owner</span>
              {person.upcomingTimeOff.length>0 && <span className="text-amber-600">🏖 ferie in {person.upcomingTimeOff[0].daysUntil}gg</span>}
            </div>
          </div>
          <span className="text-slate-400 text-xs">{open?"▲":"▼"}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 text-sm space-y-2">
          {person.projectNames.length>0 && <div><span className="text-xs font-medium text-slate-500 uppercase tracking-wide block mb-1">Progetti attivi</span>{person.projectNames.map(n=><div key={n} className="text-slate-700">• {n}</div>)}</div>}
          {person.periodicProjectNames.length>0 && <div><span className="text-xs font-medium text-violet-500 uppercase tracking-wide block mb-1">Periodici</span>{person.periodicProjectNames.map(n=><div key={n} className="text-slate-600">• {n}</div>)}</div>}
          {person.upcomingTimeOff.length>0 && <div><span className="text-xs font-medium text-amber-600 uppercase tracking-wide block mb-1">Ferie / Assenze</span>{person.upcomingTimeOff.map((to,i)=><div key={i} className="text-slate-600">{fmtDate(to.startDate)} → {fmtDate(to.endDate)} (tra {to.daysUntil}gg)</div>)}</div>}
          <div className="text-xs text-slate-500 pt-1 border-t border-slate-200">Frammentazione: <strong>{person.fragmentationLabel} ({person.fragmentationLevel})</strong></div>
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ s }: { s: ProjectSuggestion }) {
  return (
    <div className="border border-slate-200 rounded-lg bg-white p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="font-semibold text-slate-800">{s.projectName}</span>
        {s.clientName && <span className="text-xs text-slate-500">— {s.clientName}</span>}
        <Badge label={s.suggestionBasis} color="bg-blue-100 text-blue-700" />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {s.ownerCandidates.length>0 && (
          <div><span className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1">👤 Candidati Owner</span>
            {s.ownerCandidates.map(c => <div key={c.personId} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
              <div><span className="text-sm font-medium text-slate-800">{c.personName}</span>{c.role&&<span className="text-xs text-slate-400 ml-2">{c.role}</span>}{c.hasUpcomingTimeOff&&<span className="ml-1 text-amber-600 text-xs">🏖</span>}</div>
              <span className="text-xs font-mono text-slate-500 ml-2">{c.score}/100</span>
            </div>)}
          </div>
        )}
        {s.supportCandidates.length>0 && (
          <div><span className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1">🤝 Candidati Supporto</span>
            {s.supportCandidates.map(c => <div key={c.personId} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
              <div><span className="text-sm font-medium text-slate-800">{c.personName}</span>{c.role&&<span className="text-xs text-slate-400 ml-2">{c.role}</span>}</div>
              <span className="text-xs font-mono text-slate-500 ml-2">{c.score}/100</span>
            </div>)}
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400 italic">⚠ Score stimato — basato su conteggio progetti, non su ore</p>
    </div>
  );
}

type Tab = "portfolio"|"resources"|"planning"|"alerts";
const TABS: {id:Tab;label:string}[] = [{id:"portfolio",label:"📋 Portfolio"},{id:"resources",label:"👥 Risorse"},{id:"planning",label:"🎯 Pianificazione"},{id:"alerts",label:"🚨 Allerte"}];

export default function PlanningDashboard() {
  const [data, setData] = useState<PlanningData|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [tab, setTab] = useState<Tab>("planning");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loadFilter, setLoadFilter] = useState<string>("all");
  const [lastRefresh, setLastRefresh] = useState<string|null>(null);
  const [allocationStatuses, setAllocationStatuses] = useState<Record<string, { status: "loading" | "done" | "error"; message: string }>>({});
  const [mappingFloatProjectId, setMappingFloatProjectId] = useState<string>("");
  const [mappingFicClientId, setMappingFicClientId] = useState<string>("");
  const [mappingStatus, setMappingStatus] = useState<{ status: "idle" | "loading" | "done" | "error"; message: string }>({ status: "idle", message: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/planning");
      const json: PlanningData = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json); setLastRefresh(new Date().toLocaleTimeString("it-IT"));
    } catch(e) { setError(e instanceof Error ? e.message : "Errore"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approveAllocation = useCallback(async (preview: PlanningAllocationPreview) => {
    setAllocationStatuses(prev => ({ ...prev, [preview.id]: { status: "loading", message: "Invio a Float..." } }));
    try {
      const res = await fetch("/api/planning/allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          peopleId: preview.personId,
          projectId: preview.projectId,
          phaseId: preview.phaseId,
          startDate: preview.startDate,
          endDate: preview.endDate,
          startTime: preview.startTime,
          endTime: preview.endTime,
          hoursPerDay: preview.hoursPerDay,
          projectName: preview.projectName,
          phaseName: preview.phaseName,
          personName: preview.personName,
          allocationRole: preview.allocationRole,
          basis: preview.basis,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Allocazione non riuscita");
      setAllocationStatuses(prev => ({ ...prev, [preview.id]: { status: "done", message: "Allocata su Float" } }));
      await load();
    } catch (e) {
      setAllocationStatuses(prev => ({ ...prev, [preview.id]: { status: "error", message: e instanceof Error ? e.message : "Errore" } }));
    }
  }, [load]);

  const confirmCommercialMapping = useCallback(async () => {
    if (!data) return;
    const floatProjectId = Number(mappingFloatProjectId);
    const ficClientId = Number(mappingFicClientId);
    const project = data.projects.find(item => item.id === floatProjectId);
    const client = data.ficClients.find(item => item.id === ficClientId);
    if (!project || !client) {
      setMappingStatus({ status: "error", message: "Seleziona progetto Float e cliente FIC." });
      return;
    }
    setMappingStatus({ status: "loading", message: "Salvataggio match..." });
    try {
      const res = await fetch("/api/mappings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          floatProjectId: project.id,
          floatProjectName: project.name,
          ficClientId: client.id,
          ficClientName: client.name,
          mappingSource: "manual",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Match non salvato");
      setMappingStatus({ status: "done", message: "Match confermato." });
      await load();
    } catch (e) {
      setMappingStatus({ status: "error", message: e instanceof Error ? e.message : "Errore" });
    }
  }, [data, load, mappingFicClientId, mappingFloatProjectId]);

  const deleteCommercialMapping = useCallback(async (floatProjectId: number) => {
    setMappingStatus({ status: "loading", message: "Cancellazione match..." });
    try {
      const res = await fetch("/api/mappings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floatProjectId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Match non cancellato");
      setMappingStatus({ status: "done", message: "Match cancellato." });
      await load();
    } catch (e) {
      setMappingStatus({ status: "error", message: e instanceof Error ? e.message : "Errore" });
    }
  }, [load]);

  if (loading) return <div className="flex items-center justify-center py-12 text-slate-400"><span className="animate-spin mr-2">⟳</span>Caricamento dati Float…</div>;
  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700"><strong>Errore planning:</strong> {error} <button onClick={load} className="ml-3 text-sm underline">Riprova</button></div>;
  if (!data) return null;

  const s = data.summary;
  const alertCount = s.criticalAlerts + s.warningAlerts;
  const allocationPreviews = data.allocationPreviews;
  const commercialSignalsWithData = data.commercialSignals.filter(signal =>
    signal.revenueNet > 0 || signal.paid > 0 || signal.due > 0 || signal.invoiceCount > 0 || signal.matchSource !== "none"
  );
  const projectsForMapping = data.projects
    .sort((a, b) => a.name.localeCompare(b.name));
  const ficClientsForMapping = data.ficClients
    .sort((a, b) => b.totalRevenue - a.totalRevenue || a.name.localeCompare(b.name));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-bold text-slate-800">Planning Dashboard</h2><p className="text-xs text-slate-400">Dati nativi Float · Nessuna ricostruzione ore{lastRefresh ? ` · ${lastRefresh}` : ""}</p></div>
        <button onClick={load} className="text-sm text-slate-500 hover:text-slate-800 border border-slate-200 rounded px-3 py-1">↻ Aggiorna</button>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          {label:"Attivi",value:s.activeProjects,color:"text-emerald-600"},
          {label:"Tentativi",value:s.tentativeProjects,color:"text-amber-600"},
          {label:"Dormienti",value:s.dormantProjects,color:"text-slate-500"},
          {label:"Periodici",value:s.periodicProjects,color:"text-violet-600"},
          {label:"🟢 Persone",value:s.greenPeople,color:"text-emerald-600"},
          {label:"⚠ Allerte",value:alertCount,color:alertCount>0?"text-red-600":"text-slate-400"},
        ].map(k=>(
          <div key={k.label} className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-center">
            <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} className={`px-4 py-2 text-sm font-medium transition-colors relative ${tab===t.id?"text-slate-800 border-b-2 border-slate-800":"text-slate-500 hover:text-slate-700"}`}>
            {t.label}
            {t.id==="alerts"&&alertCount>0&&<span className="ml-1 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">{alertCount}</span>}
          </button>
        ))}
      </div>

      {/* Portfolio */}
      {tab==="portfolio" && (
        <div>
          <div className="flex flex-wrap gap-2 mb-4">
            {["all","active","tentative","dormant","periodic"].map(s=>(
              <button key={s} onClick={()=>setStatusFilter(s)} className={`px-3 py-1 rounded-full text-xs font-medium ${statusFilter===s?"bg-slate-800 text-white":"bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {s==="all"?"Tutti":STATUS_LABEL[s as ProjectStatus]} ({s==="all"?data.projects.length:data.projects.filter(p=>p.status===s).length})
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {(statusFilter==="all"?data.projects:data.projects.filter(p=>p.status===statusFilter)).map(p=><ProjectRow key={p.id} project={p} />)}
          </div>
        </div>
      )}

      {/* Resources */}
      {tab==="resources" && (
        <div>
          <div className="flex gap-2 mb-4">
            {["all","green","yellow","red"].map(s=>(
              <button key={s} onClick={()=>setLoadFilter(s)} className={`px-3 py-1 rounded-full text-xs font-medium ${loadFilter===s?"bg-slate-800 text-white":"bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {s==="all"?"Tutti":{green:"🟢",yellow:"🟡",red:"🔴"}[s]} ({s==="all"?data.people.length:data.people.filter(p=>p.status===s).length})
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {(loadFilter==="all"?data.people:data.people.filter(p=>p.status===loadFilter)).map(p=><PersonCard key={p.personId} person={p} />)}
          </div>
          <p className="mt-3 text-xs text-slate-400 italic">⚠ Conteggio basato su assegnazioni project-team Float, non su ore schedulate.</p>
        </div>
      )}

      {/* Planning automation */}
      {tab==="planning" && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-5 text-white shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Automazione pianificazione</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight">Stile Float: ogni risorsa su una riga, 8 settimane di orizzonte e proposta automatica da confermare.</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Il sistema parte dalla prossima settimana, pianifica sulle 8 settimane successive
                  e prepara una proposta phase-level pronta per la conferma con CTA.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  ["08", "Settimane"],
                  [String(data.resourceAvailability.length), "Risorse"],
                  [String(data.proposals.length), "Proposte"],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center">
                    <div className="text-lg font-semibold text-white">{value}</div>
                    <div className="uppercase tracking-[0.2em] text-slate-300">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-400">Allocazione ore residue</p>
                <h4 className="text-base font-semibold text-slate-800">Preview phase-level</h4>
                <p className="mt-1 text-xs text-slate-500">Controlla owner, fase, capacità e frammentazione; la CTA conferma allocazioni su fase Float quando disponibile.</p>
              </div>
              <Badge label={`${allocationPreviews.length} righe`} color="bg-blue-100 text-blue-700" />
            </div>

            {allocationPreviews.length === 0 ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                Nessuna allocazione proposta con i dati correnti.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-slate-400">
                      <th className="border-b border-slate-200 px-3 py-2">Progetto</th>
                      <th className="border-b border-slate-200 px-3 py-2">Risorsa</th>
                      <th className="border-b border-slate-200 px-3 py-2">Settimana</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-right">Residue</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-right">Proposte</th>
                      <th className="border-b border-slate-200 px-3 py-2">Dettaglio</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-right">Azione</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocationPreviews.map(preview => {
                      const state = allocationStatuses[preview.id];
                      return (
                        <tr key={preview.id} className="align-top">
                          <td className="border-b border-slate-100 px-3 py-3">
                            <div className="font-medium text-slate-800">{preview.projectName}</div>
                            <div className="text-xs text-slate-500">{preview.clientName ?? "Cliente non impostato"}</div>
                            <div className="mt-1 text-xs text-slate-600">
                              {preview.phaseId != null ? `Fase: ${preview.phaseName ?? preview.phaseId}` : "Fallback progetto: nessuna fase allocabile"}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <Badge label={preview.hasOwner ? `Owner: ${preview.ownerName ?? "Sì"}` : "No owner"} color={preview.hasOwner ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"} />
                              <Badge label={preview.hasPhases ? `${preview.phaseCount} fasi` : "No fasi"} color={preview.hasPhases ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"} />
                              <Badge label={preview.budgetSource === "fallback" ? "Budget test" : preview.budgetSource === "phases" ? "Budget fasi" : "Budget progetto"} color={preview.budgetSource === "fallback" ? "bg-amber-100 text-amber-800" : "bg-teal-100 text-teal-700"} />
                            </div>
                          </td>
                          <td className="border-b border-slate-100 px-3 py-3">
                            <div className="font-medium text-slate-800">{preview.personName}</div>
                            <Badge
                              label={preview.allocationRole === "owner" ? "Owner" : preview.allocationRole === "team" ? "Team" : "Fallback"}
                              color={preview.allocationRole === "owner" ? "bg-slate-900 text-white" : preview.allocationRole === "team" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-800"}
                            />
                            {preview.teamNames.length > 0 && <div className="mt-1 max-w-[220px] truncate text-xs text-slate-400">Team: {preview.teamNames.join(", ")}</div>}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-3 text-slate-700">
                            <div>{preview.weekLabel}</div>
                            <div className="text-xs text-slate-400">{fmtDate(preview.startDate)} - {fmtDate(preview.endDate)}</div>
                            <div className="text-xs text-slate-500">{preview.startTime.slice(0, 5)} - {preview.endTime.slice(0, 5)}</div>
                          </td>
                          <td className="border-b border-slate-100 px-3 py-3 text-right font-mono text-slate-700">{preview.remainingHours.toFixed(1)}h</td>
                          <td className="border-b border-slate-100 px-3 py-3 text-right font-mono text-slate-900">{preview.proposedHours.toFixed(1)}h</td>
                          <td className="border-b border-slate-100 px-3 py-3 text-xs text-slate-500">
                            <div>{preview.hoursPerDay.toFixed(2)}h/giorno · {preview.basis}</div>
                            <div className="mt-1">
                              Capacità: {preview.alreadyOccupiedHours.toFixed(1)}h + {preview.proposedNewHours.toFixed(1)}h / {preview.theoreticalWeeklyCapacity.toFixed(1)}h · {preview.resultingSaturation.toFixed(1)}%
                            </div>
                            <div className="mt-1">
                              Safe left: {preview.remainingSafeCapacity.toFixed(1)}h · contesti {preview.totalActiveContexts} ({preview.fragmentationState}) · ownership {preview.ownershipCount}
                            </div>
                            <Badge
                              label={preview.guardrailState === "target" ? "<=80%" : preview.guardrailState === "warning" ? "80-85%" : ">85% eccezione"}
                              color={preview.guardrailState === "target" ? "bg-emerald-100 text-emerald-700" : preview.guardrailState === "warning" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}
                            />
                            {state && <div className={state.status === "error" ? "mt-1 text-red-600" : state.status === "done" ? "mt-1 text-emerald-600" : "mt-1 text-slate-500"}>{state.message}</div>}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-3 text-right">
                            <button
                              type="button"
                              disabled={state?.status === "loading" || state?.status === "done"}
                              onClick={() => approveAllocation(preview)}
                              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {state?.status === "loading" ? "Allocazione..." : state?.status === "done" ? "Allocata" : "Approva"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-400">Priorità commerciale</p>
                <h4 className="text-base font-semibold text-slate-800">Mapping FIC ↔ Float e profittabilità cliente</h4>
              </div>
              <span className="text-xs text-slate-400">Top clienti 2026 + budget commessa Float</span>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <label className="text-xs text-slate-500">
                  <span className="mb-1 block font-medium uppercase tracking-wide text-slate-400">Progetto Float</span>
                  <select
                    value={mappingFloatProjectId}
                    onChange={(event) => setMappingFloatProjectId(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="">Seleziona progetto</option>
                    {projectsForMapping.map(project => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  <span className="mb-1 block font-medium uppercase tracking-wide text-slate-400">Cliente / commessa FIC</span>
                  <select
                    value={mappingFicClientId}
                    onChange={(event) => setMappingFicClientId(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="">Seleziona cliente FIC</option>
                    {ficClientsForMapping.map(client => (
                      <option key={client.id} value={client.id}>
                        {client.name} · {EUR(client.totalRevenue)} · {client.invoiceCount} doc.
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={confirmCommercialMapping}
                    disabled={mappingStatus.status === "loading"}
                    className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {mappingStatus.status === "loading" ? "Salvataggio..." : "Conferma match"}
                  </button>
                </div>
              </div>
              {mappingStatus.message && (
                <div className={`mt-2 text-xs ${mappingStatus.status === "error" ? "text-red-600" : mappingStatus.status === "done" ? "text-emerald-600" : "text-slate-500"}`}>
                  {mappingStatus.message}
                </div>
              )}
              {data.mappings.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.mappings.map(mapping => (
                    <span key={mapping.floatProjectId} className="inline-flex items-center gap-2 rounded-full bg-white px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
                      <span>{mapping.floatProjectName} ↔ {mapping.ficClientName}</span>
                      <button
                        type="button"
                        onClick={() => deleteCommercialMapping(mapping.floatProjectId)}
                        disabled={mappingStatus.status === "loading"}
                        className="rounded-full px-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Cancella match ${mapping.floatProjectName}`}
                        title="Cancella match"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {commercialSignalsWithData.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500 md:col-span-2 xl:col-span-4">
                  Nessun dato commerciale affidabile collegato ai progetti Float. La sezione diventa utile solo con mapping FIC ↔ Float o naming coerente tra fatture/clienti e progetti.
                </div>
              ) : commercialSignalsWithData.slice(0, 4).map((signal, index) => (
                <div key={signal.projectId} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">#{index + 1} Priority {signal.score}/100</div>
                      <div className="mt-1 font-semibold text-slate-800">{signal.projectName}</div>
                      <div className="text-xs text-slate-500">{signal.ficClientName ?? signal.clientName ?? "Cliente non mappato"}</div>
                    </div>
                    <Badge label={signal.matchSource} color={signal.matchSource === "mapping" ? "bg-emerald-100 text-emerald-700" : signal.matchSource === "similarity" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"} />
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                    <div className="rounded-lg bg-white px-2 py-2 border border-slate-200">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Cliente</div>
                      <div className="mt-1 font-semibold text-slate-800">{EUR(signal.clientRevenueTotal || signal.revenueNet)}</div>
                    </div>
                    <div className="rounded-lg bg-white px-2 py-2 border border-slate-200">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Budget</div>
                      <div className="mt-1 font-semibold text-slate-800">{signal.clientBudgetTotal > 0 ? `${signal.clientBudgetTotal.toFixed(0)}h` : "—"}</div>
                    </div>
                    <div className="rounded-lg bg-white px-2 py-2 border border-slate-200">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Rev/Budget</div>
                      <div className="mt-1 font-semibold text-slate-800">{signal.revenueToBudgetRatio == null ? "—" : signal.revenueToBudgetRatio.toFixed(1)}</div>
                    </div>
                    <div className="rounded-lg bg-white px-2 py-2 border border-slate-200">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Incasso</div>
                      <div className="mt-1 font-semibold text-slate-800">{signal.collectionRatio.toFixed(0)}%</div>
                    </div>
                  </div>
                  {signal.recentAssignments.length > 0 && (
                    <div className="mt-3 text-xs text-slate-500">
                      Storico: {signal.recentAssignments.slice(0, 2).map(a => a.personName).join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* Alerts */}
      {tab==="alerts" && (
        <div>
          {data.alerts.length===0
            ? <div className="text-center py-8 text-slate-400"><span className="text-3xl block mb-2">🟢</span>Nessuna allerta attiva.</div>
            : (
              <div className="space-y-2">
                {["critical","warning","info"].map(sev => {
                  const group = data.alerts.filter(a=>a.severity===sev);
                  if (!group.length) return null;
                  return (
                    <div key={sev}>
                      <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${sev==="critical"?"text-red-600":sev==="warning"?"text-amber-600":"text-blue-500"}`}>
                        {sev==="critical"?"Critiche":sev==="warning"?"Avvisi":"Info"}
                      </p>
                      {group.map((a,i)=>(
                        <div key={i} className={`flex gap-3 items-start p-3 rounded-lg border mb-1.5 ${SEV_BG[sev]}`}>
                          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${SEV_DOT[sev]}`} />
                          <div><div className="text-sm font-medium text-slate-800">{a.title}</div><div className="text-xs text-slate-600 mt-0.5">{a.detail}</div></div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      )}
    </div>
  );
}
