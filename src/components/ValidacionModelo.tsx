"use client";

import { useMemo } from "react";
import { validarModelo, type ValidacionModelo } from "@/lib/modelo";
import type { Lectura } from "@/lib/types";
import { useAhora } from "@/lib/useAhora";

interface Props {
  observaciones: Lectura[];
  vientoHistorico: { timestamp: number; velocidad_kmh: number; direccion_grados: number; presion_hpa?: number | null }[];
}

function fmtFechaLarga(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ValidacionModelo({ observaciones, vientoHistorico }: Props) {
  const ahora = useAhora();

  const lecturas = useMemo(
    () => observaciones.map((o) => ({ timestamp: o.timestamp, nivel_m: Number(o.nivel_m) })),
    [observaciones]
  );

  const val: ValidacionModelo | null = useMemo(
    () => validarModelo(lecturas, vientoHistorico, ahora),
    [lecturas, vientoHistorico, ahora]
  );

  if (!val || val.cortes === 0) {
    return (
      <section className="dashboard-section">
        <h2 className="seccion-titulo mb-2">Validación del modelo propio</h2>
        <p className="text-sm italic text-texto-sec dark:text-gray-400">
          Necesitamos al menos 5 días de observaciones y 24h de historia por encima del horizonte para evaluar el modelo...
        </p>
      </section>
    );
  }

  const label24 = val.horizontes.find((h) => h.horizonte_h === 24);

  return (
    <section className="dashboard-section">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="seccion-titulo">Validación del modelo propio</h2>
        <span className="text-xs px-2 py-0.5 rounded-full border border-baliza/30 bg-baliza/10 text-baliza dark:text-marea-dark">
          {val.cortes} cortes
        </span>
      </div>

      <p className="text-sm text-texto-sec dark:text-gray-400 mb-3">
        Backtest del modelo armónico+viento contra lo observado en {fmtFechaLarga(new Date(val.desde).toISOString())}
      </p>

      <div className="grid grid-cols-3 gap-3 text-center mb-4">
        {val.horizontes.map((h) => (
          <div key={h.horizonte_h} className="rounded-lg bg-fondo/50 dark:bg-white/5 p-3">
            <p className="text-xs uppercase tracking-wide text-texto-sec dark:text-gray-400">{h.horizonte_h}h</p>
            <p className="font-mono text-lg font-bold text-baliza dark:text-marea-dark">
              {h.mae_m.toFixed(2)}m
            </p>
            <p className="text-xs text-texto-sec dark:text-gray-400">
              MAE {h.sesgo_m >= 0 ? "+" : ""}{h.sesgo_m.toFixed(2)}m · {h.acierto_pct.toFixed(0)}% acierto
            </p>
          </div>
        ))}
      </div>

      {label24 && (
        <div className="flex flex-wrap gap-3 text-xs text-texto-sec dark:text-gray-400">
          <span>±15cm a 24h: <strong className="font-mono">{label24.acierto_pct.toFixed(0)}%</strong></span>
          <span>Error máx. 24h: <strong className="font-mono">±{label24.max_err_m.toFixed(2)}m</strong></span>
          <span>Muestras: <strong className="font-mono">{label24.n}</strong></span>
        </div>
      )}
    </section>
  );
}
