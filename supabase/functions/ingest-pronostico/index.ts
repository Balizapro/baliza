import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const INA_BASE = "https://alerta.ina.gob.ar/a5";

// San Fernando: estacion_id=52, var_id=2 (Altura hidrométrica)
const ESTACION_ID_INA = 52;
const VAR_ID = 2;

interface PronosticoRaw {
  timestart: string;
  valor: number;
}

interface CalibradoCorrida {
  corrida: {
    id: number;
    forecast_date: string;
    cal_id: number;
    series: Array<{
      series_id: number;
      qualifier: string;
      pronosticos: PronosticoRaw[];
    }>;
  };
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: estaciones, error: errEst } = await supabase
      .from("estaciones")
      .select("id, nombre");
    if (errEst) throw errEst;

    const sf = estaciones?.find((e) => e.nombre.includes("San Fernando"));
    if (!sf) throw new Error("San Fernando no encontrada en BD");

    // Fetch window: 1 day past + 5 days future (el pronóstico INA suele llegar
    // hasta ~4-5 días; ampliar la ventana permite ver picos del fin de semana
    // / días hábiles siguientes antes de que ocurran).
    const now = new Date();
    const start = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const timestart = start.toISOString().split("T")[0];
    const timeend = end.toISOString().split("T")[0];

    const url = `${INA_BASE}/sim/calibrados?estacion_id=${ESTACION_ID_INA}&var_id=${VAR_ID}&includeCorr=true&timestart=${timestart}&timeend=${timeend}`;
    console.log(`[ingest-pronostico] Fetching: ${url}`);

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`INA error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data: Record<string, CalibradoCorrida> = await res.json();
    const item = data["0"];
    if (!item?.corrida?.series?.length) {
      console.log("[ingest-pronostico] No forecast data in response");
      return new Response(JSON.stringify({ ok: true, inserted: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const forecast_date = item.corrida.forecast_date;
    const qualifiers = item.corrida.series;

    // Delete previous forecasts for this station
    await supabase.from("pronosticos").delete().eq("estacion_id", sf.id);

    let inserted = 0;
    for (const q of qualifiers) {
      if (!q.pronosticos?.length) continue;

      const rows = q.pronosticos.map((p) => ({
        estacion_id: sf.id,
        timestamp: new Date(p.timestart).toISOString(),
        valor_m: p.valor,
        qualifier: q.qualifier || "main",
        forecast_date: new Date(forecast_date).toISOString(),
      }));

      const { error: insertErr } = await supabase.from("pronosticos").insert(rows);
      if (insertErr) {
        console.error(`[ingest-pronostico] Error inserting ${q.qualifier}: ${insertErr.message}`);
      } else {
        inserted += rows.length;
      }
    }

    console.log(`[ingest-pronostico] Inserted ${inserted} forecast rows (forecast_date=${forecast_date})`);

    // Trigger alert evaluation
    try {
      await supabase.functions.invoke("evaluar-alerta", {
        body: JSON.stringify({ triggered_by: "ingest-pronostico" }),
      });
    } catch {
      // ignore
    }

    return new Response(JSON.stringify({ ok: true, inserted, forecast_date }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[ingest-pronostico] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
