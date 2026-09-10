import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
} from 'recharts';
import {
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Sliders,
  CheckCircle2,
  Clock,
  Truck,
  Building2,
  Store,
  Zap,
} from 'lucide-react';
import { TelemetryPoint, ChartMarkerEvent } from '../types';

interface BatchTelemetryChartProps {
  telemetry: TelemetryPoint[];
  tempMaxC: number;
  markers?: ChartMarkerEvent[];
  height?: number;
  syncId?: string;
  showHumidity?: boolean;
  yDomain?: [number, number];
}

interface ResolvedMarker extends ChartMarkerEvent {
  matchTs: string;
  index: number;
  pct: number;
  level: number; // 0 (top tier) or 1 (staggered lower tier)
  align: 'start' | 'center' | 'end';
}

export const BatchTelemetryChart: React.FC<BatchTelemetryChartProps> = ({
  telemetry,
  tempMaxC,
  markers = [],
  height = 400,
  syncId,
  yDomain,
}) => {
  const [smoothMode, setSmoothMode] = useState<boolean>(true);
  const [activeMarkerTs, setActiveMarkerTs] = useState<string | null>(null);

  // Format data with both raw and weighted smoothed series
  const chartData = useMemo(() => {
    if (!telemetry || !telemetry.length) return [];

    const raw = telemetry.map((pt) => {
      const date = new Date(pt.ts);
      const timeLabel = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);

      return {
        ts: pt.ts,
        timeLabel,
        temp_c: pt.temp_c,
        humidity_pct: pt.humidity_pct,
        isExcursion: pt.temp_c > tempMaxC,
      };
    });

    // 3-point Gaussian-weighted rolling average to remove 15-min sensor jitter
    // while accurately tracking the true excursion magnitude and duration
    return raw.map((pt, i, arr) => {
      const prev = arr[Math.max(0, i - 1)].temp_c;
      const curr = pt.temp_c;
      const next = arr[Math.min(arr.length - 1, i + 1)].temp_c;
      const smoothed = Number((0.2 * prev + 0.6 * curr + 0.2 * next).toFixed(2));
      return {
        ...pt,
        temp_smooth: smoothed,
      };
    });
  }, [telemetry, tempMaxC]);

  // Compute stats for the summary strip
  const stats = useMemo(() => {
    if (!telemetry || telemetry.length === 0) return null;
    const temps = telemetry.map((t) => t.temp_c);
    const minTemp = Math.min(...temps);
    const maxTemp = Math.max(...temps);
    const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;

    const inRangeCount = temps.filter((t) => t >= 0 && t <= tempMaxC).length;
    const inRangePct = (inRangeCount / temps.length) * 100;

    const excursionCount = temps.filter((t) => t > tempMaxC).length;
    const excursionHours = excursionCount * 0.25;

    return {
      minTemp,
      maxTemp,
      avgTemp,
      inRangePct,
      excursionHours,
      hasExcursion: maxTemp > tempMaxC,
    };
  }, [telemetry, tempMaxC]);

  // Calculate dynamic Y domain with comfortable visual padding
  const computedYDomain = useMemo<[number, number]>(() => {
    if (yDomain) return yDomain;
    if (!telemetry || telemetry.length === 0) return [-2, 10];

    const temps = telemetry.map((t) => t.temp_c);
    const min = Math.min(...temps, 0);
    const max = Math.max(...temps, tempMaxC + 1);

    // Padding ensures top and bottom ticks don't collide with the chart container boundary
    const pad = 1.6;
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [telemetry, tempMaxC, yDomain]);

  // Resolve markers to closest telemetry points with collision avoidance
  const resolvedMarkers = useMemo<ResolvedMarker[]>(() => {
    if (!markers.length || !chartData.length) return [];

    const withIndices = markers.map((marker) => {
      const targetTime = new Date(marker.ts).getTime();
      let closestIdx = 0;
      let minDiff = Infinity;

      for (let i = 0; i < chartData.length; i++) {
        const diff = Math.abs(new Date(chartData[i].ts).getTime() - targetTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }

      return {
        ...marker,
        matchTs: chartData[closestIdx].ts,
        index: closestIdx,
        pct: closestIdx / Math.max(1, chartData.length - 1),
      };
    });

    // Sort chronologically
    withIndices.sort((a, b) => a.index - b.index);

    // Calculate vertical stagger level to guarantee 0 horizontal text collision
    const minSeparationPct = 0.16; // 16% width collision threshold
    let prevLevel = 0;
    let prevPct = -1;

    return withIndices.map((m) => {
      let level = 0;
      if (prevPct >= 0 && m.pct - prevPct < minSeparationPct) {
        // Stagger to opposite level if close to previous marker
        level = prevLevel === 0 ? 1 : 0;
      } else {
        level = 0;
      }
      prevLevel = level;
      prevPct = m.pct;

      let align: 'start' | 'center' | 'end' = 'center';
      if (m.pct < 0.08) align = 'start';
      else if (m.pct > 0.92) align = 'end';

      return {
        ...m,
        level,
        align,
      };
    });
  }, [markers, chartData]);

  if (!telemetry || telemetry.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400 text-xs font-mono">
        No telemetry data points available for this batch.
      </div>
    );
  }

  const isCompact = height < 280;

  return (
    <div className="w-full space-y-3">
      {/* Top Controls & Mini Metrics Strip */}
      {!isCompact && stats && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-1 border-b border-slate-100 text-xs">
          {/* Diagnostic telemetry metrics */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-50 border border-slate-200">
              <span className="text-slate-500 font-mono text-[11px]">Min:</span>
              <span className="font-mono font-bold text-slate-800">{stats.minTemp.toFixed(1)}°C</span>
            </div>

            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${
                stats.hasExcursion
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}
            >
              <span className="font-mono text-[11px]">Peak:</span>
              <span className="font-mono font-bold">{stats.maxTemp.toFixed(1)}°C</span>
              {stats.hasExcursion && (
                <span className="text-[10px] font-semibold bg-rose-200/60 px-1 py-0.2 rounded">
                  +{(stats.maxTemp - tempMaxC).toFixed(1)}°C excursion
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-50 border border-slate-200">
              <span className="text-slate-500 font-mono text-[11px]">Avg:</span>
              <span className="font-mono font-semibold text-slate-700">{stats.avgTemp.toFixed(1)}°C</span>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50/50 border border-emerald-200 text-emerald-800">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span className="font-mono font-semibold">{stats.inRangePct.toFixed(1)}% safe in-range</span>
            </div>
          </div>

          {/* Smooth / Raw View Toggle */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 self-start md:self-auto">
            <button
              type="button"
              onClick={() => setSmoothMode(true)}
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                smoothMode
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Smoothed Trend
            </button>
            <button
              type="button"
              onClick={() => setSmoothMode(false)}
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                !smoothMode
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Raw Sensor (15m)
            </button>
          </div>
        </div>
      )}

      {/* Main Graph Area */}
      <div className="w-full relative" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            syncId={syncId}
            margin={{
              top: isCompact ? 28 : 52,
              right: 32,
              left: 0,
              bottom: 15,
            }}
          >
            <defs>
              {/* Sky Blue Temperature Area Fill Gradient */}
              <linearGradient id="tempAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0284c7" stopOpacity={0.22} />
                <stop offset="60%" stopColor="#0284c7" stopOpacity={0.06} />
                <stop offset="100%" stopColor="#0284c7" stopOpacity={0.00} />
              </linearGradient>

              {/* Excursion Danger Gradient */}
              <linearGradient id="excursionGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />

            {/* Shaded Green Safe Range (0°C to tempMaxC) */}
            <ReferenceArea
              y1={0}
              y2={tempMaxC}
              shape={(props: any) => (
                <rect
                  x={props.x}
                  y={props.y}
                  width={props.width}
                  height={props.height}
                  fill="#10b981"
                  fillOpacity={0.06}
                />
              )}
            />

            {/* Baseline 0°C Reference Line with Right Badge */}
            <ReferenceLine
              y={0}
              stroke="#cbd5e1"
              strokeDasharray="3 3"
              strokeWidth={1}
              label={(props: any) => {
                const { viewBox } = props;
                if (!viewBox) return null;
                const x = (viewBox.x || 0) + (viewBox.width || 500);
                const y = viewBox.y;
                return (
                  <g className="select-none">
                    <rect
                      x={x - 70}
                      y={y - 8}
                      width={66}
                      height={16}
                      rx={3}
                      fill="#f8fafc"
                      stroke="#cbd5e1"
                      strokeWidth={1}
                    />
                    <text
                      x={x - 37}
                      y={y + 3.5}
                      textAnchor="middle"
                      fill="#64748b"
                      fontSize={9.5}
                      fontWeight={500}
                      fontFamily="system-ui, sans-serif"
                    >
                      Min: 0.0°C
                    </text>
                  </g>
                );
              }}
            />

            {/* Red Dashed Line at tempMaxC: Pinned Right Badge (No floating text clutter) */}
            <ReferenceLine
              y={tempMaxC}
              stroke="#f43f5e"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={(props: any) => {
                const { viewBox } = props;
                if (!viewBox) return null;
                const x = (viewBox.x || 0) + (viewBox.width || 500);
                const y = viewBox.y;
                return (
                  <g className="select-none">
                    <rect
                      x={x - 85}
                      y={y - 9}
                      width={81}
                      height={18}
                      rx={4}
                      fill="#fff1f2"
                      stroke="#fca5a5"
                      strokeWidth={1}
                    />
                    <text
                      x={x - 44}
                      y={y + 3.5}
                      textAnchor="middle"
                      fill="#be123c"
                      fontSize={10}
                      fontWeight={600}
                      fontFamily="system-ui, sans-serif"
                    >
                      Limit: {tempMaxC.toFixed(1)}°C
                    </text>
                  </g>
                );
              }}
            />

            {/* Vertical Reference Markers with Staggered Collision-Free Badges */}
            {resolvedMarkers.map((marker, idx) => {
              const isExcursion = marker.type === 'excursion';
              const isHighlighted = activeMarkerTs === marker.matchTs;

              return (
                <ReferenceLine
                  key={idx}
                  x={marker.matchTs}
                  stroke={isExcursion ? '#f43f5e' : isHighlighted ? '#0284c7' : '#94a3b8'}
                  strokeDasharray="3 3"
                  strokeWidth={isExcursion || isHighlighted ? 1.75 : 1}
                  label={(props: any) => {
                    const { viewBox } = props;
                    if (!viewBox) return null;
                    const x = Number(viewBox.x);
                    if (isNaN(x)) return null;

                    // Stagger heights: Level 0 is at y = 11, Level 1 is lower at y = 30
                    const yPos = marker.level === 1 ? (isCompact ? 16 : 30) : (isCompact ? 4 : 10);

                    // Short, crisp label
                    const labelText = isExcursion
                      ? `Peak ${marker.label.replace(/Peak Excursion|\(|\)/gi, '').trim()}`
                      : marker.label;

                    const charWidth = 6.2;
                    const pillWidth = Math.max(54, labelText.length * charWidth + 16);
                    const pillHeight = 18;

                    let pillX = x - pillWidth / 2;
                    if (marker.align === 'start') {
                      pillX = Math.max(8, x);
                    } else if (marker.align === 'end') {
                      pillX = x - pillWidth;
                    }

                    return (
                      <g className="cursor-pointer select-none">
                        {/* Connecting stem down to data region */}
                        <line
                          x1={x}
                          y1={yPos + pillHeight}
                          x2={x}
                          y2={viewBox.y}
                          stroke={isExcursion ? '#f43f5e' : '#cbd5e1'}
                          strokeWidth={1}
                          strokeDasharray="2 2"
                        />
                        {/* Pill Background */}
                        <rect
                          x={pillX}
                          y={yPos}
                          width={pillWidth}
                          height={pillHeight}
                          rx={4}
                          fill={isExcursion ? '#fff1f2' : isHighlighted ? '#e0f2fe' : '#ffffff'}
                          stroke={isExcursion ? '#f87171' : isHighlighted ? '#0284c7' : '#cbd5e1'}
                          strokeWidth={isHighlighted || isExcursion ? 1.5 : 1}
                          className="transition-colors"
                        />
                        {/* Text */}
                        <text
                          x={pillX + pillWidth / 2}
                          y={yPos + 12.5}
                          textAnchor="middle"
                          fill={isExcursion ? '#b91c1c' : isHighlighted ? '#0369a1' : '#334155'}
                          fontSize={9.5}
                          fontWeight={isExcursion || isHighlighted ? 600 : 500}
                          fontFamily="system-ui, sans-serif"
                        >
                          {isExcursion ? '⚠️ ' : ''}{labelText}
                        </text>
                      </g>
                    );
                  }}
                />
              );
            })}

            <XAxis
              dataKey="ts"
              tickFormatter={(ts) => {
                const d = new Date(ts);
                return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`;
              }}
              stroke="#94a3b8"
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={{ stroke: '#e2e8f0' }}
              interval="preserveStartEnd"
              minTickGap={45}
            />

            <YAxis
              domain={computedYDomain}
              unit="°C"
              width={42}
              stroke="#94a3b8"
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={{ stroke: '#e2e8f0' }}
            />

            {/* Polished Tooltip */}
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  const rawTemp = data.temp_c;
                  const displayTemp = smoothMode ? data.temp_smooth : rawTemp;
                  const isOver = rawTemp > tempMaxC;

                  return (
                    <div className="bg-white/95 backdrop-blur-xs border border-slate-200 rounded-lg p-3 shadow-md text-xs space-y-2 font-sans min-w-[190px] z-50">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 text-slate-500 font-mono text-[11px]">
                        <span>{data.timeLabel}</span>
                        {isOver ? (
                          <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Excursion
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                            Safe Range
                          </span>
                        )}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-600 font-medium">Temperature:</span>
                          <span className={`font-mono text-sm font-bold ${isOver ? 'text-rose-600' : 'text-slate-900'}`}>
                            {displayTemp.toFixed(2)}°C
                          </span>
                        </div>

                        {smoothMode && (
                          <div className="flex items-center justify-between gap-4 text-[11px] text-slate-500">
                            <span>Raw sensor reading:</span>
                            <span className="font-mono text-slate-700">{rawTemp.toFixed(2)}°C</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-4 text-[11px] text-slate-500">
                          <span>Safe band limit:</span>
                          <span className="font-mono text-slate-700">&le; {tempMaxC.toFixed(1)}°C</span>
                        </div>

                        {data.humidity_pct !== undefined && (
                          <div className="flex items-center justify-between gap-4 text-[11px] pt-1 border-t border-slate-100 text-slate-500">
                            <span>Relative Humidity:</span>
                            <span className="font-mono text-sky-600 font-medium">{data.humidity_pct.toFixed(1)}%</span>
                          </div>
                        )}
                      </div>

                      {isOver && (
                        <div className="text-[10px] text-rose-700 font-medium bg-rose-50 p-1.5 rounded border border-rose-200">
                          Thermal delta: +{(rawTemp - tempMaxC).toFixed(2)}°C above {tempMaxC}°C threshold
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />

            {/* Smooth Gradient Area + Line */}
            <Area
              type="monotone"
              dataKey={smoothMode ? 'temp_smooth' : 'temp_c'}
              stroke="#0284c7"
              strokeWidth={2.25}
              fill="url(#tempAreaGradient)"
              dot={false}
              activeDot={{
                r: 5,
                fill: '#0284c7',
                stroke: '#ffffff',
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Milestone Cards Timeline Ribbon (Chronological Journey) */}
      {!isCompact && resolvedMarkers.length > 0 && (
        <div className="pt-2">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Key Cold-Chain Milestones</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {resolvedMarkers.map((marker, idx) => {
              const isExcursion = marker.type === 'excursion';
              const isDispatch = marker.type === 'dispatch';
              const isWarehouse = marker.type === 'warehouse';
              const isRetail = marker.type === 'retail';

              const d = new Date(marker.ts);
              const dateStr = new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              }).format(d);

              let IconComponent = Clock;
              if (isDispatch) IconComponent = Truck;
              else if (isWarehouse) IconComponent = Building2;
              else if (isExcursion) IconComponent = AlertTriangle;
              else if (isRetail) IconComponent = Store;

              const isSelected = activeMarkerTs === marker.matchTs;

              return (
                <div
                  key={idx}
                  onMouseEnter={() => setActiveMarkerTs(marker.matchTs)}
                  onMouseLeave={() => setActiveMarkerTs(null)}
                  onClick={() => setActiveMarkerTs(isSelected ? null : marker.matchTs)}
                  className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all duration-150 ${
                    isExcursion
                      ? 'bg-rose-50/70 border-rose-200 hover:border-rose-400'
                      : isSelected
                      ? 'bg-sky-50 border-sky-300 shadow-2xs'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span
                      className={`text-xs font-semibold flex items-center gap-1 ${
                        isExcursion ? 'text-rose-700' : 'text-slate-800'
                      }`}
                    >
                      <IconComponent className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{marker.label}</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">{dateStr}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 line-clamp-1">
                    {marker.description || (isExcursion ? 'Exceeded safe temperature threshold' : 'Cold-chain event')}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
