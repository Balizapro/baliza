export interface AlturaSanFernando {
  estado: "PLEAMAR" | "BAJAMAR";
  fecha: string; // DD/MM/YYYY
  hora: string; // HH:MM
  altura: number;
}

// Alturas pronosticadas para San Fernando a partir del texto del pronóstico
// mareológico del SHN (radioavisos náuticos).
export function alturasSanFernando(texto: string): AlturaSanFernando[] {
  const bloque = texto.match(/SAN\s+FERNANDO([\s\S]*?)(?:RIO DE LA PLATA EXTERIOR:|PUERTO\s+[A-Z]|$)/i);
  if (!bloque) return [];

  const filas: AlturaSanFernando[] = [];
  for (const linea of bloque[1].split("\n")) {
    const m = linea.match(/(BAJAMAR|PLEAMAR)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s+([+-]?\d+(?:\.\d+)?)/i);
    if (m) {
      filas.push({ estado: m[1] as AlturaSanFernando["estado"], fecha: m[2], hora: m[3], altura: parseFloat(m[4]) });
    }
  }
  return filas;
}

export function vigenciaFin(texto: string): number | null {
  const m = texto.match(
    /V[áa]lido desde el\s*([\d\/]+)\s+(\d{1,2}):(\d{2})\s*hs hasta el\s*([\d\/]+)\s+(\d{1,2}):(\d{2})\s*hs/i
  );
  if (!m) return null;
  const [dd, mm, yyyy] = m[4].split("/").map(Number);
  return new Date(yyyy, mm - 1, dd, Number(m[5]), Number(m[6])).getTime();
}
