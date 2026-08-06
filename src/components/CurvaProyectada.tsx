import { useMemo } from "react";
import type { Punto } from "@/lib/ciclo";
import { proyectarCurva, type PuntoViento } from "@/lib/modelo";
import type { Umbral } from "@/lib/types";

interface Props {
  observaciones: Punto[];
  vientoHistorico: PuntoViento[];
  vientoPronostico: PuntoViento[];
  ahora: number;
  umbralEval: Umbral | null;
  umbralNR: Umbral | null;
}

const H = 3600000;

function formatearFecha(ts: number): string {
  return new Date(ts).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function CurvaProyectada({ observaciones, vientoHistorico, vientoPronostico, ahora, umbralEval, umbralNR }: Props) {
  const proyeccion = useMemo(() => {
    if (observaciones.length < 12) return null;
    const ventos = [...vientoHistorico, ...vientoPronostico]
      .filter((v) => v.timestamp > 0)
      .sort((a, b) => a.timestamp - b.timestamp);
    return proyectarCurva(observaciones, ventos, ahora, 48, 30);
  }, [observaciones, vientoHistorico, vientoPronostico, ahora]);

  if (!proyeccion || proyeccion.puntos.length === 0) {
    return (
      <section className="dashboard-section">
        <h2 className="seccion-titulo mb-2">Curva proyectada — modelo armónico + viento</h2>
        <p className="text-sm text-texto-sec dark:text-gray-400 italic">
          Se necesita más historial observado para proyectar la curva.
        </p>
      </section>
    );
  }

  const obs48h = observaciones
    .filter((o) => new Date(o.timestamp).getTime() >= ahora - 48 * H)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const W = 680;
  const Hpx = 240;
  const padL = 44;
  const padR = 18;
  const padT = 18;
  const padB = 32;

  const t0 = Math.min(ahora, ...(obs48h.map((o) => new Date(o.timestamp).getTime()) ?? [ahora]));
  const t1 = proyeccion.puntos[proyeccion.puntos.length - 1].timestamp;

  const todosNiveles = [
    ...(obs48h.map((o) => o.nivel_m) ?? []),
    ...proyeccion.bandaSuperior.map((p) => p.nivel_m),
    ...proyeccion.bandaInferior.map((p) => p.nivel_m),
  ];
  const yMax = Math.max(...todosNiveles, umbralNR?.valor_m ?? 0, 1) + 0.3;
  const yMin = Math.min(...todosNiveles, umbralEval?.valor_m ?? 0, 0) - 0.3;

  const xPos = (t: number): number => padL + ((t - t0) / Math.max(t1 - t0, 1)) * (W - padL - padR);
  const yPos = (v: number): number => padT + (1 - (v - yMin) / (yMax - yMin)) * (Hpx - padT - padB);

  const yLabels: number[] = [];
  for (let v = Math.ceil(yMin * 2) / 2; v <= Math.floor(yMax * 2) / 2 + 0.001; v += 0.5) {
    yLabels.push(Math.round(v * 100) / 100);
  }

  const xLabels: { x: number; label: string; esDia: boolean }[] = [];
  const pasoHs = Math.max(6, Math.round((t1 - t0) / (3600000 * 8)));
  let ultimoDia = "";
  for (let t = t0 + (t1 - t0) * 0.02; t <= t1; t += pasoHs * H) {
    const d = new Date(t);
    const dia = d.toLocaleDateString("es-AR", { day: "numeric", month: "numeric" });
    const esDia = dia !== ultimoDia;
    if (esDia) ultimoDia = dia;
    xLabels.push({
      x: xPos(t),
      label: esDia ? `${dia} ${String(d.getHours()).padStart(2, "0")}:00` : `${String(d.getHours()).padStart(2, "0")}:00`,
      esDia,
    });
  }

  const lineaObs = obs48h
    .map((o) => `${xPos(new Date(o.timestamp).getTime()).toFixed(1)},${yPos(o.nivel_m).toFixed(1)}`)
    .join(" ");

  const lineaCurva = proyeccion.puntos
    .map((p) => `${xPos(p.timestamp).toFixed(1)},${yPos(p.nivel_m).toFixed(1)}`)
    .join(" ");

  const banda = proyeccion.bandaSuperior.map((p) => `${xPos(p.timestamp).toFixed(1)},${yPos(p.nivel_m).toFixed(1)}`).join(" ") +
    " " +
    [...proyeccion.bandaInferior].reverse().map((p) => `${xPos(p.timestamp).toFixed(1)},${yPos(p.nivel_m).toFixed(1)}`).join(" ");

  const proxiPleamar = proyeccion.extremos.filter((e) => e.tipo === "pleamar")[0];
  const proxiBajamar = proyeccion.extremos.filter((e) => e.tipo === "bajamar")[0];

  const vientoActivo = proyeccion.regresion && Math.abs(proyeccion.regresion.pendiente_m_por_kmh) > 0.005;
  const compSE = proyeccion.regresion?.compSEActual ?? 0;
  const efectoVientoM = proyeccion.regresion ? proyeccion.regresion.pendiente_m_por_kmh * compSE : 0;
  const efectoPresionM = proyeccion.regresion?.presion_m_por_hpa && proyeccion.regresion.compPresionActual != null
    ? proyeccion.regresion.presion_m_por_hpa * proyeccion.regresion.compPresionActual
    : 0;
  const amplitudDominante = proyeccion.ajuste?.componentes[0]?.amplitud_m ?? null;

  return (
    <section className="dashboard-section">
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <h2 className="seccion-titulo">Curva proyectada — modelo armónico + viento</h2>
      </div>

      {proyeccion.regresion && vientoActivo && (
        <p className="text-xs text-texto-sec dark:text-gray-400 mb-1">
          Forzante meteorológica: viento SE <strong className="font-mono text-baliza dark:text-marea-dark">{efectoVientoM >= 0 ? "+" : ""}{efectoVientoM.toFixed(2)}m</strong>{" "}
          {Math.abs(efectoPresionM) > 0.005 && <>· presión {efectoPresionM >= 0 ? "+" : ""}{efectoPresionM.toFixed(2)}m</>}
          {" "}(lag {proyeccion.regresion.lag_h}h, r² {proyeccion.regresion.r2.toFixed(2)})
        </p>
      )}
      {!vientoActivo && proyeccion.ajuste && (
        <p className="text-xs text-texto-sec dark:text-gray-400 mb-1">
          Marea armónica: amplitud dominante <strong className="font-mono">{amplitudDominante?.toFixed(2) ?? "--"}m</strong>{" "}
          (sigma {proyeccion.ajuste.sigma_m.toFixed(2)}m)
        </p>
      )}

      <p className="text-xs text-texto-sec dark:text-gray-400 mb-3">
        Próxima pleamar proyectada ≈ <strong className="font-mono text-baliza dark:text-marea-dark">{proxiPleamar ? formatearFecha(proxiPleamar.timestamp) : "--"}</strong>
        {proxiPleamar && <> ({proxiPleamar.nivel_m.toFixed(2)}m)</>}
        {" "}· próxima bajamar ≈ <strong className="font-mono">{proxiBajamar ? formatearFecha(proxiBajamar.timestamp) : "--"}</strong>
        {proxiBajamar && <> ({proxiBajamar.nivel_m.toFixed(2)}m)</>}
      </p>

      <svg viewBox={`0 0 ${W} ${Hpx}`} className="w-full h-auto" style={{ maxHeight: "300px" }}>
        <defs>
          <clipPath id="curva-clip"><rect x={padL} y={padT} width={W - padL - padR} height={Hpx - padT - padB} /></clipPath>
        </defs>

        {yLabels.map((v) => (
          <g key={v}>
            <line x1={padL} y1={yPos(v)} x2={W - padR} y2={yPos(v)} stroke="var(--chart-grid)" strokeWidth="1" />
            <text x={padL - 8} y={yPos(v) + 3.5} fontSize="11" fill="var(--chart-axis)" textAnchor="end">{v.toFixed(1)}</text>
          </g>
        ))}

        {xLabels.map((xl) => (
          <text key={xl.label + xl.x.toFixed(0)} x={xl.x} y={Hpx - 9} fontSize={xl.esDia ? "11" : "10"} fontWeight={xl.esDia ? 600 : 400} fill="var(--chart-axis)" textAnchor="middle">
            {xl.label}
          </text>
        ))}

        <line x1={xPos(ahora)} y1={padT} x2={xPos(ahora)} y2={Hpx - padB} stroke="var(--chart-ahora)" strokeWidth="1" strokeDasharray="3,3" />
        <text x={xPos(ahora) + 4} y={padT + 10} fontSize="10" fill="var(--chart-ahora)" fontWeight="600">AHORA</text>

        {umbralEval && (
          <g>
            <line x1={padL} y1={yPos(umbralEval.valor_m)} x2={W - padR} y2={yPos(umbralEval.valor_m)} stroke="var(--color-atencion)" strokeWidth="1.5" strokeDasharray="6,4" />
            <text x={padL + 4} y={yPos(umbralEval.valor_m) - 4} fontSize="10" fill="var(--color-atencion)" fontStyle="italic" fontWeight="600">eval {umbralEval.valor_m.toFixed(1)}</text>
          </g>
        )}
        {umbralNR && (
          <g>
            <line x1={padL} y1={yPos(umbralNR.valor_m)} x2={W - padR} y2={yPos(umbralNR.valor_m)} stroke="var(--color-rojo-alerta)" strokeWidth="1.5" strokeDasharray="6,4" />
            <text x={padL + 4} y={yPos(umbralNR.valor_m) - 4} fontSize="10" fill="var(--color-rojo-alerta)" fontStyle="italic" fontWeight="600">NR {umbralNR.valor_m.toFixed(1)}</text>
          </g>
        )}

        <polygon points={banda} fill="var(--chart-main)" fillOpacity="0.12" clipPath="url(#curva-clip)" />

        {obs48h.length >= 2 && (
          <polyline fill="none" stroke="var(--chart-obs)" strokeWidth="2" points={lineaObs} clipPath="url(#curva-clip)" />
        )}

        <polyline fill="none" stroke="var(--chart-main)" strokeWidth="2" strokeDasharray="5,3" points={lineaCurva} clipPath="url(#curva-clip)" />

        {proyeccion.extremos.filter((e) => e.timestamp > ahora).slice(0, 4).map((e) => (
          <g key={e.timestamp}>
            <circle cx={xPos(e.timestamp)} cy={yPos(e.nivel_m)} r="3.5" fill={e.tipo === "pleamar" ? "var(--chart-main)" : "var(--chart-axis)"} stroke="#fff" strokeWidth="1.2" />
            <text x={xPos(e.timestamp)} y={yPos(e.nivel_m) - 7} fontSize="10" fill={e.tipo === "pleamar" ? "var(--chart-main)" : "var(--chart-axis)"} fontWeight="600" textAnchor="middle">
              {e.tipo === "pleamar" ? "P" : "B"}{formatearFecha(e.timestamp).split(",").pop()}
            </text>
          </g>
        ))}
      </svg>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-texto-sec dark:text-gray-400">
        <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-baliza dark:bg-marea-dark inline-block" /> Observado</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0 inline-block border-t-2 border-dashed border-alerta" /> Proyección modelo</span>
        <span className="flex items-center gap-1"><span className="w-3 h-[6px] bg-alerta/10 inline-block" /> banda p10–p90</span>
        {proyeccion.regresion && <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-bajante inline-block" /> con viento (sudestada)</span>}
        {umbralNR && <span className="flex items-center gap-1"><span className="w-3 h-0 inline-block border-t-[1.5px] border-dashed border-rojo-alerta" /> NR {umbralNR.valor_m.toFixed(1)}m</span>}
      </div>
    </section>
  );
}
