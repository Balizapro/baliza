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
  const prevNivel = useRef<string | null>(null);

  useEffect(() => setActivo(habilitado), [habilitado]);

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

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => {
          const nuevo = !activo;
          setActivo(nuevo);
          onToggle?.(nuevo);
        }}
        title={activo ? "Sirena activada — sonará al subir el nivel" : "Sirena desactivada"}
        className={`text-xs border rounded px-2.5 py-1.5 transition-colors ${
          activo
            ? "text-white bg-[#C0442B]/40 border-[#C0442B]/60 hover:bg-[#C0442B]/60"
            : "text-white/70 hover:text-white border-white/20 hover:bg-white/10"
        }`}
      >
        {activo ? "🚨 Sirena ON" : "🔇 Sirena OFF"}
      </button>
    </div>
  );
}
