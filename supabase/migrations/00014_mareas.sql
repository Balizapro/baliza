-- Serie horaria de marea astronómica del frente del Delta (fuente: INA/SHN).
-- Se suma a la tabla mareas existente (que ya guarda la corrección SHN por sudestada).
-- tipo='astro' = marea astronómica horaria (referencia: escala San Fernando).
alter table public.mareas
  add column if not exists tipo text not null default 'correccion',
  add column if not exists punto text not null default 'San Fernando',
  add column if not exists timestamp_marea timestamptz,
  add column if not exists nivel_m double precision;

-- Índice para consultar la serie astronómica por punto
create index if not exists idx_mareas_astro
  on public.mareas (punto, timestamp_marea);

-- Los valores astronómicos no deben duplicarse (un punto + timestamp + tipo)
create unique index if not exists idx_mareas_astro_uniq
  on public.mareas (punto, timestamp_marea, tipo) where tipo = 'astro';
