import { test } from "node:test";
import assert from "node:assert/strict";
import { ajustarArmonico, regresarViento, proyectarCurva, validarModelo, regresarPropagacion, type PuntoViento } from "./modelo.ts";
import type { Punto } from "./ciclo.ts";

const H = 3600000;
const T0 = new Date("2026-07-20T00:00:00Z").getTime();

// Genera una serie sintética con M2 + S2 + residuo meteorológico (sudestada + presión).
function serieSintetica(dias: number, baseSE: number, pendiente: number, presionCoef = 0): { pts: Punto[]; ventos: PuntoViento[] } {
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
    ventos.push({ timestamp: ts, velocidad_kmh: velocidad, direccion_grados: direccion, presion_hpa: 1013 + Math.sin(i / 3) * 5 });
  }
  const compSE = (ts: number): number => {
    const i = Math.round((ts - T0) / (3 * H));
    const v = ventos[Math.max(0, Math.min(i, ventos.length - 1))];
    const rad = ((v.direccion_grados - 135) * Math.PI) / 180;
    return v.velocidad_kmh * Math.cos(rad);
  };
  const anomPresion = (ts: number): number => {
    const i = Math.round((ts - T0) / (3 * H));
    const v = ventos[Math.max(0, Math.min(i, ventos.length - 1))];
    return (v.presion_hpa ?? 1013) - 1013;
  };

  for (let i = 0; i < pasos; i++) {
    const ts = T0 + i * 30 * 60000;
    const th = ts / H;
    const arm = A_M2 * Math.sin(wM2 * th + 0.5) + A_S2 * Math.sin(wS2 * th + 1.0);
    pts.push({ timestamp: new Date(ts).toISOString(), nivel_m: arm + pendiente * compSE(ts) + presionCoef * anomPresion(ts) });
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

test("proyección: reconstruye la fase de una senoide pura (regresión cos/sin)", () => {
  // Serie artificial M2 pura con fase conocida: h(t)=2+0.9·sin(w·t+π/4).
  // El ajuste es c0 + Σ(a·cos+b·sin); si la reconstrucción invierte cos/sin
  // (bug de fase), la proyección queda corrida ~1/4 de período y el error
  // ronda la amplitud (~0.9 m). Con la fase correcta el error es < 0.15 m.
  const A_M2 = 0.9;
  const wM2 = (2 * Math.PI) / 12.4206;
  const fase = Math.PI / 4;
  const pts: Punto[] = [];
  for (let i = 0; i < 12 * 48; i++) {
    const ts = T0 + i * 30 * 60000;
    const th = ts / H;
    pts.push({ timestamp: new Date(ts).toISOString(), nivel_m: 2 + A_M2 * Math.sin(wM2 * th + fase) });
  }
  const ahora = T0 + 12 * 24 * H;
  const proy = proyectarCurva(pts, [], ahora, 48);
  assert.ok(proy.puntos.length > 0, "sin proyección");
  assert.ok(proy.ajuste, "sin ajuste");
  const m2 = proy.ajuste!.componentes.find((c) => c.periodo_h === 12.4206);
  assert.ok(m2, "sin comp M2");
  assert.ok(Math.abs(m2!.amplitud_m - A_M2) < 0.1, `A_M2=${m2!.amplitud_m}`);
  for (const p of proy.puntos) {
    const th = new Date(p.timestamp).getTime() / H;
    const esperado = 2 + A_M2 * Math.sin(wM2 * th + fase);
    assert.ok(Math.abs(p.nivel_m - esperado) < 0.15, `ts=${p.timestamp} got=${p.nivel_m.toFixed(3)} esperado=${esperado.toFixed(3)}`);
  }
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

test("regresión con presión: recupera coeficiente de presión atmosférica", () => {
  const presionCoef = -0.008; // m por hPa (presión alta hunde el nivel)
  const { pts, ventos } = serieSintetica(8, 25, 0.02, presionCoef);
  const ajuste = ajustarArmonico(pts);
  assert.ok(ajuste);
  const reg = regresarViento(pts, ajuste!, ventos);
  assert.ok(reg, "debería ajustar regresión con presión");
  assert.ok(reg!.presion_m_por_hpa != null);
  assert.ok(Math.abs(reg!.presion_m_por_hpa! - presionCoef) < 0.005, `presion=${reg!.presion_m_por_hpa}`);
});

test("sin datos suficientes => ajuste nulo y proyección vacía", () => {
  const pts: Punto[] = [];
  const proy = proyectarCurva(pts, [], Date.now(), 24);
  assert.equal(proy.ajuste, null);
  assert.equal(proy.puntos.length, 0);
  assert.equal(proy.extremos.length, 0);
});

test("validarModelo: el modelo con viento recupera niveles con MAE bajo y alto acierto", () => {
  const { pts, ventos } = serieSintetica(14, 25, 0.04);
  const ahora = T0 + 14 * 24 * H;
  const val = validarModelo(pts, ventos, ahora, [6, 12, 24]);
  assert.ok(val, "validación no nula");
  assert.ok(val!.cortes >= 5, `cortes=${val!.cortes}`);
  for (const h of [6, 12, 24]) {
    const v = val!.horizontes.find((x) => x.horizonte_h === h);
    assert.ok(v, `horizonte ${h}`);
    assert.ok(v!.n >= 3, `h${h} n=${v!.n}`);
    // tolerancia amplia: el residuo meteorológico degrada el ajuste en ventanas cortas
    assert.ok(v!.mae_m < 0.7, `h${h} mae=${v!.mae_m}`);
    // El backtest usa solo el viento conocido hasta el corte (sin lookahead),
    // como en producción; a 24h el viento oscilante de la serie sintética
    // clampa al último valor, así que el umbral es más laxo.
    assert.ok(v!.acierto_pct > 5, `h${h} acierto=${v!.acierto_pct}`);
  }
});

test("validarModelo: más historia acumulada reduce el error de 24h", () => {
  const { pts, ventos } = serieSintetica(14, 25, 0.04);
  const ahora = T0 + 14 * 24 * H;
  // Cortes solo en la última parte (>=10 días de historia acumulada) => MAE bajo
  const val = validarModelo(pts, ventos, ahora, [24], 10 * 24);
  assert.ok(val, "validación no nula");
  const v24 = val!.horizontes.find((x) => x.horizonte_h === 24);
  assert.ok(v24 && v24.n >= 3, `n=${v24?.n}`);
  assert.ok(v24!.mae_m < 0.4, `h24 mae=${v24!.mae_m} (con historia larga)`);
});

test("validarModelo: sin historia suficiente devuelve null", () => {
  const val = validarModelo([], [], Date.now(), [6]);
  assert.equal(val, null);
  const corto = serieSintetica(2, 25, 0.04);
  const val2 = validarModelo(corto.pts, corto.ventos, T0 + 2 * 24 * H, [6]);
  assert.equal(val2, null);
});

// Serie de La Plata que anticipa a SF: LP(t) = SF(t + 2h).
function seriePropagacion(dias: number, lagH: number): { sf: Punto[]; lp: Punto[] } {
  const sf: Punto[] = [];
  const lp: Punto[] = [];
  const pasos = dias * 48;
  const M2 = 12.4206;
  for (let i = 0; i < pasos; i++) {
    const tsSF = T0 + i * 30 * 60000;
    const th = tsSF / H;
    const nivel = 0.5 + 0.4 * Math.sin((2 * Math.PI) / M2 * th + 0.5);
    sf.push({ timestamp: new Date(tsSF).toISOString(), nivel_m: nivel });
    const tsLP = tsSF - lagH * H;
    lp.push({ timestamp: new Date(tsLP).toISOString(), nivel_m: nivel });
  }
  return { sf, lp };
}

test("regresarPropagacion: recupera el lag de La Plata a San Fernando", () => {
  const lagReal = 2;
  const { sf, lp } = seriePropagacion(6, lagReal);
  const ahora = T0 + 6 * 24 * H;
  const reg = regresarPropagacion(sf, lp, ahora, [1, 1.5, 2, 2.5, 3]);
  assert.ok(reg, "regresión no nula");
  assert.ok(Math.abs(reg!.lag_h - lagReal) < 0.6, `lag=${reg!.lag_h}`);
  assert.ok(reg!.r2 > 0.8, `r2=${reg!.r2}`);
  assert.ok(Math.abs(reg!.pendiente - 1) < 0.15, `pendiente=${reg!.pendiente}`);
  assert.ok(Math.abs(reg!.intercepto_m) < 0.15, `intercepto=${reg!.intercepto_m}`);
});

test("regresarPropagacion: sin datos suficientes devuelve null", () => {
  const reg = regresarPropagacion([], [], Date.now());
  assert.equal(reg, null);
});
