// Escalada del banner por PRONÓSTICO, anclada al plan escolar.
//
// Problema (7-oct-2026): el banner se ponía rojo ("Preparar salida") apenas el
// pronóstico pasaba 2.10m, sin mirar qué día ni a qué hora, mientras "Plan de hoy"
// decía "Día normal" — dos reglas distintas contando historias distintas.
//
// Regla acordada con la escuela:
//  - Se avisa con TODA la anticipación que da el pronóstico (hoy ~4 días), nunca se
//    esconde ni se recorta por distancia.
//  - ROJO solo si el plan escolar (el mismo calcularVeredicto del "Plan de hoy") da
//    "no ir" o "salida temprana" en algún día de clases. El mensaje dice qué día y por qué.
//  - AMARILLO si hay crecida pronosticada sobre el umbral pero NO toca las clases;
//    el mensaje dice el día/hora del pico y si cae fuera o dentro del horario escolar.
//  - Lo que pasa HOY (nivel actual, subida sostenida) se decide en calcularVentana, no acá.
//
// Módulo puro (sin acceso a la base ni a Deno) para poder testearlo con node --test.

import {
  HORA_ENTRADA,
  HORA_VUELTA,
  esDiaEscolar,
  fechaDiaArgentina,
  minutosDiaArgentina,
  weekdayArgentina,
  type VeredictoDia,
} from "./plan_escolar.ts";

const TZ = "America/Argentina/Buenos_Aires";

export interface PuntoPico {
  timestamp: string;
  valor_m: number;
}

export interface EscaladaPronostico {
  nivel: "roja" | "amarilla" | null;
  mensaje: string | null;
  // Fecha (YYYY-MM-DD) del primer día de clases afectado; solo cuando nivel === "roja".
  diaAfectado: string | null;
  // De dónde sale el número que se usa (el pronóstico del INA, su rango y la fuente más alta).
  // Va aparte del titular para mostrarse en letra chica; solo cuando nivel === "roja".
  explicacion: string | null;
  // Hay un pico pronosticado sobre el umbral (a cualquier distancia) y el estado actual
  // todavía es elevable. Se usa para NO mandar push por esta vía: los avisos de "no ir" /
  // "salida temprana" ya salen por el veredicto escolar, con su propio dedup.
  sobreUmbral: boolean;
}

// "hoy", "mañana" o "vie 9" para una fecha YYYY-MM-DD.
export function etiquetaDiaPlan(fecha: string, ahoraMs: number): string {
  if (fecha === fechaDiaArgentina(new Date(ahoraMs).toISOString())) return "hoy";
  if (fecha === fechaDiaArgentina(new Date(ahoraMs + 24 * 3600000).toISOString())) return "mañana";
  return new Date(`${fecha}T12:00:00-03:00`)
    .toLocaleDateString("es-AR", { weekday: "short", day: "numeric", timeZone: TZ })
    .replace(/[.,]/g, "");
}

// "vie 9, 08:00 a. m." — mismo formato que formatearMomento de index.ts, para que el
// titular y la línea de "Preaviso" del banner muestren las horas igual.
function momento(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    weekday: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

function enHorarioEscolarPunto(iso: string, diasSinClases: string[]): boolean {
  const fecha = fechaDiaArgentina(iso);
  if (!esDiaEscolar(fecha, weekdayArgentina(iso), diasSinClases)) return false;
  const min = minutosDiaArgentina(iso);
  return min != null && min >= HORA_ENTRADA && min <= HORA_VUELTA;
}

export function decidirEscaladaPronostico(args: {
  alerta: string; // nivel que ya decidió calcularVentana (verde/amarilla/roja/azul/evacuacion)
  veredictos: VeredictoDia[]; // hoy + próximos días, en orden cronológico
  pronosMain: PuntoPico[]; // pronóstico INA main futuro
  picoProno: PuntoPico | null; // máximo de pronosMain
  umbralProno: number;
  nivelSeguroM: number;
  diasSinClases: string[];
  ahoraMs: number;
}): EscaladaPronostico {
  const { alerta, veredictos, pronosMain, picoProno, umbralProno, nivelSeguroM, diasSinClases, ahoraMs } = args;
  const ninguna: EscaladaPronostico = { nivel: null, mensaje: null, diaAfectado: null, explicacion: null, sobreUmbral: false };

  // Solo se puede subir un estado verde/amarillo; no pisa roja, evacuación ni bajante.
  const elevable = alerta === "verde" || alerta === "amarilla";
  if (!elevable) return ninguna;

  const sobreUmbral = picoProno != null && picoProno.valor_m > umbralProno;

  // El día de hoy ya no puede verse afectado una vez pasada la vuelta (14:15).
  const hoy = fechaDiaArgentina(new Date(ahoraMs).toISOString());
  const minAhora = minutosDiaArgentina(new Date(ahoraMs).toISOString()) ?? 0;
  const afectados = veredictos.filter(
    (v) =>
      v.esDiaEscolar &&
      (v.estado === "no_clases" || v.estado === "salida_temprana") &&
      !(v.fecha === hoy && minAhora >= HORA_VUELTA)
  );

  if (afectados.length > 0) {
    const primero = afectados[0];
    const dia = etiquetaDiaPlan(primero.fecha, ahoraMs);
    const titulo =
      primero.estado === "no_clases"
        ? `Alerta — ${dia}: no se podría ir a la escuela`
        : `Alerta — ${dia}: salida temprana`;
    // El titular lleva la frase corta; la explicación del número va aparte (explicacion).
    const motivo = (primero.motivo_corto ?? primero.motivo).trim();
    const otros = afectados
      .slice(1)
      .map((v) => `${etiquetaDiaPlan(v.fecha, ahoraMs)} ${v.estado === "no_clases" ? "no ir" : "salida temprana"}`);
    const mensaje =
      `${titulo}. ${motivo}${/[.!]$/.test(motivo) ? "" : "."}` +
      (otros.length > 0 ? ` También: ${otros.join(", ")}.` : "");
    return { nivel: "roja", mensaje, diaAfectado: primero.fecha, explicacion: primero.explicacion?.trim() || null, sobreUmbral };
  }

  // Crecida pronosticada sobre el umbral que NO toca las clases: amarillo informativo
  // (solo si el estado actual es verde; si ya es amarillo se deja el mensaje que tiene).
  if (sobreUmbral && alerta === "verde") {
    const pico = picoProno!;
    const fechaPico = fechaDiaArgentina(pico.timestamp);
    const escolarPico = esDiaEscolar(fechaPico, weekdayArgentina(pico.timestamp), diasSinClases);
    const enHorarioPico = enHorarioEscolarPunto(pico.timestamp, diasSinClases);
    const seguro = nivelSeguroM.toFixed(2);

    let relacion: string;
    if (!escolarPico) relacion = "ese día no hay clases";
    else if (!enHorarioPico) relacion = "fuera del horario escolar";
    else if (pico.valor_m > nivelSeguroM) relacion = `en horario escolar, sobre el nivel seguro de ${seguro}m`;
    else relacion = `en horario escolar, bajo el nivel seguro de ${seguro}m: las clases no se ven afectadas`;

    let mensaje = `Atención — crecida pronosticada: pico de ${pico.valor_m.toFixed(2)}m el ${momento(pico.timestamp)} (${relacion}).`;

    // Si el pico cae fuera de clases, aclarar qué pasa DENTRO del horario escolar.
    if (!enHorarioPico) {
      const escolares = pronosMain.filter((p) => enHorarioEscolarPunto(p.timestamp, diasSinClases));
      if (escolares.length > 0) {
        const maxEsc = escolares.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), escolares[0]);
        mensaje +=
          ` En horario escolar lo más alto es ${maxEsc.valor_m.toFixed(2)}m (${momento(maxEsc.timestamp)})` +
          (maxEsc.valor_m <= nivelSeguroM
            ? `, bajo el nivel seguro de ${seguro}m: las clases no se ven afectadas.`
            : ".");
      }
    }
    return { nivel: "amarilla", mensaje, diaAfectado: null, explicacion: null, sobreUmbral };
  }

  return { ...ninguna, sobreUmbral };
}
