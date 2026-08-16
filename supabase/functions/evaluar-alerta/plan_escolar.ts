// Plan escolar del día para el muelle de San Fernando.
// Lógica pura (sin imports externos) para calcular el veredicto del día
// (NO CLASES / SALIDA TEMPRANA / NORMAL) a partir del pronóstico INA
// (qualifiers main/p05/p25/p75/p95) y del nivel seguro del muelle.

export type Qualifier = "main" | "p05" | "p25" | "p75" | "p95";

export interface PuntoProno {
  timestamp: string;
  valor_m: number;
  qualifier: string;
}

export type EstadoVeredicto = "normal" | "salida_temprana" | "no_clases" | "sin_datos";

export type Confianza = "alta" | "media" | "baja";

export interface ValorHora {
  horaMin: number;
  main: number | null;
  p05: number | null;
  p25: number | null;
  p75: number | null;
  p95: number | null;
}

export interface VeredictoDia {
  fecha: string;
  esDiaEscolar: boolean;
  estado: EstadoVeredicto;
  confianza: Confianza;
  nivelSeguroM: number;
  entrada: ValorHora;
  vuelta: ValorHora;
  hora7: ValorHora;
  salidaLimiteMin: number | null;
  motivo: string;
}

// Horarios escolares (minutos del día local).
export const HORA_VEREDICTO = 7 * 60; // la hora a la que se decide el plan
export const HORA_ENTRADA = 8 * 60; // inicio de clases
export const HORA_VUELTA = 14 * 60 + 15; // vuelta a la costa

const TZ = "America/Argentina/Buenos_Aires";

export function minutosDiaArgentina(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "", 10);
  if (!Number.isFinite(h)) return null;
  return (h === 24 ? 0 : h) * 60 + m;
}

export function fechaDiaArgentina(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function weekdayArgentina(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
}

// ¿Es día hábil con clases? Lunes a viernes, fuera de la lista de dias sin clases.
export function esDiaEscolar(fecha: string | null, weekday: string | null, diasSinClases: string[]): boolean {
  if (!fecha || !weekday) return false;
  if (diasSinClases.includes(fecha)) return false;
  return !(weekday === "Sat" || weekday === "Sun");
}

// Interpola el valor del pronóstico (de cada qualifier) a una hora exacta del día
// (en minutos locales). Devuelve celdas por qualifier.
function serieDia(pronos: PuntoProno[], fecha: string): Record<Qualifier, { min: number; valor_m: number }[]> {
  const s: Record<Qualifier, { min: number; valor_m: number }[]> = { main: [], p05: [], p25: [], p75: [], p95: [] };
  for (const p of pronos) {
    if (fechaDiaArgentina(p.timestamp) !== fecha) continue;
    const min = minutosDiaArgentina(p.timestamp);
    if (min == null || min < 0) continue;
    const q = (["main", "p05", "p25", "p75", "p95"] as Qualifier[]).includes(p.qualifier as Qualifier)
      ? (p.qualifier as Qualifier)
      : "main";
    s[q].push({ min, valor_m: p.valor_m });
  }
  for (const q of Object.keys(s) as Qualifier[]) {
    s[q].sort((a, b) => a.min - b.min);
  }
  return s;
}

function valorEn(serie: { min: number; valor_m: number }[], targetMin: number): number | null {
  if (serie.length === 0) return null;
  const exact = serie.find((p) => p.min === targetMin);
  if (exact) return exact.valor_m;
  let antes: { min: number; valor_m: number } | null = null;
  let despues: { min: number; valor_m: number } | null = null;
  for (const p of serie) {
    if (p.min <= targetMin) antes = p;
    else { despues = p; break; }
  }
  if (antes && despues) {
    const frac = (targetMin - antes.min) / (despues.min - antes.min || 1);
    return antes.valor_m + (despues.valor_m - antes.valor_m) * frac;
  }
  if (antes) return antes.valor_m;
  if (despues) return despues.valor_m;
  return null;
}

// Confianza de que "nivel <= límite" (ok = el valor está por debajo del nivel seguro).
// Usa las bandas p25/p95 para medir qué tan sólida es la conclusión del main.
function confianzaDeNivel(h: ValorHora, nivel: number): Confianza {
  if (h.main == null) return "baja";
  if (h.main <= nivel) {
    if (h.p95 == null) return "media";
    return h.p95 <= nivel ? "alta" : "media";
  }
  if (h.p25 == null) return "media";
  return h.p25 > nivel ? "alta" : "media";
}

// Cruces del nivel seguro: primer minuto donde el main sube por encima del límite
// (de ≤ a >), dentro del día. Es la hora límite de salida para no quedar varados.
function cruceSubida(serieMain: { min: number; valor_m: number }[], nivel: number): number | null {
  for (let i = 0; i < serieMain.length - 1; i++) {
    const a = serieMain[i];
    const b = serieMain[i + 1];
    if (a.valor_m <= nivel && b.valor_m > nivel) {
      const frac = (nivel - a.valor_m) / ((b.valor_m - a.valor_m) || 1);
      return a.min + frac * (b.min - a.min);
    }
  }
  return null;
}

export function calcularVeredicto(
  pronos: PuntoProno[],
  fecha: string,
  nivelSeguroM: number,
  diasSinClases: string[] = []
): VeredictoDia {
  const fechaA = fechaDiaArgentina(fecha + "T12:00:00");
  const weekday = weekdayArgentina(fecha + "T12:00:00");
  const esDia = esDiaEscolar(fechaA, weekday, diasSinClases);

  const s = serieDia(pronos, fecha);

  const horaEn = (horaMin: number): ValorHora => ({
    horaMin,
    main: valorEn(s.main, horaMin),
    p05: valorEn(s.p05, horaMin),
    p25: valorEn(s.p25, horaMin),
    p75: valorEn(s.p75, horaMin),
    p95: valorEn(s.p95, horaMin),
  });

  const entrada = horaEn(HORA_ENTRADA);
  const vuelta = horaEn(HORA_VUELTA);
  const hora7 = horaEn(HORA_VEREDICTO);
  const salidaLimiteMin = cruceSubida(s.main, nivelSeguroM);

  let estado: EstadoVeredicto = "sin_datos";
  if (!esDia) {
    estado = "normal";
  } else if (entrada.main == null || vuelta.main == null) {
    estado = "sin_datos";
  } else if (entrada.main > nivelSeguroM) {
    estado = "no_clases";
  } else if (vuelta.main > nivelSeguroM) {
    estado = "salida_temprana";
  } else {
    estado = "normal";
  }

  let confianza: Confianza = "baja";
  if (estado === "no_clases") {
    confianza = confianzaDeNivel(entrada, nivelSeguroM);
  } else if (estado === "salida_temprana") {
    const cIn = confianzaDeNivel(entrada, nivelSeguroM);
    const cV = confianzaDeNivel(vuelta, nivelSeguroM);
    confianza = cIn === "alta" && cV === "alta" ? "alta" : cIn === "baja" || cV === "baja" ? "baja" : "media";
  } else if (estado === "normal") {
    const cIn = confianzaDeNivel(entrada, nivelSeguroM);
    const cV = confianzaDeNivel(vuelta, nivelSeguroM);
    confianza = cIn === "alta" && cV === "alta" ? "alta" : cIn === "baja" || cV === "baja" ? "baja" : "media";
  }

  let motivo: string;
  switch (estado) {
    case "no_clases":
      motivo = `A las 8 el agua estaría en ${entrada.main?.toFixed(2)}m — sobre el nivel seguro (${nivelSeguroM.toFixed(2)}m): NO se puede cruzar en lancha.`;
      break;
    case "salida_temprana":
      motivo = `Se puede entrar a las 8 (${entrada.main?.toFixed(2)}m), pero a las 14:15 estaría en ${vuelta.main?.toFixed(2)}m` +
        (salidaLimiteMin != null ? ` — hay que irse antes de las ${hhmm(salidaLimiteMin)}.` : " — no se podría volver.");
      break;
    case "normal":
      motivo = `Agua accesible a las 8 (${entrada.main?.toFixed(2)}m) y a las 14:15 (${vuelta.main?.toFixed(2)}m) — rompe el día normal.`;
      break;
    case "sin_datos":
    default:
      motivo = `Sin pronóstico para ${fecha} — no se puede confirmar el plan.`;
      break;
  }

  return { fecha, esDiaEscolar: esDia, estado, confianza, nivelSeguroM, entrada, vuelta, hora7, salidaLimiteMin, motivo };
}

export function hhmm(min: number | null): string {
  if (min == null) return "--";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}