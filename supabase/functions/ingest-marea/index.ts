import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Marea astronómica del frente del Delta (fuente: INA, serie del punto "Lujan",
// referencia: escala de San Fernando). Es la base determinista de las sudestadas.
const SERIES: Record<string, number> = {
  "BarcaGrande": 6034,
  "Lujan": 6041,
  "SanAntonio": 6044,
  "CanaldelEste": 6036,
  "Guazu": 6038,
  "Palmas": 6043,
};

const DESTINO_DEFAULT = "Lujan";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Ventana: desde hace 1 día hasta +5 días (lo que publica el INA)
    const ahora = new Date();
    const timeStart = new Date(ahora.getTime() - 1 * 24 * 3600 * 1000)
      .toISOString().split("T")[0];
    const timeEnd = new Date(ahora.getTime() + 5 * 24 * 3600 * 1000)
      .toISOString().split("T")[0];

    const body = new URLSearchParams({
      request: "datos",
      timeStart,
      timeEnd,
      seriesId: String(SERIES[DESTINO_DEFAULT]),
      format: "json",
    });

    console.log(`[ingest-marea] Fetching ${DESTINO_DEFAULT} (series ${SERIES[DESTINO_DEFAULT]}): ${timeStart}..${timeEnd}`);
    const res = await fetch("https://alerta.ina.gob.ar/pub/datos/datos", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!res.ok) throw new Error(`INA error ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const text = await res.text();
    const m = text.match(/"data":(\[.*\])\}/);
    if (!m) throw new Error("No se encontró el array data en la respuesta");
    const puntos = JSON.parse(m[1]);

    if (!puntos.length) {
      console.log("[ingest-marea] Sin datos en el rango solicitado");
      return new Response(JSON.stringify({ ok: true, inserted: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Guardar cada punto horario como tipo 'astro'
    let inserted = 0;
    for (const p of puntos) {
      const ts = new Date(p.timestart).toISOString();
      const nivel = Number(p.valor);

      // Upsert: no duplicar el mismo punto+hora+tipo
      const { data: existing } = await supabase
        .from("mareas")
        .select("id")
        .eq("punto", DESTINO_DEFAULT)
        .eq("timestamp_marea", ts)
        .eq("tipo", "astro")
        .maybeSingle();

      if (existing) continue;

      const { error: insertErr } = await supabase.from("mareas").insert({
        tipo: "astro",
        punto: DESTINO_DEFAULT,
        timestamp_desde: ts,
        timestamp_hasta: ts,
        timestamp_marea: ts,
        nivel_m: nivel,
        correccion_cm: 0,
        lugar: DESTINO_DEFAULT,
      });
      if (insertErr) {
        console.error(`[ingest-marea] Error insertando ${ts}: ${insertErr.message}`);
      } else {
        inserted++;
      }
    }

    console.log(`[ingest-marea] Inserted ${inserted} puntos de marea astronómica (${DESTINO_DEFAULT})`);
    return new Response(JSON.stringify({ ok: true, inserted, serie: DESTINO_DEFAULT }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[ingest-marea] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
