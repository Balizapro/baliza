"use client";

import type { Lectura, Pronostico, Viento, AvisoShn, AlertaSmn } from "@/lib/types";
import { useAhora } from "@/lib/useAhora";

interface Props {
  observadoSF: Lectura | null | undefined;
  pronosticos: Pronostico[];
  viento: Viento | null | undefined;
  avisosShn: AvisoShn[];
  alertasSmn: AlertaSmn[];
}

function estadoFuente(
  nombre: string,
  ts: number | null,
  toleranciaHs: number,
  hoy = Date.now()
): { nombre: string; ok: boolean; detalle: string } {
  if (!ts) return { nombre, ok: false, detalle: "sin datos" };
  const hs = (hoy - ts) / 3600000;
  const ok = hs <= toleranciaHs && hs >= 0;
  const cuando = hs < 1
    ? `hace ${Math.max(0, Math.round(hs * 60))} min`
    : hs < 24
      ? `hace ${hs.toFixed(0)} h`
      : `hace ${(hs / 24).toFixed(1)} d`;
  return { nombre, ok, detalle: `${cuando} · ${new Date(ts).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` };
}

export default function EstadoFuentes({ observadoSF, pronosticos, viento, avisosShn, alertasSmn }: Props) {
  const hoy = useAhora();

  const obsTs = observadoSF ? new Date(observadoSF.timestamp).getTime() : null;
  // El pronóstico se emite por ciclos: la frescura se mide con la última fecha de emisión (forecast_date)
  const pronoEmision = pronosticos.length > 0
    ? pronosticos.reduce((maxF, p) => (p.forecast_date > maxF ? p.forecast_date : maxF), pronosticos[0].forecast_date)
    : null;
  const pronoTs = pronoEmision ? new Date(pronoEmision).getTime() : null;
  const vientoTs = viento ? new Date(viento.timestamp).getTime() : null;
  const shnTs = avisosShn.length > 0 ? new Date(avisosShn[0].actualizado).getTime() : null;
  const smnTs = alertasSmn.length > 0
    ? alertasSmn.reduce((maxT, a) => {
        const t = new Date(a.actualizado).getTime();
        return isNaN(t) ? maxT : Math.max(maxT, t);
      }, new Date(alertasSmn[0].actualizado).getTime())
    : null;

  const fuentes = [
    estadoFuente("INA — observado", obsTs, 6, hoy),
    estadoFuente("INA — pronóstico", pronoTs, 30, hoy),
    estadoFuente("SMN — alertas", smnTs, 36, hoy),
    estadoFuente("SHN — avisos", shnTs, 48, hoy),
    estadoFuente("Viento", vientoTs, 12, hoy),
  ];

  const fallos = fuentes.filter((f) => !f.ok);

  return (
    <section className="dashboard-section">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="seccion-titulo">Salud de fuentes</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${fallos.length === 0 ? "text-ok border-ok/50 bg-ok/10" : "text-rojo-alerta border-rojo-alerta/50 bg-rojo-alerta/10"}`}>
          {fallos.length === 0 ? "Todas activas" : `${fallos.length} con problema`}
        </span>
      </div>

      {fallos.length > 0 && (
        <div className="mb-2 rounded-lg border border-rojo-alerta/40 bg-rojo-alerta/5 px-3 py-2 text-sm text-rojo-oscuro dark:text-red-300 flex items-start gap-2">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true"><path d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z"/></svg>
          <span>
            Estas fuentes no se actualizan hace tiempo. Los datos pueden estar desactualizados o la ingesta falló:
            {fallos.map((f) => f.nombre).join(", ")}.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {fuentes.map((f) => (
          <div key={f.nombre} className="flex items-center justify-between text-sm">
            <span className="text-texto-sec dark:text-gray-400">{f.nombre}</span>
            <span className={`flex items-center gap-1.5 ${f.ok ? "text-ok" : "text-rojo-alerta font-medium"}`}>
              <span className={`inline-block w-2 h-2 rounded-full ${f.ok ? "bg-ok" : "bg-rojo-alerta"}`} />
              {f.detalle}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
