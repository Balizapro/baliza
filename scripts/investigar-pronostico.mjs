const BASE = "https://alerta.ina.gob.ar/a5";

async function json(path) {
  const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(10000) });
  const text = await r.text();
  if (!text.startsWith("[") && !text.startsWith("{")) {
    console.log(`[${r.status}] NOT JSON: ${path} → ${text.slice(0, 100)}`);
    return null;
  }
  return JSON.parse(text);
}

// 1. Ver los pronósticos disponibles para San Fernando
const series = await json("/getSeries?id=52");
const sf = series?.rows?.[0];
console.log("=== San Fernando Series ===");
console.log("Alertas:", sf?.estacion?.nivel_alerta, "Eva:", sf?.estacion?.nivel_evacuacion);
console.log("Date range:", JSON.stringify(sf?.date_range));

if (sf?.pronosticos) {
  console.log("\nPronósticos disponibles:");
  for (const p of sf.pronosticos) {
    console.log(JSON.stringify(p, null, 2));
  }

  // Para cada pronóstico, intentar obtener datos
  for (const p of sf.pronosticos) {
    console.log(`\n=== Probando pronóstico: cal_id=${p.cal_id}, series_id=${p.series_id} ===`);

    // Endpoint 1: getPronosticos con cal_id
    const pronos = await json(`/getPronosticos?cal_id=${p.cal_id}`);
    if (pronos) {
      for (const item of pronos) {
        console.log("Forecast date:", item.forecast_date);
        for (const s of item.series || []) {
          console.log("  Series ID:", s.series_id, "Table:", s.series_table);
          console.log("  Qualifiers:", s.qualifiers?.join(", "));
          console.log("  Count:", s.count, "pronósticos:", s.pronosticos?.length);
          if (s.pronosticos?.length > 0) {
            console.log("  Primer pronóstico:", JSON.stringify(s.pronosticos[0]));
          }

          // Probar getObservaciones para la serie de pronóstico con cada qualifier
          if (s.qualifiers) {
            for (const q of s.qualifiers) {
              const url = `/getObservaciones?tipo=H&series_id=${s.series_id}&qualifier=${q}&timestart=2026-07-27&timeend=2026-08-03`;
              const data = await json(url);
              if (data && data.length > 0) {
                console.log(`  → getObservaciones qualifier=${q}: ${data.length} items`);
                console.log(`     Primeros 3: ${data.slice(0, 3).map(d => `${d.timestart.slice(11, 16)} ${d.valor}m`).join(", ")}`);
              }
            }
          }
        }
      }
    }
  }
}

// También probar el endpoint con cal_grupo_id
console.log("\n=== cal_grupo_id=1 ===");
const grupo = await json("/getPronosticos?cal_grupo_id=1");
if (grupo) {
  for (const item of grupo) {
    console.log("Forecast date:", item.forecast_date, "cal_id:", item.cal_id);
    for (const s of item.series || []) {
      console.log("  estacion_id:", s.estacion_id, "count:", s.count, "qualifiers:", s.qualifiers?.join(","));
      if (s.pronosticos?.length > 0) {
        console.log("  Primer pronóstico interno:", JSON.stringify(s.pronosticos[0]));
      }
    }
  }
}

// Buscar todos los pronósticos disponibles en el sistema
console.log("\n=== Buscando todas las series con pronóstico ===");
const allSeries = await json("/getSeries?limit=5000");
if (allSeries?.rows) {
  const withProno = allSeries.rows.filter(r => r.pronosticos?.length > 0);
  console.log(`Series con pronóstico: ${withProno.length} de ${allSeries.rows.length}`);
  for (const r of withProno.slice(0, 10)) {
    console.log(`  ID ${r.id}: ${r.estacion?.nombre} (${r.rio || "N/A"}) — ${r.pronosticos.length} pronósticos`);
  }
}
