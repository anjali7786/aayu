import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Barcode } from 'lucide-react';

interface HeaderProps {
  onOpenQR: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenQR }) => {
  const location = useLocation();

  const isHome = location.pathname === '/';
  const isBatches = location.pathname.startsWith('/batches');
  const isCompare = location.pathname.startsWith('/compare');

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Left: Logo text "Aayu" (medium weight, 22px, slate-900) */}
        <Link
          to="/"
          className="text-[22px] font-medium text-slate-900 tracking-tight hover:opacity-90 transition-opacity focus:outline-none"
        >
          Aayu
        </Link>

        {/* Right: Nav links: "Home", "Batches", "Compare", "Scan" */}
        <nav className="flex items-center gap-2 sm:gap-6">
          <Link
            to="/"
            className={`text-sm transition-colors py-1.5 px-2 rounded-md ${
              isHome
                ? 'font-semibold text-slate-900'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Home
          </Link>

          <Link
            to="/batches"
            className={`text-sm transition-colors py-1.5 px-2 rounded-md ${
              isBatches
                ? 'font-semibold text-slate-900'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Batches
          </Link>

          <Link
            to="/compare?a=b_0000&b=b_0001"
            className={`text-sm transition-colors py-1.5 px-2 rounded-md ${
              isCompare
                ? 'font-semibold text-slate-900'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Compare
          </Link>

          {/* Scan button (button 8px radius, opens modal) */}
          <button
            type="button"
            onClick={onOpenQR}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-all shadow-sm cursor-pointer ml-1 sm:ml-2 active:scale-95"
          >
            <Barcode className="w-4 h-4 text-slate-200" />
            <span>Scan</span>
          </button>
        </nav>
      </div>
    </header>
  );
};
