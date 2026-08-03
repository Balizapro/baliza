import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

interface UmbralRow {
  nombre: string;
  valor_m: number;
}

interface ConfigRow {
  clave: string;
  valor: string;
}

interface LecturaRow {
  timestamp: string;
  nivel_m: number;
}

interface PronosticoRow {
  timestamp: string;
  valor_m: number;
}

type NivelAlerta = "verde" | "amarilla" | "roja" | "azul" | "evacuacion";

const PROPAGACION_LP_A_SF = 2.5;
const PROPAGACION_BA_A_SF = 1.0;

// Subir por debajo de este margen respecto del umbral de evaluación no amerita "Atención".
const MARGEN_AMARILLA_M = 1.0;

function reemplazar(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

const TZ = "America/Argentina/Buenos_Aires";

function formatearMomento(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

// Cruces de umbral según el pronóstico INA (qualifier main) de San Fernando.
function preavisosPronostico(
  pronos: PronosticoRow[],
  umbralEval: number,
  umbralNR: number,
  bajanteAlarma: number,
  bajanteEvacuacion: number
): { preavisos: string[]; severo: boolean } {
  const preavisos: string[] = [];
  let severo = false;
  const ahora = Date.now();
  const futuros = pronos
    .filter((p) => new Date(p.timestamp).getTime() >= ahora)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (futuros.length === 0) return { preavisos, severo };

  // Peor escenario de crecida en el horizonte del pronóstico
  const pico = futuros.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), futuros[0]);
  const pozo = futuros.reduce((m, p) => (p.valor_m < m.valor_m ? p : m), futuros[0]);

  if (pico.valor_m >= umbralNR) {
    preavisos.push(`Pronóstico: pico de ${pico.valor_m.toFixed(2)}m el ${formatearMomento(pico.timestamp)} — supera el no retorno (${umbralNR.toFixed(1)}m)`);
    severo = true;
  } else if (pico.valor_m >= umbralEval) {
    preavisos.push(`Pronóstico: pico de ${pico.valor_m.toFixed(2)}m el ${formatearMomento(pico.timestamp)} — supera la evaluación (${umbralEval.toFixed(1)}m)`);
  }

  // Peor escenario de bajante en el horizonte del pronóstico
  if (pozo.valor_m <= bajanteEvacuacion) {
    preavisos.push(`Pronóstico: baja a ${pozo.valor_m.toFixed(2)}m el ${formatearMomento(pozo.timestamp)} — nivel de evacuación (${bajanteEvacuacion.toFixed(1)}m)`);
    severo = true;
  } else if (pozo.valor_m <= bajanteAlarma) {
    preavisos.push(`Pronóstico: baja a ${pozo.valor_m.toFixed(2)}m el ${formatearMomento(pozo.timestamp)} — nivel de bajante (${bajanteAlarma.toFixed(2)}m)`);
  }

  return { preavisos, severo };
}

function calcularVentana(
  nivelActual: number,
  tendencia: "subiendo" | "bajando" | "estable",
  umbralEvaluacion: number,
  umbralNoRetorno: number,
  bajanteAlarma: number,
  bajanteEvacuacion: number,
  trasladoMin: number,
  mensajes: Record<string, string>
): {
  alerta: NivelAlerta;
  ventanaInicio: Date | null;
  ventanaFin: Date | null;
  mensaje: string;
} {
  // Bajante tiene prioridad: un nivel muy bajo no es compatible con crecida.
  if (nivelActual <= bajanteEvacuacion) {
    return {
      alerta: "evacuacion",
      ventanaInicio: new Date(),
      ventanaFin: null,
      mensaje: reemplazar(mensajes.recomendacion_bajante_evacuacion ?? "EVACUACIÓN por bajante — nivel {{nivel}}m", {
        nivel: nivelActual.toFixed(2), bajante_evac: bajanteEvacuacion.toFixed(2),
      }),
    };
  }

  if (nivelActual <= bajanteAlarma) {
    return {
      alerta: "azul",
      ventanaInicio: null,
      ventanaFin: null,
      mensaje: reemplazar(mensajes.recomendacion_bajante_alarma ?? "Bajante — nivel {{nivel}}m", {
        nivel: nivelActual.toFixed(2), bajante_alarma: bajanteAlarma.toFixed(2),
      }),
    };
  }

  if (nivelActual >= umbralNoRetorno) {
    return {
      alerta: "roja",
      ventanaInicio: new Date(),
      ventanaFin: null,
      mensaje: reemplazar(mensajes.recomendacion_roja_critico ?? "Salir ahora — nivel crítico {{nivel}}m", {
        nivel: nivelActual.toFixed(2), umbral_nr: umbralNoRetorno.toFixed(1),
      }),
    };
  }

  if (tendencia !== "subiendo" && nivelActual < umbralEvaluacion) {
    return {
      alerta: "verde",
      ventanaInicio: null,
      ventanaFin: null,
      mensaje: reemplazar(mensajes.recomendacion_verde ?? "Todo normal — {{nivel}}m", {
        nivel: nivelActual.toFixed(2), umbral_eval: umbralEvaluacion.toFixed(1),
      }),
    };
  }

  if (tendencia === "subiendo" && nivelActual >= umbralEvaluacion) {
    const ahora = new Date();
    const diff = umbralNoRetorno - nivelActual;
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
        umbral_eval: umbralEvaluacion.toFixed(1),
        umbral_nr: umbralNoRetorno.toFixed(1),
        horas: Math.round(horasEstimadas).toString(),
        hora_salida: `${horaSalida.getHours()}:${String(horaSalida.getMinutes()).padStart(2, "0")}`,
      }),
    };
  }

  if (tendencia === "subiendo" && nivelActual < umbralEvaluacion && nivelActual >= umbralEvaluacion - MARGEN_AMARILLA_M) {
    const diff = umbralEvaluacion - nivelActual;
    const horasEstimadas = Math.max(1, diff / 0.05);
    const proximaRevision = new Date(new Date().getTime() + horasEstimadas * 60 * 60 * 1000);

    return {
      alerta: "amarilla",
      ventanaInicio: null,
      ventanaFin: null,
      mensaje: reemplazar(mensajes.recomendacion_amarilla ?? "Atención — {{nivel}}m subiendo", {
        nivel: nivelActual.toFixed(2),
        umbral_eval: umbralEvaluacion.toFixed(1),
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

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: umbrales } = await supabase
      .from("umbrales")
      .select("nombre, valor_m")
      .in("nombre", ["evaluacion", "no_retorno", "bajante_alarma", "bajante_evacuacion"]);

    if (!umbrales || (umbrales as UmbralRow[]).length < 2) {
      return new Response(
        JSON.stringify({ ok: false, error: "umbrales no configurados" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const umbralEval = (umbrales as UmbralRow[]).find((u) => u.nombre === "evaluacion")!.valor_m;
    const umbralNR = (umbrales as UmbralRow[]).find((u) => u.nombre === "no_retorno")!.valor_m;
    const bajanteAlarma = (umbrales as UmbralRow[]).find((u) => u.nombre === "bajante_alarma")?.valor_m ?? 0;
    const bajanteEvacuacion = (umbrales as UmbralRow[]).find((u) => u.nombre === "bajante_evacuacion")?.valor_m ?? -0.1;

    // Leer tiempo de traslado desde configuracion
    let trasladoMin = 10;
    const { data: config } = await supabase
      .from("configuracion")
      .select("clave, valor")
      .eq("clave", "tiempo_traslado_minutos")
      .single();

    if (config) {
      trasladoMin = parseInt((config as ConfigRow).valor, 10) || 10;
    }

    const { data: estaciones } = await supabase
      .from("estaciones")
      .select("id")
      .eq("nombre", "San Fernando (Brazo Luján)")
      .single();

    if (!estaciones) {
      return new Response(
        JSON.stringify({ ok: false, error: "estación SF no encontrada" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const { data: recomendaciones } = await supabase
      .from("configuracion")
      .select("clave, valor")
      .in("clave", ["recomendacion_verde", "recomendacion_amarilla", "recomendacion_roja_subiendo", "recomendacion_roja_critico", "recomendacion_verde_default", "recomendacion_bajante_alarma", "recomendacion_bajante_evacuacion"]);

    const mensajes: Record<string, string> = {};
    if (recomendaciones) {
      for (const r of recomendaciones as ConfigRow[]) {
        mensajes[r.clave] = r.valor;
      }
    }

    const { data: lecturas } = await supabase
      .from("lecturas")
      .select("timestamp, nivel_m")
      .eq("estacion_id", estaciones.id)
      .eq("tipo", "observado")
      .order("timestamp", { ascending: false })
      .limit(3);

    if (!lecturas || lecturas.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "sin lecturas de San Fernando" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const nivelActual = (lecturas as LecturaRow[])[0].nivel_m;
    let tendencia: "subiendo" | "bajando" | "estable" = "estable";

    if (lecturas.length >= 2) {
      const diff = (lecturas as LecturaRow[])[0].nivel_m - (lecturas as LecturaRow[])[1].nivel_m;
      if (diff > 0.01) tendencia = "subiendo";
      else if (diff < -0.01) tendencia = "bajando";
    }

    // Preaviso por pronóstico INA de San Fernando (qualifier main, próximo horizonte)
    // Va primero: es el dato clave — cuándo llega el pico a San Fernando.
    const { data: pronos } = await supabase
      .from("pronosticos")
      .select("timestamp, valor_m")
      .eq("estacion_id", estaciones.id)
      .eq("qualifier", "main")
      .gte("timestamp", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .lte("timestamp", new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString())
      .order("timestamp", { ascending: true });

    const preavisos: string[] = [];
    const preavisosProno = preavisosPronostico(
      (pronos as PronosticoRow[] | null) ?? [],
      umbralEval, umbralNR, bajanteAlarma, bajanteEvacuacion
    );
    preavisos.push(...preavisosProno.preavisos);

    // Preaviso por estaciones exteriores (señales tempranas)
    const nombresExternas = ["La Plata", "Puerto de Buenos Aires"];

    for (const nombre of nombresExternas) {
      const { data: extEst } = await supabase
        .from("estaciones")
        .select("id")
        .eq("nombre", nombre)
        .single();

      if (extEst) {
        const { data: extLect } = await supabase
          .from("lecturas")
          .select("timestamp, nivel_m")
          .eq("estacion_id", extEst.id)
          .eq("tipo", "observado")
          .order("timestamp", { ascending: false })
          .limit(2);

        if (extLect && extLect.length >= 2) {
          const diff = (extLect as LecturaRow[])[0].nivel_m - (extLect as LecturaRow[])[1].nivel_m;
          if (diff > 0.01) {
            const horas = nombre.includes("Plata") ? PROPAGACION_LP_A_SF : PROPAGACION_BA_A_SF;
            preavisos.push(`${nombre} viene subiendo — señal temprana, el agua tardaría ~${Math.round(horas)}hs en llegar a San Fernando`);
          }
        }
      }
    }

    // Preaviso por tendencia mareológica del SHN (Río de la Plata Interior)
    const { data: avisosSHN } = await supabase
      .from("avisos_shn")
      .select("tendencia")
      .eq("tipo", "pronostico_mareologico")
      .order("publicado", { ascending: false })
      .limit(1)
      .maybeSingle();

    const tendenciaSHN = avisosSHN?.tendencia ?? null;

    // Si el SHN está en tendencia descendente y se acerca a la bajante, sumar alerta temprana
    if (tendenciaSHN === "descendente" && nivelActual <= bajanteAlarma + 0.5) {
      preavisos.push(`SHN: el Río de la Plata Interior está en bajante — vigilar el nivel`);
    }

    // Aviso oficial de crecida del SHN (el más importante). Si avisa niveles que superan
    // la evaluación o el no retorno en San Fernando, sumarlo como preaviso prioritario.
    const { data: avisoCrecidaRaw } = await supabase
      .from("avisos_crecida")
      .select("*")
      .eq("vigente", true)
      .order("emitido", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Un CESE de aviso solo informa durante 2 horas; pasado ese tiempo se descarta
    const avisoCrecida = avisoCrecidaRaw &&
      avisoCrecidaRaw.tipo.startsWith("cese_") &&
      new Date(avisoCrecidaRaw.emitido).getTime() + 2 * 60 * 60 * 1000 < Date.now()
      ? null
      : avisoCrecidaRaw;

    if (avisoCrecida) {
      const alturas = (avisoCrecida.alturas ?? []) as { puerto: string; altura_m: number }[];
      const sf = alturas.find((a) => a.puerto.toUpperCase().includes("SAN FERNANDO")) ?? null;
      if (sf && sf.altura_m > umbralEval) {
        preavisos.push(
          `SHN aviso oficial: San Fernando ${sf.altura_m.toFixed(2)}m${sf.altura_m > umbralNR ? ` — supera el nivel de no retorno (${umbralNR.toFixed(1)}m)` : " — supera la evaluación"}`
        );
      } else if (avisoCrecida.titulo) {
        preavisos.push(`SHN: ${avisoCrecida.titulo}`);
      }
    }

    const { alerta, ventanaInicio, ventanaFin, mensaje } = calcularVentana(
      nivelActual, tendencia, umbralEval, umbralNR, bajanteAlarma, bajanteEvacuacion, trasladoMin, mensajes
    );

    // Elevar verde→amarilla si el pronóstico anticipa un cruce severo (no retorno o evacuación por bajante)
    const alertaFinal: NivelAlerta =
      alerta === "verde" && preavisosProno.severo ? "amarilla" : alerta;

    const mensajeCompleto = preavisos.length
      ? `${mensaje} | Preaviso: ${preavisos.join("; ")}`
      : mensaje;

    const alertaRow = {
      nivel: alertaFinal,
      ventana_inicio: ventanaInicio?.toISOString() ?? null,
      ventana_fin: ventanaFin?.toISOString() ?? null,
      mensaje: mensajeCompleto,
      disparadores_json: {
        nivel_actual_m: nivelActual,
        tendencia,
        umbral_evaluacion: umbralEval,
        umbral_no_retorno: umbralNR,
        bajante_alarma: bajanteAlarma,
        bajante_evacuacion: bajanteEvacuacion,
        traslado_minutos: trasladoMin,
        tendencia_shn: tendenciaSHN,
        preavisos,
      },
    };

    // Notificar solo cuando el estado EMPEORA respecto de la última alerta registrada
    const { data: ultima } = await supabase
      .from("alertas")
      .select("nivel")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    const gravedad: Record<NivelAlerta, number> = { verde: 0, azul: 1, amarilla: 2, roja: 3, evacuacion: 4 };
    const nivelPrevio = (ultima?.nivel as NivelAlerta) ?? "verde";
    const empeoro = gravedad[alertaFinal] > gravedad[nivelPrevio];

    await supabase.from("alertas").insert(alertaRow);

    if (empeoro) {
      const titulo =
        alertaFinal === "evacuacion"
          ? "Baliza — EVACUACIÓN"
          : alertaFinal === "roja"
            ? "Baliza — Alerta roja"
            : alertaFinal === "amarilla"
              ? "Baliza — Atención"
              : "Baliza — Nuevo estado";
      const cuerpo = mensajeCompleto.split("|")[0]?.trim() ?? "El río cambió su estado en San Fernando";

      try {
        await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/enviar-notificacion`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // El gateway de Supabase exige un JWT válido; el secret dedicado valida la autorización real.
              Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
              "x-notificacion-secret": Deno.env.get("NOTIFICACION_SECRET") ?? "",
            },
            body: JSON.stringify({ titulo, cuerpo, url: "/dashboard" }),
          }
        );
      } catch (notifErr) {
        console.error("[evaluar-alerta] Error enviando notificación:", notifErr);
      }
    }

    return new Response(JSON.stringify({ ok: true, alerta: alertaRow, notifico: empeoro }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[evaluar-alerta] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
