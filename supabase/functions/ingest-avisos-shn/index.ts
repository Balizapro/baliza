import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Radioavisos náuticos del SHN (pronóstico mareológico, olas, dragado, balizamiento)
const AVISOS_URL = "https://www.hidro.gov.ar/nautica/RadioavisosNauticos.asp?op=10";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function limpiarTexto(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "-")
    .replace(/&Aacute;/gi, "Á")
    .replace(/&Eacute;/gi, "É")
    .replace(/&Iacute;/gi, "Í")
    .replace(/&Oacute;/gi, "Ó")
    .replace(/&Uacute;/gi, "Ú")
    .replace(/&Ntilde;/gi, "Ñ")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sinAcentos(texto: string): string {
  return texto
    .toUpperCase()
    .replace(/Á/g, "A").replace(/É/g, "E").replace(/Í/g, "I")
    .replace(/Ó/g, "O").replace(/Ú/g, "U").replace(/Ñ/g, "N");
}

// Clasifica el aviso por su texto. Prioriza la tendencia (zona de la escuela).
function clasificarTipo(texto: string): string {
  const t = sinAcentos(texto);
  if (t.includes("MAREOLOGICO")) return "pronostico_mareologico";
  if (t.includes("PRONOSTICO DE OLAS")) return "pronostico_olas";
  if (t.includes("BALIZAMIENT")) return "balizamiento";
  if (t.includes("DRAGAD")) return "dragado";
  return "novedad";
}

// Tendencia del sector interior del Río de la Plata (zona de San Fernando)
function extraerTendencia(texto: string): string | null {
  const interior = texto.match(
    /RIO DE LA PLATA INTERIOR:([\s\S]*?)(?:RIO DE LA PLATA EXTERIOR:|PERSPECTIVAS|$)/i
  );
  const sector = interior ? interior[1] : texto;
  const m = sector.match(/TENDENCIA\s+(?:EN\s+LEVE\s+)?(ASCENDENTE|DESCENDENTE)/i);
  if (!m) return null;
  return m[1].toLowerCase();
}

// Altura máxima pronosticada para San Fernando (m), extraída de la tabla
// "Corrección de altura de Tablas de Marea". Toma el mayor valor PLEAMAR/BAJAMAR.
function extraerNivelMaxSanFernando(texto: string): number | null {
  const bloque = texto.match(/SAN\s+FERNANDO([\s\S]*?)(?:RIO DE LA PLATA EXTERIOR:|PUERTO\s+[A-Z]|$)/i);
  if (!bloque) return null;

  const alturas: number[] = [];
  for (const linea of bloque[1].split("\n")) {
    const m = linea.match(/(?:BAJAMAR|PLEAMAR)\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s+([+-]?\d+(?:\.\d+)?)/i);
    if (m) alturas.push(parseFloat(m[1]));
  }
  if (alturas.length === 0) return null;
  return Math.max(...alturas);
}

interface Aviso {
  numero: string;
  tipo: string;
  titulo: string;
  texto: string;
  tendencia: string | null;
  publicado: string | null;
  nivel_max_m: number | null;
}

function parsearAvisos(html: string): Aviso[] {
  const pre = html.match(/<pre[^>]*class="texto_radioaviso[^"]*"[^>]*>([\s\S]*?)<\/pre>/i);
  if (!pre) throw new Error("Bloque de radioavisos no encontrado");

  const bloques = pre[1].split(/(?=<H2>)/i).filter((b) => /<H2>/i.test(b));

  const avisos: Aviso[] = [];
  for (const bloque of bloques) {
    const h2 = bloque.match(/<H2[^>]*>([\s\S]*?)<\/H2>([\s\S]*)$/i);
    if (!h2) continue;

    const cabecera = limpiarTexto(h2[1]);
    const cuerpo = limpiarTexto(h2[2]);

    const numMatch = cabecera.match(/(\d{3,4}-\d{4})/);
    const fechaMatch = cabecera.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (!numMatch || !fechaMatch) continue;

    const lineas = cuerpo.split("\n").map((l) => l.trim()).filter(Boolean);
    const titulo = lineas[0] ?? "";
    const texto = lineas.join("\n");

    avisos.push({
      numero: numMatch[1],
      tipo: clasificarTipo(texto),
      titulo,
      texto,
      tendencia: extraerTendencia(texto),
      nivel_max_m: extraerNivelMaxSanFernando(texto),
      publicado: fechaMatch[1],
    });
  }

  return avisos;
}

// dd/mm/yyyy → yyyy-mm-dd (formato DATE de Postgres)
function fechaISO(fecha: string): string {
  const [dd, mm, yyyy] = fecha.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    console.log(`[ingest-avisos-shn] Fetching: ${AVISOS_URL}`);
    const res = await fetch(AVISOS_URL, {
      headers: { "User-Agent": USER_AGENT, "Accept": "text/html" },
    });
    if (!res.ok) throw new Error(`SHN error ${res.status}`);
    const html = await res.text();

    const avisos = parsearAvisos(html);
    if (avisos.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "sin avisos parseados" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const filas = avisos.map((a) => ({
      numero: a.numero,
      tipo: a.tipo,
      titulo: a.titulo,
      texto: a.texto,
      tendencia: a.tendencia,
      nivel_max_m: a.nivel_max_m,
      publicado: a.publicado ? fechaISO(a.publicado) : null,
      actualizado: new Date().toISOString(),
    }));

    const { error: errUpsert } = await supabase.from("avisos_shn").upsert(filas, {
      onConflict: "numero,tipo",
    });
    if (errUpsert) throw errUpsert;

    return new Response(
      JSON.stringify({
        ok: true,
        total: avisos.length,
        mareologico: avisos.filter((a) => a.tipo === "pronostico_mareologico").length,
        olas: avisos.filter((a) => a.tipo === "pronostico_olas").length,
        balizamiento: avisos.filter((a) => a.tipo === "balizamiento").length,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ingest-avisos-shn] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
