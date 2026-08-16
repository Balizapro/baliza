-- Días sin clases (feriados, asuetos, jornadas especiales) editables por el equipo:
-- el veredicto escolar y el aviso "no embarcar" los respetan.
create table if not exists public.dias_sin_clases (
  fecha date primary key,
  motivo text not null default '',
  creado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.dias_sin_clases enable row level security;

-- Cualquier usuario (anon o autenticado) puede leer los días sin clases
-- (necesario para el veredicto del día en el dashboard, que es público).
create policy "dias_sin_clases_read_public" on public.dias_sin_clases
  for select using (true);

-- Solo los administradores pueden agregar/quitar días. El rol se valida en la API.
create policy "dias_sin_clases_insert_auth" on public.dias_sin_clases
  for insert to authenticated with check (true);

create policy "dias_sin_clases_delete_auth" on public.dias_sin_clases
  for delete to authenticated using (true);

-- La función evaluar-alerta lee estos días para emitir el veredicto (service role, bypass RLS)
create policy "dias_sin_clases_service" on public.dias_sin_clases
  for select to service_role using (true);

-- Feriados nacionales 2026 en el calendario escolar argentino (a mantener al día).
insert into public.dias_sin_clases (fecha, motivo) values
  ('2026-08-17', 'Paso a la Inmortalidad del Gral. San Martín')
on conflict (fecha) do nothing;