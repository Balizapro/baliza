"use client";

import type { AvisoShn } from "@/lib/types";
import type { Tendencia } from "@/lib/types";
import { alturasSanFernando } from "@/lib/shn";

interface Props {
  avisos: AvisoShn[];
  nivelActual: number | null;
  tendencia: Tendencia | null;
  ahora: number;
}

// Convierte "DD/MM/YYYY HH:MM" (local) a timestamp ms.
function tsAltura(fecha: string, hora: string): number {
  const [dd, mm, yyyy] = fecha.split("/").map(Number);
  const [hh, min] = hora.split(":").map(Number);
  return new Date(yyyy, mm - 1, dd, hh, min).getTime();
}

function formatearHora(ms: number): string {
  return new Date(ms).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatoCuentaAtras(ms: number): string {
  const diff = Math.max(0, ms - Date.now());
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `en ${h}h ${m}m`;
  if (m > 0) return `en ${m}m`;
  return "ahora";
}

export default function FaseMarea({ avisos, nivelActual, tendencia, ahora }: Props) {
  const mareologico = [...avisos]
    .filter((a) => a.tipo === "pronostico_mareologico")
    .sort((a, b) => (b.publicado ?? "").localeCompare(a.publicado ?? ""))[0];

  const alturas = mareologico ? alturasSanFernando(mareologico.texto) : [];
  const futuros = alturas
    .map((a) => ({ ...a, ts: tsAltura(a.fecha, a.hora) }))
    .filter((a) => a.ts >= ahora)
    .sort((a, b) => a.ts - b.ts);

  const proxiPleamar = futuros.find((a) => a.estado === "PLEAMAR") ?? null;
  const proxiBajamar = futuros.find((a) => a.estado === "BAJAMAR") ?? null;

  if (!mareologico || (alturas.length === 0 && !tendencia)) {
    return (
      <section className="dashboard-section">
        <h2 className="seccion-titulo mb-1">Fase de marea — ¿hasta cuándo sube?</h2>
        <p className="text-sm text-texto-sec dark:text-gray-400 italic">
          Sin pronóstico mareológico del SHN disponible.
        </p>
      </section>
    );
  }

  const subiendo = tendencia?.direccion === "subiendo";
  const bajando = tendencia?.direccion === "bajando";

  // Veredicto según la fase actual y la posición respecto al próximo pico.
  let veredicto: string;
  let clase: string;
  if (subiendo) {
    if (proxiPleamar) {
      veredicto = `El agua sigue subiendo. Pico pronosticado ${formatearHora(proxiPleamar.ts)} (${proxiPleamar.altura.toFixed(2)}m) ${formatoCuentaAtras(proxiPleamar.ts)}. Esperar al pico y salir en bajada deja el agua más baja para evacuar.`;
    } else {
      veredicto = "El agua sigue subiendo. No hay pleamar pronosticada en la vigencia actual del SHN.";
    }
    clase = "bg-atencion/10 text-atencion dark:text-atencion-dark";
  } else if (bajando) {
    veredicto = proxiPleamar
      ? `El agua ya está bajando — ventana segura para evacuar. Volverá a subir recién ${formatearHora(proxiPleamar.ts)} (${proxiPleamar.altura.toFixed(2)}m).`
      : "El agua ya está bajando — ventana segura para evacuar.";
    clase = "bg-ok/10 text-ok dark:text-ok";
  } else {
    veredicto = "Nivel estable en este momento.";
    clase = "bg-fondo/50 dark:bg-white/5 text-texto-sec dark:text-gray-400";
  }

  const picoSupera = proxiPleamar && nivelActual != null && proxiPleamar.altura > nivelActual;

  return (
    <section className="dashboard-section">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h2 className="seccion-titulo">Fase de marea — ¿hasta cuándo sube?</h2>
        {tendencia && (
          <span className={`text-sm font-bold whitespace-nowrap ${subiendo ? "text-rojo-alerta" : bajando ? "text-ok" : "text-texto-sec"}`}>
            {subiendo ? "↑ subiendo" : bajando ? "↓ bajando" : "→ estable"}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-texto dark:text-gray-200">
            Nivel ahora:{" "}
            <strong className="font-mono text-baliza dark:text-marea-dark">
              {nivelActual != null ? `${nivelActual.toFixed(2)}m` : "--"}
            </strong>
          </span>
          {tendencia && (
            <span className="text-xs text-texto-sec dark:text-gray-400 font-mono">
              {tendencia.velocidad_cm_h >= 0 ? "+" : ""}
              {tendencia.velocidad_cm_h.toFixed(1)} cm/h
            </span>
          )}
        </div>

        {proxiPleamar && (
          <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${picoSupera ? "bg-rojo-alerta/10 text-rojo-alerta dark:text-rojo-dark" : "bg-fondo/50 dark:bg-white/5 text-texto-sec dark:text-gray-400"}`}>
            <span>Pico (pleamar) pronosticado</span>
            <span className="font-mono font-bold">
              {proxiPleamar.altura.toFixed(2)}m · {formatearHora(proxiPleamar.ts)}
            </span>
          </div>
        )}

        {proxiBajamar && (
          <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm bg-fondo/50 dark:bg-white/5 text-texto-sec dark:text-gray-400">
            <span>Bajada (bajamar)</span>
            <span className="font-mono font-bold">
              {proxiBajamar.altura.toFixed(2)}m · {formatearHora(proxiBajamar.ts)}
            </span>
          </div>
        )}

        <p className={`text-sm rounded-lg px-3 py-2 font-medium leading-snug ${clase}`}>
          {veredicto}
        </p>
      </div>

      <p className="text-xs text-texto-sec dark:text-gray-400 mt-3">
        Fuente: SHN — pronóstico mareológico (San Fernando) y tendencia observada del mareógrafo.
      </p>
    </section>
  );
}
