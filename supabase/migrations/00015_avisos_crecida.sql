-- Baliza: Avisos/Alertas/Ceses de crecida del SHN para el Río de la Plata
-- Fuente: https://www.hidro.gov.ar/oceanografia/AACRIOPLA.asp
-- Este es el aviso OFICIAL de crecida del Centro de Prevención de Crecidas (el más importante).
-- Un aviso puede repetirse (Nro. 1, Nro. 2...) y reemplazar al anterior, por eso se guarda
-- por (tipo, numero) y el dashboard muestra el más reciente.

CREATE TABLE avisos_crecida (
  numero TEXT NOT NULL,
  tipo TEXT NOT NULL,
  titulo TEXT,
  texto TEXT NOT NULL,
  emitido TIMESTAMPTZ,
  nota TEXT,
  alturas JSONB,
  vigente BOOLEAN NOT NULL DEFAULT true,
  actualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (numero, tipo)
);

CREATE INDEX idx_avisos_crecida_emitido ON avisos_crecida(emitido DESC);

ALTER TABLE avisos_crecida ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_avisos_crecida" ON avisos_crecida;
CREATE POLICY "anon_select_avisos_crecida" ON avisos_crecida FOR SELECT USING (true);

-- Cron de ingesta de avisos de crecida (cada 15 min)
SELECT cron.schedule('ingest-aviso-crecida', '*/15 * * * *', $$
  select net.http_post(
    url:='https://tcgzpcfhwytrrhfxtkmt.supabase.co/functions/v1/ingest-aviso-crecida',
    headers:=jsonb_build_object('Content-Type', 'application/json'),
    body:='{}'::jsonb
  ) as request_id;
$$);
