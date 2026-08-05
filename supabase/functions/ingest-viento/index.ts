import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const lat = -34.35;
  const lon = -58.55;

  try {
    // Observación actual + pronóstico horario (48h) para el modelo de forzante meteorológica
    // (viento SE + presión atmosférica)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m,surface_pressure&hourly=wind_speed_10m,wind_direction_10m,surface_pressure&forecast_days=3&wind_speed_unit=kmh`;
    console.log(`[ingest-viento] Fetching: ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo error ${res.status}`);
    }

    const data = await res.json();
    const current = data.current;

    await supabase.from("viento").insert({
      timestamp: new Date(current.time).toISOString(),
      velocidad_kmh: current.wind_speed_10m,
      direccion_grados: current.wind_direction_10m,
      presion_hpa: current.surface_pressure ?? null,
      lat,
      lon,
    });

    // Guardar el pronóstico horario (solo futuro) para la proyección de curva
    const hourly = data.hourly;
    if (hourly?.time && Array.isArray(hourly.time)) {
      const filas = hourly.time
        .map((t: string, i: number) => ({ t, i }))
        .filter(({ t }: { t: string }) => new Date(t).getTime() > Date.now())
        .map(({ t, i }: { t: string; i: number }) => ({
          timestamp: new Date(t).toISOString(),
          velocidad_kmh: hourly.wind_speed_10m[i],
          direccion_grados: hourly.wind_direction_10m[i],
          presion_hpa: hourly.surface_pressure[i] ?? null,
          lat,
          lon,
        }));

      if (filas.length > 0) {
        // Reemplazo por ventana: borrar pronósticos pasados y futuros lejanos, upsert del resto
        const maxT = filas[filas.length - 1].timestamp;
        await supabase.from("viento_pronostico").delete().gt("timestamp", maxT);
        const { error: upsertErr } = await supabase
          .from("viento_pronostico")
          .upsert(filas, { onConflict: "timestamp" });
        if (upsertErr) {
          console.error("[ingest-viento] Error upsert pronóstico:", upsertErr.message);
        } else {
          console.log(`[ingest-viento] Pronóstico upsert: ${filas.length} filas`);
        }
      }
    }

    await supabase.functions.invoke("evaluar-alerta", {
      body: { triggered_by: "ingest-viento" },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        viento: {
          velocidad_kmh: current.wind_speed_10m,
          direccion_grados: current.wind_direction_10m,
        },
        pronostico_filas: hourly?.time?.length ?? 0,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ingest-viento] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
