CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule('ingest-ina', '*/20 * * * *', $$
  select net.http_post(
    url:='https://tcgzpcfhwytrrhfxtkmt.supabase.co/functions/v1/ingest-ina',
    headers:=jsonb_build_object('Content-Type', 'application/json'),
    body:='{}'::jsonb
  ) as request_id;
$$);

SELECT cron.schedule('ingest-pronostico', '*/20 * * * *', $$
  select net.http_post(
    url:='https://tcgzpcfhwytrrhfxtkmt.supabase.co/functions/v1/ingest-pronostico',
    headers:=jsonb_build_object('Content-Type', 'application/json'),
    body:='{}'::jsonb
  ) as request_id;
$$);

SELECT cron.schedule('ingest-viento', '*/20 * * * *', $$
  select net.http_post(
    url:='https://tcgzpcfhwytrrhfxtkmt.supabase.co/functions/v1/ingest-viento',
    headers:=jsonb_build_object('Content-Type', 'application/json'),
    body:='{}'::jsonb
  ) as request_id;
$$);

SELECT cron.schedule('ingest-shn', '*/20 * * * *', $$
  select net.http_post(
    url:='https://tcgzpcfhwytrrhfxtkmt.supabase.co/functions/v1/ingest-shn',
    headers:=jsonb_build_object('Content-Type', 'application/json'),
    body:='{}'::jsonb
  ) as request_id;
$$);

SELECT cron.schedule('evaluar-alerta', '*/5 * * * *', $$
  select net.http_post(
    url:='https://tcgzpcfhwytrrhfxtkmt.supabase.co/functions/v1/evaluar-alerta',
    headers:=jsonb_build_object('Content-Type', 'application/json'),
    body:='{}'::jsonb
  ) as request_id;
$$);
