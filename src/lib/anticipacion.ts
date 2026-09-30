import type { Punto } from "./ciclo.ts";
import { regresarPropagacion } from "./modelo.ts";

const H = 3600000;
const MIN_PUNTOS = 15;
const VENTANA_PUNTOS = 48;
const PICO_MAX_EDAD_HS = 6;
const PENDIENTE_MIN_M_H = 0.005;
const GIRO_MIN_ESTACIONES = 2;

export interface ExteriorGiro {
  nombre: string;
  giro: boolean;
  picoTs: number | null;
  picoNivel: number | null;
  pendiente_m_h: number | null;
  lagHs: number | null;
  r2: number | null;
}

export interface Anticipacion {
  giraron: boolean;
  metodo: "exterior" | "sf" | null;
  exteriores: ExteriorGiro[];
  sfPicoTs: number | null;
  sfPicoNivel: number | null;
  sfCruceSeguroTs: number | null;
  nivelSeguroM: number;
  pendienteSF_m_h: number | null;
  mensaje: string;
}

export interface AnticipacionSubida {
  giraron: boolean;
  metodo: "exterior" | "sf" | null;
  exteriores: ExteriorGiro[];
  sfGiroTs: number | null;
  sfGiroNivel: number | null;
  sfCruceEvalTs: number | null;
  umbralEvalM: number;
  pendienteSF_m_h: number | null;
  mensaje: string;
}

const ts = (p: { timestamp: string }): number => new Date(p.timestamp).getTime();

function ordenarAsc(l: Punto[]): Punto[] {
  return [...l].sort((a, b) => ts(a) - ts(b));
}

// Regresión lineal simple: pendiente (y por hora) e intercepto en unidades de ms→h.
function regLineal(puntos: { x: number; y: number }[]): { pend: number; inter: number } | null {
  const n = puntos.length;
  if (n < 2) return null;
  const mx = puntos.reduce((s, p) => s + p.x, 0) / n;
  const my = puntos.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, sxy = 0;
  for (const p of puntos) {
    sxx += (p.x - mx) * (p.x - mx);
    sxy += (p.x - mx) * (p.y - my);
  }
  if (sxx < 1e-9) return null;
  const pend = sxy / sxx;
  return { pend, inter: my - pend * mx };
}

// Detección del pico reciente de una estación y la pendiente de la bajada posterior.
function girar(lecturas: Punto[], ahoraMs: number): { picoTs: number | null; picoNivel: number | null; pendiente_m_h: number | null } {
  if (lecturas.length < 4) return { picoTs: null, picoNivel: null, pendiente_m_h: null };
  const ultimas = ordenarAsc(lecturas).slice(-VENTANA_PUNTOS);
  const n = ultimas.length;

  // Último pico local interior: un punto mayor que el anterior y que los 2 siguientes.
  let idxPico = -1;
  for (let i = n - 3; i >= 1; i--) {
    const act = ultimas[i].nivel_m;
    const ant = ultimas[i - 1].nivel_m;
    const sig = ultimas[i + 1].nivel_m;
    const sig2 = i + 2 < n ? ultimas[i + 2].nivel_m : sig;
    if (act >= ant && act > sig && act > sig2) {
      idxPico = i;
      break;
    }
  }
  if (idxPico < 0) return { picoTs: null, picoNivel: null, pendiente_m_h: null };

  const pico = ultimas[idxPico];
  // El giro debe ser reciente (≤ PICO_MAX_EDAD_HS).
  if (ahoraMs - ts(pico) > PICO_MAX_EDAD_HS * H) {
    return { picoTs: null, picoNivel: null, pendiente_m_h: null };
  }

  // Pendiente de la bajada con todos los puntos posteriores al pico.
  const despues = ultimas.slice(idxPico);
  const puntos = despues.map((p) => ({ x: ts(p) / H, y: p.nivel_m }));
  const reg = regLineal(puntos);
  if (!reg || reg.pend >= 0) return { picoTs: null, picoNivel: null, pendiente_m_h: null };

  return {
    picoTs: ts(pico),
    picoNivel: pico.nivel_m,
    pendiente_m_h: reg.pend,
  };
}

// Detección del valle reciente de una estación y la pendiente de la subida posterior.
// Espejo de girar(): mismo esqueleto, comparaciones y signo de pendiente invertidos.
function girarAlza(lecturas: Punto[], ahoraMs: number): { valleTs: number | null; valleNivel: number | null; pendiente_m_h: number | null } {
  if (lecturas.length < 4) return { valleTs: null, valleNivel: null, pendiente_m_h: null };
  const ultimas = ordenarAsc(lecturas).slice(-VENTANA_PUNTOS);
  const n = ultimas.length;

  // Último valle local interior: un punto menor que el anterior y que los 2 siguientes.
  let idxValle = -1;
  for (let i = n - 3; i >= 1; i--) {
    const act = ultimas[i].nivel_m;
    const ant = ultimas[i - 1].nivel_m;
    const sig = ultimas[i + 1].nivel_m;
    const sig2 = i + 2 < n ? ultimas[i + 2].nivel_m : sig;
    if (act <= ant && act < sig && act < sig2) {
      idxValle = i;
      break;
    }
  }
  if (idxValle < 0) return { valleTs: null, valleNivel: null, pendiente_m_h: null };

  const valle = ultimas[idxValle];
  // El giro debe ser reciente (≤ PICO_MAX_EDAD_HS).
  if (ahoraMs - ts(valle) > PICO_MAX_EDAD_HS * H) {
    return { valleTs: null, valleNivel: null, pendiente_m_h: null };
  }

  // Pendiente de la subida con todos los puntos posteriores al valle.
  const despues = ultimas.slice(idxValle);
  const puntos = despues.map((p) => ({ x: ts(p) / H, y: p.nivel_m }));
  const reg = regLineal(puntos);
  if (!reg || reg.pend <= 0) return { valleTs: null, valleNivel: null, pendiente_m_h: null };

  return {
    valleTs: ts(valle),
    valleNivel: valle.nivel_m,
    pendiente_m_h: reg.pend,
  };
}

function mediana(ns: number[]): number | null {
  if (ns.length === 0) return null;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Anticipa la bajada de San Fernando a partir del comportamiento de las estaciones
 * exteriores (La Plata, Oyarvide, Atalaya, Buenos Aires).
 *
 * Lógica (validada con la crecida del 07/08: pico SF 11:45, Atalaya/Oyarvide bajando
 * desde 08:45, La Plata desde 10:45, Buenos Aires desde 11:45):
 *  - Cuando una exterior pasa su pico reciente y viene bajando, SF hará lo mismo
 *    ~lag horas después (cada estación tiene su propio lag, aprendido por regresión).
 *  - El cruce de `nivelSeguroM` (acceso seco al muelle) en SF se calcula proyectando
 *    la bajada de la exterior sobre el modelo SF = intercepto + pendiente * exterior.
 */
export function anticiparBajada(
  exteriores: { nombre: string; lecturas: Punto[] }[],
  lecturasSF: Punto[],
  nivelSeguroM: number,
  ahoraMs?: number,
  lagHs?: number[]
): Anticipacion {
  const ahora = ahoraMs ?? Date.now();
  const base: Anticipacion = {
    giraron: false,
    metodo: null,
    exteriores: [],
    sfPicoTs: null,
    sfPicoNivel: null,
    sfCruceSeguroTs: null,
    nivelSeguroM,
    pendienteSF_m_h: null,
    mensaje: "Sin señal suficiente de las estaciones exteriores.",
  };

  if (lecturasSF.length < MIN_PUNTOS) return base;

  // Si SF ya está bajando con nivel bajo, no hay nada que anticipar.
  const sfOrd = ordenarAsc(lecturasSF);
  const sfUlt = sfOrd[sfOrd.length - 1];
  const sfPrev = sfOrd[sfOrd.length - 2];
  if (sfUlt.nivel_m <= nivelSeguroM && sfUlt.nivel_m < sfPrev.nivel_m) {
    return { ...base, metodo: "sf", mensaje: "El agua ya está por debajo del nivel seguro y bajando." };
  }

  if (exteriores.length === 0) return base;

  const externos: ExteriorGiro[] = [];
  for (const ext of exteriores) {
    const g = girar(ext.lecturas, ahora);
    const modelo = regresarPropagacion(lecturasSF, ext.lecturas, ahora, lagHs);
    externos.push({
      nombre: ext.nombre,
      giro: g.picoTs != null && g.pendiente_m_h != null && g.pendiente_m_h < -PENDIENTE_MIN_M_H,
      picoTs: g.picoTs,
      picoNivel: g.picoNivel,
      pendiente_m_h: g.pendiente_m_h,
      lagHs: modelo?.lag_h ?? null,
      r2: modelo?.r2 ?? null,
    });
  }

  const giraron = externos.filter((e) => e.giro);
  const conModelo = giraron.filter((e) => e.lagHs != null && e.r2 != null);

  if (giraron.length < GIRO_MIN_ESTACIONES && conModelo.length === 0) {
    return { ...base, exteriores: externos, mensaje: "Las exteriores aún no giraron a la baja." };
  }

  // Pico de SF: mediana de (giro_i + lag_i) entre exteriores que giraron con modelo.
  const estimaciones = conModelo
    .filter((e) => e.picoTs != null && e.lagHs != null)
    .map((e) => e.picoTs! + e.lagHs! * H);
  const sfPico = mediana(estimaciones);
  if (sfPico == null) {
    return { ...base, exteriores: externos, giraron: true, mensaje: "Exteriores giraron, sin modelo de propagación para estimar el pico en SF." };
  }

  // Cruce del nivel seguro: con la exterior de mejor r², proyectar su bajada futura
  // sobre el modelo de propagación hasta que SF = nivelSeguroM.
  const mejor = conModelo.sort((a, b) => (b.r2 ?? 0) - (a.r2 ?? 0))[0];
  const est = exteriores.find((e) => e.nombre === mejor.nombre)?.lecturas;
  const regModelo = est ? regresarPropagacion(lecturasSF, est, ahora, lagHs) : null;

  // Altura del pico de SF: con el nivel de la exterior en su pico y el modelo de propagación.
  const sfPicoNivel =
    regModelo && mejor.picoNivel != null
      ? regModelo.intercepto_m + regModelo.pendiente * mejor.picoNivel
      : null;

  let sfCruce: number | null = null;
  let pendSF: number | null = null;
  // Solo tiene sentido proyectar el cruce si SF llega a superar el nivel seguro;
  // si el pico predicho queda por debajo, el muelle nunca queda tapado.
  if (regModelo && mejor.pendiente_m_h != null && mejor.pendiente_m_h < 0 && sfPicoNivel != null && sfPicoNivel > nivelSeguroM) {
    // nivelSF(t+lag) = intercepto + pendiente * nivelExt(t). SF cruza el nivel seguro
    // cuando la exterior alcanza nivelExtObj = (nivelSeguro - intercepto)/pendiente.
    const nivelExtObj = (nivelSeguroM - regModelo.intercepto_m) / regModelo.pendiente;
    const ultExt = est && est.length ? est[est.length - 1] : null;
    if (ultExt) {
      const horasParaBajar = (nivelExtObj - ultExt.nivel_m) / mejor.pendiente_m_h;
      const cruceExt = ts(ultExt) + horasParaBajar * H;
      sfCruce = cruceExt + (mejor.lagHs ?? 0) * H;
    }
    pendSF = mejor.pendiente_m_h * regModelo.pendiente;
  }

  const mensaje = sfCruce != null
    ? `Exteriores ya bajan (${giraron.map((e) => e.nombre).join(", ")}) — SF tocará pico ≈ ${new Date(sfPico).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} y bajará a ${nivelSeguroM.toFixed(2)}m ≈ ${new Date(sfCruce).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}.`
    : sfPicoNivel != null && sfPicoNivel <= nivelSeguroM
      ? `Exteriores ya bajan (${giraron.map((e) => e.nombre).join(", ")}) — SF tocará pico ≈ ${new Date(sfPico).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} (${sfPicoNivel.toFixed(2)}m), sin superar el nivel seguro: el muelle queda accesible.`
      : `Exteriores ya bajan (${giraron.map((e) => e.nombre).join(", ")}) — SF tocará pico ≈ ${new Date(sfPico).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}.`;

  return {
    giraron: true,
    metodo: "exterior",
    exteriores: externos,
    sfPicoTs: sfPico,
    sfPicoNivel,
    sfCruceSeguroTs: sfCruce,
    nivelSeguroM,
    pendienteSF_m_h: pendSF,
    mensaje,
  };
}

/**
 * Anticipa la SUBIDA de San Fernando a partir del comportamiento de las estaciones
 * exteriores (La Plata, Oyarvide, Atalaya, Buenos Aires). Espejo de anticiparBajada:
 * mismo lag aprendido por regresión (regresarPropagacion no distingue dirección, solo
 * correlaciona niveles) — validado empíricamente (29-sep-2026) con la crecida del
 * 07/08: el lag aprendido en la subida salió IDÉNTICO al de la bajada para cada
 * estación (La Plata 3h, Oyarvide 5h, Atalaya 5h, Bs. Aires 1h — este último coincide
 * exacto con el PROPAGACION_BA_A_SF hardcodeado del backend), con r² fuerte en ambas
 * direcciones (0.81–0.98). La subida sale con r² algo más bajo que la bajada en las
 * 4 estaciones (marea+viento armándose vs. drenaje más pasivo) — asimetría física
 * esperada, no motivo para desconfiar del modelo.
 *
 * Lógica (espejo, signos invertidos):
 *  - Cuando una exterior pasa su valle reciente y viene subiendo, SF hará lo mismo
 *    ~lag horas después (mismo lag que la bajada, aprendido por regresión).
 *  - El cruce de `umbralEvalM` en SF se calcula proyectando la subida de la exterior
 *    sobre el modelo SF = intercepto + pendiente * exterior.
 *  - `picoTs`/`picoNivel` dentro de cada ExteriorGiro representan el VALLE detectado
 *    (se reusa el tipo ExteriorGiro, igual que detectarGiro en el backend usa el
 *    mismo campo genéricamente para "el punto de giro" sin importar la dirección).
 */
export function anticiparSubida(
  exteriores: { nombre: string; lecturas: Punto[] }[],
  lecturasSF: Punto[],
  umbralEvalM: number,
  ahoraMs?: number,
  lagHs?: number[]
): AnticipacionSubida {
  const ahora = ahoraMs ?? Date.now();
  const base: AnticipacionSubida = {
    giraron: false,
    metodo: null,
    exteriores: [],
    sfGiroTs: null,
    sfGiroNivel: null,
    sfCruceEvalTs: null,
    umbralEvalM,
    pendienteSF_m_h: null,
    mensaje: "Sin señal suficiente de las estaciones exteriores.",
  };

  if (lecturasSF.length < MIN_PUNTOS) return base;

  // Si SF ya está en zona de evaluación y subiendo, no hay nada que anticipar:
  // la lógica de alerta por tendencia sostenida ya toma el control ahí.
  const sfOrd = ordenarAsc(lecturasSF);
  const sfUlt = sfOrd[sfOrd.length - 1];
  const sfPrev = sfOrd[sfOrd.length - 2];
  if (sfUlt.nivel_m >= umbralEvalM && sfUlt.nivel_m > sfPrev.nivel_m) {
    return { ...base, metodo: "sf", mensaje: "El agua ya está en zona de evaluación y subiendo." };
  }

  if (exteriores.length === 0) return base;

  const externos: ExteriorGiro[] = [];
  for (const ext of exteriores) {
    const g = girarAlza(ext.lecturas, ahora);
    const modelo = regresarPropagacion(lecturasSF, ext.lecturas, ahora, lagHs);
    externos.push({
      nombre: ext.nombre,
      giro: g.valleTs != null && g.pendiente_m_h != null && g.pendiente_m_h > PENDIENTE_MIN_M_H,
      picoTs: g.valleTs,
      picoNivel: g.valleNivel,
      pendiente_m_h: g.pendiente_m_h,
      lagHs: modelo?.lag_h ?? null,
      r2: modelo?.r2 ?? null,
    });
  }

  const giraron = externos.filter((e) => e.giro);
  const conModelo = giraron.filter((e) => e.lagHs != null && e.r2 != null);

  if (giraron.length < GIRO_MIN_ESTACIONES && conModelo.length === 0) {
    return { ...base, exteriores: externos, mensaje: "Las exteriores aún no giraron al alza." };
  }

  // Giro de SF: mediana de (giro_i + lag_i) entre exteriores que giraron con modelo.
  const estimaciones = conModelo
    .filter((e) => e.picoTs != null && e.lagHs != null)
    .map((e) => e.picoTs! + e.lagHs! * H);
  const sfGiro = mediana(estimaciones);
  if (sfGiro == null) {
    return { ...base, exteriores: externos, giraron: true, mensaje: "Exteriores giraron al alza, sin modelo de propagación para estimar el giro en SF." };
  }

  // Cruce del umbral de evaluación: con la exterior de mejor r², proyectar su subida
  // futura sobre el modelo de propagación hasta que SF = umbralEvalM.
  const mejor = conModelo.sort((a, b) => (b.r2 ?? 0) - (a.r2 ?? 0))[0];
  const est = exteriores.find((e) => e.nombre === mejor.nombre)?.lecturas;
  const regModelo = est ? regresarPropagacion(lecturasSF, est, ahora, lagHs) : null;

  // Nivel de SF en el momento del giro: con el nivel de la exterior en su valle y el
  // modelo de propagación.
  const sfGiroNivel =
    regModelo && mejor.picoNivel != null
      ? regModelo.intercepto_m + regModelo.pendiente * mejor.picoNivel
      : null;

  let sfCruce: number | null = null;
  let pendSF: number | null = null;
  // Solo tiene sentido proyectar el cruce si SF todavía no superó el umbral de
  // evaluación en ese punto de referencia; si ya lo superó, no hay cruce futuro.
  if (regModelo && mejor.pendiente_m_h != null && mejor.pendiente_m_h > 0 && sfGiroNivel != null && sfGiroNivel < umbralEvalM) {
    // nivelSF(t+lag) = intercepto + pendiente * nivelExt(t). SF cruza el umbral de
    // evaluación cuando la exterior alcanza nivelExtObj = (umbralEval - intercepto)/pendiente.
    const nivelExtObj = (umbralEvalM - regModelo.intercepto_m) / regModelo.pendiente;
    const ultExt = est && est.length ? est[est.length - 1] : null;
    if (ultExt) {
      const horasParaSubir = (nivelExtObj - ultExt.nivel_m) / mejor.pendiente_m_h;
      const cruceExt = ts(ultExt) + horasParaSubir * H;
      sfCruce = cruceExt + (mejor.lagHs ?? 0) * H;
    }
    pendSF = mejor.pendiente_m_h * regModelo.pendiente;
  }

  const mensaje = sfCruce != null
    ? `Exteriores ya suben (${giraron.map((e) => e.nombre).join(", ")}) — SF empezaría a subir en serio ≈ ${new Date(sfGiro).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} y superaría ${umbralEvalM.toFixed(2)}m ≈ ${new Date(sfCruce).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}.`
    : sfGiroNivel != null && sfGiroNivel >= umbralEvalM
      ? `Exteriores ya suben (${giraron.map((e) => e.nombre).join(", ")}) — SF empezaría a subir en serio ≈ ${new Date(sfGiro).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} (${sfGiroNivel.toFixed(2)}m), ya sobre el umbral de evaluación.`
      : `Exteriores ya suben (${giraron.map((e) => e.nombre).join(", ")}) — SF empezaría a subir en serio ≈ ${new Date(sfGiro).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}.`;

  return {
    giraron: true,
    metodo: "exterior",
    exteriores: externos,
    sfGiroTs: sfGiro,
    sfGiroNivel,
    sfCruceEvalTs: sfCruce,
    umbralEvalM,
    pendienteSF_m_h: pendSF,
    mensaje,
  };
}
