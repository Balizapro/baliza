import { createServerSupabase } from "@/lib/supabase-server";
import { ADMINS } from "@/lib/constants";

export type AuthUser = { id: string; email?: string | null };

export type RequireAdminResult =
  | { user: AuthUser }
  | { error: string };

// Auth para rutas de API que solo deben tocar administradores. Devuelve el
// usuario autenticado, o un objeto de error para responder 401/403.
export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: "No autorizado" };
  if (!user.email || !(ADMINS as readonly string[]).includes(user.email)) {
    return { error: "Solo administradores" };
  }
  return { user };
}
