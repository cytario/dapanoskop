import { Link } from "react-router";
import { DeltaLogo } from "./DeltaLogo";

interface HeaderProps {
  period?: string;
  onLogout?: () => void;
}

export function Header({ period, onLogout }: HeaderProps) {
  const to = period ? `/?period=${period}` : "/";

  return (
    <header className="bg-cytario-gradient px-6 py-3 flex items-center justify-between shadow-sm">
      <Link
        to={to}
        className="flex items-center gap-2 text-white hover:opacity-90"
      >
        <DeltaLogo className="w-6 h-6" />
        <span className="text-lg font-bold">Dapanoskop</span>
      </Link>
      {onLogout && (
        <button
          onClick={onLogout}
          className="text-sm text-white/90 hover:text-white cursor-pointer hover:underline"
        >
          Logout
        </button>
      )}
    </header>
  );
}
