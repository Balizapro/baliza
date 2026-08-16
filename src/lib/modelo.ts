import type { Punto } from "./ciclo";

export interface PuntoViento {
  timestamp: number;
  velocidad_kmh: number;
  direccion_grados: number;
  presion_hpa?: number | null;
}

export interface PuntoCurva {
  timestamp: number;
  nivel_m: number;
}

export interface ComponenteArmonica {
  periodo_h: number;
  amplitud_m: number;
  fase_rad: number;
}

export interface AjusteArmonico {
  c0: number;
  componentes: ComponenteArmonica[];
  sigma_m: number;
}

export interface RegresionViento {
  lag_h: number;
  pendiente_m_por_kmh: number;
  intercepto_m: number;
  r2: number;
  sigma_m: number;
  compSEActual: number;
  presion_m_por_hpa?: number;
  presionRefHpa?: number;
  compPresionActual?: number;
}

export interface Proyeccion {
  puntos: PuntoCurva[];
  bandaSuperior: PuntoCurva[];
  bandaInferior: PuntoCurva[];
  ajuste: AjusteArmonico | null;
  regresion: RegresionViento | null;
  extremos: { timestamp: number; nivel_m: number; tipo: "pleamar" | "bajamar" }[];
}

// Períodos de los principales constituyentes armónicos del Río de la Plata (horas)
const PERIODOS_H: Record<string, number> = {
  M2: 12.4206,
  S2: 12.0,
  K1: 23.9345,
  O1: 25.8193,
  N2: 12.6583,
  P1: 24.0659,
};

const H = 3600000;

// Proyección del viento sobre el eje SE-NO (sudestada). 0=desde el norte, 90=este,
// 135=SE (empuja agua hacia la costa), 180=sur. Positivo cuando sopla desde el SE/S.
function componenteSE(velocidadKmh: number, direccionGrados: number): number {
  const rad = ((direccionGrados - 135) * Math.PI) / 180;
  return velocidadKmh * Math.cos(rad);
}

// Resuelve A x = b (eliminación gaussiana con pivoteo parcial).
function resolverSistema(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    [M[col], M[piv]] = [M[piv], M[col]];
    const diag = M[col][col];
    if (Math.abs(diag) < 1e-12) throw new Error("matriz singular");
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / diag;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Ajusta h(t) = c0 + Σ_k (a_k cos ω_k t + b_k sin ω_k t) por mínimos cuadrados.
// t se expresa en horas desde la primera lectura para evitar overflow numérico.
export function ajustarArmonico(lecturas: Punto[]): AjusteArmonico | null {
  const n = lecturas.length;
  if (n < 12) return null;
  const ts = lecturas.map((p) => new Date(p.timestamp).getTime() / H);
  const t0 = ts[0];
  const t = ts.map((x) => x - t0);
  const y = lecturas.map((p) => p.nivel_m);

  const nombres = Object.keys(PERIODOS_H);
  const m = 1 + 2 * nombres.length; // c0 + (cos,sin) por constituyente
  const A: number[][] = [];
  const b: number[] = new Array(m).fill(0);

  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(m).fill(0);
    row[0] = 1;
    let col = 1;
    for (const nom of nombres) {
      const w = (2 * Math.PI) / PERIODOS_H[nom];
      row[col] = Math.cos(w * t[i]);
      row[col + 1] = Math.sin(w * t[i]);
      col += 2;
    }
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) {
        A[r] = A[r] ?? new Array(m).fill(0);
        A[r][c] = (A[r][c] ?? 0) + row[r] * row[c];
      }
      b[r] += row[r] * y[i];
    }
  }

  let coefs: number[];
  try {
    coefs = resolverSistema(A, b);
  } catch {
    return null;
  }

  const componentes: ComponenteArmonica[] = [];
  let col = 1;
  for (const nom of nombres) {
    const a = coefs[col];
    const bb = coefs[col + 1];
    componentes.push({
      periodo_h: PERIODOS_H[nom],
      amplitud_m: Math.hypot(a, bb),
      fase_rad: Math.atan2(bb, a),
    });
    col += 2;
  }

  const residuos = y.map((yi, i) => yi - evaluarArmonico(coefs, t[i], nombres.length));
  const sigma = Math.sqrt(residuos.reduce((s, r) => s + r * r, 0) / Math.max(n - m, 1));

  return { c0: coefs[0], componentes, sigma_m: sigma };
}

function evaluarArmonico(coefs: number[], th: number, nConst: number): number {
  let v = coefs[0];
  let col = 1;
  const nombres = Object.keys(PERIODOS_H);
  for (let k = 0; k < nConst; k++) {
    const w = (2 * Math.PI) / PERIODOS_H[nombres[k]];
    v += coefs[col] * Math.cos(w * th) + coefs[col + 1] * Math.sin(w * th);
    col += 2;
  }
  return v;
}

function valorArmonico(ajuste: AjusteArmonico, tsMs: number, t0Ms: number): number {
  const th = (tsMs - t0Ms) / H;
  let v = ajuste.c0;
  for (const c of ajuste.componentes) {
    const w = (2 * Math.PI) / c.periodo_h;
    // El ajuste es c0 + Σ(a·cos + b·sin) con a=A·cos(fase), b=A·sin(fase);
    // la reconstrucción correcta es A·cos(w·t − fase). Usar sin(w·t + fase)
    // intercambiaba cos/sin (fase corrida un cuarto de período, ~3h en M2).
    v += c.amplitud_m * Math.cos(w * th - c.fase_rad);
  }
  return v;
}

// Interpola linealmente la serie de viento en un instante dado.
function vientoEn(ventos: PuntoViento[], ts: number): { velocidad_kmh: number; direccion_grados: number; presion_hpa: number | null } | null {
  if (ventos.length === 0) return null;
  const mix = (a: number | null | undefined, b: number | null | undefined, f: number): number | null => {
    if (a == null || b == null) return a ?? b ?? null;
    return a + f * (b - a);
  };
  if (ts <= ventos[0].timestamp) {
    return { ...ventos[0], presion_hpa: ventos[0].presion_hpa ?? null };
  }
  if (ts >= ventos[ventos.length - 1].timestamp) {
    const ult = ventos[ventos.length - 1];
    return { ...ult, presion_hpa: ult.presion_hpa ?? null };
  }
  for (let i = 1; i < ventos.length; i++) {
    if (ts <= ventos[i].timestamp) {
      const a = ventos[i - 1];
      const b2 = ventos[i];
      const f = (ts - a.timestamp) / Math.max(b2.timestamp - a.timestamp, 1);
      return {
        velocidad_kmh: a.velocidad_kmh + f * (b2.velocidad_kmh - a.velocidad_kmh),
        direccion_grados: a.direccion_grados + f * (b2.direccion_grados - a.direccion_grados),
        presion_hpa: mix(a.presion_hpa, b2.presion_hpa, f),
      };
    }
  }
  return null;
}

// Presión de referencia (media del histórico); la anomalía de presión es el regresor.
function presionRefHpa(ventos: PuntoViento[]): number {
  const ps = ventos.map((v) => v.presion_hpa).filter((p): p is number => p != null);
  if (ps.length === 0) return 1013.25;
  return ps.reduce((s, p) => s + p, 0) / ps.length;
}

// Regresión del residuo (observado - armónico) contra el viento SE con lag óptimo
// y la anomalía de presión atmosférica (forzante meteorológico).
export function regresarViento(
  lecturas: Punto[],
  ajuste: AjusteArmonico,
  ventos: PuntoViento[],
  lagsH: number[] = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12]
): RegresionViento | null {
  if (ventos.length < 4 || ajuste == null) return null;
  const t0 = new Date(lecturas[0].timestamp).getTime();
  const pref = presionRefHpa(ventos);

  const pares = (lagH: number): { x: number; p: number; y: number }[] => {
    const out: { x: number; p: number; y: number }[] = [];
    for (const p of lecturas) {
      const ts = new Date(p.timestamp).getTime();
      const v = vientoEn(ventos, ts - lagH * H);
      if (!v || v.presion_hpa == null) continue;
      out.push({
        x: componenteSE(v.velocidad_kmh, v.direccion_grados),
        p: v.presion_hpa - pref,
        y: p.nivel_m - valorArmonico(ajuste, ts, t0),
      });
    }
    return out;
  };

  // Regresión lineal múltiple y = b0 + b1*x + b2*p (normal equations 3x3).
  const regresar = (pts: { x: number; p: number; y: number }[]): { b1: number; b2: number; b0: number; r2: number; sigma: number } | null => {
    const n = pts.length;
    if (n < 8) return null;
    const sx = pts.reduce((s, q) => s + q.x, 0);
    const sp = pts.reduce((s, q) => s + q.p, 0);
    const sy = pts.reduce((s, q) => s + q.y, 0);
    const sxx = pts.reduce((s, q) => s + q.x * q.x, 0);
    const spp = pts.reduce((s, q) => s + q.p * q.p, 0);
    const sxp = pts.reduce((s, q) => s + q.x * q.p, 0);
    const sxy = pts.reduce((s, q) => s + q.x * q.y, 0);
    const spy = pts.reduce((s, q) => s + q.p * q.y, 0);

    const A: number[][] = [
      [n, sx, sp],
      [sx, sxx, sxp],
      [sp, sxp, spp],
    ];
    const b = [sy, sxy, spy];
    let coefs: number[];
    try {
      coefs = resolverSistema(A, b);
    } catch {
      return null;
    }
    const [b0, b1, b2] = coefs;
    const my = sy / n;
    let sse = 0, sst = 0;
    for (const q of pts) {
      const pred = b0 + b1 * q.x + b2 * q.p;
      sse += (q.y - pred) ** 2;
      sst += (q.y - my) ** 2;
    }
    const r2 = sst > 0 ? 1 - sse / sst : 0;
    const sigma = Math.sqrt(sse / Math.max(n - 3, 1));
    return { b1, b2, b0, r2, sigma };
  };

  let mejor: { lag_h: number; pendiente: number; presion: number; intercepto: number; r2: number; sigma: number; n: number } | null = null;
  for (const lagH of lagsH) {
    const pts = pares(lagH);
    if (pts.length < 8) continue;
    const reg = regresar(pts);
    if (reg == null) continue;
    if (mejor == null || reg.r2 > mejor.r2) {
      mejor = { lag_h: lagH, pendiente: reg.b1, presion: reg.b2, intercepto: reg.b0, r2: reg.r2, sigma: reg.sigma, n: pts.length };
    }
  }
  if (mejor == null) return null;

  const ultimo = ventos[ventos.length - 1];
  return {
    lag_h: mejor.lag_h,
    pendiente_m_por_kmh: mejor.pendiente,
    intercepto_m: mejor.intercepto,
    r2: mejor.r2,
    sigma_m: mejor.sigma,
    compSEActual: componenteSE(ultimo.velocidad_kmh, ultimo.direccion_grados),
    presion_m_por_hpa: mejor.presion,
    presionRefHpa: pref,
    compPresionActual: (ultimo.presion_hpa ?? pref) - pref,
  };
}

// Proyecta la curva de nivel a futuro combinando la marea armónica y el efecto del
// viento (sudestada). Genera puntos cada `pasoMin` hasta `horizonteHs` desde `ahora`.
export function proyectarCurva(
  lecturas: Punto[],
  ventos: PuntoViento[],
  ahora: number,
  horizonteHs = 48,
  pasoMin = 30
): Proyeccion {
  const ajuste = ajustarArmonico(lecturas);
  if (!ajuste) {
    return { puntos: [], bandaSuperior: [], bandaInferior: [], ajuste: null, regresion: null, extremos: [] };
  }
  const regresion = regresarViento(lecturas, ajuste, ventos);

  const t0 = new Date(lecturas[0]?.timestamp ?? ahora).getTime();
  const pasoMs = pasoMin * 60000;
  const puntos: PuntoCurva[] = [];
  const bandaSuperior: PuntoCurva[] = [];
  const bandaInferior: PuntoCurva[] = [];

  const sigmaBase = regresion?.sigma_m ?? ajuste?.sigma_m ?? 0.15;

  for (let ts = ahora; ts <= ahora + horizonteHs * H; ts += pasoMs) {
    const arm = ajuste ? valorArmonico(ajuste, ts, t0) : null;
    const v = ventos.length ? vientoEn(ventos, ts) : null;
    const compSE = v ? componenteSE(v.velocidad_kmh, v.direccion_grados) : null;
    const anomPresion = v?.presion_hpa != null && regresion?.presionRefHpa != null
      ? v.presion_hpa - regresion.presionRefHpa
      : 0;
    const correccionViento = regresion
      ? regresion.intercepto_m +
        (compSE != null ? regresion.pendiente_m_por_kmh * compSE : 0) +
        (regresion.presion_m_por_hpa ?? 0) * anomPresion
      : 0;

    const nivel = arm != null ? arm + correccionViento : (compSE != null ? correccionViento : null);
    if (nivel == null) continue;

    // La banda crece con el horizonte (incertidumbre del pronóstico de viento).
    const factor = 1 + (ts - ahora) / (horizonteHs * H) * 0.5;
    const spread = sigmaBase * factor;
    const k = 1.28; // p90 / p10
    puntos.push({ timestamp: ts, nivel_m: nivel });
    bandaSuperior.push({ timestamp: ts, nivel_m: nivel + k * spread });
    bandaInferior.push({ timestamp: ts, nivel_m: nivel - k * spread });
  }

  // Extremos de la curva proyectada (máximos/mínimos locales)
  const extremos: Proyeccion["extremos"] = [];
  for (let i = 1; i < puntos.length - 1; i++) {
    const a = puntos[i - 1].nivel_m;
    const b = puntos[i].nivel_m;
    const c = puntos[i + 1].nivel_m;
    if (b > a && b >= c) extremos.push({ timestamp: puntos[i].timestamp, nivel_m: b, tipo: "pleamar" });
    else if (b < a && b <= c) extremos.push({ timestamp: puntos[i].timestamp, nivel_m: b, tipo: "bajamar" });
  }

  return { puntos, bandaSuperior, bandaInferior, ajuste, regresion, extremos };
}

export interface ValidacionHorizonte {
  horizonte_h: number;
  n: number;
  mae_m: number;
  sesgo_m: number;
  acierto_pct: number;
  max_err_m: number;
}

export interface ValidacionModelo {
  horizontes: ValidacionHorizonte[];
  cortes: number;
  desde: number;
  hasta: number;
}

// Nivel observado interpolado linealmente en un instante dado.
interface PuntoT { timestamp: string; nivel_m: number; t0: number }
function nivelObservadoEn(pts: PuntoT[], ts: number): number | null {
  const n = pts.length;
  if (n < 2) return null;
  if (ts < pts[0].t0 || ts > pts[n - 1].t0) return null;
  let i = 0;
  while (i < n - 1 && pts[i + 1].t0 < ts) i++;
  const a = pts[i], b2 = pts[i + 1];
  const f = (ts - a.t0) / Math.max(b2.t0 - a.t0, 1);
  return a.nivel_m + f * (b2.nivel_m - a.nivel_m);
}

// Backtest del modelo: en cada corte pasado proyecta con la historia disponible
// hasta ese corte y compara contra lo observado a horizontes de 6/12/24h.
export function validarModelo(
  lecturas: Punto[],
  ventos: PuntoViento[],
  ahora: number,
  horizontesHs: number[] = [6, 12, 24],
  minimoHistoriaHs = 120
): ValidacionModelo | null {
  const ordenadas = [...lecturas]
    .map((p) => ({ ...p, t0: new Date(p.timestamp).getTime() }))
    .sort((a, b) => a.t0 - b.t0);
  if (ordenadas.length < 30) return null;

  const maxH = Math.max(...horizontesHs);
  const fin = ahora - maxH * H;
  const ventosT = ventos.map((v) => ({ ...v, t0: v.timestamp })).sort((a, b) => a.t0 - b.t0);

  const erroresPorHorizonte = new Map<number, number[]>();
  const cortesUnicos: number[] = [];
  const primerCorte = ordenadas[0].t0 + minimoHistoriaHs * H;
  for (let t = primerCorte; t <= fin; t += 6 * H) cortesUnicos.push(t);

  let cortesUsados = 0;
  let desde = Infinity, hasta = -Infinity;
  for (const corte of cortesUnicos) {
    const pre = ordenadas.filter((p) => p.t0 <= corte);
    const ajuste = ajustarArmonico(pre);
    if (!ajuste) continue;
    const ventosPre = ventosT.filter((v) => v.t0 <= corte);
    const regresion = regresarViento(pre, ajuste, ventosPre);
    const t0 = pre[0].t0;

    for (const h of horizontesHs) {
      const target = corte + h * H;
      const obs = nivelObservadoEn(ordenadas, target);
      if (obs == null) continue;
      const arm = valorArmonico(ajuste, target, t0);
      const v = ventosT.length ? vientoEn(ventosT, target) : null;
      const compSE = v ? componenteSE(v.velocidad_kmh, v.direccion_grados) : null;
      const anomPresion = v?.presion_hpa != null && regresion?.presionRefHpa != null
        ? v.presion_hpa - regresion.presionRefHpa
        : 0;
      const corr = regresion
        ? regresion.intercepto_m +
          (compSE != null ? regresion.pendiente_m_por_kmh * compSE : 0) +
          (regresion.presion_m_por_hpa ?? 0) * anomPresion
        : 0;
      const pred = arm + corr;
      const arr = erroresPorHorizonte.get(h) ?? [];
      arr.push(pred - obs);
      erroresPorHorizonte.set(h, arr);
    }
    cortesUsados++;
    desde = Math.min(desde, corte);
    hasta = Math.max(hasta, corte);
  }

  if (cortesUsados === 0) return null;
  const horizontes: ValidacionHorizonte[] = horizontesHs.map((h) => {
    const errs = erroresPorHorizonte.get(h) ?? [];
    if (errs.length === 0) return { horizonte_h: h, n: 0, mae_m: 0, sesgo_m: 0, acierto_pct: 0, max_err_m: 0 };
    const mae = errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length;
    const sesgo = errs.reduce((s, e) => s + e, 0) / errs.length;
    const acierto = (errs.filter((e) => Math.abs(e) <= 0.15).length / errs.length) * 100;
    const maxErr = Math.max(...errs.map((e) => Math.abs(e)));
    return { horizonte_h: h, n: errs.length, mae_m: mae, sesgo_m: sesgo, acierto_pct: acierto, max_err_m: maxErr };
  });

  return { horizontes, cortes: cortesUsados, desde, hasta };
}

export interface RegresionPropagacion {
  lag_h: number;
  pendiente: number;
  intercepto_m: number;
  r2: number;
  sigma_m: number;
  n: number;
  nivelLPActual: number;
  nivelSFEsperado: number;
  llegadaEstimada: number; // ms
}

// Regresión cruzada La Plata → San Fernando: nivelSF(t) ≈ intercepto + pendiente * nivelLP(t - lag).
// Elige el lag que maximiza r² para usar La Plata como señal adelantada (preaviso aguas arriba).
export function regresarPropagacion(
  lecturasSF: Punto[],
  lecturasLP: Punto[],
  ahora: number,
  lagsH: number[] = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5]
): RegresionPropagacion | null {
  const sf = [...lecturasSF]
    .map((p) => ({ ...p, t0: new Date(p.timestamp).getTime() }))
    .sort((a, b) => a.t0 - b.t0);
  const lp = [...lecturasLP]
    .map((p) => ({ ...p, t0: new Date(p.timestamp).getTime() }))
    .sort((a, b) => a.t0 - b.t0);
  if (sf.length < 20 || lp.length < 20) return null;

  // Para cada lectura de SF, el nivel de LP con lag = tiempo hacia atrás en LP.
  // nivelSF(t) vs nivelLP(t - lag): LP adelanta a SF, así que el mismo evento
  // aparece antes en LP (t - lag) que en SF (t).
  let mejor: { lag_h: number; pendiente: number; intercepto: number; r2: number; sigma: number; n: number } | null = null;
  for (const lagH of lagsH) {
    const pares: { x: number; y: number }[] = [];
    for (const p of sf) {
      const lpEn = nivelObservadoEn(lp, p.t0 - lagH * H);
      if (lpEn == null) continue;
      pares.push({ x: lpEn, y: p.nivel_m });
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
    const sigma = Math.sqrt(
      pares.reduce((s, q) => s + (q.y - intercepto - pendiente * q.x) ** 2, 0) / Math.max(n - 2, 1)
    );
    if (mejor == null || r2 > mejor.r2) {
      mejor = { lag_h: lagH, pendiente, intercepto, r2, sigma, n };
    }
  }
  if (mejor == null) return null;

  // Nivel de LP "ahora" (la señal más reciente), proyectado a SF dentro de lag horas.
  const nivelLPActual = lp[lp.length - 1].nivel_m;
  const nivelSFEsperado = mejor.intercepto + mejor.pendiente * nivelLPActual;
  const llegadaEstimada = lp[lp.length - 1].t0 + mejor.lag_h * H;

  return {
    lag_h: mejor.lag_h,
    pendiente: mejor.pendiente,
    intercepto_m: mejor.intercepto,
    r2: mejor.r2,
    sigma_m: mejor.sigma,
    n: mejor.n,
    nivelLPActual,
    nivelSFEsperado,
    llegadaEstimada,
  };
}
