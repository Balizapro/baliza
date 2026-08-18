import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularVeredicto, esDiaEscolar, hhmm, minutosDiaArgentina } from "./planEscolar.ts";

// Genera el pronóstico de un día: serie main (pico al mediodía) y bandas p25/p95.
// Los timestamps son UTC; la serie corresponde a las horas locales de Argentina.
function dia(
  fecha: string,
  main: Record<number, number>, // hora local -> nivel
  opt?: { p95Offset?: number; p25Offset?: number }
): { timestamp: string; valor_m: number; qualifier: string }[] {
  const pts: { timestamp: string; valor_m: number; qualifier: string }[] = [];
  const offset95 = opt?.p95Offset ?? 0.09;
  const offset25 = opt?.p25Offset ?? -0.09;
  for (const [h, v] of Object.entries(main)) {
    const hora = parseInt(h, 10);
    const iso = new Date(`${fecha}T${String(hora).padStart(2, "0")}:00:00`).toISOString();
    pts.push({ timestamp: iso, valor_m: v, qualifier: "main" });
    pts.push({ timestamp: iso, valor_m: v + offset95, qualifier: "p95" });
    pts.push({ timestamp: iso, valor_m: v + offset25, qualifier: "p25" });
    pts.push({ timestamp: iso, valor_m: v, qualifier: "p75" });
  }
  return pts;
}

test("minutosDiaArgentina trabaja en zona de la escuela", () => {
  // 12:00 UTC = 09:00 ART (invierno, UTC-3)
  const iso = new Date("2026-08-18T12:00:00Z").toISOString();
  assert.equal(minutosDiaArgentina(iso), 9 * 60);
});

test("esDiaEscolar: lunes-viernes, sin feriado", () => {
  assert.equal(esDiaEscolar("2026-08-18", "Tue", []), true);
  assert.equal(esDiaEscolar("2026-08-22", "Sat", []), false);
  assert.equal(esDiaEscolar("2026-08-23", "Sun", []), false);
  assert.equal(esDiaEscolar("2026-08-17", "Mon", ["2026-08-17"]), false);
});

test("veredicto SALIDA TEMPRANA: entra a las 8 pero no vuelve a las 14:15", () => {
  const pronos = dia("2026-08-18", {
    7: 1.94,
    8: 2.01,
    9: 2.18,
    10: 2.36,
    11: 2.52,
    12: 2.65,
    13: 2.52,
    14: 2.36,
    15: 2.18,
  }, { p25Offset: -0.04 });
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, []);
  assert.equal(v.estado, "salida_temprana");
  assert.equal(v.esDiaEscolar, true);
  assert.ok(v.entrada.main !== null && v.entrada.main < 2.25);
  assert.ok(v.vuelta.main !== null && v.vuelta.main > 2.25);
  assert.equal(v.confianza, "alta");
  // Cruce por encima del límite entre 09:00 y 10:00
  assert.ok(v.salidaLimiteMin !== null && v.salidaLimiteMin >= 9 * 60 && v.salidaLimiteMin <= 10 * 60);
});

test("veredicto NO CLASES: a las 8 ya está sobre el límite", () => {
  const pronos = dia("2026-08-18", {
    7: 2.3,
    8: 2.4,
    9: 2.55,
    10: 2.6,
    11: 2.6,
    12: 2.55,
  });
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, []);
  assert.equal(v.estado, "no_clases");
  assert.equal(v.confianza, "alta");
});

test("veredicto NORMAL: todo el día accesible", () => {
  const pronos = dia("2026-08-18", {
    7: 1.7,
    8: 1.8,
    9: 1.9,
    10: 2.0,
    11: 2.05,
    12: 2.05,
    13: 2.0,
    14: 1.9,
    15: 1.8,
  });
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, []);
  assert.equal(v.estado, "normal");
  assert.equal(v.salidaLimiteMin, null);
});

test("veredicto en día sin clases es normal (no decide)", () => {
  const pronos = dia("2026-08-17", {
    7: 2.3,
    8: 2.4,
    9: 2.55,
    12: 2.55,
  });
  const v = calcularVeredicto(pronos, "2026-08-17", 2.25, ["2026-08-17"]);
  assert.equal(v.estado, "normal");
  assert.equal(v.esDiaEscolar, false);
});

test("confianza media cuando la banda p95 cruza el límite", () => {
  // Entrada main 2.01 (segura) pero p95 2.65 (cruza el límite): hay riesgo real
  const pronos = dia("2026-08-18", {
    7: 1.94,
    8: 2.01,
    9: 2.18,
    10: 2.36,
    11: 2.52,
    12: 2.65,
    13: 2.52,
    14: 2.36,
    15: 2.18,
  }, { p95Offset: 0.64, p25Offset: -0.05 });
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, []);
  assert.equal(v.estado, "salida_temprana");
  assert.equal(v.confianza, "media");
});

test("hhmm formatea minutos del día", () => {
  assert.equal(hhmm(9 * 60 + 23), "09:23");
  assert.equal(hhmm(null), "--");
});

test("modelo propio más alto que INA: decisión usa el peor (modelo)", () => {
  // INA main dice accesible todo el día, pero el modelo propio pronostica una
  // sudestada que deja el muelle cortado a la tarde → SALIDA TEMPRANA.
  const pronos = dia("2026-08-18", {
    7: 1.7,
    8: 1.8,
    9: 1.9,
    10: 2.0,
    11: 2.05,
    12: 2.05,
    13: 2.0,
    14: 1.9,
    15: 1.8,
  }, { p25Offset: -0.05 });
  const modelo = [
    { timestamp: "2026-08-18T14:00:00Z", nivel_m: 2.0 }, // local 11:00
    { timestamp: "2026-08-18T16:00:00Z", nivel_m: 2.3 }, // local 13:00
    { timestamp: "2026-08-18T17:30:00Z", nivel_m: 2.6 }, // local 14:30 pico modelo
    { timestamp: "2026-08-18T19:00:00Z", nivel_m: 2.1 }, // local 16:00
  ];
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, [], { modelo });
  assert.equal(v.estado, "salida_temprana");
  assert.ok(v.vuelta.modelo_m != null && v.vuelta.modelo_m > 2.25);
  assert.ok(v.vuelta.efectivo_m != null && v.vuelta.efectivo_m >= v.vuelta.modelo_m);
});

test("sesgo en vivo positivo: sube el nivel efectivo por encima del main INA", () => {
  // INA main en 8:00 = 2.0 (dice accesible), pero las observaciones de las
  // últimas horas vienen ~+0.3m por encima del pronóstico INA → el efectivo
  // queda > 2.25 y cambia a NO CLASES.
  const pronos = dia("2026-08-18", {
    7: 1.94,
    8: 2.0,
    9: 2.18,
    10: 2.36,
    11: 2.52,
    12: 2.65,
  }, { p25Offset: -0.05, p95Offset: 0.1 });
  // 10:00Z = 07:00 hora local (prono main 1.94), 11:00Z = 08:00 local (prono 2.0)
  const observadas = [
    { timestamp: "2026-08-18T10:00:00Z", nivel_m: 2.24 },
    { timestamp: "2026-08-18T11:00:00Z", nivel_m: 2.3 },
  ];
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, [], { shnObservado: observadas });
  assert.ok(v.sesgo_m != null && v.sesgo_m > 0.25);
  assert.ok(v.entrada.efectivo_m != null && v.entrada.efectivo_m > 2.25);
  assert.equal(v.estado, "no_clases");
});

test("regla 60 min: salida límite justo después de las 8 → NO CLASES", () => {
  // Entra a las 8 (accesible) pero la salida límite es ~8:42 (< 60 min) → no
  // tiene sentido mandar a los chicos: el veredicto debe ser NO CLASES.
  const pronos = dia("2026-08-18", {
    7: 1.94,
    8: 2.01,
    9: 2.35,
    10: 2.5,
    11: 2.55,
    12: 2.5,
    14: 2.36,
    15: 2.18,
  }, { p25Offset: -0.05 });
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, []);
  assert.ok(v.salidaLimiteMin != null && v.salidaLimiteMin >= 8 * 60 && v.salidaLimiteMin < 9 * 60);
  assert.equal(v.estado, "no_clases");
});