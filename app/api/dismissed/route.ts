import { NextResponse } from "next/server";
import { readDismissed, addDismissed } from "@/lib/dismissed-store";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json({ ok: true, ids: readDismissed() }); }
export async function POST(req: Request) {
  try { const { id } = await req.json(); return NextResponse.json({ ok: true, ids: addDismissed(Number(id)) }); }
  catch { return NextResponse.json({ ok: false }, { status: 400 }); }
}
