export const PALETA = {
  primario: "#0E4749",
  alerta: "#E8823A",
  ok: "#4C7A5E",
  fondo: "#F2E9DC",
  texto: "#12312B",
  textoSec: "#5B6E68",
  rojoAlerta: "#C0442B",
  atencion: "#C99A3D",
} as const;

export const ADMINS = ["escuela@baliza.app", "nradaelli122680@gmail.com"] as const;

export const ESTACIONES = {
  SAN_FERNANDO: "san_fernando",
  LA_PLATA: "la_plata",
  BUENOS_AIRES: "puesto_buenos_aires",
  PILOTE_NORDEN: "pilote_norden",
  ROSARIO: "rosario",
  SAN_NICOLAS: "san_nicolas",
  ZARATE: "zarate",
  CAMPANA: "campana",
  ESCOBAR: "escobar",
} as const;

export const PROPAGACION = {
  LA_PLATA_A_SF_HORAS: 2.5,
  BA_A_SF_HORAS: 1,
} as const;

export const COORDENADAS_BALIZA = {
  lat: -34.35,
  lon: -58.55,
} as const;
