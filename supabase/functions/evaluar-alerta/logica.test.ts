import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularVentana, ceseExpirado, MARGEN_AMARILLA_M } from "./logica.ts";

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
