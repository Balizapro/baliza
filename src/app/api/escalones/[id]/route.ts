import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { escalon, nivel_min_m, nivel_max_m, confianza } = body;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (escalon != null) update.escalon = escalon;
  if (nivel_min_m != null) update.nivel_min_m = nivel_min_m;
  if (nivel_max_m != null) update.nivel_max_m = nivel_max_m;
  if (confianza != null) update.confianza = confianza;

  const { data, error } = await adminClient
    .from("equivalencia_escalones")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }

  const { id } = await params;

  const { error } = await adminClient
    .from("equivalencia_escalones")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
