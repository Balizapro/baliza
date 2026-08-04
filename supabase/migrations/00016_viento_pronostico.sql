-- Baliza: Pronóstico horario de viento (Open-Meteo) para el modelo de forzante
-- meteorológica (sudestada). El dashboard lo usa para proyectar la curva de nivel
-- a futuro combinando la marea armónica con el efecto del viento SE.
-- El ingest-viento lo actualiza cada 20 min con la ventana de pronóstico de 48-72h.

CREATE TABLE viento_pronostico (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  velocidad_kmh NUMERIC(6, 2) NOT NULL,
  direccion_grados NUMERIC(6, 2) NOT NULL,
  lat NUMERIC(9, 6) NOT NULL,
  lon NUMERIC(9, 6) NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_viento_pronostico_timestamp ON viento_pronostico(timestamp);

CREATE INDEX idx_viento_pronostico_orden ON viento_pronostico(timestamp ASC);

ALTER TABLE viento_pronostico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_viento_pronostico" ON viento_pronostico;
CREATE POLICY "anon_select_viento_pronostico" ON viento_pronostico FOR SELECT USING (true);
