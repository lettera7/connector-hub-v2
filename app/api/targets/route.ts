import { NextResponse } from "next/server";
import { readTargets, writeTargets } from "@/lib/targets-store";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json({ ok: true, data: readTargets() }); }
export async function POST(req: Request) {
  try {
    const { annualTarget, monthlyTarget } = await req.json();
    const t = writeTargets({ annualTarget: Number(annualTarget ?? 0), monthlyTarget: Number(monthlyTarget ?? 0) });
    return NextResponse.json({ ok: true, data: readTargets() });
  } catch { return NextResponse.json({ ok: false, error: "Payload non valido" }, { status: 400 }); }
}
