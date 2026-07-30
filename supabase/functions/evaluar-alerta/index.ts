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

const PROPAGACION_LP_A_SF = 2.5;
const PROPAGACION_BA_A_SF = 1.0;

function calcularVentana(
  nivelActual: number,
  tendencia: "subiendo" | "bajando" | "estable",
  umbralEvaluacion: number,
  umbralNoRetorno: number,
  trasladoMin: number
): {
  alerta: "verde" | "amarilla" | "roja";
  ventanaInicio: Date | null;
  ventanaFin: Date | null;
  mensaje: string;
} {
  if (nivelActual >= umbralNoRetorno) {
    return {
      alerta: "roja",
      ventanaInicio: new Date(),
      ventanaFin: null,
      mensaje: `Salir ahora — nivel crítico alcanzado (${nivelActual.toFixed(2)}m)`,
    };
  }

  if (tendencia === "bajando" && nivelActual < umbralEvaluacion) {
    return {
      alerta: "verde",
      ventanaInicio: null,
      ventanaFin: null,
      mensaje: "Todo normal — nivel por debajo del umbral y bajando",
    };
  }

  if (tendencia === "subiendo" && nivelActual >= umbralEvaluacion) {
    const ahora = new Date();
    const diff = umbralNoRetorno - nivelActual;
    const horasEstimadas = Math.max(0.5, diff / 0.05);
    const ventanaFin = new Date(ahora.getTime() + horasEstimadas * 60 * 60 * 1000);

    // Descontar traslado para la cuenta regresiva real
    const horasSalida = Math.max(0, horasEstimadas - trasladoMin / 60);
    const horaSalida = new Date(ahora.getTime() + horasSalida * 60 * 60 * 1000);

    return {
      alerta: "roja",
      ventanaInicio: ahora,
      ventanaFin: horaSalida,
      mensaje: `Nivel superando umbral de evaluación. Estimar alcanzar punto de no retorno en ~${Math.round(horasEstimadas)}hs. Salir antes de las ${horaSalida.getHours()}:${String(horaSalida.getMinutes()).padStart(2, "0")}hs`,
    };
  }

  if (tendencia === "subiendo" && nivelActual < umbralEvaluacion) {
    const diff = umbralEvaluacion - nivelActual;
    const horasEstimadas = Math.max(1, diff / 0.05);
    const proximaRevision = new Date(new Date().getTime() + horasEstimadas * 60 * 60 * 1000);

    return {
      alerta: "amarilla",
      ventanaInicio: null,
      ventanaFin: null,
      mensaje: `Se puede esperar — próxima revisión ~${proximaRevision.getHours()}:${String(proximaRevision.getMinutes()).padStart(2, "0")}hs (${umbralEvaluacion.toFixed(1)}m)`,
    };
  }

  return {
    alerta: "verde",
    ventanaInicio: null,
    ventanaFin: null,
    mensaje: "Todo normal",
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
      .in("nombre", ["evaluacion", "no_retorno"]);

    if (!umbrales || (umbrales as UmbralRow[]).length < 2) {
      return new Response(
        JSON.stringify({ ok: false, error: "umbrales no configurados" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const umbralEval = (umbrales as UmbralRow[]).find((u) => u.nombre === "evaluacion")!.valor_m;
    const umbralNR = (umbrales as UmbralRow[]).find((u) => u.nombre === "no_retorno")!.valor_m;

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

    // Preaviso por estaciones exteriores
    const nombresExternas = ["La Plata", "Puerto de Buenos Aires"];
    const preavisos: string[] = [];

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
            preavisos.push(`${nombre} subiendo (~${Math.round(horas)}hs antes que SF)`);
          }
        }
      }
    }

    const { alerta, ventanaInicio, ventanaFin, mensaje } = calcularVentana(
      nivelActual, tendencia, umbralEval, umbralNR, trasladoMin
    );

    const mensajeCompleto = preavisos.length
      ? `${mensaje} | Preaviso: ${preavisos.join("; ")}`
      : mensaje;

    const alertaRow = {
      nivel: alerta,
      ventana_inicio: ventanaInicio?.toISOString() ?? null,
      ventana_fin: ventanaFin?.toISOString() ?? null,
      mensaje: mensajeCompleto,
      disparadores_json: {
        nivel_actual_m: nivelActual,
        tendencia,
        umbral_evaluacion: umbralEval,
        umbral_no_retorno: umbralNR,
        traslado_minutos: trasladoMin,
        preavisos,
      },
    };

    await supabase.from("alertas").insert(alertaRow);

    return new Response(JSON.stringify({ ok: true, alerta: alertaRow }), {
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
