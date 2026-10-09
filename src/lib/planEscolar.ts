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
//  - "estricto": peor fuente con las penalizaciones (sesgo en vivo, crecida en camino, modelo,
//    SHN y aviso oficial). La banda de error del INA (p25/p75) NO decide: se muestra como rango.
//  - "suave": pronóstico central (INA main, modelo y SHN), sin sesgo en vivo ni
//    margen por crecida; menos conservador, para comparar la sensibilidad del
//    veredicto a las penalizaciones.
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
  // Qué fuente dio el nivel efectivo (la más alta). Sirve para explicarlo en el aviso.
  fuente?: FuenteNivel | null;
  // Punto del aviso oficial del SHN que se usó (cuando fuente === "aviso").
  aviso?: { min: number; altura_m: number } | null;
  // Punto del aviso del SHN que se DESCARTÓ por quedar atrás del INA (ver AVISO_MARGEN_INA_M).
  aviso_descartado?: { min: number; altura_m: number; emitidoMs: number | null } | null;
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
  // `motivo` partido en dos: la frase corta (para el titular del banner) y la explicación de
  // dónde sale el número (para letra chica). motivo === motivo_corto + explicacion.
  motivo_corto: string;
  explicacion: string;
  // "Ojito": el aviso del SHN manda, pero el INA cae del OTRO lado del límite en la hora decisiva.
  ina_difiere: { main_m: number; hora: number; lado: "sobre" | "bajo" } | null;
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
  // Aviso oficial por crecida del SHN (ver puntosAvisoSanFernando): fuente oficial del veredicto.
  shnAviso?: PuntoAvisoShn[];
  // Cuándo se cargó el último pronóstico del INA (para saber si es más nuevo que el aviso del SHN).
  inaIngestadoMs?: number | null;
}

// Pendiente de subida que indica crecida en camino. Una estación vecina
// subiendo ≥ 0.35 m/h es señal anómala: la misma ola llega a SF más tarde.
const UMBRAL_PENDIENTE_M_H = 0.35;
// Subida de marea "normal" en el estuario (~0.1-0.2 m/h); solo el exceso sobre
// esta base se penaliza como crecida.
const PENDIENTE_BASE_M_H = 0.20;
// Tope del margen de seguridad que se suma al nivel efectivo por el exceso.
const MAX_PENDIENTE_MARGEN_M = 0.25;

// El "sesgo en vivo" (lo medido vs. lo pronosticado en las últimas horas) nació el 18-ago
// para corregir las HORAS SIGUIENTES, el mismo día. Un error medido esta noche no dice nada
// confiable sobre lo que pasará dentro de 1-2 días (el veredicto se calcula para 4 días y
// antes se sumaba entero a todos). Se aplica completo durante SESGO_PLENO_HS desde la última
// observación y se apaga linealmente hasta SESGO_NULO_HS. Valores razonables, NO calibrados
// con histórico: revisarlos cuando haya eventos para comparar.
export const SESGO_PLENO_HS = 12;
export const SESGO_NULO_HS = 36;
export function pesoSesgo(horasAdelante: number): number {
  if (!Number.isFinite(horasAdelante) || horasAdelante <= SESGO_PLENO_HS) return 1;
  if (horasAdelante >= SESGO_NULO_HS) return 0;
  return 1 - (horasAdelante - SESGO_PLENO_HS) / (SESGO_NULO_HS - SESGO_PLENO_HS);
}

// De dónde sale el nivel que se usa para decidir (la peor de varias fuentes).
export type FuenteNivel = "ina" | "sesgo" | "pendiente" | "modelo" | "shn" | "aviso" | "medido";

// Aviso oficial por crecida del SHN: altura estimada en San Fernando con día y hora locales.
export interface PuntoAvisoShn {
  fecha: string; // YYYY-MM-DD
  min: number; // minutos del día local
  altura_m: number;
  // Cuándo emitió el SHN el aviso (para saber si el INA es más nuevo). null/ausente = se desconoce.
  emitidoMs?: number | null;
}

// Extrae los puntos de San Fernando de un aviso/alerta por crecida del SHN. Un CESE, o un aviso
// de otra cosa (viento, bajante...), no suma. Si el SHN sube la alerta, el plan tiene que verla:
// antes el aviso solo se mostraba y no entraba al cálculo (7-oct-2026).
export function puntosAvisoSanFernando(
  aviso:
    | {
        tipo: string;
        emitido?: string | null;
        alturas: { puerto: string; altura_m: number; hora: string; fecha: string }[] | null;
      }
    | null
    | undefined
): PuntoAvisoShn[] {
  if (!aviso || !aviso.alturas) return [];
  const tipo = String(aviso.tipo ?? "").toLowerCase();
  if (!tipo.includes("crecida") || tipo.startsWith("cese")) return [];
  const puntos: PuntoAvisoShn[] = [];
  const emitidoMs = aviso.emitido ? Date.parse(aviso.emitido) : Number.NaN;
  for (const a of aviso.alturas) {
    if (!String(a.puerto ?? "").toUpperCase().includes("SAN FERNANDO")) continue;
    const h = /^(\d{1,2}):(\d{2})$/.exec(String(a.hora ?? ""));
    const f = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(a.fecha ?? ""));
    const altura = Number(a.altura_m);
    if (!h || !f || !Number.isFinite(altura)) continue;
    puntos.push({
      fecha: `${f[3]}-${f[2]}-${f[1]}`,
      min: Number(h[1]) * 60 + Number(h[2]),
      altura_m: altura,
      emitidoMs: Number.isFinite(emitidoMs) ? emitidoMs : null,
    });
  }
  return puntos;
}

// El aviso da la altura estimada en un momento (pleamar con sobreelevación): se la toma como
// el nivel de las horas cercanas. Ventana conservadora, NO calibrada con histórico.
const AVISO_VENTANA_MIN = 90;
// Salvaguarda (8-oct-2026): el aviso del SHN manda, SALVO que el INA sea más nuevo y lo supere por más
// de este margen: ahí el aviso quedó atrás y se toma el INA (se avisa) hasta que el SHN actualice.
export const AVISO_MARGEN_INA_M = 0.15;

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

function valorEn(
  serie: { min: number; valor_m: number }[],
  targetMin: number,
  opts?: { soloBracketed?: boolean }
): number | null {
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
  // La serie SHN (pleamares/bajamares dispersas) SOLO aporta si el target está
  // acotado entre dos extremos: estirar la pleamar de las 16:00 sobre las 8:00
  // metía valores falsos en la mañana. Las series densas (INA/modelo) mantienen
  // el comportamiento de borde de siempre.
  if (opts?.soloBracketed) return null;
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
function sesgoEnVivo(pronos: PuntoProno[], observadas: PuntoModelo[]): { valor: number; refMs: number } | null {
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
  const ultimas = obs.slice(-6);
  for (const o of ultimas) {
    const tO = new Date(o.timestamp).getTime();
    const pv = interp(tO);
    if (pv != null) diffs.push(o.nivel_m - pv);
  }
  if (diffs.length === 0) return null;
  diffs.sort((a, b) => a - b);
  // refMs: momento de la última observación; desde ahí se mide cuánto "se apaga" el ajuste.
  const refMs = new Date(ultimas[ultimas.length - 1].timestamp).getTime();
  return { valor: diffs[Math.floor(diffs.length / 2)], refMs };
}

// Serie del nivel efectivo para todo el día: en cada punto horario se toma el
// peor (más alto) entre INA main, modelo propio, aviso del SHN, SHN (pleamar/bajamar
// bracketed), INA main + sesgo y INA main + margen por crecida en camino.
function serieEfectiva(
  s: Record<Qualifier, { min: number; valor_m: number }[]>,
  serieModelo: { min: number; valor_m: number }[],
  serieSHN: { min: number; valor_m: number }[],
  avisoDia: { min: number; valor_m: number }[],
  medido: { min: number; nivel_m: number } | null,
  sesgoAt: (min: number) => number,
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
    for (const p of s.main) agrega(p.min, p.valor_m + sesgoAt(p.min));
    for (const p of s.main) agrega(p.min, margenPendiente > 0 ? p.valor_m + margenPendiente : null);
    for (const p of serieModelo) agrega(p.min, p.valor_m + sesgoAt(p.min));
  } else {
    for (const p of serieModelo) agrega(p.min, p.valor_m);
  }
  // SHN bracketed: cada extremo se interpola en la serie de suma, los puntos
  // intermedios quedan cubiertos por la interpolación de cruceSubida.
  for (const p of serieSHN) agrega(p.min, p.valor_m);
  // El aviso del SHN manda en su ventana: se descartan los puntos del INA/modelo/ajustes de esa
  // ventana y quedan el aviso (y lo medido, si hay).
  const enVentana = (min: number) => avisoDia.some((a) => Math.abs(a.min - min) <= AVISO_VENTANA_MIN);
  for (const min of [...puntos.keys()]) if (enVentana(min)) puntos.delete(min);
  for (const p of avisoDia) agrega(p.min, p.valor_m);
  if (medido != null && enVentana(medido.min)) agrega(medido.min, medido.nivel_m);

  const serie: { min: number; valor_m: number }[] = [];
  for (const [min, vs] of puntos) {
    serie.push({ min, valor_m: Math.max(...vs) });
  }
  serie.sort((a, b) => a.min - b.min);
  return serie;
}

// Valor efectivo (peor fuente) en una hora exacta: max(INA main, modelo, SHN
// interpolado, aviso del SHN, INA main + sesgo, INA main + margen por crecida).
// La banda p75 del INA NO entra: es contexto, no decide.
// Si hay sesgo positivo se penaliza hacia arriba. La SHN solo aporta si hay dos
// extremos que acoten la hora.
function valorEfectivo(
  s: Record<Qualifier, { min: number; valor_m: number }[]>,
  serieModelo: { min: number; valor_m: number }[],
  serieSHN: { min: number; valor_m: number }[],
  avisoDia: { min: number; valor_m: number }[],
  medido: { min: number; nivel_m: number } | null,
  sesgoAt: (min: number) => number,
  margenPendiente: number,
  horaMin: number,
  modo: ModoPlan
): {
  main: number | null;
  modelo: number | null;
  efectivo: number | null;
  p75: number | null;
  fuente: FuenteNivel | null;
  aviso: { min: number; altura_m: number } | null;
} {
  const main = valorEn(s.main, horaMin);
  const p75 = valorEn(s.p75, horaMin);
  const modelo = valorEn(serieModelo, horaMin);
  const shnValor = valorEn(serieSHN, horaMin, { soloBracketed: true });

  // El aviso oficial del SHN MANDA dentro de su ventana: reemplaza al INA, al modelo, a las mareas
  // y a los ajustes, aunque dé MENOS que el INA (el INA queda como "ojito" aparte). Pedido de la
  // escuela (8-oct-2026): el 30/9 el SHN erró +6 cm y el INA -40 cm. Lo único que no se ignora es
  // lo que se está MIDIENDO en esas horas: si supera al aviso, gana.
  const avisoCerca = avisoDia
    .filter((a) => Math.abs(a.min - horaMin) <= AVISO_VENTANA_MIN)
    .sort((x, y) => y.valor_m - x.valor_m);
  if (avisoCerca.length > 0) {
    const a = avisoCerca[0];
    if (medido != null && Math.abs(medido.min - horaMin) <= AVISO_VENTANA_MIN && medido.nivel_m > a.valor_m) {
      return { main, modelo, efectivo: medido.nivel_m, p75, fuente: "medido", aviso: { min: a.min, altura_m: a.valor_m } };
    }
    return { main, modelo, efectivo: a.valor_m, p75, fuente: "aviso", aviso: { min: a.min, altura_m: a.valor_m } };
  }
  const candidatos: { v: number; f: FuenteNivel }[] = [];
  if (esNum(main)) candidatos.push({ v: main, f: "ina" });
  if (modo === "estricto") {
    const sg = sesgoAt(horaMin);
    if (esNum(main) && sg > 0) candidatos.push({ v: main + sg, f: "sesgo" });
    if (esNum(main) && margenPendiente > 0) candidatos.push({ v: main + margenPendiente, f: "pendiente" });
    if (esNum(modelo)) candidatos.push({ v: modelo, f: "modelo" });
  } else {
    if (esNum(modelo)) candidatos.push({ v: modelo, f: "modelo" });
  }
  if (esNum(shnValor)) candidatos.push({ v: shnValor, f: "shn" });
  let mejor: { v: number; f: FuenteNivel } | null = null;
  for (const c of candidatos) if (mejor == null || c.v > mejor.v) mejor = c;
  return { main, modelo, efectivo: mejor ? mejor.v : null, p75, fuente: mejor ? mejor.f : null, aviso: null };
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

  // Puntos del aviso oficial del SHN para ESTE día (si hay).
  const avisosFecha = (fuentes.shnAviso ?? [])
    .filter((a) => a.fecha === fecha && esNum(a.altura_m) && esNum(a.min))
    .sort((a, b) => a.min - b.min);
  // Salvaguarda: el aviso queda atrás si el INA es más nuevo (o no se sabe) y a la hora del aviso
  // lo supera por más de AVISO_MARGEN_INA_M. Sin freshness conocida se asume que el INA es más nuevo
  // (lado seguro). Esos puntos NO mandan: se usa el INA y se explica.
  const inaMasNuevo = (emitidoMs: number | null | undefined) =>
    fuentes.inaIngestadoMs == null || emitidoMs == null || fuentes.inaIngestadoMs > emitidoMs;
  const quedoAtras = (a: { min: number; altura_m: number; emitidoMs?: number | null }) => {
    const ina = valorEn(s.main, a.min);
    return ina != null && ina - a.altura_m > AVISO_MARGEN_INA_M && inaMasNuevo(a.emitidoMs);
  };
  const avisoDia: { min: number; valor_m: number }[] = avisosFecha
    .filter((a) => !quedoAtras(a))
    .map((a) => ({ min: a.min, valor_m: a.altura_m }));
  const avisoDescartado = avisosFecha
    .filter((a) => quedoAtras(a))
    .map((a) => ({ min: a.min, altura_m: a.altura_m, emitidoMs: a.emitidoMs ?? null }));

  const sesgoInfo = sesgoEnVivo(pronos, fuentes.shnObservado ?? []);
  const sesgo = sesgoInfo ? sesgoInfo.valor : null; // el medido (se muestra tal cual)
  // Ajuste que le corresponde a cada hora de ESTE día: pleno cerca de la observación y
  // apagado cuando se mira lejos (ver SESGO_PLENO_HS / SESGO_NULO_HS).
  const t0Ms = Date.parse(`${fecha}T00:00:00-03:00`);
  const sesgoAt = (min: number): number =>
    sesgoInfo == null
      ? 0
      : Math.max(0, sesgoInfo.valor) * pesoSesgo((t0Ms + min * 60000 - sesgoInfo.refMs) / 3600000);
  // Última lectura medida (en minutos de ESTE día): el aviso del SHN no puede ignorarla.
  const obsOrdenadas = [...(fuentes.shnObservado ?? [])].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const ultObs = obsOrdenadas.length ? obsOrdenadas[obsOrdenadas.length - 1] : null;
  const medido =
    ultObs && esNum(ultObs.nivel_m)
      ? { min: (new Date(ultObs.timestamp).getTime() - t0Ms) / 60000, nivel_m: Number(ultObs.nivel_m) }
      : null;

  // Señal de crecida en camino: ¿alguna estación vecina está subiendo fuerte en
  // las últimas horas? La marea entra por el estuario y llega a SF con desfase.
  const pendiente = pendienteSubidaReciente(fuentes.vecinas ?? []);
  const margenPendiente = margenPorPendiente(pendiente?.pendiente_m ?? null);

  const horaEn = (horaMin: number): ValorHora => {
    const e = valorEfectivo(s, serieModelo, serieSHN, avisoDia, medido, sesgoAt, margenPendiente, horaMin, modo);
    return {
      horaMin,
      main: e.main,
      p05: valorEn(s.p05, horaMin),
      p25: valorEn(s.p25, horaMin),
      p75: e.p75,
      p95: valorEn(s.p95, horaMin),
      modelo_m: e.modelo,
      efectivo_m: e.efectivo,
      fuente: e.fuente,
      aviso: e.aviso,
      aviso_descartado:
        avisoDescartado
          .filter((a) => Math.abs(a.min - horaMin) <= AVISO_VENTANA_MIN)
          .sort((x, y) => y.altura_m - x.altura_m)[0] ?? null,
    };
  };

  const entrada = horaEn(HORA_ENTRADA);
  const vuelta = horaEn(HORA_VUELTA);
  const hora7 = horaEn(HORA_VEREDICTO);

  const serieEff = serieEfectiva(s, serieModelo, serieSHN, avisoDia, medido, sesgoAt, margenPendiente, modo);
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
  // "Ojito": el aviso del SHN manda en su ventana, pero si el INA cae del OTRO lado del límite se
  // avisa que dice otra cosa (pedido de la escuela, 8-oct-2026).
  const ojo = (h: ValorHora): { main_m: number; hora: number; lado: "sobre" | "bajo" } | null => {
    if (h.fuente !== "aviso" || h.main == null || h.efectivo_m == null) return null;
    const decide = h.efectivo_m > nivelSeguroM;
    const ina = h.main > nivelSeguroM;
    return decide === ina ? null : { main_m: h.main, hora: h.horaMin, lado: ina ? "sobre" : "bajo" };
  };
  const textoOjo = (o: { main_m: number; hora: number; lado: "sobre" | "bajo" }): string =>
    ` 👁️ El INA dice otra cosa: pronostica ${o.main_m.toFixed(2)}m a las ${hhmm(o.hora)}, ${o.lado} el límite (${nivelSeguroM.toFixed(2)}m).`;
  const textoAviso = (h: ValorHora): string =>
    h.aviso
      ? `aviso oficial del SHN (San Fernando ${h.aviso.altura_m.toFixed(2)}m a las ${hhmm(h.aviso.min)})`
      : "aviso oficial del SHN";
  const inaDifiere = ojo(entrada) ?? ojo(vuelta);

  // Qué pronostica el INA y de dónde sale el número que se usa. La banda de error (rango habitual)
  // se muestra como contexto pero NO decide: la decisión se guía por el nivel pronosticado
  // (pedido de la escuela, 8-oct-2026). Solo si otra fuente lo subió se aclara cuál.
  const explicaNivelBase = (h: ValorHora, inicio: string): string => {
    if (h.main == null) return "";
    const rango = h.p25 != null && h.p75 != null ? ` (rango habitual ${h.p25.toFixed(2)}–${h.p75.toFixed(2)}m)` : "";
    if (h.fuente === "aviso" && h.efectivo_m != null) {
      const o = ojo(h);
      return ` Se toma ${h.efectivo_m.toFixed(2)}m del ${textoAviso(h)}.` + (o ? textoOjo(o) : ` El INA pronostica ${h.main.toFixed(2)}m${rango}.`);
    }
    if (h.fuente === "medido" && h.efectivo_m != null) {
      return ` Se toma ${h.efectivo_m.toFixed(2)}m: lo que se está midiendo ahora supera al ${textoAviso(h)}. El INA pronostica ${h.main.toFixed(2)}m${rango}.`;
    }
    if (h.efectivo_m == null || h.fuente == null || h.efectivo_m - h.main <= 0.03) {
      return ` ${inicio} ${h.main.toFixed(2)}m${rango}.`;
    }
    const porque: Record<FuenteNivel, string> = {
      ina: "el pronóstico del INA",
      sesgo: `el ajuste en vivo (+${sesgoAt(h.horaMin).toFixed(2)}m: lo medido viene más alto que lo pronosticado)`,
      modelo: "el modelo propio de Baliza (marea + viento)",
      shn: "el boletín de mareas del SHN",
      pendiente: "la crecida en camino desde el exterior",
      aviso: `el ${textoAviso(h)}`,
      medido: "lo que se está midiendo ahora",
    };
    return ` ${inicio} ${h.main.toFixed(2)}m${rango}; se toma ${h.efectivo_m.toFixed(2)}m por ${porque[h.fuente]}.`;
  };
  // El aviso del SHN quedó atrás (más viejo y mucho más bajo que el INA): se toma el INA y se dice.
  const notaDescartado = (h: ValorHora): string => {
    const d = h.aviso_descartado;
    if (!d || h.main == null) return "";
    const emitido = d.emitidoMs != null ? minutosDiaArgentina(new Date(d.emitidoMs).toISOString()) : null;
    const cm = Math.round((h.main - d.altura_m) * 100);
    return ` Ojo: el aviso del SHN (San Fernando ${d.altura_m.toFixed(2)}m a las ${hhmm(d.min)}${emitido != null ? `, emitido a las ${hhmm(emitido)}` : ""}) es más viejo y queda ${cm} cm por debajo del INA: se toma el INA hasta que el SHN actualice.`;
  };
  const explicaNivel = (h: ValorHora, inicio: string): string => explicaNivelBase(h, inicio) + notaDescartado(h);
  const pendienteNota =
    margenPendiente > 0 && pendiente
      ? ` — ${pendiente.estacion} subiendo a ${pendiente.pendiente_m.toFixed(2)} m/h: crecida en camino`
      : "";

  // ¿Por qué NO CLASES? Por la entrada cortada o por la regla de los 60 min.
  const motivo60 = estado === "no_clases" && entrada.efectivo_m != null && entrada.efectivo_m <= nivelSeguroM;

  let motivoCorto: string;
  let explicacion = "";
  switch (estado) {
    case "no_clases":
      if (motivo60) {
        motivoCorto = `Se podría entrar a las 8 (${nivel(entrada)?.toFixed(2)}m), pero el muelle ya sube: la salida límite quedaría a las ${hhmm(salidaLimiteMin)} — solo ${Math.max(0, Math.round((salidaLimiteMin ?? HORA_ENTRADA) - HORA_ENTRADA))} min después de entrar, margen insuficiente: NO CLASES.`;
      } else {
        motivoCorto = `A las 8 el agua estaría en ${nivel(entrada)?.toFixed(2)}m — sobre el nivel seguro (${nivelSeguroM.toFixed(2)}m): NO se puede cruzar en lancha.`;
        explicacion = explicaNivel(entrada, "El INA pronostica") + pendienteNota;
      }
      break;
    case "salida_temprana":
      motivoCorto = `Se puede entrar a las 8 (${nivel(entrada)?.toFixed(2)}m), pero a las 14:15 estaría en ${nivel(vuelta)?.toFixed(2)}m` +
        (salidaLimiteMin != null ? ` — hay que irse antes de las ${hhmm(salidaLimiteMin)}.` : " — no se podría volver.");
      explicacion = explicaNivel(vuelta, "A las 14:15 el INA pronostica") + pendienteNota;
      break;
    case "normal":
      motivoCorto = `Agua accesible a las 8 (${nivel(entrada)?.toFixed(2)}m) y a las 14:15 (${nivel(vuelta)?.toFixed(2)}m) — rompe el día normal.`;
      {
        // Si el límite cae dentro del rango habitual del INA se aclara, pero no se suspende por eso.
        const dentro = [entrada, vuelta].filter((h) => h.p75 != null && h.p75 > nivelSeguroM);
        const techo = dentro.length ? Math.max(...dentro.map((h) => h.p75 as number)) : null;
        explicacion =
          (inaDifiere
            ? ` Se toma el ${textoAviso(inaDifiere.hora === entrada.horaMin ? entrada : vuelta)}.` + textoOjo(inaDifiere)
            : esDia && techo != null
              ? ` El límite (${nivelSeguroM.toFixed(2)}m) queda dentro del rango habitual del INA (hasta ${techo.toFixed(2)}m): se decide por el pronóstico central, no por el rango.`
              : "") + (notaDescartado(entrada) || notaDescartado(vuelta)) + pendienteNota;
      }
      break;
    case "sin_datos":
    default:
      motivoCorto = `Sin pronóstico para ${fecha} — no se puede confirmar el plan.`;
      break;
  }
  const motivo = motivoCorto + explicacion;

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
    motivo_corto: motivoCorto,
    explicacion: explicacion.trim(),
    ina_difiere: inaDifiere,
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