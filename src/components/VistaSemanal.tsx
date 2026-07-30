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
    <section className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs uppercase tracking-widest font-semibold text-gray-500 mb-3">
        Paraná — vista semanal
      </p>
      <p className="text-xs text-gray-400 mb-3">
        Niveles aguas arriba. Subidas sostenidas anticipan crecida en el Delta a 4-5 días.
      </p>
      <div className="space-y-2">
        {values.map((est) => (
          <div key={est.key} className="flex items-center justify-between py-1 border-b border-gray-100 last:border-0">
            <p className="font-medium text-sm text-gray-800">{est.nombre}</p>
            <div className="text-right">
              <p className="text-lg font-bold text-[#0E4749]">
                {est.obs ? `${est.obs.nivel_m.toFixed(2)}m` : "--"}
                <span className="text-sm ml-1">{est.obs ? tendencia(est.obs, null) : ""}</span>
              </p>
              <p className="text-xs text-gray-400">
                {est.obs ? formatearHora(est.obs.timestamp) : "sin datos"}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-3 text-center">
        Datos INA — actualizados cada 3hs
      </p>
    </section>
  );
}
