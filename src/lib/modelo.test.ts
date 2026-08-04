import { test } from "node:test";
import assert from "node:assert/strict";
import { ajustarArmonico, regresarViento, proyectarCurva, type PuntoViento } from "./modelo.ts";
import type { Punto } from "./ciclo.ts";

const H = 3600000;
const T0 = new Date("2026-07-20T00:00:00Z").getTime();

// Genera una serie sintética con M2 + S2 + residuo meteorológico (sudestada).
function serieSintetica(dias: number, baseSE: number, pendiente: number): { pts: Punto[]; ventos: PuntoViento[] } {
  const pts: Punto[] = [];
  const ventos: PuntoViento[] = [];
  const pasos = dias * 48; // cada 30 min
  const A_M2 = 0.5;
  const A_S2 = 0.15;
  const wM2 = (2 * Math.PI) / 12.4206;
  const wS2 = (2 * Math.PI) / 12.0;

  // Viento: SE sostenido con episodios de sudestada que varían en el tiempo
  for (let i = 0; i < dias * 8; i++) {
    const ts = T0 + i * 3 * H;
    const velocidad = Math.max(5, baseSE + Math.sin(i / 8) * 12);
    const direccion = 135 + Math.sin(i / 5) * 30;
    ventos.push({ timestamp: ts, velocidad_kmh: velocidad, direccion_grados: direccion });
  }
  const compSE = (ts: number): number => {
    const i = Math.round((ts - T0) / (3 * H));
    const v = ventos[Math.max(0, Math.min(i, ventos.length - 1))];
    const rad = ((v.direccion_grados - 135) * Math.PI) / 180;
    return v.velocidad_kmh * Math.cos(rad);
  };

  for (let i = 0; i < pasos; i++) {
    const ts = T0 + i * 30 * 60000;
    const th = ts / H;
    const arm = A_M2 * Math.sin(wM2 * th + 0.5) + A_S2 * Math.sin(wS2 * th + 1.0);
    pts.push({ timestamp: new Date(ts).toISOString(), nivel_m: arm + pendiente * compSE(ts) });
  }
  return { pts, ventos };
}

test("ajuste armónico: recupera amplitud M2 en serie sintética sin viento", () => {
  const { pts } = serieSintetica(6, 0, 0);
  const ajuste = ajustarArmonico(pts);
  assert.ok(ajuste);
  const m2 = ajuste!.componentes.find((c) => c.periodo_h === 12.4206);
  assert.ok(m2);
  assert.ok(Math.abs(m2!.amplitud_m - 0.5) < 0.1, `A_M2=${m2!.amplitud_m}`);
  assert.ok(Math.abs(ajuste!.sigma_m) < 0.05, `sigma=${ajuste!.sigma_m}`);
});

test("regresión de viento: recupera pendiente del residuo meteorológico", () => {
  const pendiente = 0.04; // m por km/h de componente SE
  const { pts, ventos } = serieSintetica(6, 30, pendiente);
  const ajuste = ajustarArmonico(pts);
  assert.ok(ajuste);
  const reg = regresarViento(pts, ajuste!, ventos);
  assert.ok(reg, "debería ajustar regresión");
  // El lag 0 predomina; la pendiente debe estar cerca de la usada
  const reg0 = reg!;
  assert.ok(Math.abs(reg0.pendiente_m_por_kmh - pendiente) < 0.015, `pendiente=${reg0.pendiente_m_por_kmh}`);
  assert.ok(reg0.r2 > 0.2, `r2=${reg0.r2}`);
});

test("proyección: genera puntos futuros con banda y extremos en horizonte", () => {
  const { pts, ventos } = serieSintetica(6, 0, 0);
  const ahora = T0 + 5 * 24 * H;
  const proy = proyectarCurva(pts, ventos, ahora, 48);
  assert.ok(proy.puntos.length > 20, `puntos=${proy.puntos.length}`);
  assert.equal(proy.puntos.length, proy.bandaSuperior.length);
  assert.equal(proy.bandaSuperior.length, proy.bandaInferior.length);
  // el último punto cae dentro del horizonte
  const ultimo = proy.puntos[proy.puntos.length - 1];
  assert.ok(ultimo.timestamp > ahora + 47 * H && ultimo.timestamp <= ahora + 49 * H);
  // extremos del mismo tipo a ~12.4h de distancia (semidiurno)
  assert.ok(proy.extremos.length >= 4, `extremos=${proy.extremos.length}`);
  const pleamares = proy.extremos.filter((e) => e.tipo === "pleamar");
  assert.ok(pleamares.length >= 2, `pleamares=${pleamares.length}`);
  const gapHs = (pleamares[1].timestamp - pleamares[0].timestamp) / H;
  assert.ok(Math.abs(gapHs - 12.4) < 1.5, `gap=${gapHs}`);
});

test("proyección: banda superior siempre >= puntos >= banda inferior", () => {
  const { pts, ventos } = serieSintetica(6, 0, 0);
  const proy = proyectarCurva(pts, ventos, T0 + 5 * 24 * H, 24);
  for (let i = 0; i < proy.puntos.length; i++) {
    assert.ok(proy.bandaSuperior[i].nivel_m >= proy.puntos[i].nivel_m - 1e-9);
    assert.ok(proy.bandaInferior[i].nivel_m <= proy.puntos[i].nivel_m + 1e-9);
  }
});

test("proyección con viento: curva se desplaza con el residuo meteorológico", () => {
  const pendiente = 0.04;
  const { pts, ventos } = serieSintetica(6, 25, pendiente);
  const ahora = T0 + 5 * 24 * H;
  const proy = proyectarCurva(pts, ventos, ahora, 24);
  assert.ok(proy.regresion, "debería detectar forzante de viento");
  // El nivel proyectado debe desviarse de la marea pura por el efecto sudestada
  const mediaCurva = proy.puntos.reduce((s, p) => s + p.nivel_m, 0) / proy.puntos.length;
  assert.ok(mediaCurva > 0.4, `mediaCurva=${mediaCurva.toFixed(3)} (sudestada eleva el nivel)`);
});

test("sin datos suficientes => ajuste nulo y proyección vacía", () => {
  const pts: Punto[] = [];
  const proy = proyectarCurva(pts, [], Date.now(), 24);
  assert.equal(proy.ajuste, null);
  assert.equal(proy.puntos.length, 0);
  assert.equal(proy.extremos.length, 0);
});
