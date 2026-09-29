import type { VeredictoDia } from "@/lib/planEscolar";
import { hhmm } from "@/lib/planEscolar";

interface Props {
  veredicto: VeredictoDia | null;
  nivelSeguroM: number;
  onVerDetalle?: () => void;
  hayDetalleTecnico: boolean;
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
export default function PlanDelDia({ veredicto, nivelSeguroM, onVerDetalle, hayDetalleTecnico }: Props) {
  if (!veredicto) return null;

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
        {hayDetalleTecnico && onVerDetalle && (
          <button type="button" className="pdh-ver-mas" onClick={onVerDetalle}>
            Ver plan detallado ↓
          </button>
        )}
      </div>
    </div>
  );
}
