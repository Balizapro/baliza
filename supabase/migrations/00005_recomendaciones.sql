INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('recomendacion_verde', 'Todo normal — nivel por debajo del umbral', 'Mensaje cuando nivel < evaluacion y bajando/estable'),
  ('recomendacion_amarilla', 'Atencion — nivel subiendo. Proxima revision pronto', 'Mensaje cuando nivel < evaluacion pero subiendo'),
  ('recomendacion_roja_subiendo', 'Preparar salida — nivel superando umbral de evaluacion. Estimar punto de no retorno', 'Mensaje cuando nivel >= evaluacion y subiendo'),
  ('recomendacion_roja_critico', 'Salir ahora — nivel critico alcanzado', 'Mensaje cuando nivel >= no retorno'),
  ('recomendacion_verde_default', 'Todo normal', 'Mensaje por defecto')
ON CONFLICT (clave) DO NOTHING;
