// Port de src/lib/modelo.ts para el entorno Deno (Supabase Edge Functions).
// Modelo armónico M2/S2/K1 + regresión sudestada + proyección de curva.
// Mantener en sincronía con la versión del cliente.

export interface Punto {
  timestamp: string;
  nivel_m: number;
}

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

const PERIODOS_H: Record<string, number> = {
  M2: 12.4206,
  S2: 12.0,
  K1: 23.9345,
  O1: 25.8193,
  N2: 12.6583,
  P1: 24.0659,
};

const H = 3600000;

export function componenteSE(velocidadKmh: number, direccionGrados: number): number {
  const rad = ((direccionGrados - 135) * Math.PI) / 180;
  return velocidadKmh * Math.cos(rad);
}

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

export function ajustarArmonico(lecturas: Punto[]): AjusteArmonico | null {
  const n = lecturas.length;
  if (n < 12) return null;
  const ts = lecturas.map((p) => new Date(p.timestamp).getTime() / H);
  const t0 = ts[0];
  const t = ts.map((x) => x - t0);
  const y = lecturas.map((p) => p.nivel_m);

  const nombres = Object.keys(PERIODOS_H);
  const m = 1 + 2 * nombres.length;
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
      A[r] = A[r] ?? new Array(m).fill(0);
      for (let c = 0; c < m; c++) {
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
    // Ajuste c0 + Σ(a·cos + b·sin) con a=A·cos(fase), b=A·sin(fase) => A·cos(w·t − fase).
    v += c.amplitud_m * Math.cos(w * th - c.fase_rad);
  }
  return v;
}

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

function presionRefHpa(ventos: PuntoViento[]): number {
  const ps = ventos.map((v) => v.presion_hpa).filter((p): p is number => p != null);
  if (ps.length === 0) return 1013.25;
  return ps.reduce((s, p) => s + p, 0) / ps.length;
}

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

  // Persistencia del residuo meteorológico: el error del modelo en la última
  // observación decae con escala ~24h (autocorrelación 6h≈0.75, 12h≈0.48);
  // un evento de sudestada no vuelve a cero de inmediato.
  const ultObs = lecturas[lecturas.length - 1];
  const tUlt = new Date(ultObs.timestamp).getTime();
  const vUlt = regresion ? vientoEn(ventos, tUlt - regresion.lag_h * H) : null;
  const compSEUlt = vUlt ? componenteSE(vUlt.velocidad_kmh, vUlt.direccion_grados) : null;
  const anomPresUlt = vUlt?.presion_hpa != null && regresion?.presionRefHpa != null
    ? vUlt.presion_hpa - regresion.presionRefHpa
    : 0;
  const corrUlt = regresion
    ? regresion.intercepto_m +
      (compSEUlt != null ? regresion.pendiente_m_por_kmh * compSEUlt : 0) +
      (regresion.presion_m_por_hpa ?? 0) * anomPresUlt
    : 0;
  const errUlt = ultObs.nivel_m - (ajuste ? valorArmonico(ajuste, tUlt, t0) : 0) - corrUlt;
  const tauPersistenciaH = 24;

  for (let ts = ahora; ts <= ahora + horizonteHs * H; ts += pasoMs) {
    const arm = ajuste ? valorArmonico(ajuste, ts, t0) : null;
    const v = ventos.length ? vientoEn(ventos, ts - (regresion?.lag_h ?? 0) * H) : null;
    const compSE = v ? componenteSE(v.velocidad_kmh, v.direccion_grados) : null;
    const anomPresion = v?.presion_hpa != null && regresion?.presionRefHpa != null
      ? v.presion_hpa - regresion.presionRefHpa
      : 0;
    const correccionViento = regresion
      ? regresion.intercepto_m +
        (compSE != null ? regresion.pendiente_m_por_kmh * compSE : 0) +
        (regresion.presion_m_por_hpa ?? 0) * anomPresion
      : 0;
    const persistencia = ts >= tUlt ? errUlt * Math.exp(-(ts - tUlt) / (tauPersistenciaH * H)) : 0;

    const nivel = arm != null ? arm + correccionViento + persistencia : (compSE != null ? correccionViento : null);
    if (nivel == null) continue;

    const factor = 1 + (ts - ahora) / (horizonteHs * H) * 0.5;
    const spread = sigmaBase * factor;
    const k = 1.28;
    puntos.push({ timestamp: ts, nivel_m: nivel });
    bandaSuperior.push({ timestamp: ts, nivel_m: nivel + k * spread });
    bandaInferior.push({ timestamp: ts, nivel_m: nivel - k * spread });
  }

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
