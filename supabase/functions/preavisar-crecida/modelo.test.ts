import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ajustarArmonico,
  regresarViento,
  proyectarCurva,
  componenteSE,
  type Punto,
  type PuntoViento,
} from "./modelo.ts";

const H = 3600000;
const M2 = 12.4206;

function serieArmonica(horas: number, nivel0 = 0.5, amp = 0.8, faseH = 3): Punto[] {
  const pts: Punto[] = [];
  const pasoHs = 1;
  const T0 = Date.UTC(2026, 7, 1, 0, 0, 0);
  for (let h = 0; h < horas; h += pasoHs) {
    const arm = amp * Math.sin(((2 * Math.PI) / M2) * (h - faseH));
    pts.push({ timestamp: new Date(T0 + h * H).toISOString(), nivel_m: nivel0 + arm });
  }
  return pts;
}

function serieViento(horas: number, velocidad = 0, direccion = 0): PuntoViento[] {
  const out: PuntoViento[] = [];
  const T0 = Date.UTC(2026, 7, 1, 0, 0, 0);
  for (let h = 0; h <= horas; h += 3) {
    out.push({ timestamp: T0 + h * H, velocidad_kmh: velocidad, direccion_grados: direccion, presion_hpa: 1013 + Math.sin(h / 3) * 5 });
  }
  return out;
}

test("componenteSE: sudestada (135°) da viento máximo positivo", () => {
  assert.ok(componenteSE(30, 135) > 29.9);
  assert.ok(componenteSE(30, 315) < -29.9);
  assert.ok(Math.abs(componenteSE(30, 45)) < 1e-9);
});

test("ajuste armónico recupera amplitud M2 en serie sintética", () => {
  const pts = serieArmonica(120, 0.5, 0.8);
  const ajuste = ajustarArmonico(pts);
  assert.ok(ajuste, "ajuste no nulo");
  const m2 = ajuste!.componentes.find((c) => Math.abs(c.periodo_h - M2) < 0.01)!;
  assert.ok(Math.abs(m2.amplitud_m - 0.8) < 0.05, `amplitud M2 ${m2.amplitud_m}`);
  assert.ok(Math.abs(ajuste!.c0 - 0.5) < 0.05, `c0 ${ajuste!.c0}`);
});

test("regresión de viento recupera pendiente del residuo meteorológico", () => {
  const pts = serieArmonica(120, 0.5, 0.8);
  const ajuste = ajustarArmonico(pts)!;
  const ventos: PuntoViento[] = [];
  const T0 = Date.UTC(2026, 7, 1, 0, 0, 0);
  const pendiente = 0.02;
  for (let h = 0; h <= 120; h += 1) {
    const ts = T0 + h * H;
    const v = 25 + (h % 7) * 2;
    ventos.push({ timestamp: ts, velocidad_kmh: v, direccion_grados: 135, presion_hpa: 1013 + Math.sin(h / 3) * 5 });
    pts.push({ timestamp: new Date(ts).toISOString(), nivel_m: 0.5 + 0.8 * Math.sin(((2 * Math.PI) / M2) * (h - 3)) + pendiente * componenteSE(v, 135) });
  }
  const reg = regresarViento(pts, ajuste, ventos);
  assert.ok(reg, "regresión no nula");
  assert.ok(Math.abs(reg!.pendiente_m_por_kmh - pendiente) < 0.008, `pendiente ${reg!.pendiente_m_por_kmh}`);
});

test("regresión con presión recupera coeficiente de presión atmosférica", () => {
  const T0 = Date.UTC(2026, 7, 1, 0, 0, 0);
  const pts: Punto[] = [];
  const ventos: PuntoViento[] = [];
  const pendiente = 0.02;
  const presionCoef = -0.008;
  for (let h = 0; h <= 288; h += 1) {
    const ts = T0 + h * H;
    const v = 20 + (h % 7) * 2;
    const presion = 1013 + Math.sin(h / 3) * 5;
    ventos.push({ timestamp: ts, velocidad_kmh: v, direccion_grados: 135, presion_hpa: presion });
    pts.push({
      timestamp: new Date(ts).toISOString(),
      nivel_m: 0.5 + 0.8 * Math.sin(((2 * Math.PI) / M2) * (h - 3)) + pendiente * componenteSE(v, 135) + presionCoef * (presion - 1013),
    });
  }
  const ajuste = ajustarArmonico(pts)!;
  const reg = regresarViento(pts, ajuste, ventos);
  assert.ok(reg, "regresión con presión no nula");
  assert.ok(reg!.presion_m_por_hpa != null);
  assert.ok(Math.abs(reg!.presion_m_por_hpa! - presionCoef) < 0.005, `presion ${reg!.presion_m_por_hpa}`);
});

test("proyección: genera puntos futuros con banda y extremos", () => {
  const pts = serieArmonica(120, 0.5, 0.8);
  const ventos = serieViento(200, 20, 135);
  const ahora = Date.UTC(2026, 7, 5, 0, 0, 0);
  const proy = proyectarCurva(pts, ventos, ahora, 48, 30);
  assert.ok(proy.puntos.length >= 90, `puntos ${proy.puntos.length}`);
  assert.ok(proy.extremos.length >= 3, `extremos ${proy.extremos.length}`);
  const pleam = proy.extremos.find((e) => e.tipo === "pleamar");
  assert.ok(pleam && pleam.nivel_m > 0.5, `pleamar ${pleam?.nivel_m}`);
  for (let i = 0; i < proy.puntos.length; i++) {
    assert.ok(proy.bandaSuperior[i].nivel_m >= proy.puntos[i].nivel_m);
    assert.ok(proy.bandaInferior[i].nivel_m <= proy.puntos[i].nivel_m);
  }
});

test("proyección con viento: sudestada eleva la curva respecto al armónico puro", () => {
  const pendiente = 0.04;
  const pts: Punto[] = [];
  const ventos: PuntoViento[] = [];
  const T0 = Date.UTC(2026, 7, 1, 0, 0, 0);
  for (let i = 0; i < 6 * 8; i++) {
    const ts = T0 + i * 3 * H;
    const velocidad = Math.max(5, 25 + Math.sin(i / 8) * 12);
    const direccion = 135 + Math.sin(i / 5) * 30;
    ventos.push({ timestamp: ts, velocidad_kmh: velocidad, direccion_grados: direccion, presion_hpa: 1013 + Math.sin(i / 3) * 5 });
  }
  const compSE = (ts: number): number => {
    const i = Math.round((ts - T0) / (3 * H));
    const v = ventos[Math.max(0, Math.min(i, ventos.length - 1))];
    return componenteSE(v.velocidad_kmh, v.direccion_grados);
  };
  for (let i = 0; i < 6 * 48; i++) {
    const ts = T0 + i * 30 * 60000;
    const th = ts / H;
    const arm = 0.8 * Math.sin(((2 * Math.PI) / M2) * (th / 24 - 3));
    pts.push({ timestamp: new Date(ts).toISOString(), nivel_m: 0.5 + arm + pendiente * compSE(ts) });
  }
  const ahora = Date.UTC(2026, 7, 6, 0, 0, 0);
  const proy = proyectarCurva(pts, ventos, ahora, 48, 30);
  assert.ok(proy.regresion, "debería detectar forzante de viento");
  const mediaCurva = proy.puntos.reduce((s, p) => s + p.nivel_m, 0) / proy.puntos.length;
  assert.ok(mediaCurva > 0.4, `mediaCurva=${mediaCurva.toFixed(3)} (sudestada eleva el nivel)`);
});

test("sin datos suficientes => ajuste nulo y proyección vacía", () => {
  const pts: Punto[] = serieArmonica(4);
  const proy = proyectarCurva(pts, serieViento(10), Date.now(), 48);
  assert.equal(proy.ajuste, null);
  assert.equal(proy.puntos.length, 0);
});
