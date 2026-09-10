import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { QRCodeSVG } from 'qrcode.react';
import {
  Barcode,
  X,
  ArrowRight,
  CameraOff,
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { lookupBarcode } from '../services/api';

interface ScanQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectBatch: (batchId: string) => void;
}

type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'scanning'
  | 'validating'
  | 'success'
  | 'permission-denied'
  | 'no-camera'
  | 'not-recognized'
  | 'error';

interface PresetBatch {
  id: string;
  name: string;
  tag: string;
  gs1Url: string;
  color: string;
}

const PRESET_BATCHES: PresetBatch[] = [
  {
    id: 'b_0000',
    name: 'Pasteurized Milk (Optimal Cold-Chain)',
    tag: 'Sell Normally',
    gs1Url: 'https://aayu.app/01/08901030855432/10/L26080500/17/260815',
    color: 'emerald',
  },
  {
    id: 'b_0001',
    name: 'Pasteurized Milk (10.8°C Excursion)',
    tag: 'Inspect',
    gs1Url: 'https://aayu.app/01/08901030855432/10/L26080501/17/260815',
    color: 'rose',
  },
  {
    id: 'b_0002',
    name: 'Set Yogurt (Stable Depot Transit)',
    tag: 'Sell Normally',
    gs1Url: 'https://aayu.app/01/08901030871234/10/L26080102/17/260815',
    color: 'sky',
  },
];

export const ScanQRModal: React.FC<ScanQRModalProps> = ({
  isOpen,
  onClose,
  onSelectBatch,
}) => {
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedDemoBatch, setSelectedDemoBatch] = useState<PresetBatch>(PRESET_BATCHES[1]);
  const [manualCode, setManualCode] = useState('');
  const [manualError, setManualError] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isValidatingRef = useRef<boolean>(false);
  const isCancelledRef = useRef<boolean>(false);

  // Stop camera helper
  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch (err) {
        console.warn('Error during scanner stop:', err);
      }
      scannerRef.current = null;
    }
  }, []);

  // Handle scanned text
  const handleDecodedCode = useCallback(async (rawText: string) => {
    if (isValidatingRef.current) return;
    isValidatingRef.current = true;

    setCameraStatus('validating');
    setErrorMessage('');

    try {
      const result = await lookupBarcode(rawText);
      if (isCancelledRef.current) return;

      if (result && result.batch_id) {
        setCameraStatus('success');
        setTimeout(async () => {
          await stopCamera();
          onSelectBatch(result.batch_id);
          onClose();
        }, 500);
      } else {
        setCameraStatus('not-recognized');
        setErrorMessage('Barcode not recognized. Check that this batch exists in Aayu.');
      }
    } catch (err: any) {
      if (isCancelledRef.current) return;
      setCameraStatus('not-recognized');
      setErrorMessage(err?.message || 'Barcode not recognized. Check that this batch exists in Aayu.');
    }
  }, [onSelectBatch, onClose, stopCamera]);

  // Start camera
  const startCamera = useCallback(async () => {
    await stopCamera();
    isValidatingRef.current = false;
    setCameraStatus('requesting');
    setErrorMessage('');

    const containerId = 'aayu-qr-reader';
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
      const html5QrCode = new Html5Qrcode(containerId);
      scannerRef.current = html5QrCode;

      const qrConfig = {
        fps: 12,
        qrbox: { width: 220, height: 220 },
        aspectRatio: 1.0,
      };

      try {
        await html5QrCode.start(
          { facingMode: 'environment' },
          qrConfig,
          (text) => handleDecodedCode(text),
          () => {}
        );
      } catch (errFacing) {
        // Fallback to any camera
        const cameras = await Html5Qrcode.getCameras().catch(() => []);
        if (cameras.length > 0) {
          await html5QrCode.start(
            cameras[0].id,
            qrConfig,
            (text) => handleDecodedCode(text),
            () => {}
          );
        } else {
          throw errFacing;
        }
      }

      if (!isCancelledRef.current) {
        setCameraStatus('scanning');
      } else {
        await stopCamera();
      }
    } catch (err: any) {
      if (isCancelledRef.current) return;
      console.warn('Camera error:', err);
      const name = String(err?.name || '');
      const msg = String(err?.message || err).toLowerCase();

      if (
        name === 'NotAllowedError' ||
        name === 'PermissionDeniedError' ||
        msg.includes('permission') ||
        msg.includes('denied')
      ) {
        setCameraStatus('permission-denied');
        setErrorMessage('Camera permission denied');
      } else if (
        name === 'NotFoundError' ||
        name === 'DevicesNotFoundError' ||
        msg.includes('not found') ||
        msg.includes('no camera')
      ) {
        setCameraStatus('no-camera');
        setErrorMessage('No camera found');
      } else {
        setCameraStatus('error');
        setErrorMessage(err?.message || 'Unable to start camera stream.');
      }
    }
  }, [handleDecodedCode, stopCamera]);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    isCancelledRef.current = false;
    const timer = setTimeout(() => {
      startCamera();
    }, 150);

    return () => {
      isCancelledRef.current = true;
      clearTimeout(timer);
      stopCamera();
    };
  }, [isOpen, startCamera, stopCamera]);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = manualCode.trim();
    if (!clean) {
      setManualError('Please enter a barcode or batch ID');
      return;
    }

    setIsManualLoading(true);
    setManualError('');

    try {
      const result = await lookupBarcode(clean);
      setIsManualLoading(false);
      if (result && result.batch_id) {
        await stopCamera();
        onSelectBatch(result.batch_id);
        onClose();
      } else {
        setManualError('Barcode not recognized. Check that this batch exists in Aayu.');
      }
    } catch (err: any) {
      setIsManualLoading(false);
      setManualError(err?.message || 'Barcode not recognized. Check that this batch exists in Aayu.');
    }
  };

  const handleRescan = () => {
    isValidatingRef.current = false;
    setErrorMessage('');
    if (cameraStatus === 'permission-denied' || cameraStatus === 'no-camera' || cameraStatus === 'error') {
      startCamera();
    } else {
      setCameraStatus('scanning');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-xl bg-white border border-slate-200 rounded-[16px] shadow-2xl overflow-hidden text-slate-900 max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-800">
              <Barcode className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Cold-Chain Barcode Scanner</h3>
              <p className="text-xs text-slate-500">Scan GS1 Digital Link QR or crate barcode</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Live Camera View with Green Overlay + Laser Animation */}
          <div className="space-y-2">
            <div className="relative min-h-[250px] sm:min-h-[280px] rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden shadow-inner">
              {/* html5-qrcode target */}
              <div id="aayu-qr-reader" className="w-full h-full min-h-[250px] sm:min-h-[280px]" />

              {/* Scanning Active Overlay: Laser Line + Green Reticle */}
              {cameraStatus === 'scanning' && (
                <>
                  <div className="absolute inset-x-12 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_15px_rgba(52,211,153,0.9)] animate-laser pointer-events-none z-20" />

                  {/* Visual reticle */}
                  <div className="absolute w-52 h-52 border-2 border-emerald-500/60 rounded-2xl pointer-events-none z-10 flex items-center justify-center">
                    <div className="w-48 h-48 border border-dashed border-emerald-400/40 rounded-xl" />
                  </div>

                  <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-950/80 border border-slate-800 text-[10px] font-mono text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>LIVE CAMERA ACTIVE</span>
                  </div>
                </>
              )}

              {/* Requesting */}
              {cameraStatus === 'requesting' && (
                <div className="absolute inset-0 z-30 bg-slate-900/95 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                  <div>
                    <h4 className="text-sm font-semibold text-white">Initializing Camera</h4>
                    <p className="text-xs text-slate-400 mt-1">Requesting video permissions...</p>
                  </div>
                </div>
              )}

              {/* Validating */}
              {cameraStatus === 'validating' && (
                <div className="absolute inset-0 z-30 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                  <div>
                    <h4 className="text-sm font-semibold text-white">Looking Up Barcode</h4>
                    <p className="text-xs text-slate-400 mt-1">Querying Aayu batch registry...</p>
                  </div>
                </div>
              )}

              {/* Success */}
              {cameraStatus === 'success' && (
                <div className="absolute inset-0 z-30 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500 flex items-center justify-center text-emerald-400">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Batch Found!</h4>
                    <p className="text-xs text-slate-400 mt-1">Navigating to shelf-life analysis...</p>
                  </div>
                </div>
              )}

              {/* Permission Denied */}
              {cameraStatus === 'permission-denied' && (
                <div className="absolute inset-0 z-30 bg-slate-900/95 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="w-10 h-10 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-rose-300">Camera permission denied</h4>
                    <p className="text-xs text-slate-400 mt-1.5 max-w-xs">
                      Please allow camera access in browser permissions or enter the code manually below.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRescan}
                    className="mt-1 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Camera</span>
                  </button>
                </div>
              )}

              {/* No Camera Found */}
              {cameraStatus === 'no-camera' && (
                <div className="absolute inset-0 z-30 bg-slate-900/95 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                    <CameraOff className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-amber-300">No camera found</h4>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs">
                      No video input device detected. Use the manual input below to inspect any batch.
                    </p>
                  </div>
                </div>
              )}

              {/* Not Recognized / 404 */}
              {cameraStatus === 'not-recognized' && (
                <div className="absolute inset-0 z-30 bg-slate-900/95 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="w-10 h-10 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-rose-300">Barcode not recognized</h4>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                      Barcode not recognized. Check that this batch exists in Aayu.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRescan}
                    className="mt-1 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Scan Another Code</span>
                  </button>
                </div>
              )}

              {/* Error */}
              {cameraStatus === 'error' && (
                <div className="absolute inset-0 z-30 bg-slate-900/95 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="w-10 h-10 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                    <CameraOff className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-rose-300">Camera Unavailable</h4>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs">
                      {errorMessage || 'Unable to open camera.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRescan}
                    className="mt-1 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Try Again</span>
                  </button>
                </div>
              )}
            </div>

            {/* Sub-text below video: "Point at a GS1 barcode or QR code." */}
            <p className="text-center text-xs text-slate-500 pt-1">
              Point at a GS1 barcode or QR code.
            </p>
          </div>

          {/* "Generate demo QR" section with 3 buttons pre-set to real batches (b_0000, b_0001, b_0002) */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-slate-900" />
                Generate demo QR
              </span>
              <span className="text-[11px] text-slate-500 italic">
                For testing without a physical crate.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
              {/* Left: 3 Preset Buttons */}
              <div className="sm:col-span-7 space-y-2">
                {PRESET_BATCHES.map((preset) => (
                  <div
                    key={preset.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedDemoBatch(preset)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedDemoBatch(preset);
                      }
                    }}
                    className={`w-full p-2.5 rounded-lg text-left transition-all border flex items-center justify-between cursor-pointer ${
                      selectedDemoBatch.id === preset.id
                        ? 'bg-white border-slate-900 text-slate-900 shadow-xs'
                        : 'bg-white/60 border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-slate-900">{preset.id}</span>
                        <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.2 rounded border ${
                          preset.color === 'emerald'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : preset.color === 'rose'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : 'bg-sky-50 text-sky-700 border-sky-200'
                        }`}>
                          {preset.tag}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 block truncate mt-0.5">
                        {preset.name}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        stopCamera();
                        onSelectBatch(preset.id);
                        onClose();
                      }}
                      className="text-[11px] text-slate-900 hover:underline font-semibold shrink-0 ml-2 cursor-pointer"
                    >
                      Inspect &rarr;
                    </button>
                  </div>
                ))}
              </div>

              {/* Right: Rendered QR code for user to scan with second phone */}
              <div className="sm:col-span-5 flex flex-col items-center justify-center p-3 rounded-lg bg-white border border-slate-200 shadow-2xs">
                <div className="p-1.5 bg-white rounded">
                  <QRCodeSVG
                    value={selectedDemoBatch.gs1Url}
                    size={105}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <span className="font-mono text-[10px] text-slate-500 mt-2">
                  {selectedDemoBatch.id} QR
                </span>
              </div>
            </div>
          </div>

          {/* Fallback: "Or enter code manually" text input */}
          <form onSubmit={handleManualSubmit} className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700">
                Or enter code manually:
              </label>
              <span className="text-[11px] text-slate-400 font-mono">
                e.g. b_0001, or GS1 string
              </span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => {
                  setManualCode(e.target.value);
                  setManualError('');
                }}
                placeholder="Enter batch ID or scanned string..."
                className="flex-1 bg-white border border-slate-200 text-xs text-slate-900 rounded-lg px-3 py-2.5 placeholder-slate-400 focus:outline-none focus:border-slate-400 font-mono shadow-2xs"
              />
              <button
                type="submit"
                disabled={isManualLoading}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs"
              >
                {isManualLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <span>Submit</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>

            {manualError && (
              <p className="text-xs text-rose-600 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{manualError}</span>
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};
