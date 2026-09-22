"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import type { Alerta, NivelAlerta } from "@/lib/types";
import { agruparAlertasPorDia } from "@/lib/episodiosAlerta";

const NIVEL_INFO: Record<NivelAlerta, { etiqueta: string; color: string; bg: string }> = {
  verde: { etiqueta: "Normal", color: "var(--color-ok)", bg: "rgba(22,163,74,0.12)" },
  amarilla: { etiqueta: "Atención", color: "var(--color-atencion)", bg: "rgba(139,78,10,0.12)" },
  roja: { etiqueta: "Alerta roja", color: "var(--color-rojo-alerta)", bg: "rgba(169,50,29,0.12)" },
  azul: { etiqueta: "Bajante", color: "var(--color-bajante)", bg: "rgba(29,78,216,0.12)" },
  evacuacion: { etiqueta: "Evacuación", color: "var(--color-rojo-oscuro)", bg: "rgba(127,29,29,0.15)" },
};

function formatearHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export default function HistorialAlertas() {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [cargado, setCargado] = useState(false);
  const [alertas, setAlertas] = useState<Alerta[]>([]);

  async function toggle() {
    setAbierto(!abierto);
    if (!abierto && !cargado) {
      setCargando(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("alertas")
        .select("id, timestamp, nivel, ventana_inicio, ventana_fin, mensaje, disparadores_json")
        .order("timestamp", { ascending: false })
        .limit(100);
      if (data) setAlertas(data as Alerta[]);
      setCargando(false);
      setCargado(true);
    }
  }

  const episodios = agruparAlertasPorDia(alertas);

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full text-left flex items-center justify-between group"
      >
        <h2 className="seccion-titulo">Historial de alertas</h2>
        <span className="text-texto-sec group-hover:text-texto-sec dark:text-gray-400 transition-colors">{abierto ? "▲" : "▼"}</span>
      </button>

      {abierto && (
        <div className="mt-3">
          {cargando ? (
            <p className="text-xs italic text-texto-sec dark:text-gray-400">Cargando...</p>
          ) : episodios.length === 0 ? (
            <p className="text-xs italic text-texto-sec dark:text-gray-400">Sin alertas registradas</p>
          ) : (
            <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
              {episodios.map((episodio) => (
                <div key={episodio.clave}>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-texto-sec/80 dark:text-gray-500 mb-1.5">
                    {episodio.etiqueta}
                  </p>
                  <ol className="relative ml-2 border-l-2 border-borde dark:border-gray-700 pl-3 space-y-3">
                    {episodio.alertas.map((alerta) => {
                      const info = NIVEL_INFO[alerta.nivel];
                      return (
                        <li key={alerta.id} className="relative">
                          <span
                            className="absolute -left-[17.5px] top-[3px] w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-card-dark"
                            style={{ background: info.color }}
                            aria-hidden="true"
                          />
                          <div className="flex items-start gap-2">
                            <span className="font-mono text-[11px] text-texto-sec dark:text-gray-400 mt-px flex-shrink-0">
                              {formatearHora(alerta.timestamp)}
                            </span>
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
                                  style={{ color: info.color, background: info.bg }}
                                >
                                  {info.etiqueta}
                                </span>
                              </p>
                              {alerta.mensaje && (
                                <p className="text-texto-sec dark:text-gray-400 mt-0.5 leading-snug">{alerta.mensaje}</p>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
