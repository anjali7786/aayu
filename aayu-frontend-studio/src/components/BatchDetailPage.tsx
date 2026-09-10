import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import {
  fetchBatch,
  fetchTelemetry,
  deriveBatchMilestones,
  API
} from '../services/api';
import { BatchTelemetryChart } from './BatchTelemetryChart';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Sparkles,
  AlertTriangle,
  Clock,
  Eye,
  Bot,
  Activity,
  RefreshCw
} from 'lucide-react';

const STATUS_ROTATION_MESSAGES = [
  'Exposure Analyst reviewing telemetry...',
  'Shelf-Life Analyst predicting...',
  'Decision Agent finalizing recommendation.',
];

export const BatchDetailPage: React.FC = () => {
  const { batch_id: rawBatchId } = useParams<{ batch_id: string }>();
  const batchId = (rawBatchId || 'b_0000').toLowerCase();
  const navigate = useNavigate();

  // Collapsed by default for AI Reasoning Trace
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  // Rotating loading status text index
  const [statusMsgIndex, setStatusMsgIndex] = useState(0);

  // 1. Parallel Fetch: Batch Details
  const {
    data: batch,
    isLoading: loadingBatch,
    error: batchError
  } = useQuery({
    queryKey: ['batch', batchId],
    queryFn: () => fetchBatch(batchId),
    staleTime: 1000 * 60 * 10,
  });

  // 2. Parallel Fetch: Telemetry Series
  const {
    data: telemetry = [],
    isLoading: loadingTelemetry
  } = useQuery({
    queryKey: ['telemetry', batchId],
    queryFn: () => fetchTelemetry(batchId),
    staleTime: 1000 * 60 * 10,
  });

  // 3. Parallel Fetch: Assessment
  const {
    data: assessment,
    isLoading: loadingAssessment,
    isFetching: isFetchingAssessment,
    isError: isAssessmentError,
    error: assessmentError,
    refetch: refetchAssessment
  } = useQuery({
    queryKey: ['assessment', batchId],
    queryFn: async () => {
      const r = await fetch(`${API}/batches/${batchId}/assessment`, { method: 'POST' });
      if (!r.ok) throw new Error(`assessment ${r.status}`);
      const json = await r.json();
      console.log('assessment for', batchId, json);
      return json;
    },
    staleTime: Infinity,
  });

  // Smooth rotation of loading status text every ~3.5 seconds
  useEffect(() => {
    if (!loadingAssessment && !isFetchingAssessment) return;
    const interval = setInterval(() => {
      setStatusMsgIndex((prev) => (prev + 1) % STATUS_ROTATION_MESSAGES.length);
    }, 3500);
    return () => clearInterval(interval);
  }, [loadingAssessment, isFetchingAssessment]);

  // Derive milestones for chart
  const markers = useMemo(() => {
    return batch ? deriveBatchMilestones(batch, telemetry) : [];
  }, [batch, telemetry]);

  // Product Display Name and Brand
  const formatProductName = (type?: string, displayName?: string) => {
    if (displayName) return displayName;
    if (!type) return 'Batch Overview';
    return type
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  };

  const displayName = batch?.display_name || (batch?.product_type ? `${formatProductName(batch.product_type)} 1L` : batchId);
  const brandName = batch?.brand_name || 'Amul Dairy Co.';
  const gtin = batch?.gtin || '08901030855432';
  const lotNumber = batch?.lot_number || `L${batchId.replace('b_', '2608')}`;
  const gs1Link = batch?.gs1_digital_link || `https://aayu.app/01/${gtin}/10/${lotNumber}/17/260815`;

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
      label: action || 'Review Batch',
    };
  };

  // Shelf-Life Math
  // 1. printedRemainingHours = batch.nominal_shelf_life_hours - batch.age_hours_at_retail
  const nominalHours = batch?.nominal_shelf_life_hours ?? null;
  const ageHoursAtRetail = batch?.age_hours_at_retail ?? null;
  const printedRemainingHours = (nominalHours != null && ageHoursAtRetail != null) ? nominalHours - ageHoursAtRetail : null;
  const printedDays = printedRemainingHours != null ? (printedRemainingHours / 24).toFixed(1) : '—';

  // Backend already clamps predicted_remaining_hours ≤ printed. Read directly.
  const sla = assessment?.shelf_life_analysis;
  const aayuRemainingHours = sla?.predicted_remaining_hours;
  const rawAayuHours = sla?.predicted_raw ?? sla?.predicted_remaining_hours;
  const modelSource = sla?.source;
  const modelConfidence = sla?.confidence;
  const intervalLow = sla?.predicted_interval_low;
  const intervalHigh = sla?.predicted_interval_high;
  const intervalPct = sla?.prediction_interval_pct;
  const aayuDays = aayuRemainingHours != null ? (aayuRemainingHours / 24).toFixed(1) : '—';
  const deltaHours = (aayuRemainingHours != null && printedRemainingHours != null)
    ? aayuRemainingHours - printedRemainingHours
    : null;
  const clampFired = (sla?.predicted_raw != null && printedRemainingHours != null
    && sla.predicted_raw > printedRemainingHours + 0.5);
  const isAayuExceedingNominal = (rawAayuHours != null && nominalHours != null
    && nominalHours > 0 && rawAayuHours > nominalHours);

  // Color reflects health_ratio = predicted / printed — same signal that drives
  // the decision pill. A negative delta of -1h on a 200h batch is trivial (99%
  // healthy → slate), while a -30h delta on a 60h batch is severe (50% healthy →
  // orange). Absolute hours alone cannot express that.
  const getDeltaColor = (predicted: number | null | undefined, printed: number | null | undefined) => {
    if (predicted == null || printed == null || printed <= 0) return 'text-slate-500';
    const ratio = predicted / printed;
    if (ratio >= 1.0) return 'text-[#22c55e]';    // green — Aayu meets/beats label
    if (ratio >= 0.9) return 'text-slate-500';    // neutral — within model MAE
    if (ratio >= 0.6) return 'text-[#f59e0b]';    // amber — moderate wear
    if (ratio >= 0.3) return 'text-[#f97316]';    // orange — significant damage
    return 'text-[#ef4444]';                       // red — effectively spoiled
  };

  const pctNominal = assessment?.shelf_life_analysis?.pct_of_nominal;

  // Error handling if batch doesn't exist
  if (batchError) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Batch Not Found</h2>
        <p className="text-sm text-slate-500">
          Batch &ldquo;{batchId}&rdquo; was not found in the cold-chain catalog.
        </p>
        <button
          onClick={() => navigate('/batches')}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium transition-colors shadow-2xs cursor-pointer"
        >
          Back to Batch Portfolio
        </button>
      </div>
    );
  }

  const pill = getPillMeta(assessment?.decision?.recommended_action);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
      {/* Back button link */}
      <div>
        <Link
          to="/batches"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to batch portfolio</span>
        </Link>
      </div>

      {/* a. IDENTITY STRIP (always shown first, fastest fetch) */}
      <div className="p-6 sm:p-7 rounded-[12px] bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        {/* Left: batch display name (big), brand name (smaller), GTIN + lot on one line (small, monospace) */}
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              {displayName}
            </h1>
            <span className="font-mono text-xs px-2.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-semibold">
              {batchId}
            </span>
          </div>

          <div className="text-sm text-slate-600 font-medium">
            {brandName}
          </div>

          <div className="text-xs font-mono text-slate-500 pt-1 flex items-center gap-3">
            <span>GTIN: {gtin}</span>
            <span className="text-slate-300">•</span>
            <span>Lot: {lotNumber}</span>
          </div>
        </div>

        {/* Right: small rendered GS1 QR code */}
        <div className="shrink-0 flex items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200 self-start sm:self-center">
          <div className="p-1.5 bg-white rounded shadow-2xs">
            <QRCodeSVG
              value={gs1Link}
              size={64}
              level="M"
              includeMargin={false}
            />
          </div>
          <div className="text-[11px] text-slate-500 font-mono space-y-0.5">
            <div className="text-slate-900 font-semibold">GS1 Digital Link</div>
            <div className="text-[10px] text-slate-400">Scan to verify</div>
          </div>
        </div>
      </div>

      {/* b. RECOMMENDATION HERO (shown once assessment loads, error state with retry, or skeleton with rotating text) */}
      {loadingAssessment || isFetchingAssessment ? (
        <div className="p-8 sm:p-12 rounded-[12px] bg-white border border-slate-200 text-center space-y-6 shadow-xs animate-pulse">
          {/* Skeleton Pill */}
          <div className="mx-auto w-52 h-14 bg-slate-100 rounded-full"></div>

          {/* Skeleton Headline */}
          <div className="max-w-xl mx-auto space-y-2.5">
            <div className="h-6 w-full bg-slate-100 rounded"></div>
            <div className="h-6 w-3/4 mx-auto bg-slate-100 rounded"></div>
          </div>

          {/* Proper skeleton copy + rotating status text every ~3.5s */}
          <div className="pt-4 border-t border-slate-100 max-w-md mx-auto space-y-2">
            <p className="text-xs text-slate-500">
              Running 3-agent analysis via Vertex AI… typically 15-30 seconds.
            </p>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 text-slate-700 text-xs font-mono border border-slate-200">
              <span className="w-2 h-2 rounded-full bg-slate-900 animate-ping" />
              <span>{STATUS_ROTATION_MESSAGES[statusMsgIndex]}</span>
            </div>
          </div>
        </div>
      ) : isAssessmentError || !assessment ? (
        <div className="p-8 sm:p-10 rounded-[12px] bg-white border border-rose-200 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-900">AI assessment unavailable</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Could not retrieve the intelligence assessment for batch {batchId}. The evaluation backend encountered an error or timeout.
            </p>
          </div>
          <button
            onClick={() => refetchAssessment()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>AI assessment unavailable — retry</span>
          </button>
        </div>
      ) : (
        <div className="p-8 sm:p-12 rounded-[12px] bg-white border border-slate-200 text-center space-y-6 shadow-xs">
          {/* Recommended action as colored pill */}
          <div className="flex justify-center">
            <div
              className="inline-flex items-center justify-center font-bold tracking-wide rounded-full shadow-sm"
              style={{
                backgroundColor: pill.bg,
                color: pill.textColor,
                padding: '16px 32px',
                fontSize: '20px',
              }}
            >
              {assessment.decision.recommended_action}
            </div>
          </div>

          {/* Below pill: decision.headline sentence */}
          <h2 className="text-[24px] font-medium text-slate-900 leading-relaxed max-w-3xl mx-auto">
            {assessment.decision.headline}
          </h2>

          {/* Small caption */}
          <div className="text-xs text-slate-500 font-normal">
            Confidence: <strong className="text-slate-800 capitalize">{assessment.decision.confidence}</strong>
            {' • '}
            Analysed by Vertex AI at {new Date(assessment.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            {assessment.cache_hit === true && ' · cached'}
          </div>
        </div>
      )}

      {/* c. TWO NUMERIC CARDS (side-by-side) */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Printed expiry (remaining) */}
          <div className="p-6 rounded-[12px] bg-white border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Printed expiry (remaining)
              </span>
              <div className="text-3xl sm:text-4xl font-bold font-mono text-slate-900 py-1">
                {printedRemainingHours != null ? `${printedRemainingHours.toFixed(1)}h (${printedDays} days)` : '—'}
              </div>
            </div>
            <p className="text-xs text-slate-400 pt-3 border-t border-slate-100">
              Based on the label alone.
            </p>
          </div>

          {/* Card 2: Aayu estimate */}
          <div className="p-6 rounded-[12px] bg-white border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Aayu estimate
                </span>
                {deltaHours !== null && (
                  <span className={`text-xs font-mono font-bold ${getDeltaColor(aayuRemainingHours, printedRemainingHours)}`}>
                    {(() => {
                      const ratio = printedRemainingHours && printedRemainingHours > 0
                        ? (aayuRemainingHours ?? 0) / printedRemainingHours : 1;
                      if (Math.abs(deltaHours) < 0.5) return '≈ printed';
                      if (ratio >= 0.9) return `${deltaHours >= 0 ? '+' : ''}${deltaHours.toFixed(1)}h · within tolerance`;
                      return `${deltaHours >= 0 ? '+' : ''}${deltaHours.toFixed(1)}h (${(ratio * 100).toFixed(0)}% healthy)`;
                    })()}
                  </span>
                )}
              </div>

              {loadingAssessment || isFetchingAssessment ? (
                <div className="py-2">
                  <div className="h-9 w-40 bg-slate-100 animate-pulse rounded my-1" />
                </div>
              ) : aayuRemainingHours == null ? (
                <div className="py-2 space-y-2">
                  <div className="text-3xl sm:text-4xl font-bold font-mono text-slate-400">
                    —
                  </div>
                  {assessmentError && (
                    <button
                      onClick={() => refetchAssessment()}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" /> Retry assessment
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2.5 py-1">
                  <div className="text-3xl sm:text-4xl font-bold font-mono text-slate-900">
                    {aayuRemainingHours.toFixed(1)}h ({aayuDays} days)
                  </div>
                  {isAayuExceedingNominal && (
                    <div
                      className="px-2 py-1 rounded bg-amber-50 text-amber-800 border border-amber-300 text-[10px] font-semibold flex items-center gap-1 shrink-0"
                      title={`Data integrity issue: Raw Aayu estimate (${rawAayuHours?.toFixed(1)}h) exceeds nominal shelf life (${nominalHours}h)`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>&gt; Nominal life</span>
                    </div>
                  )}
                </div>
              )}

              {/* 80% prediction interval */}
              {aayuRemainingHours != null && intervalLow != null && intervalHigh != null && (
                <div className="text-xs font-mono text-slate-500 mt-1.5">
                  <span className="font-semibold text-slate-600">{intervalPct ?? 80}% interval:</span>{' '}
                  {intervalLow.toFixed(1)}h – {intervalHigh.toFixed(1)}h
                </div>
              )}

              {/* Trust chips */}
              {(modelSource || modelConfidence) && aayuRemainingHours != null && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {modelSource === 'bqml_direct' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Direct model output
                    </span>
                  )}
                  {modelSource && modelSource !== 'bqml_direct' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-500/20">
                      Agent-mediated
                    </span>
                  )}
                  {modelConfidence && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
                      modelConfidence === 'high' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
                        : modelConfidence === 'medium' ? 'bg-amber-50 text-amber-700 ring-amber-600/20'
                        : 'bg-rose-50 text-rose-700 ring-rose-600/20'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        modelConfidence === 'high' ? 'bg-emerald-500'
                          : modelConfidence === 'medium' ? 'bg-amber-500' : 'bg-rose-500'
                      }`} />
                      {modelConfidence.charAt(0).toUpperCase() + modelConfidence.slice(1)} confidence
                    </span>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400 pt-3 border-t border-slate-100">
              BQML linear regression (MAE 9.24h). 80% interval calibrated from residuals.
            </p>
          </div>
        </div>

        {/* Below both cards: "{pct_of_nominal}% of nominal shelf life remaining." */}
        {pctNominal !== undefined && (
          <div className="text-center py-2.5 px-4 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 font-mono shadow-2xs">
            <strong className="text-slate-900 font-semibold">{pctNominal.toFixed(1)}%</strong> of nominal shelf life remaining.
          </div>
        )}

        {clampFired && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold">Integrity note:</span>{' '}
              Raw model predicted {sla?.predicted_raw?.toFixed(1)}h — exceeded printed expiry ({printedRemainingHours?.toFixed(1)}h).
              Display clamped to printed expiry (product invariant: Aayu never claims more life than the label).
            </div>
          </div>
        )}
      </div>

      {/* d. TEMPERATURE JOURNEY CHART (Recharts line chart, Height: 400px) */}
      <div className="p-6 sm:p-8 rounded-[12px] bg-white border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-sky-600" />
              <h3 className="text-base font-semibold text-slate-900">Temperature Journey</h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Continuous 15-minute sensor log through cold-chain transit, depot, and retail dock check-in.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5 text-slate-600">
              <span className="w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500/40 inline-block"></span>
              <span>Safe zone (0 to {batch?.temp_max_c ?? 4}°C)</span>
            </div>
            <div className="flex items-center gap-1.5 text-rose-600">
              <span className="w-3 h-0.5 border-t border-dashed border-rose-500 inline-block"></span>
              <span>Safety threshold</span>
            </div>
          </div>
        </div>

        {/* Chart Component: Height: 400px */}
        <div className="pt-2">
          <BatchTelemetryChart
            telemetry={telemetry}
            tempMaxC={batch?.temp_max_c ?? 4.0}
            markers={markers}
            height={400}
          />
        </div>
      </div>

      {/* e. AI REASONING TRACE (collapsed by default, expandable) */}
      <div className="rounded-[12px] bg-white border border-slate-200 shadow-xs overflow-hidden">
        <button
          type="button"
          onClick={() => setReasoningExpanded(!reasoningExpanded)}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-800">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">AI reasoning trace</h3>
              <p className="text-xs text-slate-500">Three-agent exposure, shelf-life, and decision synthesis</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>{reasoningExpanded ? 'Hide trace' : 'Show trace'}</span>
            {reasoningExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {reasoningExpanded && (
          <div className="px-6 pb-6 pt-2 border-t border-slate-100 space-y-4">
            {assessment ? (
              <>
                {/* 1. Exposure Analyst Card */}
                <div className="p-5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-md bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold border border-sky-200">
                      <Eye className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Exposure Analyst
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed">
                    {assessment.exposure_summary.narrative}
                  </p>

                  {assessment.exposure_summary.key_events && assessment.exposure_summary.key_events.length > 0 && (
                    <ul className="space-y-1.5 pt-2 border-t border-slate-200 text-xs">
                      {assessment.exposure_summary.key_events.map((evt, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                          <span>{evt}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 2. Shelf-Life Analyst Card */}
                <div className="p-5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold border border-amber-200">
                      <Clock className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Shelf-Life Analyst
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed">
                    {assessment.shelf_life_analysis.interpretation}
                  </p>
                </div>

                {/* 3. Decision Agent Card */}
                <div className="p-5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold border border-emerald-200">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Decision Agent
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed">
                    {assessment.decision.explanation}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500">Loading AI assessment trace...</p>
            )}
          </div>
        )}
      </div>

      {/* f. COMPARE CTA at the bottom */}
      <div className="pt-2 text-center">
        <Link
          to={`/compare?a=${batchId}&b=${batchId === 'b_0000' ? 'b_0001' : 'b_0000'}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-slate-700 hover:underline transition-all"
        >
          <span>Compare this batch with another →</span>
        </Link>
      </div>
    </div>
  );
};
