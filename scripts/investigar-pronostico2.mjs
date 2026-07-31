const BASE = "https://alerta.ina.gob.ar/a5";

async function json(path) {
  const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(10000) });
  const text = await r.text();
  if (!text.startsWith("[") && !text.startsWith("{")) return null;
  return JSON.parse(text);
}

// Probar diferentes formas de obtener valores de pronóstico
const tests = [];

// 1. Observaciones con series_id de pronóstico + qualifier
for (const q of ["main", "p05", "p25", "p75", "p95"]) {
  tests.push(
    json(`/getObservaciones?tipo=H&series_id=26202&qualifier=${q}&timestart=2026-07-27&timeend=2026-08-03`)
      .then(d => ({ test: `getObservaciones qualifier=${q}`, data: d }))
  );
}

// 2. Observaciones con series_id de pronóstico SIN qualifier
tests.push(
  json(`/getObservaciones?tipo=H&series_id=26202&timestart=2026-07-27&timeend=2026-08-03`)
    .then(d => ({ test: "getObservaciones series_id=26202 sin qualifier", data: d }))
);

// 3. Probar otros formatos de fecha
tests.push(
  json(`/getObservaciones?tipo=H&series_id=26202&timestart=2026-07-27T00:00:00&timeend=2026-08-03T00:00:00`)
    .then(d => ({ test: "getObservaciones con ISO", data: d }))
);

// 4. Buscar por estación y tipo pronóstico
tests.push(
  json(`/getObservaciones?tipo=H&series_id=52&timestart=2026-07-29&timeend=2026-08-03`)
    .then(d => ({ test: "getObservaciones SF series_id=52 (futuro)", data: d }))
);

// 5. Intentar con endpoint alternativo
tests.push(
  json(`/getPronosticosDetalle?cal_id=432`)
    .then(d => ({ test: "getPronosticosDetalle", data: d }))
);

// 6. Probar con pronóstico de otra estación (San Nicolás tiene pronóstico)
// San Nicolás ID 36, cal_id=442
tests.push(
  json(`/getPronosticos?cal_id=442`)
    .then(d => ({ test: "getPronosticos cal_id=442 (San Nicolás)", data: d }))
);

// 7. Ver la estructura de los pronósticos de San Nicolás
tests.push(
  json(`/getSeries?id=36`)
    .then(d => ({ test: "getSeries San Nicolás", data: d?.rows?.[0]?.pronosticos }))
);

const results = await Promise.all(tests);
for (const r of results) {
  if (r.data && Array.isArray(r.data)) {
    console.log(`${r.test}: ${r.data.length} items`);
    if (r.data.length > 0) {
      console.log(`  Primeros 2: ${r.data.slice(0, 2).map(d => `${d.timestart?.slice(11,16) || d.timestamp?.slice(11,16)} ${d.valor || d.nivel_m || d.altura}m`).join(", ")}`);
    }
  } else if (r.data) {
    console.log(`${r.test}: ${JSON.stringify(r.data).slice(0, 200)}`);
  } else {
    console.log(`${r.test}: sin datos`);
  }
}
