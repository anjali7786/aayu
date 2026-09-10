import { BatchListItem, BatchDetail, TelemetryPoint, BatchAssessment, ChartMarkerEvent } from '../types';

export const API_BASE = 'https://aayu-api-241157484581.us-central1.run.app';
export const API = API_BASE;

export async function lookupBarcode(scannedCode: string): Promise<BatchListItem | BatchDetail> {
  const cleanCode = scannedCode.trim();

  // 1. Primary: POST /barcode/lookup
  try {
    const res = await fetch(`${API_BASE}/barcode/lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ scanned_code: cleanCode }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.batch_id) {
        return data;
      }
    }
  } catch (err) {
    console.warn('POST /barcode/lookup call failed, attempting fallback parsing', err);
  }

  // 2. Direct batch ID match or digital link URL extraction fallback
  let possibleBatchId = cleanCode.toLowerCase();
  const urlMatch = cleanCode.match(/\/batch(?:es)?\/(b_\d{4})/i);
  if (urlMatch) {
    possibleBatchId = urlMatch[1].toLowerCase();
  } else if (/^\d{1,4}$/.test(possibleBatchId)) {
    possibleBatchId = `b_${possibleBatchId.padStart(4, '0')}`;
  } else if (/^b\d{1,4}$/.test(possibleBatchId)) {
    possibleBatchId = `b_${possibleBatchId.replace('b', '').padStart(4, '0')}`;
  }

  if (/^b_\d{4}$/.test(possibleBatchId)) {
    const batchRes = await fetch(`${API_BASE}/batches/${possibleBatchId}`);
    if (batchRes.ok) {
      const batchData = await batchRes.json();
      if (batchData && batchData.batch_id) {
        return batchData;
      }
    }
  }

  throw new Error('Barcode not recognized. Check that this batch exists in Aayu.');
}

export async function fetchBatches(): Promise<BatchListItem[]> {
  const res = await fetch(`${API_BASE}/batches`);
  if (!res.ok) {
    throw new Error(`Failed to load batches: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchBatch(batchId: string): Promise<BatchDetail> {
  const res = await fetch(`${API_BASE}/batches/${batchId}`);
  if (!res.ok) {
    throw new Error(`Failed to load batch ${batchId}: ${res.statusText}`);
  }
  return res.json();
}

export async function validateBatch(batchId: string): Promise<{ exists: boolean; batch?: BatchDetail; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/batches/${batchId}`);
    if (res.status === 404) {
      return { exists: false, error: 'Batch not found' };
    }
    if (!res.ok) {
      return { exists: false, error: `Server error (${res.status})` };
    }
    const data = await res.json();
    return { exists: true, batch: data };
  } catch (err: any) {
    return { exists: false, error: err.message || 'Failed to connect to batch API' };
  }
}

export async function fetchTelemetry(batchId: string): Promise<TelemetryPoint[]> {
  const res = await fetch(`${API_BASE}/batches/${batchId}/telemetry`);
  if (!res.ok) {
    throw new Error(`Failed to load telemetry for ${batchId}: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchAssessment(batchId: string): Promise<BatchAssessment> {
  const res = await fetch(`${API_BASE}/batches/${batchId}/assessment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`assessment ${res.status}`);
  }

  const data: BatchAssessment = await res.json();
  console.log('assessment for', batchId, ':', data);
  return data;
}

export function deriveBatchMilestones(
  batch: BatchDetail,
  telemetry: TelemetryPoint[]
): ChartMarkerEvent[] {
  const markers: ChartMarkerEvent[] = [];

  if (batch.manufacture_ts) {
    markers.push({
      ts: batch.manufacture_ts,
      label: 'Dispatch',
      type: 'dispatch',
      description: 'Manufactured & loaded into cold-chain transit'
    });
  }

  if (batch.manufacture_ts && batch.transit_hours > 0) {
    const whDate = new Date(new Date(batch.manufacture_ts).getTime() + batch.transit_hours * 3600 * 1000);
    markers.push({
      ts: whDate.toISOString(),
      label: 'Warehouse In',
      type: 'warehouse',
      description: `Arrived at regional warehouse (${batch.transit_hours}h transit)`
    });
  }

  // Detect excursion points from telemetry if temperature exceeded limit
  if (telemetry && telemetry.length > 0 && batch.temp_max_c !== undefined) {
    let peakPoint: TelemetryPoint | null = null;
    let excursionStart: TelemetryPoint | null = null;

    for (const pt of telemetry) {
      if (pt.temp_c > batch.temp_max_c) {
        if (!excursionStart) {
          excursionStart = pt;
        }
        if (!peakPoint || pt.temp_c > peakPoint.temp_c) {
          peakPoint = pt;
        }
      }
    }

    if (peakPoint) {
      markers.push({
        ts: peakPoint.ts,
        label: `Peak Excursion (${peakPoint.temp_c.toFixed(1)}°C)`,
        type: 'excursion',
        description: `Exceeded max ${batch.temp_max_c}°C limit`
      });
    }
  }

  if (batch.retail_in_ts) {
    markers.push({
      ts: batch.retail_in_ts,
      label: 'Retail Arrival',
      type: 'retail',
      description: 'Checked into retail store receiving'
    });
  }

  return markers;
}
