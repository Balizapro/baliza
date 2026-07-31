import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

export async function GET() {
  const { data, error } = await adminClient
    .from("equivalencia_escalones")
    .select("*")
    .order("escalon", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await req.json();
  const { escalon, nivel_min_m, nivel_max_m, confianza } = body;

  if (escalon == null || nivel_min_m == null || nivel_max_m == null) {
    return NextResponse.json({ error: "Faltan campos: escalon, nivel_min_m, nivel_max_m" }, { status: 400 });
  }

  const { data, error } = await adminClient
    .from("equivalencia_escalones")
    .insert({ escalon, nivel_min_m, nivel_max_m, confianza: confianza ?? 0.0 })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}
