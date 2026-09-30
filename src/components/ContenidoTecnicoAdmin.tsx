import type { DatosAgregados, Lectura, Pronostico, EquivalenciaEscalon, Umbral, NivelAlerta, Tendencia } from "@/lib/types";
import type { AnalisisCiclo, PrediccionExtremos } from "@/lib/ciclo";
import { formatearFechaHora, tendenciaIcono } from "@/lib/dashboardHelpers";
import AvisoCrecidaCard from "@/components/AvisoCrecidaCard";
import EscalaHidrometro from "@/components/EscalaHidrometro";
import CurvaProyectada from "@/components/CurvaProyectada";
import FaseMarea from "@/components/FaseMarea";
import AnticipacionBajada from "@/components/AnticipacionBajada";

interface VientoPunto {
  timestamp: number;
  velocidad_kmh: number;
  direccion_grados: number;
  presion_hpa?: number | null;
}

interface Props {
  datos: DatosAgregados | null;
  sfObs: Lectura | null | undefined;
  sfProno: Pronostico[] | undefined;
  ahora: number;
  umbralEval: Umbral | undefined;
  umbralNR: Umbral | undefined;
  umbralBajAlarma: Umbral | null;
  umbralBajEvac: Umbral | null;
  umbralProno: Umbral | null;
  escalones: EquivalenciaEscalon[];
  alertaNivel: NivelAlerta;
  ciclo: AnalisisCiclo | null;
  prediccionExtremos: PrediccionExtremos;
  vientoHistoricoModelo: VientoPunto[];
  vientoPronosticoModelo: VientoPunto[];
  tendenciaSF: Tendencia | null;
  exterioresLecturas: { nombre: string; lecturas: Lectura[] }[];
  nivelSeguroM: number;
  historial: Lectura[];
}

// Contenido técnico visible solo para administradores: aviso oficial de
// crecida SHN, aviso de crecida pronosticada por INA, escala hidrométrica,
// curva proyectada, fase de marea y anticipación de la bajada. Extraído tal
// cual de dashboard/page.tsx (mismo bloque {user && esAdmin} de más arriba,
// ver ahí el segundo bloque admin de viento/propagación/validación que
// queda sin tocar) — mismas props, mismo JSX, solo reubicado.
export default function ContenidoTecnicoAdmin({
  datos,
  sfObs,
  sfProno,
  ahora,
  umbralEval,
  umbralNR,
  umbralBajAlarma,
  umbralBajEvac,
  umbralProno,
  escalones,
  alertaNivel,
  ciclo,
  prediccionExtremos,
  vientoHistoricoModelo,
  vientoPronosticoModelo,
  tendenciaSF,
  exterioresLecturas,
  nivelSeguroM,
  historial,
}: Props) {
  return (
    <>
      {/* Aviso oficial de crecida del SHN (el más importante) */}
      {datos?.avisoCrecida && (
        <AvisoCrecidaCard aviso={datos.avisoCrecida} umbralNR={umbralNR?.valor_m ?? null} />
      )}

      {/* Aviso de crecida pronosticada por INA (ventana 4 días) */}
      {(() => {
        const mainPronos = (sfProno ?? [])
          .filter((p) => p.qualifier === "main")
          .filter((p) => new Date(p.timestamp).getTime() >= ahora)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const pico = mainPronos.length
          ? mainPronos.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), mainPronos[0])
          : null;
        const umbralPro = umbralProno?.valor_m ?? 2.1;
        if (!pico || pico.valor_m <= umbralPro) return null;
        const picoFuturo = new Date(pico.timestamp).getTime() >= ahora;
        return (
          <section className={`dashboard-section ${pico.valor_m >= (umbralNR?.valor_m ?? 2.2) ? "shn-alerta" : ""}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <h2 className="seccion-titulo">
                Pronóstico INA — crecida pronosticada
              </h2>
            </div>
            <div className="flex items-center gap-2 text-rojo-alerta dark:text-rojo-dark font-bold text-sm">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current flex-shrink-0"><path d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z"/></svg>
              <span>
                INA pronostica un pico de {pico.valor_m.toFixed(2)}m{picoFuturo ? ` el ${formatearFechaHora(pico.timestamp)}` : ""} en San Fernando — supera el umbral de crecida ({umbralPro.toFixed(2)}m)
              </span>
            </div>
            <p className="text-xs text-texto-sec dark:text-gray-400 mt-1">
              Se avisará de nuevo solo si el pronóstico marca una altura aún mayor.
            </p>
            <p className="text-xs text-texto-sec dark:text-gray-400 mt-3">
              Fuente: INA — pronóstico a 4 días (qualifier main)
            </p>
          </section>
        );
      })()}

      {/* Escala hidrométrica + estado San Fernando */}
      <section className="dashboard-section">
        <EscalaHidrometro
          nivelActual={sfObs?.nivel_m ?? 0}
          tendencia={tendenciaIcono(historial.filter((h) => h.estacion_id === datos?.sanFernando.observado?.estacion_id).slice(-3))}
          timestamp={sfObs?.timestamp ?? ""}
          escalones={escalones}
          umbralEval={umbralEval ?? null}
          umbralNR={umbralNR ?? null}
          umbralBajAlarma={umbralBajAlarma}
          umbralBajEvac={umbralBajEvac}
          alertaNivel={alertaNivel}
          ciclo={ciclo}
          prediccion={prediccionExtremos}
        />
      </section>

      {/* Curva proyectada: marea armónica + forzante meteorológica (sudestada) */}
      <CurvaProyectada
        observaciones={historial}
        vientoHistorico={vientoHistoricoModelo}
        vientoPronostico={vientoPronosticoModelo}
        ahora={ahora}
        umbralEval={umbralEval ?? null}
        umbralNR={umbralNR ?? null}
      />

      {/* Fase de marea: veredicto de subida/bajada y pico pronosticado (SHN) */}
      <FaseMarea
        avisos={datos?.avisosShn ?? []}
        nivelActual={sfObs?.nivel_m ?? null}
        tendencia={tendenciaSF}
        ahora={ahora}
        proxPleamar={prediccionExtremos.pleamar}
      />

      {/* Anticipación de la bajada: las exteriores pasaron su pico y SF bajará */}
      <AnticipacionBajada
        sf={historial}
        exteriores={exterioresLecturas}
        nivelSeguroM={nivelSeguroM}
        ahora={ahora}
      />
    </>
  );
}
