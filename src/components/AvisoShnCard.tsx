"use client";

import type { AvisoShn } from "@/lib/types";
import CompartirWhatsApp from "@/components/CompartirWhatsApp";
import { useAhora } from "@/lib/useAhora";

const TENDENCIA_UI = {
  ascendente: { label: "ascendente", arrow: "↑", color: "text-rojo-alerta" },
  descendente: { label: "descendente", arrow: "↓", color: "text-ok" },
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

// Fin de vigencia (timestamp ms) para no alertar sobre un pronóstico vencido.
function vigenciaFin(texto: string): number | null {
  const m = texto.match(
    /V[áa]lido desde el\s*([\d\/]+)\s+(\d{1,2}):(\d{2})\s*hs hasta el\s*([\d\/]+)\s+(\d{1,2}):(\d{2})\s*hs/i
  );
  if (!m) return null;
  const [dd, mm, yyyy] = m[4].split("/").map(Number);
  return new Date(yyyy, mm - 1, dd, Number(m[5]), Number(m[6])).getTime();
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
  const ahora = useAhora();
  const mareologico = [...avisos]
    .filter((a) => a.tipo === "pronostico_mareologico")
    .sort((a, b) => {
      const pc = (b.publicado ?? "").localeCompare(a.publicado ?? "");
      if (pc !== 0) return pc;
      return (parseInt(b.numero) || 0) - (parseInt(a.numero) || 0);
    })[0];

  if (!mareologico) return null;

  const obs = observacionesInteriores(mareologico.texto);
  const vig = vigencia(mareologico.texto);
  const tend = mareologico.tendencia ? TENDENCIA_UI[mareologico.tendencia] : null;
  const alturas = alturasSanFernando(mareologico.texto);

  const nivelMax = mareologico.nivel_max_m ?? (alturas.length > 0 ? Math.max(...alturas.map((a) => a.altura)) : null);
  const umbral = umbralNR ?? 2.2;
  const finVig = vigenciaFin(mareologico.texto);
  const vencido = finVig != null && finVig < ahora;
  const superaNR = !vencido && nivelMax != null && nivelMax > umbral;

  return (
    <section className={`dashboard-section ${superaNR ? "shn-alerta" : ""}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h2 className="seccion-titulo">
          Aviso del SHN — Río de la Plata
        </h2>
        {vencido && (
          <span className="text-xs px-2 py-0.5 rounded-full border border-atencion/40 text-atencion dark:text-atencion-dark whitespace-nowrap shrink-0">
            pronóstico vencido
          </span>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-texto dark:text-gray-200">
              Pronóstico mareológico — aviso {mareologico.numero}
            </p>
            {vig && (
              <p className="text-xs text-texto-sec dark:text-gray-400">
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
          <div className="flex items-center gap-2 text-rojo-alerta dark:text-rojo-dark font-bold text-sm">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current flex-shrink-0"><path d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z"/></svg>
            <span>
              SHN pronostica {nivelMax?.toFixed(2)}m en San Fernando — supera el nivel de no retorno ({umbral.toFixed(1)}m)
            </span>
          </div>
        )}

        {alturas.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-texto-sec dark:text-gray-400 mb-1.5">
              Alturas pronosticadas — San Fernando
            </p>
            <div className="space-y-1">
              {alturas.map((a, i) => {
                const esMax = a.altura === nivelMax;
                const esPleamar = a.estado === "PLEAMAR";
                return (
                  <div key={i} className={`flex items-center justify-between text-sm rounded-lg px-3 py-1.5 ${esMax ? "bg-baliza/10 dark:bg-white/10 font-bold" : ""}`}>
                    <span className="text-texto dark:text-gray-200">
                      {esPleamar ? "Pleamar" : "Bajamar"}
                      <span className="text-xs text-texto-sec dark:text-gray-400 ml-2">
                        {formatearAlturaFecha(a.fecha)} {a.hora}
                      </span>
                    </span>
                    <span className={`font-mono ${esMax ? "text-baliza dark:text-marea-dark" : "text-texto-sec dark:text-gray-400"}`}>
                      {a.altura.toFixed(2)}m {esMax ? "· máx" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {obs && (
          <p className="text-sm text-texto-sec dark:text-gray-400 whitespace-pre-line leading-snug">
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

      <p className="text-xs text-texto-sec dark:text-gray-400 mt-3">
        Fuente: Servicio de Hidrografía Naval — radioavisos náuticos
      </p>
    </section>
  );
}
