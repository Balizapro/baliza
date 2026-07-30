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

## Modelo de decisión
- **Dos umbrales**: evaluación (1.80m) y no retorno (2.15m) — valores de referencia, a confirmar
- **Tres estados**: verde (normal), amarilla (monitorear), roja (salir ahora)
- **Preaviso por propagación**: La Plata (~2.5hs antes) → Buenos Aires (~1hs antes) → San Fernando
- **Cuenta regresiva** al punto de no retorno cuando aplica
- Reporte manual con escalones del muelle (Fase 2)
- Bitácora de eventos (Fase 2)

## Supabase
- URL: `https://tcgzpcfhwytrrhfxtkmt.supabase.co`
- Migraciones en `supabase/migrations/00001_schema.sql`
- RLS: SELECT anónimo habilitado en todas las tablas (MVP sin login)

## Decisiones técnicas
- Edge Functions en Deno con imports desde deno.land y esm.sh
- Cliente Supabase con `@supabase/ssr` para server y browser
- Dashboard client-side con polling cada 60s
- Sin login ni auth en Fase 1
- SHN scraping mediante regex sobre HTML (formato semi-estructurado)

## Cron jobs (Vercel)
- `ingest-ina`: cada 3hs (`0 */3 * * *`)
- `ingest-viento`: cada 1h (`0 * * * *`)
- `ingest-shn`: cada 6hs (`0 */6 * * *`)
- Configurado via `vercel.json` + Route Handlers en `src/app/api/cron/`

## Pendientes
- Confirmar umbral de evaluación y punto de no retorno exactos (~2.15-2.20m San Fernando de referencia)
- Confirmar tiempo de traslado escuela → muelle en tierra

## Estado actual
✅ Proyecto Next.js scaffoldeado  
✅ Esquema de BD creado + migración ejecutada  
✅ Edge Functions: ingest-ina, ingest-shn, ingest-viento, evaluar-alerta (deployadas)  
✅ Dashboard UI con alerta principal, niveles, viento, estaciones exteriores  
✅ Datos reales de INA cargados (151 lecturas)  
✅ Viento funcionando (Open-Meteo)  
✅ Cron jobs configurados para Vercel  
⏳ Pendiente: deploy a Vercel
