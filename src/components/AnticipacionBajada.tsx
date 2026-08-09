"use client";

import { useMemo } from "react";
import { anticiparBajada } from "@/lib/anticipacion";
import type { Lectura } from "@/lib/types";
import CompartirWhatsApp from "@/components/CompartirWhatsApp";

interface ExteriorLecturas {
  nombre: string;
  lecturas: Lectura[];
}

interface Props {
  sf: Lectura[];
  exteriores: ExteriorLecturas[];
  nivelSeguroM: number;
  ahora: number;
}

function formatearHora(ms: number): string {
  return new Date(ms).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatoCuentaAtras(ms: number): string {
  const diff = Math.max(0, ms - Date.now());
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}min`;
  return "ahora";
}

export default function AnticipacionBajada({ sf, exteriores, nivelSeguroM, ahora }: Props) {
  const r = useMemo(
    () =>
      anticiparBajada(
        exteriores.map((e) => ({ nombre: e.nombre, lecturas: e.lecturas })),
        sf.map((l) => ({ timestamp: l.timestamp, nivel_m: Number(l.nivel_m) })),
        nivelSeguroM,
        ahora
      ),
    [sf, exteriores, nivelSeguroM, ahora]
  );

  const giraron = r.exteriores.filter((e) => e.giro);
  const giraronTxt = giraron.length ? giraron.map((e) => e.nombre).join(", ") : null;

  return (
    <section className="dashboard-section">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h2 className="seccion-titulo">Anticipación de la bajada</h2>
        {r.giraron && (
          <span className="text-sm font-bold whitespace-nowrap text-ok">↓ exteriores bajando</span>
        )}
      </div>

      <p className={`text-sm rounded-lg px-3 py-2 font-medium leading-snug mb-2 ${r.giraron ? "bg-ok/10 text-ok dark:text-ok" : "bg-fondo/50 dark:bg-white/5 text-texto-sec dark:text-gray-400"}`}>
        {r.mensaje}
      </p>

      {r.giraron && r.sfPicoTs != null && (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="rounded-lg bg-fondo/50 dark:bg-white/5 px-3 py-2 text-sm">
            <p className="text-xs text-texto-sec dark:text-gray-400 mb-0.5">SF tocará pico ≈</p>
            <p className="font-mono font-bold text-atencion">{formatearHora(r.sfPicoTs)}</p>
            <p className="text-xs font-mono text-texto-sec dark:text-gray-400 mt-0.5">{formatoCuentaAtras(r.sfPicoTs)}</p>
            {r.sfPicoNivel != null && (
              <p className="text-xs font-mono text-texto-sec dark:text-gray-400">{r.sfPicoNivel.toFixed(2)}m</p>
            )}
          </div>
          <div className="rounded-lg bg-fondo/50 dark:bg-white/5 px-3 py-2 text-sm">
            {r.sfCruceSeguroTs != null ? (
              <>
                <p className="text-xs text-texto-sec dark:text-gray-400 mb-0.5">Baja a {nivelSeguroM.toFixed(2)}m ≈</p>
                <p className="font-mono font-bold text-ok">{formatearHora(r.sfCruceSeguroTs)}</p>
                <p className="text-xs font-mono text-texto-sec dark:text-gray-400 mt-0.5">{formatoCuentaAtras(r.sfCruceSeguroTs)}</p>
              </>
            ) : (
              <>
                <p className="text-xs text-texto-sec dark:text-gray-400 mb-0.5">Acceso al muelle</p>
                <p className="font-mono font-bold text-ok">quedará accesible</p>
                <p className="text-xs font-mono text-texto-sec dark:text-gray-400 mt-0.5">SF no supera {nivelSeguroM.toFixed(2)}m</p>
              </>
            )}
          </div>
        </div>
      )}

      {giraronTxt && (
        <p className="text-xs text-texto-sec dark:text-gray-400 mb-2">
          Ya bajando: <strong>{giraronTxt}</strong>. La bajada llega a San Fernando con ~2hs de retraso respecto a las exteriores.
        </p>
      )}

      <div className="mt-2">
        <CompartirWhatsApp
          small
          mensaje={[
            `🌊 Baliza — Anticipación de la bajada`,
            r.mensaje,
            r.sfCruceSeguroTs != null ? `Baja a ${nivelSeguroM.toFixed(2)}m ≈ ${formatearHora(r.sfCruceSeguroTs)}` : null,
            r.sfCruceSeguroTs == null && r.sfPicoNivel != null ? `Muelle accesible (máx ${r.sfPicoNivel.toFixed(2)}m)` : null,
            `⚠ Más info: https://baliza-ashy.vercel.app`,
          ].filter(Boolean).join("\n")}
        />
      </div>

      <p className="text-xs text-texto-sec dark:text-gray-400 mt-3">
        Señal adelantada: las estaciones exteriores (La Plata, Oyarvide, Atalaya, Buenos Aires) pasan su pico y bajan
        antes que San Fernando. El nivel seguro ({nivelSeguroM.toFixed(2)}m) es el máximo al que se puede bajar al muelle sin mojarse.
      </p>
    </section>
  );
}
