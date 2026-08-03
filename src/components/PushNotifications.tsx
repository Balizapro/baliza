"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export default function PushNotifications() {
  const [activo, setActivo] = useState<boolean | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apoyo, setApoyo] = useState(true);

  useEffect(() => {
    async function verificar() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setApoyo(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setActivo(!!sub);
    }
    verificar().catch(() => {});
  }, []);

  async function activar() {
    setCargando(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as string,
        });
      }

      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const { error: err } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: user?.id ?? null,
          endpoint: sub.endpoint,
          p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")!))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
          auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")!))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
        },
        { onConflict: "endpoint" }
      );

      if (err) {
        setError("No se pudo guardar la suscripción: " + err.message);
      } else {
        setActivo(true);
      }
    } catch (e) {
      setError("Permiso denegado o no soportado: " + (e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function desactivar() {
    setCargando(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        const supabase = createClient();
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
      setActivo(false);
    } catch (e) {
      setError("Error al desactivar: " + (e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  if (!apoyo) return null;

  return (
    <div className="relative">
      <button
        onClick={activo ? desactivar : activar}
        disabled={cargando}
        title={activo ? "Desactivar alertas del río" : "Recibir alertas del río por notificación"}
        className={`text-xs border rounded px-2.5 py-1.5 transition-colors disabled:opacity-50 ${
          activo
            ? "text-white bg-[#4C7A5E]/30 border-[#4C7A5E]/60 hover:bg-[#4C7A5E]/50"
            : "text-white/70 hover:text-white border-white/20 hover:bg-white/10"
        }`}
      >
        {cargando ? "…" : activo ? "🔔 Activas" : "🔕 Activar alertas"}
      </button>
      {error && (
        <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-white dark:bg-[#1e293b] text-[#8B1E1E] dark:text-red-300 text-xs rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
          {error}
          <button onClick={() => setError(null)} className="block mt-1 text-[#5B6E68]/70 hover:text-[#0E4749]">Cerrar</button>
        </div>
      )}
    </div>
  );
}
