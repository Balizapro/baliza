import type { Alerta } from "@/lib/types";

export interface EpisodioAlertaDia {
  clave: string;
  etiqueta: string;
  alertas: Alerta[];
}

function etiquetaDia(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  const mismoDia = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (mismoDia(d, hoy)) return "Hoy";
  if (mismoDia(d, ayer)) return "Ayer";
  return d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "short" });
}

// Agrupa alertas por día calendario, días más recientes primero y,
// dentro de cada día, en orden cronológico (más antigua primero).
export function agruparAlertasPorDia(alertas: Alerta[]): EpisodioAlertaDia[] {
  const ordenadas = [...alertas].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const grupos = new Map<string, EpisodioAlertaDia>();
  for (const alerta of ordenadas) {
    const clave = new Date(alerta.timestamp).toDateString();
    const existente = grupos.get(clave);
    if (existente) {
      existente.alertas.push(alerta);
    } else {
      grupos.set(clave, { clave, etiqueta: etiquetaDia(alerta.timestamp), alertas: [alerta] });
    }
  }

  return [...grupos.values()].sort(
    (a, b) => new Date(b.alertas[0].timestamp).getTime() - new Date(a.alertas[0].timestamp).getTime()
  );
}
