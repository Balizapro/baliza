"use client";

import type { NivelAlerta, EquivalenciaEscalon } from "@/lib/types";

interface Props {
  alertaNivel: NivelAlerta;
  escalon: string;
  escalones: EquivalenciaEscalon[];
}

const PASOS: Record<NivelAlerta, { titulo: string; pasos: { hacer: string; cuando: string }[] }> = {
  verde: {
    titulo: "Rutina normal",
    pasos: [
      { hacer: "Verificar el nivel al llegar y al mediodía", cuando: "diario" },
      { hacer: "Confirmar que las notificaciones estén activas (sirena y push)", cuando: "semanal" },
      { hacer: "Revisar el panel de salud de fuentes: los datos deben estar al día", cuando: "diario" },
    ],
  },
  azul: {
    titulo: "Bajante — cuidado con la navegación",
    pasos: [
      { hacer: "Avisar a remadores y salidas al agua: pueden aparecer bancos y palos", cuando: "hoy" },
      { hacer: "Respetar la franja de navegación segura y reducir velocidad en canales", cuando: "siempre" },
      { hacer: "Revisar amarras y embarcaciones por bajo calado", cuando: "esta semana" },
    ],
  },
  amarilla: {
    titulo: "Atención — el nivel está subiendo",
    pasos: [
      { hacer: "Informar al equipo docente y a las familias por los canales habituales", cuando: "hoy" },
      { hacer: "Revisar el pico esperado y la hora: planificar salida anticipada si cae en horario escolar", cuando: "hoy" },
      { hacer: "Chequear accesos al predio y disponibilidad de botes/traslado", cuando: "en 24h" },
      { hacer: "Repasar el protocolo de evacuación con el personal", cuando: "en 24h" },
    ],
  },
  roja: {
    titulo: "Preparar salida — no esperar al último momento",
    pasos: [
      { hacer: "Activar el plan: avisar a todas las familias con el horario de cierre", cuando: "inmediato" },
      { hacer: "Fijar hora de salida para docentes y alumnado según el pico pronosticado", cuando: "inmediato" },
      { hacer: "Guardar material, subir equipamiento y desenchufar lo que esté bajo cota", cuando: "antes del corte" },
      { hacer: "Designar quién verifica el nivel en el hidrómetro hasta el cierre", cuando: "cada 2h" },
    ],
  },
  evacuacion: {
    titulo: "Evacuar ahora — alejarse de la zona de riesgo",
    pasos: [
      { hacer: "Evacuar de inmediato: nadie permanece en el predio", cuando: "ya" },
      { hacer: "Trasladar a personas a un punto seguro fuera del sector inundable", cuando: "ya" },
      { hacer: "Cortar suministros (luz/gas) solo si es seguro hacerlo", cuando: "al salir" },
      { hacer: "Registrar la evacuación en la bitácora con hora de salida", cuando: "al salir" },
      { hacer: "No regresar hasta confirmar que el nivel bajó del umbral de evaluación", cuando: "después" },
    ],
  },
};

export default function QueHacerAhora({ alertaNivel, escalon, escalones }: Props) {
  const guia = PASOS[alertaNivel] ?? PASOS.verde;
  const escalonesRestantes = escalon !== "--"
    ? (() => {
        const n = parseInt(escalon, 10);
        if (!Number.isNaN(n) && escalones.length > 0) {
          const ultimo = escalones[escalones.length - 1].escalon;
          return Math.max(0, ultimo - n);
        }
        return null;
      })()
    : null;

  const colorBorde =
    alertaNivel === "roja" || alertaNivel === "evacuacion" ? "border-[#C0442B]/40"
    : alertaNivel === "amarilla" ? "border-[#E8823A]/40"
    : alertaNivel === "azul" ? "border-[#2563EB]/40"
    : "border-[#4C7A5E]/40";

  return (
    <section className={`dashboard-section ${colorBorde}`}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <p className="seccion-titulo">¿Qué hacer ahora?</p>
        {escalon !== "--" && (
          <span className="text-xs px-2 py-0.5 rounded-full border border-[#0E4749]/30 bg-[#0E4749]/5 text-[#0E4749] dark:text-[#4fc3c5] dark:border-[#4fc3c5]/30">
            Escalón {escalon}{escalonesRestantes !== null ? ` · ${escalonesRestantes} restantes` : ""}
          </span>
        )}
      </div>

      <p className="text-sm font-medium text-[#0E4749] dark:text-[#4fc3c5] mb-2">{guia.titulo}</p>

      <ol className="space-y-1.5">
        {guia.pasos.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#0E4749]/10 dark:bg-[#4fc3c5]/10 text-[#0E4749] dark:text-[#4fc3c5] text-xs font-bold flex items-center justify-center mt-0.5">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[#12312B] dark:text-gray-200">{p.hacer}</p>
              <p className="text-xs text-[#5B6E68]/70 dark:text-gray-500">{p.cuando}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
