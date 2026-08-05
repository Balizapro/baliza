-- Presión atmosférica a nivel de superficie (hPa) como segundo forzante meteorológico
-- junto con el viento SE (sudestada). Se suma al modelo armónico de marea.

alter table public.viento
  add column if not exists presion_hpa double precision;

alter table public.viento_pronostico
  add column if not exists presion_hpa numeric;

-- Índice para lecturas por rango de tiempo (ya usado por el modelo)
create index if not exists viento_presion_timestamp_idx on public.viento (timestamp asc);
create index if not exists viento_pronostico_presion_timestamp_idx on public.viento_pronostico (timestamp asc);
