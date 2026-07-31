import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { ADMINS } from "@/lib/constants";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function requireAdmin() {
  const supabase = await createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: "No autorizado" as const };
  if (!user.email || !(ADMINS as readonly string[]).includes(user.email)) {
    return { error: "Solo administradores" as const };
  }
  return { user };
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }

  const { data, error } = await adminClient.auth.admin.listUsers();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const usuarios = data.users.map((u) => ({
    id: u.id,
    email: u.email,
    nombre: (u.user_metadata as Record<string, unknown> | null)?.nombre ?? null,
    rol: (u.user_metadata as Record<string, unknown> | null)?.rol ?? null,
    created_at: u.created_at,
    confirmed: !!u.email_confirmed_at,
  }));

  return NextResponse.json({ data: usuarios });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }

  const { email, password, nombre, rol } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email y contraseña requeridos" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });
  }

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nombre: nombre || null, rol: rol || null },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: { id: data.user.id, email: data.user.email } });
}
