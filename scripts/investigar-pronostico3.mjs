const BASE = "https://alerta.ina.gob.ar/a5";

async function main() {
  // Probar queries con fechas futuras
  const tests = [
    { series: 52, start: "2026-07-31", end: "2026-08-03", label: "SF 52 futuro" },
    { series: 26202, start: "2026-07-31", end: "2026-08-03", label: "SF 26202 futuro" },
    { series: 52, start: "2026-07-27", end: "2026-07-30", label: "SF 52 pasado" },
  ];

  for (const t of tests) {
    const url = `${BASE}/getObservaciones?tipo=H&series_id=${t.series}&timestart=${t.start}&timeend=${t.end}`;
    const r = await fetch(url);
    const text = await r.text();
    if (text.startsWith("[")) {
      const data = JSON.parse(text);
      console.log(`${t.label}: ${data.length} items`);
      if (data.length > 0) {
        console.log(`  Desde: ${data[0].timestart} Hasta: ${data[data.length-1].timestart}`);
        console.log(`  Muestra: ${data[0].timestart.slice(11,16)} ${data[0].valor}m`);
      }
    } else {
      console.log(`${t.label}: [${r.status}] ${text.slice(0, 100)}`);
    }
  }

  // Leer el chart.js para entender cómo carga los pronósticos
  console.log("\n=== Buscando rutas de pronóstico en chart.js ===");
  const chartJS = await fetch("https://alerta.ina.gob.ar/a5/js/chart.js").then(r => r.text());

  // Buscar URLs de API
  const urls = [...new Set(chartJS.match(/["']\/a5\/[^"']+["']/g) || [])];
  for (const u of urls) {
    if (u.toLowerCase().includes("pron") || u.toLowerCase().includes("observ")) {
      console.log("  " + u);
    }
  }

  // Buscar funciones relacionadas con pronóstico
  const funcs = chartJS.match(/function\s+\w*(?:Pron|pron|Forecast|forecast|Pronostico|pronostico)\w*\s*\(/g) || [];
  console.log("\nFunciones de pronóstico en chart.js:");
  funcs.forEach(f => console.log("  " + f));

  // Buscar referencias a la serie de pronóstico 26202
  const refs26202 = chartJS.match(/[^.]*26202[^;]*/g) || [];
  if (refs26202.length) {
    console.log("\nReferencias a series_id 26202:");
    refs26202.slice(0, 5).forEach(r => console.log("  " + r.trim().slice(0, 150)));
  }

  // Buscar cómo se cargan los datos de pronóstico en el UI
  const cargaLineas = chartJS.split("\n").filter(l =>
    l.includes("pronostico") || l.includes("forecast") || l.includes("Pronostico")
  );
  console.log("\nLíneas con 'pronóstico/forecast' en chart.js:");
  cargaLineas.slice(0, 20).forEach(l => console.log("  " + l.trim().slice(0, 200)));
}

main().catch(console.error);
