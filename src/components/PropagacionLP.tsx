import type { Lectura } from "@/lib/types";

const PROPAGACION_HS = 2.5;

interface Props {
  lecturasLP: Lectura[];
  nivelSF: number | undefined;
}

function formatearHora(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export default function PropagacionLP({ lecturasLP, nivelSF }: Props) {
  if (lecturasLP.length < 2) {
    return (
      <div>
        <p className="seccion-titulo mb-2">
          Propagación La Plata → San Fernando
        </p>
        <p className="text-sm italic text-[#5B6E68]/60 dark:text-gray-500">Esperando datos de La Plata...</p>
      </div>
    );
  }

  const ultimo = lecturasLP[0];
  const anterior = lecturasLP[1];
  const diff = ultimo.nivel_m - anterior.nivel_m;
  const subiendo = diff > 0.01;
  const bajando = diff < -0.01;

  const llegadaEstimada = new Date(new Date(ultimo.timestamp).getTime() + PROPAGACION_HS * 3600000);
  const ahora = Date.now();
  const msRestantes = llegadaEstimada.getTime() - ahora;
  const horasRestantes = Math.floor(Math.max(msRestantes, 0) / 3600000);
  const minsRestantes = Math.floor((Math.max(msRestantes, 0) % 3600000) / 60000);

  const maxLecturas = Math.max(...lecturasLP.slice(0, 12).map((l) => l.nivel_m), 0.01);
  const minLecturas = Math.min(...lecturasLP.slice(0, 12).map((l) => l.nivel_m), 0);
  const rango = Math.max(maxLecturas - minLecturas, 0.5);
  const W = 300;
  const H = 60;

  return (
    <div>
      <p className="seccion-titulo mb-2">
        Propagación La Plata → San Fernando
      </p>

      <div className="flex items-center justify-between mb-2 gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-[#5B6E68]/60 dark:text-gray-500 mb-0.5">La Plata actual</p>
          <p className="font-mono text-xl font-bold text-[#0E4749] dark:text-[#4fc3c5]">
            {ultimo.nivel_m.toFixed(2)}m
            <span className={`text-xs ml-1.5 font-sans ${subiendo ? "text-[#E8823A]" : bajando ? "text-[#0E4749]" : "text-[#5B6E68]"}`}>
              {subiendo ? "↑" : bajando ? "↓" : "→"} {Math.abs(diff).toFixed(3)}m/h
            </span>
          </p>
          <p className="text-xs font-mono text-[#5B6E68]/60 dark:text-gray-500">{formatearHora(ultimo.timestamp)}</p>
        </div>

        <div className="text-right flex-shrink-0">
          <p className="text-xs text-[#5B6E68]/60 dark:text-gray-500 mb-0.5">Llega a SF ≈</p>
          <p className="font-mono text-lg font-bold text-[#C99A3D]">
            {horasRestantes > 0 ? `${horasRestantes}h ${minsRestantes}m` : "ahora"}
          </p>
          <p className="text-xs font-mono text-[#5B6E68]/60 dark:text-gray-500">{formatearHora(llegadaEstimada.toISOString())}</p>
        </div>
      </div>

      {/* Mini sparkline */}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        <polyline
          fill="none"
          stroke="#0E4749"
          strokeWidth="1.5"
          points={lecturasLP.slice(0, 24).reverse().map((l, i) => {
            const x = (i / Math.max(24, 1)) * W;
            const y = H - 5 - ((l.nivel_m - minLecturas) / rango) * (H - 10);
            return `${x},${y}`;
          }).join(" ")}
        />
        <line x1={0} y1={H - 5 - ((nivelSF ?? 0 - minLecturas) / rango) * (H - 10)} x2={W} y2={H - 5 - ((nivelSF ?? 0 - minLecturas) / rango) * (H - 10)} stroke="#C99A3D" strokeWidth="1" strokeDasharray="3,2" />
      </svg>

      <p className="text-xs text-[#5B6E68]/60 dark:text-gray-500 mt-1 leading-relaxed">
        {subiendo
          ? `La Plata viene subiendo — si la tendencia se mantiene, el pico llegaría a San Fernando alrededor de las ${formatearHora(llegadaEstimada.toISOString())}.`
          : bajando
            ? `La Plata está bajando — no se espera propagación significativa.`
            : `La Plata se mantiene estable.`}
        {" "}La relación histórica LP→SF es de ~{PROPAGACION_HS}hs.
      </p>
    </div>
  );
}
