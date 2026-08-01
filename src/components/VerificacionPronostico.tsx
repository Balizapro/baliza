"use client";

import type { Lectura, Pronostico } from "@/lib/types";

interface Props {
  observaciones: Lectura[];
  pronosticos: Pronostico[];
}

function fmtDia(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { weekday: "long", day: "numeric", month: "short" });
}

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function VerificacionPronostico({ observaciones, pronosticos }: Props) {
  const obs = [...observaciones].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const ahora = Date.now();

  const main = pronosticos
    .filter((p) => p.qualifier === "main")
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Agrupar por forecast_date y quedarse con el último ciclo ya completado
  const porCiclo = new Map<string, Pronostico[]>();
  for (const p of main) {
    const arr = porCiclo.get(p.forecast_date) ?? [];
    arr.push(p);
    porCiclo.set(p.forecast_date, arr);
  }

  const ciclos = [...porCiclo.entries()]
    .map(([fecha, pts]) => ({
      fecha,
      inicio: new Date(pts[0].timestamp).getTime(),
      fin: new Date(pts[pts.length - 1].timestamp).getTime(),
      pico: pts.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), pts[0]),
    }))
    .filter((c) => c.fin <= ahora)
    .sort((a, b) => b.fin - a.fin);

  const ciclo = ciclos[0];

  if (!ciclo) {
    return (
      <section className="dashboard-section">
        <p className="seccion-titulo mb-2">Verificación de pronóstico</p>
        <p className="text-sm italic text-[#5B6E68]/60 dark:text-gray-500">
          Esperando un ciclo de pronóstico completado...
        </p>
      </section>
    );
  }

  // Pico observado dentro de la ventana del pronóstico (con margen de 3h antes/después)
  const obsVentana = obs.filter((o) => {
    const t = new Date(o.timestamp).getTime();
    return t >= ciclo.inicio - 3 * 3600000 && t <= ciclo.fin + 6 * 3600000;
  });
  const picoObs = obsVentana.length > 0
    ? obsVentana.reduce((m, o) => (o.nivel_m > m.nivel_m ? o : m), obsVentana[0])
    : null;

  const errorCm = picoObs ? Math.round((picoObs.nivel_m - ciclo.pico.valor_m) * 100) : null;

  const acierto =
    errorCm != null && Math.abs(errorCm) <= 10
      ? "Acierto alto"
      : errorCm != null && Math.abs(errorCm) <= 30
        ? "Aproximado"
        : "Desviado";

  const colorAcierto =
    acierto === "Acierto alto"
      ? "text-[#4C7A5E] border-[#4C7A5E]/50 bg-[#4C7A5E]/10"
      : acierto === "Aproximado"
        ? "text-[#C99A2E] border-[#C99A2E]/50 bg-[#C99A2E]/10"
        : "text-[#C0442B] border-[#C0442B]/50 bg-[#C0442B]/10";

  return (
    <section className="dashboard-section">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <p className="seccion-titulo">Verificación de pronóstico</p>
        {errorCm != null && (
          <span className={`text-xs px-2 py-0.5 rounded-full border ${colorAcierto}`}>{acierto}</span>
        )}
      </div>

      <p className="text-sm text-[#5B6E68] dark:text-gray-400 mb-3">
        Ciclo emitido <span className="font-medium text-[#0E4749] dark:text-[#4fc3c5]">{fmtDia(ciclo.fecha)}</span> —
        qué tan bien anticipó el pico en San Fernando:
      </p>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-[#F2E9DC]/50 dark:bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-wide text-[#5B6E68]/70 dark:text-gray-500">Pronosticado</p>
          <p className="font-mono text-lg font-bold text-[#0E4749] dark:text-[#4fc3c5]">
            {ciclo.pico.valor_m.toFixed(2)}m
          </p>
          <p className="text-[11px] text-[#5B6E68]/60 dark:text-gray-500">{fmtFecha(ciclo.pico.timestamp)}</p>
        </div>
        <div className="rounded-lg bg-[#F2E9DC]/50 dark:bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-wide text-[#5B6E68]/70 dark:text-gray-500">Observado</p>
          <p className="font-mono text-lg font-bold text-[#0E4749] dark:text-[#4fc3c5]">
            {picoObs ? `${picoObs.nivel_m.toFixed(2)}m` : "--"}
          </p>
          <p className="text-[11px] text-[#5B6E68]/60 dark:text-gray-500">
            {picoObs ? fmtFecha(picoObs.timestamp) : "sin datos"}
          </p>
        </div>
        <div className="rounded-lg bg-[#F2E9DC]/50 dark:bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-wide text-[#5B6E68]/70 dark:text-gray-500">Error</p>
          <p className={`font-mono text-lg font-bold ${errorCm == null || Math.abs(errorCm) <= 30 ? "text-[#4C7A5E]" : "text-[#C0442B]"}`}>
            {errorCm == null ? "--" : `${errorCm >= 0 ? "+" : ""}${errorCm}cm`}
          </p>
          <p className="text-[11px] text-[#5B6E68]/60 dark:text-gray-500">
            {errorCm == null ? "" : errorCm > 0 ? "subestimó" : errorCm < 0 ? "sobreestimó" : "exacto"}
          </p>
        </div>
      </div>
    </section>
  );
}
