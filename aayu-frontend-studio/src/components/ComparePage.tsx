import React, { useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  fetchBatches,
  fetchBatch,
  fetchTelemetry,
  deriveBatchMilestones,
  API
} from '../services/api';
import { BatchTelemetryChart } from './BatchTelemetryChart';
import {
  Scale,
  Sparkles,
  ArrowLeft,
  Activity,
  Eye,
  Clock,
  Bot,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  Package
} from 'lucide-react';
import { BatchDetail, TelemetryPoint, BatchAssessment } from '../types';

export const ComparePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Read batches a & b from search params, default to b_0000 and b_0001
  const batchIdA = (searchParams.get('a') || 'b_0000').toLowerCase();
  const batchIdB = (searchParams.get('b') || 'b_0001').toLowerCase();

  // 1. Fetch batch catalog for select boxes
  const { data: allBatches = [] } = useQuery({
    queryKey: ['batches'],
    queryFn: fetchBatches,
    staleTime: 1000 * 60 * 5,
  });

  // 2. Fetch Left Batch (A) data
  const { data: batchA } = useQuery({
    queryKey: ['batch', batchIdA],
    queryFn: () => fetchBatch(batchIdA),
    staleTime: 1000 * 60 * 10,
  });

  const { data: telemetryA = [] } = useQuery({
    queryKey: ['telemetry', batchIdA],
    queryFn: () => fetchTelemetry(batchIdA),
    staleTime: 1000 * 60 * 10,
  });

  const {
    data: assessmentA,
    isLoading: loadingAssessmentA,
    isError: isAssessmentErrorA,
    error: errorA,
    refetch: refetchAssessmentA
  } = useQuery({
    queryKey: ['assessment', batchIdA],
    queryFn: async () => {
      const r = await fetch(`${API}/batches/${batchIdA}/assessment`, { method: 'POST' });
      if (!r.ok) throw new Error(`assessment ${r.status}`);
      const json = await r.json();
      console.log('assessment for', batchIdA, json);
      return json;
    },
    staleTime: Infinity,
  });

  // 3. Fetch Right Batch (B) data
  const { data: batchB } = useQuery({
    queryKey: ['batch', batchIdB],
    queryFn: () => fetchBatch(batchIdB),
    staleTime: 1000 * 60 * 10,
  });

  const { data: telemetryB = [] } = useQuery({
    queryKey: ['telemetry', batchIdB],
    queryFn: () => fetchTelemetry(batchIdB),
    staleTime: 1000 * 60 * 10,
  });

  const {
    data: assessmentB,
    isLoading: loadingAssessmentB,
    isError: isAssessmentErrorB,
    error: errorB,
    refetch: refetchAssessmentB
  } = useQuery({
    queryKey: ['assessment', batchIdB],
    queryFn: async () => {
      const r = await fetch(`${API}/batches/${batchIdB}/assessment`, { method: 'POST' });
      if (!r.ok) throw new Error(`assessment ${r.status}`);
      const json = await r.json();
      console.log('assessment for', batchIdB, json);
      return json;
    },
    staleTime: Infinity,
  });

  const selectedProductType = batchA?.product_type || batchB?.product_type;
  const filteredBatches = selectedProductType
    ? allBatches.filter((b) => b.product_type === selectedProductType)
    : allBatches;

  // Unique categories from catalog for dedicated category switching
  const categories = useMemo(() => {
    const map = new Map<string, string>();
    allBatches.forEach((b) => {
      if (b.product_type && !map.has(b.product_type)) {
        const formatted = (b.display_name || b.product_type).replace(/_/g, ' ');
        map.set(b.product_type, formatted);
      }
    });
    return Array.from(map.entries()).map(([type, label]) => ({ type, label }));
  }, [allBatches]);

  const handleSelectCategory = (categoryType: string) => {
    const batchesInCat = allBatches.filter((b) => b.product_type === categoryType);
    if (batchesInCat.length >= 2) {
      setSearchParams({ a: batchesInCat[0].batch_id, b: batchesInCat[1].batch_id });
    } else if (batchesInCat.length === 1) {
      setSearchParams({ a: batchesInCat[0].batch_id, b: batchesInCat[0].batch_id });
    }
  };

  // Handle select change
  const handleSelectA = (newId: string) => {
    const newBatch = allBatches.find((b) => b.batch_id === newId);
    if (newBatch && batchB && newBatch.product_type !== batchB.product_type) {
      // Pick another batch in the same new category, prefer a different batch_id
      const sameCategory = allBatches.filter(
        (b) => b.product_type === newBatch.product_type && b.batch_id !== newId
      );
      const newBId = sameCategory[0]?.batch_id || newId;
      setSearchParams({ a: newId, b: newBId });
    } else {
      setSearchParams({ a: newId, b: batchIdB });
    }
  };

  const handleSelectB = (newId: string) => {
    const newBatch = allBatches.find((b) => b.batch_id === newId);
    if (newBatch && batchA && newBatch.product_type !== batchA.product_type) {
      // Pick another batch in the same new category, prefer a different batch_id
      const sameCategory = allBatches.filter(
        (b) => b.product_type === newBatch.product_type && b.batch_id !== newId
      );
      const newAId = sameCategory[0]?.batch_id || newId;
      setSearchParams({ a: newAId, b: newId });
    } else {
      setSearchParams({ a: batchIdA, b: newId });
    }
  };

  // Shared Y-axis calculation: compute min/max across both series
  const sharedYDomain = useMemo<[number, number]>(() => {
    const tempsA = telemetryA.map((t) => t.temp_c);
    const tempsB = telemetryB.map((t) => t.temp_c);
    const allTemps = [...tempsA, ...tempsB];

    if (allTemps.length === 0) return [-2, 12];

    const maxThreshold = Math.max(batchA?.temp_max_c ?? 4, batchB?.temp_max_c ?? 4);
    const minVal = Math.min(...allTemps, 0);
    const maxVal = Math.max(...allTemps, maxThreshold + 1);

    const pad = 1.5;
    return [Math.floor(minVal - pad), Math.ceil(maxVal + pad)];
  }, [telemetryA, telemetryB, batchA, batchB]);

  // Derive markers
  const markersA = useMemo(() => {
    return batchA ? deriveBatchMilestones(batchA, telemetryA) : [];
  }, [batchA, telemetryA]);

  const markersB = useMemo(() => {
    return batchB ? deriveBatchMilestones(batchB, telemetryB) : [];
  }, [batchB, telemetryB]);

  // Action pill styling
  const getPillMeta = (action?: string) => {
    const act = (action || '').toLowerCase();
    if (act.includes('normally') || act.includes('sell')) {
      return {
        bg: '#22c55e',
        textColor: '#ffffff',
        label: action || 'Sell Normally',
      };
    }
    if (act.includes('prioritize')) {
      return {
        bg: '#f59e0b',
        textColor: '#ffffff',
        label: action || 'Prioritize Sale',
      };
    }
    if (act.includes('discount')) {
      return {
        bg: '#f97316',
        textColor: '#ffffff',
        label: action || 'Discount',
      };
    }
    if (act.includes('inspect')) {
      return {
        bg: '#ef4444',
        textColor: '#ffffff',
        label: action || 'Inspect',
      };
    }
    if (act.includes('quarantine')) {
      return {
        bg: '#7f1d1d',
        textColor: '#ffffff',
        label: action || 'Quarantine',
      };
    }
    return {
      bg: '#0f172a',
      textColor: '#ffffff',
      label: action || 'Evaluating',
    };
  };

  const pillA = getPillMeta(assessmentA?.decision?.recommended_action);
  const pillB = getPillMeta(assessmentB?.decision?.recommended_action);

  // Column Renderer
  const renderBatchColumn = (
    batchId: string,
    batch: BatchDetail | undefined,
    telemetry: TelemetryPoint[],
    assessment: BatchAssessment | undefined,
    isLoadingAssessment: boolean,
    isAssessmentError: boolean,
    onRetryAssessment: () => void,
    pill: { bg: string; textColor: string; label: string },
    markers: any[],
    selectedVal: string,
    onSelectChange: (id: string) => void
  ) => {
    // 1. printedRemaining = batch.nominal_shelf_life_hours - batch.age_hours_at_retail
    const nominalHours = batch?.nominal_shelf_life_hours ?? null;
    const ageHours = batch?.age_hours_at_retail ?? null;
    const printedRemaining = (nominalHours != null && ageHours != null) ? nominalHours - ageHours : null;
    const printedDays = printedRemaining != null ? (printedRemaining / 24).toFixed(1) : '—';

    const sla = assessment?.shelf_life_analysis;
    const aayuHours = sla?.predicted_remaining_hours;
    const rawAayuHours = sla?.predicted_raw ?? sla?.predicted_remaining_hours;
    const modelSource = sla?.source;
    const modelConfidence = sla?.confidence;
    const intervalLow = sla?.predicted_interval_low;
    const intervalHigh = sla?.predicted_interval_high;
    const aayuDays = aayuHours != null ? (aayuHours / 24).toFixed(1) : '—';
    const deltaHours = (aayuHours != null && printedRemaining != null) ? aayuHours - printedRemaining : null;
    const clampFired = (sla?.predicted_raw != null && printedRemaining != null
      && sla.predicted_raw > printedRemaining + 0.5);
    const isAayuExceedingNominal = (rawAayuHours != null && nominalHours != null
      && nominalHours > 0 && rawAayuHours > nominalHours);

    const getDeltaColor = (predicted: number | null | undefined, printed: number | null | undefined) => {
      if (predicted == null || printed == null || printed <= 0) return 'text-slate-500';
      const ratio = predicted / printed;
      if (ratio >= 1.0) return 'text-emerald-600';
      if (ratio >= 0.9) return 'text-slate-500';
      if (ratio >= 0.6) return 'text-amber-600';
      if (ratio >= 0.3) return 'text-orange-600';
      return 'text-rose-600';
    };

    return (
      <div className="space-y-6 bg-white border border-slate-200 rounded-[12px] p-6 shadow-xs">
        {/* Selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
            Select Batch
          </label>
          <select
            value={selectedVal}
            onChange={(e) => onSelectChange(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 text-xs text-slate-900 rounded-lg px-3.5 py-2.5 font-mono focus:outline-none focus:border-slate-400 focus:bg-white transition-colors"
          >
            {filteredBatches.length > 0 ? (
              filteredBatches.map((b) => (
                <option key={b.batch_id} value={b.batch_id}>
                  {b.batch_id} — {b.display_name || b.product_type} ({b.brand_name || 'Amul'})
                </option>
              ))
            ) : (
              <>
                <option value="b_0000">b_0000 — Pasteurized Milk (Amul Dairy)</option>
                <option value="b_0001">b_0001 — Pasteurized Milk (Amul Dairy)</option>
                <option value="b_0002">b_0002 — Set Yogurt (Mother Dairy)</option>
              </>
            )}
          </select>
        </div>

        {/* Batch Identity strip */}
        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {batch?.display_name || (batch?.product_type ? `${batch.product_type} 1L` : batchId)}
            </h3>
            <p className="text-xs text-slate-600 font-medium">{batch?.brand_name || 'Amul Dairy Co.'}</p>
            <p className="text-[11px] font-mono text-slate-400 mt-1">
              Lot: {batch?.lot_number || `LOT-${batchId}`} • Safe: &le; {batch?.temp_max_c ?? 4}°C
            </p>
          </div>
          <button
            onClick={() => navigate(`/batches/${batchId}`)}
            className="text-xs text-slate-900 hover:underline font-semibold shrink-0 ml-2 cursor-pointer"
          >
            Full detail &rarr;
          </button>
        </div>

        {/* Recommendation Pill */}
        {isLoadingAssessment ? (
          <div className="p-6 rounded-lg bg-slate-50 border border-slate-200 text-center space-y-4 animate-pulse">
            <div className="h-12 w-44 bg-slate-200 rounded-full mx-auto" />
            <div className="h-4 w-3/4 bg-slate-200 rounded mx-auto" />
          </div>
        ) : isAssessmentError || !assessment ? (
          <div className="p-6 rounded-lg bg-rose-50/60 border border-rose-200 text-center space-y-3">
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 mx-auto flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="text-xs text-rose-800 font-medium">AI assessment unavailable — retry</div>
            <button
              onClick={onRetryAssessment}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" /> Retry assessment
            </button>
          </div>
        ) : (
          <div className="p-6 rounded-lg bg-slate-50 border border-slate-200 text-center space-y-4">
            <div className="flex justify-center">
              <div
                className="inline-flex items-center justify-center font-bold tracking-wide rounded-full shadow-xs text-sm sm:text-base"
                style={{
                  backgroundColor: pill.bg,
                  color: pill.textColor,
                  padding: '12px 28px',
                }}
              >
                {assessment.decision.recommended_action}
              </div>
            </div>

            <h4 className="text-sm sm:text-base font-medium text-slate-900 min-h-[48px] flex items-center justify-center">
              {assessment.decision.headline}
            </h4>

            <div className="text-[11px] text-slate-500">
              Confidence: <strong className="text-slate-800 capitalize">{assessment.decision.confidence}</strong>
            </div>
          </div>
        )}

        {/* Numeric Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
              Printed expiry
            </span>
            <div className="text-base sm:text-lg font-bold font-mono text-slate-800 mt-1">
              {printedRemaining != null ? `${printedRemaining.toFixed(1)}h (${printedDays} days)` : '—'}
            </div>
            <span className="text-[10px] text-slate-400 block mt-1">Label default</span>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                Aayu estimate
              </span>
              {deltaHours !== null && (
                <span className={`text-xs font-mono font-bold ${getDeltaColor(aayuHours, printedRemaining)}`}>
                  {(() => {
                    const ratio = printedRemaining && printedRemaining > 0
                      ? (aayuHours ?? 0) / printedRemaining : 1;
                    if (Math.abs(deltaHours) < 0.5) return '≈ printed';
                    if (ratio >= 0.9) return `${deltaHours >= 0 ? '+' : ''}${deltaHours.toFixed(1)}h`;
                    return `${deltaHours >= 0 ? '+' : ''}${deltaHours.toFixed(1)}h (${(ratio * 100).toFixed(0)}%)`;
                  })()}
                </span>
              )}
            </div>

            {isLoadingAssessment ? (
              <div className="h-6 w-24 bg-slate-200 rounded animate-pulse mt-1" />
            ) : aayuHours == null ? (
              <div className="mt-1 space-y-1">
                <div className="text-base sm:text-lg font-bold font-mono text-slate-400">
                  —
                </div>
                {isAssessmentError && (
                  <button
                    onClick={onRetryAssessment}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded text-[10px] font-medium transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-2.5 h-2.5" /> Retry
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="text-base sm:text-lg font-bold font-mono text-slate-900">
                  {aayuHours.toFixed(1)}h ({aayuDays} days)
                </div>
                {isAayuExceedingNominal && (
                  <div
                    className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 text-[9px] font-semibold flex items-center gap-1 shrink-0"
                    title={`Data integrity issue: Raw Aayu estimate (${rawAayuHours?.toFixed(1)}h) exceeds nominal shelf life (${nominalHours}h)`}
                  >
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                    <span>&gt; Nominal</span>
                  </div>
                )}
              </div>
            )}

            {aayuHours != null && intervalLow != null && intervalHigh != null && (
              <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                80% interval: {intervalLow.toFixed(0)}h – {intervalHigh.toFixed(0)}h
              </div>
            )}

            {(modelSource || modelConfidence) && aayuHours != null && (
              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                {modelSource === 'bqml_direct' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                    <span className="h-1 w-1 rounded-full bg-emerald-500" />
                    Direct model
                  </span>
                )}
                {modelSource && modelSource !== 'bqml_direct' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-500/20">
                    Agent
                  </span>
                )}
                {modelConfidence && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1 ring-inset ${
                    modelConfidence === 'high' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
                      : modelConfidence === 'medium' ? 'bg-amber-50 text-amber-700 ring-amber-600/20'
                      : 'bg-rose-50 text-rose-700 ring-rose-600/20'
                  }`}>
                    <span className={`h-1 w-1 rounded-full ${
                      modelConfidence === 'high' ? 'bg-emerald-500'
                        : modelConfidence === 'medium' ? 'bg-amber-500' : 'bg-rose-500'
                    }`} />
                    {modelConfidence.charAt(0).toUpperCase() + modelConfidence.slice(1)}
                  </span>
                )}
              </div>
            )}

            <span className="text-[10px] text-slate-400 block mt-1">
              BQML linear regression (MAE 9.24h)
            </span>

            {clampFired && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] text-amber-900 flex items-start gap-1">
                <AlertTriangle className="w-2.5 h-2.5 text-amber-600 mt-0.5 shrink-0" />
                <span>
                  <span className="font-semibold">Clamped:</span> raw {sla?.predicted_raw?.toFixed(1)}h &gt; printed {printedRemaining?.toFixed(1)}h
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Shared Y-axis Temperature Journey Chart */}
        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-900 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-sky-600" />
              Telemetry Journey
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              Shared Y-axis: {sharedYDomain[0]}°C to {sharedYDomain[1]}°C
            </span>
          </div>

          <BatchTelemetryChart
            telemetry={telemetry}
            tempMaxC={batch?.temp_max_c ?? 4}
            markers={markers}
            height={220}
            syncId="compare-telemetry"
            yDomain={sharedYDomain}
          />
        </div>

        {/* Key AI Trace highlight */}
        {assessment && (
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs">
            <div className="flex items-center gap-1.5 text-slate-800 font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-slate-700" />
              <span>Exposure Analyst Narrative</span>
            </div>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              {assessment.exposure_summary.narrative}
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
      {/* Back button */}
      <div>
        <button
          onClick={() => navigate('/batches')}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to batch portfolio</span>
        </button>
      </div>

      {/* Header: "Same product. Different journeys." */}
      <div className="text-center space-y-3 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-800 text-xs font-medium">
          <Scale className="w-3.5 h-3.5" />
          <span>Comparative Analysis</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
          Same product. Different journeys.
        </h1>
        <p className="text-xs sm:text-sm text-slate-500">
          Compare two batches of the same product type. Aayu shows how transit excursions and
          storage abuse diverge true shelf life — an apples-to-apples check on cold-chain
          handling, not a mismatched product review.
        </p>

        {/* Category selector capsule */}
        {categories.length > 0 && (
          <div className="pt-2 flex items-center justify-center">
            <div className="inline-flex items-center gap-2.5 bg-white border border-slate-200 rounded-full px-4 py-1.5 shadow-xs hover:border-slate-300 transition-colors">
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500 shrink-0">
                <Package className="w-3.5 h-3.5 text-slate-400" />
                Category
              </span>
              <div className="h-3.5 w-px bg-slate-200" />
              <div className="relative flex items-center">
                <select
                  id="category-select"
                  value={selectedProductType || ''}
                  onChange={(e) => handleSelectCategory(e.target.value)}
                  className="appearance-none bg-transparent hover:text-slate-900 text-slate-900 text-xs font-semibold pr-6 py-1 cursor-pointer focus:outline-none capitalize"
                  aria-label="Select Product Category"
                >
                  {categories.map((cat) => (
                    <option key={cat.type} value={cat.type} className="text-slate-800 font-normal">
                      {cat.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-0 pointer-events-none" />
              </div>
              <span className="text-[11px] font-mono text-slate-400 border-l border-slate-200 pl-2.5">
                {filteredBatches.length} {filteredBatches.length === 1 ? 'batch' : 'batches'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* "Both clean" callout — surfaces the case where neither batch shows meaningful damage */}
      {(() => {
        const cleanFor = (batch: BatchDetail | undefined, assessment: BatchAssessment | undefined) => {
          const nominal = batch?.nominal_shelf_life_hours ?? null;
          const age = batch?.age_hours_at_retail ?? null;
          const printed = (nominal != null && age != null) ? nominal - age : null;
          const aayu = assessment?.shelf_life_analysis?.predicted_remaining_hours;
          return printed != null && aayu != null && Math.abs(aayu - printed) < 2;
        };
        const bothClean = cleanFor(batchA, assessmentA) && cleanFor(batchB, assessmentB);
        if (!bothClean) return null;
        return (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold text-slate-900">Both batches are clean.</span>{' '}
              Aayu detects no meaningful cold-chain damage on either. Recommendation: sell in receipt order (FIFO).
            </div>
          </div>
        );
      })()}

      {/* Two columns, mirrored layout of the batch detail page */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {renderBatchColumn(
          batchIdA,
          batchA,
          telemetryA,
          assessmentA,
          loadingAssessmentA,
          isAssessmentErrorA,
          () => refetchAssessmentA(),
          pillA,
          markersA,
          batchIdA,
          handleSelectA
        )}

        {renderBatchColumn(
          batchIdB,
          batchB,
          telemetryB,
          assessmentB,
          loadingAssessmentB,
          isAssessmentErrorB,
          () => refetchAssessmentB(),
          pillB,
          markersB,
          batchIdB,
          handleSelectB
        )}
      </div>
    </div>
  );
};
