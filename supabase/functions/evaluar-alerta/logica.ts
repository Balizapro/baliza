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
    const ventanaFin = new Date(ahora.getTime() + horasEstimadas * 60 * 60 * 1000);

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
