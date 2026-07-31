-- Cron para ingestión de alturas horarias del SHN (mareógrafos)
SELECT cron.schedule('ingest-alturas-horarias', '*/15 * * * *', $$
  select net.http_post(
    url:='https://tcgzpcfhwytrrhfxtkmt.supabase.co/functions/v1/ingest-alturas-horarias',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase_functions.service_role_key')
    ),
    body:='{}'::jsonb
  ) as request_id;
$$);
