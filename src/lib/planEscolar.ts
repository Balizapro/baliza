// Plan escolar del día para el muelle de San Fernando.
// Lógica pura (sin imports externos) para calcular el veredicto del día
// (NO CLASES / SALIDA TEMPRANA / NORMAL) a partir del pronóstico INA
// (qualifiers main/p05/p25/p75/p95) y del nivel seguro del muelle.

// Se importa por tipo para no arrastrar dependencias: shn.ts no importa nada.
import type { AlturaSanFernando } from "./shn";

export type Qualifier = "main" | "p05" | "p25" | "p75" | "p95";

export interface PuntoProno {
  timestamp: string;
  valor_m: number;
  qualifier: string;
}

export type EstadoVeredicto = "normal" | "salida_temprana" | "no_clases" | "sin_datos";

export type Confianza = "alta" | "media" | "baja";

// Modo de cálculo del nivel efectivo:
//  - "estricto": peor fuente con todas las penalizaciones (es el valor actual).
//  - "suave": pronóstico central (INA main, modelo y SHN), sin bandas p75 ni
//    sesgo en vivo ni margen por crecida; menos conservador, para comparar la
//    sensibilidad del veredicto a las penalizaciones.
export type ModoPlan = "estricto" | "suave";

export interface PuntoModelo {
  timestamp: string;
  nivel_m: number;
}

export interface ValorHora {
  horaMin: number;
  main: number | null;
  p05: number | null;
  p25: number | null;
  p75: number | null;
  p95: number | null;
  // Modelo propio (armónico + viento + persistencia) y el peor de ambos:
  // la decisión usa el nivel más alto entre INA y modelo.
  modelo_m: number | null;
  efectivo_m: number | null;
}

export interface VeredictoDia {
  fecha: string;
  esDiaEscolar: boolean;
  modo: ModoPlan;
  estado: EstadoVeredicto;
  confianza: Confianza;
  nivelSeguroM: number;
  entrada: ValorHora;
  vuelta: ValorHora;
  hora7: ValorHora;
  salidaLimiteMin: number | null;
  motivo: string;
  // Sesgo estimado en vivo: observado - INA main (últimas horas). Solo aplica
  // cuando es positivo (INA subestima), que es el caso de riesgo.
  sesgo_m: number | null;
  // Señal de crecida en camino: máxima pendiente de subida (m/h) observada
  // recientemente en las estaciones vecinas (Bs As, La Plata), y cuál. La
  // marea entra por el estuario exterior y llega a SF con ~1-2h de desfase,
  // así que una subida fuerte afuera anticipa una subida fuerte en SF.
  pendiente_m: number | null;
  pendiente_estacion: string | null;
}

// Lecturas observadas de otra estación (misma estructura que PuntoModelo).
export interface LecturasVecina {
  nombre: string;
  lecturas: PuntoModelo[];
}

// Fuentes adicionales para el veredicto: modelo propio (armónico + viento +
// persistencia), lecturas observadas recientes (para corregir el sesgo en vivo),
// pleamares/bajamares del SHN (boletín mareológico) y lecturas de las estaciones
// vecinas (Bs As, La Plata, Pilote Norden...) para anticipar crecidas por
// pendiente de subida.
export interface FuentesPlan {
  modelo?: PuntoModelo[];
  shnObservado?: PuntoModelo[];
  shnAlturas?: AlturaSanFernando[];
  vecinas?: LecturasVecina[];
}

// Pendiente de subida que indica crecida en camino. Una estación vecina
// subiendo ≥ 0.35 m/h es señal anómala: la misma ola llega a SF más tarde.
const UMBRAL_PENDIENTE_M_H = 0.35;
// Subida de marea "normal" en el estuario (~0.1-0.2 m/h); solo el exceso sobre
// esta base se penaliza como crecida.
const PENDIENTE_BASE_M_H = 0.20;
// Tope del margen de seguridad que se suma al nivel efectivo por el exceso.
const MAX_PENDIENTE_MARGEN_M = 0.25;

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

// Número utilizable: descarta null/undefined/NaN (un NaN en una fuente no debe
// propagarse al veredicto; NaN != null es false y se cuela en los guards).
function esNum(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

// Interpola el valor del pronóstico (de cada qualifier) a una hora exacta del día
// (en minutos locales). Devuelve celdas por qualifier.
function serieDia(pronos: PuntoProno[], fecha: string): Record<Qualifier, { min: number; valor_m: number }[]> {
  const s: Record<Qualifier, { min: number; valor_m: number }[]> = { main: [], p05: [], p25: [], p75: [], p95: [] };
  for (const p of pronos) {
    if (fechaDiaArgentina(p.timestamp) !== fecha) continue;
    if (!esNum(p.valor_m)) continue;
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
// (de ≤ a >), dentro del día y a partir de `desdeMin` (la hora de entrada: un
// cruce nocturno/madrugada no es la salida límite relevante). Es la hora límite
// de salida para no quedar varados.
function cruceSubida(serieMain: { min: number; valor_m: number }[], nivel: number, desdeMin = 0): number | null {
  for (let i = 0; i < serieMain.length - 1; i++) {
    const a = serieMain[i];
    const b = serieMain[i + 1];
    if (a.valor_m <= nivel && b.valor_m > nivel) {
      const frac = (nivel - a.valor_m) / ((b.valor_m - a.valor_m) || 1);
      const minCruce = a.min + frac * (b.min - a.min);
      if (minCruce >= desdeMin) return minCruce;
    }
  }
  return null;
}

// Máxima pendiente de subida (m/h) observada recientemente en las estaciones
// vecinas. Solo cuenta subidas (Δ positivo) sobre el último tramo de lecturas.
// Devuelve la mayor pendiente (y qué estación). Si ninguna sube fuerte, null.
function pendienteSubidaReciente(vecinas: LecturasVecina[], maxLecturas = 6): { pendiente_m: number; estacion: string } | null {
  let mejor: { pendiente_m: number; estacion: string } | null = null;
  for (const v of vecinas) {
    const serie = [...v.lecturas]
      .filter((l) => l.nivel_m != null)
      .map((l) => ({ t: new Date(l.timestamp).getTime(), v: l.nivel_m }))
      .sort((a, b) => a.t - b.t)
      .slice(-maxLecturas);
    for (let i = 1; i < serie.length; i++) {
      const a = serie[i - 1];
      const b = serie[i];
      const horas = (b.t - a.t) / 3600000;
      if (horas <= 0) continue;
      const pend = (b.v - a.v) / horas; // m/h
      if (pend > 0 && (!mejor || pend > mejor.pendiente_m)) {
        mejor = { pendiente_m: pend, estacion: v.nombre };
      }
    }
  }
  return mejor;
}

// Margen de seguridad por crecida en camino: el exceso de pendiente de subida
// sobre la base de marea normal, con tope. Solo positivo (nunca baja el nivel).
function margenPorPendiente(pendiente_m: number | null): number {
  if (pendiente_m == null || pendiente_m < UMBRAL_PENDIENTE_M_H) return 0;
  return Math.min(MAX_PENDIENTE_MARGEN_M, Math.max(0, pendiente_m - PENDIENTE_BASE_M_H));
}

// Sesgo "en vivo": observado - pronosticado INA interpolado en el MISMO minuto.
// Las lecturas SHN horarias llegan cada hora a los :45; el pronóstico INA es
// horario (:00). Comparar obs(:45) contra INA(:00) inflaría el sesgo con el
// avance real de la marea en esos 45 min, así que se interpola INA con
// la escala de minutos de la observación. Solo se usa cuando es positivo
// (INA subestima), que es el caso de riesgo.
function sesgoEnVivo(pronos: PuntoProno[], observadas: PuntoModelo[]): number | null {
  const pronoMain = pronos
    .filter((p) => p.qualifier === "main")
    .map((p) => ({ t: new Date(p.timestamp).getTime(), v: p.valor_m }))
    .sort((a, b) => a.t - b.t);
  if (pronoMain.length === 0) return null;

  const interp = (t: number): number | null => {
    let antes: { t: number; v: number } | null = null;
    let despues: { t: number; v: number } | null = null;
    for (const p of pronoMain) {
      if (p.t <= t) antes = p;
      else { despues = p; break; }
    }
    if (antes && despues) {
      const frac = (t - antes.t) / (despues.t - antes.t || 1);
      return antes.v + (despues.v - antes.v) * frac;
    }
    return antes ? antes.v : despues ? despues.v : null;
  };

  const diffs: number[] = [];
  const obs = [...observadas]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  for (const o of obs.slice(-6)) {
    const tO = new Date(o.timestamp).getTime();
    const pv = interp(tO);
    if (pv != null) diffs.push(o.nivel_m - pv);
  }
  if (diffs.length === 0) return null;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

// Serie del nivel efectivo para todo el día: en cada punto horario se toma el
// peor (más alto) entre INA main, INA p75, modelo propio, SHN (pleamar/bajamar
// bracketed), INA main + sesgo y INA main + margen por crecida en camino.
function serieEfectiva(
  s: Record<Qualifier, { min: number; valor_m: number }[]>,
  serieModelo: { min: number; valor_m: number }[],
  serieSHN: { min: number; valor_m: number }[],
  sesgo: number | null,
  margenPendiente: number,
  modo: ModoPlan
): { min: number; valor_m: number }[] {
  const puntos = new Map<number, number[]>();
  const agrega = (min: number | null, v: number | null) => {
    if (!esNum(min) || !esNum(v)) return;
    if (!puntos.has(min)) puntos.set(min, []);
    puntos.get(min)!.push(v);
  };

  for (const p of s.main) agrega(p.min, p.valor_m);
  if (modo === "estricto") {
    for (const p of s.main) agrega(p.min, sesgo != null ? p.valor_m + Math.max(0, sesgo) : null);
    for (const p of s.main) agrega(p.min, margenPendiente > 0 ? p.valor_m + margenPendiente : null);
    for (const p of s.p75) agrega(p.min, p.valor_m + (sesgo != null ? Math.max(0, sesgo) : 0));
    for (const p of serieModelo) agrega(p.min, p.valor_m + (sesgo != null ? Math.max(0, sesgo) : 0));
  } else {
    for (const p of serieModelo) agrega(p.min, p.valor_m);
  }
  // SHN bracketed: cada extremo se interpola en la serie de suma, los puntos
  // intermedios quedan cubiertos por la interpolación de cruceSubida.
  for (const p of serieSHN) agrega(p.min, p.valor_m);

  const serie: { min: number; valor_m: number }[] = [];
  for (const [min, vs] of puntos) {
    serie.push({ min, valor_m: Math.max(...vs) });
  }
  serie.sort((a, b) => a.min - b.min);
  return serie;
}

// Valor efectivo (peor fuente) en una hora exacta: max(INA main, INA p75,
// modelo, SHN interpolado, INA main + sesgo, INA main + margen por crecida).
// Si hay sesgo positivo se penaliza hacia arriba. La SHN solo aporta si hay dos
// extremos que acoten la hora.
function valorEfectivo(
  s: Record<Qualifier, { min: number; valor_m: number }[]>,
  serieModelo: { min: number; valor_m: number }[],
  serieSHN: { min: number; valor_m: number }[],
  sesgo: number | null,
  margenPendiente: number,
  horaMin: number,
  modo: ModoPlan
): { main: number | null; modelo: number | null; efectivo: number | null; p75: number | null } {
  const main = valorEn(s.main, horaMin);
  const p75 = valorEn(s.p75, horaMin);
  const modelo = valorEn(serieModelo, horaMin);
  const shnValor = valorEn(serieSHN, horaMin);
  const candidatos: number[] = [];
  if (esNum(main)) candidatos.push(main);
  if (modo === "estricto") {
    if (esNum(main) && sesgo != null) candidatos.push(main + Math.max(0, sesgo));
    if (esNum(main) && margenPendiente > 0) candidatos.push(main + margenPendiente);
    if (esNum(modelo)) candidatos.push(modelo);
    if (esNum(p75)) candidatos.push(p75);
  } else {
    if (esNum(modelo)) candidatos.push(modelo);
  }
  if (esNum(shnValor)) candidatos.push(shnValor);
  const efectivo = candidatos.length ? Math.max(...candidatos) : null;
  return { main, modelo, efectivo, p75 };
}

export function calcularVeredicto(
  pronos: PuntoProno[],
  fecha: string,
  nivelSeguroM: number,
  diasSinClases: string[] = [],
  fuentes: FuentesPlan = {},
  modo: ModoPlan = "estricto"
): VeredictoDia {
  const fechaA = fechaDiaArgentina(fecha + "T12:00:00");
  const weekday = weekdayArgentina(fecha + "T12:00:00");
  const esDia = esDiaEscolar(fechaA, weekday, diasSinClases);

  const s = serieDia(pronos, fecha);

  // Serie del modelo propio para el día (solo puntos dentro de `fecha`)
  const serieModelo: { min: number; valor_m: number }[] = (fuentes.modelo ?? [])
    .filter((p) => fechaDiaArgentina(p.timestamp) === fecha && esNum(p.nivel_m))
    .map((p) => ({ min: minutosDiaArgentina(p.timestamp)!, valor_m: p.nivel_m }))
    .filter((p) => p.min != null)
    .sort((a, b) => a.min - b.min);

  // Serie del SHN (boletín mareológico): pleamar/bajamar del día. Solo se anima
  // niveles bracketed (entre dos extremos correlativos) para no extrapolar mal.
  const serieSHN: { min: number; valor_m: number }[] = (fuentes.shnAlturas ?? [])
    .filter((a) => a.fecha.split("/").reverse().join("-") === fecha && esNum(a.altura))
    .map((a) => {
      const [hh, mm] = a.hora.split(":").map(Number);
      return { min: hh * 60 + mm, valor_m: a.altura };
    })
    .sort((a, b) => a.min - b.min);

  const sesgo = sesgoEnVivo(pronos, fuentes.shnObservado ?? []);

  // Señal de crecida en camino: ¿alguna estación vecina está subiendo fuerte en
  // las últimas horas? La marea entra por el estuario y llega a SF con desfase.
  const pendiente = pendienteSubidaReciente(fuentes.vecinas ?? []);
  const margenPendiente = margenPorPendiente(pendiente?.pendiente_m ?? null);

  const horaEn = (horaMin: number): ValorHora => {
    const e = valorEfectivo(s, serieModelo, serieSHN, sesgo, margenPendiente, horaMin, modo);
    return {
      horaMin,
      main: e.main,
      p05: valorEn(s.p05, horaMin),
      p25: valorEn(s.p25, horaMin),
      p75: e.p75,
      p95: valorEn(s.p95, horaMin),
      modelo_m: e.modelo,
      efectivo_m: e.efectivo,
    };
  };

  const entrada = horaEn(HORA_ENTRADA);
  const vuelta = horaEn(HORA_VUELTA);
  const hora7 = horaEn(HORA_VEREDICTO);

  const serieEff = serieEfectiva(s, serieModelo, serieSHN, sesgo, margenPendiente, modo);
  const salidaLimiteMin = cruceSubida(serieEff, nivelSeguroM, HORA_ENTRADA);

  // La decisión se toma con el nivel efectivo (peor fuente), no con main solo.
  let estado: EstadoVeredicto = "sin_datos";
  if (!esDia) {
    estado = "normal";
  } else if (!esNum(entrada.efectivo_m) || !esNum(vuelta.efectivo_m)) {
    estado = "sin_datos";
  } else if (entrada.efectivo_m > nivelSeguroM) {
    estado = "no_clases";
  } else if (vuelta.efectivo_m > nivelSeguroM) {
    estado = "salida_temprana";
  } else {
    estado = "normal";
  }

  // Regla de seguridad: si hay que irse a menos de 60 min de entrar, no tiene
  // sentido mandar a los chicos (margen de escape insuficiente) → NO CLASES.
  if (
    estado === "salida_temprana" &&
    salidaLimiteMin != null &&
    salidaLimiteMin - HORA_ENTRADA < 60
  ) {
    estado = "no_clases";
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

  const nivel = (h: ValorHora) => (h.efectivo_m != null ? h.efectivo_m : h.main);
  const sesgoNota = sesgo != null && sesgo > 0 ? ` (sesgo en vivo +${sesgo.toFixed(2)}m)` : "";
  const pendienteNota =
    margenPendiente > 0 && pendiente
      ? ` — ${pendiente.estacion} subiendo a ${pendiente.pendiente_m.toFixed(2)} m/h: crecida en camino`
      : "";

  // ¿Por qué NO CLASES? Por la entrada cortada o por la regla de los 60 min.
  const motivo60 = estado === "no_clases" && entrada.efectivo_m != null && entrada.efectivo_m <= nivelSeguroM;

  let motivo: string;
  switch (estado) {
    case "no_clases":
      motivo = motivo60
        ? `Se podría entrar a las 8 (${nivel(entrada)?.toFixed(2)}m), pero el muelle ya sube: la salida límite quedaría a las ${hhmm(salidaLimiteMin)} — solo ${Math.max(0, Math.round((salidaLimiteMin ?? HORA_ENTRADA) - HORA_ENTRADA))} min después de entrar, margen insuficiente: NO CLASES.`
        : `A las 8 el agua estaría en ${nivel(entrada)?.toFixed(2)}m — sobre el nivel seguro (${nivelSeguroM.toFixed(2)}m): NO se puede cruzar en lancha.` + sesgoNota + pendienteNota;
      break;
    case "salida_temprana":
      motivo = `Se puede entrar a las 8 (${nivel(entrada)?.toFixed(2)}m), pero a las 14:15 estaría en ${nivel(vuelta)?.toFixed(2)}m` +
        (salidaLimiteMin != null ? ` — hay que irse antes de las ${hhmm(salidaLimiteMin)}.` : " — no se podría volver.") + sesgoNota + pendienteNota;
      break;
    case "normal":
      motivo = `Agua accesible a las 8 (${nivel(entrada)?.toFixed(2)}m) y a las 14:15 (${nivel(vuelta)?.toFixed(2)}m) — rompe el día normal.` + sesgoNota + pendienteNota;
      break;
    case "sin_datos":
    default:
      motivo = `Sin pronóstico para ${fecha} — no se puede confirmar el plan.`;
      break;
  }

  return {
    fecha,
    esDiaEscolar: esDia,
    modo,
    estado,
    confianza,
    nivelSeguroM,
    entrada,
    vuelta,
    hora7,
    salidaLimiteMin,
    motivo,
    sesgo_m: sesgo,
    pendiente_m: pendiente?.pendiente_m ?? null,
    pendiente_estacion: pendiente?.estacion ?? null,
  };
}

export function hhmm(min: number | null): string {
  if (min == null) return "--";
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}