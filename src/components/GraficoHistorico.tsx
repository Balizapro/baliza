"use client";

import type { Lectura, Pronostico, NivelAlerta } from "@/lib/types";
import { useAhora } from "@/lib/useAhora";

interface Props {
  observaciones: Lectura[];
  pronosticos: Pronostico[];
  umbralEval: number;
  umbralNR: number;
  alertas: { timestamp: string; nivel: NivelAlerta }[];
}

function fmtDia(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "numeric" });
}

function fmtPico(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function GraficoHistorico({ observaciones, pronosticos, umbralEval, umbralNR, alertas }: Props) {
  const obs = [...observaciones].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const ahora = useAhora();
  const desde = ahora - 7 * 24 * 60 * 60 * 1000;
  const obs7d = obs.filter((o) => new Date(o.timestamp).getTime() >= desde);

  if (obs7d.length < 2) {
    return (
      <div>
        <h2 className="seccion-titulo mb-2">Histórico San Fernando</h2>
        <p className="text-sm italic text-texto-sec dark:text-gray-400">Esperando datos...</p>
      </div>
    );
  }

  const main = pronosticos
    .filter((p) => p.qualifier === "main")
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  // Pronóstico futuro a partir de las últimas 6hs (superposición para conectar con lo observado)
  const futuros = main.filter((p) => new Date(p.timestamp).getTime() >= ahora - 6 * 60 * 60 * 1000).slice(0, 72);

  // Banda de incertidumbre por timestamp
  const bandas = new Map<string, { p05?: number; p25?: number; p75?: number; p95?: number }>();
  for (const p of pronosticos) {
    if (p.qualifier === "main") continue;
    const b = bandas.get(p.timestamp) ?? {};
    b[p.qualifier as "p05" | "p25" | "p75" | "p95"] = p.valor_m;
    bandas.set(p.timestamp, b);
  }

  const W = 680;
  const H = 210;
  const padL = 38;
  const padR = 16;
  const padT = 14;
  const padB = 28;

  const t0 = desde;
  const t1 = Math.max(
    new Date(obs7d[obs7d.length - 1].timestamp).getTime(),
    futuros.length > 0 ? new Date(futuros[futuros.length - 1].timestamp).getTime() : ahora
  );

  const xPos = (t: number): number => padL + ((t - t0) / Math.max(t1 - t0, 1)) * (W - padL - padR);

  const todosValores = [
    ...obs7d.map((o) => o.nivel_m),
    ...futuros.map((p) => p.valor_m),
    ...Array.from(bandas.values()).flatMap((b) => [b.p05, b.p25, b.p75, b.p95].filter((v): v is number => v != null)),
    0,
  ];
  const yMin = Math.min(...todosValores);
  const yMax = Math.max(...todosValores, umbralNR + 0.2);
  const rango = Math.max(yMax - yMin, 0.5);

  const yPos = (v: number): number => padT + (1 - (v - yMin) / rango) * (H - padT - padB);

  const yLabels: number[] = [];
  for (let v = Math.ceil(yMin * 2) / 2; v <= Math.floor(yMax * 2) / 2 + 0.001; v += 0.5) {
    yLabels.push(Math.round(v * 100) / 100);
  }

  // Labels de fecha: uno por día local, sin duplicados
  const xLabels: { x: number; label: string }[] = [];
  let ultimoDia = "";
  const agregarLabel = (ts: string) => {
    const d = new Date(ts);
    const dia = d.toLocaleDateString("es-AR", { day: "numeric", month: "numeric", year: "numeric" });
    if (dia === ultimoDia) return;
    ultimoDia = dia;
    const x = xPos(d.getTime());
    if (x >= padL && x <= W - padR) xLabels.push({ x, label: fmtDia(ts) });
  };
  obs7d.forEach((o) => agregarLabel(o.timestamp));
  futuros.forEach((p) => agregarLabel(p.timestamp));

  const puntosObs = obs7d
    .map((p) => `${xPos(new Date(p.timestamp).getTime()).toFixed(1)},${yPos(p.nivel_m).toFixed(1)}`)
    .join(" ");

  const puntosProno = futuros
    .map((p) => `${xPos(new Date(p.timestamp).getTime()).toFixed(1)},${yPos(p.valor_m).toFixed(1)}`)
    .join(" ");

  const bandaP05P95 = futuros.length > 0
    ? futuros
        .map((p) => {
          const x = xPos(new Date(p.timestamp).getTime()).toFixed(1);
          const hi = bandas.get(p.timestamp)?.p95 ?? p.valor_m;
          return `${x},${yPos(hi).toFixed(1)}`;
        })
        .join(" ") +
      " " +
      [...futuros]
        .reverse()
        .map((p) => {
          const x = xPos(new Date(p.timestamp).getTime()).toFixed(1);
          const lo = bandas.get(p.timestamp)?.p05 ?? p.valor_m;
          return `${x},${yPos(lo).toFixed(1)}`;
        })
        .join(" ")
    : "";

  const bandaP25P75 = futuros.length > 0
    ? futuros
        .map((p) => {
          const x = xPos(new Date(p.timestamp).getTime()).toFixed(1);
          const hi = bandas.get(p.timestamp)?.p75 ?? p.valor_m;
          return `${x},${yPos(hi).toFixed(1)}`;
        })
        .join(" ") +
      " " +
      [...futuros]
        .reverse()
        .map((p) => {
          const x = xPos(new Date(p.timestamp).getTime()).toFixed(1);
          const lo = bandas.get(p.timestamp)?.p25 ?? p.valor_m;
          return `${x},${yPos(lo).toFixed(1)}`;
        })
        .join(" ")
    : "";

  // Pico pronosticado (qualifier main)
  const pico = futuros.length > 0 ? futuros.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), futuros[0]) : null;
  const xAhora = xPos(ahora);

  return (
    <div>
      <h2 className="seccion-titulo mb-2">
        Histórico — San Fernando (últimos 7 días)
      </h2>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: "300px" }}>
        <defs>
          <clipPath id="gch-clip"><rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} /></clipPath>
        </defs>

        {/* Grid horizontal + etiquetas Y */}
        {yLabels.map((v) => (
          <g key={v}>
            <line x1={padL} y1={yPos(v)} x2={W - padR} y2={yPos(v)} stroke="var(--chart-grid)" strokeWidth="1" />
            <text x={padL - 6} y={yPos(v) + 3} fontSize="9" fill="var(--chart-axis)" textAnchor="end">{v.toFixed(1)}</text>
          </g>
        ))}

        {/* Labels de fecha */}
        {xLabels.map((xl) => (
          <text key={xl.label + xl.x} x={xl.x} y={H - 8} fontSize="9" fill="var(--chart-axis)" textAnchor="middle">{xl.label}</text>
        ))}

        {/* Línea AHORA */}
        <line x1={xAhora} y1={padT} x2={xAhora} y2={H - padB} stroke="var(--chart-ahora)" strokeWidth="1" strokeDasharray="3,3" />
        <text x={xAhora + 3} y={padT + 9} fontSize="8" fill="var(--chart-ahora)" fontWeight="600">AHORA</text>

        {/* Umbrales */}
        <line x1={padL} y1={yPos(umbralEval)} x2={W - padR} y2={yPos(umbralEval)} stroke="var(--color-atencion)" strokeWidth="1.5" strokeDasharray="6,4" />
        <rect x={padL} y={yPos(umbralEval) - 1} width={W - padL - padR} height={2} fill="var(--color-atencion)" fillOpacity="0.12" />
        <text x={padL + 3} y={yPos(umbralEval) - 4} fontSize="8" fill="var(--color-atencion)" fontStyle="italic" fontWeight="600">eval {umbralEval.toFixed(1)}</text>

        <line x1={padL} y1={yPos(umbralNR)} x2={W - padR} y2={yPos(umbralNR)} stroke="var(--color-rojo-alerta)" strokeWidth="1.5" strokeDasharray="6,4" />
        <rect x={padL} y={yPos(umbralNR) - 1} width={W - padL - padR} height={2} fill="var(--color-rojo-alerta)" fillOpacity="0.08" />
        <text x={padL + 3} y={yPos(umbralNR) - 4} fontSize="8" fill="var(--color-rojo-alerta)" fontStyle="italic" fontWeight="600">NR {umbralNR.toFixed(1)}</text>

        {/* Marcas de alertas (puntos en la base) */}
        {alertas
          .filter((a) => new Date(a.timestamp).getTime() >= desde && new Date(a.timestamp).getTime() <= ahora)
          .map((a, i) => {
            const x = xPos(new Date(a.timestamp).getTime());
            const color = a.nivel === "roja" || a.nivel === "evacuacion" ? "var(--color-rojo-alerta)" : a.nivel === "amarilla" ? "var(--color-atencion)" : a.nivel === "azul" ? "var(--color-bajante)" : "var(--color-ok)";
            return <circle key={i} cx={x} cy={H - padB + 8} r="4" fill={color} />;
          })}

        {/* Banda de incertidumbre */}
        {bandaP25P75 && <polygon points={bandaP25P75} fill="var(--chart-obs)" fillOpacity="0.18" clipPath="url(#gch-clip)" />}
        {bandaP05P95 && <polygon points={bandaP05P95} fill="var(--chart-obs)" fillOpacity="0.10" clipPath="url(#gch-clip)" />}

        {/* Línea observada */}
        <polyline fill="none" stroke="var(--chart-obs)" strokeWidth="2" points={puntosObs} clipPath="url(#gch-clip)" />

        {/* Línea pronóstico */}
        {futuros.length > 0 && (
          <polyline fill="none" stroke="var(--chart-main)" strokeWidth="1.8" strokeDasharray="5,3" points={puntosProno} clipPath="url(#gch-clip)" />
        )}

        {/* Pico pronosticado */}
        {pico && (
          <g>
            <circle cx={xPos(new Date(pico.timestamp).getTime())} cy={yPos(pico.valor_m)} r="4" fill="var(--chart-main)" stroke="#fff" strokeWidth="1.5" />
            <text
              x={xPos(new Date(pico.timestamp).getTime())}
              y={yPos(pico.valor_m) - 8}
              fontSize="9"
              fill="var(--chart-main)"
              fontWeight="700"
              textAnchor="middle"
            >
              {pico.valor_m.toFixed(2)}m
            </text>
            <text
              x={xPos(new Date(pico.timestamp).getTime())}
              y={yPos(pico.valor_m) + 16}
              fontSize="8"
              fill="var(--chart-main)"
              textAnchor="middle"
            >
              {fmtPico(pico.timestamp)}
            </text>
          </g>
        )}
      </svg>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-texto-sec dark:text-gray-400">
        <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-baliza inline-block" /> Observado</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0 inline-block border-t-[1.5px] border-dashed border-alerta" /> Pronóstico</span>
        <span className="flex items-center gap-1"><span className="w-3 h-[6px] bg-baliza/15 inline-block" /> p05–p95</span>
        <span className="flex items-center gap-1"><span className="w-3 h-[6px] bg-baliza/30 inline-block" /> p25–p75</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0 inline-block border-t-[1.5px] border-dashed border-atencion" /> Eval {umbralEval.toFixed(1)}m</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0 inline-block border-t-[1.5px] border-dashed border-rojo-alerta" /> NR {umbralNR.toFixed(1)}m</span>
      </div>
    </div>
  );
}
