import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ws2 no está tras Cloudflare (el token se obtiene sin challenge); www como fallback
const SMN_PAGES = ["https://ws2.smn.gob.ar/alertas", "https://www.smn.gob.ar/alertas"];
const SMN_WS = "https://ws1.smn.gob.ar/v1/warning/alert/area?mode=alert&compact=true";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

interface EventoSmn {
  id: number;
  max_level: number;
}

interface WarningSmn {
  date: string;
  max_level: number;
  events: EventoSmn[];
}

interface AreaSmn {
  area_id: number;
  updated: string;
  warnings: WarningSmn[] | null;
}

async function obtenerToken(): Promise<string> {
  let lastErr: Error | null = null;
  for (const page of SMN_PAGES) {
    try {
      const res = await fetch(page, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "es-AR,es;q=0.9",
        },
      });
      if (!res.ok) throw new Error(`SMN page HTTP ${res.status}`);
      const html = await res.text();
      const m = html.match(/localStorage\.setItem\(['"]token['"],\s*['"]([^'"]+)['"]\)/);
      if (m) return m[1];
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw new Error(`token SMN no encontrado: ${lastErr?.message ?? "sin respuesta"}`);
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Áreas de interés desde configuración (por defecto 763 = zona de la escuela)
    const { data: cfg, error: errCfg } = await supabase
      .from("configuracion")
      .select("valor")
      .eq("clave", "smn_areas_interes")
      .maybeSingle();
    if (errCfg) throw errCfg;

    const areasInteres = (cfg?.valor ?? "763")
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    if (areasInteres.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "sin áreas de interés" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const token = await obtenerToken();

    const res = await fetch(SMN_WS, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Authorization": `JWT ${token}`,
        "Referer": "https://ws2.smn.gob.ar/alertas",
      },
    });
    if (!res.ok) throw new Error(`SMN WS HTTP ${res.status}`);
    const areas = (await res.json()) as AreaSmn[];

    const filas: {
      area_id: number;
      fecha: string;
      max_level: number;
      eventos_json: EventoSmn[];
      actualizado: string;
    }[] = [];

    for (const area of areas) {
      if (!areasInteres.includes(area.area_id)) continue;
      if (!area.warnings) continue;

      for (const w of area.warnings) {
        filas.push({
          area_id: area.area_id,
          fecha: w.date,
          max_level: w.max_level,
          eventos_json: w.events ?? [],
          actualizado: area.updated,
        });
      }
    }

    if (filas.length > 0) {
      const { error: errUpsert } = await supabase.from("alertas_smn").upsert(filas, {
        onConflict: "area_id,fecha",
      });
      if (errUpsert) throw errUpsert;
    }

    return new Response(JSON.stringify({ ok: true, areas: areasInteres, filas: filas.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[ingest-alertas-smn] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
