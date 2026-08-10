import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { calcularVentana, ceseExpirado, type NivelAlerta } from "./logica.ts";

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

const PROPAGACION_LP_A_SF = 2.5;
const PROPAGACION_BA_A_SF = 1.0;
const EXTERIORES_GIRO = ["La Plata", "Oyarvide", "Atalaya", "Puerto de Buenos Aires"];
const PICO_MAX_EDAD_HS = 6;
const PENDIENTE_MIN_M_H = 0.005;
const GIRO_MIN_ESTACIONES = 2;
// El preaviso de pico solo avisa si el pico pronosticado está lo suficientemente
// cerca (inminencia): evita avisar con 2+ días de anticipación cuando el pronóstico
// recién marca el evento (caso 08-08: avisó 2 días antes y quemó el dedup).
const PICO_PREAVISO_MAX_HORIZONTE_HS = 12;
// Dedup por episodio: si el pronóstico ya avisó para un pico en la misma ventana
// (±3h, el pico se corrió 1-2h entre actualizaciones), no re-notifica.
const PREAVISO_PICO_TOLERANCIA_MS = 3 * 3600000;

const TZ = "America/Argentina/Buenos_Aires";

function formatearMomento(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

// Detecta si una serie de lecturas pasó su pico reciente y viene bajando.
// Devuelve { picoTs (ms), pendiente_m_h } o null si no giró.
function detectarGiro(lecturas: LecturaRow[]): { picoTs: number; pendiente_m_h: number } | null {
  if (lecturas.length < 4) return null;
  // Entrada desc; ordenar asc.
  const asc = [...lecturas].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const n = asc.length;
  // Último pico local interior (mayor que anterior y que los 2 siguientes).
  let idxPico = -1;
  for (let i = n - 3; i >= 1; i--) {
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
  const ahoraMs = Date.now();
  if (ahoraMs - picoTs > PICO_MAX_EDAD_HS * 3600000) return null;

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
      .in("nombre", ["evaluacion", "no_retorno", "bajante_alarma", "bajante_evacuacion", "pronostico_crecida"]);

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
    const umbralProno = (umbrales as UmbralRow[]).find((u) => u.nombre === "pronostico_crecida")?.valor_m ?? 2.1;

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

    // Aviso por crecida pronosticada INA (ventana 4 días): notificar solo cuando
    // el pico supera el umbral de crecida y marca un nuevo récord (mayor al último
    // pico notificado). El récord se persiste en configuracion.
    const futurosProno = ((pronos as PronosticoRow[] | null) ?? [])
      .filter((p) => new Date(p.timestamp).getTime() >= Date.now());
    const picoProno = futurosProno.length
      ? futurosProno.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), futurosProno[0])
      : null;
    let recordProno = false;
    if (picoProno && picoProno.valor_m > umbralProno) {
      const { data: cfgRecord } = await supabase
        .from("configuracion")
        .select("valor")
        .eq("clave", "ultimo_pico_pronostico_notificado")
        .maybeSingle();
      const ultimo = cfgRecord ? parseFloat((cfgRecord as ConfigRow).valor) : -Infinity;
      if (picoProno.valor_m > ultimo) {
        recordProno = true;
        preavisos.push(
          `INA pronostica crecida de ${picoProno.valor_m.toFixed(2)}m el ${formatearMomento(picoProno.timestamp)} — supera el umbral de crecida (${umbralProno.toFixed(2)}m)`
        );
      }
    }

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
      ceseExpirado(avisoCrecidaRaw.emitido)
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
      nivelActual, tendencia,
      { evaluacion: umbralEval, noRetorno: umbralNR, bajanteAlarma, bajanteEvacuacion },
      trasladoMin, mensajes
    );

    // Elevar verde→amarilla si el pronóstico anticipa un cruce severo (no retorno o evacuación por bajante)
    const elevadoPorPronostico = alerta === "verde" && preavisosProno.severo;
    const alertaFinal: NivelAlerta = elevadoPorPronostico ? "amarilla" : alerta;

    // Si se elevó por el pronóstico, el mensaje principal no debe decir "Todo normal":
    // el estado de atención es por la crecida pronosticada, no por el nivel actual.
    const mensajeBase = elevadoPorPronostico
      ? `Atención — crecida pronosticada en San Fernando (nivel actual ${nivelActual.toFixed(2)}m)`
      : mensaje;

    const mensajeCompleto = preavisos.length
      ? `${mensajeBase} | Preaviso: ${preavisos.join("; ")}`
      : mensajeBase;

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
        pico_pronostico_m: picoProno?.valor_m ?? null,
        record_pronostico: recordProno,
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

    // Persistir el nuevo récord de pico pronosticado notificado
    if (picoProno && picoProno.valor_m > umbralProno) {
      const { data: cfgRecord } = await supabase
        .from("configuracion")
        .select("valor")
        .eq("clave", "ultimo_pico_pronostico_notificado")
        .maybeSingle();
      const ultimo = cfgRecord ? parseFloat((cfgRecord as ConfigRow).valor) : -Infinity;
      if (picoProno.valor_m > ultimo) {
        await supabase.from("configuracion").upsert(
          { clave: "ultimo_pico_pronostico_notificado", valor: picoProno.valor_m.toFixed(3) },
          { onConflict: "clave" }
        );
      }
    }

if (empeoro || recordProno) {
      const titulo =
        alertaFinal === "evacuacion"
          ? "Baliza — EVACUACIÓN"
          : alertaFinal === "roja"
            ? "Baliza — Alerta roja"
            : alertaFinal === "amarilla"
              ? "Baliza — Atención"
              : recordProno
                ? "Baliza — Crecida pronosticada"
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

    // "Ventana segura": cuando el mareógrafo pasa de subiendo→bajando tras un pico,
    // el agua ya baja y es la ventana ideal para evacuar (sale con el menor nivel).
    // Solo notifica si hubo riesgo real (> umbral de evaluación), y recién en la
    // transición, para no spamear cada subida/bajada normal del día.
    if (tendencia === "bajando" && nivelActual > umbralEval) {
      const { data: faseAnt } = await supabase
        .from("configuracion")
        .select("valor")
        .eq("clave", "ultima_fase_marcador")
        .maybeSingle();
      const faseAnterior = (faseAnt as { valor: string } | null)?.valor ?? null;
      const eraSubiendo = faseAnterior === "subiendo";

      const { data: cfgVs } = await supabase
        .from("configuracion")
        .select("valor")
        .eq("clave", "ventana_segura_notificada")
        .maybeSingle();
      const vsNotif = (cfgVs as { valor: string } | null)?.valor ?? "";

      if (eraSubiendo && vsNotif !== "1") {
        await supabase.from("configuracion").upsert(
          { clave: "ventana_segura_notificada", valor: "1" },
          { onConflict: "clave" }
        );
        const tituloSeguro = "Baliza — El agua empezó a bajar";
        const cuerpoSeguro = `Ventana segura para evacuar: el nivel bajó de su pico y ahora es ${nivelActual.toFixed(2)}m en San Fernando (bajando). Pico pronosticado pasado.`;
        try {
          await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/enviar-notificacion`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
                "x-notificacion-secret": Deno.env.get("NOTIFICACION_SECRET") ?? "",
              },
              body: JSON.stringify({ titulo: tituloSeguro, cuerpo: cuerpoSeguro, url: "/dashboard" }),
            }
          );
        } catch (vsErr) {
          console.error("[evaluar-alerta] ventana segura: error notif", vsErr);
        }
      }
    }

    // "Evacuar antes del pico": mientras el agua sube hacia un pico pronosticado
    // alto (supera el umbral de evaluación), avisa ANTES de que llegue — evitando
    // salir en el agua más alta.
    // - Solo avisa si el pico es INMINENTE (dentro de las próximas 12h), para no
    //   anticipar con días de distancia (el pronóstico marca el evento temprano).
    // - Dedup por EPISODIO con tolerancia (±3h sobre el timestamp del pico): si ya
    //   se avisó para el mismo pico (corrido 1-2h entre actualizaciones del INA),
    //   no se re-notifica. Solo re-notifica si es otra crecida.
    if (tendencia === "subiendo" && picoProno && picoProno.valor_m > umbralEval) {
      const picoMs = new Date(picoProno.timestamp).getTime();
      const esInminente = picoMs - Date.now() <= PICO_PREAVISO_MAX_HORIZONTE_HS * 3600000;
      const { data: preavisosPrevios } = await supabase
        .from("configuracion")
        .select("clave")
        .like("clave", "preaviso_pico_%");
      const clavesPrevias = (preavisosPrevios as { clave: string }[] | null) ?? [];
      const yaAvisadoMismoEpisodio = clavesPrevias.some((c) => {
        const tsPico = parseInt(c.clave.replace("preaviso_pico_", ""), 10);
        return Number.isFinite(tsPico) && Math.abs(tsPico - picoMs) <= PREAVISO_PICO_TOLERANCIA_MS;
      });
      if (esInminente && !yaAvisadoMismoEpisodio) {
        await supabase.from("configuracion").upsert(
          { clave: `preaviso_pico_${picoMs}`, valor: "1" },
          { onConflict: "clave" }
        );
        const tituloPrePico = "Baliza — El agua sigue subiendo";
        const cuerpoPrePico =
          `Aún sube y el pico pronosticado (${picoProno.valor_m.toFixed(2)}m) llega ${formatearMomento(picoProno.timestamp)} ` +
          `— por encima de la evaluación (${umbralEval.toFixed(1)}m). Si el pico es alto, evacuar ANTES de que llegue.`;
        try {
          await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/enviar-notificacion`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
                "x-notificacion-secret": Deno.env.get("NOTIFICACION_SECRET") ?? "",
              },
              body: JSON.stringify({ titulo: tituloPrePico, cuerpo: cuerpoPrePico, url: "/dashboard" }),
            }
          );
        } catch (preErr) {
          console.error("[evaluar-alerta] evacuar antes del pico: error notif", preErr);
        }
      }
    }
    // Resetea la marca de "ventana segura" cuando vuelve a subir, para el próximo ciclo.
    if (tendencia === "subiendo") {
      await supabase.from("configuracion").upsert(
        { clave: "ventana_segura_notificada", valor: "0" },
        { onConflict: "clave" }
      );
    }
    await supabase.from("configuracion").upsert(
      { clave: "ultima_fase_marcador", valor: tendencia },
      { onConflict: "clave" }
    );

    // "Exteriores bajando": cuando las estaciones exteriores pasaron su pico y
    // vienen bajando mientras SF aún está alto, es la señal adelantada de que la
    // bajada llega a SF en ~lag horas. Avisa una vez por crecida (dedup por pico).
    if (nivelActual > umbralEval) {
      let girados: { nombre: string; picoTs: number }[] = [];
      for (const nombre of EXTERIORES_GIRO) {
        const { data: extEst } = await supabase
          .from("estaciones")
          .select("id")
          .eq("nombre", nombre)
          .single();
        if (!extEst) continue;
        const { data: extLect } = await supabase
          .from("lecturas")
          .select("timestamp, nivel_m")
          .eq("estacion_id", extEst.id)
          .eq("tipo", "observado")
          .order("timestamp", { ascending: false })
          .limit(48);
        if (!extLect || extLect.length < 4) continue;
        const giro = detectarGiro(extLect as LecturaRow[]);
        if (giro && giro.pendiente_m_h < -PENDIENTE_MIN_M_H) {
          girados.push({ nombre, picoTs: giro.picoTs });
        }
      }
      if (girados.length >= GIRO_MIN_ESTACIONES) {
        const picoMasReciente = Math.max(...girados.map((g) => g.picoTs));
        const claveGiro = `exteriores_bajando_pico_${picoMasReciente}`;
        const { data: cfgGiro } = await supabase
          .from("configuracion")
          .select("valor")
          .eq("clave", claveGiro)
          .maybeSingle();
        if (!cfgGiro) {
          await supabase.from("configuracion").upsert(
            { clave: claveGiro, valor: "1" },
            { onConflict: "clave" }
          );
          const nombres = girados.map((g) => g.nombre).join(", ");
          const horaPico = new Date(picoMasReciente).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
          const tituloExt = "Baliza — El agua va a bajar";
          const cuerpoExt =
            `Las estaciones exteriores (${nombres}) ya pasaron su pico (≈ ${horaPico}) y están bajando — ` +
            `el agua en San Fernando tocará su pico pronto y empezará a bajar (retraso ~${Math.round(PROPAGACION_LP_A_SF)}hs). ` +
            `Si el nivel aún es alto, conviene esperar a que baje en vez de evacuar en el pico.`;
          try {
            await fetch(
              `${Deno.env.get("SUPABASE_URL")}/functions/v1/enviar-notificacion`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
                  "x-notificacion-secret": Deno.env.get("NOTIFICACION_SECRET") ?? "",
                },
                body: JSON.stringify({ titulo: tituloExt, cuerpo: cuerpoExt, url: "/dashboard" }),
              }
            );
          } catch (extErr) {
            console.error("[evaluar-alerta] exteriores bajando: error notif", extErr);
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, alerta: alertaRow, notifico: empeoro || recordProno }), {
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
