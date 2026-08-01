export type TipoLectura = "observado" | "pronostico";

export interface Estacion {
  id: string;
  nombre: string;
  fuente: string;
  lat: number;
  lon: number;
}

export interface Lectura {
  id: string;
  estacion_id: string;
  timestamp: string;
  nivel_m: number;
  tipo: TipoLectura;
}

export interface Marea {
  id: string;
  timestamp_desde: string;
  timestamp_hasta: string;
  correccion_cm: number;
  lugar: string;
  tipo?: string;
  punto?: string;
  timestamp_marea?: string | null;
  nivel_m?: number | null;
}

export interface Viento {
  id: string;
  timestamp: string;
  velocidad_kmh: number;
  direccion_grados: number;
  lat: number;
  lon: number;
}

export interface Umbral {
  id: string;
  nombre: "evaluacion" | "no_retorno" | "bajante_alarma" | "bajante_evacuacion";
  valor_m: number;
  descripcion: string;
}

export type NivelAlerta = "verde" | "amarilla" | "roja" | "azul" | "evacuacion";

export interface Alerta {
  id: string;
  timestamp: string;
  nivel: NivelAlerta;
  ventana_inicio: string | null;
  ventana_fin: string | null;
  mensaje: string;
  disparadores_json: Record<string, unknown>;
}

export interface Bitacora {
  id: string;
  timestamp: string;
  nivel_registrado_m: number;
  escalones_restantes: number | null;
  se_evacuo: boolean;
  hora_salida: string | null;
  notas: string | null;
}

export interface EquivalenciaEscalon {
  escalon: number;
  nivel_min_m: number;
  nivel_max_m: number;
  confianza: number;
}

export interface Configuracion {
  clave: string;
  valor: string;
  descripcion: string;
}

export interface Pronostico {
  id: string;
  estacion_id: string;
  timestamp: string;
  valor_m: number;
  qualifier: string;
  forecast_date: string;
}

export type DireccionTendencia = "subiendo" | "bajando" | "estable";

export interface Tendencia {
  direccion: DireccionTendencia;
  velocidad_cm_h: number;
  duracion_hs: number;
  desde: string | null;
}

export interface EventoSmn {
  id: number;
  max_level: number;
}

export interface AlertaSmn {
  area_id: number;
  fecha: string;
  max_level: number;
  eventos_json: EventoSmn[];
  actualizado: string;
}

export type TipoAvisoShn =
  | "pronostico_mareologico"
  | "pronostico_olas"
  | "dragado"
  | "balizamiento"
  | "novedad";

export interface AvisoShn {
  numero: string;
  tipo: TipoAvisoShn;
  titulo: string;
  texto: string;
  tendencia: "ascendente" | "descendente" | null;
  nivel_max_m: number | null;
  publicado: string | null;
  actualizado: string;
}

export interface DatosAgregados {
  sanFernando: {
    observado: Lectura | null;
    pronostico: Pronostico[];
  };
  exteriores: {
    laPlata: Lectura | null;
    buenosAires: Lectura | null;
    piloteNorden: Lectura | null;
  };
  tendencias: {
    laPlata: Tendencia | null;
    buenosAires: Tendencia | null;
    piloteNorden: Tendencia | null;
  };
  parana: {
    rosario: Lectura | null;
    sanNicolas: Lectura | null;
    zarate: Lectura | null;
    campana: Lectura | null;
    escobar: Lectura | null;
  };
  viento: Viento | null;
  umbrales: Umbral[];
  config: Configuracion[];
  alerta: Alerta | null;
  escalones: EquivalenciaEscalon[];
  alertasSmn: AlertaSmn[];
  avisosShn: AvisoShn[];
  mareas: Marea[];
}
