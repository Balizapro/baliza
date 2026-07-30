"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import type { DatosAgregados, Lectura } from "@/lib/types";
import VistaSemanal from "@/components/VistaSemanal";
import Bitacora from "@/components/Bitacora";

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

const colorAlerta = {
  verde: "bg-[#4C7A5E]",
  amarilla: "bg-[#E8823A]",
  roja: "bg-red-600",
};

const colorAlertaBg = {
  verde: "bg-green-50 border-[#4C7A5E]",
  amarilla: "bg-orange-50 border-[#E8823A]",
  roja: "bg-red-50 border-red-600",
};

export default function Dashboard() {
  const [datos, setDatos] = useState<DatosAgregados | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cuentaRegresiva, setCuentaRegresiva] = useState<string | null>(null);

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
        .in("tipo", ["observado", "pronostico"])
        .order("timestamp", { ascending: false });

      const { data: viento } = await supabase
        .from("viento")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(1)
        .single();

      const { data: umbrales } = await supabase.from("umbrales").select("*");

      const { data: config } = await supabase.from("configuracion").select("*");

      const { data: alerta } = await supabase
        .from("alertas")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(1)
        .single();

      const filtrarPorEstacion = (id: string | undefined) =>
        (lecturas ?? []).filter((l) => l.estacion_id === id);

      const obs = (id: string | undefined) => filtrarPorEstacion(id).find((l) => l.tipo === "observado") ?? null;

      const d: DatosAgregados = {
        sanFernando: {
          observado: obs(sfId),
          pronostico: filtrarPorEstacion(sfId).filter((l) => l.tipo === "pronostico"),
        },
        exteriores: {
          laPlata: obs(lpId),
          buenosAires: obs(baId),
          piloteNorden: obs(pnId),
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
  const umbralEval = datos?.umbrales.find((u) => u.nombre === "evaluacion");
  const umbralNR = datos?.umbrales.find((u) => u.nombre === "no_retorno");
  const trasladoMin = parseInt(datos?.config.find((c) => c.clave === "tiempo_traslado_minutos")?.valor ?? "10", 10);
  const alertaNivel = alerta?.nivel ?? "verde";

  if (cargando) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F2E9DC]">
        <p className="text-[#0E4749] text-lg">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F2E9DC]">
      <header className="bg-[#0E4749] text-white px-4 py-3 flex items-center gap-2">
        <span className="text-2xl">⛯</span>
        <h1 className="text-xl font-bold tracking-tight">Baliza</h1>
        <span className="text-sm text-white/70 ml-2 hidden sm:inline">
          La señal antes de la crecida
        </span>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-4">
        <section className={`rounded-xl border-2 p-4 ${colorAlertaBg[alertaNivel]}`}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-xs uppercase tracking-widest font-semibold text-gray-500 mb-1">
                Recomendación
              </p>
              <p className={`text-lg font-bold ${alertaNivel === "roja" ? "text-red-700" : alertaNivel === "amarilla" ? "text-orange-700" : "text-green-700"}`}>
                {alerta?.mensaje ?? "Sin datos — esperando primera ingesta"}
              </p>
              {cuentaRegresiva && alertaNivel === "roja" && (
                <div className="mt-2">
                  <p className="text-2xl font-bold text-red-600">{cuentaRegresiva}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Tiempo estimado hasta punto de no retorno ({umbralNR?.valor_m.toFixed(1) ?? "--"}m)
                  </p>
                </div>
              )}
            </div>
            <span className={`inline-block w-4 h-4 rounded-full ${colorAlerta[alertaNivel]} flex-shrink-0 mt-1`} />
          </div>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs uppercase tracking-widest font-semibold text-gray-500 mb-1">
              San Fernando (brazo Luján)
            </p>
            <p className="text-3xl font-bold text-[#0E4749]">
              {sfObs?.nivel_m.toFixed(2) ?? "--"}m
              <span className="text-lg ml-1">{tendenciaIcono(sfObs ? [sfObs] : undefined)}</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {sfObs ? formatearFechaHora(sfObs.timestamp) : "sin datos"}
            </p>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs uppercase tracking-widest font-semibold text-gray-500 mb-1">
              Viento
            </p>
            {viento ? (
              <>
                <p className="text-3xl font-bold text-[#0E4749]">
                  {viento.velocidad_kmh}
                  <span className="text-base font-normal ml-1">km/h</span>
                </p>
                <p className="text-sm text-gray-600">
                  {direccionCardinal(viento.direccion_grados)} ({viento.direccion_grados}°)
                </p>
                <p className="text-xs text-gray-400">{formatearFechaHora(viento.timestamp)}</p>
              </>
            ) : (
              <p className="text-gray-400 text-sm">sin datos</p>
            )}
          </section>
        </div>

        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-widest font-semibold text-gray-500 mb-3">
            Estaciones exteriores — preaviso temprano
          </p>
          <div className="space-y-2">
            {[
              { nombre: "La Plata", obs: lpObs, delay: "~2-3hs antes que SF" },
              { nombre: "Puerto de Buenos Aires", obs: baObs, delay: "~1hs antes que SF" },
              { nombre: "Pilote Norden", obs: pnObs, delay: "" },
            ].map((est) => (
              <div key={est.nombre} className="flex items-center justify-between py-1 border-b border-gray-100 last:border-0">
                <div>
                  <p className="font-medium text-sm text-gray-800">{est.nombre}</p>
                  {est.delay && <p className="text-xs text-gray-400">{est.delay}</p>}
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-[#0E4749]">
                    {est.obs ? `${est.obs.nivel_m.toFixed(2)}m` : "--"}
                  </p>
                  <p className="text-xs text-gray-400">
                    {est.obs ? formatearHora(est.obs.timestamp) : "—"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-widest font-semibold text-gray-500 mb-2">
            Umbrales de referencia — San Fernando
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Evaluación</p>
              <p className="text-xl font-bold text-[#E8823A]">{umbralEval?.valor_m.toFixed(2) ?? "--"}m</p>
              <p className="text-xs text-gray-400">{umbralEval?.descripcion}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">No retorno</p>
              <p className="text-xl font-bold text-red-600">{umbralNR?.valor_m.toFixed(2) ?? "--"}m</p>
              <p className="text-xs text-gray-400">{umbralNR?.descripcion}</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              Tiempo de traslado escuela → muelle: <strong className="text-gray-700">{trasladoMin} min</strong>
              {" — "}la cuenta regresiva contempla salir con esa anticipación.
            </p>
          </div>
        </section>

        {/* Vista semanal Paraná */}
        <VistaSemanal parana={datos?.parana ?? { rosario: null, sanNicolas: null, zarate: null, campana: null, escobar: null }} />

        {/* Pronóstico San Fernando */}
        {sfProno && sfProno.length > 0 && (
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs uppercase tracking-widest font-semibold text-gray-500 mb-2">
              Pronóstico San Fernando (próximas hs)
            </p>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {sfProno.slice(0, 8).map((p, i) => (
                <div key={i} className="flex flex-col items-center flex-shrink-0">
                  <p className="text-sm font-bold text-[#0E4749]">{p.nivel_m.toFixed(2)}m</p>
                  <p className="text-xs text-gray-400">{formatearHora(p.timestamp)}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Bitácora */}
        <Bitacora nivelActual={sfObs?.nivel_m ?? 0} onRegistro={() => {}} />

        <footer className="text-center text-xs text-gray-400 py-4 space-y-1">
          <p>Los datos provienen de INA y SHN — herramienta de apoyo, no reemplaza el boletín oficial.</p>
          <p>
            <a href="https://alerta.ina.gob.ar" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#0E4749]">Fuente INA</a>
            {" · "}
            <a href="https://www.hidro.gov.ar" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#0E4749]">Fuente SHN</a>
          </p>
        </footer>
      </main>
    </div>
  );
}
