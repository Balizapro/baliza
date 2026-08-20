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

test("crecida en camino: Bs As subiendo 0.42 m/h empuja la entrada por encima del límite", () => {
  // INA main dice día normal (entrada 2.1, vuelta 2.0). Pero la estación vecina
  // (Puerto de Buenos Aires) está subiendo fuerte (+0.42 m/h) en las últimas
  // horas → la misma onda llega a SF: margen = 0.22 → entrada efectiva 2.32 →
  // NO CLASES.
  const pronos = dia("2026-08-18", {
    7: 2.0,
    8: 2.1,
    9: 2.15,
    10: 2.2,
    11: 2.2,
    12: 2.15,
    13: 2.1,
    14: 2.0,
    15: 1.9,
  }, { p25Offset: -0.05 });
  const vecinas = [{
    nombre: "Puerto de Buenos Aires",
    // 12:00Z..17:00Z = 09:00..14:00 local: subiendo +0.42 m/h por lectura
    lecturas: [
      { timestamp: "2026-08-18T12:00:00Z", nivel_m: 1.6 },
      { timestamp: "2026-08-18T13:00:00Z", nivel_m: 2.02 },
      { timestamp: "2026-08-18T14:00:00Z", nivel_m: 2.44 },
    ],
  }];
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, [], { vecinas });
  assert.ok(v.pendiente_m != null && v.pendiente_m >= 0.41);
  assert.equal(v.pendiente_estacion, "Puerto de Buenos Aires");
  // margen = min(0.25, 0.42-0.20) = 0.22 sobre el main de la entrada (2.10) → 2.32
  assert.ok(v.entrada.efectivo_m != null && v.entrada.efectivo_m >= 2.3);
  assert.equal(v.estado, "no_clases");
});

test("sin pendiente fuerte: un día accesible se mantiene NORMAL", () => {
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
  // La vecina sube despacio (0.12 m/h, marea normal) → margen 0.
  const vecinas = [{
    nombre: "La Plata",
    lecturas: [
      { timestamp: "2026-08-18T12:00:00Z", nivel_m: 1.9 },
      { timestamp: "2026-08-18T13:00:00Z", nivel_m: 2.02 },
      { timestamp: "2026-08-18T14:00:00Z", nivel_m: 2.14 },
    ],
  }];
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, [], { vecinas });
  assert.equal(v.estado, "normal");
  assert.ok(v.pendiente_m != null && v.pendiente_m < 0.35);
  // El efectivo no debería superar lo que ya daba main/bandas (sin penalizar)
  assert.ok(v.entrada.efectivo_m != null && v.entrada.efectivo_m <= 1.90);
});

test("el margen por crecida está acotado arriba (no dispara a lo absurdo)", () => {
  const pronos = dia("2026-08-18", {
    7: 1.8,
    8: 1.9,
    9: 2.0,
    10: 2.1,
    11: 2.15,
    12: 2.1,
    13: 2.0,
    14: 1.9,
    15: 1.8,
  }, { p25Offset: -0.05 });
  // Pendiente brutal (1.0 m/h): margen debe quedar en 0.25, no en 0.80.
  const vecinas = [{
    nombre: "Puerto de Buenos Aires",
    lecturas: [
      { timestamp: "2026-08-18T12:00:00Z", nivel_m: 1.6 },
      { timestamp: "2026-08-18T13:00:00Z", nivel_m: 2.6 },
      { timestamp: "2026-08-18T14:00:00Z", nivel_m: 3.6 },
    ],
  }];
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, [], { vecinas });
  assert.ok(v.pendiente_m != null && v.pendiente_m >= 0.9);
  // entrada main 1.9 + margen tope 0.25 = 2.15 (no 2.9)
  assert.ok(v.entrada.efectivo_m != null && v.entrada.efectivo_m <= 2.2);
});

test("modos estricto y suave: suave no puede ser más alto que estricto", () => {
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
  const vecinas = [{
    nombre: "Puerto de Buenos Aires",
    lecturas: [
      { timestamp: "2026-08-18T12:00:00Z", nivel_m: 1.6 },
      { timestamp: "2026-08-18T13:00:00Z", nivel_m: 2.6 },
      { timestamp: "2026-08-18T14:00:00Z", nivel_m: 3.6 },
    ],
  }];
  const observadas = [
    { timestamp: "2026-08-18T12:00:00Z", nivel_m: 2.2 },
    { timestamp: "2026-08-18T13:00:00Z", nivel_m: 2.75 },
    { timestamp: "2026-08-18T14:00:00Z", nivel_m: 2.9 },
  ];
  const fuentes = { vecinas, shnObservado: observadas };
  const estricto = calcularVeredicto(pronos, "2026-08-18", 2.25, [], fuentes, "estricto");
  const suave = calcularVeredicto(pronos, "2026-08-18", 2.25, [], fuentes, "suave");
  assert.equal(estricto.modo, "estricto");
  assert.equal(suave.modo, "suave");
  // El modo suave excluye bandas/sesgo/margen: nunca supera al estricto.
  assert.ok(suave.entrada.efectivo_m !== null && estricto.entrada.efectivo_m !== null);
  assert.ok(suave.entrada.efectivo_m <= estricto.entrada.efectivo_m);
  assert.ok(suave.vuelta.efectivo_m !== null && estricto.vuelta.efectivo_m !== null);
  assert.ok(suave.vuelta.efectivo_m <= estricto.vuelta.efectivo_m);
  assert.ok(suave.hora7.efectivo_m !== null && estricto.hora7.efectivo_m !== null);
  assert.ok(suave.hora7.efectivo_m <= estricto.hora7.efectivo_m);
});

test("modo suave sin penalizaciones: coincide con el nivel central INA main", () => {
  // Sin observaciones ni vecinas ni modelo: suave debe ser igual al main.
  const pronos = dia("2026-08-18", {
    7: 1.5,
    8: 1.6,
    9: 1.7,
    10: 1.8,
    11: 1.9,
    12: 2.0,
    13: 1.9,
    14: 1.8,
    15: 1.7,
  });
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, [], {}, "suave");
  assert.equal(v.estado, "normal");
  assert.ok(v.entrada.efectivo_m !== null && v.entrada.main !== null);
  assert.equal(v.entrada.efectivo_m, v.entrada.main);
});