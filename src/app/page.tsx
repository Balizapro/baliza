"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import type { DatosAgregados, Lectura } from "@/lib/types";

function direccionCardinal(grados: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(grados / 22.5) % 16];
}

function formatearHora(iso: string | null): string {
  if (!iso) return "--";
  const d = new Date(iso);
  return d.toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function formatearFechaHora(iso: string | null): string {
  if (!iso) return "--";
  const d = new Date(iso);
  return d.toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function tendenciaIcono(lecturas: Lectura[] | undefined | null): string {
  if (!lecturas || lecturas.length < 2) return "—";
  const diff = lecturas[0].nivel_m - lecturas[1].nivel_m;
  if (diff > 0.01) return "↑";
  if (diff < -0.01) return "↓";
  return "→";
}

function calcularCuentaRegresiva(ventanaFin: string | null): string | null {
  if (!ventanaFin) return null;
  const diff = new Date(ventanaFin).getTime() - Date.now();
  if (diff <= 0) return "AHORA";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m`;
}

const colorAlerta: Record<string, string> = {
  verde: "bg-[#4C7A5E]",
  amarilla: "bg-[#E8823A]",
  roja: "bg-red-600",
};

const colorAlertaBg: Record<string, string> = {
  verde: "bg-green-50 border-[#4C7A5E]",
  amarilla: "bg-orange-50 border-[#E8823A]",
  roja: "bg-red-50 border-red-600",
};

export default function Dashboard() {
  const [datos, setDatos] = useState<DatosAgregados | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();

      const { data: estaciones } = await supabase.from("estaciones").select("*");
      if (!estaciones) return;

      const sfId = estaciones.find((e) => e.nombre.includes("San Fernando"))?.id;
      const lpId = estaciones.find((e) => e.nombre.includes("La Plata"))?.id;
      const baId = estaciones.find((e) => e.nombre.includes("Buenos Aires"))?.id;
      const pnId = estaciones.find((e) => e.nombre.includes("Pilote Norden"))?.id;

      const ids = [sfId, lpId, baId, pnId].filter(Boolean);
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

      const { data: umbrales } = await supabase
        .from("umbrales")
        .select("*");

      const { data: alertas } = await supabase
        .from("alertas")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(1)
        .single();

      const filtrarPorEstacion = (id: string | undefined) =>
        (lecturas ?? []).filter((l) => l.estacion_id === id);

      const d: DatosAgregados = {
        sanFernando: {
          observado: filtrarPorEstacion(sfId).find((l) => l.tipo === "observado") ?? null,
          pronostico: filtrarPorEstacion(sfId).filter((l) => l.tipo === "pronostico"),
        },
        exteriores: {
          laPlata: filtrarPorEstacion(lpId).find((l) => l.tipo === "observado") ?? null,
          buenosAires: filtrarPorEstacion(baId).find((l) => l.tipo === "observado") ?? null,
          piloteNorden: filtrarPorEstacion(pnId).find((l) => l.tipo === "observado") ?? null,
        },
        viento: viento ?? null,
        umbrales: umbrales ?? [],
        alerta: alertas ?? null,
      };

      setDatos(d);
      setCargando(false);
    }

    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  if (cargando) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F2E9DC]">
        <p className="text-[#0E4749] text-lg">Cargando...</p>
      </div>
    );
  }

  const alerta = datos?.alerta;
  const sfObs = datos?.sanFernando.observado;
  const sfProno = datos?.sanFernando.pronostico;
  const lpObs = datos?.exteriores.laPlata;
  const baObs = datos?.exteriores.buenosAires;
  const pnObs = datos?.exteriores.piloteNorden;
  const viento = datos?.viento;
  const umbralEval = datos?.umbrales.find((u) => u.nombre === "evaluacion");
  const umbralNR = datos?.umbrales.find((u) => u.nombre === "no_retorno");
  const cuentaRegresiva = calcularCuentaRegresiva(alerta?.ventana_fin ?? null);

  const alertaNivel = alerta?.nivel ?? "verde";

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
        {/* Alerta principal */}
        <section className={`rounded-xl border-2 p-4 ${colorAlertaBg[alertaNivel]}`}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-xs uppercase tracking-widest font-semibold text-gray-500 mb-1">
                Recomendación
              </p>
              <p className={`text-lg font-bold ${alertaNivel === "roja" ? "text-red-700" : alertaNivel === "amarilla" ? "text-orange-700" : "text-green-700"}`}>
                {alerta?.mensaje ?? "Sin datos — esperando primera ingesta"}
              </p>
              {cuentaRegresiva && (
                <p className="text-2xl font-bold text-red-600 mt-2">
                  {cuentaRegresiva}
                </p>
              )}
            </div>
            <span className={`inline-block w-4 h-4 rounded-full ${colorAlerta[alertaNivel]} flex-shrink-0 mt-1`} />
          </div>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Nivel San Fernando */}
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

          {/* Viento */}
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
                <p className="text-xs text-gray-400">
                  {formatearFechaHora(viento.timestamp)}
                </p>
              </>
            ) : (
              <p className="text-gray-400 text-sm">sin datos</p>
            )}
          </section>
        </div>

        {/* Estaciones exteriores */}
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

        {/* Umbrales */}
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-widest font-semibold text-gray-500 mb-2">
            Umbrales de referencia (San Fernando)
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
        </section>

        {/* Pronóstico */}
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

        {/* Footer */}
        <footer className="text-center text-xs text-gray-400 py-4 space-y-1">
          <p>Los datos provienen de INA y SHN — herramienta de apoyo, no reemplaza el boletín oficial.</p>
          <p>
            <a href="https://alerta.ina.gob.ar" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#0E4749]">
              Fuente INA
            </a>
            {" · "}
            <a href="https://www.hidro.gov.ar" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#0E4749]">
              Fuente SHN
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
