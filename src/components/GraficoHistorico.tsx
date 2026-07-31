"use client";

import type { Lectura, Pronostico, NivelAlerta } from "@/lib/types";

interface Props {
  observaciones: Lectura[];
  pronosticos: Pronostico[];
  umbralEval: number;
  umbralNR: number;
  alertas: { timestamp: string; nivel: NivelAlerta }[];
}

function formatearDia(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "numeric" });
}

function formatearHora(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { hour: "2-digit" });
}

export default function GraficoHistorico({ observaciones, pronosticos, umbralEval, umbralNR, alertas }: Props) {
  const obsOrdenados = [...observaciones].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const pronoMain = pronosticos.filter((p) => p.qualifier === "main").sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const ahora = Date.now();
  const desde = ahora - 7 * 24 * 60 * 60 * 1000;
  const ultimos7d = obsOrdenados.filter((o) => new Date(o.timestamp).getTime() >= desde);
  const unirConProno = pronoMain.filter((p) => new Date(p.timestamp).getTime() >= ahora - 24 * 60 * 60 * 1000).slice(0, 72);

  if (ultimos7d.length < 2) {
    return (
      <div>
        <p className="seccion-titulo mb-2">Histórico San Fernando</p>
        <p className="text-sm italic text-[#5B6E68]/60 dark:text-gray-500">Esperando datos...</p>
      </div>
    );
  }

  const puntosObs = ultimos7d;
  const todosPuntos = [...puntosObs, ...unirConProno];
  const maxVal = Math.max(...puntosObs.map((p) => p.nivel_m), ...unirConProno.map((p) => p.valor_m), umbralNR + 0.3);
  const minVal = Math.min(...puntosObs.map((p) => p.nivel_m), 0);
  const rango = Math.max(maxVal - minVal, 1);
  const paddingY = 10;
  const paddingX = 32;

  const W = 680;
  const H = 200;

  function yPos(val: number): number {
    return H - paddingY - ((val - minVal) / rango) * (H - 2 * paddingY);
  }

  function xPos(ts: string, puntos: { timestamp: string }[]): number {
    const t = new Date(ts).getTime();
    const t0 = new Date(puntos[0].timestamp).getTime();
    const t1 = new Date(puntos[puntos.length - 1].timestamp).getTime();
    return paddingX + ((t - t0) / Math.max(t1 - t0, 1)) * (W - 2 * paddingX);
  }

  const lineaObs = puntosObs
    .map((p) => `${xPos(p.timestamp, puntosObs).toFixed(1)},${yPos(p.nivel_m).toFixed(1)}`)
    .join(" ");

  const lineaProno = unirConProno
    .map((p) => `${xPos(p.timestamp, todosPuntos).toFixed(1)},${yPos(p.valor_m).toFixed(1)}`)
    .join(" ");

  const yLabels: number[] = [];
  for (let v = Math.floor(minVal); v <= Math.ceil(maxVal); v += 0.5) {
    yLabels.push(v);
  }

  // X-axis labels by unique date, tracking sequentially to avoid duplicates
  const xLabels: { x: number; label: string }[] = [];
  let ultimoDia = "";
  const agregarLabel = (ts: string) => {
    const dia = ts.slice(0, 10);
    if (dia === ultimoDia) return;
    ultimoDia = dia;
    const x = xPos(ts, todosPuntos);
    if (x >= paddingX && x <= W - paddingX) {
      xLabels.push({ x, label: formatearDia(ts) });
    }
  };
  puntosObs.forEach((p) => agregarLabel(p.timestamp));
  unirConProno.forEach((p) => agregarLabel(p.timestamp));

  return (
    <div>
      <p className="seccion-titulo mb-2">
        Histórico — San Fernando (últimos 7 días)
      </p>

      <svg viewBox={`-${paddingX} 0 ${W + paddingX} ${H + 30}`} className="w-full h-auto" style={{ maxHeight: "280px" }}>
        <defs>
          <clipPath id="chart-area"><rect x={0} y={paddingY} width={W} height={H - 2 * paddingY} /></clipPath>
        </defs>

        {/* Grid horizontal */}
        {yLabels.map((v) => (
          <g key={v}>
            <line x1={0} y1={yPos(v)} x2={W} y2={yPos(v)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={-2} y={yPos(v) + 3} fontSize="9" fill="#9ca3af" textAnchor="end">{v.toFixed(1)}</text>
          </g>
        ))}

        {/* X axis labels */}
        {xLabels.map((xl) => (
          <text key={xl.x} x={xl.x} y={H + 14} fontSize="9" fill="#9ca3af" textAnchor="middle">{xl.label}</text>
        ))}

        {/* Alertas markers */}
        {alertas.map((a, i) => {
          const t = new Date(a.timestamp).getTime();
          if (t < desde || t > ahora) return null;
          const x = xPos(a.timestamp, puntosObs);
          const color = a.nivel === "roja" || a.nivel === "evacuacion" ? "#C0442B" : a.nivel === "amarilla" ? "#C99A3D" : a.nivel === "azul" ? "#2563EB" : "#4C7A5E";
          return (
            <circle key={i} cx={x} cy={yPos(minVal + rango * 0.05)} r="4" fill={color} />
          );
        })}

        {/* Threshold lines */}
        <line x1={0} y1={yPos(umbralEval)} x2={W} y2={yPos(umbralEval)} stroke="#C99A3D" strokeWidth="2" strokeDasharray="8,4" />
        <rect x={0} y={yPos(umbralEval) - 1} width={W} height={2} fill="#C99A3D" fillOpacity="0.1" />
        <text x={W + 3} y={yPos(umbralEval) + 3} fontSize="9" fill="#C99A3D" fontFamily="ui-monospace, monospace" fontStyle="italic">eval {umbralEval.toFixed(1)}</text>
        <line x1={0} y1={yPos(umbralNR)} x2={W} y2={yPos(umbralNR)} stroke="#C0442B" strokeWidth="2" strokeDasharray="8,4" />
        <rect x={0} y={yPos(umbralNR) - 1} width={W} height={2} fill="#C0442B" fillOpacity="0.08" />
        <text x={W + 3} y={yPos(umbralNR) + 3} fontSize="9" fill="#C0442B" fontFamily="ui-monospace, monospace" fontStyle="italic">NR {umbralNR.toFixed(1)}</text>

        {/* Observed line */}
        <polyline
          fill="none"
          stroke="#0E4749"
          strokeWidth="2"
          points={lineaObs}
          clipPath="url(#chart-area)"
        />

        {/* Forecast line */}
        {unirConProno.length > 0 && (
          <polyline
            fill="none"
            stroke="#E8823A"
            strokeWidth="1.5"
            strokeDasharray="6,3"
            points={lineaProno}
            clipPath="url(#chart-area)"
          />
        )}
      </svg>

      <div className="flex gap-4 mt-2 text-xs text-[#5B6E68] dark:text-gray-400">
        <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-[#0E4749] inline-block" /> Observado</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0 inline-block border-t-[1.5px] border-dashed border-[#E8823A]" /> Pronóstico</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0 inline-block border-t-[1.5px] border-dashed border-[#C99A3D]" /> Eval {umbralEval.toFixed(1)}m</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0 inline-block border-t-[1.5px] border-dashed border-[#C0442B]" /> NR {umbralNR.toFixed(1)}m</span>
      </div>
      </div>
    );
  }

