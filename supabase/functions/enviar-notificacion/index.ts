import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import webpush from "npm:web-push@3.6.7";

interface PushRow {
  id: string;
  user_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
}

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Seguridad: el gateway de Supabase ya exige un JWT válido (Authorization).
  // Como protección adicional, exigimos el secret dedicado NOTIFICACION_SECRET
  // (lo envía evaluar-alerta). Evita que un usuario común dispare notificaciones masivas.
  const secretOk = req.headers.get("x-notificacion-secret") === Deno.env.get("NOTIFICACION_SECRET");
  if (!secretOk) {
    return new Response(JSON.stringify({ ok: false, error: "no autorizado" }), { status: 401 });
  }

  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:soporte@baliza.local";
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";

  if (!vapidPrivateKey || !vapidPublicKey) {
    return new Response(JSON.stringify({ ok: false, error: "VAPID keys no configuradas" }), { status: 500 });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  let body: { titulo?: string; cuerpo?: string; url?: string; solo_user_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const titulo = body.titulo ?? "Baliza";
  const cuerpo = body.cuerpo ?? "Nuevo estado del río en San Fernando";
  const url = body.url ?? "/dashboard";
  const payload = JSON.stringify({ title: titulo, body: cuerpo, url, data: { url } });

  let q = supabase.from("push_subscriptions").select("*");
  if (body.solo_user_id) q = q.eq("user_id", body.solo_user_id);
  const { data: subs, error } = await q;

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  const subsList = (subs as PushRow[] | null) ?? [];
  if (subsList.length === 0) {
    return new Response(JSON.stringify({ ok: true, enviados: 0, eliminados: 0 }), { status: 200 });
  }

  let enviados = 0;
  let eliminados = 0;
  const errores: string[] = [];

  await Promise.all(
    subsList.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 86400 }
        );
        enviados++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Suscripción inválida/vencida — la eliminamos
          eliminados++;
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          errores.push(`${sub.endpoint.slice(0, 60)}... (${status ?? "desconocido"})`);
        }
      }
    })
  );

  return new Response(
    JSON.stringify({ ok: true, enviados, eliminados, errores }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
