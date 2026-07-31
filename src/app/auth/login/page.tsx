"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError("");

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setCargando(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-[#F2E9DC] dark:bg-[#0f172a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img
            src="/baliza-logo-principal.svg"
            alt="Baliza"
            className="h-28 w-auto mb-3"
          />
        </div>
        <div>
          <p className="text-sm text-[#5B6E68] dark:text-gray-400 mb-6 text-center">
            Ingresá con tu cuenta para administrar
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-[#5B6E68] dark:text-gray-400 block mb-1.5 font-medium">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0E4749]/20 focus:border-[#0E4749] transition-all"
                placeholder="tu@email.com"
                required
              />
            </div>
            <div>
              <label className="text-xs text-[#5B6E68] dark:text-gray-400 block mb-1.5 font-medium">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-[#D4C9B8] dark:border-gray-600 bg-white dark:bg-[#0f172a] text-[#12312B] dark:text-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0E4749]/20 focus:border-[#0E4749] transition-all"
                placeholder="••••••••"
                required
              />
            </div>
            {error && (
              <p className="text-sm text-[#C0442B] dark:text-red-400 bg-white dark:bg-[#1e293b] rounded-lg px-3 py-2 border border-[#C0442B]/20 dark:border-red-400/20">{error}</p>
            )}
            <button
              type="submit"
              disabled={cargando}
              className="w-full bg-[#0E4749] text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-[#0E4749]/90 disabled:opacity-50 transition-all"
            >
              {cargando ? "Ingresando..." : "Ingresar"}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-[#5B6E68]/50 dark:text-gray-500 mt-6">
          Baliza &mdash; la señal antes de la crecida
        </p>
      </div>
    </div>
  );
}
