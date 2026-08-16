import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { ADMINS } from "@/lib/constants";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function authOrAdmin() {
  const supabase = await createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: "No autorizado" as const };
  return { user };
}

export async function GET() {
  const auth = await authOrAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const { data, error } = await adminClient
    .from("dias_sin_clases")
    .select("fecha, motivo")
    .order("fecha", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const auth = await authOrAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  if (!auth.user.email || !(ADMINS as readonly string[]).includes(auth.user.email)) {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }

  const body = await req.json();
  const fecha: string | undefined = body.fecha;
  const motivo: string | undefined = body.motivo;

  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "Fecha inválida (AAAA-MM-DD)" }, { status: 400 });
  }

  const { data, error } = await adminClient
    .from("dias_sin_clases")
    .upsert({ fecha, motivo: motivo || "", creado_por: auth.user.id }, { onConflict: "fecha" })
    .select("fecha, motivo")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}

export async function DELETE(req: Request) {
  const auth = await authOrAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  if (!auth.user.email || !(ADMINS as readonly string[]).includes(auth.user.email)) {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const fecha = searchParams.get("fecha");

  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "Fecha inválida (AAAA-MM-DD)" }, { status: 400 });
  }

  const { error } = await adminClient.from("dias_sin_clases").delete().eq("fecha", fecha);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}