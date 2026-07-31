-- Baliza: Avisos náuticos del SHN (Servicio de Hidrografía Naval)
-- Fuente: https://www.hidro.gov.ar/nautica/RadioavisosNauticos.asp?op=10
-- Cada aviso (pronóstico mareológico, olas, dragado, balizamiento) es un <pre class="texto_radioaviso">.

CREATE TABLE avisos_shn (
  numero TEXT NOT NULL,
  tipo TEXT NOT NULL,
  titulo TEXT,
  texto TEXT NOT NULL,
  tendencia TEXT,
  publicado DATE,
  actualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (numero, tipo)
);

CREATE INDEX idx_avisos_shn_publicado ON avisos_shn(publicado DESC);

ALTER TABLE avisos_shn ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_avisos_shn" ON avisos_shn FOR SELECT USING (true);

-- Cron de ingesta de avisos SHN
SELECT cron.schedule('ingest-avisos-shn', '*/30 * * * *', $$
  select net.http_post(
    url:='https://tcgzpcfhwytrrhfxtkmt.supabase.co/functions/v1/ingest-avisos-shn',
    headers:=jsonb_build_object('Content-Type', 'application/json'),
    body:='{}'::jsonb
  ) as request_id;
$$);
