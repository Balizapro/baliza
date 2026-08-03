import type { AvisoCrecida, AlturaCrecida } from "@/lib/types";
import CompartirWhatsApp from "@/components/CompartirWhatsApp";

interface Props {
  aviso: AvisoCrecida | null;
  umbralNR?: number | null;
}

function fmtEmitido(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-AR", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function fmtFechaHora(fecha: string, hora: string): string {
  const [dd, mm, yyyy] = fecha.split("/");
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return `${d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })} ${hora}`;
}

function etiquetaTipo(tipo: string): { texto: string; color: string } {
  if (tipo.startsWith("alerta_")) return { texto: "ALERTA DE CRECIDA", color: "var(--color-rojo-alerta)" };
  if (tipo.startsWith("aviso_")) return { texto: "AVISO DE CRECIDA", color: "var(--color-alerta)" };
  if (tipo.startsWith("cese_")) return { texto: "CESE DE AVISO", color: "var(--color-ok)" };
  return { texto: tipo.toUpperCase().replace(/_/g, " "), color: "var(--color-atencion)" };
}

export default function AvisoCrecidaCard({ aviso, umbralNR }: Props) {
  if (!aviso) return null;

  const etiqueta = etiquetaTipo(aviso.tipo);
  const alturas = aviso.alturas ?? [];
  const umbral = umbralNR ?? 2.2;
  const sf = alturas.find((a) => a.puerto.toUpperCase().includes("SAN FERNANDO")) ?? null;
  const superaNR = sf != null && sf.altura_m > umbral;

  const mensajeWhatsApp = [
    `${etiqueta.texto} — SHN`,
    aviso.titulo,
    aviso.emitido ? `Emitido: ${fmtEmitido(aviso.emitido)}` : null,
    aviso.texto,
    alturas.map((a) => `${a.puerto}: ${a.altura_m.toFixed(2)}m (${fmtFechaHora(a.fecha, a.hora)})`).join("\n"),
    superaNR ? `⚠ San Fernando supera el nivel de no retorno (${umbral.toFixed(1)}m)` : null,
    `⚠ Más info: https://baliza-ashy.vercel.app`,
  ].filter(Boolean).join("\n");

  return (
    <section className="dashboard-section" style={{ borderColor: `color-mix(in srgb, ${etiqueta.color} 40%, transparent)`, borderLeft: `4px solid ${etiqueta.color}` }}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="seccion-titulo" style={{ color: etiqueta.color }}>
          {etiqueta.texto}
        </h2>
        {aviso.emitido && (
          <span className="text-xs text-texto-sec dark:text-gray-400">
            {fmtEmitido(aviso.emitido)}
          </span>
        )}
      </div>

      <p className="text-sm font-medium text-texto dark:text-gray-200 mb-1">
        {aviso.titulo}
      </p>
      <p className="text-sm text-texto-sec dark:text-gray-400 mb-3 leading-snug">
        {aviso.texto}
      </p>

      {alturas.length > 0 && (
        <div className="mb-3">
          <p className="text-xs uppercase tracking-wide text-texto-sec dark:text-gray-400 mb-1.5">
            Alturas estimadas
          </p>
          <div className="space-y-1">
            {alturas.map((a: AlturaCrecida, i: number) => {
              const esSF = a.puerto.toUpperCase().includes("SAN FERNANDO");
              return (
                <div
                  key={i}
                  className={`flex items-center justify-between text-sm rounded-lg px-3 py-1.5 ${
                    esSF ? "bg-baliza/10 dark:bg-white/10 font-bold" : ""
                  }`}
                >
                  <span className="text-texto dark:text-gray-200">
                    {a.puerto}
                  </span>
                  <span className={`font-mono ${esSF ? "text-baliza dark:text-marea-dark" : "text-texto-sec dark:text-gray-400"}`}>
                    {a.altura_m.toFixed(2)}m · {fmtFechaHora(a.fecha, a.hora)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {superaNR && (
        <div className="flex items-center gap-2 text-rojo-alerta dark:text-rojo-dark font-bold text-sm mb-3">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current flex-shrink-0"><path d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z"/></svg>
          <span>SHN avisa {sf?.altura_m.toFixed(2)}m en San Fernando — supera el nivel de no retorno ({umbral.toFixed(1)}m)</span>
        </div>
      )}

      {aviso.nota && (
        <p className="text-xs text-texto-sec dark:text-gray-400 mb-3 italic">
          {aviso.nota}
        </p>
      )}

      <CompartirWhatsApp mensaje={mensajeWhatsApp} />
    </section>
  );
}
