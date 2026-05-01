import { NextResponse } from "next/server";
import { readMappings, upsertMapping, removeMapping } from "@/lib/mapping-store";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json({ ok: true, data: readMappings() }); }
export async function PUT(req: Request) {
  try { const body = await req.json(); return NextResponse.json({ ok: true, data: upsertMapping(body) }); }
  catch { return NextResponse.json({ ok: false, error: "Errore" }, { status: 400 }); }
}
export async function DELETE(req: Request) {
  try { const { floatProjectId } = await req.json(); return NextResponse.json({ ok: true, data: removeMapping(Number(floatProjectId)) }); }
  catch { return NextResponse.json({ ok: false, error: "Errore" }, { status: 400 }); }
}
