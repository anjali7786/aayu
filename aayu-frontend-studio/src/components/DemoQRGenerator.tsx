import React, { useState, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  QrCode,
  Printer,
  Copy,
  Check,
  Camera,
  Sparkles,
  Tag,
  ExternalLink
} from 'lucide-react';

interface DemoQRGeneratorProps {
  onOpenScanner: () => void;
  onNavigateDetail: (batchId: string) => void;
}

const PRESET_BATCHES = [
  { id: 'b_0000', label: 'Optimal Milk', tag: 'Sell Normally', color: 'emerald' },
  { id: 'b_0001', label: 'Abused Milk', tag: 'Inspect', color: 'rose' },
  { id: 'b_0153', label: 'Yogurt Batch', tag: 'Live Data', color: 'amber' },
  { id: 'b_0154', label: 'Leafy Greens', tag: 'Fast Perishable', color: 'slate' },
];

export const DemoQRGenerator: React.FC<DemoQRGeneratorProps> = ({
  onOpenScanner,
  onNavigateDetail,
}) => {
  const [selectedBatchId, setSelectedBatchId] = useState('b_0001');
  const [customInput, setCustomInput] = useState('');
  const [copied, setCopied] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const handleSelectPreset = (id: string) => {
    setSelectedBatchId(id);
    setCustomInput('');
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customInput.trim().toLowerCase();
    if (!clean) return;

    let finalId = clean;
    if (/^\d{1,4}$/.test(clean)) {
      finalId = `b_${clean.padStart(4, '0')}`;
    } else if (/^b\d{1,4}$/.test(clean)) {
      finalId = `b_${clean.replace('b', '').padStart(4, '0')}`;
    }
    setSelectedBatchId(finalId);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedBatchId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div id="demo-qr-generator" className="rounded-2xl bg-gradient-to-b from-slate-900/90 to-slate-950/90 border border-slate-800 p-6 sm:p-8 shadow-xl">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Judge & Evaluator Testing Utility</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <QrCode className="w-5 h-5 text-emerald-400" />
            Generate Demo QR Tag
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-xl">
            Generate printable optical tags for any cold-chain crate to test real-time camera scanning without requiring physical warehouse crates.
          </p>
        </div>

        {/* Note mandated by requirement */}
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 max-w-md">
          <p className="font-semibold text-white mb-0.5 flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-emerald-400" />
            Evaluation Tip:
          </p>
          <p className="italic">
            &ldquo;Print this QR and stick it on a crate to test the scanner.&rdquo;
          </p>
          <p className="text-[11px] text-emerald-400/80 mt-1">
            (You can also point your phone or another screen at the camera directly.)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 mt-6">
        {/* Left Column: Preset controls & input */}
        <div className="md:col-span-7 space-y-5">
          <div>
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2">
              Select Batch for QR Generation:
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {PRESET_BATCHES.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset.id)}
                  type="button"
                  className={`p-3 rounded-xl border text-left transition-all ${
                    selectedBatchId === preset.id
                      ? 'bg-emerald-500/10 border-emerald-500/50 text-white shadow-sm ring-1 ring-emerald-500/30'
                      : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-white">{preset.id}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      preset.color === 'emerald' ? 'bg-emerald-500/20 text-emerald-400' :
                      preset.color === 'rose' ? 'bg-rose-500/20 text-rose-400' :
                      preset.color === 'amber' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-slate-800 text-slate-400'
                    }`}>
                      {preset.tag}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 mt-1 block">{preset.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Batch Input */}
          <form onSubmit={handleCustomSubmit} className="space-y-2">
            <label className="text-xs font-medium text-slate-400 block">
              Or specify any batch from the 200 catalog items:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="e.g. b_0042, b_0199, or 42..."
                className="flex-1 bg-slate-900 border border-slate-700 text-sm text-white rounded-lg px-3.5 py-2 font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-white rounded-lg transition-colors"
              >
                Generate
              </button>
            </div>
          </form>

          {/* Action Row */}
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={onOpenScanner}
              className="px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-xs transition-colors flex items-center gap-2 shadow-sm"
            >
              <Camera className="w-4 h-4" />
              <span>Launch Camera Scanner</span>
            </button>

            <button
              onClick={() => onNavigateDetail(selectedBatchId)}
              className="px-3.5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 transition-colors flex items-center gap-1.5"
            >
              <span>View Batch Data</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </button>

            <button
              onClick={handlePrint}
              className="px-3.5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 transition-colors flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5 text-slate-400" />
              <span>Print Crate Tag</span>
            </button>

            <button
              onClick={handleCopy}
              className="px-3 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied ID' : 'Copy ID'}</span>
            </button>
          </div>
        </div>

        {/* Right Column: High-contrast Printable Crate Tag Card */}
        <div className="md:col-span-5 flex flex-col items-center justify-center">
          <div
            ref={printRef}
            className="w-full max-w-[280px] bg-white text-slate-950 p-5 rounded-2xl shadow-2xl border-2 border-slate-200 flex flex-col items-center text-center space-y-3 print:border-black"
          >
            <div className="w-full border-b border-slate-200 pb-2 flex items-center justify-between">
              <span className="text-[10px] font-black tracking-widest text-slate-700 uppercase">
                Aayu Crate Tag
              </span>
              <span className="text-[10px] font-mono font-bold text-emerald-700 uppercase bg-emerald-50 px-1.5 py-0.5 rounded">
                Telemetry Active
              </span>
            </div>

            {/* High Contrast QR Code */}
            <div className="p-2.5 bg-white rounded-xl border border-slate-100 shadow-inner flex items-center justify-center">
              <QRCodeSVG
                value={selectedBatchId}
                size={170}
                level="H"
                includeMargin={true}
              />
            </div>

            {/* Batch ID display */}
            <div className="w-full pt-1">
              <span className="text-[11px] font-mono uppercase text-slate-500 block tracking-wider">
                Batch Identifier
              </span>
              <span className="text-2xl font-mono font-black text-slate-950 tracking-tight block">
                {selectedBatchId}
              </span>
            </div>

            <div className="w-full pt-2 border-t border-slate-100 text-[10px] text-slate-500 flex items-center justify-between font-mono">
              <span>SCAN VIA WEBCAM</span>
              <span>FASTAPI ADK</span>
            </div>
          </div>
          <span className="text-[11px] text-slate-500 mt-2 font-mono">
            Optical tag: <strong className="text-slate-300 font-semibold">{selectedBatchId}</strong>
          </span>
        </div>
      </div>
    </div>
  );
};
