-- Baliza: Bajante (nivel bajo del río)
-- Alarma cuando el nivel llega al umbral de bajante alarma (default 0.00m).
-- Evacuación cuando el nivel cae por debajo del umbral de bajante evacuación (negativo).

-- Nuevos tipos de umbral para bajante
ALTER TYPE tipo_umbral ADD VALUE IF NOT EXISTS 'bajante_alarma';
ALTER TYPE tipo_umbral ADD VALUE IF NOT EXISTS 'bajante_evacuacion';

-- Nuevos niveles de alerta para bajante
ALTER TYPE nivel_alerta ADD VALUE IF NOT EXISTS 'azul';
ALTER TYPE nivel_alerta ADD VALUE IF NOT EXISTS 'evacuacion';
