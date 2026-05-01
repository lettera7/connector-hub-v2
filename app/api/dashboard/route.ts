import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config-store";
import { fetchFicData } from "@/lib/adapters/fic-adapter";
import { fetchFloatData, fetchFloatCapacity } from "@/lib/adapters/float-adapter";
import type { DashboardData } from "@/lib/dashboard/types";

export const dynamic = "force-dynamic";

const DASHBOARD_CACHE_MS = 60_000;

type DashboardCacheState = {
  cache: { data: DashboardData; cachedAt: number } | null;
  inflight: Promise<DashboardData> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __connectorDashboardCache: DashboardCacheState | undefined;
}

const dashboardState: DashboardCacheState = globalThis.__connectorDashboardCache ?? {
  cache: null,
  inflight: null,
};
globalThis.__connectorDashboardCache = dashboardState;

async function loadDashboardData(): Promise<DashboardData> {
  const cfg = readConfig();
  if (!cfg.fic?.accessToken || !cfg.float?.apiKey) {
    throw new Error("Connessioni non configurate. Inserisci le credenziali in .config.json");
  }

  const [fic, float, capacity] = await Promise.all([
    fetchFicData(cfg.fic),
    fetchFloatData(cfg.float),
    fetchFloatCapacity(cfg.float),
  ]);

  return { fic, float, capacity, projectMetrics: {}, fetchedAt: new Date().toISOString() };
}

function jsonOk(data: DashboardData, source: "fresh" | "cache" | "stale-cache") {
  return NextResponse.json(
    { ok: true, source, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const cfg = readConfig();
  if (!cfg.fic?.accessToken || !cfg.float?.apiKey) {
    return NextResponse.json(
      { ok: false, error: "Connessioni non configurate. Inserisci le credenziali in .config.json" },
      { status: 400 },
    );
  }

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const now = Date.now();

  if (!forceRefresh && dashboardState.cache && now - dashboardState.cache.cachedAt < DASHBOARD_CACHE_MS) {
    return jsonOk(dashboardState.cache.data, "cache");
  }

  if (!dashboardState.inflight) {
    dashboardState.inflight = loadDashboardData().finally(() => {
      dashboardState.inflight = null;
    });
  }

  try {
    const data = await dashboardState.inflight;
    const hasRateLimitedFic = data.fic.error?.includes("FIC HTTP 429") ?? false;
    if (hasRateLimitedFic && dashboardState.cache) {
      const cached = {
        ...dashboardState.cache.data,
        fic: {
          ...dashboardState.cache.data.fic,
          error: data.fic.error,
        },
        fetchedAt: dashboardState.cache.data.fetchedAt,
      };
      return jsonOk(cached, "stale-cache");
    }

    dashboardState.cache = { data, cachedAt: Date.now() };
    return jsonOk(data, "fresh");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore sconosciuto";
    console.error("[DASHBOARD]", msg);
    if (dashboardState.cache) {
      const cached = {
        ...dashboardState.cache.data,
        fic: {
          ...dashboardState.cache.data.fic,
          error: msg,
        },
      };
      return jsonOk(cached, "stale-cache");
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
