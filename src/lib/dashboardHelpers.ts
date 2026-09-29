import type { Lectura, Tendencia } from "@/lib/types";

export function direccionCardinal(grados: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(grados / 22.5) % 16];
}

export function formatearFechaHora(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Minutos del día (0-1439) en la zona horaria de la escuela (Buenos Aires), o null si inválido.
export function minutosDiaArgentina(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "", 10);
  if (Number.isNaN(h)) return null;
  const hora = h === 24 ? 0 : h;
  return hora * 60 + m;
}

// Minutos restantes (redondeados) desde `ahoraMs` hasta un hito dado como
// minutos-desde-medianoche local (p. ej. salidaLimiteMin = 570 → 09:30) hoy.
// Devuelve null si el hito ya pasó hoy o si no se puede resolver.
export function minutosAlHitoDia(minutosMedianoche: number, ahoraMs: number): number | null {
  const minAhora = minutosDiaArgentina(new Date(ahoraMs).toISOString());
  if (minAhora == null) return null;
  return minutosMedianoche - minAhora;
}

// Feriados sin clases (fechas locales AAAA-MM-DD). Mantener al día.
// El equipo puede sumar/editar más días desde AdminPanel (tabla dias_sin_clases).
export const FERIADOS_SIN_CLASES = new Set([
  "2026-08-17", // Paso a la Inmortalidad del Gral. San Martín
]);

// Día civil en la zona de la escuela (AAAA-MM-DD), o null si inválido.
export function fechaDiaArgentina(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

// Día de la semana en la zona de la escuela (short ISO weekday: Mon..Sun).
export function weekdayArgentina(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short" }).format(d);
}

// Horario escolar de la escuela (primaria + jardín): de 08:00 a 14:30 local,
// solo de lunes a viernes y sin clases en feriados (fijos + editables por el equipo).
export function enHorarioEscolar(iso: string | null, diasSinClases: string[] = []): boolean | null {
  const min = minutosDiaArgentina(iso);
  if (min == null) return null;
  const dia = fechaDiaArgentina(iso);
  const weekday = weekdayArgentina(iso);
  if (!dia || !weekday) return null;
  if (FERIADOS_SIN_CLASES.has(dia) || diasSinClases.includes(dia)) return false;
  if (weekday === "Sat" || weekday === "Sun") return false;
  return min >= 8 * 60 && min <= 14 * 60 + 30;
}

export function tendenciaIcono(lecturas: Lectura[] | undefined | null): string {
  if (!lecturas || lecturas.length < 2) return "—";
  const diff = lecturas[0].nivel_m - lecturas[1].nivel_m;
  if (diff > 0.01) return "↑";
  if (diff < -0.01) return "↓";
  return "→";
}

// Calcula dirección, velocidad de cambio (cm/h) y duración de la tendencia
// a partir de las últimas lecturas de una estación (orden descendente).
export function calcularTendencia(lecturas: Lectura[] | undefined | null): Tendencia | null {
  if (!lecturas || lecturas.length < 2) return null;

  const ordenadas = [...lecturas].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const ultima = ordenadas[0];
  const anterior = ordenadas[1];
  const dtHs = (new Date(ultima.timestamp).getTime() - new Date(anterior.timestamp).getTime()) / 3600000;
  if (dtHs <= 0) return null;

  const diff = ultima.nivel_m - anterior.nivel_m;
  const velocidadCmH = (diff / dtHs) * 100;
  const direccion = diff > 0.01 ? "subiendo" : diff < -0.01 ? "bajando" : "estable";

  // Duración: cuánto hace que viene sosteniendo la misma dirección
  let duracionHs = 0;
  let desde: string | null = null;
  if (direccion !== "estable") {
    for (let i = 0; i < ordenadas.length - 1; i++) {
      const d = ordenadas[i].nivel_m - ordenadas[i + 1].nivel_m;
      const mismaDir = direccion === "subiendo" ? d > 0.01 : d < -0.01;
      if (!mismaDir) break;
      duracionHs +=
        (new Date(ordenadas[i].timestamp).getTime() - new Date(ordenadas[i + 1].timestamp).getTime()) / 3600000;
    }
    if (duracionHs > 0) {
      desde = new Date(new Date(ordenadas[0].timestamp).getTime() - duracionHs * 3600000).toISOString();
    }
  }

  return { direccion, velocidad_cm_h: velocidadCmH, duracion_hs: duracionHs, desde };
}

export function hhmm(min: number | null): string {
  if (min == null) return "--";
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
