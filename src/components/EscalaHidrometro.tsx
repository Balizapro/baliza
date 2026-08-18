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

function escalonColor(e: number): string {
  const colores = ["#4C7A5E", "#6A9B7E", "#88B89E", "#A6D5BE", "#C99A3D", "#E8823A", "#C0442B"];
  return colores[(e - 1) % colores.length];
}

export default function EscalaHidrometro({ nivelActual, tendencia, timestamp, escalones, umbralEval, umbralNR, umbralBajAlarma, umbralBajEvac, alertaNivel }: Props) {
  const umbralMax = Math.max(umbralNR?.valor_m ?? 2.2, umbralEval?.valor_m ?? 2.0);
  const maxEscalon = escalones.length > 0 ? escalones[escalones.length - 1].nivel_max_m : umbralMax + 0.5;
  const escalaTecho = Math.max(maxEscalon + 0.2, nivelActual + 0.3, umbralMax + 0.3);
  const bajanteMin = Math.min(umbralBajEvac?.valor_m ?? -0.1, umbralBajAlarma?.valor_m ?? 0);
  const escalaPiso = Math.min(escalones.length > 0 ? escalones[0].nivel_min_m : 0, nivelActual - 0.2, bajanteMin - 0.2);

  const rango = Math.max(escalaTecho - escalaPiso, 1);

  // Layout del gauge
  const H = 380;
  const padTop = 16;
  const padBot = 22;
  const tickX = 34; // fin de las etiquetas de la escala numérica
  const barraX = 48; // borde izquierdo de la barra
  const barraW = 34;
  const barraRight = barraX + barraW;
  const estX = barraRight + 10; // etiquetas e1..eN
  const umbX = barraRight + 44; // pills de umbral
  const gaugeW = 262;

  function yPos(val: number): number {
    return H - padBot - ((val - escalaPiso) / rango) * (H - padTop - padBot);
  }

  // Escala numérica: ticks cada 0.5 m (y algunos 0.25 en líneas tenues)
  const ticks = [] as number[];
  for (let v = Math.ceil(escalaPiso * 2) / 2; v <= escalaTecho + 1e-9; v += 0.5) {
    ticks.push(Math.round(v * 100) / 100);
  }

  const nivelColor =
    alertaNivel === "roja" ? "var(--color-rojo-alerta)"
    : alertaNivel === "evacuacion" ? "var(--color-rojo-oscuro)"
    : alertaNivel === "amarilla" ? "var(--color-alerta)"
    : alertaNivel === "azul" ? "var(--color-bajante)"
    : "#0E4749";
  const alertaBg =
    alertaNivel === "roja" || alertaNivel === "evacuacion" ? "bg-rojo-alerta/10"
    : alertaNivel === "amarilla" ? "bg-alerta/10"
    : alertaNivel === "azul" ? "bg-bajante/10"
    : "bg-transparent";

  const escalonActual = escalones.find((e) => nivelActual != null && nivelActual >= e.nivel_min_m && nivelActual < e.nivel_max_m) ?? null;

  // Línea del umbral: punteada a lo ancho de la barra + pill de texto a la derecha
  const umbral = (etiqueta: string, umbral: Umbral | null, color: string) => {
    if (!umbral) return null;
    const y = Math.min(Math.max(yPos(umbral.valor_m), padTop + 8), H - padBot - 8);
    return (
      <g key={etiqueta}>
        <line x1={barraX} y1={y} x2={barraRight} y2={y} stroke={color} strokeWidth={1.5} strokeDasharray="5,4" />
        <rect x={umbX} y={y - 9} width={72} height={18} rx={9} className="fill-fondo dark:fill-panel-dark" stroke={color} strokeWidth={1} />
        <text x={umbX + 30} y={y + 3.5} fontSize="10" fill={color} textAnchor="middle" fontFamily="ui-monospace, monospace" fontWeight="600">
          {etiqueta} {umbral.valor_m.toFixed(2)}m
        </text>
      </g>
    );
  };

  return (
    <section className={`relative ${alertaBg} rounded-xl p-4 sm:p-5`}>
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-2.5 h-2.5 rounded-full ${alertaNivel === "roja" || alertaNivel === "evacuacion" ? "bg-rojo-alerta" : alertaNivel === "amarilla" ? "bg-alerta" : alertaNivel === "azul" ? "bg-bajante" : "bg-ok"}`} />
        <p className="font-serif text-sm uppercase tracking-widest text-texto-sec dark:text-gray-400">
          San Fernando — brazo Luján
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 items-start">
        {/* Gauge vertical */}
        <div className="relative flex-shrink-0 mx-auto sm:mx-0" style={{ width: gaugeW, height: H }}>
          <svg width={gaugeW} height={H} className="overflow-visible">
            {/* Escala numérica (ticks) */}
            {ticks.map((t) => {
              const y = yPos(t);
              const esPrincipal = Math.abs((t * 100) % 50) < 1;
              return (
                <g key={t}>
                  <line
                    x1={tickX - 4}
                    y1={y}
                    x2={esPrincipal ? barraRight : barraX}
                    y2={y}
                    stroke="var(--chart-grid)"
                    strokeWidth={esPrincipal ? 1 : 0.5}
                    strokeDasharray={esPrincipal ? "none" : "2,3"}
                  />
                  <text x={tickX - 7} y={y + 3} fontSize="9" fill="var(--chart-axis)" textAnchor="end" fontFamily="ui-monospace, monospace">
                    {t.toFixed(2)}
                  </text>
                </g>
              );
            })}

            {/* Fondo de la barra */}
            <rect x={barraX} y={padTop} width={barraW} height={H - padTop - padBot} rx={6} className="fill-gauge-bg dark:fill-border-dark" stroke="var(--chart-grid)" strokeWidth={1} />

            {/* Segmentos por escalón */}
            {escalones.map((e) => {
              const yMax = yPos(e.nivel_max_m);
              const yMin = yPos(e.nivel_min_m);
              const alto = Math.max(yMin - yMax, 4);
              const color = escalonColor(e.escalon);
              return (
                <g key={e.escalon}>
                  <rect
                    x={barraX}
                    y={yMax}
                    width={barraW}
                    height={alto}
                    rx={3}
                    fill={color}
                    fillOpacity={e.escalon === escalonActual?.escalon ? 0.9 : 0.45}
                    stroke={color}
                    strokeWidth={1}
                  />
                  <text x={estX} y={(yMax + yMin) / 2 + 3} fontSize="10" fill={color} fontFamily="ui-monospace, monospace" fontWeight="600">
                    e{e.escalon}
                  </text>
                </g>
              );
            })}

            {/* Borde superior/inferior de la barra (tramo sin escalón) */}
            <line x1={barraX} y1={padTop} x2={barraRight} y2={padTop} stroke="var(--chart-grid)" strokeWidth={0.5} />
            <line x1={barraX} y1={H - padBot} x2={barraRight} y2={H - padBot} stroke="var(--chart-grid)" strokeWidth={0.5} />

            {/* Umbrales */}
            {umbral("eval", umbralEval, "var(--color-atencion)")}
            {umbral("NR", umbralNR, "var(--color-rojo-alerta)")}
            {umbral("baj", umbralBajAlarma, "var(--color-bajante)")}
            {umbral("evac", umbralBajEvac, "var(--color-rojo-oscuro)")}

            {/* Marcador de nivel actual (burbuja con valor + guía) */}
            {nivelActual != null && (
              <g>
                {(() => {
                  const y = Math.min(Math.max(yPos(nivelActual), padTop + 12), H - padBot - 12);
                  return (
                    <>
                      {/* línea guía desde la barra hacia la burbuja */}
                      <line x1={barraX} y1={y} x2={4} y2={y} stroke={nivelColor} strokeWidth={2} strokeOpacity={0.5} />
                      {/* punta */}
                      <polygon points={`${barraX - 1},${y - 6} ${barraX - 6},${y} ${barraX - 1},${y + 6}`} fill={nivelColor} />
                      {/* burbuja */}
                      <rect x={2} y={y - 11} width={46} height={22} rx={6} fill={nivelColor} />
                      <text
                        x={25}
                        y={y + 4}
                        fontSize="12"
                        fontWeight="bold"
                        fill="white"
                        textAnchor="middle"
                        fontFamily="ui-monospace, monospace"
                      >
                        {nivelActual.toFixed(2)}m
                      </text>
                    </>
                  );
                })()}
              </g>
            )}
          </svg>
        </div>

        {/* Panel informativo */}
        <div className="flex-1 min-w-0 pt-1">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <p className="text-xs text-texto-sec dark:text-gray-400 uppercase tracking-wide">Nivel actual</p>
              <p className="font-mono text-3xl sm:text-4xl font-bold text-baliza dark:text-marea-dark leading-tight">
                {nivelActual != null ? `${nivelActual.toFixed(2)}m` : "--"}
                <span className={`text-base sm:text-lg ml-2 font-sans ${tendencia === "↑" ? "text-rojo-alerta" : tendencia === "↓" ? "text-ok" : "text-texto-sec dark:text-gray-400"}`}>
                  {tendencia}
                </span>
              </p>
            </div>

            <div className="text-xs text-texto-sec dark:text-gray-400 font-mono">
              {timestamp ? formatearFecha(timestamp) : "--"}
            </div>

            {escalonActual && (
              <div
                className="text-sm rounded-lg px-3 py-1.5"
                style={{ backgroundColor: escalonColor(escalonActual.escalon), opacity: 0.12 }}
              >
                <span className="font-bold text-baliza dark:text-white" style={{ opacity: 1 }}>
                  Escalón e{escalonActual.escalon}
                </span>
                <span className="text-texto-sec dark:text-gray-300 ml-1">
                  ({escalonActual.nivel_min_m.toFixed(1)}–{escalonActual.nivel_max_m.toFixed(1)}m)
                </span>
              </div>
            )}
            {!escalonActual && (
              <div className="text-sm">
                <span className="text-texto-sec dark:text-gray-400">
                  {nivelActual != null && nivelActual < escalones[0]?.nivel_min_m
                    ? "Debajo del escalón mínimo"
                    : `Sobre escalón ${escalones[escalones.length - 1]?.escalon}`}
                </span>
              </div>
            )}
          </div>

          <div className="mt-3 border-t border-borde dark:border-gray-700 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            {umbralEval && (
              <p className="flex items-center gap-2">
                <span className="w-3 h-[2px] bg-atencion inline-block" />
                <span className="text-texto-sec dark:text-gray-400">Evaluación: <strong className="font-mono text-atencion">{umbralEval.valor_m.toFixed(2)}m</strong></span>
              </p>
            )}
            {umbralNR && (
              <p className="flex items-center gap-2">
                <span className="w-3 h-[2px] bg-rojo-alerta inline-block" />
                <span className="text-texto-sec dark:text-gray-400">No retorno: <strong className="font-mono text-rojo-alerta">{umbralNR.valor_m.toFixed(2)}m</strong></span>
              </p>
            )}
            {umbralBajAlarma && (
              <p className="flex items-center gap-2">
                <span className="w-3 h-[2px] bg-bajante inline-block" />
                <span className="text-texto-sec dark:text-gray-400">Bajante alarma: <strong className="font-mono text-bajante">{umbralBajAlarma.valor_m.toFixed(2)}m</strong></span>
              </p>
            )}
            {umbralBajEvac && (
              <p className="flex items-center gap-2">
                <span className="w-3 h-[2px] bg-rojo-oscuro inline-block" />
                <span className="text-texto-sec dark:text-gray-400">Bajante evacuación: <strong className="font-mono text-rojo-oscuro">{umbralBajEvac.valor_m.toFixed(2)}m</strong></span>
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}