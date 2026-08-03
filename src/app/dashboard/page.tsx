"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import type { DatosAgregados, Lectura, Pronostico, EquivalenciaEscalon, Tendencia, AvisoShn, AvisoCrecida, NivelAlerta } from "@/lib/types";
import VistaSemanal from "@/components/VistaSemanal";
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
import CompartirWhatsApp from "@/components/CompartirWhatsApp";
import AvisoCrecidaCard from "@/components/AvisoCrecidaCard";
import { analizarCiclo } from "@/lib/ciclo";
import { ADMINS } from "@/lib/constants";

function direccionCardinal(grados: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(grados / 22.5) % 16];
}

function formatearHora(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit" });
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

function formatoTendencia(t: Tendencia | null): string {
  if (!t) return "sin datos suficientes";
  const base = t.direccion;
  if (t.direccion === "estable") return "estable";
  const vel = Math.abs(t.velocidad_cm_h).toFixed(1);
  if (t.duracion_hs >= 1) {
    const hs = Math.round(t.duracion_hs);
    return `${base} hace ~${hs}h a ~${vel}cm/h`;
  }
  return `${base} a ~${vel}cm/h`;
}

const colorAlerta = {
  verde: "bg-[#4C7A5E]",
  amarilla: "bg-[#E8823A]",
  roja: "bg-red-600",
  azul: "bg-blue-600",
  evacuacion: "bg-[#8B1E1E]",
};

const colorAlertaBg = {
  verde: "bg-green-50 border-[#4C7A5E]",
  amarilla: "bg-orange-50 border-[#E8823A]",
  roja: "bg-red-50 border-red-600",
  azul: "bg-blue-50 border-blue-600",
  evacuacion: "bg-[#FBF1F0] border-[#8B1E1E]",
};

export default function Dashboard() {
  const { user, cargando: authCargando } = useAuth();
  const [datos, setDatos] = useState<DatosAgregados | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cuentaRegresiva, setCuentaRegresiva] = useState<string | null>(null);
  const [cuentaPico, setCuentaPico] = useState<string | null>(null);
  const [historial, setHistorial] = useState<Lectura[]>([]);
  const [alertasList, setAlertasList] = useState<{ timestamp: string; nivel: NivelAlerta }[]>([]);
  const [lecturasLP, setLecturasLP] = useState<Lectura[]>([]);
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

      const filtrarPorEstacion = (id: string | undefined) =>
        (lecturas ?? []).filter((l) => l.estacion_id === id);

      const obs = (id: string | undefined) => filtrarPorEstacion(id).find((l) => l.tipo === "observado") ?? null;

      // LP readings for propagation (sorted asc, last 24h)
      const todasLP = filtrarPorEstacion(lpId).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      setLecturasLP(todasLP.slice(0, 24));

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

  useEffect(() => {
    const ventanaFin = datos?.alerta?.ventana_fin;
    if (!ventanaFin) {
      setCuentaRegresiva(null);
      return;
    }

    function tick() {
      const diff = new Date(ventanaFin!).getTime() - Date.now();
      if (diff <= 0) {
        setCuentaRegresiva("AHORA");
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setCuentaRegresiva(`${h}h ${m}m`);
    }

    tick();
    const interval = setInterval(tick, 10000);
    return () => clearInterval(interval);
  }, [datos?.alerta?.ventana_fin]);

  const alerta = datos?.alerta;
  const sfObs = datos?.sanFernando.observado;
  const sfProno = datos?.sanFernando.pronostico;
  const lpObs = datos?.exteriores.laPlata;
  const baObs = datos?.exteriores.buenosAires;
  const pnObs = datos?.exteriores.piloteNorden;
  const viento = datos?.viento;

  useEffect(() => {
    const futuros = (sfProno ?? [])
      .filter((p) => p.qualifier === "main")
      .filter((p) => new Date(p.timestamp).getTime() >= Date.now())
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const pico = futuros.length > 0
      ? futuros.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), futuros[0])
      : null;
    if (!pico) {
      setCuentaPico(null);
      return;
    }
    const picoTs = pico.timestamp;

    function tick() {
      const diff = new Date(picoTs).getTime() - Date.now();
      if (diff <= 0) {
        setCuentaPico("PICO AHORA");
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setCuentaPico(d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`);
    }

    tick();
    const interval = setInterval(tick, 10000);
    return () => clearInterval(interval);
  }, [sfProno]);

  const umbralEval = datos?.umbrales.find((u) => u.nombre === "evaluacion");
  const umbralNR = datos?.umbrales.find((u) => u.nombre === "no_retorno");
  const umbralBajAlarma = datos?.umbrales.find((u) => u.nombre === "bajante_alarma") ?? null;
  const umbralBajEvac = datos?.umbrales.find((u) => u.nombre === "bajante_evacuacion") ?? null;
  const trasladoMin = parseInt(datos?.config.find((c) => c.clave === "tiempo_traslado_minutos")?.valor ?? "10", 10);
  const escalones = datos?.escalones ?? [];
  const alertaNivel = alerta?.nivel ?? "verde";
  const esAdmin = !!user?.email && (ADMINS as readonly string[]).includes(user.email);
  const tendenciaSF = calcularTendencia(historial);

  // Análisis del ciclo de marea: usa el historial de SF y la señal adelantada de La Plata
  // (propagación ~2.5hs) para estimar cuánto resta de la subida/bajada actual.
  const ciclo = useMemo(
    () => analizarCiclo(historial, lecturasLP.slice(0, 24), 2.5),
    [historial, lecturasLP]
  );

  if (cargando) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F2E9DC]">
        <p className="text-[#0E4749] text-lg">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F2E9DC] dark:bg-[#0f172a]">
      <header className="bg-[#0E4749] dark:bg-[#0a2a2b] text-white px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center gap-x-3 gap-y-2 relative shadow-sm">
        <a href="/" className="flex items-center gap-3">
          <img src="/baliza-boya.svg" alt="Baliza" className="w-12 h-12 sm:w-14 sm:h-14 flex-shrink-0" />
          <span className="logo-wordmark">baliza</span>
        </a>
        <p className="text-[11px] text-[#F2E9DC]/70 dark:text-white/50 italic font-serif hidden sm:block border-l border-[#F2E9DC]/20 pl-3 leading-tight">
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
                className="text-xs text-white/70 hover:text-white border border-white/20 hover:bg-white/10 rounded px-2.5 py-1.5 transition-colors"
              >
                Salir
              </button>
            </>
          ) : (
            <button
              onClick={() => router.push("/auth/login")}
              className="text-xs text-white/70 hover:text-white border border-white/20 hover:bg-white/10 rounded px-2.5 py-1.5 transition-colors"
            >
              Ingresar
            </button>
          )}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-gradient-to-r from-[#E8823A]/50 via-[#4C7A5E]/30 to-transparent" />
      </header>

      <main className="max-w-3xl mx-auto px-3 sm:px-4 py-4 space-y-4 sm:space-y-5">
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
              <p className="recomendacion-titulo">
                {alerta?.mensaje?.split("| Preaviso:")[0]?.trim() ?? "Sin datos — esperando primera ingesta"}
              </p>
              <p className="recomendacion-subtexto">
                {sfObs?.nivel_m != null
                  ? `Nivel actual: ${sfObs.nivel_m.toFixed(2)}m ${tendenciaSF?.direccion === "subiendo" ? "subiendo" : tendenciaSF?.direccion === "bajando" ? "bajando" : "estable"}`
                  : "Esperando primera ingesta de datos"}
              </p>
              {(() => {
                const futuros = (sfProno ?? [])
                  .filter((p) => p.qualifier === "main")
                  .filter((p) => new Date(p.timestamp).getTime() >= Date.now())
                  .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                if (futuros.length === 0) return null;
                const pico = futuros.reduce((m, p) => (p.valor_m > m.valor_m ? p : m), futuros[0]);
                const umbral = umbralEval?.valor_m ?? 2.0;
                if (pico.valor_m < umbral) return null;
                return (
                  <p className="rb-pico">
                    Pico esperado en San Fernando: <strong>{pico.valor_m.toFixed(2)}m</strong> — {formatearFechaHora(pico.timestamp)}
                    {cuentaPico && (
                      <span className="ml-2 inline-block text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#8B1E1E]/10 text-[#8B1E1E] dark:bg-red-400/10 dark:text-red-300 border border-[#8B1E1E]/20">
                        ⏱ en {cuentaPico}
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
                  .filter((p) => new Date(p.timestamp).getTime() >= Date.now())
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
          />
        </section>

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
              <p className="seccion-titulo mb-1">
                Viento
              </p>
              {viento ? (
                <>
                  <p className="font-mono text-lg sm:text-xl font-bold text-[#0E4749] dark:text-[#4fc3c5]">
                    {viento.velocidad_kmh}
                    <span className="text-sm font-normal ml-1 font-sans text-[#5B6E68]">km/h</span>
                  </p>
                  <p className="text-sm text-[#5B6E68] dark:text-gray-400 mt-0.5">
                    {direccionCardinal(viento.direccion_grados)} ({viento.direccion_grados}°)
                  </p>
                  <p className="text-xs text-[#5B6E68]/60 dark:text-gray-500 mt-0.5 font-mono">{formatearFechaHora(viento.timestamp)}</p>
                </>
              ) : (
                <p className="text-sm text-[#5B6E68]/60 dark:text-gray-500 italic">sin datos</p>
              )}
            </section>
            <section className="dashboard-section">
              <PropagacionLP lecturasLP={lecturasLP} nivelSF={sfObs?.nivel_m} />
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

        {/* Estaciones exteriores — oculto temporalmente (no relevante para la vista principal) */}
        {/* <section className="dashboard-section">
          <p className="seccion-titulo mb-3">
            Estaciones exteriores — preaviso temprano
          </p>
          <div className="space-y-3">
            {[
              { nombre: "La Plata", obs: lpObs, tend: datos?.tendencias.laPlata ?? null, delay: "~2-3hs antes que SF" },
              { nombre: "Puerto de Buenos Aires", obs: baObs, tend: datos?.tendencias.buenosAires ?? null, delay: "~1hs antes que SF" },
              { nombre: "Pilote Norden", obs: pnObs, tend: datos?.tendencias.piloteNorden ?? null, delay: "" },
            ].map((est) => (
              <div key={est.nombre} className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm text-[#12312B] dark:text-gray-200">{est.nombre}</p>
                  {est.delay && <p className="text-xs text-[#5B6E68]/60 dark:text-gray-500">{est.delay}</p>}
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <p className="font-mono text-base sm:text-lg font-bold text-[#0E4749] dark:text-[#4fc3c5] whitespace-nowrap">
                    {est.obs ? `${est.obs.nivel_m.toFixed(2)}m` : <span className="text-xs font-normal italic text-[#5B6E68]/60">sin datos disponibles</span>}
                  </p>
                  <p className={`text-xs ${est.tend?.direccion === "subiendo" ? "text-[#C0442B]" : est.tend?.direccion === "bajando" ? "text-[#4C7A5E]" : "text-[#5B6E68]/60"} dark:text-gray-500`}>
                    {est.obs ? formatoTendencia(est.tend) : ""}
                  </p>
                  <p className="text-xs font-mono text-[#5B6E68]/60 dark:text-gray-500">
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

          const ahora = Date.now();
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
          const H = 220;
          const padL = 40;
          const padR = 18;
          const padT = 16;
          const padB = 30;

          const t0 = Math.min(ahora, ...(obsRecientes.map((o) => new Date(o.timestamp).getTime()) ?? [ahora]));
          const t1 = new Date(proximos[proximos.length - 1].timestamp).getTime();

          const xPos = (t: number): number => padL + ((t - t0) / Math.max(t1 - t0, 1)) * (W - padL - padR);
          const yPos = (v: number): number => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

          const rangoY = yMax - yMin;

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
              <p className="seccion-titulo mb-2">
                Pronóstico San Fernando — INA (modelo regresión)
              </p>
              <p className="text-xs text-[#5B6E68]/70 dark:text-gray-500 mb-3">
                Pico estimado: <strong className="font-mono">{pico.valor_m.toFixed(2)}m</strong>
                <span className="text-[#5B6E68]/70 dark:text-gray-500"> — {formatearFechaHora(pico.timestamp)}</span>
                {maxP95 > maxMain && (
                  <span> · p95: <strong className="font-mono text-[#C99A3D]">{maxP95.toFixed(2)}m</strong></span>
                )}
                {minP05 <= (umbralBajAlarma?.valor_m ?? 0) && (
                  <span> · Mínimo: <strong className="font-mono text-[#2563EB]">{minP05.toFixed(2)}m</strong></span>
                )}
              </p>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: "300px" }}>
                <defs>
                  <clipPath id="prono-clip"><rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} /></clipPath>
                </defs>

                {/* Grid horizontal + Y */}
                {yLabels.map((v) => (
                  <g key={v}>
                    <line x1={padL} y1={yPos(v)} x2={W - padR} y2={yPos(v)} stroke="#e5e7eb" strokeWidth="1" />
                    <text x={padL - 6} y={yPos(v) + 3} fontSize="9" fill="#9ca3af" textAnchor="end">{v.toFixed(1)}</text>
                  </g>
                ))}

                {/* Labels X */}
                {xLabels.map((xl) => (
                  <text key={xl.label + xl.x.toFixed(0)} x={xl.x} y={H - 8} fontSize={xl.esDia ? "9" : "8"} fontWeight={xl.esDia ? 600 : 400} fill="#9ca3af" textAnchor="middle">
                    {xl.label}
                  </text>
                ))}

                {/* Línea AHORA */}
                <line x1={xPos(ahora)} y1={padT} x2={xPos(ahora)} y2={H - padB} stroke="#6b7280" strokeWidth="1" strokeDasharray="3,3" />
                <text x={xPos(ahora) + 3} y={padT + 9} fontSize="8" fill="#6b7280" fontWeight="600">AHORA</text>

                {/* Umbrales */}
                {umbralEval && (
                  <g>
                    <line x1={padL} y1={yPos(umbralEval.valor_m)} x2={W - padR} y2={yPos(umbralEval.valor_m)} stroke="#C99A3D" strokeWidth="1.5" strokeDasharray="6,4" />
                    <text x={padL + 3} y={yPos(umbralEval.valor_m) - 4} fontSize="8" fill="#C99A3D" fontStyle="italic" fontWeight="600">eval {umbralEval.valor_m.toFixed(1)}</text>
                  </g>
                )}
                {umbralNR && (
                  <g>
                    <line x1={padL} y1={yPos(umbralNR.valor_m)} x2={W - padR} y2={yPos(umbralNR.valor_m)} stroke="#C0442B" strokeWidth="1.5" strokeDasharray="6,4" />
                    <text x={padL + 3} y={yPos(umbralNR.valor_m) - 4} fontSize="8" fill="#C0442B" fontStyle="italic" fontWeight="600">NR {umbralNR.valor_m.toFixed(1)}</text>
                  </g>
                )}
                {umbralBajAlarma && (
                  <g>
                    <line x1={padL} y1={yPos(umbralBajAlarma.valor_m)} x2={W - padR} y2={yPos(umbralBajAlarma.valor_m)} stroke="#2563EB" strokeWidth="1.5" strokeDasharray="6,4" />
                    <text x={padL + 3} y={yPos(umbralBajAlarma.valor_m) + 11} fontSize="8" fill="#2563EB" fontStyle="italic" fontWeight="600">baj {umbralBajAlarma.valor_m.toFixed(1)}</text>
                  </g>
                )}
                {umbralBajEvac && (
                  <g>
                    <line x1={padL} y1={yPos(umbralBajEvac.valor_m)} x2={W - padR} y2={yPos(umbralBajEvac.valor_m)} stroke="#8B1E1E" strokeWidth="1.5" strokeDasharray="6,4" />
                    <text x={padL + 3} y={yPos(umbralBajEvac.valor_m) + 11} fontSize="8" fill="#8B1E1E" fontStyle="italic" fontWeight="600">evac {umbralBajEvac.valor_m.toFixed(1)}</text>
                  </g>
                )}

                {/* Bandas */}
                <polygon points={bandaP25P75} fill="#0E4749" fillOpacity="0.16" clipPath="url(#prono-clip)" />
                <polygon points={bandaP05P95} fill="#0E4749" fillOpacity="0.08" clipPath="url(#prono-clip)" />

                {/* Observado */}
                {obsRecientes.length >= 2 && (
                  <polyline fill="none" stroke="#0E4749" strokeWidth="2" points={lineaObs} clipPath="url(#prono-clip)" />
                )}

                {/* Línea main */}
                <polyline fill="none" stroke="#E8823A" strokeWidth="2" points={lineaMain} clipPath="url(#prono-clip)" />

                {/* Pico */}
                <g>
                  <circle cx={picoX} cy={picoY} r="4" fill="#E8823A" stroke="#fff" strokeWidth="1.5" />
                  <text x={picoX} y={picoY - 8} fontSize="10" fill="#E8823A" fontWeight="700" textAnchor="middle">
                    {pico.valor_m.toFixed(2)}m
                  </text>
                  <text x={picoX} y={picoY + 18} fontSize="8" fill="#E8823A" textAnchor="middle">
                    {formatearFechaHora(pico.timestamp)}
                  </text>
                </g>
              </svg>

              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-[#5B6E68] dark:text-gray-400">
                <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-[#0E4749] inline-block" /> Observado</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0 inline-block border-t-2 border-[#E8823A]" /> Pronóstico main</span>
                <span className="flex items-center gap-1"><span className="w-3 h-[6px] bg-[#0E4749]/10 inline-block" /> p05–p95</span>
                <span className="flex items-center gap-1"><span className="w-3 h-[6px] bg-[#0E4749]/20 inline-block" /> p25–p75</span>
                {umbralNR && <span className="flex items-center gap-1"><span className="w-3 h-0 inline-block border-t-[1.5px] border-dashed border-[#C0442B]" /> NR {umbralNR.valor_m.toFixed(1)}m</span>}
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
                trasladoMin={trasladoMin}
                config={datos?.config}
                onSaved={() => {}}
                esAdmin={esAdmin}
              />
            </section>
          </>
        )}

        {/* Footer */}
        <footer className="py-6 text-center text-xs text-[#5B6E68]/50 dark:text-gray-500 space-y-1">
          <p>Los datos provienen de INA y SHN — herramienta de apoyo, no reemplaza el boletín oficial.</p>
          <p>
            <a href="https://alerta.ina.gob.ar" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#0E4749] dark:hover:text-[#4fc3c5]">Fuente INA</a>
            <span className="mx-1.5">·</span>
            <a href="https://www.hidro.gov.ar" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#0E4749] dark:hover:text-[#4fc3c5]">Fuente SHN</a>
          </p>
        </footer>
      </main>
    </div>
  );
}
