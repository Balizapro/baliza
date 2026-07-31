-- Baliza: Alertas meteorológicas del SMN (Sistema de Alerta Temprana)
-- Fuente: ws1.smn.gob.ar/v1/warning/alert/area (JWT extraído del HTML de smn.gob.ar/alertas)

CREATE TABLE alertas_smn (
  area_id INTEGER NOT NULL,
  fecha DATE NOT NULL,
  max_level INTEGER NOT NULL,
  eventos_json JSONB NOT NULL DEFAULT '[]',
  actualizado TIMESTAMPTZ NOT NULL,
  creado TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (area_id, fecha)
);

CREATE INDEX idx_alertas_smn_fecha ON alertas_smn(fecha DESC);

ALTER TABLE alertas_smn ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_alertas_smn" ON alertas_smn FOR SELECT USING (true);

-- Áreas SMN de interés (separadas por coma). 763 = área que contiene la escuela.
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('smn_areas_interes', '763', 'IDs de área del SMN que se siguen (separados por coma)')
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now();

-- Cron de ingesta de alertas SMN
SELECT cron.schedule('ingest-alertas-smn', '*/20 * * * *', $$
  select net.http_post(
    url:='https://tcgzpcfhwytrrhfxtkmt.supabase.co/functions/v1/ingest-alertas-smn',
    headers:=jsonb_build_object('Content-Type', 'application/json'),
    body:='{}'::jsonb
  ) as request_id;
$$);
