"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import type { DashboardData, FloatProject, FloatPersonCapacity, Commission, QuoteProjectMapping, ProjectHours } from "@/lib/dashboard/types";
import { buildCommissions, isInternal } from "@/lib/commissions/commission-logic";
import PlanningDashboard from "@/components/dashboard/PlanningDashboard";

const EUR = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const HOURS = (n: number) => `${new Intl.NumberFormat("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(n)}h`;
const YEAR = new Date().getFullYear();
const CAP_30D = 160;

type MainTab = "studio" | "planning";

type ResourceViewItem = {
  personName: string;
  monthSaturation: number;
  next30dSaturation: number;
  fragmentation: number;
  totalClientHours: number;
  totalInternalHours: number;
  currentMonthScheduledHours: number;
  currentMonthCapacityHours: number;
  next30dScheduledHours: number;
  next30dCapacityHours: number;
  activeProjects: Array<{ name: string; hours: number; internal: boolean }>;
  ownerProjectCount: number;
  ownerCategories: { client: number; periodic: number; consulting: number; spot: number; internal: number };
  vacationVerdict: "yes" | "caution" | "no";
};

type OwnerPortfolioItem = {
  ownerId: number | null;
  ownerName: string;
  ownerAvatar: string | null;
  totalHours: number;
  projectCount: number;
  categories: { client: number; periodic: number; consulting: number; spot: number; internal: number };
  projects: Array<{ projectId: number; projectName: string; projectCode: string | null; startDate: string | null; isLegacy: boolean; kind: "client" | "periodic" | "consulting" | "internal" | "spot" | "unknown" }>;
};

function classifyProjectByCode(projectCode: string | null): "client" | "periodic" | "consulting" | "internal" | "spot" | "unknown" {
  const code = (projectCode ?? "").trim().toUpperCase();
  if (!code) return "unknown";
  const prefix = code.split("-")[0];
  if (prefix === "INT") return "internal";
  if (prefix === "PER") return "periodic";
  if (prefix === "CON") return "consulting";
  if (prefix === "SPOT") return "spot";
  if (prefix === "CL" || prefix === "SPOT" || prefix === "TMP") return "client";
  return "unknown";
}

function AlertsSection({ resourceView, classifiedProjects, studioStatus, capacityError }: {
  resourceView: ResourceViewItem[]; classifiedProjects: { active: ProjectHours[]; closing: ProjectHours[]; dormant: string[] };
  studioStatus: string; activePeople: number; capacityError: string | null;
}) {
  const alerts: { type: "red"|"amber"|"green"; text: string }[] = [];
  if (capacityError) alerts.push({ type:"red", text:`Errore capacità Float: ${capacityError}` });
  const sat = resourceView.filter(r => r.next30dSaturation > 90);
  if (sat.length) alerts.push({ type:"red", text:`${sat.length} risorse sopra 90%: ${sat.map(r=>r.personName).join(", ")}` });
  const frag = resourceView.filter(r => r.fragmentation > 5);
  if (frag.length) alerts.push({ type:"amber", text:`Alta frammentazione (>5 proj): ${frag.map(r=>`${r.personName}(${r.fragmentation})`).join(", ")}` });
  if (classifiedProjects.closing.length > 3) alerts.push({ type:"amber", text:`${classifiedProjects.closing.length} commesse in chiusura` });
  const under = resourceView.filter(r => r.next30dSaturation < 30 && r.totalClientHours === 0);
  if (under.length) alerts.push({ type:"green", text:`${under.length} risorse disponibili: ${under.map(r=>r.personName).join(", ")}` });
  if (classifiedProjects.dormant.length > 0) alerts.push({ type:"amber", text:`${classifiedProjects.dormant.length} commesse dormienti: ${classifiedProjects.dormant.slice(0,3).join(", ")}${classifiedProjects.dormant.length>3?"…":""}` });

  if (!alerts.length) return <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-center text-slate-500 text-sm">✅ Nessuna allerta attiva</div>;
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => (
        <div key={i} className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${a.type==="red"?"border-red-800/50 bg-red-950/30 text-red-300":a.type==="amber"?"border-amber-800/50 bg-amber-950/30 text-amber-300":"border-emerald-800/50 bg-emerald-950/30 text-emerald-400"}`}>
          <span className="mt-0.5 flex-shrink-0">{a.type==="red"?"🔴":a.type==="amber"?"🟡":"🟢"}</span>
          {a.text}
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const initialFetchStarted = useRef(false);
  const [data, setData]           = useState<DashboardData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [mappings, setMappings]   = useState<QuoteProjectMapping[]>([]);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [targets, setTargets]     = useState<{ annualTarget: number; monthlyTarget: number } | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [mainTab, setMainTab]     = useState<MainTab>("studio");
  const [editingTargets, setEditingTargets] = useState(false);
  const [targetForm, setTargetForm] = useState({ annualTarget: "" });
  const [targetsSaving, setTargetsSaving] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [ownerModalKey, setOwnerModalKey] = useState<string | null>(null);
  const [resourceModalName, setResourceModalName] = useState<string | null>(null);

  const fetchAll = useCallback(async (forceRefresh = false) => {
    setLoading(true); setError(null);
    try {
      const dashboardUrl = forceRefresh ? "/api/dashboard?refresh=1" : "/api/dashboard";
      const [dRes, cRes, tRes] = await Promise.all([fetch(dashboardUrl), fetch("/api/commissions"), fetch("/api/targets")]);
      const dj = await dRes.json();
      if (!dj.ok) { setError(dj.error); if (dRes.status === 400) setTimeout(() => router.push("/"), 2000); return; }
      setData(dj.data);
      const cj = await cRes.json(); if (cj.ok) { setMappings(cj.data ?? []); setDismissed(cj.dismissed ?? []); }
      const tj = await tRes.json(); if (tj.ok) setTargets(tj.data);
    } catch { setError("Errore di rete — riprova"); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => {
    if (initialFetchStarted.current) return;
    initialFetchStarted.current = true;
    fetchAll();
  }, [fetchAll]);
  useEffect(() => {
    if (!targets) return;
    setTargetForm({
      annualTarget: String(targets.annualTarget ?? 0),
    });
  }, [targets]);

  const saveTargets = useCallback(async () => {
    setTargetsSaving(true);
    setTargetsError(null);
    try {
      const res = await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annualTarget: Number(targetForm.annualTarget || 0),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setTargetsError(json.error ?? "Salvataggio non riuscito");
        return;
      }
      setTargets(json.data);
      setEditingTargets(false);
    } catch {
      setTargetsError("Errore di rete durante il salvataggio");
    } finally {
      setTargetsSaving(false);
    }
  }, [targetForm]);

  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);
  const allQuotes = useMemo(() => (data?.fic?.quotes ?? []).filter(q => !dismissedSet.has(q.id)), [data, dismissedSet]);
  const commissions = useMemo(() => {
    if (!data) return [] as Commission[];
    return buildCommissions(allQuotes, data.float.projects, data.float.projectHours, mappings, data.projectMetrics ?? {});
  }, [data, allQuotes, mappings]);

  const activePeople = useMemo(() => data?.float.people.filter(p => p.active).length ?? 0, [data]);

  const portfolio = useMemo(() => {
    if (!data) return { client: [] as ProjectHours[], periodic: [] as ProjectHours[], consulting: [] as ProjectHours[], spot: [] as ProjectHours[], internal: [] as ProjectHours[] };
    const client: ProjectHours[] = [];
    const periodic: ProjectHours[] = [];
    const consulting: ProjectHours[] = [];
    const spot: ProjectHours[] = [];
    const internal: ProjectHours[] = [];
    const projectById = new Map(data.float.projects.map((p) => [p.id, p]));

    for (const ph of data.float.projectHours) {
      const project = projectById.get(ph.projectId);
      const kind = classifyProjectByCode(project?.projectCode ?? null);
      if (kind === "internal" || isInternal(ph.projectName)) internal.push(ph);
      else if (kind === "spot") spot.push(ph);
      else if (kind === "consulting") consulting.push(ph);
      else if (kind === "periodic") periodic.push(ph);
      else client.push(ph);
    }

    const sortDesc = (items: ProjectHours[]) => [...items].sort((a, b) => b.totalHours - a.totalHours);
    return { client: sortDesc(client), periodic: sortDesc(periodic), consulting: sortDesc(consulting), spot: sortDesc(spot), internal: sortDesc(internal) };
  }, [data]);

  const classifiedProjects = useMemo(() => {
    if (!data) return { active:[] as ProjectHours[], closing:[] as ProjectHours[], dormant:[] as string[] };
    const futureIds = new Set<number>();
    for (const p of data.capacity?.byPerson ?? []) {
      for (const pr of p.next30d.projects) {
        const proj = data.float.projects.find((fp: FloatProject) => fp.name === pr.name);
        if (proj) futureIds.add(proj.id);
      }
    }
    const active: ProjectHours[] = [], closing: ProjectHours[] = [];
    for (const ph of portfolio.client) { if (futureIds.has(ph.projectId)) active.push(ph); else closing.push(ph); }
    const monthIds = new Set(data.float.projectHours.map((ph: ProjectHours) => ph.projectId));
    const dormant = data.float.projects.filter((p: FloatProject) => p.active && !p.tentative && !isInternal(p.name) && !monthIds.has(p.id)).map((p: FloatProject) => p.name);
    return { active, closing, dormant };
  }, [data, portfolio]);

  const resourceView = useMemo((): ResourceViewItem[] => {
    if (!data) return [];
    const monthlyOwnerSummary = new Map<string, { projectCount: number; categories: { client: number; periodic: number; consulting: number; spot: number; internal: number } }>();
    const monthlyProjectById = new Map(data.float.projectHours.map((project) => [project.projectId, project]));
    for (const project of data.float.projects) {
      if (!monthlyProjectById.has(project.id)) continue;
      const ownerName = project.projectOwnerName?.trim();
      if (!ownerName) continue;
      const key = `${project.projectManagerId ?? "na"}:${ownerName.toLowerCase()}`;
      if (!monthlyOwnerSummary.has(key)) {
        monthlyOwnerSummary.set(key, {
          projectCount: 0,
          categories: { client: 0, periodic: 0, consulting: 0, spot: 0, internal: 0 },
        });
      }
      const summary = monthlyOwnerSummary.get(key)!;
      summary.projectCount += 1;
      const kind = classifyProjectByCode(project.projectCode);
      if (kind === "periodic") summary.categories.periodic += 1;
      else if (kind === "consulting") summary.categories.consulting += 1;
      else if (kind === "spot") summary.categories.spot += 1;
      else if (kind === "internal") summary.categories.internal += 1;
      else summary.categories.client += 1;
    }
    const peopleByName = new Map(data.float.people.map((person) => [person.name.trim().toLowerCase(), person]));
    const accountsByEmail = new Map(
      data.float.accounts
        .filter((account) => account.email)
        .map((account) => [String(account.email).trim().toLowerCase(), account]),
    );
    return (data.capacity?.byPerson ?? []).map((cap: FloatPersonCapacity) => {
      const person = peopleByName.get(cap.personName.trim().toLowerCase());
      const account = person?.email ? accountsByEmail.get(person.email.trim().toLowerCase()) : null;
      const ownerSummary = account ? monthlyOwnerSummary.get(`${account.id}:${cap.personName.trim().toLowerCase()}`) ?? null : null;
      let tClient = 0, tInternal = 0, clientProjects = 0;
      for (const { name, hours } of cap.currentMonth.projects) {
        if (isInternal(name)) tInternal += hours;
        else { tClient += hours; clientProjects++; }
      }
      const activeProjects = cap.currentMonth.projects
        .map(({ name, hours }) => ({ name, hours, internal: isInternal(name) }))
        .sort((a, b) => b.hours - a.hours);
      const monthSat = cap.currentMonth.capacityHours > 0 ? Math.round((cap.currentMonth.scheduledHours / cap.currentMonth.capacityHours) * 100) : 0;
      const next30dSat = cap.next30d.capacityHours > 0 ? Math.round((cap.next30d.scheduledHours / cap.next30d.capacityHours) * 100) : 0;
      const verd: ResourceViewItem["vacationVerdict"] = next30dSat > 80 || clientProjects > 4 ? "no" : next30dSat >= 50 || clientProjects > 2 ? "caution" : "yes";
      return {
        personName: cap.personName,
        monthSaturation: monthSat,
        next30dSaturation: next30dSat,
        fragmentation: clientProjects,
        totalClientHours: tClient,
        totalInternalHours: tInternal,
        currentMonthScheduledHours: cap.currentMonth.scheduledHours,
        currentMonthCapacityHours: cap.currentMonth.capacityHours,
        next30dScheduledHours: cap.next30d.scheduledHours,
        next30dCapacityHours: cap.next30d.capacityHours,
        activeProjects,
        ownerProjectCount: ownerSummary?.projectCount ?? 0,
        ownerCategories: ownerSummary?.categories ?? { client: 0, periodic: 0, consulting: 0, spot: 0, internal: 0 },
        vacationVerdict: verd,
      };
    }).sort((a, b) => b.next30dSaturation - a.next30dSaturation);
  }, [data]);

  const ownerPortfolio = useMemo((): { owners: OwnerPortfolioItem[]; unassigned: ProjectHours[] } => {
    if (!data) return { owners: [], unassigned: [] };

    const grouped = new Map<string, OwnerPortfolioItem>();
    const unassigned: ProjectHours[] = [];
    const projectById = new Map(data.float.projects.map((project) => [project.id, project]));

    for (const ph of data.float.projectHours) {
      const project = projectById.get(ph.projectId);
      const kind = classifyProjectByCode(project?.projectCode ?? null);
      const ownerName = project?.projectOwnerName?.trim() || "";
      if (!ownerName) {
        unassigned.push(ph);
        continue;
      }

      const key = `${project?.projectManagerId ?? "na"}:${ownerName}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          ownerId: project?.projectManagerId ?? null,
          ownerName,
          ownerAvatar: project?.projectOwnerAvatar ?? null,
          totalHours: 0,
          projectCount: 0,
          categories: { client: 0, periodic: 0, consulting: 0, spot: 0, internal: 0 },
          projects: [],
        });
      }

      const entry = grouped.get(key)!;
      entry.totalHours += ph.totalHours;
      entry.projectCount += 1;
      if (kind === "periodic") entry.categories.periodic += 1;
      else if (kind === "consulting") entry.categories.consulting += 1;
      else if (kind === "spot") entry.categories.spot += 1;
      else if (kind === "internal") entry.categories.internal += 1;
      else entry.categories.client += 1;
      const startYear = project?.startDate ? Number(project.startDate.slice(0, 4)) : null;
      entry.projects.push({
        projectId: ph.projectId,
        projectName: ph.projectName,
        projectCode: project?.projectCode ?? null,
        startDate: project?.startDate ?? null,
        isLegacy: startYear === YEAR - 1,
        kind,
      });
    }

    const owners = Array.from(grouped.values())
      .map((entry) => ({
        ...entry,
        totalHours: Math.round(entry.totalHours * 100) / 100,
        projects: [...entry.projects].sort((a, b) => a.projectName.localeCompare(b.projectName)),
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    return { owners, unassigned: [...unassigned].sort((a, b) => b.totalHours - a.totalHours) };
  }, [data]);

  const selectedOwnerPortfolio = useMemo(() => {
    if (!ownerModalKey) return null;
    return ownerPortfolio.owners.find((owner) => `${owner.ownerId ?? "na"}:${owner.ownerName}` === ownerModalKey) ?? null;
  }, [ownerModalKey, ownerPortfolio]);

  const selectedResourceView = useMemo(() => {
    if (!resourceModalName) return null;
    return resourceView.find((resource) => resource.personName === resourceModalName) ?? null;
  }, [resourceModalName, resourceView]);

  const studioSat = activePeople > 0 && data?.capacity ? Math.round((data.capacity.total30dHours / (activePeople * CAP_30D)) * 100) : 0;
  const studioStatus = studioSat > 85 ? "red" : studioSat > 60 ? "yellow" : "green";
  const targetMetrics = useMemo(() => {
    if (!targets || !data) return null;
    const annualTarget = targets.annualTarget ?? 0;
    const annualActual = data.fic.annualRevenueNet ?? 0;
    const monthlyActual = data.fic.monthlyRevenueNet ?? 0;
    const monthIndex = new Date().getMonth() + 1;
    const monthlyBaseTarget = annualTarget > 0 ? annualTarget / 12 : 0;
    const actualBeforeCurrentMonth = Math.max(0, annualActual - monthlyActual);
    const expectedBeforeCurrentMonth = monthlyBaseTarget * Math.max(0, monthIndex - 1);
    const backlogBeforeCurrentMonth = Math.max(0, expectedBeforeCurrentMonth - actualBeforeCurrentMonth);
    const monthlyRecoveryTarget = monthlyBaseTarget + backlogBeforeCurrentMonth;
    const expectedYearToDate = monthlyBaseTarget * monthIndex;
    const annualGap = Math.max(0, annualTarget - annualActual);
    const monthlyGap = Math.max(0, monthlyBaseTarget - monthlyActual);
    const ytdGap = Math.max(0, expectedYearToDate - annualActual);
    return {
      annualTarget,
      annualActual,
      annualGap,
      monthlyBaseTarget,
      monthlyActual,
      monthlyGap,
      monthIndex,
      expectedYearToDate,
      ytdGap,
      backlogBeforeCurrentMonth,
      monthlyRecoveryTarget,
      monthlyRecoveryGap: Math.max(0, monthlyRecoveryTarget - monthlyActual),
    };
  }, [targets, data]);

  if (error) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="rounded-xl border border-red-800 bg-red-950/40 p-6 max-w-sm text-center">
        <p className="text-red-300 mb-4">{error}</p>
        <button onClick={() => fetchAll(true)} className="text-sm text-slate-400 underline">Riprova</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Connector Hub</h1>
            <p className="text-xs text-slate-500 mt-0.5">{loading?"Caricamento…":data?.fetchedAt?`Aggiornato ${new Date(data.fetchedAt).toLocaleString("it-IT")}`:""}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowDebug(v => !v)} className="text-xs text-slate-600 border border-slate-800 rounded px-2 py-1">{showDebug?"Nascondi":"Debug"}</button>
            <button
              onClick={() => fetchAll(true)}
              disabled={loading}
              title="Forza il re-fetch dei dati da Fatture in Cloud e Float"
              className="text-xs text-slate-300 hover:text-slate-100 border border-slate-700 rounded px-3 py-1.5 disabled:opacity-50"
            >
              {loading ? "⟳ Refresh dati…" : "↻ Aggiorna da FIC + Float"}
            </button>
          </div>
        </div>

        {/* Main tabs */}
        <div className="flex border-b border-slate-800">
          {([{id:"studio" as const,label:"📊 Studio"},{id:"planning" as const,label:"🎯 Planning"}]).map(tab => (
            <button key={tab.id} onClick={() => setMainTab(tab.id)} className={`px-5 py-2.5 text-sm font-medium transition-colors ${mainTab===tab.id?"text-slate-100 border-b-2 border-slate-100":"text-slate-500 hover:text-slate-300"}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ═══ STUDIO TAB ═══ */}
        {mainTab === "studio" && (
          <div className="space-y-6">
            {loading && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-pulse">{Array.from({length:8}).map((_,i)=><div key={i} className="rounded-xl border border-slate-800 bg-slate-900/40 h-20"/>)}</div>}

            {/* FIC KPIs */}
            {!loading && data && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Fatturato {YEAR}</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    {label:"Imponibile YTD", value:EUR(data.fic.annualRevenueNet ?? 0), color:"text-sky-400"},
                    {label:"Lordo YTD",       value:EUR(data.fic.annualRevenue ?? 0),    color:"text-emerald-400"},
                    {label:"Incassato",       value:EUR(data.fic.annualPaid ?? 0),        color:"text-emerald-400"},
                    {label:"Da incassare",    value:EUR(data.fic.annualDue ?? 0),         color:"text-amber-400"},
                  ].map(k => (
                    <div key={k.label} className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{k.label}</p>
                      <p className={`text-xl font-bold font-mono ${k.color}`}>{k.value}</p>
                    </div>
                  ))}
                </div>
                {data.fic.allInvoices.length > 0 && (
                  <p className="mt-1 text-[10px] text-slate-600">
                    {data.fic.allInvoices.length} documenti totali caricati · mese corrente lordo: {EUR(data.fic.monthlyRevenue ?? 0)} · imponibile: {EUR(data.fic.monthlyRevenueNet ?? 0)}
                  </p>
                )}
                {data.fic.error && <p className="mt-1 text-xs text-red-400">⚠ FIC: {data.fic.error}</p>}
              </section>
            )}

            {/* Targets */}
            {!loading && targets && data && (
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Obiettivi</h3>
                  <button
                    onClick={() => {
                      setTargetsError(null);
                      setEditingTargets(v => !v);
                    }}
                    className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-100"
                  >
                    {editingTargets ? "Chiudi" : "Modifica"}
                  </button>
                </div>
                {editingTargets && (
                  <div className="mb-3 rounded-xl border border-slate-800 bg-slate-900/30 p-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="block text-[10px] uppercase tracking-wider text-slate-500">Target annuale {YEAR}</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={targetForm.annualTarget}
                          onChange={(e) => setTargetForm((prev) => ({ ...prev, annualTarget: e.target.value }))}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
                        />
                      </label>
                      <div className="space-y-1">
                        <span className="block text-[10px] uppercase tracking-wider text-slate-500">Target mensile derivato</span>
                        <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                          {Number(targetForm.annualTarget || 0) > 0 ? EUR(Number(targetForm.annualTarget || 0) / 12) : "—"}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        onClick={saveTargets}
                        disabled={targetsSaving}
                        className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                      >
                        {targetsSaving ? "Salvataggio..." : "Salva"}
                      </button>
                      <button
                        onClick={() => {
                          setTargetsError(null);
                          setEditingTargets(false);
                          setTargetForm({
                            annualTarget: String(targets.annualTarget ?? 0),
                          });
                        }}
                        className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
                      >
                        Annulla
                      </button>
                      {targetsError && <p className="text-xs text-red-400">{targetsError}</p>}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    {label:`Target annuale ${YEAR}`, actual:data.fic.annualRevenueNet??0, target:targets.annualTarget},
                    {label:"Target mensile",          actual:data.fic.monthlyRevenueNet??0, target:targetMetrics?.monthlyBaseTarget ?? 0},
                  ].map(t => {
                    const pct = t.target > 0 ? Math.round((t.actual / t.target) * 100) : 0;
                    return (
                      <div key={t.label} className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{t.label}</p>
                        <div className="flex items-baseline justify-between text-sm mb-2">
                          <span className="font-mono text-slate-200">{EUR(t.actual)}</span>
                          <span className="text-slate-500">/ {t.target>0?EUR(t.target):"—"}</span>
                          <span className={`font-mono font-bold ${pct>=100?"text-emerald-400":pct>=60?"text-sky-400":"text-amber-400"}`}>{t.target>0?`${pct}%`:"—"}</span>
                        </div>
                        {t.target > 0 && <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden"><div className={`h-full rounded-full ${pct>=100?"bg-emerald-500":pct>=60?"bg-sky-500":"bg-amber-500"}`} style={{width:`${Math.min(pct,100)}%`}}/></div>}
                      </div>
                    );
                  })}
                </div>
                {targetMetrics && (
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {[
                      {
                        label: "Mancano al target mensile",
                        value: targetMetrics.monthlyGap,
                        tone: targetMetrics.monthlyGap > 0 ? "text-amber-400" : "text-emerald-400",
                        note: targetMetrics.monthlyGap > 0 ? `Base mese: ${EUR(targetMetrics.monthlyBaseTarget)}` : "Target mensile raggiunto",
                      },
                      {
                        label: "Mancano al target annuale",
                        value: targetMetrics.annualGap,
                        tone: targetMetrics.annualGap > 0 ? "text-amber-400" : "text-emerald-400",
                        note: targetMetrics.annualGap > 0 ? `YTD: ${EUR(targetMetrics.annualActual)}` : "Target annuale raggiunto",
                      },
                      {
                        label: "Recupero mesi precedenti",
                        value: targetMetrics.backlogBeforeCurrentMonth,
                        tone: targetMetrics.backlogBeforeCurrentMonth > 0 ? "text-red-400" : "text-emerald-400",
                        note: targetMetrics.backlogBeforeCurrentMonth > 0 ? `Mesi chiusi attesi: ${EUR(targetMetrics.expectedYearToDate - targetMetrics.monthlyBaseTarget)}` : "Sei in linea sui mesi chiusi",
                      },
                      {
                        label: "Da fatturare questo mese per rientrare",
                        value: targetMetrics.monthlyRecoveryGap,
                        tone: targetMetrics.monthlyRecoveryGap > 0 ? "text-sky-400" : "text-emerald-400",
                        note: targetMetrics.monthlyRecoveryGap > 0 ? `Target mese con recupero: ${EUR(targetMetrics.monthlyRecoveryTarget)}` : "Hai gia recuperato il ritardo",
                      },
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{item.label}</p>
                        <p className={`text-lg font-bold font-mono ${item.tone}`}>{EUR(item.value)}</p>
                        <p className="mt-1 text-[10px] text-slate-500">{item.note}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {!loading && data && (
              <section className="space-y-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Studio operativo</h3>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${studioStatus==="red"?"bg-red-950/60 text-red-400":studioStatus==="yellow"?"bg-amber-950/60 text-amber-400":"bg-emerald-950/60 text-emerald-400"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${studioStatus==="red"?"bg-red-500":studioStatus==="yellow"?"bg-amber-400":"bg-emerald-500"}`}/>
                        {studioStatus==="red"?"Saturo":studioStatus==="yellow"?"In pressione":"Bilanciato"}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-600">Portfolio mese da report progetti Float · owner nativo da accounts</p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                    {[
                      {label:"Progetti mese", val:data.float.projectHours.length, color:"text-slate-100", note:"Dato reale"},
                      {label:"Owner attivi", val:ownerPortfolio.owners.length, color:"text-sky-400", note:"Dato reale"},
                      {label:"Senza owner", val:ownerPortfolio.unassigned.length, color:ownerPortfolio.unassigned.length>0?"text-amber-400":"text-emerald-400", note:"Dato reale"},
                      {label:"In chiusura", val:classifiedProjects.closing.length, color:"text-amber-400", note:"Segnale ricostruito"},
                      {label:"Dormienti", val:classifiedProjects.dormant.length, color:"text-slate-500", note:"Segnale ricostruito"},
                      {label:"Sat. 30gg", val:`${studioSat}%`, color:studioSat>85?"text-red-400":studioSat>60?"text-amber-400":"text-emerald-400", note:"Stimata"},
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
                        <p className={`mt-1 font-mono font-bold text-lg ${item.color}`}>{item.val}</p>
                        <p className="mt-1 text-[10px] text-slate-600">{item.note}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Segnali operativi</p>
                    <AlertsSection resourceView={resourceView} classifiedProjects={classifiedProjects} studioStatus={studioStatus} activePeople={activePeople} capacityError={data?.capacity?.error??null}/>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Portfolio mese per owner</h4>
                      <p className="mt-1 text-[10px] text-slate-600">{ownerPortfolio.owners.length} owner con progetti nel mese · focus su numero progetti e tipologia</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-[10px] ${ownerPortfolio.unassigned.length > 0 ? "text-amber-400" : "text-slate-600"}`}>
                        {ownerPortfolio.unassigned.length > 0
                          ? `${ownerPortfolio.unassigned.length} progetto/i mese senza owner`
                          : "Tutti i progetti del mese hanno un owner assegnato"}
                      </p>
                      {ownerPortfolio.unassigned.length > 0 && (
                        <p className="mt-1 text-[10px] text-slate-600">
                          {ownerPortfolio.unassigned.map((project) => project.projectName).join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {ownerPortfolio.owners.map((owner) => (
                      <div key={`${owner.ownerId ?? "na"}-${owner.ownerName}`} className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
                        <div className="flex items-center gap-3">
                          {owner.ownerAvatar ? (
                            <img src={owner.ownerAvatar} alt={owner.ownerName} className="h-10 w-10 rounded-full border border-slate-700 object-cover" />
                          ) : (
                            <div className="h-10 w-10 rounded-full border border-slate-700 bg-slate-800 flex items-center justify-center text-xs text-slate-400">
                              {owner.ownerName.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-100 truncate">{owner.ownerName}</p>
                            <button
                              type="button"
                              onClick={() => setOwnerModalKey(`${owner.ownerId ?? "na"}:${owner.ownerName}`)}
                              className="mt-1 inline-flex items-center rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:text-slate-100"
                            >
                              {owner.projectCount} commesse
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Commesse</p>
                            <p className="mt-1 font-mono text-base text-slate-200">{owner.categories.client}</p>
                          </div>
                          <div className="rounded-lg border border-violet-900/40 bg-violet-950/10 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-violet-300">Periodici</p>
                            <p className="mt-1 font-mono text-base text-violet-200">{owner.categories.periodic}</p>
                          </div>
                          <div className="rounded-lg border border-sky-900/40 bg-sky-950/10 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-sky-300">Consulenza</p>
                            <p className="mt-1 font-mono text-base text-sky-200">{owner.categories.consulting}</p>
                          </div>
                          <div className="rounded-lg border border-amber-900/40 bg-amber-950/10 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-amber-300">Spot</p>
                            <p className="mt-1 font-mono text-base text-amber-200">{owner.categories.spot}</p>
                          </div>
                        </div>

                        {owner.categories.internal > 0 && (
                          <p className="mt-3 text-[10px] text-emerald-300">Interni: {owner.categories.internal}</p>
                        )}
                      </div>
                    ))}
                    {ownerPortfolio.owners.length === 0 && <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 px-4 py-3 text-xs text-slate-600">Nessun owner con portfolio nel mese corrente.</div>}
                  </div>
                </div>
              </section>
            )}

            {selectedOwnerPortfolio && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
                <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
                  <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-slate-100">{selectedOwnerPortfolio.ownerName}</h4>
                      <p className="mt-1 text-xs text-slate-500">{selectedOwnerPortfolio.projectCount} progetti gestiti nel mese corrente</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOwnerModalKey(null)}
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-100"
                    >
                      Chiudi
                    </button>
                  </div>
                  <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
                    <div className="space-y-2">
                      {selectedOwnerPortfolio.projects.map((project) => (
                        <div key={project.projectId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/40 px-4 py-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm text-slate-200">{project.projectName}</p>
                              {project.isLegacy && (
                                <span className="rounded-full border border-amber-800/60 px-2 py-0.5 text-[10px] text-amber-300">
                                  Avviato nel {YEAR - 1}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-[10px] text-slate-500">
                              {(project.projectCode ?? "Codice mancante")}{project.startDate ? ` · start ${project.startDate}` : ""}
                            </p>
                          </div>
                          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300">
                            {project.kind === "periodic" ? "PER" : project.kind === "consulting" ? "CON" : project.kind === "spot" ? "SPOT" : project.kind === "internal" ? "INT" : "CL/TMP"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {selectedResourceView && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
                <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
                  <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-slate-100">{selectedResourceView.personName}</h4>
                      <p className="mt-1 text-xs text-slate-500">{selectedResourceView.activeProjects.length} progetti attivi sulle ore schedulate a 30 giorni</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setResourceModalName(null)}
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-100"
                    >
                      Chiudi
                    </button>
                  </div>
                  <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
                    <div className="space-y-2">
                      {selectedResourceView.activeProjects.map((project) => (
                        <div key={project.name} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/40 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-sm text-slate-200">{project.name}</p>
                            <p className="mt-1 text-[10px] text-slate-500">{project.internal ? "Interno" : "Cliente"}</p>
                          </div>
                          <span className="text-[10px] font-mono text-slate-400">{project.hours > 0 ? HOURS(project.hours) : "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Top clients */}
            {!loading && data && data.fic.allClients.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Top clienti {YEAR}</h3>
                <div className="rounded-xl border border-slate-800 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead><tr className="text-[10px] uppercase tracking-wider text-slate-600 border-b border-slate-800/50"><th className="text-left px-4 py-2">Cliente</th><th className="text-right px-4 py-2">Fatturato</th><th className="text-right px-4 py-2">Doc.</th></tr></thead>
                    <tbody>
                      {data.fic.allClients.filter(c=>c.totalRevenue>0).slice(0,8).map(c=>(
                        <tr key={c.id} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                          <td className="px-4 py-2.5 text-slate-300">{c.name}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-emerald-400">{EUR(c.totalRevenue)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-slate-500">{c.invoiceCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Commissions */}
            {!loading && commissions.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Commesse ({commissions.length})</h3>
                <div className="rounded-xl border border-slate-800 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead><tr className="text-[10px] uppercase tracking-wider text-slate-600 border-b border-slate-800/50"><th className="text-left px-4 py-2">Commessa</th><th className="text-left px-4 py-2">Cliente</th><th className="text-right px-4 py-2">Status</th></tr></thead>
                    <tbody>
                      {commissions.map((c: Commission) => (
                        <tr key={c.id} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                          <td className="px-4 py-2.5 text-slate-200 font-medium">{c.projectName}</td>
                          <td className="px-4 py-2.5 text-slate-400">{c.clientName??'—'}</td>
                          <td className="px-4 py-2.5 text-right"><span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${c.status==="active"?"bg-emerald-950/60 text-emerald-400":c.status==="closing"?"bg-amber-950/60 text-amber-400":c.status==="completed"?"bg-sky-950/60 text-sky-400":"bg-slate-800 text-slate-500"}`}>{c.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Portfolio */}
            {!loading && data && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Portfolio mese corrente</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  {[
                    {title:`Commessa cliente standard / Progetto temporaneo · tentativo · esplorativo (${portfolio.client.length})`,items:portfolio.client},
                  ].map(g=>(
                    <div key={g.title} className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden">
                      <div className="px-4 py-2 border-b border-slate-800/50"><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g.title}</span></div>
                      <div className="divide-y divide-slate-800/30">
                        {g.items.map(ph=><div key={ph.projectId} className="px-4 py-2 flex items-center justify-between"><span className="text-xs text-slate-300">{ph.projectName}</span><span className="text-[10px] font-mono text-slate-500">{HOURS(ph.totalHours)}</span></div>)}
                        {g.items.length===0&&<div className="px-4 py-3 text-xs text-slate-600">Nessun progetto</div>}
                      </div>
                    </div>
                  ))}
                  <div className="space-y-4">
                    {[
                      {title:`Progetto periodico / continuativo (${portfolio.periodic.length})`,items:portfolio.periodic},
                      {title:`Progetto con consulenza on brand (${portfolio.consulting.length})`,items:portfolio.consulting},
                    ].map(g=>(
                      <div key={g.title} className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden">
                        <div className="px-4 py-2 border-b border-slate-800/50"><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g.title}</span></div>
                        <div className="divide-y divide-slate-800/30">
                          {g.items.map(ph=><div key={ph.projectId} className="px-4 py-2 flex items-center justify-between"><span className="text-xs text-slate-300">{ph.projectName}</span><span className="text-[10px] font-mono text-slate-500">{HOURS(ph.totalHours)}</span></div>)}
                          {g.items.length===0&&<div className="px-4 py-3 text-xs text-slate-600">Nessun progetto</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {[
                    {title:`Attivita spot singola o breve (${portfolio.spot.length})`,items:portfolio.spot},
                    {title:`Progetto interno (${portfolio.internal.length})`,items:portfolio.internal},
                  ].map(g=>(
                    <div key={g.title} className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden">
                      <div className="px-4 py-2 border-b border-slate-800/50"><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g.title}</span></div>
                      <div className="divide-y divide-slate-800/30">
                        {g.items.map(ph=><div key={ph.projectId} className="px-4 py-2 flex items-center justify-between"><span className="text-xs text-slate-300">{ph.projectName}</span><span className="text-[10px] font-mono text-slate-500">{HOURS(ph.totalHours)}</span></div>)}
                        {g.items.length===0&&<div className="px-4 py-3 text-xs text-slate-600">Nessun progetto</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Resource view */}
            {!loading && resourceView.length > 0 && (
              <section>
                <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Vista per risorsa</h3>
                      <p className="mt-1 text-[10px] text-slate-600">Dettaglio del mese corrente con confronto sulla pressione dei prossimi 30 giorni</p>
                    </div>
                    <span className="text-[10px] text-slate-600">Ordinate per saturazione</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {resourceView.map((r, i) => (
                      <div key={i} className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-100">{r.personName}</p>
                            <p className="mt-1 text-[10px] text-slate-500">{HOURS(r.currentMonthScheduledHours)} su {HOURS(r.currentMonthCapacityHours)} nel mese · confronto: {HOURS(r.next30dScheduledHours)} su {HOURS(r.next30dCapacityHours)} nei prossimi 30gg</p>
                          </div>
                          <div className="text-right">
                            <p className={`font-mono text-2xl font-bold ${r.monthSaturation>90?"text-red-400":r.monthSaturation>60?"text-amber-400":"text-emerald-400"}`}>{r.monthSaturation}%</p>
                            <p className="text-[10px] text-slate-500">mese in corso</p>
                          </div>
                        </div>

                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`${r.monthSaturation>90?"bg-red-500":r.monthSaturation>60?"bg-amber-400":"bg-emerald-500"} h-full rounded-full`}
                            style={{ width: `${Math.min(r.monthSaturation, 100)}%` }}
                          />
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Sat. 30gg</p>
                            <p className={`mt-1 font-mono text-base ${r.next30dSaturation>90?"text-red-400":r.next30dSaturation>60?"text-amber-400":"text-emerald-400"}`}>{r.next30dSaturation}%</p>
                          </div>
                          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Ore mese</p>
                            <p className="mt-1 font-mono text-base text-slate-200">{HOURS(r.currentMonthScheduledHours)}</p>
                          </div>
                          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Ore cliente</p>
                            <p className="mt-1 font-mono text-base text-slate-200">{r.totalClientHours > 0 ? HOURS(r.totalClientHours) : "—"}</p>
                          </div>
                          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Ore interne</p>
                            <p className="mt-1 font-mono text-base text-slate-200">{r.totalInternalHours > 0 ? HOURS(r.totalInternalHours) : "—"}</p>
                          </div>
                          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Progetti attivi</p>
                            <button
                              type="button"
                              onClick={() => setResourceModalName(r.personName)}
                              className="mt-1 inline-flex items-center rounded-full border border-slate-700 px-2 py-0.5 font-mono text-base text-slate-200 hover:border-slate-500 hover:text-slate-100"
                            >
                              {r.fragmentation}
                            </button>
                          </div>
                          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Owner mese</p>
                            <p className="mt-1 font-mono text-base text-slate-200">{r.ownerProjectCount}</p>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-1">
                          {r.ownerCategories.client > 0 && <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300">CL/TMP {r.ownerCategories.client}</span>}
                          {r.ownerCategories.periodic > 0 && <span className="rounded-full border border-violet-800/60 px-2 py-0.5 text-[10px] text-violet-300">PER {r.ownerCategories.periodic}</span>}
                          {r.ownerCategories.consulting > 0 && <span className="rounded-full border border-sky-800/60 px-2 py-0.5 text-[10px] text-sky-300">CON {r.ownerCategories.consulting}</span>}
                          {r.ownerCategories.spot > 0 && <span className="rounded-full border border-amber-800/60 px-2 py-0.5 text-[10px] text-amber-300">SPOT {r.ownerCategories.spot}</span>}
                          {r.ownerCategories.internal > 0 && <span className="rounded-full border border-emerald-800/60 px-2 py-0.5 text-[10px] text-emerald-300">INT {r.ownerCategories.internal}</span>}
                          {r.ownerProjectCount === 0 && <span className="rounded-full border border-slate-800 px-2 py-0.5 text-[10px] text-slate-500">Nessuna ownership mese</span>}
                        </div>

                        <div className="mt-4 flex items-center justify-between">
                          <p className="text-[10px] text-slate-600">Ownership mese e saturazione restano letture diverse: una sui progetti, l’altra sulle ore stimate.</p>
                          <span className={`ml-3 text-[10px] font-medium px-1.5 py-0.5 rounded ${r.vacationVerdict==="yes"?"bg-emerald-950/60 text-emerald-400":r.vacationVerdict==="caution"?"bg-amber-950/60 text-amber-400":"bg-red-950/60 text-red-400"}`}>{r.vacationVerdict==="yes"?"Ferie OK":r.vacationVerdict==="caution"?"Ferie: cautela":"Ferie: no"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Assignments */}
            {!loading && (data?.float.recentAssignments?.length??0) > 0 && (
              <section>
                <div className="rounded-xl border border-slate-800 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Assegnazioni prossimi 30gg</h3>
                    <span className="text-[10px] text-slate-600 font-mono">{data!.float.recentAssignments.length} righe</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="text-[10px] uppercase tracking-wider text-slate-600 border-b border-slate-800/50"><th className="text-left px-4 py-2">Persona</th><th className="text-left px-4 py-2">Progetto</th><th className="text-left px-4 py-2">Inizio</th><th className="text-left px-4 py-2">Fine</th><th className="text-right px-4 py-2">h/gg</th><th className="text-right px-4 py-2">Totale</th></tr></thead>
                      <tbody>
                        {data!.float.recentAssignments.map((a,i)=>(
                          <tr key={i} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                            <td className="px-4 py-2.5 text-slate-200 font-medium">{a.personName}</td>
                            <td className="px-4 py-2.5 text-slate-300">{a.projectName}</td>
                            <td className="px-4 py-2.5 text-slate-500">{a.startDate}</td>
                            <td className="px-4 py-2.5 text-slate-500">{a.endDate}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-slate-400">{a.hoursPerDay>0?`${a.hoursPerDay}h`:"—"}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-sky-400/80">{a.totalHours>0?`${Math.round(a.totalHours)}h`:"—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Debug */}
            {showDebug && data && (
              <section>
                <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-500 mb-3">Debug</h3>
                  <pre className="text-[10px] text-slate-400 overflow-x-auto max-h-60">{JSON.stringify({ ficError:data.fic?.error, floatError:data.float?.error, capacityError:data.capacity?.error, invoices:data.fic.allInvoices.length, annualRevenue:data.fic.annualRevenue, annualRevenueNet:data.fic.annualRevenueNet, projects:data.float.projects.length, people:data.float.people.length, projectHours:data.float.projectHours.length, assignments:data.float.assignments?.length, recentAssignments:data.float.recentAssignments?.length, capacityByPerson:data.capacity?.byPerson?.length }, null, 2)}</pre>
                </div>
              </section>
            )}
          </div>
        )}

        {/* ═══ PLANNING TAB ═══ */}
        {mainTab === "planning" && (
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <PlanningDashboard />
          </div>
        )}

        <footer className="text-center py-6 text-[10px] text-slate-700">
          {data?.fetchedAt ? new Date(data.fetchedAt).toLocaleString("it-IT") : "—"} · Connector Hub
        </footer>
      </div>
    </div>
  );
}
