import React from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Barcode,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Scan,
  Milk,
  Apple,
  Fish,
  Drumstick,
  Salad,
  Citrus,
  PackageCheck
} from 'lucide-react';

interface LandingPageProps {
  onOpenQR: () => void;
}

interface ProductItem {
  name: string;
  brand: string;
  emoji: string;
  category: string;
}

const FEATURED_PRODUCTS: ProductItem[] = [
  { name: 'Pasteurized Toned Milk', brand: 'Amul Dairy', emoji: '🥛', category: 'Dairy' },
  { name: 'Set Yogurt', brand: 'Mother Dairy', emoji: '🥣', category: 'Dairy' },
  { name: 'Fresh Paneer', brand: 'Nandini', emoji: '🧀', category: 'Dairy' },
  { name: 'Baby Spinach', brand: 'FreshToHome', emoji: '🥬', category: 'Greens' },
  { name: 'Fresh Strawberries', brand: 'Mahabaleshwar Farms', emoji: '🍓', category: 'Produce' },
  { name: 'Chicken Breast', brand: 'Licious', emoji: '🍗', category: 'Poultry' },
  { name: 'Atlantic Salmon', brand: 'Cambay Tiger', emoji: '🐟', category: 'Seafood' },
  { name: 'Fresh Orange Juice', brand: 'Raw Pressery', emoji: '🍊', category: 'Beverages' },
  { name: 'Deli Ham', brand: 'Prasuma', emoji: '🍖', category: 'Meat' },
  { name: 'Cottage Cheese', brand: 'Milky Mist', emoji: '🧈', category: 'Dairy' },
];

export const LandingPage: React.FC<LandingPageProps> = ({ onOpenQR }) => {
  const navigate = useNavigate();
  const gs1QrString = 'https://aayu.app/01/08901030855432/10/L26080501/17/260815';
  const gs1Monospace = '(01)08901030855432(10)L26080501(17)260815';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Main Content Sections */}
      <main className="flex-1">
        {/* b. HERO SECTION (60vh minimum, split into two columns on desktop, stacked on mobile) */}
        <section className="min-h-[60vh] max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 flex items-center">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center w-full">
            {/* Left Column (60% width on desktop) */}
            <div className="lg:col-span-7 space-y-6 sm:space-y-8">
              {/* Eyebrow small text: "AI-powered cold-chain intelligence" */}
              <div className="uppercase text-[12px] font-medium text-slate-500 tracking-[0.05em]">
                AI-powered cold-chain intelligence
              </div>

              {/* Big headline (48-64px, font-weight 700, tight line-height) */}
              <h1 className="text-4xl sm:text-5xl lg:text-[60px] font-bold text-slate-900 tracking-tight leading-[1.08]">
                Every batch has the same expiry date.
                <br />
                <span className="text-slate-500">
                  Aayu tells you which ones actually deserve it.
                </span>
              </h1>

              {/* Sub-copy paragraph (18px, slate-600, max-width 480px) */}
              <p className="text-[18px] text-slate-600 max-w-[480px] leading-relaxed">
                Scan any perishable food barcode. Aayu reads its cold-chain journey, predicts real remaining shelf life, and gives you a decision in seconds.
              </p>

              {/* Two CTA buttons in a row: Primary & Secondary */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 pt-2">
                {/* Primary: "Scan a barcode" — opens the scanner modal. Icon: barcode */}
                <button
                  type="button"
                  onClick={onOpenQR}
                  className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium text-base shadow-sm transition-all active:scale-[0.98] cursor-pointer"
                >
                  <Barcode className="w-5 h-5 text-slate-200" />
                  <span>Scan a barcode</span>
                </button>

                {/* Secondary (ghost/outline): "Browse batches" — navigates to /batches. Icon: arrow-right */}
                <button
                  type="button"
                  onClick={() => navigate('/batches')}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg border border-slate-300 hover:border-slate-400 bg-white hover:bg-slate-50 text-slate-800 font-medium text-base transition-all active:scale-[0.98] cursor-pointer shadow-xs"
                >
                  <span>Browse batches</span>
                  <ArrowRight className="w-4 h-4 text-slate-600" />
                </button>
              </div>
            </div>

            {/* Right Column (40% width on desktop) */}
            <div className="lg:col-span-5 flex justify-center lg:justify-end">
              {/* Rounded 12px card with subtle border and shadow */}
              <div className="w-full max-w-sm rounded-[12px] border border-slate-200 bg-white p-6 sm:p-7 shadow-lg flex flex-col items-center text-center">
                {/* Rendered GS1 QR code (qrcode.react) ~240px */}
                <div className="p-2 bg-white rounded-md">
                  <QRCodeSVG
                    value={gs1QrString}
                    size={230}
                    level="M"
                    includeMargin={false}
                  />
                </div>

                {/* Below QR: monospace text of GS1 element string */}
                <div className="mt-4 font-mono text-xs text-slate-700 font-medium bg-slate-100 py-1.5 px-3 rounded border border-slate-200 break-all select-all">
                  {gs1Monospace}
                </div>

                {/* Caption underneath */}
                <p className="mt-3 text-xs text-slate-500 leading-normal">
                  Try Aayu — point a second device&apos;s camera at this code.
                </p>

                <div className="mt-4 pt-3 border-t border-slate-100 w-full flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono text-slate-400">Batch b_0001</span>
                  <button
                    onClick={() => navigate('/batches/b_0001')}
                    className="text-slate-900 font-medium hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    View batch &rarr;
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* c. "HOW IT WORKS" STRIP (3 columns on desktop, stacked on mobile) */}
        <section className="bg-white border-y border-slate-200 py-16 sm:py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            {/* Section heading: "How Aayu works" (28px, medium weight, centered) */}
            <h2 className="text-[28px] font-medium text-slate-900 text-center tracking-tight">
              How Aayu works
            </h2>

            {/* 3 icon cards, equal width, 24px gap */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Card 1: icon "scan" / barcode */}
              <div className="p-7 rounded-[12px] border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-colors space-y-4">
                <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-900 shadow-xs">
                  <Scan className="w-6 h-6 text-slate-800" />
                </div>
                <h3 className="text-[18px] font-medium text-slate-900">
                  Scan the barcode.
                </h3>
                <p className="text-[14px] text-slate-600 leading-relaxed">
                  Every perishable food package carries a GS1 code with product identity and batch lot.
                </p>
              </div>

              {/* Card 2: icon "sparkles" / brain */}
              <div className="p-7 rounded-[12px] border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-colors space-y-4">
                <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-900 shadow-xs">
                  <Sparkles className="w-6 h-6 text-slate-800" />
                </div>
                <h3 className="text-[18px] font-medium text-slate-900">
                  AI reads the journey.
                </h3>
                <p className="text-[14px] text-slate-600 leading-relaxed">
                  Aayu&apos;s Vertex-AI agents analyze cold-chain telemetry — temperature, humidity, transit delays.
                </p>
              </div>

              {/* Card 3: icon "check-circle" */}
              <div className="p-7 rounded-[12px] border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-colors space-y-4">
                <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-900 shadow-xs">
                  <CheckCircle2 className="w-6 h-6 text-slate-800" />
                </div>
                <h3 className="text-[18px] font-medium text-slate-900">
                  Get a decision in seconds.
                </h3>
                <p className="text-[14px] text-slate-600 leading-relaxed">
                  Sell now, prioritize, discount, inspect, or quarantine — with the reasoning shown.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* d. "WHY IT MATTERS" STRIP (single-column, quiet) */}
        <section className="py-20 sm:py-28 max-w-4xl mx-auto px-4 text-center">
          <div className="space-y-4">
            {/* Stat (huge, 64px) */}
            <div className="text-6xl sm:text-[64px] font-bold text-slate-900 tracking-tight">
              1 in 5
            </div>
            {/* Below text */}
            <p className="text-lg sm:text-xl text-slate-600 font-normal max-w-xl mx-auto leading-relaxed">
              food batches would fail a real cold-chain audit — but only Aayu shows you which ones.
            </p>
          </div>
        </section>

        {/* e. FEATURED PRODUCTS SECTION */}
        <section className="bg-white border-t border-slate-200 py-16 sm:py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            {/* Section heading: "Ten product categories tracked" (24px medium, left-aligned) */}
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
              <h2 className="text-[24px] font-medium text-slate-900 tracking-tight">
                Ten product categories tracked
              </h2>
              <span className="text-xs font-mono text-slate-500">
                200 simulated receiving-dock batches
              </span>
            </div>

            {/* Grid on desktop, horizontally scrollable on mobile */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
              {FEATURED_PRODUCTS.map((prod, idx) => (
                <div
                  key={idx}
                  onClick={() => navigate('/batches')}
                  className="p-4 rounded-[12px] border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-all cursor-pointer flex flex-col justify-between group shadow-2xs"
                >
                  <div className="text-2xl mb-2 group-hover:scale-110 transition-transform origin-left">
                    {prod.emoji}
                  </div>
                  <div className="space-y-0.5">
                    <h4 className="text-xs sm:text-sm font-medium text-slate-900 leading-snug line-clamp-2">
                      {prod.name}
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {prod.brand}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* f. FINAL CTA STRIP */}
        <section className="py-20 sm:py-24 border-t border-slate-200 bg-slate-100/50">
          <div className="max-w-3xl mx-auto px-4 text-center space-y-6">
            {/* Headline (32px) */}
            <h2 className="text-[32px] font-bold text-slate-900 tracking-tight">
              Ready to scan?
            </h2>

            {/* Two buttons — "Scan a barcode" (primary), "Browse batches" (secondary) */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
              <button
                type="button"
                onClick={onOpenQR}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium text-base shadow-sm transition-all active:scale-[0.98] cursor-pointer"
              >
                <Barcode className="w-5 h-5 text-slate-200" />
                <span>Scan a barcode</span>
              </button>

              <button
                type="button"
                onClick={() => navigate('/batches')}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg border border-slate-300 hover:border-slate-400 bg-white hover:bg-slate-50 text-slate-800 font-medium text-base transition-all active:scale-[0.98] cursor-pointer shadow-xs"
              >
                <span>Browse batches</span>
                <ArrowRight className="w-4 h-4 text-slate-600" />
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* g. FOOTER */}
      <footer className="border-t border-slate-200 py-6 bg-white text-center">
        <p className="text-xs text-slate-500">
          Aayu · Patchamomma 2026 · Built with Gemini + BigQuery + ADK on Google Cloud.
        </p>
      </footer>
    </div>
  );
};
