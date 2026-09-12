-- Baliza: deduplicar lecturas y prevenir duplicados futuros
--
-- Las ingestiones INA y SHN (ingest-ina, ingest-alturas-horarias) escriben a la
-- misma tabla `lecturas` y solo chequean duplicados antes de insertar, lo que
-- bajo ejecución concurrente produce filas repetidas (p. ej. 33x la lectura de
-- las 00:45 de SF). Este constraint UNIQUE lo resuelve de raíz.

BEGIN;

-- Quedarse con la lectura más antigua por (estacion_id, timestamp, tipo):
-- el primer insert suele ser el dato original de la fuente madre.
DELETE FROM lecturas a
USING lecturas b
WHERE a.estacion_id = b.estacion_id
  AND a.timestamp = b.timestamp
  AND a.tipo = b.tipo
  AND a.created_at > b.created_at;

-- Evitar que las ingestiones vuelvan a crear duplicados.
CREATE UNIQUE INDEX idx_lecturas_estacion_timestamp_tipo_unique
  ON lecturas(estacion_id, timestamp, tipo);

COMMIT;