// Anticipación de SUBIDA de San Fernando a partir de las estaciones exteriores,
// con el lag de propagación aprendido por regresión (no hardcodeado).
// Espejo de src/lib/anticipacion.ts + la porción de regresarPropagacion de
// src/lib/modelo.ts (sync a mano — mismo patrón que plan_escolar.ts en esta
// carpeta). Solo se porta la parte de SUBIDA: el backend no usa anticiparBajada
// (usa su propio detectarGiro en logica.ts para el push de bajada, que esta
// migracion no toca).
//
// Validado empíricamente (29-sep-2026) con la crecida real del 07/08: el lag
// aprendido en la subida salió IDÉNTICO al de la bajada para cada estación
// (La Plata 3h, Oyarvide 5h, Atalaya 5h, Bs. Aires 1h — este último coincide
// exacto con el PROPAGACION_BA_A_SF hardcodeado que este módulo reemplaza),
// con r² fuerte en ambas direcciones (0.81–0.98). La subida sale con r² algo
// más bajo que la bajada en las 4 estaciones (marea+viento armándose vs.
// drenaje más pasivo) — asimetría física esperada, no motivo para desconfiar.

import type { Lectura } from "./logica.ts";

const H = 3600000;
const MIN_PUNTOS = 15;
const VENTANA_PUNTOS = 48;
const PICO_MAX_EDAD_HS = 6;
const PENDIENTE_MIN_M_H = 0.005;
const GIRO_MIN_ESTACIONES = 2;

export interface ExteriorGiro {
  nombre: string;
  giro: boolean;
  picoTs: number | null; // el VALLE detectado en esta migracion (nombre generico, ver comentario de anticiparSubida)
  picoNivel: number | null;
  pendiente_m_h: number | null;
  lagHs: number | null;
  r2: number | null;
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

function ordenarAsc(l: Lectura[]): Lectura[] {
  return [...l].sort((a, b) => ts(a) - ts(b));
}

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

// Detección del valle reciente de una estación y la pendiente de la subida posterior.
function girarAlza(lecturas: Lectura[], ahoraMs: number): { valleTs: number | null; valleNivel: number | null; pendiente_m_h: number | null } {
  if (lecturas.length < 4) return { valleTs: null, valleNivel: null, pendiente_m_h: null };
  const ultimas = ordenarAsc(lecturas).slice(-VENTANA_PUNTOS);
  const n = ultimas.length;

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
  if (ahoraMs - ts(valle) > PICO_MAX_EDAD_HS * H) {
    return { valleTs: null, valleNivel: null, pendiente_m_h: null };
  }

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

// Nivel observado interpolado linealmente en un instante dado (espejo de
// nivelObservadoEn en src/lib/modelo.ts).
interface PuntoT { timestamp: string; nivel_m: number; t0: number }
function nivelObservadoEn(pts: PuntoT[], t: number): number | null {
  const n = pts.length;
  if (n < 2) return null;
  if (t < pts[0].t0 || t > pts[n - 1].t0) return null;
  let i = 0;
  while (i < n - 1 && pts[i + 1].t0 < t) i++;
  const a = pts[i], b2 = pts[i + 1];
  const f = (t - a.t0) / Math.max(b2.t0 - a.t0, 1);
  return a.nivel_m + f * (b2.nivel_m - a.nivel_m);
}

export interface RegresionPropagacion {
  lag_h: number;
  pendiente: number;
  intercepto_m: number;
  r2: number;
  sigma_m: number;
  n: number;
}

// Regresión cruzada exterior → San Fernando: nivelSF(t) ≈ intercepto + pendiente * nivelExt(t - lag).
// Elige el lag que maximiza r². Espejo de regresarPropagacion en src/lib/modelo.ts
// (no distingue dirección: correlaciona niveles, sirve igual para subida o bajada).
function regresarPropagacion(
  lecturasSF: Lectura[],
  lecturasExt: Lectura[],
  ahora: number,
  lagsH: number[] = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5]
): RegresionPropagacion | null {
  const sf = [...lecturasSF].map((p) => ({ ...p, t0: new Date(p.timestamp).getTime() })).sort((a, b) => a.t0 - b.t0);
  const ext = [...lecturasExt].map((p) => ({ ...p, t0: new Date(p.timestamp).getTime() })).sort((a, b) => a.t0 - b.t0);
  if (sf.length < 20 || ext.length < 20) return null;

  let mejor: { lag_h: number; pendiente: number; intercepto: number; r2: number; sigma: number; n: number } | null = null;
  for (const lagH of lagsH) {
    const pares: { x: number; y: number }[] = [];
    for (const p of sf) {
      const extEn = nivelObservadoEn(ext, p.t0 - lagH * H);
      if (extEn == null) continue;
      pares.push({ x: extEn, y: p.nivel_m });
    }
    if (pares.length < 15) continue;
    const n = pares.length;
    const mx = pares.reduce((s, q) => s + q.x, 0) / n;
    const my = pares.reduce((s, q) => s + q.y, 0) / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const q of pares) {
      sxx += (q.x - mx) * (q.x - mx);
      sxy += (q.x - mx) * (q.y - my);
      syy += (q.y - my) * (q.y - my);
    }
    if (sxx < 1e-9) continue;
    const pendiente = sxy / sxx;
    const intercepto = my - pendiente * mx;
    const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
    const sigma = Math.sqrt(pares.reduce((s, q) => s + (q.y - intercepto - pendiente * q.x) ** 2, 0) / Math.max(n - 2, 1));
    if (mejor == null || r2 > mejor.r2) {
      mejor = { lag_h: lagH, pendiente, intercepto, r2, sigma, n };
    }
  }
  if (mejor == null) return null;

  return {
    lag_h: mejor.lag_h,
    pendiente: mejor.pendiente,
    intercepto_m: mejor.intercepto,
    r2: mejor.r2,
    sigma_m: mejor.sigma,
    n: mejor.n,
  };
}

/**
 * Anticipa la SUBIDA de San Fernando a partir del comportamiento de las estaciones
 * exteriores. Espejo de anticiparBajada (src/lib/anticipacion.ts), signos invertidos:
 *  - Cuando una exterior pasa su valle reciente y viene subiendo, SF hará lo mismo
 *    ~lag horas después (lag aprendido por regresión, no hardcodeado).
 *  - El cruce de `umbralEvalM` en SF se proyecta con el modelo SF = intercepto + pendiente * exterior.
 *  - `picoTs`/`picoNivel` dentro de cada ExteriorGiro representan el VALLE detectado
 *    (se reusa el nombre genérico, igual que detectarGiro en logica.ts usa el mismo
 *    campo para "el punto de giro" sin importar la dirección).
 */
export function anticiparSubida(
  exteriores: { nombre: string; lecturas: Lectura[] }[],
  lecturasSF: Lectura[],
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

  const estimaciones = conModelo
    .filter((e) => e.picoTs != null && e.lagHs != null)
    .map((e) => e.picoTs! + e.lagHs! * H);
  const sfGiro = mediana(estimaciones);
  if (sfGiro == null) {
    return { ...base, exteriores: externos, giraron: true, mensaje: "Exteriores giraron al alza, sin modelo de propagación para estimar el giro en SF." };
  }

  const mejor = conModelo.sort((a, b) => (b.r2 ?? 0) - (a.r2 ?? 0))[0];
  const est = exteriores.find((e) => e.nombre === mejor.nombre)?.lecturas;
  const regModelo = est ? regresarPropagacion(lecturasSF, est, ahora, lagHs) : null;

  const sfGiroNivel =
    regModelo && mejor.picoNivel != null
      ? regModelo.intercepto_m + regModelo.pendiente * mejor.picoNivel
      : null;

  let sfCruce: number | null = null;
  let pendSF: number | null = null;
  if (regModelo && mejor.pendiente_m_h != null && mejor.pendiente_m_h > 0 && sfGiroNivel != null && sfGiroNivel < umbralEvalM) {
    const nivelExtObj = (umbralEvalM - regModelo.intercepto_m) / regModelo.pendiente;
    const ultExt = est && est.length ? est[est.length - 1] : null;
    if (ultExt) {
      const horasParaSubir = (nivelExtObj - ultExt.nivel_m) / mejor.pendiente_m_h;
      const cruceExt = ts(ultExt) + horasParaSubir * H;
      sfCruce = cruceExt + (mejor.lagHs ?? 0) * H;
    }
    pendSF = mejor.pendiente_m_h * regModelo.pendiente;
  }

  // Hora argentina CON el día (el servidor no debe depender de su propia zona horaria).
  const cuandoAR = (ms: number): string =>
    new Date(ms).toLocaleString("es-AR", {
      weekday: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Argentina/Buenos_Aires",
    });
  // No se muestra la hora en que "superaría" el umbral: es una extrapolación lineal que no se validó y
  // llegó a contradecir al pronóstico del INA (8-oct-2026). sfCruceEvalTs se sigue calculando.
  const nombresSubida = giraron.map((e) => e.nombre).join(", ");
  const mensaje =
    sfGiroNivel != null && sfGiroNivel >= umbralEvalM
      ? `Exteriores ya suben (${nombresSubida}) — SF empezaría a subir en serio ≈ ${cuandoAR(sfGiro)} (${sfGiroNivel.toFixed(2)}m), ya sobre el umbral de evaluación.`
      : `Exteriores ya suben (${nombresSubida}) — SF empezaría a subir en serio ≈ ${cuandoAR(sfGiro)}${cuandoAR(sfGiro).endsWith(".") ? "" : "."}`;

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
