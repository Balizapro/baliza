import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import type { DatosAgregados, Lectura, Pronostico, EquivalenciaEscalon, AvisoShn, AvisoCrecida, NivelAlerta, Bitacora as BitacoraType } from "@/lib/types";
import { calcularTendencia } from "@/lib/dashboardHelpers";

// Fetching de todos los datos del dashboard (estaciones, lecturas, pronósticos,
// viento, umbrales, config, alertas, bitácora) desde Supabase, con refresco
// automático cada 60s. Extraído tal cual de dashboard/page.tsx — mismo
// comportamiento, solo reubicado a un hook para no tener un useEffect de
// 200 líneas mezclado con el JSX.
export function useDatosBaliza() {
  const [datos, setDatos] = useState<DatosAgregados | null>(null);
  const [cargando, setCargando] = useState(true);
  const [historial, setHistorial] = useState<Lectura[]>([]);
  const [alertasList, setAlertasList] = useState<{ timestamp: string; nivel: NivelAlerta }[]>([]);
  const [lecturasLP, setLecturasLP] = useState<Lectura[]>([]);
  const [lecturasLPHist, setLecturasLPHist] = useState<Lectura[]>([]);
  const [exterioresLecturas, setExterioresLecturas] = useState<{ nombre: string; lecturas: Lectura[] }[]>([]);
  const [vientoHist, setVientoHist] = useState<{ timestamp: string; velocidad_kmh: number; direccion_grados: number; presion_hpa?: number | null }[]>([]);
  const [vientoProno, setVientoProno] = useState<{ timestamp: string; velocidad_kmh: number; direccion_grados: number; presion_hpa?: number | null }[]>([]);
  const [diasSinClases, setDiasSinClases] = useState<string[]>([]);
  const [bitacora, setBitacora] = useState<BitacoraType[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();

      const { data: estaciones } = await supabase.from("estaciones").select("*");
      if (!estaciones) return;

      const sfId = estaciones.find((e) => e.nombre.includes("San Fernando"))?.id;
      const lpId = estaciones.find((e) => e.nombre.includes("La Plata") && e.fuente === "INA")?.id;
      const oyId = estaciones.find((e) => e.nombre.includes("Oyarvide"))?.id;
      const atId = estaciones.find((e) => e.nombre.includes("Atalaya"))?.id;
      const baId = estaciones.find((e) => e.nombre.includes("Buenos Aires"))?.id;
      const pnId = estaciones.find((e) => e.nombre.includes("Pilote Norden"))?.id;
      const rosId = estaciones.find((e) => e.nombre === "Rosario")?.id;
      const snId = estaciones.find((e) => e.nombre === "San Nicolás")?.id;
      const zarId = estaciones.find((e) => e.nombre === "Zárate")?.id;
      const campId = estaciones.find((e) => e.nombre === "Campana")?.id;
      const escId = estaciones.find((e) => e.nombre === "Escobar")?.id;

      const ids = [sfId, lpId, oyId, atId, baId, pnId, rosId, snId, zarId, campId, escId].filter(Boolean);
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

      const { data: diasRaw } = await supabase.from("dias_sin_clases").select("fecha");
      setDiasSinClases((diasRaw ?? []).map((d: { fecha: string }) => d.fecha));

      // Bitácora reciente: se vincula al veredicto del día (cruces/eventos previos).
      const { data: bitacoraRaw } = await supabase
        .from("bitacora")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(60);
      setBitacora((bitacoraRaw as BitacoraType[]) ?? []);

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

      // Para el plan escolar: el último aviso/alerta por crecida (o su cese), aunque después haya
      // salido un aviso de otro tipo (viento, bajante...) que ocupe el lugar del "último".
      const { data: avisoCrecidaPlan } = await supabase
        .from("avisos_crecida")
        .select("*")
        .eq("vigente", true)
        .ilike("tipo", "%crecida%")
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

      // Lecturas de las estaciones exteriores para la anticipación de la bajada.
      setExterioresLecturas(
        [
          { nombre: "La Plata", id: lpId },
          { nombre: "Oyarvide", id: oyId },
          { nombre: "Atalaya", id: atId },
          { nombre: "Puerto de Buenos Aires", id: baId },
        ]
          .filter((e) => e.id)
          .map((e) => ({ nombre: e.nombre, lecturas: filtrarPorEstacion(e.id) }))
      );

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
        avisoCrecidaPlan: (avisoCrecidaPlan as AvisoCrecida | null) ?? null,
      };

      setDatos(d);
      setLastUpdated(new Date());
      setCargando(false);
    }

    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  return {
    datos,
    cargando,
    historial,
    alertasList,
    lecturasLP,
    lecturasLPHist,
    exterioresLecturas,
    vientoHist,
    vientoProno,
    diasSinClases,
    bitacora,
    lastUpdated,
  };
}
