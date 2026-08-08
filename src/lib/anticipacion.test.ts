import { test } from "node:test";
import assert from "node:assert/strict";
import { anticiparBajada } from "./anticipacion.ts";
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
