import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const INA_BASE = "https://alerta.ina.gob.ar/a5";

interface ObservacionRaw {
  series_id: number;
  timestart: string;
  valor: number;
}

interface SerieInfo {
  id: number;
  estacion: { id: number; nombre: string; tabla: string };
  tipo: string;
  pronosticos?: Array<{
    series_id: number;
    cal_id: number;
    cal_grupo_id: number;
  }>;
}

// Mapeo de estaciones INA → nombres en nuestra BD
const INA_STATIONS: Record<string, { series_id: number }> = {
  "San Fernando (Brazo Luján)": { series_id: 52 },
  "La Plata": { series_id: 86 },
  "Puerto de Buenos Aires": { series_id: 85 },
  "Pilote Norden": { series_id: 1740 },
};

async function fetchObservaciones(
  series_id: number,
  daysBack = 3
): Promise<ObservacionRaw[]> {
  const now = new Date();
  const start = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const timestart = start.toISOString().split("T")[0];
  const timeend = now.toISOString().split("T")[0];

  const url = `${INA_BASE}/getObservaciones?tipo=H&series_id=${series_id}&timestart=${timestart}&timeend=${timeend}`;
  console.log(`[ingest-ina] Fetching: ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`INA error ${res.status} for series ${series_id}: ${text.slice(0, 200)}`);
  }

  const data: ObservacionRaw[] = await res.json();
  return data;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const resultados: { estacion: string; ok: boolean; count: number; error?: string }[] = [];
  let allOk = true;

  try {
    // Obtener estaciones de la BD
    const { data: estaciones, error: errEst } = await supabase
      .from("estaciones")
      .select("id, nombre");
    if (errEst) throw errEst;

    const nombreToId: Record<string, string> = {};
    for (const e of estaciones) {
      nombreToId[e.nombre] = e.id;
    }

    // Procesar cada estación
    for (const [nombreBD, config] of Object.entries(INA_STATIONS)) {
      const estacionId = nombreToId[nombreBD];
      if (!estacionId) {
        resultados.push({
          estacion: nombreBD,
          ok: false,
          count: 0,
          error: "no mapeada en BD",
        });
        continue;
      }

      try {
        const observaciones = await fetchObservaciones(config.series_id);

        let inserted = 0;
        for (const obs of observaciones) {
          const ts = new Date(obs.timestart).toISOString();

          // Evitar duplicados
          const { data: existing } = await supabase
            .from("lecturas")
            .select("id")
            .eq("estacion_id", estacionId)
            .eq("timestamp", ts)
            .eq("tipo", "observado")
            .maybeSingle();

          if (existing) continue;

          const { error: insertErr } = await supabase.from("lecturas").insert({
            estacion_id: estacionId,
            timestamp: ts,
            nivel_m: obs.valor,
            tipo: "observado",
          });

          if (insertErr) {
            console.error(`[ingest-ina] Error insertando ${nombreBD}: ${insertErr.message}`);
          } else {
            inserted++;
          }
        }

        resultados.push({
          estacion: nombreBD,
          ok: true,
          count: inserted,
        });
      } catch (err) {
        resultados.push({
          estacion: nombreBD,
          ok: false,
          count: 0,
          error: (err as Error).message,
        });
        allOk = false;
      }
    }

    // También intentar obtener pronóstico de San Fernando
    try {
      const pronoUrl = `${INA_BASE}/getPronosticos?cal_grupo_id=1`;
      const pronoRes = await fetch(pronoUrl);
      if (pronoRes.ok) {
        const pronoData = await pronoRes.json();
        for (const item of pronoData) {
          for (const series of item.series) {
            if (series.estacion_id === 52 && series.qualifiers?.includes("main")) {
              // El pronóstico está disponible pero los valores se obtienen
              // con getObservaciones para series de pronóstico
              const pronoObs = await fetch(`${INA_BASE}/getObservaciones?tipo=H&series_id=${series.series_id}&timestart=${series.begin_date.split("T")[0]}&timeend=${series.end_date.split("T")[0]}`);
              if (pronoObs.ok) {
                const pronoData: ObservacionRaw[] = await pronoObs.json();
                const sfId = nombreToId["San Fernando (Brazo Luján)"];
                let pronoInserted = 0;
                for (const p of pronoData) {
                  const ts = new Date(p.timestart).toISOString();
                  const { data: existing } = await supabase
                    .from("lecturas")
                    .select("id")
                    .eq("estacion_id", sfId)
                    .eq("timestamp", ts)
                    .eq("tipo", "pronostico")
                    .maybeSingle();
                  if (existing) continue;
                  const { error: insertErr } = await supabase.from("lecturas").insert({
                    estacion_id: sfId,
                    timestamp: ts,
                    nivel_m: p.valor,
                    tipo: "pronostico",
                  });
                  if (!insertErr) pronoInserted++;
                }
                console.log(`[ingest-ina] Pronóstico SF: ${pronoInserted} insertados`);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`[ingest-ina] Error pronóstico: ${(err as Error).message}`);
    }

    // Disparar evaluación de alerta
    try {
      await supabase.functions.invoke("evaluar-alerta", {
        body: JSON.stringify({ triggered_by: "ingest-ina" }),
      });
    } catch {
      // ignore if evaluar-alerta fails
    }
  } catch (err) {
    allOk = false;
    console.error("[ingest-ina] Error general:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message, resultados }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ ok: allOk, resultados }), {
    headers: { "Content-Type": "application/json" },
  });
});
