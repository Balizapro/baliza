-- Baliza: Seed de umbrales y mensajes para bajante
-- bajante_alarma: cuando el río llega a este nivel (default 0.00m) → alarma azul
-- bajante_evacuacion: cuando cae por debajo (negativo) → evacuación

INSERT INTO umbrales (nombre, valor_m, descripcion) VALUES
  ('bajante_alarma', 0.00, 'Bajante: nivel de alarma'),
  ('bajante_evacuacion', -0.10, 'Bajante: nivel de evacuación')
ON CONFLICT (nombre) DO UPDATE SET valor_m = EXCLUDED.valor_m, descripcion = EXCLUDED.descripcion, updated_at = now();

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('recomendacion_bajante_alarma', 'Bajante — nivel {{nivel}}m. Coordinar traslado antes de que el río baje más', 'Mensaje cuando nivel <= bajante alarma'),
  ('recomendacion_bajante_evacuacion', 'EVACUACIÓN por bajante — nivel {{nivel}}m. Salir ya, el río impide la navegación', 'Mensaje cuando nivel <= bajante evacuación')
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now();
