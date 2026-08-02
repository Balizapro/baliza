import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Avisos, Alertas y Ceses Mareológicos para el Río de la Plata — aviso OFICIAL de crecida.
const AVISO_URL = "https://www.hidro.gov.ar/oceanografia/AACRIOPLA.asp";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// El sitio entrega HTML en UTF-8 correcto (verificado en bytes). Se limpia de etiquetas.
function limpiarTexto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&Aacute;/gi, "Á").replace(/&Eacute;/gi, "É")
    .replace(/&Iacute;/gi, "Í").replace(/&Oacute;/gi, "Ó")
    .replace(/&Uacute;/gi, "Ú").replace(/&Ntilde;/gi, "Ñ")
    .replace(/&aacute;/gi, "á").replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í").replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú").replace(/&ntilde;/gi, "ñ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

interface Altura {
  puerto: string;
  altura_m: number;
  hora: string;
  fecha: string;
}

function parsearAlturas(html: string): Altura[] {
  const tablas = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  const alturas: Altura[] = [];
  for (const tabla of tablas) {
    const filas = tabla.match(/<tr>[\s\S]*?<\/tr>/gi) || [];
    for (const fila of filas) {
      const celdas = fila.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
      if (!celdas || celdas.length < 4) continue;
      const puerto = limpiarTexto(celdas[0]).trim();
      const altura = parseFloat(limpiarTexto(celdas[1]).replace(",", "."));
      const hora = limpiarTexto(celdas[2]).trim();
      const fecha = limpiarTexto(celdas[3]).trim();
      if (!puerto || isNaN(altura) || !/^\d{2}:\d{2}$/.test(hora) || !/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) continue;
      if (puerto === "Puerto" || puerto === "Altura (m)") continue;
      alturas.push({ puerto, altura_m: altura, hora, fecha });
    }
  }
  return alturas;
}

// dd/mm/yyyy HH:MM → ISO
function fechaEmitido(fechaTexto: string): string {
  const m = fechaTexto.match(/(\d{2})\s+DE\s+([A-Z]+)\s+DE\s+(\d{4}),?\s*(\d{2}):(\d{2})/i);
  if (!m) return new Date().toISOString();
  const meses: Record<string, number> = {
    ENERO: 0, FEBRERO: 1, MARZO: 2, ABRIL: 3, MAYO: 4, JUNIO: 5,
    JULIO: 6, AGOSTO: 7, SEPTIEMBRE: 8, OCTUBRE: 9, NOVIEMBRE: 10, DICIEMBRE: 11,
  };
  const mes = meses[m[2].toUpperCase()];
  if (mes === undefined) return new Date().toISOString();
  return new Date(Number(m[3]), mes, Number(m[1]), Number(m[4]), Number(m[5])).toISOString();
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    console.log(`[ingest-aviso-crecida] Fetching: ${AVISO_URL}`);
    const res = await fetch(AVISO_URL, {
      headers: { "User-Agent": USER_AGENT, "Accept": "text/html" },
    });
    if (!res.ok) throw new Error(`SHN error ${res.status}`);
    const html = await res.text();

    const h2 = html.match(/<H2[^>]*>([\s\S]*?)<\/H2>/i);
    if (!h2) {
      return new Response(JSON.stringify({ ok: false, error: "titulo del aviso no encontrado" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const titulo = limpiarTexto(h2[1]).trim();

    const tipoMatch = titulo.match(/^(AVISO|ALERTA|CESE)\s+(?:DE\s+AVISO\s+)?POR\s+(CRECIDA|BAJANTE|VIENTO|ESTADO|NAVEGACI)/i);
    const tipo = tipoMatch ? `${tipoMatch[1].toLowerCase()}_${tipoMatch[2].toLowerCase().replace(/[^a-z]/g, "")}` : "aviso_crecida";
    const numMatch = titulo.match(/Nro\.?\s*(\d+)/i);
    const numero = numMatch ? `Nro. ${numMatch[1]}` : titulo.slice(0, 40);

    const emitidoP = html.match(/<p>\s*([^<]*?\d{2}\s+DE\s+[A-Z]+\s+DE\s+\d{4}[^<]*)<\/p>/i);
    const emitido = fechaEmitido(emitidoP ? emitidoP[1] : "");

    // Texto del aviso: primer <p> largo después del H2
    const cuerpoP = html.match(/<\/H2>[\s\S]*?<p>\s*([^<]{40,}?)<\/p>/i);
    const texto = cuerpoP ? limpiarTexto(cuerpoP[1]).trim() : titulo;

    const nota = limpiarTexto((html.match(/<strong>NOTA:<\/strong>([\s\S]*?)<\/p>/i) || [])[1] ?? "").trim();

    const alturas = parsearAlturas(html);

    const fila = {
      numero,
      tipo,
      titulo,
      texto,
      emitido,
      nota: nota || null,
      alturas: alturas.length > 0 ? (alturas as unknown as object) : null,
      vigente: true,
      actualizado: new Date().toISOString(),
    };

    const { error: errUpsert } = await supabase.from("avisos_crecida").upsert(fila, {
      onConflict: "numero,tipo",
    });
    if (errUpsert) throw errUpsert;

    const sanFernando = alturas.find((a) => a.puerto.toUpperCase().includes("SAN FERNANDO")) ?? null;

    return new Response(
      JSON.stringify({
        ok: true,
        numero,
        tipo,
        emitido,
        alturas: alturas.length,
        san_fernando_m: sanFernando?.altura_m ?? null,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ingest-aviso-crecida] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
