"use client";

import { useEffect, useState } from "react";

// Fuente de tiempo compartida que se actualiza periódicamente. Evita llamar
// Date.now() durante el render (impuro para el React Compiler) y permite que
// los conteos se recalculen solos con el re-render.
export function useAhora(intervaloMs = 60000): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return ahora;
}
