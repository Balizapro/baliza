"use client";

import type { Lectura, Pronostico } from "@/lib/types";
import { useAhora } from "@/lib/useAhora";

const PROPAGACION_HS = 2.5;

interface Props {
  pronostico: Pronostico[];
  lecturasLP: Lectura[];
  nivelSF: number | undefined;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ComparacionModelo({ pronostico, lecturasLP, nivelSF }: Props) {
  // Pico del modelo INA (main) en el horizonte
  const ahora = useAhora();
  const main = pronostico
    .filter((p) => p.qualifier === "main")
    .filter((p) => new Date(p.timestamp).getTime() >= ahora)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const picoINA = main.length > 0 ? main.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), main[0]) : null;

  // Proyección por propagación LP→SF: nivel LP actual + tiempo de viaje
  const lp = lecturasLP[0];
  const lpPrevia = lecturasLP[1];
  const lpSubiendo = lp && lpPrevia && lp.nivel_m - lpPrevia.nivel_m > 0.01;

  let picoPropagacion: { valor: number; fecha: string } | null = null;
  if (lp && lpSubiendo && lpPrevia) {
    const pendiente = lp.nivel_m - lpPrevia.nivel_m;
    const llegada = new Date(new Date(lp.timestamp).getTime() + PROPAGACION_HS * 3600000);
    const pico = lp.nivel_m + pendiente * PROPAGACION_HS;
    picoPropagacion = { valor: Math.max(pico, lp.nivel_m), fecha: llegada.toISOString() };
  }

  if (!picoINA) {
    return (
      <div>
        <p className="seccion-titulo mb-2">Modelo INA vs propagación LP</p>
        <p className="text-sm italic text-[#5B6E68]/60 dark:text-gray-500">Sin pronóstico INA disponible.</p>
      </div>
    );
  }

  const diff = picoPropagacion ? picoINA.valor_m - picoPropagacion.valor : null;

  return (
    <div>
      <p className="seccion-titulo mb-2">Modelo INA vs propagación LP</p>
      <p className="text-xs text-[#5B6E68]/70 dark:text-gray-500 mb-3">
        Cruza el pronóstico del INA con la señal real de La Plata para anticipar discrepancias.
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 bg-[#F2E9DC]/60 dark:bg-white/5 rounded-lg px-3 py-2">
          <div>
            <p className="text-xs text-[#5B6E68]/70 dark:text-gray-400">Modelo INA (San Fernando)</p>
            <p className="text-xs text-[#5B6E68]/50 dark:text-gray-500">{picoINA ? fmt(picoINA.timestamp) : "—"}</p>
          </div>
          <p className="font-mono text-lg font-bold text-[#E8823A]">
            {picoINA.valor_m.toFixed(2)}m
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 bg-[#F2E9DC]/60 dark:bg-white/5 rounded-lg px-3 py-2">
          <div>
            <p className="text-xs text-[#5B6E68]/70 dark:text-gray-400">Propagación LP → SF</p>
            <p className="text-xs text-[#5B6E68]/50 dark:text-gray-500">
              {picoPropagacion ? `${fmt(picoPropagacion.fecha)} (viaje ~${PROPAGACION_HS}hs)` : "sin señal ascendente"}
            </p>
          </div>
          <p className="font-mono text-lg font-bold text-[#0E4749] dark:text-[#4fc3c5]">
            {picoPropagacion ? `${picoPropagacion.valor.toFixed(2)}m` : "—"}
          </p>
        </div>

        {picoPropagacion && nivelSF != null && (
          <div className={`rounded-lg px-3 py-2 text-xs font-medium border ${diff === null ? "" : Math.abs(diff) > 0.15 ? "bg-orange-50 border-[#E8823A]/40 text-[#8B4E0A] dark:bg-orange-900/20 dark:text-orange-300" : "bg-green-50 border-[#4C7A5E]/40 text-[#2F5233] dark:bg-green-900/20 dark:text-green-300"}`}>
            {diff === null
              ? null
              : Math.abs(diff) > 0.15
                ? `⚠ Discrepancia: el INA estima ${diff > 0 ? "más" : "menos"} que la señal LP (${Math.abs(diff).toFixed(2)}m). Validar cuál está reflejando el río real (ahora ${nivelSF.toFixed(2)}m).`
                : `✓ Coincidencia razonable entre el INA (${picoINA.valor_m.toFixed(2)}m) y la propagación LP (${picoPropagacion.valor.toFixed(2)}m).`}
          </div>
        )}
      </div>
    </div>
  );
}
