import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALTURAS_URL = "https://www.hidro.gov.ar/oceanografia/AlturasHorarias.asp";

// Mapeo nombre de mareógrafo (SHN) → nombre de estación en BD
const MAREOGRAFO_A_BD: Record<string, string> = {
  "San Fernando": "San Fernando (Brazo Luján)",
  "La Plata": "La Plata",
  "Buenos Aires": "Puerto de Buenos Aires",
  "Pilote Norden": "Pilote Norden",
};

interface Columna {
  fechaISO: string; // fecha en hora local ART (sin zona)
  hora: string; // HH:MM local ART
}

function clean(cell: string): string {
  return cell
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const res = await fetch(ALTURAS_URL);
    if (!res.ok) {
      throw new Error(`SHN error ${res.status}`);
    }
    const html = await res.text();

    const tabla = html.match(/<table[^>]*>[\s\S]*?<\/table>/i)?.[0];
    if (!tabla) throw new Error("Tabla de alturas no encontrada");

    const filas = tabla.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    if (filas.length < 2) throw new Error("Sin filas de datos");

    // Cabecera: columnas de fecha/hora (desde la más reciente)
    const headers = (filas[0].match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [])
      .slice(2)
      .map(clean);

    const columnas: Columna[] = headers.map((h) => {
      const m = h.match(/(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2})/);
      return {
        fechaISO: m ? m[1] : "",
        hora: m ? m[2] : "",
      };
    });

    const { data: estaciones, error: errEst } = await supabase
      .from("estaciones")
      .select("id, nombre");
    if (errEst) throw errEst;

    const nombreToId: Record<string, string> = {};
    for (const e of estaciones) {
      nombreToId[e.nombre] = e.id;
    }

    const resultados: { estacion: string; ok: boolean; count: number; error?: string }[] = [];
    let allOk = true;

    for (let i = 1; i < filas.length; i++) {
      const celdas = (filas[i].match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(clean);
      if (celdas.length < 3) continue;

      const nombreMareografo = celdas[1];
      const nombreBD = Object.keys(MAREOGRAFO_A_BD).find((k) =>
        nombreMareografo.includes(k)
      )
        ? MAREOGRAFO_A_BD[Object.keys(MAREOGRAFO_A_BD).find((k) => nombreMareografo.includes(k))!]
        : undefined;
      if (!nombreBD) continue;

      const estacionId = nombreToId[nombreBD];
      if (!estacionId) {
        resultados.push({ estacion: nombreBD, ok: false, count: 0, error: "no mapeada en BD" });
        allOk = false;
        continue;
      }

      let inserted = 0;
      for (let c = 0; c < columnas.length; c++) {
        const valorStr = celdas[c + 2];
        if (valorStr === "---" || valorStr === "" || isNaN(parseFloat(valorStr))) continue;

        const col = columnas[c];
        if (!col.fechaISO || !col.hora) continue;

        const [dd, mm, yyyy] = col.fechaISO.split("/").map(Number);
        const [hh, min] = col.hora.split(":").map(Number);
        // El sitio publica en hora local argentina (ART, UTC-3)
        const ts = new Date(Date.UTC(yyyy, mm - 1, dd, hh, min) + 3 * 3600 * 1000).toISOString();
        const nivel_m = parseFloat(valorStr);

        // Evitar duplicados con la misma estación+timestamp
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
          nivel_m,
          tipo: "observado",
        });

        if (insertErr) {
          console.error(`[ingest-alturas-horarias] Error insertando ${nombreBD}: ${insertErr.message}`);
        } else {
          inserted++;
        }
      }

      resultados.push({ estacion: nombreBD, ok: true, count: inserted });
    }

    try {
      await supabase.functions.invoke("evaluar-alerta", {
        body: JSON.stringify({ triggered_by: "ingest-alturas-horarias" }),
      });
    } catch {
      // ignore
    }

    return new Response(JSON.stringify({ ok: allOk, resultados }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[ingest-alturas-horarias] Error general:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
