# Contexto — Baliza

## Qué es
App de anticipación a crecidas para escuela de islas en el Delta de Tigre (río Luján / arroyo Vieja).

## Stack
Next.js 16.2.12 + TypeScript + Tailwind CSS v4 + Supabase + Vercel

## Marca
Nombre: **Baliza**. Paleta: `#0E4749` (verde-azulado) / `#E8823A` (naranja alerta) / `#4C7A5E` (verde ok) / `#F2E9DC` (beige fondo).

## Fuentes de datos
- **INA API a5** (San Fernando + La Plata + Puerto Buenos Aires + Pilote Norden + Paraná aguas arriba)
- **SHN** pronóstico mareológico (scraping HTML, sin API)
- **Open-Meteo** (viento, sin key)

## Arquitectura
```
Next.js (dashboard) → Supabase (Postgres + Edge Functions) → Vercel (hosting + cron)

Edge Functions:
- ingest-ina      → cada 3-6hs: San Fernando + estaciones exteriores
- ingest-shn      → scrapea boletín mareológico
- ingest-viento   → Open-Meteo
- evaluar-alerta  → se dispara después de cada ingesta
```

## Umbrales (editables en DB, tablas `umbrales` y `configuracion`)
| Umbral | Valor | Descripción |
|---|---|---|
| Evaluación | 2.00m | Nivel de atención: empezar a evaluar |
| No retorno | 2.20m | Punto de no retorno: salir ahora |
| Traslado | 10 min | Tiempo escuela → muelle en tierra |

## Modelo de decisión
- **Tres estados**: verde (normal), amarilla (monitorear), roja (salir ahora)
- **Cuenta regresiva** descontando los 10 min de traslado
- **Preaviso por propagación**: La Plata (~2.5hs antes) → Buenos Aires (~1hs antes) → San Fernando
- Reporte manual con escalones del muelle (Fase 2)
- Bitácora de eventos (Fase 2)

## Supabase
- URL: `https://tcgzpcfhwytrrhfxtkmt.supabase.co`
- Migraciones en `supabase/migrations/00001_schema.sql`, `00002_pronosticos.sql`, `00003_rls_auth.sql`
- RLS: SELECT anónimo en todas las tablas + INSERT/UPDATE para authenticated en bitacora/umbrales/config/suscriptores/equivalencia
- Auth: email/password con sesión vía `@supabase/ssr`
- Proxy (replaces middleware) refresca sesión automáticamente

## Decisiones técnicas
- Edge Functions en Deno con imports desde deno.land y esm.sh
- Cliente Supabase con `@supabase/ssr` para server y browser
- Dashboard client-side con polling cada 60s
- Auth con Supabase Auth (email/password), contexto React en AuthProvider
- API routes protegidas verifican sesión antes de escribir con service_role key
- SHN scraping mediante regex sobre HTML (formato semi-estructurado)
- Middleware reemplazado por `proxy.ts` (Next.js 16)
- Supabase Edge Functions usan SUPABASE_SERVICE_ROLE_KEY inyectado automáticamente

## Cron jobs (GitHub Actions)
- `.github/workflows/ingesta.yml`: cada 3hs
- Llama a los endpoints Vercel `/api/cron/ingest-*`

## Pronóstico INA — endpoint descubierto
Endpoint real: `GET /a5/sim/calibrados?estacion_id=52&var_id=2&includeCorr=true&timestart=...&timeend=...`
- Devuelve modelo de regresión `regre_sfer` (marea_rdp_regre) para San Fernando
- 5 qualifiers: main, p05, p25, p75, p95 — cada uno con ~97-169 pronósticos horarios
- Datos en formato `{timestart, valor}` dentro de `corrida.series[i].pronosticos`
- Edge Function `ingest-pronostico` alimenta tabla `pronosticos` (reemplaza cada corrida)

## Admin (Fase 2)
- Login: `/auth/login` con email `escuela@baliza.app` / pass `Baliza2026!`
- Bitácora: escribe mediante API route protegida `/api/bitacora` (verifica sesión + service_role key)
- AuthContext: expone `user` y `cargando` para UI condicional
- RLS: authenticated users pueden INSERT en bitacora, UPDATE en umbrales/config/suscriptores/equivalencia

## Estado actual
✅ Proyecto Next.js scaffoldeado  
✅ Esquema de BD creado + migraciones 00001 + 00002 + 00003 ejecutadas  
✅ Edge Functions: ingest-ina, ingest-shn, ingest-viento, evaluar-alerta, ingest-pronostico (deployadas)  
✅ Dashboard UI con alerta principal, niveles, viento, estaciones exteriores  
✅ Pronóstico INA con qualifiers (main + p05/p25/p75/p95) en gráfico SVG integrado  
✅ Datos reales de INA cargados  
✅ Viento funcionando (Open-Meteo)  
✅ Login con Supabase Auth (email/password) + proxy + AuthProvider  
✅ API protegida para writes de bitácora  
✅ RLS para authenticated users  
✅ Admin user creado: escuela@baliza.app  
✅ Deployado en https://baliza-ashy.vercel.app  
✅ Umbrales: eval=2.0m, NR=2.2m, traslado=10min — editables en DB  
✅ GitHub: https://github.com/Balizapro/baliza
