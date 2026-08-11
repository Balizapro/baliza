import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularVentana,
  ceseExpirado,
  detectarGiro,
  esPicoInminente,
  mismoEpisodioPreaviso,
  MARGEN_AMARILLA_M,
} from "./logica.ts";

const U = {
  evaluacion: 2.0,
  noRetorno: 2.2,
  bajanteAlarma: 0,
  bajanteEvacuacion: -0.3,
};

const MSG = {};
const traslado = 10;

test("subiendo con nivel muy por debajo del umbral => verde", () => {
  const r = calcularVentana(0.84, "subiendo", U, traslado, MSG);
  assert.equal(r.alerta, "verde");
  assert.match(r.mensaje, /Todo normal/);
});

test("subiendo dentro del margen (>= eval - margen) => amarilla", () => {
  const nivel = U.evaluacion - MARGEN_AMARILLA_M + 0.01; // 1.01m, subiendo
  const r = calcularVentana(nivel, "subiendo", U, traslado, MSG);
  assert.equal(r.alerta, "amarilla");
});

test("justo en el limite inferior del margen (eval - margen) => amarilla", () => {
  const nivel = U.evaluacion - MARGEN_AMARILLA_M; // 1.00m
  const r = calcularVentana(nivel, "subiendo", U, traslado, MSG);
  assert.equal(r.alerta, "amarilla");
});

test("subiendo justo debajo del margen => verde", () => {
  const nivel = U.evaluacion - MARGEN_AMARILLA_M - 0.01; // 0.99m
  const r = calcularVentana(nivel, "subiendo", U, traslado, MSG);
  assert.equal(r.alerta, "verde");
});

test("subiendo por encima del umbral de evaluacion => roja (preparar salida)", () => {
  const r = calcularVentana(2.05, "subiendo", U, traslado, MSG);
  assert.equal(r.alerta, "roja");
  assert.ok(r.ventanaFin != null);
});

test("nivel critico >= no retorno => roja (salir ahora)", () => {
  const r = calcularVentana(2.3, "estable", U, traslado, MSG);
  assert.equal(r.alerta, "roja");
});

test("estable bajo evaluacion => verde", () => {
  const r = calcularVentana(1.5, "estable", U, traslado, MSG);
  assert.equal(r.alerta, "verde");
});

test("bajando bajo evaluacion => verde", () => {
  const r = calcularVentana(1.5, "bajando", U, traslado, MSG);
  assert.equal(r.alerta, "verde");
});

test("bajante alarma => azul", () => {
  const r = calcularVentana(0, "estable", U, traslado, MSG);
  assert.equal(r.alerta, "azul");
});

test("bajante evacuacion => evacuacion", () => {
  const r = calcularVentana(-0.4, "estable", U, traslado, MSG);
  assert.equal(r.alerta, "evacuacion");
});

test("cese expirado => true (emitido hace mas de 2hs)", () => {
  const emitido = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  assert.equal(ceseExpirado(emitido), true);
});

test("cese vigente => false (emitido hace menos de 2hs)", () => {
  const emitido = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  assert.equal(ceseExpirado(emitido), false);
});

test("cese sin emitido => true (se descarta)", () => {
  assert.equal(ceseExpirado(null), true);
});

test("aviso no-cese nunca se descarta por expiracion", () => {
  const ahora = Date.now();
  assert.equal(ceseExpirado(new Date(ahora - 24 * 3600 * 1000).toISOString()), true);
  assert.equal(ceseExpirado(new Date(ahora).toISOString()), false);
});

// ── detectarGiro (giro de exteriores, 1 lectura posterior) ──────────────────

const OPC = { picoMaxEdadHs: 6, pendienteMinMH: 0.005 };

function serie(entradas: [string, number][], fecha = "2026-08-10"): { timestamp: string; nivel_m: number }[] {
  return entradas.map(([t, v]) => ({ timestamp: `${fecha}T${t}:00Z`, nivel_m: v }));
}

const BA = serie([
  ["00:45", 0.93], ["01:45", 1.3], ["02:45", 1.62], ["03:00", 1.62],
  ["03:45", 1.83], ["04:45", 2.02], ["05:45", 2.09], ["06:45", 2.11],
  ["07:45", 2.04], ["08:45", 1.9],
]);

test("detectarGiro con datos reales 10/08: BA gira a las 07:45 (1 lectura posterior, pico 06:45)", () => {
  const hasta = new Date("2026-08-10T07:45:00Z").getTime();
  const r = detectarGiro(BA.filter((x) => new Date(x.timestamp).getTime() <= hasta), { ...OPC, ahoraMs: hasta });
  assert.ok(r, "debería detectar giro con solo la lectura 07:45 tras el pico 06:45");
  assert.equal(r.picoTs, new Date("2026-08-10T06:45:00Z").getTime());
  assert.ok(r.pendiente_m_h < 0);
});

test("detectarGiro: sin confirmar giro si la ultima lectura es el pico (aun subiendo)", () => {
  // BA hasta 06:45: la 06:45 (2.11) es el máximo y no hay lectura posterior más baja.
  const hasta = new Date("2026-08-10T06:45:00Z").getTime();
  const r = detectarGiro(BA.filter((x) => new Date(x.timestamp).getTime() <= hasta), { ...OPC, ahoraMs: hasta });
  assert.equal(r, null);
});

test("detectarGiro: giro descartado si el pico es demasiado viejo (mayor a 6h)", () => {
  const hasta = new Date("2026-08-10T15:00:00Z").getTime();
  const r = detectarGiro(BA, { ...OPC, ahoraMs: hasta });
  assert.equal(r, null);
});

test("detectarGiro: serie sin pico (monotona creciente) => null", () => {
  const sube = serie([["00:00", 1.0], ["01:00", 1.1], ["02:00", 1.2], ["03:00", 1.3]]);
  const hasta = new Date("2026-08-10T03:00:00Z").getTime();
  assert.equal(detectarGiro(sube, { ...OPC, ahoraMs: hasta }), null);
});

test("detectarGiro: menos de 4 lecturas => null", () => {
  const corta = serie([["00:00", 1.0], ["01:00", 1.1], ["02:00", 1.0]]);
  assert.equal(detectarGiro(corta, { ...OPC, ahoraMs: Date.now() }), null);
});

test("detectarGiro: pendiente positiva (sigue subiendo tras mini-pico) => null", () => {
  const v = serie([["00:00", 1.0], ["01:00", 1.1], ["02:00", 1.0], ["03:00", 1.2]]);
  const hasta = new Date("2026-08-10T03:00:00Z").getTime();
  assert.equal(detectarGiro(v, { ...OPC, ahoraMs: hasta }), null);
});

test("detectarGiro con datos reales 11/08: SF gira con lecturas hasta 07:45 aunque la tendencia puntual dea estable", () => {
  // Serie SF 11/08 hasta 07:45 (sin la lectura 08:45): 06:45=2.19 pico seguido de 07:45=2.18.
  // Esto reproduce la corrida de las 09:00 que usaba la lectura vieja: tendencia puntual
  // 2.19->2.18 = -0.01 = "estable", pero detectarGiro sí debe ver el giro (bajada desde el pico).
  const SF = serie([
    ["00:45", 1.57], ["01:45", 1.52], ["02:45", 1.66], ["03:45", 1.84],
    ["04:45", 2.04], ["05:45", 2.16], ["06:45", 2.19], ["07:45", 2.18],
  ], "2026-08-11");
  const hasta = new Date("2026-08-11T09:00:00Z").getTime();
  const r = detectarGiro(SF, { ...OPC, ahoraMs: hasta });
  assert.ok(r, "SF ya gira (pico 2.19 el 06:45) => no debe avisar exteriores bajando");
  assert.equal(r.picoTs, new Date("2026-08-11T06:45:00Z").getTime());
});

test("detectarGiro con datos reales 11/08: SF sin giro a las 05:00 (aun subiendo) => null, aviso de exteriores procede", () => {
  // Serie SF 11/08 hasta 04:45: sube de 1.57 a 2.04 sin pico confirmado.
  const SF = serie([
    ["00:45", 1.57], ["01:45", 1.52], ["02:45", 1.66], ["03:45", 1.84], ["04:45", 2.04],
  ], "2026-08-11");
  const hasta = new Date("2026-08-11T05:00:00Z").getTime();
  assert.equal(detectarGiro(SF, { ...OPC, ahoraMs: hasta }), null);
});

// ── esPicoInminente ─────────────────────────────────────────────────────────

test("esPicoInminente: pico dentro de 12h => true", () => {
  const ahora = Date.parse("2026-08-10T00:00:00Z");
  assert.equal(esPicoInminente(ahora + 5 * 3600000, ahora, 12), true);
});

test("esPicoInminente: pico a 2 dias => false (no avisar con mucha anticipacion)", () => {
  const ahora = Date.parse("2026-08-08T04:00:00Z");
  const pico = Date.parse("2026-08-10T08:00:00Z"); // 52h despues (caso real 08-08)
  assert.equal(esPicoInminente(pico, ahora, 12), false);
});

// ── mismoEpisodioPreaviso (dedup por episodio con tolerancia) ───────────────

test("mismoEpisodioPreaviso: pico corrido 1h (08:00->09:00) => mismo episodio, no re-notifica", () => {
  const claves = ["preaviso_pico_1786348800000"]; // pico 08-10 08:00 UTC
  const picoNuevo = Date.parse("2026-08-10T09:00:00Z"); // 1786352400000
  assert.equal(mismoEpisodioPreaviso(claves, picoNuevo, 3 * 3600000), true);
});

test("mismoEpisodioPreaviso: pico 2 dias despues => otra crecida, si re-notifica", () => {
  const claves = ["preaviso_pico_1786348800000"];
  const picoOtro = Date.parse("2026-08-12T09:00:00Z");
  assert.equal(mismoEpisodioPreaviso(claves, picoOtro, 3 * 3600000), false);
});

test("mismoEpisodioPreaviso: sin claves previas => false", () => {
  assert.equal(mismoEpisodioPreaviso([], Date.now(), 3 * 3600000), false);
});

test("mismoEpisodioPreaviso: clave con timestamp no numerico se ignora", () => {
  const claves = ["preaviso_pico_abc", "otra_clave"];
  assert.equal(mismoEpisodioPreaviso(claves, Date.now(), 3 * 3600000), false);
});
