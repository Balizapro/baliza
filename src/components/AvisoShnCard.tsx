import type { AvisoShn } from "@/lib/types";

const TITULO_TIPO: Record<string, string> = {
  pronostico_mareologico: "Pronóstico mareológico",
  pronostico_olas: "Pronóstico de olas",
  dragado: "Operaciones de dragado",
  balizamiento: "Balizamiento",
  novedad: "Novedad",
};

const TENDENCIA_UI = {
  ascendente: { label: "ascendente", arrow: "↑", color: "text-[#C0442B]" },
  descendente: { label: "descendente", arrow: "↓", color: "text-[#4C7A5E]" },
} as const;

function formatearFecha(publicado: string | null): string {
  if (!publicado) return "";
  const m = publicado.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("es-AR", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }
  const [dd, mm, yyyy] = publicado.split("/");
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
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

export default function AvisoShnCard({ avisos, umbralNR }: { avisos: AvisoShn[]; umbralNR?: number | null }) {
  const mareologico = [...avisos]
    .filter((a) => a.tipo === "pronostico_mareologico")
    .sort((a, b) => (b.publicado ?? "").localeCompare(a.publicado ?? ""))[0];

  const otros = avisos
    .filter((a) => a.tipo !== "pronostico_mareologico")
    .sort((a, b) => (b.publicado ?? "").localeCompare(a.publicado ?? ""))
    .slice(0, 3);

  if (!mareologico && otros.length === 0) return null;

  const obs = mareologico ? observacionesInteriores(mareologico.texto) : null;
  const vig = mareologico ? vigencia(mareologico.texto) : null;
  const tend = mareologico?.tendencia ? TENDENCIA_UI[mareologico.tendencia] : null;

  const nivelMax = mareologico?.nivel_max_m ?? null;
  const umbral = umbralNR ?? 2.2;
  const superaNR = nivelMax != null && nivelMax > umbral;

  return (
    <section className={`dashboard-section ${superaNR ? "shn-alerta" : ""}`}>
      <p className="seccion-titulo mb-2">
        Aviso del SHN — Río de la Plata
      </p>

      {mareologico && (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[#12312B] dark:text-gray-200">
                {TITULO_TIPO[mareologico.tipo]} — aviso {mareologico.numero}
              </p>
              {vig && (
                <p className="text-xs text-[#5B6E68]/70 dark:text-gray-500">
                  {vig}
                </p>
              )}
              {mareologico.publicado && (
                <p className="text-xs font-mono text-[#5B6E68]/60 dark:text-gray-500">
                  {formatearFecha(mareologico.publicado)}
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

          {obs && (
            <p className="text-sm text-[#5B6E68] dark:text-gray-400 whitespace-pre-line leading-snug">
              {obs}
            </p>
          )}
        </div>
      )}

      {otros.length > 0 && (
        <div className="border-t border-[#F2E9DC] dark:border-gray-700 mt-3 pt-2 space-y-1">
          {otros.map((a) => (
            <div key={a.numero} className="flex items-center justify-between text-xs">
              <span className="text-[#5B6E68] dark:text-gray-400">
                {TITULO_TIPO[a.tipo]} — aviso {a.numero}
              </span>
              <span className="font-mono text-[#5B6E68]/60 dark:text-gray-500">
                {formatearFecha(a.publicado)}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-[#5B6E68]/40 dark:text-gray-600 mt-3">
        Fuente: Servicio de Hidrografía Naval — radioavisos náuticos
      </p>
    </section>
  );
}
