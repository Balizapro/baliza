import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F2E9DC] dark:bg-[#0f172a] flex flex-col">
      <header className="bg-[#0E4749] dark:bg-[#0a2a2b] px-4 py-3">
        <img src="/baliza-logo-horizontal.svg" alt="Baliza" className="h-7 sm:h-8 w-auto" />
      </header>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <img
          src="/baliza-logo-principal.svg"
          alt="Baliza"
          className="w-64 sm:w-80 h-auto mb-6"
        />
        <p className="font-serif text-lg sm:text-xl text-[#12312B] dark:text-gray-200 max-w-md mb-2 leading-relaxed">
          la señal antes de la crecida
        </p>
        <p className="text-sm text-[#5B6E68] dark:text-gray-400 max-w-md mb-10 leading-relaxed">
          Sistema de anticipación a crecidas para el Delta de Tigre
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/dashboard"
            className="bg-[#0E4749] text-white px-8 py-3 rounded-xl text-base font-medium hover:bg-[#0E4749]/90 transition-all"
          >
            Ver estado actual
          </Link>
          <Link
            href="/auth/login"
            className="border border-[#0E4749]/30 text-[#0E4749] dark:text-[#4fc3c5] px-8 py-3 rounded-xl text-base font-medium hover:bg-[#0E4749]/5 transition-all"
          >
            Acceso docente
          </Link>
        </div>
      </div>
      <footer className="text-center text-xs text-[#5B6E68]/50 dark:text-gray-500 py-6">
        Baliza &mdash; la señal antes de la crecida
      </footer>
    </div>
  );
}
