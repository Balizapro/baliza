-- Baliza: Schema inicial
-- Sistema de anticipación a crecidas para el Delta de Tigre

-- Estaciones de medición
CREATE TABLE estaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  fuente TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Lecturas de nivel
CREATE TYPE tipo_lectura AS ENUM ('observado', 'pronostico');

CREATE TABLE lecturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estacion_id UUID NOT NULL REFERENCES estaciones(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  nivel_m DOUBLE PRECISION NOT NULL,
  tipo tipo_lectura NOT NULL DEFAULT 'observado',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_lecturas_estacion_timestamp ON lecturas(estacion_id, timestamp DESC);

-- Mareas / corrección SHN
CREATE TABLE mareas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp_desde TIMESTAMPTZ NOT NULL,
  timestamp_hasta TIMESTAMPTZ NOT NULL,
  correccion_cm DOUBLE PRECISION NOT NULL,
  lugar TEXT NOT NULL DEFAULT 'San Fernando',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Viento
CREATE TABLE viento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL,
  velocidad_kmh DOUBLE PRECISION NOT NULL,
  direccion_grados DOUBLE PRECISION NOT NULL,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_viento_timestamp ON viento(timestamp DESC);

-- Umbrales de decisión
CREATE TYPE tipo_umbral AS ENUM ('evaluacion', 'no_retorno');

CREATE TABLE umbrales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre tipo_umbral NOT NULL,
  valor_m DOUBLE PRECISION NOT NULL,
  descripcion TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(nombre)
);

-- Alertas generadas
CREATE TYPE nivel_alerta AS ENUM ('verde', 'amarilla', 'roja');

CREATE TABLE alertas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  nivel nivel_alerta NOT NULL,
  ventana_inicio TIMESTAMPTZ,
  ventana_fin TIMESTAMPTZ,
  mensaje TEXT,
  disparadores_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_alertas_timestamp ON alertas(timestamp DESC);

-- Bitácora de eventos
CREATE TABLE bitacora (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  nivel_registrado_m DOUBLE PRECISION NOT NULL,
  escalones_restantes INTEGER,
  se_evacuo BOOLEAN DEFAULT false,
  hora_salida TIMESTAMPTZ,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Equivalencia escalones ↔ metros
CREATE TABLE equivalencia_escalones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escalon INTEGER NOT NULL,
  nivel_min_m DOUBLE PRECISION NOT NULL,
  nivel_max_m DOUBLE PRECISION NOT NULL,
  confianza DOUBLE PRECISION DEFAULT 0.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Configuración dinámica (clave-valor, editable sin tocar código)
CREATE TABLE configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  descripcion TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Suscriptores (Fase 2)
CREATE TABLE suscriptores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono TEXT NOT NULL,
  nombre TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS básico: permitir lectura anónima, solo server-side escribe
ALTER TABLE estaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE mareas ENABLE ROW LEVEL SECURITY;
ALTER TABLE viento ENABLE ROW LEVEL SECURITY;
ALTER TABLE umbrales ENABLE ROW LEVEL SECURITY;
ALTER TABLE alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE bitacora ENABLE ROW LEVEL SECURITY;
ALTER TABLE equivalencia_escalones ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE suscriptores ENABLE ROW LEVEL SECURITY;

-- Permitir SELECT anónimo en todas las tablas del MVP
CREATE POLICY "anon_select_estaciones" ON estaciones FOR SELECT USING (true);
CREATE POLICY "anon_select_lecturas" ON lecturas FOR SELECT USING (true);
CREATE POLICY "anon_select_mareas" ON mareas FOR SELECT USING (true);
CREATE POLICY "anon_select_viento" ON viento FOR SELECT USING (true);
CREATE POLICY "anon_select_umbrales" ON umbrales FOR SELECT USING (true);
CREATE POLICY "anon_select_alertas" ON alertas FOR SELECT USING (true);
CREATE POLICY "anon_select_bitacora" ON bitacora FOR SELECT USING (true);
CREATE POLICY "anon_select_equivalencia" ON equivalencia_escalones FOR SELECT USING (true);
CREATE POLICY "anon_select_configuracion" ON configuracion FOR SELECT USING (true);
CREATE POLICY "anon_select_suscriptores" ON suscriptores FOR SELECT USING (true);

-- Seed: estaciones
INSERT INTO estaciones (nombre, fuente, lat, lon) VALUES
  ('San Fernando (Brazo Luján)', 'INA', -34.44, -58.56),
  ('La Plata', 'INA', -34.92, -57.95),
  ('Puerto de Buenos Aires', 'INA', -34.60, -58.37),
  ('Pilote Norden', 'SHN', -34.73, -58.35),
  ('Rosario', 'INA', -32.94, -60.63),
  ('San Nicolás', 'INA', -33.34, -60.19),
  ('Zárate', 'INA', -34.10, -59.01),
  ('Campana', 'INA', -34.16, -58.96),
  ('Escobar', 'INA', -34.30, -58.73)
ON CONFLICT DO NOTHING;

-- Seed: umbrales
INSERT INTO umbrales (nombre, valor_m, descripcion) VALUES
  ('evaluacion', 2.0, 'Nivel de atención: empezar a evaluar'),
  ('no_retorno', 2.2, 'Punto de no retorno: salir ahora')
ON CONFLICT (nombre) DO UPDATE SET valor_m = EXCLUDED.valor_m, descripcion = EXCLUDED.descripcion, updated_at = now();

-- Seed: configuración dinámica
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('tiempo_traslado_minutos', '10', 'Tiempo estimado de traslado escuela → muelle en tierra')
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now();
