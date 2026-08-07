-- Bitácora: permitir registrar eventos de cualquier tipo (no solo evacuación)
ALTER TABLE bitacora
  ADD COLUMN tipo_evento TEXT DEFAULT 'otro',
  ADD COLUMN fecha_evento TIMESTAMPTZ;
