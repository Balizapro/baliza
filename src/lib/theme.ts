"use client";

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains("dark");
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function aplicar(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {
    // sin localStorage (modo privado, etc.)
  }
  emit();
}

export function useTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function toggleTheme(actual: boolean) {
  aplicar(!actual);
}
