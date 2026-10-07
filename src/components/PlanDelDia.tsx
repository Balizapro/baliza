import type { VeredictoDia } from "@/lib/planEscolar";
import { hhmm } from "@/lib/planEscolar";
import { etiquetaDiaSemana } from "@/lib/dashboardHelpers";

interface Props {
  veredicto: VeredictoDia | null;
  nivelSeguroM: number;
  onVerDetalle?: () => void;
  hayDetalleTecnico: boolean;
  // Veredicto de los días siguientes (mismo modo conservador). Sin esto, "Plan de hoy:
  // Día normal" convive con un banner de crecida pronosticada para el viernes y parece
  // una contradicción; con esto la tarjeta dice también qué pasa los próximos días.
  proximos?: { fecha: string; veredicto: VeredictoDia }[];
}

function resumenDia(v: VeredictoDia): { icono: string; texto: string } {
  if (!v.esDiaEscolar) return { icono: "📅", texto: "sin clases" };
  if (v.estado === "normal") return { icono: "✅", texto: "normal" };
  if (v.estado === "salida_temprana") {
    return { icono: "⚠️", texto: v.salidaLimiteMin != null ? `salida antes de las ${hhmm(v.salidaLimiteMin)}` : "salida temprana" };
  }
  if (v.estado === "no_clases") return { icono: "🚫", texto: "no ir" };
  return { icono: "❔", texto: "sin datos" };
}

const ESTILO: Record<string, { clase: string; icono: string; titulo: string }> = {
  normal: { clase: "pdh-normal", icono: "✅", titulo: "Día normal" },
  salida_temprana: { clase: "pdh-atencion", icono: "⚠️", titulo: "Salida temprana" },
  no_clases: { clase: "pdh-critico", icono: "🚫", titulo: "No ir a la escuela" },
  sin_datos: { clase: "pdh-sindatos", icono: "❔", titulo: "Sin datos suficientes" },
};

/**
 * Bloque fijo, siempre visible, con el plan de HOY resumido en un solo
 * veredicto (modo conservador — el mismo que usa el resto de la app para
 * decisiones de seguridad). A diferencia del panel técnico detallado (que
 * solo aparece cuando ya hay riesgo detectado en el pronóstico), este bloque
 * está pensado para chequearse como rutina todas las mañanas, tenga o no
 * riesgo el día, así el panel detallado no es la primera vez que alguien
 * lo ve bajo presión real.
 */
export default function PlanDelDia({ veredicto, nivelSeguroM, onVerDetalle, hayDetalleTecnico, proximos }: Props) {
  if (!veredicto) return null;

  const proximosEl = proximos && proximos.length > 0 ? (
    <ul className="pdh-proximos" aria-label="Plan de los próximos días">
      {proximos.map(({ fecha, veredicto: v }) => {
        const r = resumenDia(v);
        return (
          <li key={fecha}>
            <span className="pdh-prox-dia">{etiquetaDiaSemana(fecha)}</span>{" "}
            <span aria-hidden="true">{r.icono}</span> {r.texto}
          </li>
        );
      })}
    </ul>
  ) : null;

  // Día sin clases (fin de semana / feriado escolar): el veredicto técnico
  // cae a "normal" por default, pero mostrar "Día normal" ahí se lee como
  // "vengan" — más claro decir directamente que no hay clases.
  if (!veredicto.esDiaEscolar) {
    return (
      <div className="pdh pdh-sindatos">
        <span className="pdh-icono" aria-hidden="true">📅</span>
        <div className="pdh-cuerpo">
          <p className="pdh-etiqueta">Plan de hoy</p>
          <p className="pdh-titulo">No hay clases hoy</p>
          {proximosEl}
        </div>
      </div>
    );
  }

  const e = ESTILO[veredicto.estado] ?? ESTILO.sin_datos;

  return (
    <div className={`pdh ${e.clase}`} role="status">
      <span className="pdh-icono" aria-hidden="true">{e.icono}</span>
      <div className="pdh-cuerpo">
        <p className="pdh-etiqueta">Plan de hoy</p>
        <p className="pdh-titulo">
          {e.titulo}
          {veredicto.estado === "salida_temprana" && veredicto.salidaLimiteMin != null && (
            <> — antes de las <strong>{hhmm(veredicto.salidaLimiteMin)}</strong></>
          )}
        </p>
        {veredicto.estado !== "sin_datos" && (
          <p className="pdh-confianza">
            Confianza {veredicto.confianza} · nivel seguro {nivelSeguroM.toFixed(2)}m
          </p>
        )}
        {proximosEl}
        {hayDetalleTecnico && onVerDetalle && (
          <button type="button" className="pdh-ver-mas" onClick={onVerDetalle}>
            Ver plan detallado ↓
          </button>
        )}
      </div>
    </div>
  );
}
