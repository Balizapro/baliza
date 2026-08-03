"use client";

import { useEffect, useRef, useState } from "react";
type Nivel = "verde" | "azul" | "amarilla" | "roja" | "evacuacion";

const GRAVEDAD: Record<Nivel, number> = { verde: 0, azul: 1, amarilla: 2, roja: 3, evacuacion: 4 };

interface Props {
  nivel: string;
  habilitado?: boolean;
  onToggle?: (on: boolean) => void;
}

// Reproduce un patrón de sonido (sirena corta / larga) con Web Audio API.
function tocarSirena(gravedad: number) {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const duracion = gravedad >= 3 ? 2.2 : 1.4;
  const reps = gravedad >= 3 ? 3 : 2;

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

export default function AlertaSonora({ nivel, habilitado = false, onToggle }: Props) {
  const [activo, setActivo] = useState(habilitado);
  const [prevHabilitado, setPrevHabilitado] = useState(habilitado);
  const prevNivel = useRef<string | null>(null);

  if (habilitado !== prevHabilitado) {
    setPrevHabilitado(habilitado);
    setActivo(habilitado);
  }

  useEffect(() => {
    if (prevNivel.current === null) {
      prevNivel.current = nivel;
      return;
    }
    const prev = prevNivel.current as Nivel;
    const actual = nivel as Nivel;
    const subio = GRAVEDAD[actual] > GRAVEDAD[prev];

    if (subio && activo && actual !== "verde") {
      tocarSirena(GRAVEDAD[actual]);
    }
    prevNivel.current = nivel;
  }, [nivel, activo]);

  const activado = activo;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => {
          const nuevo = !activo;
          setActivo(nuevo);
          onToggle?.(nuevo);
        }}
        title={activo ? "Sirena activada — sonará al subir el nivel" : "Sirena desactivada"}
        aria-pressed={activo}
        className={`min-h-11 inline-flex items-center gap-1.5 text-xs border rounded-md px-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
          activo
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
        {activo ? "Sirena ON" : "Sirena OFF"}
      </button>
    </div>
  );
}
