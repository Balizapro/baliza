-- Pronósticos con qualifiers (main, p05, p25, p75, p95)
CREATE TABLE pronosticos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estacion_id UUID NOT NULL REFERENCES estaciones(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  valor_m DOUBLE PRECISION NOT NULL,
  qualifier TEXT NOT NULL DEFAULT 'main',
  forecast_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pronosticos_estacion_qualifier_ts ON pronosticos(estacion_id, qualifier, timestamp DESC);

ALTER TABLE pronosticos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_pronosticos" ON pronosticos FOR SELECT USING (true);
