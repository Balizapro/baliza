import { test } from "node:test";
import assert from "node:assert/strict";
import { analizarCiclo, type Punto } from "./ciclo.ts";

const H = 3600000;
const T0 = new Date("2026-08-02T00:00:00Z").getTime();

// Serie subiendo 3 horas: +0.1m por hora.
function serieSubida(n: number, pasoHs = 1, base = 0.5, nivel0 = 0.5): Punto[] {
  const pts: Punto[] = [];
  for (let i = 0; i < n; i++) {
    pts.push({ timestamp: new Date(T0 + i * pasoHs * H).toISOString(), nivel_m: nivel0 + i * base });
  }
  return pts;
}

test("subiendo hace 3h con historico corto => direccion subiendo, restante null sin tipica", () => {
  const sf = serieSubida(4); // sube 3h entre 4 puntos
  const c = analizarCiclo(sf, [], 2.5);
  assert.equal(c.direccion, "subiendo");
  assert.equal(c.horasActuales, 3);
  assert.equal(c.duracionTipica, null);
  assert.equal(c.restante, null);
});

// Serie continua: 2 ciclos de subida 5h/bajada 4h + subida final de 2h (en curso).
function serieConHistoria(): Punto[] {
  const pts: Punto[] = [];
  let t = T0;
  let nivel = 0.5;
  const fases: { dir: "sube" | "baja"; hs: number }[] = [
    { dir: "sube", hs: 5 }, { dir: "baja", hs: 4 },
    { dir: "sube", hs: 5 }, { dir: "baja", hs: 4 },
    { dir: "sube", hs: 2 },
  ];
  for (const f of fases) {
    const delta = f.dir === "sube" ? 0.1 : -0.1;
    for (let i = 0; i < f.hs; i++) {
      pts.push({ timestamp: new Date(t).toISOString(), nivel_m: nivel });
      nivel += delta;
      t += H;
    }
  }
  pts.push({ timestamp: new Date(t).toISOString(), nivel_m: nivel });
  return pts;
}

test("ciclo completo: la fase completa (subida 5h) se cuenta como tipica", () => {
  // serie: sube 5h y luego baja 2h (bajada aún en curso)
  const pts: Punto[] = [];
  let t = T0;
  let nivel = 0.5;
  for (let i = 0; i < 5; i++) { pts.push({ timestamp: new Date(t).toISOString(), nivel_m: nivel }); nivel += 0.1; t += H; }
  for (let i = 0; i < 2; i++) { pts.push({ timestamp: new Date(t).toISOString(), nivel_m: nivel }); nivel -= 0.1; t += H; }
  const c = analizarCiclo(pts, [], 2.5);
  assert.equal(c.direccion, "bajando");
  // la bajada actual no cuenta; la subida completa (5h) queda en el historial
  assert.equal(c.duracionTipica, null); // bajada no tiene fase completa aún
});

test("restante = tipica - horas actuales", () => {
  const sf = serieConHistoria(); // sube hace 2h, tipica de subida 5h
  const c = analizarCiclo(sf, [], 2.5);
  assert.equal(c.direccion, "subiendo");
  assert.equal(c.duracionTipica, 5);
  assert.equal(c.restante, 3);
});

test("señal externa adelantada acota el restante: LP ya bajando hace 1h", () => {
  // SF sube hace 2h; LP subió y ya bajando hace 1h (cambio de fase hace 1h)
  const sf = serieSubida(3); // sube 2h entre 3 puntos
  // Construir LP: sube 2h y luego baja 1h
  const lpPts: Punto[] = [];
  let nivel = 0.5;
  for (let i = 0; i < 2; i++) { lpPts.push({ timestamp: new Date(T0 + i * H).toISOString(), nivel_m: nivel }); nivel += 0.1; }
  for (let i = 0; i < 2; i++) { lpPts.push({ timestamp: new Date(T0 + (2 + i) * H).toISOString(), nivel_m: nivel }); nivel -= 0.1; }
  const c = analizarCiclo(sf, lpPts, 2.5);
  assert.equal(c.direccion, "subiendo");
  assert.equal(c.restante, 1.5); // 2.5hs de propagación - 1h que LP ya viene bajando
});

test("estable => sin análisis", () => {
  const sf = serieSubida(3, 1, 0, 0.5); // nivel constante
  const c = analizarCiclo(sf, [], 2.5);
  assert.equal(c.direccion, "estable");
});
