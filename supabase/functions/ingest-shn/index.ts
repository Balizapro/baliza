import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const url = "https://www.hidro.gov.ar/oceanografia/pronostico.asp";
    console.log(`[ingest-shn] Fetching: ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`SHN error ${res.status}`);
    }

    const html = await res.text();
    console.log(`[ingest-shn] HTML size: ${html.length} bytes`);

    // Buscar tabla de mareas en el HTML
    // Formato típico: filas con hora, altura, corrección
    const lineaRegex = /(\d{2}:\d{2})\s*.*?(\d+\.?\d*)\s*.*?([+-]\d+)/gi;
    let match;
    let count = 0;

    while ((match = lineaRegex.exec(html)) !== null) {
      const hora = match[1];
      const correccion = parseInt(match[3], 10);

      // Construir timestamp para hoy a esa hora
      const now = new Date();
      const [hh, mm] = hora.split(":").map(Number);
      const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);

      await supabase.from("mareas").insert({
        timestamp_desde: ts.toISOString(),
        timestamp_hasta: new Date(ts.getTime() + 60 * 60 * 1000).toISOString(),
        correccion_cm: correccion,
        lugar: "San Fernando",
      });

      count++;
    }

    console.log(`[ingest-shn] ${count} registros de marea insertados`);

    return new Response(
      JSON.stringify({ ok: true, registros_insertados: count }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ingest-shn] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
