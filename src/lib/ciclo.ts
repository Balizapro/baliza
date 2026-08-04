export type DireccionCiclo = "subiendo" | "bajando" | "estable";

export interface Punto {
  timestamp: string;
  nivel_m: number;
}

export interface AnalisisCiclo {
  direccion: DireccionCiclo;
  horasActuales: number;
  duracionTipica: number | null;
  restante: number | null;
  metodo: "historico" | "externa" | "mixto";
}

function ordenarDesc(l: Punto[]): Punto[] {
  return [...l].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function ordenarAsc(l: Punto[]): Punto[] {
  return [...l].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

const UMBRAL_CM_H = 0.01;

function direccionEntre(a: number, b: number): DireccionCiclo {
  if (a - b > UMBRAL_CM_H) return "subiendo";
  if (a - b < -UMBRAL_CM_H) return "bajando";
  return "estable";
}

// Fase actual: direcciÃ³n y horas que lleva sosteniÃ©ndola (lecturas desc).
// `ahora` (ms) permite sumar el tiempo desde la Ãºltima lectura hasta el presente.
function faseActual(l: Punto[], ahora?: number): { direccion: DireccionCiclo; horas: number } {
  if (!l || l.length < 2) return { direccion: "estable", horas: 0 };
  const ord = ordenarDesc(l);
  const dt = (new Date(ord[0].timestamp).getTime() - new Date(ord[1].timestamp).getTime()) / 3600000;
  if (dt <= 0) return { direccion: "estable", horas: 0 };
  const dir = direccionEntre(ord[0].nivel_m, ord[1].nivel_m);
  let horas = 0;
  if (dir !== "estable") {
    for (let i = 0; i < ord.length - 1; i++) {
      const mismaDir = dir === "subiendo" ? ord[i].nivel_m - ord[i + 1].nivel_m > UMBRAL_CM_H : ord[i].nivel_m - ord[i + 1].nivel_m < -UMBRAL_CM_H;
      if (!mismaDir) break;
      horas += (new Date(ord[i].timestamp).getTime() - new Date(ord[i + 1].timestamp).getTime()) / 3600000;
    }
    if (ahora != null) {
      const desdeUltima = (ahora - new Date(ord[0].timestamp).getTime()) / 3600000;
      if (desdeUltima > 0) horas += desdeUltima;
    }
  }
  return { direccion: dir, horas };
}

// DuraciÃ³n de fases completas de subida y bajada en el historial (lecturas asc).
function duracionesTipicas(l: Punto[]): { subiendo: number[]; bajando: number[] } {
  const fases = { subiendo: [] as number[], bajando: [] as number[] };
  if (!l || l.length < 3) return fases;
  const asc = ordenarAsc(l);
  let cur: DireccionCiclo | null = null;
  let start = 0;
  for (let i = 1; i < asc.length; i++) {
    const dir = direccionEntre(asc[i].nivel_m, asc[i - 1].nivel_m);
    if (dir === "estable") continue;
    if (cur === null) {
      cur = dir;
      start = i - 1;
    } else if (cur !== dir) {
      const hs = (new Date(asc[i - 1].timestamp).getTime() - new Date(asc[start].timestamp).getTime()) / 3600000;
      if (hs > 0.5 && cur === "subiendo") fases.subiendo.push(hs);
      if (hs > 0.5 && cur === "bajando") fases.bajando.push(hs);
      cur = dir;
      start = i - 1;
    }
  }
  return fases;
}

function promedio(ns: number[]): number | null {
  if (ns.length === 0) return null;
  return ns.reduce((s, n) => s + n, 0) / ns.length;
}

// Estima cuÃ¡ntas horas restan de la fase actual de SF, usando:
//  1. duraciÃ³n tÃ­pica histÃ³rica de la misma fase (SF) - horas ya transcurridas
//  2. la seÃ±al adelantada de una estaciÃ³n externa (LP): si la externa ya cambiÃ³
//     de fase, el mismo quiebre llega a SF ~propagacionHS despuÃ©s.
export function analizarCiclo(
  lecturasSF: Punto[],
  lecturasExterna: Punto[],
  propagacionHS: number,
  ahora?: number
): AnalisisCiclo {
  const sf = faseActual(lecturasSF, ahora);
  const base: AnalisisCiclo = {
    direccion: sf.direccion,
    horasActuales: sf.horas,
    duracionTipica: null,
    restante: null,
    metodo: "historico",
  };
  if (sf.direccion === "estable") return base;

  const tipicas = duracionesTipicas(lecturasSF);
  const arr = sf.direccion === "subiendo" ? tipicas.subiendo : tipicas.bajando;
  const tipica = promedio(arr);
  base.duracionTipica = tipica;

  let restante: number | null = tipica != null ? Math.max(0, tipica - sf.horas) : null;

  // Refinar con seÃ±al externa: si la externa ya cambiÃ³ de fase, SF lo harÃ¡ en ~propagacionHS.
  const ext = faseActual(lecturasExterna, ahora);
  if (ext.direccion !== "estable" && ext.direccion !== sf.direccion) {
    const restanteProp = Math.max(0, propagacionHS - ext.horas);
    if (restante == null || restanteProp < restante) {
      restante = restanteProp;
      base.metodo = "externa";
    } else {
      base.metodo = "mixto";
    }
  }

  base.restante = restante;
  return base;
}

export type TipoExtremo = "pleamar" | "bajamar";

export interface Extremo {
  timestamp: number; // ms
  nivel_m: number | null;
  tipo: TipoExtremo;
}

export interface PrediccionExtremos {
  pleamar: Extremo | null;
  bajamar: Extremo | null;
  periodoHoras: number | null;
  metodo: "observado" | "astronomica";
}

// PerÃ­odo semidiurno astronÃ³mico (M2 lunar): pleamares cada ~12h25m.
const PERIODO_ASTRONOMICO_H = 12.42;
const INTERVALO_SEMIDIURNO_MIN = 11;
const INTERVALO_SEMIDIURNO_MAX = 14;

function mediana(ns: number[]): number | null {
  if (ns.length === 0) return null;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Período dominante por análisis espectral (Lomb-Scargle) en la banda semidiurna.
// La mediana de intervalos pleamar→pleamar se sesga con series largas por la
// desigualdad diurna y el forzante meteorológico del estuario; el pico espectral
// en 11.5–13.5h recupera el M2 (~12.42h) incluso con muestreo irregular (INA).
function estimarPeriodoSpectral(l: Punto[], loH = 11.5, hiH = 13.5): number | null {
  const n = l.length;
  if (n < 48) return null;
  const t = l.map((p) => new Date(p.timestamp).getTime() / 3600000);
  const y = l.map((p) => p.nivel_m);
  // Detrend lineal: una rampa residual (p.ej. tramo ascendente final) genera
  // leakage de baja frecuencia que corre el pico espectral.
  const mediaT = t.reduce((s, v) => s + v, 0) / n;
  const mediaY = y.reduce((s, v) => s + v, 0) / n;
  let ssT = 0, ssTY = 0;
  for (let i = 0; i < n; i++) {
    ssT += (t[i] - mediaT) * (t[i] - mediaT);
    ssTY += (t[i] - mediaT) * (y[i] - mediaY);
  }
  const pend = ssT > 0 ? ssTY / ssT : 0;
  const yc = y.map((v, i) => v - mediaY - pend * (t[i] - mediaT));
  const varY = yc.reduce((s, v) => s + v * v, 0);
  if (varY === 0) return null;
  let mejor = null;
  let mejorPow = -1;
  const paso = 0.01;
  for (let P = loH; P <= hiH; P += paso) {
    const w = (2 * Math.PI) / P;
    let sSin = 0, sCos = 0;
    for (let i = 0; i < n; i++) {
      sSin += Math.sin(2 * w * t[i]);
      sCos += Math.cos(2 * w * t[i]);
    }
    const tau = (0.5 * Math.atan2(sSin, sCos)) / w;
    let cs = 0, ss = 0, cc = 0, ss2 = 0;
    for (let i = 0; i < n; i++) {
      const x = t[i] - tau;
      const cw = Math.cos(w * x);
      const sw = Math.sin(w * x);
      cc += cw * cw;
      ss2 += sw * sw;
      cs += yc[i] * cw;
      ss += yc[i] * sw;
    }
    const pow = (0.5 * (cs * cs / cc + ss * ss / ss2)) / varY;
    if (pow > mejorPow) {
      mejorPow = pow;
      mejor = P;
    }
  }
  return mejor;
}

// Detecta pleamares/bajamares locales en la serie (asc), eliminando falsos extremos:
// los extremos del mismo tipo demasiado cercanos (<5h) se fusionan conservando el mÃ¡s acentuado.
function detectarExtremos(l: Punto[]): Extremo[] {
  const asc = ordenarAsc(l);
  if (asc.length < 3) return [];
  const raw: Extremo[] = [];
  for (let i = 1; i < asc.length - 1; i++) {
    const ant = asc[i - 1].nivel_m;
    const act = asc[i].nivel_m;
    const sig = asc[i + 1].nivel_m;
    const timestamp = new Date(asc[i].timestamp).getTime();
    if (act > ant && act >= sig) raw.push({ timestamp, nivel_m: act, tipo: "pleamar" });
    else if (act < ant && act <= sig) raw.push({ timestamp, nivel_m: act, tipo: "bajamar" });
  }
  const out: Extremo[] = [];
  for (const r of raw) {
    if (out.length && out[out.length - 1].tipo === r.tipo) {
      const gapHs = (r.timestamp - out[out.length - 1].timestamp) / 3600000;
      if (gapHs < 5) {
        if (
          (r.tipo === "pleamar" && r.nivel_m! > out[out.length - 1].nivel_m!) ||
          (r.tipo === "bajamar" && r.nivel_m! < out[out.length - 1].nivel_m!)
        ) {
          out[out.length - 1] = r;
        }
        continue;
      }
    }
    out.push(r);
  }
  return out;
}

// Predice el prÃ³ximo pleamar y la prÃ³xima bajamar a partir de la regularidad del
// ciclo observado en SF: la mediana de los intervalos pleamarâ†’pleamar y
// bajamarâ†’bajamar (~12.4h semidiurno) mÃ¡s la duraciÃ³n tÃ­pica de cada fase.
// Si no hay historia suficiente, cae al perÃ­odo astronÃ³mico (12.42h).
export function predecirProximosExtremos(
  lecturas: Punto[],
  ahora?: number
): PrediccionExtremos {
  const vacio: PrediccionExtremos = {
    pleamar: null,
    bajamar: null,
    periodoHoras: null,
    metodo: "astronomica",
  };
  const extremos = detectarExtremos(lecturas);
  if (extremos.length === 0) return vacio;

  const highs = extremos.filter((e) => e.tipo === "pleamar");
  const lows = extremos.filter((e) => e.tipo === "bajamar");

  const ints: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const g = (highs[i].timestamp - highs[i - 1].timestamp) / 3600000;
    if (g >= INTERVALO_SEMIDIURNO_MIN && g <= INTERVALO_SEMIDIURNO_MAX) ints.push(g);
  }
  for (let i = 1; i < lows.length; i++) {
    const g = (lows[i].timestamp - lows[i - 1].timestamp) / 3600000;
    if (g >= INTERVALO_SEMIDIURNO_MIN && g <= INTERVALO_SEMIDIURNO_MAX) ints.push(g);
  }

  const periodoEspectral = estimarPeriodoSpectral(lecturas);
  const periodoMediana = mediana(ints);
  const periodoObs = periodoEspectral ?? periodoMediana;
  const T = periodoObs != null ? periodoObs : PERIODO_ASTRONOMICO_H;
  const metodo: PrediccionExtremos["metodo"] = periodoObs != null ? "observado" : "astronomica";

  const tipicas = duracionesTipicas(lecturas);
  const durSubida = mediana(tipicas.subiendo.filter((h) => h >= 2 && h <= 9));
  const durBajada = mediana(tipicas.bajando.filter((h) => h >= 2 && h <= 9));

  const ahoraMs = ahora ?? Date.now();
  let ultimo = extremos[extremos.length - 1];
  const pasados = extremos.filter((e) => e.timestamp <= ahoraMs);
  if (pasados.length > 0) ultimo = pasados[pasados.length - 1];

  const estAltura = (arr: Extremo[]): number | null =>
    mediana(arr.slice(-3).map((e) => e.nivel_m).filter((v): v is number => v != null));

  const dSub = durSubida ?? T / 2;
  const dBaj = durBajada ?? T / 2;
  // Si el Ãºltimo extremo quedÃ³ viejo (sin lecturas recientes), avanzar el ancla por
  // perÃ­odos completos hasta que el prÃ³ximo extremo caiga en el futuro.
  let ultT = ultimo.timestamp;
  while (ultT + Math.min(dSub, dBaj) * 3600000 <= ahoraMs) {
    ultT += T * 3600000;
  }
  let tPle: number;
  let tBaj: number;
  if (ultimo.tipo === "pleamar") {
    tBaj = ultT + dBaj * 3600000;
    tPle = ultT + (dBaj + dSub) * 3600000;
  } else {
    tPle = ultT + dSub * 3600000;
    tBaj = ultT + (dSub + dBaj) * 3600000;
  }

  return {
    pleamar: { timestamp: tPle, nivel_m: estAltura(highs), tipo: "pleamar" },
    bajamar: { timestamp: tBaj, nivel_m: estAltura(lows), tipo: "bajamar" },
    periodoHoras: periodoObs,
    metodo,
  };
}
