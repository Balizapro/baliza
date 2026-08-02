import type { EquivalenciaEscalon, Umbral, NivelAlerta } from "@/lib/types";

interface Props {
  nivelActual: number;
  tendencia: string;
  timestamp: string;
  escalones: EquivalenciaEscalon[];
  umbralEval: Umbral | null;
  umbralNR: Umbral | null;
  umbralBajAlarma: Umbral | null;
  umbralBajEvac: Umbral | null;
  alertaNivel: NivelAlerta;
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function EscalaHidrometro({ nivelActual, tendencia, timestamp, escalones, umbralEval, umbralNR, umbralBajAlarma, umbralBajEvac, alertaNivel }: Props) {
  const umbralMax = Math.max(umbralNR?.valor_m ?? 2.2, umbralEval?.valor_m ?? 2.0);
  const maxEscalon = escalones.length > 0 ? escalones[escalones.length - 1].nivel_max_m : umbralMax + 0.5;
  const escalaTecho = Math.max(maxEscalon + 0.2, nivelActual + 0.3, umbralMax + 0.3);
  const bajanteMin = Math.min(umbralBajEvac?.valor_m ?? -0.1, umbralBajAlarma?.valor_m ?? 0);
  const escalaPiso = Math.min(escalones.length > 0 ? escalones[0].nivel_min_m : 0, nivelActual - 0.2, bajanteMin - 0.2);

  const rango = Math.max(escalaTecho - escalaPiso, 1);
  const H = 360;
  const barraX = 70;
  const barraW = 40;
  const labelX = barraX + barraW + 12;
  const scalasX = barraX - 10;
  const gaugeW = labelX + 110;

  function yPos(val: number): number {
    return H - ((val - escalaPiso) / rango) * (H - 20) - 10;
  }

  function escalonColor(e: number): string {
    const colores = ["#4C7A5E", "#6A9B7E", "#88B89E", "#A6D5BE", "#C99A3D", "#E8823A", "#C0442B"];
    return colores[(e - 1) % colores.length];
  }

  const nivelColor =
    alertaNivel === "roja" ? "#C0442B"
    : alertaNivel === "evacuacion" ? "#8B1E1E"
    : alertaNivel === "amarilla" ? "#E8823A"
    : alertaNivel === "azul" ? "#2563EB"
    : "#0E4749";
  const alertaBg =
    alertaNivel === "roja" || alertaNivel === "evacuacion" ? "bg-[#C0442B]/10"
    : alertaNivel === "amarilla" ? "bg-[#E8823A]/10"
    : alertaNivel === "azul" ? "bg-[#2563EB]/10"
    : "bg-transparent";

  return (
    <section className={`relative ${alertaBg} rounded-xl p-4 sm:p-5`}>
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-2.5 h-2.5 rounded-full ${alertaNivel === "roja" || alertaNivel === "evacuacion" ? "bg-[#C0442B]" : alertaNivel === "amarilla" ? "bg-[#E8823A]" : alertaNivel === "azul" ? "bg-[#2563EB]" : "bg-[#4C7A5E]"}`} />
        <p className="font-serif text-sm uppercase tracking-widest text-[#5B6E68] dark:text-gray-400">
          San Fernando — brazo Luján
        </p>
      </div>

      <div className="flex gap-6 sm:gap-8 items-start">
        {/* Vertical gauge */}
        <div className="relative flex-shrink-0" style={{ width: gaugeW, height: H }}>
          <svg width={gaugeW} height={H} className="overflow-visible">
            {/* Barra de fondo */}
            <rect x={barraX} y={10} width={barraW} height={H - 20} rx={4} className="fill-[#E8DFD0] dark:fill-[#334155]" />

            {/* Zonas de color por escalón */}
            {escalones.map((e) => (
              <rect
                key={e.escalon}
                x={barraX}
                y={yPos(e.nivel_max_m)}
                width={barraW}
                height={Math.max(yPos(e.nivel_min_m) - yPos(e.nivel_max_m), 2)}
                rx={2}
                fill={escalonColor(e.escalon)}
                fillOpacity={0.35}
              />
            ))}

            {/* Borde de la barra */}
            <rect x={barraX} y={10} width={barraW} height={H - 20} rx={4} fill="none" stroke="#0E4749" strokeWidth={1} strokeOpacity={0.2} />

            {/* Línea umbral evaluación */}
            {umbralEval && (
              <g>
                <line x1={barraX - 4} y1={yPos(umbralEval.valor_m)} x2={barraX + barraW + 4} y2={yPos(umbralEval.valor_m)} stroke="#C99A3D" strokeWidth={1.5} strokeDasharray="4,3" />
                <text x={labelX + 60} y={yPos(umbralEval.valor_m) + 3} fontSize="9" fill="#C99A3D" fontFamily="ui-monospace, monospace" textAnchor="end">{umbralEval.valor_m.toFixed(2)}m</text>
                <text x={labelX + 62} y={yPos(umbralEval.valor_m) + 3} fontSize="8" fill="#C99A3D" textAnchor="start">eval</text>
              </g>
            )}

            {/* Línea umbral no retorno */}
            {umbralNR && (
              <g>
                <line x1={barraX - 4} y1={yPos(umbralNR.valor_m)} x2={barraX + barraW + 4} y2={yPos(umbralNR.valor_m)} stroke="#C0442B" strokeWidth={1.5} strokeDasharray="4,3" />
                <text x={labelX + 60} y={yPos(umbralNR.valor_m) + 3} fontSize="9" fill="#C0442B" fontFamily="ui-monospace, monospace" textAnchor="end">{umbralNR.valor_m.toFixed(2)}m</text>
                <text x={labelX + 62} y={yPos(umbralNR.valor_m) + 3} fontSize="8" fill="#C0442B" textAnchor="start">NR</text>
              </g>
            )}

            {/* Línea umbral bajante alarma */}
            {umbralBajAlarma && (
              <g>
                <line x1={barraX - 4} y1={yPos(umbralBajAlarma.valor_m)} x2={barraX + barraW + 4} y2={yPos(umbralBajAlarma.valor_m)} stroke="#2563EB" strokeWidth={1.5} strokeDasharray="4,3" />
                <text x={labelX + 60} y={yPos(umbralBajAlarma.valor_m) + 3} fontSize="9" fill="#2563EB" fontFamily="ui-monospace, monospace" textAnchor="end">{umbralBajAlarma.valor_m.toFixed(2)}m</text>
                <text x={labelX + 62} y={yPos(umbralBajAlarma.valor_m) + 3} fontSize="8" fill="#2563EB" textAnchor="start">baj.</text>
              </g>
            )}

            {/* Línea umbral bajante evacuación */}
            {umbralBajEvac && (
              <g>
                <line x1={barraX - 4} y1={yPos(umbralBajEvac.valor_m)} x2={barraX + barraW + 4} y2={yPos(umbralBajEvac.valor_m)} stroke="#8B1E1E" strokeWidth={1.5} strokeDasharray="4,3" />
                <text x={labelX + 60} y={yPos(umbralBajEvac.valor_m) + 3} fontSize="9" fill="#8B1E1E" fontFamily="ui-monospace, monospace" textAnchor="end">{umbralBajEvac.valor_m.toFixed(2)}m</text>
                <text x={labelX + 62} y={yPos(umbralBajEvac.valor_m) + 3} fontSize="8" fill="#8B1E1E" textAnchor="start">evac</text>
              </g>
            )}

            {/* Marcas de escalón (en el lado izquierdo de la barra) */}
            {escalones.map((e) => (
              <g key={e.escalon}>
                <text x={scalasX} y={yPos((e.nivel_min_m + e.nivel_max_m) / 2) + 3} fontSize="9" fill="#5B6E68" textAnchor="end" fontFamily="ui-monospace, monospace">e{e.escalon}</text>
                <line x1={barraX - 2} y1={yPos(e.nivel_min_m)} x2={barraX} y2={yPos(e.nivel_min_m)} stroke="#5B6E68" strokeWidth={0.5} />
                <line x1={barraX - 2} y1={yPos(e.nivel_max_m)} x2={barraX} y2={yPos(e.nivel_max_m)} stroke="#5B6E68" strokeWidth={0.5} />
              </g>
            ))}

            {/* Marcador de nivel actual */}
            {nivelActual != null && (
              <g>
                <polygon
                  points={`${barraX - 2},${yPos(nivelActual)} ${barraX - 10},${yPos(nivelActual) - 5} ${barraX - 10},${yPos(nivelActual) + 5}`}
                  fill={nivelColor}
                />
                <line x1={barraX} y1={yPos(nivelActual)} x2={barraX + barraW} y2={yPos(nivelActual)} stroke={nivelColor} strokeWidth={2.5} />
                <circle cx={barraX + barraW / 2} cy={yPos(nivelActual)} r={5} fill={nivelColor} stroke="white" strokeWidth={2} />
                <text x={labelX + 60} y={yPos(nivelActual) - 6} fontSize="11" fontWeight="bold" fill={nivelColor} fontFamily="ui-monospace, monospace" textAnchor="end">
                  {nivelActual.toFixed(2)}m
                </text>
              </g>
            )}
          </svg>
        </div>

        {/* Info panel right side */}
        <div className="flex-1 min-w-0 pt-1">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <p className="text-xs text-[#5B6E68] dark:text-gray-400 uppercase tracking-wide">Nivel actual</p>
              <p className="font-mono text-3xl sm:text-4xl font-bold text-[#0E4749] dark:text-[#4fc3c5] leading-tight">
                {nivelActual != null ? `${nivelActual.toFixed(2)}m` : "--"}
                <span className="text-base sm:text-lg ml-2 font-sans text-[#5B6E68] dark:text-gray-400">{tendencia}</span>
              </p>
            </div>

            <div className="text-xs text-[#5B6E68] dark:text-gray-400 font-mono">
              {timestamp ? formatearFecha(timestamp) : "--"}
            </div>

            <div className="text-sm">
              {escalones.filter((e) => nivelActual >= e.nivel_min_m && nivelActual < e.nivel_max_m).map((e) => (
                <p key={e.escalon}>
                  <span className="font-bold text-[#0E4749] dark:text-[#4fc3c5]">Escalón e{e.escalon}</span>
                  <span className="text-[#5B6E68] dark:text-gray-400 ml-1">({e.nivel_min_m.toFixed(1)}–{e.nivel_max_m.toFixed(1)}m)</span>
                </p>
              ))}
              {!escalones.some((e) => nivelActual >= e.nivel_min_m && nivelActual < e.nivel_max_m) && (
                <p className="text-[#5B6E68] dark:text-gray-400">
                  {nivelActual < escalones[0]?.nivel_min_m ? "Debajo del escalón mínimo" : `Sobre escalón ${escalones[escalones.length - 1]?.escalon}`}
                </p>
              )}
            </div>
          </div>

          <div className="mt-3 border-t border-[#D4C9B8] dark:border-gray-700 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            {umbralEval && (
              <p className="flex items-center gap-2">
                <span className="w-3 h-[2px] bg-[#C99A3D] inline-block" />
                <span className="text-[#5B6E68] dark:text-gray-400">Evaluación: <strong className="font-mono text-[#C99A3D]">{umbralEval.valor_m.toFixed(2)}m</strong></span>
              </p>
            )}
            {umbralNR && (
              <p className="flex items-center gap-2">
                <span className="w-3 h-[2px] bg-[#C0442B] inline-block" />
                <span className="text-[#5B6E68] dark:text-gray-400">No retorno: <strong className="font-mono text-[#C0442B]">{umbralNR.valor_m.toFixed(2)}m</strong></span>
              </p>
            )}
            {umbralBajAlarma && (
              <p className="flex items-center gap-2">
                <span className="w-3 h-[2px] bg-[#2563EB] inline-block" />
                <span className="text-[#5B6E68] dark:text-gray-400">Bajante alarma: <strong className="font-mono text-[#2563EB]">{umbralBajAlarma.valor_m.toFixed(2)}m</strong></span>
              </p>
            )}
            {umbralBajEvac && (
              <p className="flex items-center gap-2">
                <span className="w-3 h-[2px] bg-[#8B1E1E] inline-block" />
                <span className="text-[#5B6E68] dark:text-gray-400">Bajante evacuación: <strong className="font-mono text-[#8B1E1E]">{umbralBajEvac.valor_m.toFixed(2)}m</strong></span>
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
