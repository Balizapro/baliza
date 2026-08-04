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
}

const TZ = "America/Argentina/Buenos_Aires";
const H = 3600000;

// Ventana de preaviso: cuántas horas hacia adelante miramos la curva proyectada.
// Si el cruce está a menos de VENTANA_MIN_Hs, el agua ya casi llega (aviso tardío);
// si está a más de VENTANA_MAX_Hs, es ruido de horizonte lejano.
const VENTANA_MIN_H = 1.5;
const VENTANA_MAX_H = 12;

// Un mismo evento (pleamar que cruza el umbral) se notifica UNA sola vez:
// la identidad del evento es el instante del cruce redondeado a la hora.
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
      .in("nombre", ["evaluacion", "no_retorno"]);

    if (!umbrales || (umbrales as UmbralRow[]).length < 2) {
      return new Response(JSON.stringify({ ok: false, error: "umbrales no configurados" }), { status: 500 });
    }

    const umbralEval = (umbrales as UmbralRow[]).find((u) => u.nombre === "evaluacion")!.valor_m;
    const umbralNR = (umbrales as UmbralRow[]).find((u) => u.nombre === "no_retorno")!.valor_m;

    const { data: estaciones } = await supabase
      .from("estaciones")
      .select("id")
      .eq("nombre", "San Fernando (Brazo Luján)")
      .single();

    if (!estaciones) {
      return new Response(JSON.stringify({ ok: false, error: "estación SF no encontrada" }), { status: 500 });
    }

    // Historial observado (10 días, asc) para el ajuste armónico + regresión
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

    // Viento histórico + pronóstico (ambos asc, timestamp en ms)
    const { data: vientoHistRaw } = await supabase
      .from("viento")
      .select("timestamp, velocidad_kmh, direccion_grados")
      .gte("timestamp", hace10Dias)
      .order("timestamp", { ascending: true });

    const { data: vientoPronoRaw } = await supabase
      .from("viento_pronostico")
      .select("timestamp, velocidad_kmh, direccion_grados")
      .order("timestamp", { ascending: true });

    const aViento = (rows: VientoRow[] | null | undefined): PuntoViento[] =>
      (rows ?? []).map((v) => ({
        timestamp: new Date(v.timestamp).getTime(),
        velocidad_kmh: Number(v.velocidad_kmh),
        direccion_grados: Number(v.direccion_grados),
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

    // Buscar el primer cruce de cada umbral dentro de la ventana de preaviso.
    // Cruzar el NR es más severo y tiene prioridad.
    function primerCruce(umbral: number): { timestamp: number; nivel_m: number } | null {
      for (const p of proy.puntos) {
        if (p.timestamp < ahora + VENTANA_MIN_H * H) continue;
        if (p.timestamp > ahora + VENTANA_MAX_H * H) return null;
        if (p.nivel_m >= umbral) return p;
      }
      return null;
    }

    const cruceNR = primerCruce(umbralNR);
    const cruceEval = primerCruce(umbralEval);

    if (!cruceNR && !cruceEval) {
      return new Response(JSON.stringify({ ok: true, motivo: "sin cruce en ventana", pico_48h_m: proy.puntos.reduce((m, p) => Math.max(m, p.nivel_m), -9) }), { status: 200 });
    }

    const cruce = cruceNR ?? cruceEval;
    const esNR = !!cruceNR;
    const umbral = esNR ? umbralNR : umbralEval;
    const horasHasta = (cruce.timestamp - ahora) / H;
    const idEvento = eventoId(cruce.timestamp);

    // Dedup: no repetir el mismo evento ni spamear cada 20 min.
    const claveDedup = esNR ? "ultimo_preaviso_crecida_nr" : "ultimo_preaviso_crecida_eval";
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

    // Marcar ANTES de enviar para evitar duplicados ante reintentos.
    await supabase.from("configuracion").upsert(
      { clave: claveDedup, valor: idEvento },
      { onConflict: "clave" }
    );

    const horasTxt = Math.round(horasHasta * 10) / 10;
    const titulo = esNR ? "Baliza — Posible crecida severa" : "Baliza — Posible crecida";
    const efectoViento = proy.regresion && Math.abs(proy.regresion.pendiente_m_por_kmh) > 0.005
      ? ` (sudestada +${(proy.regresion.pendiente_m_por_kmh * (proy.regresion.compSEActual > 0 ? proy.regresion.compSEActual : 0)).toFixed(2)}m)` : "";
    const cuerpo = `El modelo proyecta que San Fernando superará ${umbral.toFixed(1)}m ≈ ${cruce.nivel_m.toFixed(2)}m el ${formatearMomento(new Date(cruce.timestamp).toISOString())} (en ~${horasTxt}h)${efectoViento}`;

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
      if (!enviado) console.error("[preavisar-crecida] enviar-notificacion", res.status, await res.text().catch(() => ""));
    } catch (err) {
      console.error("[preavisar-crecida] error enviando notificación:", err);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        esNR,
        umbral,
        cruce_timestamp: new Date(cruce.timestamp).toISOString(),
        horas_hasta: horasTxt,
        id_evento: idEvento,
        pico_48h_m: proy.puntos.reduce((m, p) => Math.max(m, p.nivel_m), -9),
        regresion: proy.regresion
          ? { lag_h: proy.regresion.lag_h, pendiente_m_por_kmh: proy.regresion.pendiente_m_por_kmh, r2: proy.regresion.r2 }
          : null,
        notifico: enviado,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[preavisar-crecida] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
