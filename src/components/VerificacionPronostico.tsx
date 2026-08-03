"use client";

import type { Lectura, Pronostico } from "@/lib/types";
import { useAhora } from "@/lib/useAhora";

interface Props {
  observaciones: Lectura[];
  pronosticos: Pronostico[];
}

function fmtDia(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "numeric", month: "short" });
}

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function labelError(errorCm: number | null): { texto: string; color: string } {
  if (errorCm == null) return { texto: "--", color: "text-[#5B6E68]/60 dark:text-gray-500" };
  const abs = Math.abs(errorCm);
  if (abs <= 10) return { texto: "Acierto alto", color: "text-[#4C7A5E] border-[#4C7A5E]/50 bg-[#4C7A5E]/10" };
  if (abs <= 30) return { texto: "Aproximado", color: "text-[#C99A2E] border-[#C99A2E]/50 bg-[#C99A2E]/10" };
  return { texto: "Desviado", color: "text-[#C0442B] border-[#C0442B]/50 bg-[#C0442B]/10" };
}

export default function VerificacionPronostico({ observaciones, pronosticos }: Props) {
  const obs = [...observaciones].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const ahora = useAhora();

  const main = pronosticos
    .filter((p) => p.qualifier === "main")
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Agrupar por forecast_date (un ciclo por emisión del modelo)
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

  const conVerificacion = ciclos
    .map((c) => {
      const obsVentana = obs.filter((o) => {
        const t = new Date(o.timestamp).getTime();
        return t >= c.inicio - 3 * 3600000 && t <= c.fin + 6 * 3600000;
      });
      const picoObs = obsVentana.length > 0
        ? obsVentana.reduce((m, o) => (o.nivel_m > m.nivel_m ? o : m), obsVentana[0])
        : null;
      const errorCm = picoObs ? Math.round((picoObs.nivel_m - c.pico.valor_m) * 100) : null;
      return { ...c, picoObs, errorCm };
    })
    .filter((c) => c.picoObs !== null && c.errorCm !== null);

  const ultimo = conVerificacion[0];
  const recientes = conVerificacion.slice(0, 6);
  const erroresValidos = recientes.map((c) => c.errorCm as number);
  const errorPromedio = erroresValidos.length > 0
    ? Math.round(erroresValidos.reduce((a, b) => a + b, 0) / erroresValidos.length)
    : null;
  const desvioAbsPromedio = erroresValidos.length > 0
    ? Math.round(erroresValidos.reduce((a, b) => a + Math.abs(b), 0) / erroresValidos.length)
    : null;

  if (!ultimo) {
    return (
      <section className="dashboard-section">
        <p className="seccion-titulo mb-2">Verificación de pronóstico</p>
        <p className="text-sm italic text-[#5B6E68]/60 dark:text-gray-500">
          Esperando un ciclo de pronóstico completado...
        </p>
      </section>
    );
  }

  const ultimoLabel = labelError(ultimo.errorCm);

  return (
    <section className="dashboard-section">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <p className="seccion-titulo">Verificación de pronóstico</p>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${ultimoLabel.color}`}>{ultimoLabel.texto}</span>
      </div>

      <p className="text-sm text-[#5B6E68] dark:text-gray-400 mb-3">
        Ciclo emitido <span className="font-medium text-[#0E4749] dark:text-[#4fc3c5]">{fmtDia(ultimo.fecha)}</span> —
        qué tan bien anticipó el pico en San Fernando:
      </p>

      <div className="grid grid-cols-3 gap-3 text-center mb-4">
        <div className="rounded-lg bg-[#F2E9DC]/50 dark:bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-wide text-[#5B6E68]/70 dark:text-gray-500">Pronosticado</p>
          <p className="font-mono text-lg font-bold text-[#0E4749] dark:text-[#4fc3c5]">
            {ultimo.pico.valor_m.toFixed(2)}m
          </p>
          <p className="text-[11px] text-[#5B6E68]/60 dark:text-gray-500">{fmtFecha(ultimo.pico.timestamp)}</p>
        </div>
        <div className="rounded-lg bg-[#F2E9DC]/50 dark:bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-wide text-[#5B6E68]/70 dark:text-gray-500">Observado</p>
          <p className="font-mono text-lg font-bold text-[#0E4749] dark:text-[#4fc3c5]">
            {ultimo.picoObs ? `${ultimo.picoObs.nivel_m.toFixed(2)}m` : "--"}
          </p>
          <p className="text-[11px] text-[#5B6E68]/60 dark:text-gray-500">
            {ultimo.picoObs ? fmtFecha(ultimo.picoObs.timestamp) : "sin datos"}
          </p>
        </div>
        <div className="rounded-lg bg-[#F2E9DC]/50 dark:bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-wide text-[#5B6E68]/70 dark:text-gray-500">Error</p>
          <p className={`font-mono text-lg font-bold ${ultimo.errorCm == null || Math.abs(ultimo.errorCm) <= 30 ? "text-[#4C7A5E]" : "text-[#C0442B]"}`}>
            {ultimo.errorCm == null ? "--" : `${ultimo.errorCm >= 0 ? "+" : ""}${ultimo.errorCm}cm`}
          </p>
          <p className="text-[11px] text-[#5B6E68]/60 dark:text-gray-500">
            {ultimo.errorCm == null ? "" : ultimo.errorCm > 0 ? "subestimó" : ultimo.errorCm < 0 ? "sobreestimó" : "exacto"}
          </p>
        </div>
      </div>

      {recientes.length > 1 && (
        <>
          <div className="flex flex-wrap gap-3 mb-3">
            {errorPromedio != null && (
              <span className="text-xs px-2 py-1 rounded-md bg-[#F2E9DC]/50 dark:bg-white/5 text-[#12312B] dark:text-gray-300">
                Error medio últ. {recientes.length} ciclos: <strong className="font-mono">{errorPromedio >= 0 ? "+" : ""}{errorPromedio}cm</strong>
              </span>
            )}
            {desvioAbsPromedio != null && (
              <span className="text-xs px-2 py-1 rounded-md bg-[#F2E9DC]/50 dark:bg-white/5 text-[#12312B] dark:text-gray-300">
                Desvío absoluto medio: <strong className="font-mono">±{desvioAbsPromedio}cm</strong>
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[#5B6E68]/70 dark:text-gray-500 border-b border-[#0E4749]/10 dark:border-white/10">
                  <th className="text-left py-1.5 pr-2 font-medium">Ciclo</th>
                  <th className="text-right py-1.5 px-2 font-medium">Pronóstico</th>
                  <th className="text-right py-1.5 px-2 font-medium">Observado</th>
                  <th className="text-right py-1.5 pl-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {recientes.map((c) => {
                  const e = c.errorCm as number;
                  return (
                    <tr key={c.fecha} className="border-b border-[#0E4749]/5 dark:border-white/5">
                      <td className="py-1.5 pr-2 text-[#12312B] dark:text-gray-300">{fmtDia(c.fecha)}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-[#0E4749] dark:text-[#4fc3c5]">{c.pico.valor_m.toFixed(2)}m</td>
                      <td className="py-1.5 px-2 text-right font-mono">{c.picoObs?.nivel_m.toFixed(2)}m</td>
                      <td className={`py-1.5 pl-2 text-right font-mono font-medium ${Math.abs(e) <= 30 ? "text-[#4C7A5E]" : "text-[#C0442B]"}`}>
                        {e >= 0 ? "+" : ""}{e}cm
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
