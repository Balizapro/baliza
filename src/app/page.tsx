import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-fondo dark:bg-surface-dark flex flex-col">
      <header className="bg-baliza dark:bg-header-dark text-white px-4 sm:px-6 py-4 flex items-center gap-3 relative">
        <Link href="/" className="flex items-center gap-3">
          <img src="/baliza-boya.svg" alt="Baliza" className="w-12 h-12 sm:w-14 sm:h-14 flex-shrink-0" />
          <span className="logo-wordmark">baliza</span>
        </Link>
        <p className="hidden sm:block text-[12px] text-fondo/70 dark:text-white/50 italic font-serif border-l border-fondo/20 pl-3 leading-tight">
          la señal antes de la crecida
        </p>
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-gradient-to-r from-alerta/50 via-ok/30 to-transparent" />
      </header>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <img
          src="/baliza-logo-principal.svg"
          alt="Baliza"
          className="w-64 sm:w-80 h-auto mb-6"
        />
        <p className="font-serif text-lg sm:text-xl text-texto dark:text-gray-200 max-w-md mb-2 leading-relaxed">
          la señal antes de la crecida
        </p>
        <p className="text-sm text-texto-sec dark:text-gray-400 max-w-md mb-10 leading-relaxed">
          Sistema de anticipación a crecidas para el Delta de Tigre
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/dashboard"
            className="bg-baliza text-white px-8 py-3 rounded-xl text-base font-medium hover:bg-baliza/90 transition-all"
          >
            Ver estado actual
          </Link>
          <Link
            href="/auth/login"
            className="border border-baliza/30 text-baliza dark:text-marea-dark px-8 py-3 rounded-xl text-base font-medium hover:bg-baliza/5 transition-all"
          >
            Acceso docente
          </Link>
        </div>
      </div>
      <footer className="text-center text-xs text-texto-sec dark:text-gray-400 py-6">
        Baliza &mdash; la señal antes de la crecida
      </footer>
    </div>
  );
}
