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
    v += c.amplitud_m * Math.sin(w * th + c.fase_rad);
  }
  return v;
}

function vientoEn(ventos: PuntoViento[], ts: number): { velocidad_kmh: number; direccion_grados: number } | null {
  if (ventos.length === 0) return null;
  if (ts <= ventos[0].timestamp) return ventos[0];
  if (ts >= ventos[ventos.length - 1].timestamp) return ventos[ventos.length - 1];
  for (let i = 1; i < ventos.length; i++) {
    if (ts <= ventos[i].timestamp) {
      const a = ventos[i - 1];
      const b2 = ventos[i];
      const f = (ts - a.timestamp) / Math.max(b2.timestamp - a.timestamp, 1);
      return {
        velocidad_kmh: a.velocidad_kmh + f * (b2.velocidad_kmh - a.velocidad_kmh),
        direccion_grados: a.direccion_grados + f * (b2.direccion_grados - a.direccion_grados),
      };
    }
  }
  return null;
}

export function regresarViento(
  lecturas: Punto[],
  ajuste: AjusteArmonico,
  ventos: PuntoViento[],
  lagsH: number[] = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12]
): RegresionViento | null {
  if (ventos.length < 4 || ajuste == null) return null;
  const t0 = new Date(lecturas[0].timestamp).getTime();

  const pares = (lagH: number): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = [];
    for (const p of lecturas) {
      const ts = new Date(p.timestamp).getTime();
      const v = vientoEn(ventos, ts - lagH * H);
      if (!v) continue;
      out.push({ x: componenteSE(v.velocidad_kmh, v.direccion_grados), y: p.nivel_m - valorArmonico(ajuste, ts, t0) });
    }
    return out;
  };

  let mejor: { lag_h: number; pendiente: number; intercepto: number; r2: number; sigma: number; n: number } | null = null;
  for (const lagH of lagsH) {
    const pts = pares(lagH);
    if (pts.length < 6) continue;
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n;
    const my = pts.reduce((s, p) => s + p.y, 0) / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of pts) {
      sxx += (p.x - mx) * (p.x - mx);
      sxy += (p.x - mx) * (p.y - my);
      syy += (p.y - my) * (p.y - my);
    }
    if (sxx < 1e-9) continue;
    const pendiente = sxy / sxx;
    const intercepto = my - pendiente * mx;
    const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
    const sigma = Math.sqrt(
      pts.reduce((s, p) => s + (p.y - intercepto - pendiente * p.x) ** 2, 0) / Math.max(n - 2, 1)
    );
    if (mejor == null || r2 > mejor.r2) {
      mejor = { lag_h: lagH, pendiente, intercepto, r2, sigma, n };
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

  for (let ts = ahora; ts <= ahora + horizonteHs * H; ts += pasoMs) {
    const arm = ajuste ? valorArmonico(ajuste, ts, t0) : null;
    const v = ventos.length ? vientoEn(ventos, ts) : null;
    const compSE = v ? componenteSE(v.velocidad_kmh, v.direccion_grados) : null;
    const correccionViento = regresion && compSE != null
      ? regresion.intercepto_m + regresion.pendiente_m_por_kmh * compSE
      : 0;

    const nivel = arm != null ? arm + correccionViento : (compSE != null ? correccionViento : null);
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
