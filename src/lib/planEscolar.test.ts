import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularVeredicto, esDiaEscolar, hhmm, minutosDiaArgentina, pesoSesgo, puntosAvisoSanFernando } from "./planEscolar.ts";

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

test("cruce nocturno: la salida límite ignora cruces anteriores a la entrada", () => {
  // El agua está sobre el límite de madrugada (cruce hacia arriba ~4:30), baja
  // antes de las 8 y vuelve a subir a media mañana. El cruce de las 4:30 NO es
  // la salida límite relevante: debe reportarse el cruce posterior a las 8.
  const pronos = dia("2026-08-18", {
    4: 2.0,
    5: 2.4,
    6: 2.3,
    7: 2.0,
    8: 1.95,
    9: 2.1,
    10: 2.35,
    11: 2.5,
    12: 2.55,
    13: 2.5,
    14: 2.4,
    15: 2.2,
  }, { p25Offset: -0.05 });
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, []);
  // Entra bien (1.95) pero a la tarde no vuelve → SALIDA TEMPRANA (no NO CLASES
  // por un cruce de madrugada con minutos negativos).
  assert.equal(v.estado, "salida_temprana");
  assert.ok(v.salidaLimiteMin != null && v.salidaLimiteMin >= 8 * 60);
});

test("NaN en una fuente no rompe el veredicto", () => {
  // Un punto NaN en el pronóstico y otro en la curva del modelo no deben
  // propagarse al efectivo (NaN != null es false y antes se colaba en Math.max).
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
  const iso16 = new Date("2026-08-18T16:00:00").toISOString();
  pronos.push({ timestamp: iso16, valor_m: NaN, qualifier: "main" });
  const modelo = [
    { timestamp: new Date("2026-08-18T08:00:00").toISOString(), nivel_m: 1.7 },
    { timestamp: new Date("2026-08-18T14:15:00").toISOString(), nivel_m: NaN },
  ];
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, [], { modelo }, "estricto");
  assert.equal(v.estado, "normal");
  assert.ok(v.entrada.efectivo_m != null && Number.isFinite(v.entrada.efectivo_m));
});

test("la pleamar SHN de la tarde no se estira hacia la mañana", () => {
  // El boletín SHN con solo PLEAMAR 16:00 2.60 / BAJAMAR 22:00 1.70 NO debe
  // aplicar 2.60 a las 8:00 (antes el fallback del interpolador devolvía el
  // próximo extremo para horas fuera del rango). A las 14:15, tampoco está
  // acotada (entre 16:00 y 22:00 no cae), así que el SHN no aporta ahí.
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
  const shnAlturas = [
    { estado: "PLEAMAR" as const, fecha: "18/08/2026", hora: "16:00", altura: 2.6 },
    { estado: "BAJAMAR" as const, fecha: "18/08/2026", hora: "22:00", altura: 1.7 },
  ];
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, [], { shnAlturas }, "estricto");
  assert.equal(v.estado, "normal");
  assert.ok(v.entrada.efectivo_m != null && v.entrada.efectivo_m < 2.25);
  // El efectivo no puede ser el 2.60 de la pleamar vespertina.
  assert.ok(v.entrada.efectivo_m! < 2.4);
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

// ── El ajuste en vivo se apaga con la distancia (7-oct-2026) ─────────────────────────────
// Hora fija de Argentina (-03:00), para que estos tests no dependan de la zona de la máquina.
function diaART(
  fecha: string,
  main: Record<number, number>,
  opt?: { p25?: number; p75?: number; p95?: number }
): { timestamp: string; valor_m: number; qualifier: string }[] {
  const pts: { timestamp: string; valor_m: number; qualifier: string }[] = [];
  for (const [h, v] of Object.entries(main)) {
    const iso = new Date(`${fecha}T${String(parseInt(h, 10)).padStart(2, "0")}:00:00-03:00`).toISOString();
    pts.push({ timestamp: iso, valor_m: v, qualifier: "main" });
    pts.push({ timestamp: iso, valor_m: v + (opt?.p95 ?? 0.05), qualifier: "p95" });
    pts.push({ timestamp: iso, valor_m: v + (opt?.p25 ?? -0.05), qualifier: "p25" });
    pts.push({ timestamp: iso, valor_m: v + (opt?.p75 ?? 0), qualifier: "p75" });
  }
  return pts;
}
// El agua medida viene +0.30m sobre lo pronosticado; última observación: 18-ago 08:00 ART.
const OBS_SESGO = [
  { timestamp: "2026-08-18T10:00:00Z", nivel_m: 2.24 }, // 07:00 ART (pronóstico 1.94)
  { timestamp: "2026-08-18T11:00:00Z", nivel_m: 2.3 }, // 08:00 ART (pronóstico 2.0)
];
const MAIN_HORAS = { 7: 1.94, 8: 2.0, 9: 2.05, 14: 2.0, 15: 1.95 };

test("pesoSesgo: pleno hasta 12 h, se apaga linealmente y es 0 desde las 36 h", () => {
  assert.equal(pesoSesgo(0), 1);
  assert.equal(pesoSesgo(-3), 1); // la hora ya pasó
  assert.equal(pesoSesgo(12), 1);
  assert.equal(pesoSesgo(24), 0.5);
  assert.equal(pesoSesgo(36), 0);
  assert.equal(pesoSesgo(60), 0);
  assert.equal(pesoSesgo(Number.NaN), 1); // si algo falla, se comporta como antes (conservador)
});

test("el ajuste en vivo sigue completo el mismo día (no se debilita la protección original)", () => {
  const pronos = diaART("2026-08-18", { ...MAIN_HORAS, 10: 2.1, 11: 2.1, 12: 2.1, 13: 2.05 });
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, [], { shnObservado: OBS_SESGO });
  assert.ok(v.sesgo_m != null && Math.abs(v.sesgo_m - 0.3) < 1e-9);
  assert.ok(v.entrada.efectivo_m != null && Math.abs(v.entrada.efectivo_m - 2.3) < 1e-9, `${v.entrada.efectivo_m}`);
  assert.equal(v.entrada.fuente, "sesgo");
  assert.equal(v.estado, "no_clases");
});

test("a 24 h el ajuste pesa la mitad", () => {
  const pronos = [
    ...diaART("2026-08-18", MAIN_HORAS),
    ...diaART("2026-08-19", { 8: 2.0, 14: 2.0 }),
  ];
  const v = calcularVeredicto(pronos, "2026-08-19", 2.25, [], { shnObservado: OBS_SESGO });
  assert.ok(v.entrada.efectivo_m != null && Math.abs(v.entrada.efectivo_m - 2.15) < 1e-9, `${v.entrada.efectivo_m}`);
  assert.equal(v.estado, "normal");
});

test("a 2 días el ajuste ya no cuenta: el mismo +0.30m medido hoy NO convierte el viernes en 'no ir'", () => {
  const pronos = [
    ...diaART("2026-08-18", MAIN_HORAS),
    ...diaART("2026-08-20", { 8: 2.0, 14: 2.0 }),
  ];
  const v = calcularVeredicto(pronos, "2026-08-20", 2.25, [], { shnObservado: OBS_SESGO });
  assert.ok(v.sesgo_m != null && v.sesgo_m > 0.25, "el sesgo medido se sigue informando");
  assert.ok(v.entrada.efectivo_m != null && Math.abs(v.entrada.efectivo_m - 2.0) < 1e-9, `${v.entrada.efectivo_m}`);
  assert.equal(v.estado, "normal");
});

test("la banda de error del INA NO decide: central 2.17m con banda hasta 2.40m => 'normal', y el rango se aclara", () => {
  const pronos = [
    ...diaART("2026-08-18", MAIN_HORAS),
    ...diaART("2026-08-20", { 8: 2.17, 14: 2.0 }, { p75: 0.23 }), // central 2.17, banda alta 2.40
  ];
  const v = calcularVeredicto(pronos, "2026-08-20", 2.25, [], { shnObservado: OBS_SESGO });
  assert.equal(v.estado, "normal");
  assert.ok(v.entrada.efectivo_m != null && Math.abs(v.entrada.efectivo_m - 2.17) < 1e-9, `${v.entrada.efectivo_m}`);
  assert.equal(v.entrada.fuente, "ina");
  assert.ok(v.entrada.p75 != null && Math.abs(v.entrada.p75 - 2.4) < 1e-9, "la banda se sigue informando");
  assert.match(v.explicacion, /queda dentro del rango habitual del INA \(hasta 2\.40m\)/);
  assert.match(v.explicacion, /se decide por el pronóstico central, no por el rango/);
});

test("si el pronóstico central ya supera el límite, sí es 'no ir' (por el nivel pronosticado, no por la banda)", () => {
  const pronos = [
    ...diaART("2026-08-18", MAIN_HORAS),
    ...diaART("2026-08-20", { 8: 2.33, 14: 1.7 }, { p25: -0.12, p75: 0.11 }),
  ];
  const v = calcularVeredicto(pronos, "2026-08-20", 2.25, [], { shnObservado: OBS_SESGO });
  assert.equal(v.estado, "no_clases");
  assert.ok(v.entrada.efectivo_m != null && Math.abs(v.entrada.efectivo_m - 2.33) < 1e-9, `${v.entrada.efectivo_m}`);
  assert.equal(v.entrada.fuente, "ina");
});

test("el motivo dice qué pronostica el INA y su rango; 'se toma' solo aparece si otra fuente lo subió", () => {
  const pronos = [
    ...diaART("2026-08-18", MAIN_HORAS),
    ...diaART("2026-08-20", { 8: 2.33, 14: 1.7 }, { p25: -0.12, p75: 0.11 }),
  ];
  const v = calcularVeredicto(pronos, "2026-08-20", 2.25, [], { shnObservado: OBS_SESGO });
  assert.match(v.motivo, /El INA pronostica 2\.33m \(rango habitual 2\.21–2\.44m\)\./);
  assert.doesNotMatch(v.motivo, /se toma/);
  const hoy = calcularVeredicto(
    diaART("2026-08-18", { ...MAIN_HORAS, 10: 2.1 }),
    "2026-08-18", 2.25, [], { shnObservado: OBS_SESGO }
  );
  assert.match(hoy.motivo, /El INA pronostica 2\.00m .*se toma 2\.30m por el ajuste en vivo \(\+0\.30m/);
});

test("si el INA y lo que se usa coinciden, el motivo no agrega explicaciones de más", () => {
  const pronos = diaART("2026-08-18", { 7: 2.3, 8: 2.4, 14: 2.4 }, { p25: -0.02, p75: 0 });
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, []);
  assert.equal(v.estado, "no_clases");
  assert.doesNotMatch(v.motivo, /se toma/);
});

// ── El aviso oficial por crecida del SHN entra al veredicto (7-oct-2026) ─────────────────
// Formato real del aviso del 30-sep (San Fernando 2.25m a las 11:30).
const AVISO_REAL = {
  tipo: "aviso_crecida",
  alturas: [
    { puerto: "PUERTO LA PLATA", altura_m: 2.2, hora: "08:30", fecha: "30/09/2026" },
    { puerto: "PUERTO DE BUENOS AIRES (MUELLE DE PESCADORES)", altura_m: 2.2, hora: "10:30", fecha: "30/09/2026" },
    { puerto: "SAN FERNANDO", altura_m: 2.25, hora: "11:30", fecha: "30/09/2026" },
  ],
};
const avisoSF = (altura_m: number, hora: string, fecha = "21/08/2026", tipo = "aviso_crecida") => ({
  tipo,
  alturas: [{ puerto: "SAN FERNANDO", altura_m, hora, fecha }],
});
const INA_NORMAL = { 8: 2.0, 9: 2.0, 12: 2.0, 14: 2.0, 15: 2.0 };
// Aviso con su hora de emisión (21-ago 07:00 ART = 10:00 UTC) y dos momentos de carga del INA.
const avisoEmitido = (altura_m: number, hora: string, fecha = "21/08/2026") => ({
  tipo: "aviso_crecida",
  emitido: "2026-08-21T10:00:00Z",
  alturas: [{ puerto: "SAN FERNANDO", altura_m, hora, fecha }],
});
const INA_MAS_VIEJO = Date.parse("2026-08-21T09:00:00Z"); // cargado ANTES del aviso
const INA_MAS_NUEVO = Date.parse("2026-08-21T14:00:00Z"); // cargado DESPUÉS del aviso

test("el motivo se parte en frase corta (titular) y explicación (letra chica), sin perder texto", () => {
  const pronos = diaART("2026-08-20", { 8: 2.0, 14: 2.0 }, { p25: -0.05, p75: 0.05 });
  const v = calcularVeredicto(pronos, "2026-08-20", 2.25, [], { shnAviso: puntosAvisoSanFernando(avisoSF(2.6, "08:30", "20/08/2026")) });
  assert.equal(v.estado, "no_clases");
  assert.equal(v.motivo, `${v.motivo_corto}${v.explicacion ? " " + v.explicacion : ""}`);
  assert.match(v.motivo_corto, /^A las 8 el agua estaría en 2\.60m — sobre el nivel seguro \(2\.25m\): NO se puede cruzar en lancha\.$/);
  assert.doesNotMatch(v.motivo_corto, /se toma|INA pronostica|ojito|👁/i);
  assert.match(v.explicacion, /^Se toma 2\.60m del aviso oficial del SHN \(San Fernando 2\.60m a las 08:30\)\. 👁️ El INA dice otra cosa: pronostica 2\.00m a las 08:00, bajo el límite \(2\.25m\)\.$/);
});

test("sin otra fuente que lo suba, la explicación es solo lo que pronostica el INA y su rango", () => {
  const pronos = diaART("2026-08-18", { 7: 2.3, 8: 2.4, 14: 2.4 }, { p25: -0.02, p75: 0 });
  const v = calcularVeredicto(pronos, "2026-08-18", 2.25, []);
  assert.equal(v.estado, "no_clases");
  assert.match(v.explicacion, /^El INA pronostica 2\.40m \(rango habitual 2\.38–2\.40m\)\.$/);
  assert.doesNotMatch(v.explicacion, /se toma/);
  assert.equal(v.motivo, `${v.motivo_corto} ${v.explicacion}`);
});

test("puntosAvisoSanFernando: toma solo San Fernando y convierte fecha y hora", () => {
  assert.deepEqual(puntosAvisoSanFernando(AVISO_REAL), [{ fecha: "2026-09-30", min: 11 * 60 + 30, altura_m: 2.25, emitidoMs: null }]);
});

test("puntosAvisoSanFernando: 'alerta' por crecida (el SHN sube el nivel) también cuenta", () => {
  assert.equal(puntosAvisoSanFernando(avisoSF(2.6, "08:30", "21/08/2026", "alerta_crecida")).length, 1);
});

test("puntosAvisoSanFernando: un CESE, otro tipo de aviso o datos incompletos no suman", () => {
  assert.deepEqual(puntosAvisoSanFernando(avisoSF(2.6, "08:30", "21/08/2026", "cese_crecida")), []);
  assert.deepEqual(puntosAvisoSanFernando(avisoSF(2.6, "08:30", "21/08/2026", "aviso_viento")), []);
  assert.deepEqual(puntosAvisoSanFernando(null), []);
  assert.deepEqual(puntosAvisoSanFernando({ tipo: "aviso_crecida", alturas: null }), []);
  assert.deepEqual(puntosAvisoSanFernando(avisoSF(2.6, "8h30")), []);
  assert.deepEqual(puntosAvisoSanFernando(avisoSF(Number.NaN, "08:30")), []);
});

test("si el SHN estima 2.60m a las 08:30, el plan pasa de 'normal' a 'no ir' y lo explica", () => {
  const pronos = diaART("2026-08-21", INA_NORMAL);
  const sin = calcularVeredicto(pronos, "2026-08-21", 2.25, []);
  assert.equal(sin.estado, "normal");
  const con = calcularVeredicto(pronos, "2026-08-21", 2.25, [], { shnAviso: puntosAvisoSanFernando(avisoSF(2.6, "08:30")) });
  assert.equal(con.estado, "no_clases");
  assert.ok(con.entrada.efectivo_m != null && Math.abs(con.entrada.efectivo_m - 2.6) < 1e-9);
  assert.equal(con.entrada.fuente, "aviso");
  assert.match(con.explicacion, /Se toma 2\.60m del aviso oficial del SHN \(San Fernando 2\.60m a las 08:30\)/);
});

test("el aviso del SHN también cuenta en el modo 'suave' (es la fuente oficial)", () => {
  const pronos = diaART("2026-08-21", INA_NORMAL);
  const v = calcularVeredicto(pronos, "2026-08-21", 2.25, [], { shnAviso: puntosAvisoSanFernando(avisoSF(2.6, "08:30")) }, "suave");
  assert.equal(v.estado, "no_clases");
  assert.equal(v.entrada.fuente, "aviso");
});

test("aviso a las 14:00 con 2.50m: se entra normal pero a la vuelta no => salida temprana, con hora límite", () => {
  const pronos = diaART("2026-08-21", INA_NORMAL);
  const v = calcularVeredicto(pronos, "2026-08-21", 2.25, [], { shnAviso: puntosAvisoSanFernando(avisoSF(2.5, "14:00")) });
  assert.equal(v.estado, "salida_temprana");
  assert.equal(v.vuelta.fuente, "aviso");
  assert.ok(v.salidaLimiteMin != null && v.salidaLimiteMin >= 12 * 60 && v.salidaLimiteMin <= 14 * 60, `${v.salidaLimiteMin}`);
});

test("un aviso lejos de las 8:00 y de las 14:15 no cambia entrada ni vuelta", () => {
  const pronos = diaART("2026-08-21", INA_NORMAL);
  const v = calcularVeredicto(pronos, "2026-08-21", 2.25, [], { shnAviso: puntosAvisoSanFernando(avisoSF(2.6, "11:30")) });
  assert.equal(v.estado, "normal");
  assert.notEqual(v.entrada.fuente, "aviso");
  assert.notEqual(v.vuelta.fuente, "aviso");
});

test("un aviso de OTRO día no afecta a este día", () => {
  const pronos = diaART("2026-08-21", INA_NORMAL);
  const v = calcularVeredicto(pronos, "2026-08-21", 2.25, [], { shnAviso: puntosAvisoSanFernando(avisoSF(2.6, "08:30", "22/08/2026")) });
  assert.equal(v.estado, "normal");
});

test("el SHN MANDA aunque dé menos que el INA (si el INA no es más nuevo), y se deja el 'ojito'", () => {
  const pronos = diaART("2026-08-21", { 8: 2.4, 9: 2.4, 12: 2.0, 14: 2.0, 15: 2.0 });
  const sinAviso = calcularVeredicto(pronos, "2026-08-21", 2.25, []);
  assert.equal(sinAviso.estado, "no_clases"); // solo con el INA sería 'no ir'
  const v = calcularVeredicto(pronos, "2026-08-21", 2.25, [], {
    shnAviso: puntosAvisoSanFernando(avisoEmitido(2.1, "08:30")),
    inaIngestadoMs: INA_MAS_VIEJO,
  });
  assert.ok(v.entrada.efectivo_m != null && Math.abs(v.entrada.efectivo_m - 2.1) < 1e-9, `${v.entrada.efectivo_m}`);
  assert.equal(v.entrada.fuente, "aviso");
  assert.equal(v.estado, "normal");
  assert.ok(v.ina_difiere != null && Math.abs(v.ina_difiere.main_m - 2.4) < 1e-9 && v.ina_difiere.lado === "sobre");
  assert.match(v.explicacion, /👁️ El INA dice otra cosa: pronostica 2\.40m a las 08:00, sobre el límite \(2\.25m\)\./);
});

test("el caso del viernes 9: INA 2.31m a las 8:00, SHN 2.20m a las 7:00 => 'normal' con el ojito del INA", () => {
  const pronos = diaART("2026-10-09", { 6: 2.29, 7: 2.34, 8: 2.31, 9: 2.22, 12: 1.66, 14: 1.4, 15: 1.47 });
  const aviso = { tipo: "aviso_crecida", alturas: [{ puerto: "SAN FERNANDO", altura_m: 2.2, hora: "07:00", fecha: "09/10/2026" }] };
  const sin = calcularVeredicto(pronos, "2026-10-09", 2.25, []);
  assert.equal(sin.estado, "no_clases"); // solo con el INA: 2.31m > 2.25m
  const v = calcularVeredicto(pronos, "2026-10-09", 2.25, [], { shnAviso: puntosAvisoSanFernando(aviso) });
  assert.equal(v.estado, "normal");
  assert.ok(v.entrada.efectivo_m != null && Math.abs(v.entrada.efectivo_m - 2.2) < 1e-9);
  assert.ok(v.hora7.efectivo_m != null && Math.abs(v.hora7.efectivo_m - 2.2) < 1e-9);
  assert.equal(v.salidaLimiteMin, null);
  assert.ok(v.ina_difiere != null && Math.abs(v.ina_difiere.main_m - 2.31) < 1e-9);
  assert.equal(v.ina_difiere!.hora, 480);
  assert.equal(v.ina_difiere!.lado, "sobre");
  assert.match(v.explicacion, /Se toma el aviso oficial del SHN \(San Fernando 2\.20m a las 07:00\)\. 👁️ El INA dice otra cosa: pronostica 2\.31m a las 08:00, sobre el límite \(2\.25m\)\./);
});

test("si el SHN y el INA quedan del mismo lado del límite no hay ojito", () => {
  const pronos = diaART("2026-08-21", INA_NORMAL); // INA 2.00m
  const v = calcularVeredicto(pronos, "2026-08-21", 2.25, [], { shnAviso: puntosAvisoSanFernando(avisoSF(2.1, "08:30")) });
  assert.equal(v.estado, "normal");
  assert.equal(v.entrada.fuente, "aviso");
  assert.equal(v.ina_difiere, null);
  assert.doesNotMatch(v.explicacion, /👁/);
});

test("lo que se está MIDIENDO en esas horas no se ignora: si supera al aviso del SHN, gana", () => {
  const pronos = diaART("2026-08-21", { 6: 2.0, 7: 2.0, 8: 2.0, 9: 2.0, 12: 2.0, 14: 2.0, 15: 2.0 });
  const obs = [
    { timestamp: "2026-08-21T09:15:00Z", nivel_m: 2.3 }, // 06:15 ART
    { timestamp: "2026-08-21T10:15:00Z", nivel_m: 2.35 }, // 07:15 ART
  ];
  const v = calcularVeredicto(pronos, "2026-08-21", 2.25, [], { shnObservado: obs, shnAviso: puntosAvisoSanFernando(avisoSF(2.2, "07:00")) });
  assert.ok(v.entrada.efectivo_m != null && Math.abs(v.entrada.efectivo_m - 2.35) < 1e-9, `${v.entrada.efectivo_m}`);
  assert.equal(v.entrada.fuente, "medido");
  assert.equal(v.estado, "no_clases");
  assert.match(v.explicacion, /Se toma 2\.35m: lo que se está midiendo ahora supera al aviso oficial del SHN \(San Fernando 2\.20m a las 07:00\)/);
});

test("una medición de otro día no pisa al aviso del SHN", () => {
  const pronos = diaART("2026-08-21", INA_NORMAL);
  const obs = [{ timestamp: "2026-08-20T13:00:00Z", nivel_m: 2.9 }];
  const v = calcularVeredicto(pronos, "2026-08-21", 2.25, [], { shnObservado: obs, shnAviso: puntosAvisoSanFernando(avisoSF(2.2, "08:00")) });
  // En la hora de entrada manda el aviso (2.20m), no una medición de ayer (2.90m).
  assert.equal(v.entrada.fuente, "aviso");
  assert.ok(v.entrada.efectivo_m != null && Math.abs(v.entrada.efectivo_m - 2.2) < 1e-9, `${v.entrada.efectivo_m}`);
});

test("dentro de la ventana del aviso, los picos del INA ya no fuerzan una hora límite de salida", () => {
  const pronos = diaART("2026-08-21", { 8: 2.0, 9: 2.0, 12: 2.4, 14: 2.0, 15: 2.0 });
  const sinAviso = calcularVeredicto(pronos, "2026-08-21", 2.25, []);
  assert.ok(sinAviso.salidaLimiteMin != null, "con solo el INA, el agua cruza el límite al mediodía");
  const conAviso = calcularVeredicto(pronos, "2026-08-21", 2.25, [], {
    shnAviso: puntosAvisoSanFernando(avisoEmitido(2.1, "12:30")),
    inaIngestadoMs: INA_MAS_VIEJO,
  });
  assert.equal(conAviso.salidaLimiteMin, null);
});

// ── Salvaguarda: si el INA es más nuevo y mucho más alto, el aviso del SHN quedó atrás ───────
test("HOY: INA 2.56m (cargado a las 18:20) vs aviso SHN 2.20m (emitido a las 12:20) => manda el INA y se avisa", () => {
  const pronos = diaART("2026-10-09", { 6: 2.54, 7: 2.56, 8: 2.51, 9: 2.41, 12: 1.7, 14: 1.4, 15: 1.47 });
  const aviso = {
    tipo: "aviso_crecida",
    emitido: "2026-10-08T15:20:00+00:00", // 12:20 ART
    alturas: [{ puerto: "SAN FERNANDO", altura_m: 2.2, hora: "07:00", fecha: "09/10/2026" }],
  };
  const v = calcularVeredicto(pronos, "2026-10-09", 2.25, [], {
    shnAviso: puntosAvisoSanFernando(aviso),
    inaIngestadoMs: Date.parse("2026-10-08T21:20:00Z"), // 18:20 ART
  });
  assert.equal(v.estado, "no_clases");
  assert.ok(v.entrada.efectivo_m != null && Math.abs(v.entrada.efectivo_m - 2.51) < 1e-9, `${v.entrada.efectivo_m}`);
  assert.equal(v.entrada.fuente, "ina");
  assert.ok(v.entrada.aviso_descartado != null && Math.abs(v.entrada.aviso_descartado.altura_m - 2.2) < 1e-9);
  assert.equal(v.ina_difiere, null);
  assert.match(
    v.explicacion,
    /Ojo: el aviso del SHN \(San Fernando 2\.20m a las 07:00, emitido a las 12:20\) es más viejo y queda 31 cm por debajo del INA: se toma el INA hasta que el SHN actualice\./
  );
});

test("con la diferencia de la mañana (14 cm) el SHN sigue mandando, aunque el INA sea más nuevo", () => {
  const pronos = diaART("2026-10-09", { 6: 2.29, 7: 2.34, 8: 2.31, 9: 2.22, 12: 1.66, 14: 1.4, 15: 1.47 });
  const aviso = { tipo: "aviso_crecida", emitido: "2026-10-08T15:20:00+00:00", alturas: [{ puerto: "SAN FERNANDO", altura_m: 2.2, hora: "07:00", fecha: "09/10/2026" }] };
  const v = calcularVeredicto(pronos, "2026-10-09", 2.25, [], { shnAviso: puntosAvisoSanFernando(aviso), inaIngestadoMs: Date.parse("2026-10-08T21:20:00Z") });
  assert.equal(v.estado, "normal");
  assert.equal(v.entrada.fuente, "aviso");
  assert.equal(v.entrada.aviso_descartado, null);
});

test("justo por encima del margen (16 cm) se descarta; justo por debajo (14 cm) no", () => {
  const mk = (ina7: number) => diaART("2026-08-21", { 7: ina7, 8: ina7, 9: ina7, 12: 2.0, 14: 2.0, 15: 2.0 });
  const f = (ina7: number) =>
    calcularVeredicto(mk(ina7), "2026-08-21", 2.25, [], { shnAviso: puntosAvisoSanFernando(avisoEmitido(2.2, "07:00")), inaIngestadoMs: INA_MAS_NUEVO });
  assert.equal(f(2.34).entrada.fuente, "aviso"); // +0.14
  assert.equal(f(2.36).entrada.fuente, "ina"); // +0.16
});

test("si el INA es mucho más alto pero MÁS VIEJO que el aviso, sigue mandando el SHN", () => {
  const pronos = diaART("2026-08-21", { 7: 2.6, 8: 2.6, 9: 2.6, 12: 2.0, 14: 2.0, 15: 2.0 });
  const v = calcularVeredicto(pronos, "2026-08-21", 2.25, [], { shnAviso: puntosAvisoSanFernando(avisoEmitido(2.2, "07:00")), inaIngestadoMs: INA_MAS_VIEJO });
  assert.equal(v.entrada.fuente, "aviso");
  assert.equal(v.estado, "normal");
});

test("si no se sabe cuál es más nuevo, se asume que el INA (lado seguro)", () => {
  const pronos = diaART("2026-08-21", { 7: 2.6, 8: 2.6, 9: 2.6, 12: 2.0, 14: 2.0, 15: 2.0 });
  const sinFrescura = calcularVeredicto(pronos, "2026-08-21", 2.25, [], { shnAviso: puntosAvisoSanFernando(avisoSF(2.2, "07:00")) });
  assert.equal(sinFrescura.entrada.fuente, "ina");
  assert.equal(sinFrescura.estado, "no_clases");
});

test("la salvaguarda solo protege contra un INA más ALTO: un INA más bajo que el aviso no la activa", () => {
  const pronos = diaART("2026-08-21", { 7: 1.8, 8: 1.8, 9: 1.8, 12: 1.8, 14: 1.8, 15: 1.8 });
  const v = calcularVeredicto(pronos, "2026-08-21", 2.25, [], { shnAviso: puntosAvisoSanFernando(avisoEmitido(2.6, "07:00")), inaIngestadoMs: INA_MAS_NUEVO });
  assert.equal(v.entrada.fuente, "aviso");
  assert.equal(v.estado, "no_clases");
});

test("puntosAvisoSanFernando lleva la hora de emisión del aviso", () => {
  const p = puntosAvisoSanFernando(avisoEmitido(2.2, "07:00"));
  assert.equal(p[0].emitidoMs, Date.parse("2026-08-21T10:00:00Z"));
});
