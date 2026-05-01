import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config-store";
import { fetchFicData } from "@/lib/adapters/fic-adapter";
import { fetchFloatData } from "@/lib/adapters/float-adapter";
import { fetchAccounts, fetchProjects, fetchPeople, fetchProjectTeam, fetchPhases, fetchUpcomingTimeOff } from "@/lib/adapters/float-planning-adapter";
import { assemblePlanningData } from "@/lib/planning/planning-logic";
import type { PlanningData } from "@/lib/planning/types";
import { readMappings } from "@/lib/mapping-store";

export const dynamic = "force-dynamic";

const EMPTY_SUMMARY = { totalProjects:0,activeProjects:0,tentativeProjects:0,dormantProjects:0,periodicProjects:0,totalPeople:0,greenPeople:0,yellowPeople:0,redPeople:0,criticalAlerts:0,warningAlerts:0 };
const EMPTY_DATA = {
  projects: [],
  people: [],
  suggestions: [],
  alerts: [],
  planningWeeks: [],
  resourceAvailability: [],
  proposals: [],
  allocationPreviews: [],
  commercialSignals: [],
  ficClients: [],
  mappings: [],
  summary: EMPTY_SUMMARY,
  fetchedAt: new Date().toISOString(),
  error: null as string | null,
};

export async function GET(): Promise<NextResponse<PlanningData>> {
  const cfg = readConfig();
  if (!cfg.float?.apiKey || !cfg.fic?.accessToken || !cfg.fic?.companyId) {
    return NextResponse.json({ ...EMPTY_DATA, fetchedAt: new Date().toISOString(), error:"FIC o Float non configurati." }, { status: 400 });
  }
  try {
    const key = cfg.float.apiKey;
    const [fic, floatData, rawProjects, rawAccounts, rawPeople, rawTeam, rawPhases, rawTimeOff, mappings] = await Promise.all([
      fetchFicData(cfg.fic),
      fetchFloatData(cfg.float),
      fetchProjects(key), fetchAccounts(key), fetchPeople(key), fetchProjectTeam(key), fetchPhases(key),
      fetchUpcomingTimeOff(key, 60),
      Promise.resolve(readMappings()),
    ]);
    console.log(`[PLANNING] ficInvoices=${fic.allInvoices.length} floatProjects=${floatData.projects.length} projects=${rawProjects.length} accounts=${rawAccounts.length} people=${rawPeople.length} team=${rawTeam.length} phases=${rawPhases.length} timeoff=${rawTimeOff.length} mappings=${mappings.length}`);
    const data = assemblePlanningData(rawProjects, rawAccounts, rawPeople, rawTeam, rawPhases, rawTimeOff, fic, floatData, mappings);
    return NextResponse.json({ ...data, fetchedAt: new Date().toISOString(), error: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore sconosciuto";
    console.error("[PLANNING]", msg);
    return NextResponse.json({ ...EMPTY_DATA, fetchedAt: new Date().toISOString(), error:msg }, { status: 500 });
  }
}
