import { useMemo } from "react";
import type { Alerta, Lectura, Pronostico, AvisoShn } from "@/lib/types";
import { analizarCiclo, predecirProximosExtremos } from "@/lib/ciclo";
import { calcularVeredicto } from "@/lib/planEscolar";
import { alturasSanFernando } from "@/lib/shn";
import { proyectarCurva } from "@/lib/modelo";
import { enHorarioEscolar, fechaDiaArgentina } from "@/lib/dashboardHelpers";

interface VientoPunto {
  timestamp: string;
  velocidad_kmh: number;
  direccion_grados: number;
  presion_hpa?: number | null;
}

interface Params {
  alerta: Alerta | null | undefined;
  sfObs: Lectura | null | undefined;
  sfProno: Pronostico[] | undefined;
  avisosShn: AvisoShn[] | undefined;
  historial: Lectura[];
  lecturasLP: Lectura[];
  vientoHist: VientoPunto[];
  vientoProno: VientoPunto[];
  nivelSeguroM: number;
  diasSinClases: string[];
  exterioresLecturas: { nombre: string; lecturas: Lectura[] }[];
  ahora: number;
}

// Cálculos derivados de los datos crudos (fetch) + el reloj `ahora`. Extraído
// tal cual de dashboard/page.tsx — mismas dependencias, mismo orden, mismo
// comportamiento, solo reubicado a un hook para separar cálculo de JSX.
export function useCalculosDerivados({
  alerta,
  sfObs,
  sfProno,
  avisosShn,
  historial,
  lecturasLP,
  vientoHist,
  vientoProno,
  nivelSeguroM,
  diasSinClases,
  exterioresLecturas,
  ahora,
}: Params) {
  // Conteos derivados de `ahora` (sin setState en effects): cuenta regresiva hasta
  // el punto de no retorno y hasta el pico pronosticado.
  const cuentaRegresiva = useMemo(() => {
    const ventanaFin = alerta?.ventana_fin;
    if (!ventanaFin) return null;
    const diff = new Date(ventanaFin).getTime() - ahora;
    if (diff <= 0) return "AHORA";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${h}h ${m}m`;
  }, [alerta?.ventana_fin, ahora]);

  const cuentaPico = useMemo(() => {
    const futuros = (sfProno ?? [])
      .filter((p) => p.qualifier === "main")
      .filter((p) => new Date(p.timestamp).getTime() >= ahora)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const pico = futuros.length > 0
      ? futuros.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), futuros[0])
      : null;
    if (!pico) return null;
    const diff = new Date(pico.timestamp).getTime() - ahora;
    if (diff <= 0) return "PICO AHORA";
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  }, [sfProno, ahora]);

  // Entrada del componente de curva: viento histórico y pronóstico como ms
  const vientoHistoricoModelo = useMemo(
    () => vientoHist.map((v) => ({ timestamp: new Date(v.timestamp).getTime(), velocidad_kmh: v.velocidad_kmh, direccion_grados: v.direccion_grados, presion_hpa: v.presion_hpa })),
    [vientoHist]
  );
  const vientoPronosticoModelo = useMemo(
    () => vientoProno.map((v) => ({ timestamp: new Date(v.timestamp).getTime(), velocidad_kmh: v.velocidad_kmh, direccion_grados: v.direccion_grados, presion_hpa: v.presion_hpa })),
    [vientoProno]
  );

  // Proyección del modelo propio (armónico + viento + persistencia) como curva
  // de puntos; se pasa al plan del día como fuente adicional (peor de ambos).
  const curvaModelo = useMemo(() => {
    if (historial.length === 0) return [];
    const lecturas: { timestamp: string; nivel_m: number }[] = historial
      .filter((l) => l.nivel_m != null)
      .map((l) => ({ timestamp: l.timestamp, nivel_m: l.nivel_m }));
    const vientos = [...vientoHistoricoModelo, ...vientoPronosticoModelo];
    const proy = proyectarCurva(lecturas, vientos, ahora, 72, 15);
    return proy.puntos.map((p) => ({ timestamp: new Date(p.timestamp).toISOString(), nivel_m: p.nivel_m }));
  }, [historial, vientoHistoricoModelo, vientoPronosticoModelo, ahora]);

  // Pleamares/bajamares del SHN para San Fernando: se toma el radioaviso más
  // reciente QUE CONTENGA la tabla mareológica (los avisos de navegación sin
  // alturas no deben tapar el último boletín válido).
  const shnAlturas = useMemo(() => {
    const avisos = [...(avisosShn ?? [])].sort(
      (a, b) => new Date(b.actualizado).getTime() - new Date(a.actualizado).getTime()
    );
    for (const a of avisos) {
      const alturas = alturasSanFernando(a.texto);
      if (alturas.length > 0) return alturas;
    }
    return [];
  }, [avisosShn]);

  // Estado del muelle: NO accesible mientras SF supera el nivel seguro (2.25m).
  // Cuando hay un pico pronosticado que supera el límite dentro del horario
  // escolar de un día próximo, se arma un "plan del día" (veredicto: entrada
  // 8:00, vuelta 14:15, hora de veredicto 7:00, hora límite de salida y
  // confianza por bandas p25/p95) para anticipar el cruce por lancha.
  const muelleAcceso = useMemo(() => {
    const nivel = sfObs?.nivel_m ?? null;
    const noAccesible = nivel != null && nivel > nivelSeguroM;
    const futuros = (sfProno ?? [])
      .filter((p) => p.qualifier === "main")
      .filter((p) => new Date(p.timestamp).getTime() >= ahora)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const regreso = futuros.find((p) => p.valor_m <= nivelSeguroM) ?? null;
    const picoNoAccesible = futuros.find(
      (p) => p.valor_m > nivelSeguroM && enHorarioEscolar(p.timestamp, diasSinClases) === true
    ) ?? null;

    // Veredicto escolar del día del pico (lógica compartida, ver src/lib/planEscolar.ts).
    // Cubre 7:00 (hora de decisión), 8:00 (entrada) y 14:15 (vuelta), más la hora
    // límite de salida cuando la vuelta queda cortada y la confianza por bandas
    // p25/p95 del pronóstico INA. Se calcula en tres modos para ver la sensibilidad
    // del veredicto y elegir con cuál manejarse:
    //  - "estricto": peor fuente con bandas p75, sesgo en vivo y margen por crecida.
    //  - "suave": pronóstico central (INA main, modelo y SHN), sin penalizaciones.
    //  - "modelo": EL PROPIO MODELO solo (la curva armónico+viento como main), sin
    //    INA ni bandas ni sesgo; útil cuando INA y modelo no coinciden en la tarde.
    const fuentesPlan = {
      modelo: curvaModelo,
      shnObservado: historial
        .filter((l) => l.nivel_m != null)
        .map((l) => ({ timestamp: l.timestamp, nivel_m: l.nivel_m })),
      shnAlturas,
      // Estaciones vecinas (Bs As, La Plata...) para anticipar crecidas por
      // pendiente de subida: la marea entra por el estuario y llega a SF con
      // desfase, así que una subida fuerte afuera anticipa la de SF.
      vecinas: exterioresLecturas.map((e) => ({
        nombre: e.nombre,
        lecturas: e.lecturas
          .filter((l) => l.nivel_m != null)
          .map((l) => ({ timestamp: l.timestamp, nivel_m: l.nivel_m })),
      })),
    };

    let veredicto: ReturnType<typeof calcularVeredicto> | null = null;
    let veredictoSuave: ReturnType<typeof calcularVeredicto> | null = null;
    let veredictoModelo: ReturnType<typeof calcularVeredicto> | null = null;
    if (picoNoAccesible) {
      const dia = fechaDiaArgentina(picoNoAccesible.timestamp);
      if (dia) {
        veredicto = calcularVeredicto(sfProno ?? [], dia, nivelSeguroM, diasSinClases, fuentesPlan, "estricto");
        veredictoSuave = calcularVeredicto(sfProno ?? [], dia, nivelSeguroM, diasSinClases, fuentesPlan, "suave");
        // Modelo solo: la curva propia como único pronóstico (main), sin INA/sesgo.
        if (curvaModelo.length > 0) {
          const pronosModelo: Parameters<typeof calcularVeredicto>[0] = curvaModelo.map((p) => ({
            timestamp: p.timestamp,
            valor_m: p.nivel_m,
            qualifier: "main" as const,
          }));
          veredictoModelo = calcularVeredicto(pronosModelo, dia, nivelSeguroM, diasSinClases, {}, "suave");
        }
      }
    }

    // Veredicto de HOY, siempre calculado (no solo cuando hay riesgo detectado
    // más adelante). Es la base del bloque fijo "Plan de hoy" que se muestra
    // siempre arriba, para que revisarlo sea un hábito diario y no algo que
    // solo aparece el día que ya hay un problema.
    const hoyStr = fechaDiaArgentina(new Date().toISOString());
    const veredictoHoy = hoyStr
      ? calcularVeredicto(sfProno ?? [], hoyStr, nivelSeguroM, diasSinClases, fuentesPlan, "estricto")
      : null;

    return { noAccesible, nivel, regreso, tieneProno: futuros.length > 0, picoNoAccesible, veredicto, veredictoSuave, veredictoModelo, veredictoHoy };
  }, [sfObs, sfProno, nivelSeguroM, ahora, diasSinClases, curvaModelo, shnAlturas, historial, exterioresLecturas]);

  const ciclo = useMemo(
    () => analizarCiclo(historial, lecturasLP.slice(0, 24), 2.5, ahora),
    [historial, lecturasLP, ahora]
  );

  // Predicción de próximos extremos (pleamar/bajamar) a partir de la regularidad
  // del ciclo observado en SF (~12.4h semidiurno). Recálculo periódico con `ahora`.
  const prediccionExtremos = useMemo(
    () => predecirProximosExtremos(historial, ahora),
    [historial, ahora]
  );

  return {
    cuentaRegresiva,
    cuentaPico,
    vientoHistoricoModelo,
    vientoPronosticoModelo,
    curvaModelo,
    shnAlturas,
    muelleAcceso,
    ciclo,
    prediccionExtremos,
  };
}
