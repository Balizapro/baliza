"use client";

import { useEffect, useRef, useState } from "react";
type Nivel = "verde" | "azul" | "amarilla" | "roja" | "evacuacion";

interface Props {
  nivel: string;
  habilitado?: boolean;
  onToggle?: (on: boolean) => void;
  // Nivel observado en SF y umbrales configurados. Con la sirena ON el sonido
  // arranca al cruzar `umbralEvalM` (evaluación, hoy 2.0m); con la sirena OFF
  // igual suena al cruzar `umbralNRM` (punto de no retorno, hoy 2.2m).
  nivelM?: number | null;
  umbralEvalM?: number;
  umbralNRM?: number;
}

// Reproduce un patrón de sonido (sirena corta / larga) con Web Audio API.
function tocarSirena(gravedad: number) {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const duracion = gravedad >= 3 ? 2.2 : 1.4;
  const reps = gravedad >= 3 ? 2 : 1;

  for (let r = 0; r < reps; r++) {
    const t0 = ctx.currentTime + r * (duracion / reps + 0.25);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    // Barrido de frecuencia estilo sirena (400→900Hz→400Hz)
    osc.frequency.setValueAtTime(400, t0);
    osc.frequency.linearRampToValueAtTime(900, t0 + (duracion / reps) / 2);
    osc.frequency.linearRampToValueAtTime(400, t0 + duracion / reps);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duracion / reps);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duracion / reps);
  }

  setTimeout(() => ctx.close(), duracion * 1000 + 500);
}

const LS_KEY = "baliza_sirena";

export default function AlertaSonora({
  nivel,
  habilitado = false,
  onToggle,
  nivelM = null,
  umbralEvalM = 2.0,
  umbralNRM = 2.2,
}: Props) {
  // Persistente: arranca con la preferencia guardada; sino OFF.
  const [activo, setActivo] = useState<boolean>(() => {
    if (typeof window === "undefined") return habilitado;
    return window.localStorage.getItem(LS_KEY) === "1";
  });
  const [prevHabilitado, setPrevHabilitado] = useState(habilitado);
  const prevNivel = useRef<string | null>(null);
  // Disparo por flanco ascendente del nivel sobre el umbral vigente para que
  // suene aunque el estado de alerta ya esté activo al cruzar el límite.
  const prevDisparo = useRef(false);

  if (habilitado !== prevHabilitado) {
    setPrevHabilitado(habilitado);
    setActivo(habilitado);
    if (typeof window !== "undefined") window.localStorage.setItem(LS_KEY, habilitado ? "1" : "0");
  }

  const toggleSirena = (on: boolean) => {
    setActivo(on);
    if (typeof window !== "undefined") window.localStorage.setItem(LS_KEY, on ? "1" : "0");
    onToggle?.(on);
  };

  useEffect(() => {
    const actual = nivel as Nivel;
    // En bajante no hay motivo de sirena por crecida.
    if (actual === "azul" || actual === "verde") {
      prevNivel.current = nivel;
      prevDisparo.current = false;
      return;
    }
    const umbralDisparo = activo ? umbralEvalM : umbralNRM;
    const dispara = nivelM != null && nivelM >= umbralDisparo;
    const primero = prevNivel.current === null;
    // Gravedad calculada del nivel real (independiente del registro de BD, que
    // puede tener lag de la corrida del cron): 2 = evaluación, 3 = no retorno.
    const gravedadLocal = nivelM == null ? 0 : nivelM >= umbralNRM ? 3 : nivelM >= umbralEvalM ? 2 : 0;

    // Suena en el flanco ascendente (nivel recién cruzando el umbral) y también
    // al cargar la página si el nivel YA está sobre el umbral (el cruce ocurrió
    // mientras la página estaba cerrada): nadie debe perderse la crecida.
    if (dispara && !prevDisparo.current && gravedadLocal >= 2) {
      tocarSirena(gravedadLocal);
    }
    prevNivel.current = nivel;
    prevDisparo.current = dispara;
  }, [nivel, activo, nivelM, umbralEvalM, umbralNRM]);

  const activado = activo;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => toggleSirena(!activado)}
        title={
          activado
            ? "Sirena ON — suena al superar el nivel de evaluación (2.0m)"
            : "Sirena OFF — igual suena al superar el punto de no retorno (2.2m)"
        }
        aria-pressed={activado}
        className={`min-h-11 inline-flex items-center gap-1.5 text-xs border rounded-md px-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
          activado
            ? "text-white bg-rojo-alerta/40 border-rojo-alerta/60 hover:bg-rojo-alerta/60"
            : "text-white/80 hover:text-white border-white/20 hover:bg-white/10"
        }`}
      >
        {activado ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
            <path d="M14.752 11.168l-3.197-2.132A1 1 0 0 0 10 9.87v4.263a1 1 0 0 0 1.555.832l3.197-2.132a1 1 0 0 0 0-1.664Z" />
            <path d="M18 8a6 6 0 0 1 0 8" />
            <path d="M6 8a6 6 0 0 0 0 8" />
            <path d="M3 6a10 10 0 0 0 0 12" />
            <path d="M21 6a10 10 0 0 1 0 12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
            <path d="M14.752 11.168l-3.197-2.132A1 1 0 0 0 10 9.87v4.263a1 1 0 0 0 1.555.832l3.197-2.132a1 1 0 0 0 0-1.664Z" />
            <path d="M18 8a6 6 0 0 1 0 8" />
            <path d="M6 8a6 6 0 0 0 0 8" />
            <path d="M3 6a10 10 0 0 0 0 12" />
            <path d="M21 6a10 10 0 0 1 0 12" />
            <path d="m22 2-20 20" />
          </svg>
        )}
        {activado ? "Sirena ON" : "Sirena OFF"}
      </button>
    </div>
  );
}
