"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import type { Bitacora as BitacoraType } from "@/lib/types";

function formatearFecha(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function Bitacora({ nivelActual, onRegistro }: { nivelActual: number; onRegistro: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [escalones, setEscalones] = useState("");
  const [evacuo, setEvacuo] = useState(false);
  const [horaSalida, setHoraSalida] = useState("");
  const [notas, setNotas] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [entradas, setEntradas] = useState<BitacoraType[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  async function toggle() {
    setAbierto(!abierto);
    if (!abierto && entradas.length === 0) {
      setCargandoHistorial(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("bitacora")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(20);
      if (data) setEntradas(data as BitacoraType[]);
      setCargandoHistorial(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setMensaje("");

    const supabase = createClient();
    const { error } = await supabase.from("bitacora").insert({
      nivel_registrado_m: nivelActual,
      escalones_restantes: escalones ? parseInt(escalones, 10) : null,
      se_evacuo: evacuo,
      hora_salida: horaSalida || null,
      notas: notas || null,
    });

    if (error) {
      setMensaje("Error al guardar: " + error.message);
    } else {
      setMensaje("Registrado");
      setEscalones("");
      setEvacuo(false);
      setHoraSalida("");
      setNotas("");
      onRegistro();
      // Recargar historial
      const { data } = await supabase
        .from("bitacora")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(20);
      if (data) setEntradas(data as BitacoraType[]);
    }
    setEnviando(false);
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200">
      <button
        onClick={toggle}
        className="w-full text-left p-4 flex items-center justify-between"
      >
        <p className="text-xs uppercase tracking-widest font-semibold text-gray-500">
          Bitácora de eventos
        </p>
        <span className="text-gray-400">{abierto ? "▲" : "▼"}</span>
      </button>

      {abierto && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-3">
          <form onSubmit={handleSubmit} className="space-y-3">
            <p className="text-sm font-medium text-gray-700">Nuevo registro</p>
            <p className="text-xs text-gray-400">Nivel actual: {nivelActual.toFixed(2)}m</p>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Escalones restantes (opcional)</label>
              <input
                type="number"
                value={escalones}
                onChange={(e) => setEscalones(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Ej: 2"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="evacuo"
                checked={evacuo}
                onChange={(e) => setEvacuo(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="evacuo" className="text-sm text-gray-600">Se evacuó</label>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Hora de salida</label>
              <input
                type="time"
                value={horaSalida}
                onChange={(e) => setHoraSalida(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Notas</label>
              <textarea
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                rows={2}
                placeholder="Observaciones..."
              />
            </div>

            <button
              type="submit"
              disabled={enviando}
              className="bg-[#0E4749] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#0E4749]/90 disabled:opacity-50"
            >
              {enviando ? "Guardando..." : "Guardar registro"}
            </button>
            {mensaje && (
              <p className={`text-sm ${mensaje === "Registrado" ? "text-green-600" : "text-red-600"}`}>{mensaje}</p>
            )}
          </form>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Historial</p>
            {cargandoHistorial ? (
              <p className="text-xs text-gray-400">Cargando...</p>
            ) : entradas.length === 0 ? (
              <p className="text-xs text-gray-400">Sin registros</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {entradas.map((e) => (
                  <div key={e.id} className="text-xs border-b border-gray-100 pb-2">
                    <p className="text-gray-500">{formatearFecha(e.timestamp)}</p>
                    <p className="text-gray-700">
                      Nivel: {e.nivel_registrado_m.toFixed(2)}m
                      {e.escalones_restantes !== null && ` · ${e.escalones_restantes} escalones`}
                      {e.se_evacuo && " · Evacuó"}
                    </p>
                    {e.notas && <p className="text-gray-400 italic">{e.notas}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
