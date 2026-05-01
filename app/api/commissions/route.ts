import { NextResponse } from "next/server";
import { readMappings, upsertMapping, removeMapping } from "@/lib/mapping-store";
import { readDismissed, addDismissed } from "@/lib/dismissed-store";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json({ ok: true, data: readMappings(), dismissed: readDismissed() }); }
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const all = upsertMapping(body);
    return NextResponse.json({ ok: true, data: all });
  } catch { return NextResponse.json({ ok: false, error: "Payload non valido" }, { status: 400 }); }
}
export async function DELETE(req: Request) {
  try {
    const { floatProjectId } = await req.json();
    const all = removeMapping(Number(floatProjectId));
    return NextResponse.json({ ok: true, data: all });
  } catch { return NextResponse.json({ ok: false, error: "Payload non valido" }, { status: 400 }); }
}
