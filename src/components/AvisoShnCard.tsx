import type { AvisoShn } from "@/lib/types";
import CompartirWhatsApp from "@/components/CompartirWhatsApp";

const TENDENCIA_UI = {
  ascendente: { label: "ascendente", arrow: "↑", color: "text-[#C0442B]" },
  descendente: { label: "descendente", arrow: "↓", color: "text-[#4C7A5E]" },
} as const;

function formatearAlturaFecha(fecha: string): string {
  const [dd, mm, yyyy] = fecha.split("/");
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

// Extrae las Observaciones del sector "RIO DE LA PLATA INTERIOR" (zona de la escuela).
function observacionesInteriores(texto: string): string | null {
  const m = texto.match(
    /RIO DE LA PLATA INTERIOR:[\s\S]*?Observaciones[\s\S]*?\n?([\s\S]*?)(?:Correcci[oó]n|RIO DE LA PLATA EXTERIOR)/i
  );
  return m ? m[1].trim() : null;
}

function vigencia(texto: string): string | null {
  const m = texto.match(/V[áa]lido desde el\s*([\d\/\s:hH]+?)\s*hs hasta el\s*([\d\/\s:hH]+?)\s*hs/i);
  if (!m) return null;
  return `${m[1].trim()} → ${m[2].trim()}`;
}

// Alturas pronosticadas para San Fernando: [{ estado, fecha, hora, altura }]
function alturasSanFernando(texto: string): { estado: string; fecha: string; hora: string; altura: number }[] {
  const bloque = texto.match(/SAN\s+FERNANDO([\s\S]*?)(?:RIO DE LA PLATA EXTERIOR:|PUERTO\s+[A-Z]|$)/i);
  if (!bloque) return [];

  const filas: { estado: string; fecha: string; hora: string; altura: number }[] = [];
  for (const linea of bloque[1].split("\n")) {
    const m = linea.match(/(BAJAMAR|PLEAMAR)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s+([+-]?\d+(?:\.\d+)?)/i);
    if (m) {
      filas.push({ estado: m[1], fecha: m[2], hora: m[3], altura: parseFloat(m[4]) });
    }
  }
  return filas;
}

export default function AvisoShnCard({ avisos, umbralNR }: { avisos: AvisoShn[]; umbralNR?: number | null }) {
  const mareologico = [...avisos]
    .filter((a) => a.tipo === "pronostico_mareologico")
    .sort((a, b) => (b.publicado ?? "").localeCompare(a.publicado ?? ""))[0];

  if (!mareologico) return null;

  const obs = observacionesInteriores(mareologico.texto);
  const vig = vigencia(mareologico.texto);
  const tend = mareologico.tendencia ? TENDENCIA_UI[mareologico.tendencia] : null;
  const alturas = alturasSanFernando(mareologico.texto);

  const nivelMax = mareologico.nivel_max_m ?? (alturas.length > 0 ? Math.max(...alturas.map((a) => a.altura)) : null);
  const umbral = umbralNR ?? 2.2;
  const superaNR = nivelMax != null && nivelMax > umbral;

  return (
    <section className={`dashboard-section ${superaNR ? "shn-alerta" : ""}`}>
      <p className="seccion-titulo mb-2">
        Aviso del SHN — Río de la Plata
      </p>

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[#12312B] dark:text-gray-200">
              Pronóstico mareológico — aviso {mareologico.numero}
            </p>
            {vig && (
              <p className="text-xs text-[#5B6E68]/70 dark:text-gray-500">
                {vig}
              </p>
            )}
          </div>
          {tend && (
            <p className={`text-sm font-bold whitespace-nowrap ${tend.color}`}>
              {tend.arrow} {tend.label}
            </p>
          )}
        </div>

        {superaNR && (
          <div className="flex items-center gap-2 text-[#C0442B] dark:text-[#E5604A] font-bold text-sm">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current flex-shrink-0"><path d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z"/></svg>
            <span>
              SHN pronostica {nivelMax?.toFixed(2)}m en San Fernando — supera el nivel de no retorno ({umbral.toFixed(1)}m)
            </span>
          </div>
        )}

        {alturas.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-[#5B6E68] dark:text-gray-400 mb-1.5">
              Alturas pronosticadas — San Fernando
            </p>
            <div className="space-y-1">
              {alturas.map((a, i) => {
                const esMax = a.altura === nivelMax;
                const esPleamar = a.estado === "PLEAMAR";
                return (
                  <div key={i} className={`flex items-center justify-between text-sm rounded-lg px-3 py-1.5 ${esMax ? "bg-[#0E4749]/10 dark:bg-white/10 font-bold" : ""}`}>
                    <span className="text-[#12312B] dark:text-gray-200">
                      {esPleamar ? "Pleamar" : "Bajamar"}
                      <span className="text-xs text-[#5B6E68] dark:text-gray-400 ml-2">
                        {formatearAlturaFecha(a.fecha)} {a.hora}
                      </span>
                    </span>
                    <span className={`font-mono ${esMax ? "text-[#0E4749] dark:text-[#4fc3c5]" : "text-[#5B6E68] dark:text-gray-400"}`}>
                      {a.altura.toFixed(2)}m {esMax ? "· máx" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {obs && (
          <p className="text-sm text-[#5B6E68] dark:text-gray-400 whitespace-pre-line leading-snug">
            {obs}
          </p>
        )}
      </div>

      <div className="mt-3">
        <CompartirWhatsApp
          small
          mensaje={[
            `🌊 Baliza — Aviso SHN (${mareologico.numero})`,
            `Pronóstico mareológico — Río de la Plata`,
            vig ? `Vigencia: ${vig}` : null,
            alturas.length > 0 ? alturas.map((a) => `${a.estado === "PLEAMAR" ? "Pleamar" : "Bajamar"} ${formatearAlturaFecha(a.fecha)} ${a.hora}: ${a.altura.toFixed(2)}m`).join("\n") : null,
            superaNR ? `⚠ Supera el nivel de no retorno (${umbral.toFixed(1)}m)` : null,
            `⚠ Más info: https://baliza-ashy.vercel.app`,
          ].filter(Boolean).join("\n")}
        />
      </div>

      <p className="text-[10px] text-[#5B6E68]/40 dark:text-gray-600 mt-3">
        Fuente: Servicio de Hidrografía Naval — radioavisos náuticos
      </p>
    </section>
  );
}
