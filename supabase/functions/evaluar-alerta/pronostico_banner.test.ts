import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirEscaladaPronostico, etiquetaDiaPlan } from "./pronostico_banner.ts";
import { calcularVeredicto, type PuntoProno, type VeredictoDia } from "./plan_escolar.ts";

// Miércoles 7-oct-2026 10:00 ART (13:00 UTC) — el día del reporte de la escuela.
const AHORA = Date.parse("2026-10-07T13:00:00Z");
const SEGURO = 2.25;
const UMBRAL_PRONO = 2.1;

// ART = UTC-3
const art = (dia: number, hora: number, min = 0) =>
  new Date(Date.UTC(2026, 9, dia, hora + 3, min)).toISOString();

function v(fecha: string, estado: VeredictoDia["estado"], esDia = true, motivo = "motivo de prueba"): VeredictoDia {
  return { fecha, esDiaEscolar: esDia, estado, motivo } as VeredictoDia;
}

// Plan "normal" para jue 8 y vie 9; sábado y domingo sin clases.
const VEREDICTOS_NORMALES = [
  v("2026-10-07", "normal"),
  v("2026-10-08", "normal"),
  v("2026-10-09", "normal"),
  v("2026-10-10", "normal", false),
];

// Pronóstico del caso real: vie 9 08:00 = 2.16m, sáb 10 07:00 = 2.21m (pico).
const PRONOS_REAL = [
  { timestamp: art(8, 8), valor_m: 1.9 },
  { timestamp: art(9, 8), valor_m: 2.16 },
  { timestamp: art(9, 14), valor_m: 2.0 },
  { timestamp: art(10, 7), valor_m: 2.21 },
];
const PICO_REAL = PRONOS_REAL[3];

function base(over: Partial<Parameters<typeof decidirEscaladaPronostico>[0]> = {}) {
  return {
    alerta: "verde",
    veredictos: VEREDICTOS_NORMALES,
    pronosMain: PRONOS_REAL,
    picoProno: PICO_REAL,
    umbralProno: UMBRAL_PRONO,
    nivelSeguroM: SEGURO,
    diasSinClases: [] as string[],
    ahoraMs: AHORA,
    ...over,
  };
}

test("caso real 7-oct: pico 2.21 el sábado + 2.16 el viernes en clases => AMARILLA, nunca roja", () => {
  const r = decidirEscaladaPronostico(base());
  assert.equal(r.nivel, "amarilla");
  assert.equal(r.diaAfectado, null);
  assert.equal(r.sobreUmbral, true);
  assert.match(r.mensaje!, /sáb 10/);
  assert.match(r.mensaje!, /2\.21m/);
  assert.match(r.mensaje!, /ese día no hay clases/);
  // Aclara qué pasa dentro del horario escolar: el viernes 08:00, 2.16m, bajo el nivel seguro.
  assert.match(r.mensaje!, /En horario escolar lo más alto es 2\.16m \(vie 9, 08:00[\s\u202f]*a\.[\s\u202f]*m\.\)/);
  assert.match(r.mensaje!, /bajo el nivel seguro de 2\.25m: las clases no se ven afectadas/);
  assert.doesNotMatch(r.mensaje!, /Preparar salida/);
});

test("el aviso no se recorta por distancia: pico a 3 días igual avisa", () => {
  const lejos = [{ timestamp: art(10, 7), valor_m: 2.21 }];
  const r = decidirEscaladaPronostico(base({ pronosMain: lejos, picoProno: lejos[0] }));
  assert.equal(r.nivel, "amarilla");
});

test("viernes con plan 'no ir' => ROJA con el día en el título y el motivo del plan", () => {
  const veredictos = [
    v("2026-10-07", "normal"),
    v("2026-10-08", "normal"),
    v("2026-10-09", "no_clases", true, "A las 8 el agua estaría en 2.31m — sobre el nivel seguro (2.25m): NO se puede cruzar en lancha."),
    v("2026-10-10", "normal", false),
  ];
  const r = decidirEscaladaPronostico(base({ veredictos }));
  assert.equal(r.nivel, "roja");
  assert.equal(r.diaAfectado, "2026-10-09");
  assert.match(r.mensaje!, /^Alerta — vie 9: no se podría ir a la escuela\. A las 8 el agua estaría en 2\.31m/);
});

test("salida temprana mañana => ROJA diciendo 'mañana'", () => {
  const veredictos = [
    v("2026-10-07", "normal"),
    v("2026-10-08", "salida_temprana", true, "Se puede entrar a las 8, pero hay que irse antes de las 12:40"),
  ];
  const r = decidirEscaladaPronostico(base({ veredictos }));
  assert.equal(r.nivel, "roja");
  assert.match(r.mensaje!, /^Alerta — mañana: salida temprana\./);
  assert.match(r.mensaje!, /antes de las 12:40\./); // agrega el punto final faltante
});

test("varios días afectados: titula el primero y menciona los otros", () => {
  const veredictos = [
    v("2026-10-08", "salida_temprana"),
    v("2026-10-09", "no_clases"),
  ];
  const r = decidirEscaladaPronostico(base({ veredictos }));
  assert.equal(r.diaAfectado, "2026-10-08");
  assert.match(r.mensaje!, /También: vie 9 no ir\./);
});

test("hoy afectado pero ya pasó la vuelta (14:15) => se ignora ese día", () => {
  const tarde = Date.parse("2026-10-07T18:30:00Z"); // 15:30 ART
  const veredictos = [v("2026-10-07", "salida_temprana"), v("2026-10-08", "normal")];
  const r = decidirEscaladaPronostico(base({ veredictos, ahoraMs: tarde }));
  assert.notEqual(r.nivel, "roja");
});

test("hoy afectado y todavía hay clases => ROJA 'hoy'", () => {
  const veredictos = [v("2026-10-07", "no_clases"), v("2026-10-08", "normal")];
  const r = decidirEscaladaPronostico(base({ veredictos }));
  assert.equal(r.nivel, "roja");
  assert.match(r.mensaje!, /^Alerta — hoy:/);
});

test("un día afectado que NO es de clases (fin de semana) no dispara rojo", () => {
  const veredictos = [v("2026-10-10", "no_clases", false)];
  const r = decidirEscaladaPronostico(base({ veredictos }));
  assert.notEqual(r.nivel, "roja");
});

test("si el estado actual ya es rojo/evacuación/bajante no se toca", () => {
  for (const alerta of ["roja", "evacuacion", "azul"]) {
    const r = decidirEscaladaPronostico(base({ alerta }));
    assert.equal(r.nivel, null);
    assert.equal(r.sobreUmbral, false);
  }
});

test("estado amarillo por nivel actual: puede subir a rojo por el plan, pero no se reemplaza por amarillo", () => {
  const r1 = decidirEscaladaPronostico(base({ alerta: "amarilla" }));
  assert.equal(r1.nivel, null); // pico lejano fuera de clases: queda su mensaje propio
  const r2 = decidirEscaladaPronostico(
    base({ alerta: "amarilla", veredictos: [v("2026-10-09", "no_clases")] })
  );
  assert.equal(r2.nivel, "roja");
});

test("pronóstico bajo el umbral y plan normal => nada", () => {
  const bajo = [{ timestamp: art(9, 8), valor_m: 1.9 }];
  const r = decidirEscaladaPronostico(base({ pronosMain: bajo, picoProno: bajo[0] }));
  assert.equal(r.nivel, null);
  assert.equal(r.sobreUmbral, false);
});

test("pico dentro del horario escolar y bajo el nivel seguro => lo dice", () => {
  const p = [{ timestamp: art(9, 9), valor_m: 2.16 }];
  const r = decidirEscaladaPronostico(base({ pronosMain: p, picoProno: p[0] }));
  assert.equal(r.nivel, "amarilla");
  assert.match(r.mensaje!, /en horario escolar, bajo el nivel seguro de 2\.25m: las clases no se ven afectadas/);
  assert.doesNotMatch(r.mensaje!, /En horario escolar lo más alto/); // no repite
});

test("pico de noche en día de clases => 'fuera del horario escolar'", () => {
  const p = [{ timestamp: art(8, 22), valor_m: 2.18 }];
  const r = decidirEscaladaPronostico(base({ pronosMain: p, picoProno: p[0] }));
  assert.match(r.mensaje!, /fuera del horario escolar/);
});

test("un feriado cargado en dias_sin_clases cuenta como sin clases", () => {
  const p = [{ timestamp: art(9, 8), valor_m: 2.16 }];
  const r = decidirEscaladaPronostico(base({ pronosMain: p, picoProno: p[0], diasSinClases: ["2026-10-09"] }));
  assert.match(r.mensaje!, /ese día no hay clases/);
});

test("etiquetaDiaPlan: hoy / mañana / día de la semana", () => {
  assert.equal(etiquetaDiaPlan("2026-10-07", AHORA), "hoy");
  assert.equal(etiquetaDiaPlan("2026-10-08", AHORA), "mañana");
  assert.equal(etiquetaDiaPlan("2026-10-09", AHORA), "vie 9");
  assert.equal(etiquetaDiaPlan("2026-10-10", AHORA), "sáb 10");
});

// ── Integración con el cálculo real del plan (no con veredictos inventados) ──────────
// Construye un pronóstico INA realista (cada 30 min) y deja que calcularVeredicto decida.
function serieProno(puntos: { t: string; v: number }[]): PuntoProno[] {
  return puntos.map((p) => ({ timestamp: p.t, valor_m: p.v, qualifier: "main" }));
}

test("integración: con el pronóstico del caso real el plan da 'normal' y el banner NO es rojo", () => {
  const pronos = serieProno([
    { t: art(7, 12), v: 1.95 },
    { t: art(8, 8), v: 1.95 },
    { t: art(8, 14, 15), v: 1.9 },
    { t: art(9, 8), v: 2.16 },
    { t: art(9, 14, 15), v: 2.05 },
    { t: art(10, 7), v: 2.21 },
  ]);
  const fechas = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"];
  const veredictos = fechas.map((f) => calcularVeredicto(pronos, f, SEGURO, []));
  const viernes = veredictos[2];
  assert.equal(viernes.estado, "normal", `viernes: ${viernes.estado} — ${viernes.motivo}`);

  const mains = pronos.map((p) => ({ timestamp: p.timestamp, valor_m: p.valor_m }));
  const pico = mains.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), mains[0]);
  const r = decidirEscaladaPronostico(base({ veredictos, pronosMain: mains, picoProno: pico }));
  assert.equal(r.nivel, "amarilla");
});

test("integración: viernes 08:00 a 2.40m => el plan da 'no_clases' y el banner pasa a rojo con ese día", () => {
  const pronos = serieProno([
    { t: art(8, 8), v: 2.0 },
    { t: art(9, 7), v: 2.35 },
    { t: art(9, 8), v: 2.4 },
    { t: art(9, 14, 15), v: 2.38 },
  ]);
  const fechas = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"];
  const veredictos = fechas.map((f) => calcularVeredicto(pronos, f, SEGURO, []));
  assert.equal(veredictos[2].estado, "no_clases");
  const mains = pronos.map((p) => ({ timestamp: p.timestamp, valor_m: p.valor_m }));
  const pico = mains.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), mains[0]);
  const r = decidirEscaladaPronostico(base({ veredictos, pronosMain: mains, picoProno: pico }));
  assert.equal(r.nivel, "roja");
  assert.equal(r.diaAfectado, "2026-10-09");
  assert.match(r.mensaje!, /^Alerta — vie 9: no se podría ir a la escuela/);
});
