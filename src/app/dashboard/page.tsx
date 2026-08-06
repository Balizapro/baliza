"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import type { DatosAgregados, Lectura, Pronostico, EquivalenciaEscalon, Tendencia, AvisoShn, AvisoCrecida, NivelAlerta } from "@/lib/types";
import Bitacora from "@/components/Bitacora";
import { useAuth } from "@/components/AuthProvider";
import AdminPanel from "@/components/AdminPanel";
import ThemeToggle from "@/components/ThemeToggle";
import PropagacionLP from "@/components/PropagacionLP";
import EscalaHidrometro from "@/components/EscalaHidrometro";
import AlertaSmnCard from "@/components/AlertaSmnCard";
import AvisoShnCard from "@/components/AvisoShnCard";
import PushNotifications from "@/components/PushNotifications";
import AlertaSonora from "@/components/AlertaSonora";
import ComparacionModelo from "@/components/ComparacionModelo";
import EstadoFuentes from "@/components/EstadoFuentes";
import VerificacionPronostico from "@/components/VerificacionPronostico";
import ValidacionModelo from "@/components/ValidacionModelo";
import CompartirWhatsApp from "@/components/CompartirWhatsApp";
import AvisoCrecidaCard from "@/components/AvisoCrecidaCard";
import { analizarCiclo, predecirProximosExtremos } from "@/lib/ciclo";
import { useAhora } from "@/lib/useAhora";
import CurvaProyectada from "@/components/CurvaProyectada";
import { ADMINS } from "@/lib/constants";

function direccionCardinal(grados: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(grados / 22.5) % 16];
}

function formatearFechaHora(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function tendenciaIcono(lecturas: Lectura[] | undefined | null): string {
  if (!lecturas || lecturas.length < 2) return "—";
  const diff = lecturas[0].nivel_m - lecturas[1].nivel_m;
  if (diff > 0.01) return "↑";
  if (diff < -0.01) return "↓";
  return "→";
}

// Calcula dirección, velocidad de cambio (cm/h) y duración de la tendencia
// a partir de las últimas lecturas de una estación (orden descendente).
function calcularTendencia(lecturas: Lectura[] | undefined | null): Tendencia | null {
  if (!lecturas || lecturas.length < 2) return null;

  const ordenadas = [...lecturas].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const ultima = ordenadas[0];
  const anterior = ordenadas[1];
  const dtHs = (new Date(ultima.timestamp).getTime() - new Date(anterior.timestamp).getTime()) / 3600000;
  if (dtHs <= 0) return null;

  const diff = ultima.nivel_m - anterior.nivel_m;
  const velocidadCmH = (diff / dtHs) * 100;
  const direccion = diff > 0.01 ? "subiendo" : diff < -0.01 ? "bajando" : "estable";

  // Duración: cuánto hace que viene sosteniendo la misma dirección
  let duracionHs = 0;
  let desde: string | null = null;
  if (direccion !== "estable") {
    for (let i = 0; i < ordenadas.length - 1; i++) {
      const d = ordenadas[i].nivel_m - ordenadas[i + 1].nivel_m;
      const mismaDir = direccion === "subiendo" ? d > 0.01 : d < -0.01;
      if (!mismaDir) break;
      duracionHs +=
        (new Date(ordenadas[i].timestamp).getTime() - new Date(ordenadas[i + 1].timestamp).getTime()) / 3600000;
    }
    if (duracionHs > 0) {
      desde = new Date(new Date(ordenadas[0].timestamp).getTime() - duracionHs * 3600000).toISOString();
    }
  }

  return { direccion, velocidad_cm_h: velocidadCmH, duracion_hs: duracionHs, desde };
}

export default function Dashboard() {
  const { user } = useAuth();
  const [datos, setDatos] = useState<DatosAgregados | null>(null);
  const [cargando, setCargando] = useState(true);
  const [historial, setHistorial] = useState<Lectura[]>([]);
  const [alertasList, setAlertasList] = useState<{ timestamp: string; nivel: NivelAlerta }[]>([]);
  const [lecturasLP, setLecturasLP] = useState<Lectura[]>([]);
  const [lecturasLPHist, setLecturasLPHist] = useState<Lectura[]>([]);
  const [vientoHist, setVientoHist] = useState<{ timestamp: string; velocidad_kmh: number; direccion_grados: number; presion_hpa?: number | null }[]>([]);
  const [vientoProno, setVientoProno] = useState<{ timestamp: string; velocidad_kmh: number; direccion_grados: number; presion_hpa?: number | null }[]>([]);
  const router = useRouter();

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();

      const { data: estaciones } = await supabase.from("estaciones").select("*");
      if (!estaciones) return;

      const sfId = estaciones.find((e) => e.nombre.includes("San Fernando"))?.id;
      const lpId = estaciones.find((e) => e.nombre.includes("La Plata") && e.fuente === "INA")?.id;
      const baId = estaciones.find((e) => e.nombre.includes("Buenos Aires"))?.id;
      const pnId = estaciones.find((e) => e.nombre.includes("Pilote Norden"))?.id;
      const rosId = estaciones.find((e) => e.nombre === "Rosario")?.id;
      const snId = estaciones.find((e) => e.nombre === "San Nicolás")?.id;
      const zarId = estaciones.find((e) => e.nombre === "Zárate")?.id;
      const campId = estaciones.find((e) => e.nombre === "Campana")?.id;
      const escId = estaciones.find((e) => e.nombre === "Escobar")?.id;

      const ids = [sfId, lpId, baId, pnId, rosId, snId, zarId, campId, escId].filter(Boolean);
      const { data: lecturas } = await supabase
        .from("lecturas")
        .select("*")
        .in("estacion_id", ids)
        .eq("tipo", "observado")
        .order("timestamp", { ascending: false });

      const { data: pronosticos } = await supabase
        .from("pronosticos")
        .select("*")
        .in("estacion_id", [sfId].filter(Boolean))
        .order("timestamp", { ascending: true });

      const { data: viento } = await supabase
        .from("viento")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(1)
        .single();

      // Historial de viento (7 días, asc) para la regresión sudestada→nivel
      const sieteDiasAtrasV = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: vientoHistRaw } = await supabase
        .from("viento")
        .select("timestamp, velocidad_kmh, direccion_grados, presion_hpa")
        .gte("timestamp", sieteDiasAtrasV)
        .order("timestamp", { ascending: true });

      const { data: vientoPronoRaw } = await supabase
        .from("viento_pronostico")
        .select("timestamp, velocidad_kmh, direccion_grados, presion_hpa")
        .order("timestamp", { ascending: true });

      const { data: umbrales } = await supabase.from("umbrales").select("*");

      const { data: config } = await supabase.from("configuracion").select("*");

      const { data: escalones } = await supabase
        .from("equivalencia_escalones")
        .select("*")
        .order("escalon", { ascending: true });

      const { data: alerta } = await supabase
        .from("alertas")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(1)
        .single();

      const sieteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: historico } = await supabase
        .from("lecturas")
        .select("*")
        .eq("estacion_id", sfId)
        .eq("tipo", "observado")
        .gte("timestamp", sieteDiasAtras)
        .order("timestamp", { ascending: true });

      const { data: alertasHist } = await supabase
        .from("alertas")
        .select("timestamp, nivel")
        .gte("timestamp", sieteDiasAtras)
        .order("timestamp", { ascending: true });

      const { data: alertasSmn } = await supabase
        .from("alertas_smn")
        .select("*")
        .order("fecha", { ascending: true });

      const { data: avisosShn } = await supabase
        .from("avisos_shn")
        .select("*")
        .order("publicado", { ascending: false })
        .limit(6);

      const { data: avisoCrecidaRaw } = await supabase
        .from("avisos_crecida")
        .select("*")
        .eq("vigente", true)
        .order("emitido", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Un CESE de aviso solo informa durante 2 horas; pasado ese tiempo se descarta
      const avisoCrecida = avisoCrecidaRaw &&
        avisoCrecidaRaw.tipo.startsWith("cese_") &&
        new Date(avisoCrecidaRaw.emitido).getTime() + 2 * 60 * 60 * 1000 < Date.now()
        ? null
        : avisoCrecidaRaw;

      setHistorial((historico as Lectura[]) ?? []);
      setAlertasList((alertasHist as { timestamp: string; nivel: NivelAlerta }[]) ?? []);
      setVientoHist(
        (vientoHistRaw ?? []).map((v: { timestamp: string; velocidad_kmh: number; direccion_grados: number; presion_hpa?: number | null }) => ({
          timestamp: v.timestamp,
          velocidad_kmh: Number(v.velocidad_kmh),
          direccion_grados: Number(v.direccion_grados),
          presion_hpa: v.presion_hpa != null ? Number(v.presion_hpa) : null,
        }))
      );
      setVientoProno(
        (vientoPronoRaw ?? []).map((v: { timestamp: string; velocidad_kmh: number; direccion_grados: number; presion_hpa?: number | null }) => ({
          timestamp: v.timestamp,
          velocidad_kmh: Number(v.velocidad_kmh),
          direccion_grados: Number(v.direccion_grados),
          presion_hpa: v.presion_hpa != null ? Number(v.presion_hpa) : null,
        }))
      );

      const filtrarPorEstacion = (id: string | undefined) =>
        (lecturas ?? []).filter((l) => l.estacion_id === id);

      const obs = (id: string | undefined) => filtrarPorEstacion(id).find((l) => l.tipo === "observado") ?? null;

      // LP readings for propagation (sorted asc, last 24h)
      const todasLP = filtrarPorEstacion(lpId).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      setLecturasLP(todasLP.slice(0, 24));
      setLecturasLPHist(todasLP);

      const d: DatosAgregados = {
        sanFernando: {
          observado: obs(sfId),
          pronostico: (pronosticos as Pronostico[]) ?? [],
        },
        exteriores: {
          laPlata: obs(lpId),
          buenosAires: obs(baId),
          piloteNorden: obs(pnId),
        },
        tendencias: {
          laPlata: calcularTendencia(filtrarPorEstacion(lpId)),
          buenosAires: calcularTendencia(filtrarPorEstacion(baId)),
          piloteNorden: calcularTendencia(filtrarPorEstacion(pnId)),
        },
        parana: {
          rosario: obs(rosId),
          sanNicolas: obs(snId),
          zarate: obs(zarId),
          campana: obs(campId),
          escobar: obs(escId),
        },
        viento: viento ?? null,
        umbrales: umbrales ?? [],
        config: config ?? [],
        alerta: alerta ?? null,
        escalones: (escalones as EquivalenciaEscalon[]) ?? [],
        alertasSmn: (alertasSmn as unknown as { area_id: number; fecha: string; max_level: number; eventos_json: { id: number; max_level: number }[]; actualizado: string }[]) ?? [],
        avisosShn: (avisosShn as AvisoShn[]) ?? [],
        avisoCrecida: (avisoCrecida as AvisoCrecida | null) ?? null,
      };

      setDatos(d);
      setCargando(false);
    }

    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const alerta = datos?.alerta;
  const sfObs = datos?.sanFernando.observado;
  const sfProno = datos?.sanFernando.pronostico;
  const viento = datos?.viento;

  const umbralEval = datos?.umbrales.find((u) => u.nombre === "evaluacion");
  const umbralNR = datos?.umbrales.find((u) => u.nombre === "no_retorno");
  const umbralBajAlarma = datos?.umbrales.find((u) => u.nombre === "bajante_alarma") ?? null;
  const umbralBajEvac = datos?.umbrales.find((u) => u.nombre === "bajante_evacuacion") ?? null;
  const umbralProno = datos?.umbrales.find((u) => u.nombre === "pronostico_crecida") ?? null;
  const trasladoMin = parseInt(datos?.config.find((c) => c.clave === "tiempo_traslado_minutos")?.valor ?? "10", 10);
  const escalones = datos?.escalones ?? [];
  const alertaNivel = alerta?.nivel ?? "verde";
  const esAdmin = !!user?.email && (ADMINS as readonly string[]).includes(user.email);
  const tendenciaSF = calcularTendencia(historial);

  // Análisis del ciclo de marea: usa el historial de SF y la señal adelantada de La Plata
  // (propagación ~2.5hs) para estimar cuánto resta de la subida/bajada actual.
  // `ahora` fuerza recálculo periódico para que las horas se actualicen solas.
  const ahora = useAhora();

  // Conteos derivados de `ahora` (sin setState en effects): cuenta regresiva hasta
  // el punto de no retorno y hasta el pico pronosticado.
  const cuentaRegresiva = useMemo(() => {
    const ventanaFin = datos?.alerta?.ventana_fin;
    if (!ventanaFin) return null;
    const diff = new Date(ventanaFin).getTime() - ahora;
    if (diff <= 0) return "AHORA";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${h}h ${m}m`;
  }, [datos?.alerta?.ventana_fin, ahora]);

  const cuentaPico = useMemo(() => {
    const futuros = (sfProno ?? [])
      .filter((p) => p.qualifier === "main")
      .filter((p) => new Date(p.timestamp).getTime() >= ahora)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const pico = futuros.length > 0
      ? futuros.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), futuros[0])
      : null;
    if (!pico) return null;
    const diff = new Date(pico.timestamp).getTime() - ahora;
    if (diff <= 0) return "PICO AHORA";
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  }, [sfProno, ahora]);

  const ciclo = useMemo(
    () => analizarCiclo(historial, lecturasLP.slice(0, 24), 2.5, ahora),
    [historial, lecturasLP, ahora]
  );

  // Predicción de próximos extremos (pleamar/bajamar) a partir de la regularidad
  // del ciclo observado en SF (~12.4h semidiurno). Recálculo periódico con `ahora`.
  const prediccionExtremos = useMemo(
    () => predecirProximosExtremos(historial, ahora),
    [historial, ahora]
  );

  // Entrada del componente de curva: viento histórico y pronóstico como ms
  const vientoHistoricoModelo = useMemo(
    () => vientoHist.map((v) => ({ timestamp: new Date(v.timestamp).getTime(), velocidad_kmh: v.velocidad_kmh, direccion_grados: v.direccion_grados, presion_hpa: v.presion_hpa })),
    [vientoHist]
  );
  const vientoPronosticoModelo = useMemo(
    () => vientoProno.map((v) => ({ timestamp: new Date(v.timestamp).getTime(), velocidad_kmh: v.velocidad_kmh, direccion_grados: v.direccion_grados, presion_hpa: v.presion_hpa })),
    [vientoProno]
  );

  if (cargando) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-fondo">
        <p className="text-baliza text-lg">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-fondo dark:bg-surface-dark">
      <header className="bg-baliza dark:bg-header-dark text-white px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center gap-x-3 gap-y-2 relative shadow-sm">
        <Link href="/" className="flex items-center gap-3">
          <img src="/baliza-boya.svg" alt="Baliza" className="w-12 h-12 sm:w-14 sm:h-14 flex-shrink-0" />
          <span className="logo-wordmark">baliza</span>
        </Link>
        <p className="text-xs text-fondo/70 dark:text-white/50 italic font-serif hidden sm:block border-l border-fondo/20 pl-3 leading-tight">
          la señal antes de la crecida
        </p>
        <div className="ml-auto flex items-center gap-2">
          <AlertaSonora nivel={alertaNivel} />
          <PushNotifications />
          <ThemeToggle />
          {user ? (
            <>
              <span className="text-xs text-white/60 hidden sm:inline">{user.email}</span>
              <button
                onClick={async () => {
                  const supabase = createClient();
                  await supabase.auth.signOut();
                  router.refresh();
                }}
                className="min-h-11 inline-flex items-center text-xs text-white/80 hover:text-white border border-white/20 hover:bg-white/10 rounded-md px-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                aria-label="Cerrar sesión"
              >
                Salir
              </button>
            </>
          ) : (
            <button
              onClick={() => router.push("/auth/login")}
              className="min-h-11 inline-flex items-center text-xs text-white/80 hover:text-white border border-white/20 hover:bg-white/10 rounded-md px-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Ingresar
            </button>
          )}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-gradient-to-r from-alerta/50 via-ok/30 to-transparent" />
      </header>

      <main className="max-w-5xl mx-auto px-3 sm:px-6 py-4 space-y-4 sm:space-y-5">
        {/* Alerta / Recomendación */}
        <div className="recomendacion-banner-wrapper">
          <div className={`recomendacion-banner ${alertaNivel === "roja" ? "roja" : alertaNivel === "evacuacion" ? "evacuacion" : alertaNivel === "amarilla" ? "amarilla" : alertaNivel === "azul" ? "azul" : "verde"}`}>
            <div className="rb-icono">
              {alertaNivel === "roja" || alertaNivel === "evacuacion" ? (
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z"/></svg>
              ) : alertaNivel === "amarilla" || alertaNivel === "azul" ? (
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
              )}
            </div>
            <div className="rb-cuerpo">
              <p className="rb-etiqueta">
                {alertaNivel === "roja" ? "Alerta roja" : alertaNivel === "evacuacion" ? "Evacuación" : alertaNivel === "amarilla" ? "Atención" : alertaNivel === "azul" ? "Bajante" : "Normal"}
              </p>
              <h1 className="recomendacion-titulo">
                {alerta?.mensaje?.split("| Preaviso:")[0]?.trim() ?? "Sin datos — esperando primera ingesta"}
              </h1>
              <p className="recomendacion-subtexto">
                {sfObs?.nivel_m != null
                  ? `Nivel actual: ${sfObs.nivel_m.toFixed(2)}m ${tendenciaSF?.direccion === "subiendo" ? "subiendo" : tendenciaSF?.direccion === "bajando" ? "bajando" : "estable"}`
                  : "Esperando primera ingesta de datos"}
              </p>
              {(() => {
                const futuros = (sfProno ?? [])
                  .filter((p) => p.qualifier === "main")
                  .filter((p) => new Date(p.timestamp).getTime() >= ahora)
                  .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                if (futuros.length === 0) return null;
                const pico = futuros.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), futuros[0]);
                const umbral = umbralEval?.valor_m ?? 2.0;
                if (pico.valor_m < umbral) return null;
                return (
                  <p className="rb-pico">
                    Pico esperado en San Fernando: <strong>{pico.valor_m.toFixed(2)}m</strong> — {formatearFechaHora(pico.timestamp)}
                    {cuentaPico && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full bg-rojo-oscuro/10 text-rojo-oscuro dark:bg-red-400/10 dark:text-red-300 border border-rojo-oscuro/20">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3" aria-hidden="true"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/></svg>
                        en {cuentaPico}
                      </span>
                    )}
                  </p>
                );
              })()}
              {(() => {
                const preavisos = alerta?.disparadores_json?.preavisos as string[] | undefined;
                if (preavisos && preavisos.length > 0) {
                  return (
                    <div className="rb-seccion">
                      <p className="rb-seccion-titulo">Preaviso</p>
                      <ul className="rb-preavisos">
                        {preavisos.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  );
                }
                return null;
              })()}
              {alertaNivel !== "verde" && (
                <div className="rb-accion">
                  <span>
                    {alertaNivel === "evacuacion"
                      ? "Evacuar ahora — alejarse de la zona de riesgo"
                      : alertaNivel === "roja"
                        ? "Preparar salida — no esperar a último momento"
                        : alertaNivel === "amarilla"
                          ? "Vigilar de cerca — nivel subiendo"
                          : "Cuidado con la bajante"}
                  </span>
                </div>
              )}
              {(cuentaRegresiva && alertaNivel === "roja") && (
                <div className="rb-cuenta-regresiva">
                  <span className="rb-tiempo">{cuentaRegresiva}</span>
                  <span className="rb-tiempo-label">
                    hasta punto de no retorno ({umbralNR?.valor_m.toFixed(1) ?? "--"}m)
                  </span>
                </div>
              )}
              {(() => {
                const futuros = (sfProno ?? [])
                  .filter((p) => p.qualifier === "main")
                  .filter((p) => new Date(p.timestamp).getTime() >= ahora)
                  .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                const pico = futuros.length > 0
                  ? futuros.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), futuros[0])
                  : null;
                const etiquetaNivel =
                  alertaNivel === "roja" ? "ALERTA ROJA" :
                  alertaNivel === "evacuacion" ? "EVACUACIÓN" :
                  alertaNivel === "amarilla" ? "ATENCIÓN" :
                  alertaNivel === "azul" ? "BAJANTE" : "NIVEL NORMAL";
                const partes = [
                  `🔴 Baliza — ${etiquetaNivel}`,
                  sfObs?.nivel_m != null ? `Nivel actual en San Fernando: ${sfObs.nivel_m.toFixed(2)}m (${tendenciaSF?.direccion ?? "estable"})` : null,
                  pico ? `Pico esperado: ${pico.valor_m.toFixed(2)}m — ${formatearFechaHora(pico.timestamp)}` : null,
                  `Umbral de evaluación: ${umbralEval?.valor_m.toFixed(2) ?? "2.00"}m`,
                  `⚠ Más info: https://baliza-ashy.vercel.app`,
                ].filter(Boolean);
                return (
                  <CompartirWhatsApp mensaje={partes.join("\n")} />
                );
              })()}
            </div>
          </div>
        </div>

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

        {/* SHN + SMN en paralelo */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Aviso del SHN (pronóstico mareológico) */}
          <AvisoShnCard avisos={datos?.avisosShn ?? []} umbralNR={umbralNR?.valor_m ?? null} />

          {/* Alerta meteorológica SMN */}
          <AlertaSmnCard alertas={datos?.alertasSmn ?? []} />
        </div>

        {/* Viento + Propagación LP + Modelo INA vs propagación LP en paralelo */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
          <div className="space-y-4">
            <section className="dashboard-section">
              <h2 className="seccion-titulo mb-1">
                Viento
              </h2>
              {viento ? (
                <>
                  <p className="font-mono text-lg sm:text-xl font-bold text-baliza dark:text-marea-dark">
                    {viento.velocidad_kmh}
                    <span className="text-sm font-normal ml-1 font-sans text-texto-sec dark:text-gray-400">km/h</span>
                  </p>
                  <p className="text-sm text-texto-sec dark:text-gray-400 mt-0.5">
                    {direccionCardinal(viento.direccion_grados)} ({viento.direccion_grados}°)
                  </p>
                  <p className="text-xs text-texto-sec dark:text-gray-400 mt-0.5 font-mono">{formatearFechaHora(viento.timestamp)}</p>
                </>
              ) : (
                <p className="text-sm text-texto-sec dark:text-gray-400 italic">sin datos</p>
              )}
            </section>
            <section className="dashboard-section">
              <PropagacionLP lecturasLP={lecturasLP} lecturasLPHist={lecturasLPHist} lecturasSF={historial} nivelSF={sfObs?.nivel_m} />
            </section>
          </div>
          <section className="dashboard-section">
            <ComparacionModelo
              pronostico={sfProno ?? []}
              lecturasLP={lecturasLP}
              nivelSF={sfObs?.nivel_m}
            />
          </section>
        </div>

        {/* Verificación de pronóstico */}
        <VerificacionPronostico observaciones={historial} pronosticos={sfProno ?? []} />

        {/* Validación del modelo propio */}
        <ValidacionModelo observaciones={historial} vientoHistorico={vientoHistoricoModelo} />

        {/* Estaciones exteriores — oculto temporalmente (no relevante para la vista principal) */}
        {/* <section className="dashboard-section">
          <h2 className="seccion-titulo mb-3">
            Estaciones exteriores — preaviso temprano
          </h2>
          <div className="space-y-3">
            {[
              { nombre: "La Plata", obs: lpObs, tend: datos?.tendencias.laPlata ?? null, delay: "~2-3hs antes que SF" },
              { nombre: "Puerto de Buenos Aires", obs: baObs, tend: datos?.tendencias.buenosAires ?? null, delay: "~1hs antes que SF" },
              { nombre: "Pilote Norden", obs: pnObs, tend: datos?.tendencias.piloteNorden ?? null, delay: "" },
            ].map((est) => (
              <div key={est.nombre} className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm text-texto dark:text-gray-200">{est.nombre}</p>
                  {est.delay && <p className="text-xs text-texto-sec dark:text-gray-400">{est.delay}</p>}
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <p className="font-mono text-base sm:text-lg font-bold text-baliza dark:text-marea-dark whitespace-nowrap">
                    {est.obs ? `${est.obs.nivel_m.toFixed(2)}m` : <span className="text-xs font-normal italic text-texto-sec">sin datos disponibles</span>}
                  </p>
                  <p className={`text-xs ${est.tend?.direccion === "subiendo" ? "text-rojo-alerta" : est.tend?.direccion === "bajando" ? "text-ok" : "text-texto-sec"} dark:text-gray-400`}>
                    {est.obs ? formatoTendencia(est.tend) : ""}
                  </p>
                  <p className="text-xs font-mono text-texto-sec dark:text-gray-400">
                    {est.obs ? formatearHora(est.obs.timestamp) : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section> */}

        {/* Vista semanal Paraná — oculto temporalmente */}
        {/* <section className="dashboard-section">
          <VistaSemanal parana={datos?.parana ?? { rosario: null, sanNicolas: null, zarate: null, campana: null, escobar: null }} />
        </section> */}

        {/* Pronóstico San Fernando */}
        {(() => {
          const main = sfProno?.filter((p) => p.qualifier === "main") ?? [];
          const bandas = new Map<string, { p05?: number; p25?: number; p75?: number; p95?: number }>();
          for (const p of sfProno ?? []) {
            if (p.qualifier === "main") continue;
            const b = bandas.get(p.timestamp) ?? {};
            b[p.qualifier as "p05" | "p25" | "p75" | "p95"] = p.valor_m;
            bandas.set(p.timestamp, b);
          }

          const proximos = main
            .filter((p) => new Date(p.timestamp).getTime() >= ahora)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .slice(0, 48);
          if (proximos.length === 0) return null;

          // Últimas lecturas observadas (48h) para anclar el pronóstico
          const obsRecientes = (historial ?? [])
            .filter((l) => new Date(l.timestamp).getTime() >= ahora - 48 * 60 * 60 * 1000)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

          const maxP95 = Math.max(
            ...proximos.map((p) => bandas.get(p.timestamp)?.p95 ?? p.valor_m),
            ...(obsRecientes.map((o) => o.nivel_m) ?? []),
            0
          );
          const maxMain = Math.max(...proximos.map((p) => p.valor_m));
          const minP05 = Math.min(
            ...proximos.map((p) => bandas.get(p.timestamp)?.p05 ?? p.valor_m),
            ...(obsRecientes.map((o) => o.nivel_m) ?? []),
            Number.POSITIVE_INFINITY
          );

          const yMax = Math.max(maxP95, umbralNR?.valor_m ?? 2.2) + 0.3;
          const yMin = Math.min(minP05, umbralBajAlarma?.valor_m ?? 0, umbralBajEvac?.valor_m ?? -0.3) - 0.1;

          const W = 680;
          const H = 240;
          const padL = 44;
          const padR = 18;
          const padT = 18;
          const padB = 32;

          const t0 = Math.min(ahora, ...(obsRecientes.map((o) => new Date(o.timestamp).getTime()) ?? [ahora]));
          const t1 = new Date(proximos[proximos.length - 1].timestamp).getTime();

          const xPos = (t: number): number => padL + ((t - t0) / Math.max(t1 - t0, 1)) * (W - padL - padR);
          const yPos = (v: number): number => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

          const yLabels: number[] = [];
          for (let v = Math.ceil(yMin * 2) / 2; v <= Math.floor(yMax * 2) / 2 + 0.001; v += 0.5) {
            yLabels.push(Math.round(v * 100) / 100);
          }

          // Labels de hora cada 6hs y de día al cambiar de fecha local
          const xLabels: { x: number; label: string; esDia: boolean }[] = [];
          const pasoHs = Math.max(6, Math.round((t1 - t0) / (3600000 * 10)));
          const horaLocal = (ts: string) => new Date(ts).getTime();
          let ultimoDia = "";
          for (let t = t0 + (t1 - t0) * 0.01; t <= t1; t += pasoHs * 3600000) {
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
          void horaLocal;

          const pico = proximos.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), proximos[0]);
          const picoX = xPos(new Date(pico.timestamp).getTime());
          const picoY = yPos(pico.valor_m);

          const lineaObs = obsRecientes
            .map((o) => `${xPos(new Date(o.timestamp).getTime()).toFixed(1)},${yPos(o.nivel_m).toFixed(1)}`)
            .join(" ");

          const lineaMain = proximos
            .map((p) => `${xPos(new Date(p.timestamp).getTime()).toFixed(1)},${yPos(p.valor_m).toFixed(1)}`)
            .join(" ");

          const bandaP05P95 = proximos
            .map((p) => {
              const x = xPos(new Date(p.timestamp).getTime()).toFixed(1);
              const hi = bandas.get(p.timestamp)?.p95 ?? p.valor_m;
              return `${x},${yPos(hi).toFixed(1)}`;
            })
            .join(" ") +
            " " +
            [...proximos]
              .reverse()
              .map((p) => {
                const x = xPos(new Date(p.timestamp).getTime()).toFixed(1);
                const lo = bandas.get(p.timestamp)?.p05 ?? p.valor_m;
                return `${x},${yPos(lo).toFixed(1)}`;
              })
              .join(" ");

          const bandaP25P75 = proximos
            .map((p) => {
              const x = xPos(new Date(p.timestamp).getTime()).toFixed(1);
              const hi = bandas.get(p.timestamp)?.p75 ?? p.valor_m;
              return `${x},${yPos(hi).toFixed(1)}`;
            })
            .join(" ") +
            " " +
            [...proximos]
              .reverse()
              .map((p) => {
                const x = xPos(new Date(p.timestamp).getTime()).toFixed(1);
                const lo = bandas.get(p.timestamp)?.p25 ?? p.valor_m;
                return `${x},${yPos(lo).toFixed(1)}`;
              })
              .join(" ");

          return (
            <section className="dashboard-section">
              <h2 className="seccion-titulo mb-2">
                Pronóstico San Fernando — INA (modelo regresión)
              </h2>
              <p className="text-xs text-texto-sec dark:text-gray-400 mb-3">
                Pico estimado: <strong className="font-mono">{pico.valor_m.toFixed(2)}m</strong>
                <span className="text-texto-sec dark:text-gray-400"> — {formatearFechaHora(pico.timestamp)}</span>
                {maxP95 > maxMain && (
                  <span> · p95: <strong className="font-mono text-atencion">{maxP95.toFixed(2)}m</strong></span>
                )}
                {minP05 <= (umbralBajAlarma?.valor_m ?? 0) && (
                  <span> · Mínimo: <strong className="font-mono text-bajante">{minP05.toFixed(2)}m</strong></span>
                )}
              </p>
              {proximos.length > 0 && (
                <p className="text-xs text-texto-sec dark:text-gray-400 mb-3">
                  Pronóstico válido hasta: <strong className="font-mono">{formatearFechaHora(proximos[proximos.length - 1].timestamp)}</strong>
                </p>
              )}
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: "300px" }}>
                <defs>
                  <clipPath id="prono-clip"><rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} /></clipPath>
                </defs>

                {/* Grid horizontal + Y */}
                {yLabels.map((v) => (
                  <g key={v}>
                    <line x1={padL} y1={yPos(v)} x2={W - padR} y2={yPos(v)} stroke="var(--chart-grid)" strokeWidth="1" />
                    <text x={padL - 8} y={yPos(v) + 3.5} fontSize="11" fill="var(--chart-axis)" textAnchor="end">{v.toFixed(1)}</text>
                  </g>
                ))}

                {/* Labels X */}
                {xLabels.map((xl) => (
                  <text key={xl.label + xl.x.toFixed(0)} x={xl.x} y={H - 9} fontSize={xl.esDia ? "11" : "10"} fontWeight={xl.esDia ? 600 : 400} fill="var(--chart-axis)" textAnchor="middle">
                    {xl.label}
                  </text>
                ))}

                {/* Línea AHORA */}
                <line x1={xPos(ahora)} y1={padT} x2={xPos(ahora)} y2={H - padB} stroke="var(--chart-ahora)" strokeWidth="1" strokeDasharray="3,3" />
                <text x={xPos(ahora) + 4} y={padT + 10} fontSize="10" fill="var(--chart-ahora)" fontWeight="600">AHORA</text>

                {/* Umbrales */}
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
                {umbralBajAlarma && (
                  <g>
                    <line x1={padL} y1={yPos(umbralBajAlarma.valor_m)} x2={W - padR} y2={yPos(umbralBajAlarma.valor_m)} stroke="var(--color-bajante)" strokeWidth="1.5" strokeDasharray="6,4" />
                    <text x={padL + 4} y={yPos(umbralBajAlarma.valor_m) + 12} fontSize="10" fill="var(--color-bajante)" fontStyle="italic" fontWeight="600">baj {umbralBajAlarma.valor_m.toFixed(1)}</text>
                  </g>
                )}
                {umbralBajEvac && (
                  <g>
                    <line x1={padL} y1={yPos(umbralBajEvac.valor_m)} x2={W - padR} y2={yPos(umbralBajEvac.valor_m)} stroke="var(--color-rojo-oscuro)" strokeWidth="1.5" strokeDasharray="6,4" />
                    <text x={padL + 4} y={yPos(umbralBajEvac.valor_m) + 12} fontSize="10" fill="var(--color-rojo-oscuro)" fontStyle="italic" fontWeight="600">evac {umbralBajEvac.valor_m.toFixed(1)}</text>
                  </g>
                )}

                {/* Bandas */}
                <polygon points={bandaP25P75} fill="var(--chart-obs)" fillOpacity="0.16" clipPath="url(#prono-clip)" />
                <polygon points={bandaP05P95} fill="var(--chart-obs)" fillOpacity="0.08" clipPath="url(#prono-clip)" />

                {/* Observado */}
                {obsRecientes.length >= 2 && (
                  <polyline fill="none" stroke="var(--chart-obs)" strokeWidth="2" points={lineaObs} clipPath="url(#prono-clip)" />
                )}

                {/* Línea main */}
                <polyline fill="none" stroke="var(--chart-main)" strokeWidth="2" points={lineaMain} clipPath="url(#prono-clip)" />

                {/* Pico */}
                <g>
                  <circle cx={picoX} cy={picoY} r="4" fill="var(--chart-main)" stroke="#fff" strokeWidth="1.5" />
                  <text x={picoX} y={picoY - 8} fontSize="10" fill="var(--chart-main)" fontWeight="700" textAnchor="middle">
                    {pico.valor_m.toFixed(2)}m
                  </text>
                  <text x={picoX} y={picoY + 18} fontSize="8" fill="var(--chart-main)" textAnchor="middle">
                    {formatearFechaHora(pico.timestamp)}
                  </text>
                </g>
              </svg>

              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-texto-sec dark:text-gray-400">
                <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-baliza dark:bg-marea-dark inline-block" /> Observado</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0 inline-block border-t-2 border-alerta" /> Pronóstico main</span>
                <span className="flex items-center gap-1"><span className="w-3 h-[6px] bg-alerta/10 inline-block" /> p05–p95</span>
                <span className="flex items-center gap-1"><span className="w-3 h-[6px] bg-alerta/20 inline-block" /> p25–p75</span>
                {umbralNR && <span className="flex items-center gap-1"><span className="w-3 h-0 inline-block border-t-[1.5px] border-dashed border-rojo-alerta" /> NR {umbralNR.valor_m.toFixed(1)}m</span>}
              </div>
            </section>
          );
        })()}

        {/* Salud de fuentes */}
        <EstadoFuentes
          observadoSF={sfObs}
          pronosticos={sfProno ?? []}
          viento={viento}
          avisosShn={datos?.avisosShn ?? []}
          alertasSmn={datos?.alertasSmn ?? []}
        />

        {/* Bitácora y configuración — solo admin */}
        {user && esAdmin && (
          <>
            <section className="dashboard-section">
              <Bitacora
                nivelActual={sfObs?.nivel_m ?? 0}
                onRegistro={() => {}}
                loggedIn={!!user}
                historial={historial}
                alertas={alertasList}
                umbralEval={umbralEval?.valor_m}
                umbralNR={umbralNR?.valor_m}
              />
            </section>

            <section className="dashboard-section">
              <AdminPanel
                umbralEval={umbralEval ?? null}
                umbralNR={umbralNR ?? null}
                umbralBajAlarma={umbralBajAlarma}
                umbralBajEvac={umbralBajEvac}
                umbralProno={umbralProno ?? null}
                trasladoMin={trasladoMin}
                config={datos?.config}
                onSaved={() => {}}
                esAdmin={esAdmin}
              />
            </section>
          </>
        )}

        {/* Footer */}
        <footer className="py-6 text-center text-xs text-texto-sec dark:text-gray-400 space-y-1">
          <p>Los datos provienen de INA y SHN — herramienta de apoyo, no reemplaza el boletín oficial.</p>
          <p>
            <a href="https://alerta.ina.gob.ar" target="_blank" rel="noopener noreferrer" className="underline hover:text-baliza dark:hover:text-marea-dark">Fuente INA</a>
            <span className="mx-1.5">·</span>
            <a href="https://www.hidro.gov.ar" target="_blank" rel="noopener noreferrer" className="underline hover:text-baliza dark:hover:text-marea-dark">Fuente SHN</a>
          </p>
        </footer>
      </main>
    </div>
  );
}
