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

// Fase actual: dirección y horas que lleva sosteniéndola (lecturas desc).
// `ahora` (ms) permite sumar el tiempo desde la última lectura hasta el presente.
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

// Duración de fases completas de subida y bajada en el historial (lecturas asc).
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

// Estima cuántas horas restan de la fase actual de SF, usando:
//  1. duración típica histórica de la misma fase (SF) - horas ya transcurridas
//  2. la señal adelantada de una estación externa (LP): si la externa ya cambió
//     de fase, el mismo quiebre llega a SF ~propagacionHS después.
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

  // Refinar con señal externa: si la externa ya cambió de fase, SF lo hará en ~propagacionHS.
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
