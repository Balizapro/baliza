"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase";
import type { Bitacora as BitacoraType, Lectura } from "@/lib/types";

interface AlertaItem {
  timestamp: string;
  nivel: "verde" | "amarilla" | "roja" | "azul" | "evacuacion";
}

const colorAlertaChart = { verde: "var(--color-ok)", amarilla: "var(--color-atencion)", roja: "var(--color-rojo-alerta)", azul: "var(--color-bajante)", evacuacion: "var(--color-rojo-oscuro)" } as const;

const TIPOS_EVENTO = [
  { valor: "organizacion", etiqueta: "Organización" },
  { valor: "comunicacion", etiqueta: "Comunicación" },
  { valor: "logistica", etiqueta: "Logística" },
  { valor: "evacuacion", etiqueta: "Evacuación" },
  { valor: "otro", etiqueta: "Otro" },
] as const;

function etiquetaTipo(valor: string | null | undefined): string {
  return TIPOS_EVENTO.find((t) => t.valor === valor)?.etiqueta ?? "Otro";
}

function formatearFecha(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function aLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Bitacora({ nivelActual, onRegistro, loggedIn, historial, alertas, umbralEval, umbralNR }:
  { nivelActual: number; onRegistro: () => void; loggedIn?: boolean; historial?: Lectura[]; alertas?: AlertaItem[]; umbralEval?: number; umbralNR?: number }) {
  const [abierto, setAbierto] = useState(false);
  const [escalones, setEscalones] = useState("");
  const [tipoEvento, setTipoEvento] = useState<string>("organizacion");
  const [fechaEvento, setFechaEvento] = useState(() => aLocalInputValue(new Date().toISOString()));
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

  const timelineSvg = useMemo(() => {
    if (!historial || historial.length < 2) return null;
    const lecturas = historial;
    const maxVal = Math.max(
      ...lecturas.map((l) => l.nivel_m),
      umbralNR ?? 2.2,
      2.5
    );
    const minVal = Math.min(...lecturas.map((l) => l.nivel_m), 0);
    const rango = maxVal - minVal || 1;
    const ancho = 600;
    const alto = 100;
    const padTop = 8;
    const padBot = 16;
    const chartH = alto - padTop - padBot;
    const xScale = (i: number) => (i / Math.max(lecturas.length - 1, 1)) * ancho;
    const yScale = (v: number) => padTop + chartH - ((v - minVal) / rango) * chartH;

    const puntos = lecturas.map((l, i) => `${xScale(i)},${yScale(l.nivel_m)}`).join(" ");
    const areaPuntos = `0,${alto} ${lecturas.map((l, i) => `${xScale(i)},${yScale(l.nivel_m)}`).join(" ")} ${ancho},${alto}`;

    return (
      <svg viewBox={`0 0 ${ancho} ${alto}`} className="w-full h-auto" preserveAspectRatio="none">
        <defs>
          <linearGradient id="tlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-obs)" stopOpacity="0.25"/>
            <stop offset="100%" stopColor="var(--chart-obs)" stopOpacity="0.02"/>
          </linearGradient>
        </defs>
        {/* Área bajo la curva */}
        <polygon points={areaPuntos} fill="url(#tlFill)"/>
        {/* Línea del nivel */}
        <polyline points={puntos} fill="none" stroke="var(--chart-obs)" strokeWidth="1.5" strokeLinejoin="round"/>
        {/* Umbrales */}
        {umbralEval && (
          <>
            <line x1="0" y1={yScale(umbralEval)} x2={ancho} y2={yScale(umbralEval)} stroke="var(--color-atencion)" strokeWidth="0.5" strokeDasharray="3,2"/>
            <text x={ancho - 1} y={yScale(umbralEval) - 1} fontSize="5" fill="var(--color-atencion)" textAnchor="end">eval</text>
          </>
        )}
        {umbralNR && (
          <>
            <line x1="0" y1={yScale(umbralNR)} x2={ancho} y2={yScale(umbralNR)} stroke="var(--color-rojo-alerta)" strokeWidth="0.5" strokeDasharray="3,2"/>
            <text x={ancho - 1} y={yScale(umbralNR) - 1} fontSize="5" fill="var(--color-rojo-alerta)" textAnchor="end">NR</text>
          </>
        )}
        {/* Alertas */}
        {(alertas ?? []).map((a, i) => {
          const t = new Date(a.timestamp).getTime();
          const t0 = new Date(lecturas[0].timestamp).getTime();
          const tN = new Date(lecturas[lecturas.length - 1].timestamp).getTime();
          const x = ((t - t0) / (tN - t0 || 1)) * ancho;
          const y = yScale(lecturas.reduce((prev, l) =>
            Math.abs(new Date(l.timestamp).getTime() - t) < Math.abs(new Date(prev.timestamp).getTime() - t) ? l : prev
          ).nivel_m);
          return (
            <g key={i}>
              <line x1={x} y1={padTop} x2={x} y2={alto - padBot} stroke={colorAlertaChart[a.nivel]} strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5"/>
              <circle cx={x} cy={y} r="2.5" fill={colorAlertaChart[a.nivel]} stroke="#fff" strokeWidth="0.5"/>
            </g>
          );
        })}
        {/* Nivel actual */}
        <circle cx={ancho - 1} cy={yScale(nivelActual)} r="3" fill="var(--chart-obs)" stroke="#fff" strokeWidth="0.5"/>
      </svg>
    );
  }, [historial, alertas, umbralEval, umbralNR, nivelActual]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setMensaje("");

    const payload = {
      nivel_registrado_m: nivelActual,
      escalones_restantes: escalones ? parseInt(escalones, 10) : null,
      tipo_evento: tipoEvento,
      fecha_evento: fechaEvento ? new Date(fechaEvento).toISOString() : null,
      se_evacuo: evacuo,
      hora_salida: horaSalida || null,
      notas: notas || null,
    };

    let error: { message: string } | null = null;

    if (loggedIn) {
      const res = await fetch("/api/bitacora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) error = { message: data.error };
    } else {
      const supabase = createClient();
      const { error: err } = await supabase.from("bitacora").insert(payload);
      error = err;
    }

    if (error) {
      setMensaje("Error al guardar: " + error.message);
    } else {
      setMensaje("Registrado");
      setEscalones("");
      setTipoEvento("organizacion");
      setFechaEvento(aLocalInputValue(new Date().toISOString()));
      setEvacuo(false);
      setHoraSalida("");
      setNotas("");
      onRegistro();
      const supabase = createClient();
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
    <div>
      <button
        onClick={toggle}
        className="w-full text-left flex items-center justify-between group"
      >
        <h2 className="seccion-titulo">
          Bitácora de eventos
        </h2>
        <span className="text-texto-sec group-hover:text-texto-sec dark:text-gray-400 transition-colors">{abierto ? "▲" : "▼"}</span>
      </button>

      {abierto && (
        <div className="mt-3 space-y-4">
          {timelineSvg && (
            <div>
              <p className="text-xs font-sans text-texto-sec dark:text-gray-400 mb-2">Nivel — últimos 7 días</p>
              <div className="bg-gauge-bg/50 dark:bg-panel-dark rounded-lg p-2">
                {timelineSvg}
              </div>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-3">
            <p className="font-serif text-sm font-medium text-texto dark:text-gray-300">Nuevo registro</p>
            <p className="text-xs font-mono text-texto-sec dark:text-gray-400">Nivel actual: {nivelActual.toFixed(2)}m</p>

            <div>
              <label className="text-xs text-texto-sec dark:text-gray-400 block mb-1">Tipo de evento</label>
              <select
                value={tipoEvento}
                onChange={(e) => setTipoEvento(e.target.value)}
                className="w-full border border-borde dark:border-gray-600 bg-white dark:bg-surface-dark text-texto dark:text-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                {TIPOS_EVENTO.map((t) => (
                  <option key={t.valor} value={t.valor}>{t.etiqueta}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-texto-sec dark:text-gray-400 block mb-1">Fecha y hora del evento</label>
              <input
                type="datetime-local"
                value={fechaEvento}
                onChange={(e) => setFechaEvento(e.target.value)}
                className="w-full border border-borde dark:border-gray-600 bg-white dark:bg-surface-dark text-texto dark:text-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <label className="text-xs text-texto-sec dark:text-gray-400 block mb-1">Escalones restantes (opcional)</label>
              <input
                type="number"
                value={escalones}
                onChange={(e) => setEscalones(e.target.value)}
                className="w-full border border-borde dark:border-gray-600 bg-white dark:bg-surface-dark text-texto dark:text-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="Ej: 2"
              />
            </div>

            {tipoEvento === "evacuacion" && (
              <>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="evacuo"
                    checked={evacuo}
                    onChange={(e) => setEvacuo(e.target.checked)}
                    className="rounded border-borde dark:border-gray-600 dark:bg-surface-dark"
                  />
                  <label htmlFor="evacuo" className="text-sm text-texto-sec dark:text-gray-400">Se evacuó</label>
                </div>

                <div>
                  <label className="text-xs text-texto-sec dark:text-gray-400 block mb-1">Hora de salida</label>
                  <input
                    type="time"
                    value={horaSalida}
                    onChange={(e) => setHoraSalida(e.target.value)}
                    className="w-full border border-borde dark:border-gray-600 bg-white dark:bg-surface-dark text-texto dark:text-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
              </>
            )}

            <div>
              <label className="text-xs text-texto-sec dark:text-gray-400 block mb-1">Notas</label>
              <textarea
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                className="w-full border border-borde dark:border-gray-600 bg-white dark:bg-surface-dark text-texto dark:text-gray-200 rounded-lg px-3 py-2 text-sm"
                rows={2}
                placeholder="Observaciones..."
              />
            </div>

            <button
              type="submit"
              disabled={enviando}
              className="bg-baliza text-white px-5 py-2.5 sm:px-4 sm:py-2 rounded-lg text-sm font-medium hover:bg-baliza/90 disabled:opacity-50 transition-colors"
            >
              {enviando ? "Guardando..." : "Guardar registro"}
            </button>
            {mensaje && (
              <p className={`text-sm ${mensaje === "Registrado" ? "text-ok dark:text-green-400" : "text-rojo-alerta dark:text-red-400"}`}>{mensaje}</p>
            )}
          </form>

          <div>
            <p className="font-serif text-sm font-medium text-texto dark:text-gray-300 mb-2">Historial</p>
            {cargandoHistorial ? (
              <p className="text-xs italic text-texto-sec dark:text-gray-400">Cargando...</p>
            ) : entradas.length === 0 ? (
              <p className="text-xs italic text-texto-sec dark:text-gray-400">Sin registros</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {entradas.map((e) => (
                  <div key={e.id} className="text-xs border-b border-borde/50 dark:border-gray-700 pb-2 last:border-0">
                    <p className="flex items-center gap-2 text-texto-sec dark:text-gray-400">
                      <span className="inline-block px-1.5 py-0.5 rounded border border-baliza/30 bg-baliza/10 text-baliza dark:text-marea-dark font-sans uppercase tracking-wide">
                        {etiquetaTipo(e.tipo_evento)}
                      </span>
                      <span className="font-mono">
                        {e.fecha_evento ? formatearFecha(e.fecha_evento) : formatearFecha(e.timestamp)}
                      </span>
                      <span className="text-texto-sec/70 dark:text-gray-500 italic">· registrado {formatearFecha(e.timestamp)}</span>
                    </p>
                    <p className="text-texto dark:text-gray-300 mt-0.5">
                      Nivel: <span className="font-mono">{e.nivel_registrado_m.toFixed(2)}m</span>
                      {e.escalones_restantes !== null && <span> · {e.escalones_restantes} escalones</span>}
                      {e.se_evacuo && <span> · Evacuó</span>}
                      {e.hora_salida && <span> · salida {e.hora_salida.slice(0, 5)}</span>}
                    </p>
                    {e.notas && <p className="text-texto-sec dark:text-gray-400 italic">{e.notas}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
