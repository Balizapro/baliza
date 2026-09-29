import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const INGESTS = [
  "ingest-ina",
  "ingest-pronostico",
  "ingest-viento",
  "ingest-shn",
  "ingest-alturas-horarias",
  "ingest-alertas-smn",
  "ingest-avisos-shn",
  "ingest-aviso-crecida",
];

// El SMN puso (o activó) un challenge de Cloudflare en su página pública que
// bloquea el scraping del token que usa ingest-alertas-smn (ver investigación
// del 29-sep-2026). No hay forma legítima de esquivarlo desde una Edge Function,
// así que mientras no consigamos acceso oficial del SMN, este fallo es ESPERADO
// y no debe tirar abajo el resto del pipeline ni poner en rojo el workflow cada
// hora sin que nadie pueda hacer nada al respecto. Se sigue intentando igual
// (si el SMN levanta el bloqueo, vuelve a andar solo, sin tocar código) pero su
// fallo no cuenta para el estado general ni corta el proceso.
const NO_CRITICOS = new Set(["ingest-alertas-smn"]);

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const results = await Promise.all(
    INGESTS.map(async (fn) => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
        });
        const data = await res.json().catch(() => null);
        return { fn, ok: res.ok, status: res.status, data };
      } catch (err) {
        return { fn, ok: false, error: (err as Error).message };
      }
    })
  );

  const allOk = results.every((r) => r.ok || NO_CRITICOS.has(r.fn));
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 500 });
}
