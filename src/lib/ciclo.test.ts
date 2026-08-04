import { test } from "node:test";
import assert from "node:assert/strict";
import { analizarCiclo, predecirProximosExtremos, type Punto } from "./ciclo.ts";

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

// Serie semidiurna regular: fases de 6h (subida/bajada) encadenadas → período 12h.
// Cierra con 2 puntos ascendentes para que la última bajamar quede como punto interior.
function serieSemidiurna(): { pts: Punto[]; ultimaBajamar: number } {
  const pts: Punto[] = [];
  let t = T0;
  let nivel = 0.5;
  for (let c = 0; c < 5; c++) {
    for (let i = 0; i < 6; i++) { pts.push({ timestamp: new Date(t).toISOString(), nivel_m: nivel }); nivel += 0.1; t += H; }
    for (let i = 0; i < 6; i++) { pts.push({ timestamp: new Date(t).toISOString(), nivel_m: nivel }); nivel -= 0.1; t += H; }
  }
  const ultimaBajamar = t; // baja en t (0.5m)
  pts.push({ timestamp: new Date(t).toISOString(), nivel_m: nivel });
  pts.push({ timestamp: new Date(t + H).toISOString(), nivel_m: nivel + 0.1 });
  pts.push({ timestamp: new Date(t + 2 * H).toISOString(), nivel_m: nivel + 0.2 });
  return { pts, ultimaBajamar };
}

test("predicción: período observado ~12h y próximo extremo coincide", () => {
  const { pts, ultimaBajamar } = serieSemidiurna();
  const p = predecirProximosExtremos(pts, ultimaBajamar);
  assert.equal(p.metodo, "observado");
  assert.ok(p.periodoHoras != null);
  assert.ok(Math.abs(p.periodoHoras! - 12) < 0.3, `periodo=${p.periodoHoras}`);
  assert.ok(p.pleamar != null);
  assert.ok(Math.abs(p.pleamar.timestamp - (ultimaBajamar + 6 * H)) < 0.5 * H, `pleamar=${new Date(p.pleamar.timestamp).toISOString()}`);
  assert.ok(p.bajamar != null);
  assert.ok(Math.abs(p.bajamar.timestamp - (ultimaBajamar + 12 * H)) < 0.5 * H, `bajamar=${new Date(p.bajamar.timestamp).toISOString()}`);
});

test("predicción: serie larga semidiurna (>=48 pts) usa período espectral ~12h", () => {
  // 10 ciclos de 12h → 121 puntos, período exacto 12h
  const pts: Punto[] = [];
  let t = T0;
  let nivel = 0.5;
  for (let c = 0; c < 10; c++) {
    for (let i = 0; i < 6; i++) { pts.push({ timestamp: new Date(t).toISOString(), nivel_m: nivel }); nivel += 0.1; t += H; }
    for (let i = 0; i < 6; i++) { pts.push({ timestamp: new Date(t).toISOString(), nivel_m: nivel }); nivel -= 0.1; t += H; }
  }
  const p = predecirProximosExtremos(pts, t);
  assert.equal(p.metodo, "observado");
  assert.ok(p.periodoHoras != null);
  assert.ok(Math.abs(p.periodoHoras! - 12) < 0.3, `periodo=${p.periodoHoras}`);
});

test("predicción: con una sola pleamar (sin período) cae a astronómica y queda en el futuro", () => {
  const pts: Punto[] = [];
  const t = T0;
  // subida 6h hasta el pico único (1.1m) en t+6h
  for (let i = 0; i < 7; i++) pts.push({ timestamp: new Date(t + i * H).toISOString(), nivel_m: 0.5 + i * 0.1 });
  // bajada 6h desde 1.0m (el pico no se repite): t+7h..t+13h
  for (let i = 0; i < 7; i++) pts.push({ timestamp: new Date(t + (7 + i) * H).toISOString(), nivel_m: 1.0 - i * 0.1 });
  const ahora = t + 14 * H;
  const p = predecirProximosExtremos(pts, ahora);
  assert.equal(p.metodo, "astronomica");
  assert.equal(p.periodoHoras, null);
  assert.ok(p.pleamar != null && p.bajamar != null);
  assert.ok(p.pleamar.timestamp > ahora, "pleamar debe caer en el futuro");
  assert.ok(p.bajamar.timestamp > ahora, "bajamar debe caer en el futuro");
  // durSubida medida = 6h (bajada sin cerrar → durBajada null → T/2)
  assert.ok(Math.abs(p.pleamar.timestamp - p.bajamar.timestamp - 6 * H) < 0.5 * H);
});

test("predicción: sin datos => sin extremos", () => {
  const p = predecirProximosExtremos([]);
  assert.equal(p.pleamar, null);
  assert.equal(p.bajamar, null);
  assert.equal(p.metodo, "astronomica");
});
