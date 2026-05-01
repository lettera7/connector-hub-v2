import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config-store";
import { createFloatAllocation } from "@/lib/adapters/float-planning-adapter";

type AllocationRequest = {
  peopleId?: number;
  projectId?: number;
  phaseId?: number | null;
  startDate?: string;
  endDate?: string;
  startTime?: string | null;
  endTime?: string | null;
  hoursPerDay?: number;
  projectName?: string;
  phaseName?: string | null;
  personName?: string;
  allocationRole?: string;
  basis?: string;
};

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function isFloatTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(value);
}

export async function POST(req: Request) {
  const cfg = readConfig();
  if (!cfg.float?.apiKey) {
    return NextResponse.json({ ok: false, error: "Float non configurato." }, { status: 400 });
  }

  try {
    const body = await req.json() as AllocationRequest;
    const peopleId = Number(body.peopleId ?? 0);
    const projectId = Number(body.projectId ?? 0);
    const phaseId = body.phaseId == null ? null : Number(body.phaseId);
    const hoursPerDay = Number(body.hoursPerDay ?? 0);

    if (peopleId <= 0 || projectId <= 0 || (phaseId != null && phaseId <= 0) || !isIsoDate(body.startDate) || !isIsoDate(body.endDate) || (body.startTime != null && !isFloatTime(body.startTime)) || hoursPerDay <= 0) {
      return NextResponse.json({ ok: false, error: "Dati allocazione non validi." }, { status: 400 });
    }

    const allocation = await createFloatAllocation(cfg.float.apiKey, {
      peopleId,
      projectId,
      phaseId,
      startDate: body.startDate,
      endDate: body.endDate,
      startTime: body.startTime ?? null,
      hoursPerDay,
      name: `Planning approvato${body.allocationRole ? ` (${body.allocationRole})` : ""}`,
      notes: `Connector Hub: ${body.personName ?? peopleId} su ${body.projectName ?? projectId}${body.phaseName ? ` / fase ${body.phaseName}` : ""}${body.startTime ? ` / ${body.startTime}${body.endTime ? `-${body.endTime}` : ""}` : ""}${body.basis ? ` - ${body.basis}` : ""}`,
    });

    return NextResponse.json({ ok: true, data: allocation });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore sconosciuto";
    console.error("[PLANNING_ALLOCATIONS]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
