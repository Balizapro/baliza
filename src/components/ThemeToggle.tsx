"use client";

import { useTheme, toggleTheme } from "@/lib/theme";

export default function ThemeToggle() {
  const dark = useTheme();

  return (
    <button
      onClick={() => toggleTheme(dark)}
      className="text-xs text-white/70 hover:text-white border border-white/20 rounded px-2.5 py-1.5"
      aria-label={dark ? "Modo claro" : "Modo oscuro"}
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}
