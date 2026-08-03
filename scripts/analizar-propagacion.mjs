// Calcula la propagación real del quiebre (inicio de subida/bajada) entre las
// estaciones aguas arriba (Oyarvide/Atalaya/La Plata) y San Fernando.
// Uso: node scripts/analizar-propagacion.mjs [--desde 2026-08-03]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function envFromFile(path) {
  const env = {};
  for (const linea of readFileSync(path, "utf8").split("\n")) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = { ...process.env, ...envFromFile(".env.local") };

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const ESTACIONES = [
  "Oyarvide",
  "Atalaya",
  "La Plata",
  "Pilote Norden",
  "Puerto de Buenos Aires",
  "San Fernando (Brazo Luján)",
];

const desde = process.argv.find((a) => a.startsWith("--desde"))?.split("=")[1] || "2026-08-03";

const { data: estaciones, error: errEst } = await supabase
  .from("estaciones")
  .select("id, nombre");
if (errEst) throw errEst;
const nombreToId = Object.fromEntries(estaciones.map((e) => [e.nombre, e.id]));

async function lecturas(nombre) {
  const estacionId = nombreToId[nombre];
  if (!estacionId) throw new Error(`Estación no encontrada: ${nombre}`);
  const { data, error } = await supabase
    .from("lecturas")
    .select("timestamp, nivel_m")
    .eq("estacion_id", estacionId)
    .gte("timestamp", desde)
    .eq("tipo", "observado")
    .order("timestamp", { ascending: true });
  if (error) throw error;
  return data.map((d) => ({ ts: new Date(d.timestamp).getTime(), nivel: d.nivel_m }));
}

// Detección de quiebres: cambio de signo de la derivada en una ventana suavizada.
function quiebres(pts, umbral = 0.03) {
  if (pts.length < 3) return { subidas: [], bajadas: [] };
  const suav = [];
  for (let i = 0; i < pts.length; i++) {
    const ini = Math.max(0, i - 1);
    const fin = Math.min(pts.length - 1, i + 1);
    let s = 0;
    for (let j = ini; j <= fin; j++) s += pts[j].nivel;
    suav.push({ ts: pts[i].ts, nivel: s / (fin - ini + 1) });
  }
  const subidas = [];
  const bajadas = [];
  let signo = 0;
  for (let i = 1; i < suav.length; i++) {
    const d = suav[i].nivel - suav[i - 1].nivel;
    const s = d > umbral ? 1 : d < -umbral ? -1 : 0;
    if (s !== 0 && s !== signo) {
      if (signo === -1 && s === 1) subidas.push(suav[i].ts); // de bajar a subir (pleamar)
      if (signo === 1 && s === -1) bajadas.push(suav[i].ts); // de subir a bajar (bajamar)
      signo = s;
    }
  }
  return { subidas, bajadas };
}

const datos = {};
for (const nombre of ESTACIONES) {
  const pts = await lecturas(nombre);
  datos[nombre] = { pts, q: quiebres(pts) };
  console.log(
    `${nombre.padEnd(30)} lecturas=${String(pts.length).padStart(3)}  pleamares=${datos[nombre].q.subidas.length}  bajamares=${datos[nombre].q.bajadas.length}`
  );
}

function printTable(qRef, qExt, nombreExt, tipo) {
  console.log(`\n=== Propagación ${nombreExt} → San Fernando (${tipo}) ===`);
  if (!qRef.length) {
    console.log("  Sin quiebres en SF en el período.");
    return;
  }
  let deltas = [];
  for (const tRef of qRef) {
    const prev = qExt.filter((t) => t <= tRef).sort((a, b) => b - a)[0];
    if (prev == null) continue;
    deltas.push((tRef - prev) / 3600000);
  }
  if (!deltas.length) {
    console.log("  No hay quiebre externo previo para comparar.");
    return;
  }
  deltas.sort((a, b) => a - b);
  const prom = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const med = deltas[Math.floor(deltas.length / 2)];
  console.log(`  N=${deltas.length}  promedio=${prom.toFixed(1)}h  mediana=${med.toFixed(1)}h  min=${deltas[0].toFixed(1)}h  max=${deltas[deltas.length - 1].toFixed(1)}h`);
  console.log(`  Valores: ${deltas.map((d) => d.toFixed(1)).join(", ")}h`);
}

const sf = datos["San Fernando (Brazo Luján)"].q;
for (const nombreExt of ["Oyarvide", "Atalaya", "La Plata"]) {
  const ext = datos[nombreExt].q;
  printTable(sf.subidas, ext.subidas, nombreExt, "inicio de subida");
  printTable(sf.bajadas, ext.bajadas, nombreExt, "inicio de bajada");
}
