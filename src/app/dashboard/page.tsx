"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import type { DatosAgregados, Lectura, Pronostico, EquivalenciaEscalon } from "@/lib/types";
import VistaSemanal from "@/components/VistaSemanal";
import Bitacora from "@/components/Bitacora";
import { useAuth } from "@/components/AuthProvider";
import AdminPanel from "@/components/AdminPanel";
import GraficoHistorico from "@/components/GraficoHistorico";
import ThemeToggle from "@/components/ThemeToggle";
import PropagacionLP from "@/components/PropagacionLP";
import EscalaHidrometro from "@/components/EscalaHidrometro";

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
  const { user, cargando: authCargando } = useAuth();
  const [datos, setDatos] = useState<DatosAgregados | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cuentaRegresiva, setCuentaRegresiva] = useState<string | null>(null);
  const [historial, setHistorial] = useState<Lectura[]>([]);
  const [alertasList, setAlertasList] = useState<{ timestamp: string; nivel: "verde" | "amarilla" | "roja" }[]>([]);
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

      setHistorial((historico as Lectura[]) ?? []);
      setAlertasList((alertasHist as { timestamp: string; nivel: "verde" | "amarilla" | "roja" }[]) ?? []);

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
  const escalones = datos?.escalones ?? [];
  const alertaNivel = alerta?.nivel ?? "verde";

  function escalonActual(nivel: number | undefined): string {
    if (nivel == null) return "--";
    const e = escalones.find((x) => nivel >= x.nivel_min_m && nivel < x.nivel_max_m);
    return e ? e.escalon.toString() : nivel < escalones[0]?.nivel_min_m ? "0" : "> " + escalones[escalones.length - 1]?.escalon;
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F2E9DC]">
        <p className="text-[#0E4749] text-lg">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F2E9DC] dark:bg-[#0f172a]">
      <header className="bg-[#0E4749] dark:bg-[#0a2a2b] text-white px-4 py-3 flex items-center gap-3 relative shadow-sm">
        <a href="/" className="flex items-center gap-3">
          <img src="/baliza-logo-horizontal.svg" alt="Baliza" className="h-7 sm:h-8 w-auto" />
        </a>
        <p className="text-[11px] text-[#F2E9DC]/70 dark:text-white/50 italic font-serif hidden sm:block border-l border-[#F2E9DC]/20 pl-3 leading-tight">
          la señal antes de la crecida
        </p>
        <div className="ml-auto flex items-center gap-2">
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

      <main className="max-w-3xl mx-auto px-3 sm:px-4">
        {/* Alerta / Recomendación */}
        <div className={`dashboard-section py-4 sm:py-5 ${alertaNivel === "roja" ? "bg-[#C0442B]/5 -mx-3 sm:-mx-4 px-3 sm:px-4" : alertaNivel === "amarilla" ? "bg-[#E8823A]/5 -mx-3 sm:-mx-4 px-3 sm:px-4" : ""}`}>
          <div className="flex items-start gap-3">
            <span className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${alertaNivel === "roja" ? "bg-[#C0442B]" : alertaNivel === "amarilla" ? "bg-[#E8823A]" : "bg-[#4C7A5E]"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase tracking-[0.15em] font-sans text-[#5B6E68] dark:text-gray-400 mb-1">
                Recomendación
              </p>
              <p className={`font-serif text-lg sm:text-xl leading-relaxed ${alertaNivel === "roja" ? "text-[#C0442B]" : alertaNivel === "amarilla" ? "text-[#C99A3D]" : "text-[#0E4749]"}`}>
                {alerta?.mensaje ?? "Sin datos — esperando primera ingesta"}
              </p>
              {cuentaRegresiva && alertaNivel === "roja" && (
                <div className="mt-3 inline-block bg-[#C0442B]/10 rounded-lg px-4 py-2 border border-[#C0442B]/20">
                  <p className="font-mono text-2xl font-bold text-[#C0442B]">{cuentaRegresiva}</p>
                  <p className="text-xs text-[#5B6E68] dark:text-gray-400 mt-0.5">
                    hasta punto de no retorno ({umbralNR?.valor_m.toFixed(1) ?? "--"}m)
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Escala hidrométrica + estado San Fernando */}
        <div className="dashboard-section py-4 sm:py-5">
          <EscalaHidrometro
            nivelActual={sfObs?.nivel_m ?? 0}
            tendencia={tendenciaIcono(historial.filter((h) => h.estacion_id === datos?.sanFernando.observado?.estacion_id).slice(0, 3))}
            timestamp={sfObs?.timestamp ?? ""}
            escalones={escalones}
            umbralEval={umbralEval ?? null}
            umbralNR={umbralNR ?? null}
            alertaNivel={alertaNivel}
          />
        </div>

        {/* Gráfico histórico */}
        <div className="dashboard-section py-4 sm:py-5">
          <GraficoHistorico
            observaciones={historial}
            pronosticos={sfProno ?? []}
            umbralEval={umbralEval?.valor_m ?? 2.0}
            umbralNR={umbralNR?.valor_m ?? 2.2}
            alertas={alertasList}
          />
        </div>

        {/* Viento + Propagación LP */}
        <div className="dashboard-section py-4 sm:py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <p className="text-[11px] uppercase tracking-[0.15em] font-sans text-[#5B6E68] dark:text-gray-400 mb-2">
                Viento
              </p>
              {viento ? (
                <>
                  <p className="font-mono text-2xl sm:text-3xl font-bold text-[#0E4749] dark:text-[#4fc3c5]">
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
            </div>
            <PropagacionLP lecturasLP={lecturasLP} nivelSF={sfObs?.nivel_m} />
          </div>
        </div>

        {/* Estaciones exteriores */}
        <div className="dashboard-section py-4 sm:py-5">
          <p className="text-[11px] uppercase tracking-[0.15em] font-sans text-[#5B6E68] dark:text-gray-400 mb-3">
            Estaciones exteriores — preaviso temprano
          </p>
          <div className="space-y-3">
            {[
              { nombre: "La Plata", obs: lpObs, delay: "~2-3hs antes que SF" },
              { nombre: "Puerto de Buenos Aires", obs: baObs, delay: "~1hs antes que SF" },
              { nombre: "Pilote Norden", obs: pnObs, delay: "" },
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
                  <p className="text-xs font-mono text-[#5B6E68]/60 dark:text-gray-500">
                    {est.obs ? formatearHora(est.obs.timestamp) : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Vista semanal Paraná */}
        <div className="dashboard-section py-4 sm:py-5">
          <VistaSemanal parana={datos?.parana ?? { rosario: null, sanNicolas: null, zarate: null, campana: null, escobar: null }} />
        </div>

        {/* Pronóstico San Fernando */}
        {(() => {
          const main = sfProno?.filter((p) => p.qualifier === "main") ?? [];
          const p05 = sfProno?.filter((p) => p.qualifier === "p05") ?? [];
          const p25 = sfProno?.filter((p) => p.qualifier === "p25") ?? [];
          const p75 = sfProno?.filter((p) => p.qualifier === "p75") ?? [];
          const p95 = sfProno?.filter((p) => p.qualifier === "p95") ?? [];
          const ahora = Date.now();

          const proximos = main.filter((p) => new Date(p.timestamp).getTime() > ahora).slice(0, 48);
          if (proximos.length === 0) return null;

          const maxP95 = Math.max(...p95.filter((p) => new Date(p.timestamp).getTime() > ahora).map((p) => p.valor_m), 0);
          const maxMain = Math.max(...proximos.map((p) => p.valor_m));
          const maxVal = Math.max(maxP95, umbralNR?.valor_m ?? 2.2) + 0.3;

          return (
            <div className="dashboard-section py-4 sm:py-5">
              <p className="text-[11px] uppercase tracking-[0.15em] font-sans text-[#5B6E68] dark:text-gray-400 mb-2">
                Pronóstico San Fernando — INA (modelo regresión)
              </p>
              <p className="text-xs text-[#5B6E68]/70 dark:text-gray-500 mb-3">
                Máximo estimado: <strong className="font-mono">{maxMain.toFixed(2)}m</strong>
                {maxP95 > maxMain && (
                  <span> (p95: <strong className="font-mono text-[#C99A3D]">{maxP95.toFixed(2)}m</strong>)</span>
                )}
              </p>
              <div className="relative h-36 sm:h-48">
                <svg viewBox="0 0 480 160" className="w-full h-full overflow-visible">
                  {umbralEval && (
                    <line x1="0" y1={160 - (umbralEval.valor_m / maxVal) * 140 - 10} x2="480" y2={160 - (umbralEval.valor_m / maxVal) * 140 - 10} stroke="#C99A3D" strokeWidth="1" strokeDasharray="4,3" />
                  )}
                  {umbralNR && (
                    <line x1="0" y1={160 - (umbralNR.valor_m / maxVal) * 140 - 10} x2="480" y2={160 - (umbralNR.valor_m / maxVal) * 140 - 10} stroke="#C0442B" strokeWidth="1" strokeDasharray="4,3" />
                  )}

                  <polygon
                    fill="#0E4749"
                    fillOpacity="0.08"
                    points={proximos.map((p, i) => {
                      const x = (i / Math.max(proximos.length - 1, 1)) * 460 + 10;
                      const p05v = p05.find((q) => q.timestamp === p.timestamp)?.valor_m ?? p.valor_m;
                      const p95v = p95.find((q) => q.timestamp === p.timestamp)?.valor_m ?? p.valor_m;
                      const y1 = 150 - (p95v / maxVal) * 140;
                      const y2 = 150 - (p05v / maxVal) * 140;
                      return `${x},${y1} `;
                    }).join("") + [...proximos].reverse().map((p) => {
                      const x = (proximos.indexOf(p) / Math.max(proximos.length - 1, 1)) * 460 + 10;
                      const p05v = p05.find((q) => q.timestamp === p.timestamp)?.valor_m ?? p.valor_m;
                      const p95v = p95.find((q) => q.timestamp === p.timestamp)?.valor_m ?? p.valor_m;
                      const y2 = 150 - (p05v / maxVal) * 140;
                      return `${x},${y2} `;
                    }).join("")}
                  />

                  <polyline
                    fill="none"
                    stroke="#0E4749"
                    strokeWidth="2"
                    points={proximos.map((p, i) => {
                      const x = (i / Math.max(proximos.length - 1, 1)) * 460 + 10;
                      const y = 150 - (p.valor_m / maxVal) * 140;
                      return `${x},${y}`;
                    }).join(" ")}
                  />

                  {[0, 0.5, 1, 1.5, 2, 2.5].filter((v) => v <= maxVal).map((v) => (
                    <text key={v} x="3" y={150 - (v / maxVal) * 140 + 4} fontSize="8" fill="#9ca3af" fontFamily="ui-monospace, monospace" textAnchor="start">
                      {v.toFixed(1)}
                    </text>
                  ))}

                  {umbralEval && (
                    <text x="482" y={160 - (umbralEval.valor_m / maxVal) * 140 - 10 + 4} fontSize="7" fill="#C99A3D" fontFamily="ui-monospace, monospace">
                      eval {umbralEval.valor_m.toFixed(1)}
                    </text>
                  )}
                  {umbralNR && (
                    <text x="482" y={160 - (umbralNR.valor_m / maxVal) * 140 - 10 + 4} fontSize="7" fill="#C0442B" fontFamily="ui-monospace, monospace">
                      NR {umbralNR.valor_m.toFixed(1)}
                    </text>
                  )}
                </svg>
              </div>
            </div>
          );
        })()}

        {/* Bitácora */}
        <div className="dashboard-section py-4 sm:py-5">
          <Bitacora
            nivelActual={sfObs?.nivel_m ?? 0}
            onRegistro={() => {}}
            loggedIn={!!user}
            historial={historial}
            alertas={alertasList}
            umbralEval={umbralEval?.valor_m}
            umbralNR={umbralNR?.valor_m}
          />
        </div>

        {/* Admin Panel */}
        {user && (
          <div className="dashboard-section py-4 sm:py-5">
            <AdminPanel
              umbralEval={umbralEval ?? null}
              umbralNR={umbralNR ?? null}
              trasladoMin={trasladoMin}
              config={datos?.config}
              onSaved={() => {}}
            />
          </div>
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
