import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

function parseNum(texto: string): number {
  const nums = texto.match(/\d+/g);
  return nums ? parseInt(nums.join("."), 10) : 0;
}

function parseAltura(texto: string): number {
  const m = texto.trim().replace(",", ".");
  return parseFloat(m) || 0;
}

function textoANumero(texto: string): number {
  const mapa: Record<string, number> = {
    "cero": 0, "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4,
    "cinco": 5, "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10,
    "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15,
    "veinte": 20, "treinta": 30, "cuarenta": 40, "cincuenta": 50,
    "sesenta": 60, "setenta": 70, "ochenta": 80, "noventa": 90, "cien": 100,
  };
  const palabras = texto.toLowerCase().split(/\s+/);
  let total = 0;
  for (const p of palabras) {
    if (mapa[p]) total += mapa[p];
  }
  return total;
}

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
    if (!res.ok) throw new Error(`SHN error ${res.status}`);
    const html = await res.text();

    let correccionCm = 0;
    let validoDesde = "";
    let validoHasta = "";

    // Parsear período de validez
    const validezMatch = html.match(/DESDE LAS\s*<STRONG>(\d{2}:\d{2})<\/STRONG>\s*Hs\s*DE\s*(\d{2}\/\d{2}\/\d{4})[\s\S]*?HASTA LAS\s*<STRONG>(\d{2}:\d{2})<\/STRONG>\s*Hs\s*DE\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (validezMatch) {
      validoDesde = `${validezMatch[1]} ${validezMatch[2]}`;
      validoHasta = `${validezMatch[3]} ${validezMatch[4]}`;
      console.log(`[ingest-shn] Vigencia: ${validoDesde} → ${validoHasta}`);
    }

    // Parsear corrección (texto: "CUARENTA CENTÍMETROS...")
    const correccionMatch = html.match(/<p><strong>([^<]+?)<\/strong><\/p>/i);
    if (correccionMatch) {
      const texto = correccionMatch[1];
      // Buscar números escritos en palabras
      const palabras = texto.toLowerCase();
      const numeros = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
        "once", "doce", "trece", "catorce", "quince", "veinte", "treinta", "cuarenta", "cincuenta",
        "sesenta", "setenta", "ochenta", "noventa", "cien"];
      let maxValor = 0;
      for (const n of numeros) {
        if (palabras.includes(n)) {
          const v = textoANumero(n);
          if (v > maxValor) maxValor = v;
        }
      }
      correccionCm = maxValor || 40; // default 40 si no se puede parsear
      console.log(`[ingest-shn] Corrección: ${correccionCm}cm — "${texto.trim().slice(0, 100)}"`);
    }

    // Parsear tabla de valores corregidos
    const tablas = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
    for (const tabla of tablas) {
      const caption = (tabla.match(/<caption>([^<]+)<\/caption>/i) || [])[1] || "";
      if (!caption.toLowerCase().includes("corregidos")) continue;

      const filas = tabla.match(/<tr>[\s\S]*?<\/tr>/gi) || [];
      for (const fila of filas) {
        const celdas = fila.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
        if (!celdas || celdas.length < 5) continue;

        const lugar = celdas[0].replace(/<[^>]+>/g, "").trim();
        const estado = celdas[1].replace(/<[^>]+>/g, "").trim().toUpperCase();
        const hora = celdas[2].replace(/<[^>]+>/g, "").trim();
        const alturaStr = celdas[3].replace(/<[^>]+>/g, "").trim();
        const fecha = celdas[4].replace(/<[^>]+>/g, "").trim();

        if (!lugar || lugar === "LUGAR") continue;
        if (hora === "---" || !/^\d{1,2}:\d{2}$/.test(hora)) continue;
        if (alturaStr === "---" || isNaN(parseFloat(alturaStr.replace(",", ".")))) continue;

        const altura = parseAltura(alturaStr);
        const [dd, mm, yyyy] = fecha.split("/").map(Number);
        const [hh, min] = hora.split(":").map(Number);
        const tsDesde = new Date(yyyy, mm - 1, dd, hh, min);
        const tsHasta = new Date(tsDesde.getTime() + 6 * 60 * 60 * 1000);

        const nombreLugar = lugar.includes("LA PLATA") ? "La Plata"
          : lugar.includes("BUENOS AIRES") ? "Puerto de Buenos Aires"
          : lugar.includes("SAN FERNANDO") ? "San Fernando"
          : lugar.includes("MARTIN") || lugar.includes("MARTÍN") ? "Isla Martín García"
          : lugar.trim();

        await supabase.from("mareas").insert({
          timestamp_desde: tsDesde.toISOString(),
          timestamp_hasta: tsHasta.toISOString(),
          correccion_cm: correccionCm,
          lugar: nombreLugar,
        });
        console.log(`[ingest-shn] ${nombreLugar}: ${estado} ${hora} ${altura}m`);
      }
    }

    // Guardar la corrección como alerta de marea
    await supabase.from("mareas").insert({
      timestamp_desde: validoDesde || new Date().toISOString(),
      timestamp_hasta: validoHasta || new Date().toISOString(),
      correccion_cm: correccionCm,
      lugar: "Corrección general Río de la Plata Interior",
    });

    return new Response(JSON.stringify({
      ok: true,
      correccion_cm: correccionCm,
      vigencia_desde: validoDesde,
      vigencia_hasta: validoHasta,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[ingest-shn] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
