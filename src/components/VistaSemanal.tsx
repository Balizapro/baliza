import type { Lectura } from "@/lib/types";

function formatearHora(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("es-AR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function tendencia(a: Lectura | null, b: Lectura | null): string {
  if (!a || !b) return "—";
  const d = a.nivel_m - b.nivel_m;
  return d > 0.01 ? "↑" : d < -0.01 ? "↓" : "→";
}

export default function VistaSemanal({ parana }: { parana: Record<string, Lectura | null> }) {
  const estaciones = [
    { key: "rosario", nombre: "Rosario" },
    { key: "sanNicolas", nombre: "San Nicolás" },
    { key: "zarate", nombre: "Zárate" },
    { key: "campana", nombre: "Campana" },
    { key: "escobar", nombre: "Escobar" },
  ];

  const values = estaciones.map((e) => ({
    ...e,
    obs: parana[e.key as keyof typeof parana],
  }));

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.15em] font-sans text-[#5B6E68] dark:text-gray-400 mb-1">
        Paraná — vista semanal
      </p>
      <p className="text-xs text-[#5B6E68]/60 dark:text-gray-500 mb-3">
        Niveles aguas arriba. Subidas sostenidas anticipan crecida en el Delta a 4-5 días.
      </p>
      <div className="space-y-2">
        {values.map((est) => (
          <div key={est.key} className="flex items-center justify-between">
            <p className="font-medium text-sm text-[#12312B] dark:text-gray-200">{est.nombre}</p>
            <div className="text-right flex-shrink-0 ml-2">
              <p className="font-mono text-base sm:text-lg font-bold text-[#0E4749] dark:text-[#4fc3c5] whitespace-nowrap">
                {est.obs ? `${est.obs.nivel_m.toFixed(2)}m` : <span className="text-xs font-normal italic text-[#5B6E68]/60">sin datos</span>}
                <span className="text-xs sm:text-sm ml-1 font-sans">{est.obs ? tendencia(est.obs, null) : ""}</span>
              </p>
              <p className="text-xs font-mono text-[#5B6E68]/60 dark:text-gray-500">
                {est.obs ? formatearHora(est.obs.timestamp) : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-[#5B6E68]/40 dark:text-gray-500 mt-3 text-center">
        Datos INA — actualizados cada 20min
      </p>
    </div>
  );
}
