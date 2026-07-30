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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`;
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
      lat,
      lon,
    });

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
