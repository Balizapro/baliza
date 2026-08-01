"use client";

import type { Marea } from "@/lib/types";

interface Props {
  mareas: Marea[];
  umbralEval: number;
}

function fmtDia(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "numeric" });
}

function fmtHora(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function fmtFechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function GraficoMarea({ mareas, umbralEval }: Props) {
  const pts = [...mareas]
    .filter((m) => m.nivel_m != null && m.timestamp_marea)
    .sort((a, b) => new Date(a.timestamp_marea!).getTime() - new Date(b.timestamp_marea!).getTime());

  if (pts.length < 2) {
    return (
      <div>
        <p className="seccion-titulo mb-2">Marea astronómica — frente del Delta</p>
        <p className="text-sm italic text-[#5B6E68]/60 dark:text-gray-500">Esperando datos...</p>
      </div>
    );
  }

  const ahora = Date.now();
  const W = 680;
  const H = 210;
  const padL = 38;
  const padR = 16;
  const padT = 14;
  const padB = 28;

  const t0 = new Date(pts[0].timestamp_marea!).getTime();
  const t1 = Math.max(new Date(pts[pts.length - 1].timestamp_marea!).getTime(), ahora);

  const xPos = (t: number): number => padL + ((t - t0) / Math.max(t1 - t0, 1)) * (W - padL - padR);

  const valores = pts.map((p) => p.nivel_m as number);
  const yMin = Math.min(...valores, 0);
  const yMax = Math.max(...valores, umbralEval + 0.2);
  const rango = Math.max(yMax - yMin, 0.5);

  const yPos = (v: number): number => padT + (1 - (v - yMin) / rango) * (H - padT - padB);

  const yLabels: number[] = [];
  for (let v = Math.ceil(yMin * 2) / 2; v <= Math.floor(yMax * 2) / 2 + 0.001; v += 0.5) {
    yLabels.push(Math.round(v * 100) / 100);
  }

  // Labels de fecha: uno por día local, sin duplicados
  const xLabels: { x: number; label: string }[] = [];
  let ultimoDia = "";
  for (const p of pts) {
    const d = new Date(p.timestamp_marea!);
    const dia = d.toLocaleDateString("es-AR", { day: "numeric", month: "numeric", year: "numeric" });
    if (dia === ultimoDia) continue;
    ultimoDia = dia;
    const x = xPos(d.getTime());
    if (x >= padL && x <= W - padR) xLabels.push({ x, label: fmtDia(p.timestamp_marea!) });
  }

  const linea = pts.map((p) => `${xPos(new Date(p.timestamp_marea!).getTime()).toFixed(1)},${yPos(p.nivel_m as number).toFixed(1)}`).join(" ");

  // Pleamares (picos locales)
  const picos: Marea[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1].nivel_m as number;
    const b = pts[i].nivel_m as number;
    const c = pts[i + 1].nivel_m as number;
    if (b > a && b >= c && b >= 0.3) picos.push(pts[i]);
  }

  // Próxima pleamar
  const proxima = pts.find((p) => new Date(p.timestamp_marea!).getTime() > ahora && (p.nivel_m as number) >= 0.3);

  const xAhora = xPos(ahora);
  const picoMax = pts.reduce((m, p) => ((p.nivel_m as number) > (m.nivel_m as number) ? p : m), pts[0]);

  return (
    <div>
      <p className="seccion-titulo mb-2">Marea astronómica — San Fernando (SHN)</p>
      <p className="text-xs text-[#5B6E68] dark:text-gray-400 mb-1">
        Curva determinista de pleamares y bajamares (referencia: escala San Fernando). Anticipa sudestadas.
      </p>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: "300px" }}>
        <defs>
          <clipPath id="gm-clip"><rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} /></clipPath>
        </defs>

        {/* Grid horizontal + etiquetas Y */}
        {yLabels.map((v) => (
          <g key={v}>
            <line x1={padL} y1={yPos(v)} x2={W - padR} y2={yPos(v)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={padL - 6} y={yPos(v) + 3} fontSize="9" fill="#9ca3af" textAnchor="end">{v.toFixed(1)}</text>
          </g>
        ))}

        {/* Labels de fecha */}
        {xLabels.map((xl) => (
          <text key={xl.label + xl.x} x={xl.x} y={H - 8} fontSize="9" fill="#9ca3af" textAnchor="middle">{xl.label}</text>
        ))}

        {/* Línea AHORA */}
        <line x1={xAhora} y1={padT} x2={xAhora} y2={H - padB} stroke="#6b7280" strokeWidth="1" strokeDasharray="3,3" />
        <text x={xAhora + 3} y={padT + 9} fontSize="8" fill="#6b7280" fontWeight="600">AHORA</text>

        {/* Umbral de evaluación */}
        <line x1={padL} y1={yPos(umbralEval)} x2={W - padR} y2={yPos(umbralEval)} stroke="#C99A3D" strokeWidth="1.5" strokeDasharray="6,4" />
        <text x={padL + 3} y={yPos(umbralEval) - 4} fontSize="8" fill="#C99A3D" fontStyle="italic" fontWeight="600">eval {umbralEval.toFixed(1)}</text>

        {/* Relleno bajo el cero */}
        <polygon
          points={`${padL},${yPos(0)} ${linea.split(" ").map((p) => {
            const [x, y] = p.split(",");
            return `${x},${y}`;
          }).join(" ")} ${xPos(t1)},${yPos(0)}`}
          fill="#2563EB"
          fillOpacity="0.10"
          clipPath="url(#gm-clip)"
        />

        {/* Curva de marea */}
        <polyline fill="none" stroke="#2563EB" strokeWidth="2" points={linea} clipPath="url(#gm-clip)" />

        {/* Pleamares */}
        {picos.map((p, i) => (
          <circle
            key={i}
            cx={xPos(new Date(p.timestamp_marea!).getTime())}
            cy={yPos(p.nivel_m as number)}
            r="3.5"
            fill="#1E4ED8"
            stroke="#fff"
            strokeWidth="1.2"
          />
        ))}

        {/* Próxima pleamar */}
        {proxima && (
          <g>
            <circle cx={xPos(new Date(proxima.timestamp_marea!).getTime())} cy={yPos(proxima.nivel_m as number)} r="5" fill="#E8823A" stroke="#fff" strokeWidth="1.5" />
            <text
              x={xPos(new Date(proxima.timestamp_marea!).getTime())}
              y={yPos(proxima.nivel_m as number) - 8}
              fontSize="9"
              fill="#E8823A"
              fontWeight="700"
              textAnchor="middle"
            >
              {(proxima.nivel_m as number).toFixed(2)}m
            </text>
            <text
              x={xPos(new Date(proxima.timestamp_marea!).getTime())}
              y={yPos(proxima.nivel_m as number) + 16}
              fontSize="8"
              fill="#E8823A"
              textAnchor="middle"
            >
              {fmtFechaHora(proxima.timestamp_marea!)}
            </text>
          </g>
        )}

        {/* Pico del período */}
        {picoMax && (
          <text x={W - padR - 2} y={padT + 12} fontSize="9" fill="#1E4ED8" fontWeight="600" textAnchor="end">
            pico {picoMax.nivel_m!.toFixed(2)}m · {fmtFechaHora(picoMax.timestamp_marea!)}
          </text>
        )}
      </svg>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-[#5B6E68] dark:text-gray-400">
        <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-[#2563EB] inline-block" /> Marea astronómica</span>
        <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-[#E8823A] inline-block" /> Próxima pleamar</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0 inline-block border-t-[1.5px] border-dashed border-[#C99A3D]" /> Eval {umbralEval.toFixed(1)}m</span>
      </div>
    </div>
  );
}
