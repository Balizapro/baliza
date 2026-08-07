-- Fix: hora_salida se guarda como HH:MM (string), no como timestamp
ALTER TABLE bitacora ALTER COLUMN hora_salida TYPE TEXT USING hora_salida::text;