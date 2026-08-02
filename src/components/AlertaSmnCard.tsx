import type { AlertaSmn, EventoSmn } from "@/lib/types";
import CompartirWhatsApp from "@/components/CompartirWhatsApp";

const NOMBRE_EVENTO: Record<number, string> = {
  37: "Lluvia",
  39: "Viento",
  40: "Niebla",
  41: "Tormenta",
  42: "Nevada",
  45: "Ceniza volcánica",
  46: "Polvo",
  47: "Viento zonda",
  54: "Humo",
};

const NIVEL_SMN = {
  5: { label: "rojo", dot: "bg-red-600", text: "text-red-600 dark:text-red-400" },
  4: { label: "naranja", dot: "bg-orange-500", text: "text-orange-600 dark:text-orange-400" },
  3: { label: "amarillo", dot: "bg-yellow-400", text: "text-yellow-600 dark:text-yellow-400" },
  2: { label: "verde", dot: "bg-green-500", text: "text-[#4C7A5E]" },
  1: { label: "verde", dot: "bg-green-500", text: "text-[#4C7A5E]" },
} as const;

function nombreEvento(id: number): string {
  return NOMBRE_EVENTO[id] ?? `Evento ${id}`;
}

function formatearFecha(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00`);
  return d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
}

function nivelColor(nivel: number): { dot: string; text: string; label: string } {
  if (nivel >= 5) return NIVEL_SMN[5];
  if (nivel === 4) return NIVEL_SMN[4];
  if (nivel === 3) return NIVEL_SMN[3];
  return NIVEL_SMN[2];
}

export default function AlertaSmnCard({ alertas }: { alertas: AlertaSmn[] }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const ordenadas = [...alertas].sort((a, b) => a.fecha.localeCompare(b.fecha));

  const deHoy = ordenadas.find((a) => a.fecha === hoy);
  const proximas = ordenadas.filter((a) => a.fecha > hoy).slice(0, 2);

  const eventosRelevantes = (alerta: AlertaSmn | undefined): EventoSmn[] =>
    (alerta?.eventos_json ?? []).filter((e) => e.max_level >= 3);

  const principal = deHoy ?? ordenadas[0];

  return (
    <section className="dashboard-section">
      <p className="seccion-titulo mb-2">
        Alerta meteorológica — SMN
      </p>

      {!principal || principal.max_level < 3 ? (
        <p className="text-sm text-[#5B6E68]/70 dark:text-gray-500">
          Sin alertas vigentes para la zona. Nivel {principal ? "verde" : "sin datos"}.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className={`font-bold ${nivelColor(principal.max_level).text}`}>
                Alerta {nivelColor(principal.max_level).label.toUpperCase()}
              </p>
              <p className="text-xs text-[#5B6E68]/70 dark:text-gray-500">
                {formatearFecha(principal.fecha)}
              </p>
            </div>
            <div className="text-right">
              {eventosRelevantes(principal).map((e) => (
                <p key={e.id} className="text-sm text-[#12312B] dark:text-gray-200">
                  {nombreEvento(e.id)}
                </p>
              ))}
              {eventosRelevantes(principal).length === 0 && (
                <p className="text-sm text-[#5B6E68]/60 italic">sin detalle</p>
              )}
            </div>
          </div>

          {proximas.length > 0 && (
            <div className="border-t border-[#F2E9DC] dark:border-gray-700 pt-2">
              <p className="text-xs text-[#5B6E68]/60 dark:text-gray-500 mb-1">Próximos días</p>
              {proximas.map((a) => (
                <div key={a.fecha} className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full ${nivelColor(a.max_level).dot}`} />
                  <span className="text-[#5B6E68] dark:text-gray-400">{formatearFecha(a.fecha)}</span>
                  <span className="text-[#5B6E68]/70 dark:text-gray-500 capitalize">
                    {a.max_level >= 3 ? nivelColor(a.max_level).label : "sin alerta"}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="pt-1">
            <CompartirWhatsApp
              small
              mensaje={[
                `⚡ Baliza — Alerta meteorológica SMN`,
                `Alerta ${nivelColor(principal.max_level).label.toUpperCase()} para ${formatearFecha(principal.fecha)}`,
                ...eventosRelevantes(principal).map((e) => `• ${nombreEvento(e.id)}`),
                ...proximas.map((a) => `${formatearFecha(a.fecha)}: ${a.max_level >= 3 ? nivelColor(a.max_level).label : "sin alerta"}`),
                `⚠ Más info: https://baliza-ashy.vercel.app`,
              ].join("\n")}
            />
          </div>
        </div>
      )}

      <p className="text-[10px] text-[#5B6E68]/40 dark:text-gray-600 mt-3">
        Fuente: Servicio Meteorológico Nacional (sistema de alerta temprana)
      </p>
    </section>
  );
}
