import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }

  const body = await req.json();

  const { data, error } = await adminClient.from("bitacora").insert({
    nivel_registrado_m: body.nivel_registrado_m,
    escalones_restantes: body.escalones_restantes ?? null,
    se_evacuo: body.se_evacuo ?? false,
    hora_salida: body.hora_salida || null,
    notas: body.notas || null,
    tipo_evento: body.tipo_evento || "otro",
    fecha_evento: body.fecha_evento || null,
  }).select().single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}

