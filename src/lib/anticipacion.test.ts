import { test } from "node:test";
import assert from "node:assert/strict";
import { anticiparBajada, anticiparSubida } from "./anticipacion.ts";
import type { Punto } from "./ciclo.ts";

// Genera una serie realista: subida suave, pico en picoHora, y bajada constante
// hasta ahoraHora (delta m/h). Las lecturas nunca superan `ahora`.
function serie(picoHora: number, picoNivel: number, ahoraHora: number, delta = 0.15): Punto[] {
  const pts: Punto[] = [];
  for (let i = 18; i >= 1; i--) {
    pts.push({ timestamp: new Date(2026, 7, 7, picoHora - i).toISOString(), nivel_m: picoNivel - i * delta * 0.4 });
  }
  pts.push({ timestamp: new Date(2026, 7, 7, picoHora).toISOString(), nivel_m: picoNivel });
  for (let h = picoHora + 1; h <= ahoraHora; h++) {
    pts.push({ timestamp: new Date(2026, 7, 7, h).toISOString(), nivel_m: picoNivel - (h - picoHora) * delta });
  }
  return pts;
}

test("exteriores girando => giraron true y cruce estimado", () => {
  // La Plata: pico 09 (2.33) bajando; Oyarvide/Atalaya: pico 08; Bs. Aires: pico 11.
  // SF: pico 11 (2.45) recién iniciando bajada a las 12 — aún por encima de 2.25.
  const lp = serie(9, 2.33, 12);
  const oyarvide = serie(8, 2.42, 12);
  const atalaya = serie(8, 2.38, 12);
  const ba = serie(11, 2.29, 12);
  const sf = serie(11, 2.45, 12);

  const r = anticiparBajada(
    [
      { nombre: "La Plata", lecturas: lp },
      { nombre: "Oyarvide", lecturas: oyarvide },
      { nombre: "Atalaya", lecturas: atalaya },
      { nombre: "Puerto de Buenos Aires", lecturas: ba },
    ],
    sf,
    2.25,
    new Date(2026, 7, 7, 12).getTime()
  );

  assert.equal(r.giraron, true);
  assert.equal(r.metodo, "exterior");
  assert.ok(r.sfPicoTs != null, "sfPicoTs estimado");
  assert.ok(r.sfCruceSeguroTs != null, "sfCruceSeguroTs estimado");
  // El pico de SF estimado debe caer cerca de las 11-13 local.
  const picoH = new Date(r.sfPicoTs).getHours() + new Date(r.sfPicoTs).getMinutes() / 60;
  assert.ok(picoH >= 10 && picoH <= 14, `sfPico=${picoH}h`);
  // El cruce a 2.25m debe caer después del pico estimado.
  assert.ok(r.sfCruceSeguroTs! >= r.sfPicoTs!, "cruce posterior al pico");
});

test("ninguna exterior giró => giraron false", () => {
  const subiendo = (): Punto[] => {
    const pts: Punto[] = [];
    for (let i = 0; i < 22; i++) {
      pts.push({ timestamp: new Date(2026, 7, 7, 2 + i * 0.5).toISOString(), nivel_m: 0.5 + i * 0.08 });
    }
    return pts;
  };
  const r = anticiparBajada(
    [
      { nombre: "La Plata", lecturas: subiendo() },
      { nombre: "Oyarvide", lecturas: subiendo() },
      { nombre: "Atalaya", lecturas: subiendo() },
      { nombre: "Puerto de Buenos Aires", lecturas: subiendo() },
    ],
    subiendo(),
    2.25,
    new Date(2026, 7, 7, 13).getTime()
  );
  assert.equal(r.giraron, false);
});

test("SF ya bajando por debajo del nivel seguro => metodo sf", () => {
  const bajandoSF = (): Punto[] => {
    const pts: Punto[] = [];
    for (let i = 0; i < 22; i++) {
      pts.push({ timestamp: new Date(2026, 7, 7, 8 + i * 0.5).toISOString(), nivel_m: 2.6 - i * 0.05 });
    }
    return pts;
  };
  const r = anticiparBajada([], bajandoSF(), 2.25, new Date(2026, 7, 7, 20).getTime());
  assert.equal(r.giraron, false);
  assert.equal(r.metodo, "sf");
});

test("sin datos suficientes => sin señal", () => {
  const r = anticiparBajada([], [], 2.25, Date.now());
  assert.equal(r.giraron, false);
  assert.equal(r.metodo, null);
});

test("SF subiendo y pico por debajo del nivel seguro => sin cruce falso", () => {
  // SF subiendo (aún no pasó su pico), exteriores girando: la anticipación se activa,
  // pero si el pico predicho de SF queda por debajo del nivel seguro no debe
  // proyectarse un cruce absurdo del nivel seguro en el pasado.
  const lp = serie(9, 2.2, 12);
  const oyarvide = serie(8, 2.3, 12);
  const atalaya = serie(8, 2.28, 12);
  const ba = serie(11, 2.18, 12);
  // SF subiendo desde ~1.2m, aún sin pico a la hora `ahora`.
  const sfSubiendo: Punto[] = [];
  for (let i = 0; i < 21; i++) {
    const h = 1 + i * 0.5;
    sfSubiendo.push({ timestamp: new Date(2026, 7, 7, h).toISOString(), nivel_m: 1.2 + (2.1 - 1.2) * Math.min(i / 20, 1) });
  }

  const r = anticiparBajada(
    [
      { nombre: "La Plata", lecturas: lp },
      { nombre: "Oyarvide", lecturas: oyarvide },
      { nombre: "Atalaya", lecturas: atalaya },
      { nombre: "Puerto de Buenos Aires", lecturas: ba },
    ],
    sfSubiendo,
    2.25,
    new Date(2026, 7, 7, 12).getTime()
  );

  assert.equal(r.giraron, true);
  assert.equal(r.metodo, "exterior");
  assert.ok(r.sfPicoTs != null, "sfPicoTs estimado");
  // Nunca un cruce en el pasado: si se proyecta cruce, debe ser posterior al pico.
  if (r.sfCruceSeguroTs != null) {
    assert.ok(r.sfCruceSeguroTs >= r.sfPicoTs!, "cruce posterior al pico");
  }
});

// ── anticiparSubida (espejo de anticiparBajada, signos invertidos) ─────────

// Genera una serie realista: bajada suave, valle en valleHora, y subida constante
// hasta ahoraHora (delta m/h). Las lecturas nunca superan `ahora`. Espejo de serie().
function serieSubida(valleHora: number, valleNivel: number, ahoraHora: number, delta = 0.15): Punto[] {
  const pts: Punto[] = [];
  for (let i = 18; i >= 1; i--) {
    pts.push({ timestamp: new Date(2026, 7, 7, valleHora - i).toISOString(), nivel_m: valleNivel + i * delta * 0.4 });
  }
  pts.push({ timestamp: new Date(2026, 7, 7, valleHora).toISOString(), nivel_m: valleNivel });
  for (let h = valleHora + 1; h <= ahoraHora; h++) {
    pts.push({ timestamp: new Date(2026, 7, 7, h).toISOString(), nivel_m: valleNivel + (h - valleHora) * delta });
  }
  return pts;
}

test("exteriores girando al alza => giraron true y cruce estimado", () => {
  // La Plata: valle 09 (0.20) subiendo; Oyarvide/Atalaya: valle 08; Bs. Aires: valle 11.
  // SF: valle 11 (0.10) recién iniciando subida a las 12 — aún por debajo de 2.00.
  const lp = serieSubida(9, 0.20, 12);
  const oyarvide = serieSubida(8, 0.15, 12);
  const atalaya = serieSubida(8, 0.18, 12);
  const ba = serieSubida(11, 0.25, 12);
  const sf = serieSubida(11, 0.10, 12);

  const r = anticiparSubida(
    [
      { nombre: "La Plata", lecturas: lp },
      { nombre: "Oyarvide", lecturas: oyarvide },
      { nombre: "Atalaya", lecturas: atalaya },
      { nombre: "Puerto de Buenos Aires", lecturas: ba },
    ],
    sf,
    2.00,
    new Date(2026, 7, 7, 12).getTime()
  );

  assert.equal(r.giraron, true);
  assert.equal(r.metodo, "exterior");
  assert.ok(r.sfGiroTs != null, "sfGiroTs estimado");
  // El giro de SF estimado debe caer cerca de las 10-14 local.
  const giroH = new Date(r.sfGiroTs).getHours() + new Date(r.sfGiroTs).getMinutes() / 60;
  assert.ok(giroH >= 10 && giroH <= 14, `sfGiro=${giroH}h`);
});

test("ninguna exterior giró al alza => giraron false", () => {
  const bajando = (): Punto[] => {
    const pts: Punto[] = [];
    for (let i = 0; i < 22; i++) {
      pts.push({ timestamp: new Date(2026, 7, 7, 2 + i * 0.5).toISOString(), nivel_m: 2.5 - i * 0.08 });
    }
    return pts;
  };
  const r = anticiparSubida(
    [
      { nombre: "La Plata", lecturas: bajando() },
      { nombre: "Oyarvide", lecturas: bajando() },
      { nombre: "Atalaya", lecturas: bajando() },
      { nombre: "Puerto de Buenos Aires", lecturas: bajando() },
    ],
    bajando(),
    2.00,
    new Date(2026, 7, 7, 13).getTime()
  );
  assert.equal(r.giraron, false);
});

test("SF ya en zona de evaluación y subiendo => metodo sf", () => {
  const subiendoSF = (): Punto[] => {
    const pts: Punto[] = [];
    for (let i = 0; i < 22; i++) {
      pts.push({ timestamp: new Date(2026, 7, 7, 8 + i * 0.5).toISOString(), nivel_m: 1.7 + i * 0.05 });
    }
    return pts;
  };
  const r = anticiparSubida([], subiendoSF(), 2.00, new Date(2026, 7, 7, 20).getTime());
  assert.equal(r.giraron, false);
  assert.equal(r.metodo, "sf");
});

test("sin datos suficientes => sin señal (subida)", () => {
  const r = anticiparSubida([], [], 2.00, Date.now());
  assert.equal(r.giraron, false);
  assert.equal(r.metodo, null);
});

test("SF bajando y valle por encima del umbral de evaluación => sin cruce falso", () => {
  // SF bajando (aún no pasó su valle), exteriores girando al alza: la anticipación
  // se activa, pero si el nivel proyectado de SF en el giro queda por encima del
  // umbral de evaluación no debe proyectarse un cruce absurdo en el pasado.
  const lp = serieSubida(9, 2.05, 12);
  const oyarvide = serieSubida(8, 2.10, 12);
  const atalaya = serieSubida(8, 2.08, 12);
  const ba = serieSubida(11, 2.15, 12);
  // SF bajando desde ~2.9m, aún sin valle a la hora `ahora`.
  const sfBajando: Punto[] = [];
  for (let i = 0; i < 21; i++) {
    const h = 1 + i * 0.5;
    sfBajando.push({ timestamp: new Date(2026, 7, 7, h).toISOString(), nivel_m: 2.9 - (2.9 - 2.1) * Math.min(i / 20, 1) });
  }

  const r = anticiparSubida(
    [
      { nombre: "La Plata", lecturas: lp },
      { nombre: "Oyarvide", lecturas: oyarvide },
      { nombre: "Atalaya", lecturas: atalaya },
      { nombre: "Puerto de Buenos Aires", lecturas: ba },
    ],
    sfBajando,
    2.00,
    new Date(2026, 7, 7, 12).getTime()
  );

  assert.equal(r.giraron, true);
  assert.equal(r.metodo, "exterior");
  assert.ok(r.sfGiroTs != null, "sfGiroTs estimado");
  // Nunca un cruce en el pasado: si se proyecta cruce, debe ser posterior al giro.
  if (r.sfCruceEvalTs != null) {
    assert.ok(r.sfCruceEvalTs >= r.sfGiroTs!, "cruce posterior al giro");
  }
});
