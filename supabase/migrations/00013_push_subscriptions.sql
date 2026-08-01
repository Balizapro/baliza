-- Suscripciones Web Push para notificaciones de cambio de alerta
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- Cualquier usuario autenticado puede ver sus propias suscripciones
create policy "users_read_own_push" on public.push_subscriptions
  for select using (auth.uid() = user_id);

-- Insertar: el usuario debe ser el dueño
create policy "users_insert_own_push" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

-- Borrar: el usuario puede quitar sus propias suscripciones
create policy "users_delete_own_push" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- La función de notificación usa la service role key (bypass RLS)
create policy "service_read_push" on public.push_subscriptions
  for select to service_role using (true);

-- Trigger para mantener updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_push_subscriptions_updated_at on public.push_subscriptions;
create trigger trg_push_subscriptions_updated_at
  before update on public.push_subscriptions
  for each row execute function public.touch_updated_at();
