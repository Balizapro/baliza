alter table avisos_shn add column if not exists nivel_max_m numeric;

comment on column avisos_shn.nivel_max_m is
  'Altura máxima pronosticada para San Fernando (m), extraída del texto del aviso. NULL si no se pudo parsear.';
