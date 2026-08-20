export type NivelAlerta = "verde" | "amarilla" | "roja" | "azul" | "evacuacion";

// Subir por debajo de este margen respecto del umbral de evaluación no amerita "Atención".
export const MARGEN_AMARILLA_M = 1.0;

export interface Umbrales {
  evaluacion: number;
  noRetorno: number;
  bajanteAlarma: number;
  bajanteEvacuacion: number;
}

export interface ResultadoVentana {
  alerta: NivelAlerta;
  ventanaInicio: Date | null;
  ventanaFin: Date | null;
  mensaje: string;
}

export function reemplazar(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export function calcularVentana(
  nivelActual: number,
  tendencia: "subiendo" | "bajando" | "estable",
  u: Umbrales,
  trasladoMin: number,
  mensajes: Record<string, string>
): ResultadoVentana {
  // Bajante tiene prioridad: un nivel muy bajo no es compatible con crecida.
  if (nivelActual <= u.bajanteEvacuacion) {
    return {
      alerta: "evacuacion",
      ventanaInicio: new Date(),
      ventanaFin: null,
      mensaje: reemplazar(mensajes.recomendacion_bajante_evacuacion ?? "EVACUACIÓN por bajante — nivel {{nivel}}m", {
        nivel: nivelActual.toFixed(2), bajante_evac: u.bajanteEvacuacion.toFixed(2),
      }),
    };
  }

  if (nivelActual <= u.bajanteAlarma) {
    return {
      alerta: "azul",
      ventanaInicio: null,
      ventanaFin: null,
      mensaje: reemplazar(mensajes.recomendacion_bajante_alarma ?? "Bajante — nivel {{nivel}}m", {
        nivel: nivelActual.toFixed(2), bajante_alarma: u.bajanteAlarma.toFixed(2),
      }),
    };
  }

  if (nivelActual >= u.noRetorno) {
    return {
      alerta: "roja",
      ventanaInicio: new Date(),
      ventanaFin: null,
      mensaje: reemplazar(mensajes.recomendacion_roja_critico ?? "Salir ahora — nivel crítico {{nivel}}m", {
        nivel: nivelActual.toFixed(2), umbral_nr: u.noRetorno.toFixed(1),
      }),
    };
  }

  if (tendencia !== "subiendo" && nivelActual < u.evaluacion) {
    return {
      alerta: "verde",
      ventanaInicio: null,
      ventanaFin: null,
      mensaje: reemplazar(mensajes.recomendacion_verde ?? "Todo normal — {{nivel}}m", {
        nivel: nivelActual.toFixed(2), umbral_eval: u.evaluacion.toFixed(1),
      }),
    };
  }

  if (tendencia === "subiendo" && nivelActual >= u.evaluacion) {
    const ahora = new Date();
    const diff = u.noRetorno - nivelActual;
    const horasEstimadas = Math.max(0.5, diff / 0.05);

    const horasSalida = Math.max(0, horasEstimadas - trasladoMin / 60);
    const horaSalida = new Date(ahora.getTime() + horasSalida * 60 * 60 * 1000);

    return {
      alerta: "roja",
      ventanaInicio: ahora,
      ventanaFin: horaSalida,
      mensaje: reemplazar(mensajes.recomendacion_roja_subiendo ?? "Preparar salida — nivel {{nivel}}m", {
        nivel: nivelActual.toFixed(2),
        umbral_eval: u.evaluacion.toFixed(1),
        umbral_nr: u.noRetorno.toFixed(1),
        horas: Math.round(horasEstimadas).toString(),
        hora_salida: `${horaSalida.getHours()}:${String(horaSalida.getMinutes()).padStart(2, "0")}`,
      }),
    };
  }

  // Nivel por encima del umbral de evaluación pero sin subir (estable/bajando):
  // no es "salir ahora", pero la alerta NO puede ser verde (el muelle ya no es
  // accesible). El banner siempre lo muestra: acá lo refleja el backend para
  // que sirena y notificaciones se activen igual al superar la evaluación.
  if (nivelActual >= u.evaluacion) {
    return {
      alerta: "amarilla",
      ventanaInicio: null,
      ventanaFin: null,
      mensaje: reemplazar(mensajes.recomendacion_amarilla ?? "Atención — nivel {{nivel}}m sobre la evaluación", {
        nivel: nivelActual.toFixed(2),
        umbral_eval: u.evaluacion.toFixed(1),
        hora_revision: "pronto",
      }),
    };
  }

  if (tendencia === "subiendo" && nivelActual < u.evaluacion && nivelActual >= u.evaluacion - MARGEN_AMARILLA_M) {
    const diff = u.evaluacion - nivelActual;
    const horasEstimadas = Math.max(1, diff / 0.05);
    const proximaRevision = new Date(new Date().getTime() + horasEstimadas * 60 * 60 * 1000);

    return {
      alerta: "amarilla",
      ventanaInicio: null,
      ventanaFin: null,
      mensaje: reemplazar(mensajes.recomendacion_amarilla ?? "Atención — {{nivel}}m subiendo", {
        nivel: nivelActual.toFixed(2),
        umbral_eval: u.evaluacion.toFixed(1),
        hora_revision: `${proximaRevision.getHours()}:${String(proximaRevision.getMinutes()).padStart(2, "0")}`,
      }),
    };
  }

  return {
    alerta: "verde",
    ventanaInicio: null,
    ventanaFin: null,
    mensaje: mensajes.recomendacion_verde_default ?? "Todo normal",
  };
}

// Un CESE de aviso solo informa durante `horasVigencia`; pasado ese tiempo se descarta.
export function ceseExpirado(emitidoIso: string | null | undefined, horasVigencia = 2, ahora = Date.now()): boolean {
  if (!emitidoIso) return true;
  return new Date(emitidoIso).getTime() + horasVigencia * 60 * 60 * 1000 < ahora;
}

export interface Lectura {
  timestamp: string;
  nivel_m: number;
}

export interface GiroDetectado {
  picoTs: number;
  pendiente_m_h: number;
}

export interface DetectarGiroOpciones {
  picoMaxEdadHs: number;
  pendienteMinMH: number;
  ahoraMs?: number;
}

// Detecta si una serie de lecturas pasó su pico reciente y viene bajando.
// Solo exige UNA lectura posterior al pico: con datos horarios, exigir dos
// retrasaba la detección ~2h (pico 06:45 se confirmaba recién 08:45) y el aviso
// "el agua va a bajar" llegaba cuando SF ya bajaba.
export function detectarGiro(
  lecturas: Lectura[],
  opciones: DetectarGiroOpciones
): GiroDetectado | null {
  const ahoraMs = opciones.ahoraMs ?? Date.now();
  if (lecturas.length < 4) return null;
  // Entrada desc; ordenar asc.
  const asc = [...lecturas].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const n = asc.length;
  // Último pico local interior (mayor que anterior y que el/los siguiente/s).
  let idxPico = -1;
  for (let i = n - 2; i >= 1; i--) {
    const ant = asc[i - 1].nivel_m;
    const act = asc[i].nivel_m;
    const sig = asc[i + 1].nivel_m;
    const sig2 = i + 2 < n ? asc[i + 2].nivel_m : sig;
    if (act >= ant && act > sig && act > sig2) {
      idxPico = i;
      break;
    }
  }
  if (idxPico < 0) return null;
  const picoTs = new Date(asc[idxPico].timestamp).getTime();
  if (ahoraMs - picoTs > opciones.picoMaxEdadHs * 3600000) return null;

  // Pendiente con los puntos posteriores al pico.
  const despues = asc.slice(idxPico);
  if (despues.length < 2) return null;
  const t0 = new Date(despues[0].timestamp).getTime() / 3600000;
  let sx = 0, sy = 0;
  for (const p of despues) { sx += new Date(p.timestamp).getTime() / 3600000 - t0; sy += p.nivel_m; }
  const n2 = despues.length;
  const mx = sx / n2;
  const my = sy / n2;
  let sxx = 0, sxy = 0;
  for (const p of despues) {
    const x = new Date(p.timestamp).getTime() / 3600000 - t0;
    sxx += (x - mx) * (x - mx);
    sxy += (x - mx) * (p.nivel_m - my);
  }
  if (sxx < 1e-9) return null;
  const pend = sxy / sxx;
  if (pend >= 0) return null;
  return { picoTs, pendiente_m_h: pend };
}

// El preaviso de pico solo avisa si el pico pronosticado está lo suficientemente
// cerca (inminencia): evita avisar con 2+ días de anticipación cuando el pronóstico
// recién marca el evento (caso 08-08: avisó 2 días antes y quemó el dedup).
export function esPicoInminente(picoTs: number, ahoraMs: number, maxHorizonteHs: number): boolean {
  return picoTs - ahoraMs <= maxHorizonteHs * 3600000;
}

// Dedup por episodio: si el pronóstico ya avisó para un pico en la misma ventana
// (tolerancia sobre el timestamp), no re-notifica. Solo re-notifica si es otra crecida.
export function mismoEpisodioPreaviso(claves: string[], picoTs: number, toleranciaMs: number): boolean {
  return claves.some((c) => {
    const tsPico = parseInt(c.replace("preaviso_pico_", ""), 10);
    return Number.isFinite(tsPico) && Math.abs(tsPico - picoTs) <= toleranciaMs;
  });
}
