import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { proyectarCurva, type Punto, type PuntoViento } from "./modelo.ts";

interface UmbralRow {
  nombre: string;
  valor_m: number;
}

interface VientoRow {
  timestamp: string;
  velocidad_kmh: number;
  direccion_grados: number;
  presion_hpa?: number | null;
}

const TZ = "America/Argentina/Buenos_Aires";
const H = 3600000;

// La bajante se anticipa con menos adelanto que la crecida: mirar a 3–18h.
const VENTANA_MIN_H = 3;
const VENTANA_MAX_H = 18;

function eventoId(tsMs: number): string {
  return new Date(tsMs - (tsMs % H)).toISOString();
}

function formatearMomento(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const NOTIF_SECRET = Deno.env.get("NOTIFICACION_SECRET") ?? "";
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { data: umbrales } = await supabase
      .from("umbrales")
      .select("nombre, valor_m")
      .in("nombre", ["bajante_alarma", "bajante_evacuacion"]);

    if (!umbrales || (umbrales as UmbralRow[]).length < 2) {
      return new Response(JSON.stringify({ ok: false, error: "umbrales de bajante no configurados" }), { status: 500 });
    }

    const umbralAlarma = (umbrales as UmbralRow[]).find((u) => u.nombre === "bajante_alarma")!.valor_m;
    const umbralEvac = (umbrales as UmbralRow[]).find((u) => u.nombre === "bajante_evacuacion")!.valor_m;

    const { data: estaciones } = await supabase
      .from("estaciones")
      .select("id")
      .eq("nombre", "San Fernando (Brazo Luján)")
      .single();

    if (!estaciones) {
      return new Response(JSON.stringify({ ok: false, error: "estación SF no encontrada" }), { status: 500 });
    }

    const hace10Dias = new Date(Date.now() - 10 * 24 * H).toISOString();
    const { data: lecturas } = await supabase
      .from("lecturas")
      .select("timestamp, nivel_m")
      .eq("estacion_id", estaciones.id)
      .eq("tipo", "observado")
      .gte("timestamp", hace10Dias)
      .order("timestamp", { ascending: true });

    const lecturasPunto = ((lecturas as { timestamp: string; nivel_m: number }[] | null) ?? []) as Punto[];
    if (lecturasPunto.length < 24) {
      return new Response(JSON.stringify({ ok: true, motivo: "sin suficiente historial observado" }), { status: 200 });
    }

    const { data: vientoHistRaw } = await supabase
      .from("viento")
      .select("timestamp, velocidad_kmh, direccion_grados, presion_hpa")
      .gte("timestamp", hace10Dias)
      .order("timestamp", { ascending: true });

    const { data: vientoPronoRaw } = await supabase
      .from("viento_pronostico")
      .select("timestamp, velocidad_kmh, direccion_grados, presion_hpa")
      .order("timestamp", { ascending: true });

    const aViento = (rows: VientoRow[] | null | undefined): PuntoViento[] =>
      (rows ?? []).map((v) => ({
        timestamp: new Date(v.timestamp).getTime(),
        velocidad_kmh: Number(v.velocidad_kmh),
        direccion_grados: Number(v.direccion_grados),
        presion_hpa: v.presion_hpa != null ? Number(v.presion_hpa) : null,
      }));

    const ventos = [...aViento(vientoHistRaw as VientoRow[]), ...aViento(vientoPronoRaw as VientoRow[])];
    if (ventos.length === 0) {
      return new Response(JSON.stringify({ ok: true, motivo: "sin viento" }), { status: 200 });
    }

    const ahora = Date.now();
    const proy = proyectarCurva(lecturasPunto, ventos, ahora, 48, 15);

    if (!proy.ajuste || proy.puntos.length === 0) {
      return new Response(JSON.stringify({ ok: true, motivo: "modelo no ajusta" }), { status: 200 });
    }

    // La bajante desciende POR DEBAJO del umbral. Evacuación es más severa y tiene prioridad.
    function primerDescenso(umbral: number): { timestamp: number; nivel_m: number } | null {
      for (const p of proy.puntos) {
        if (p.timestamp < ahora + VENTANA_MIN_H * H) continue;
        if (p.timestamp > ahora + VENTANA_MAX_H * H) return null;
        if (p.nivel_m <= umbral) return p;
      }
      return null;
    }

    const descensoEvac = primerDescenso(umbralEvac);
    const descensoAlarma = primerDescenso(umbralAlarma);

    if (!descensoEvac && !descensoAlarma) {
      return new Response(JSON.stringify({ ok: true, motivo: "sin bajante en ventana", minimo_48h_m: proy.puntos.reduce((m, p) => Math.min(m, p.nivel_m), 9) }), { status: 200 });
    }

    const descenso = descensoEvac ?? descensoAlarma;
    const esEvac = !!descensoEvac;
    const umbral = esEvac ? umbralEvac : umbralAlarma;
    const horasHasta = (descenso.timestamp - ahora) / H;
    const idEvento = eventoId(descenso.timestamp);

    const claveDedup = esEvac ? "ultimo_preaviso_bajante_evac" : "ultimo_preaviso_bajante_alarma";
    const { data: cfg } = await supabase
      .from("configuracion")
      .select("valor")
      .eq("clave", claveDedup)
      .maybeSingle();

    const ultimoNotificado = cfg ? (cfg as { valor: string }).valor : "";
    const yaNotificado = ultimoNotificado === idEvento;

    if (yaNotificado) {
      return new Response(JSON.stringify({ ok: true, motivo: "evento ya notificado", idEvento }), { status: 200 });
    }

    await supabase.from("configuracion").upsert(
      { clave: claveDedup, valor: idEvento },
      { onConflict: "clave" }
    );

    const horasTxt = Math.round(horasHasta * 10) / 10;
    const titulo = esEvac ? "Baliza — Bajante de evacuación" : "Baliza — Bajante de alarma";
    const efectoViento = proy.regresion && Math.abs(proy.regresion.pendiente_m_por_kmh) > 0.005
      ? ` (viento SE ${(proy.regresion.pendiente_m_por_kmh * (proy.regresion.compSEActual < 0 ? -proy.regresion.compSEActual : 0)).toFixed(2)}m)` : "";
    const cuerpo = `El modelo proyecta que San Fernando descenderá a ${umbral.toFixed(2)}m ≈ ${descenso.nivel_m.toFixed(2)}m el ${formatearMomento(new Date(descenso.timestamp).toISOString())} (en ~${horasTxt}h)${efectoViento}`;

    let enviado = false;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/enviar-notificacion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ANON_KEY}`,
          "x-notificacion-secret": NOTIF_SECRET,
        },
        body: JSON.stringify({ titulo, cuerpo, url: "/dashboard" }),
      });
      enviado = res.ok;
      if (!enviado) console.error("[preavisar-bajante] enviar-notificacion", res.status, await res.text().catch(() => ""));
    } catch (err) {
      console.error("[preavisar-bajante] error enviando notificación:", err);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        esEvac,
        umbral,
        descenso_timestamp: new Date(descenso.timestamp).toISOString(),
        horas_hasta: horasTxt,
        id_evento: idEvento,
        minimo_48h_m: proy.puntos.reduce((m, p) => Math.min(m, p.nivel_m), 9),
        notifico: enviado,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[preavisar-bajante] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
