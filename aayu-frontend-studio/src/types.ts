export interface BatchListItem {
  batch_id: string;
  product_type: string;
  brand_name?: string;
  display_name?: string;
  gtin?: string;
  lot_number?: string;
  expiry_date?: string;
  gs1_barcode?: string;
  gs1_digital_link?: string;
  nominal_shelf_life_hours: number;
  manufacture_ts: string;
  retail_in_ts?: string;
}

export interface BatchDetail {
  batch_id: string;
  product_type: string;
  brand_name?: string;
  display_name?: string;
  gtin?: string;
  lot_number?: string;
  expiry_date?: string;
  gs1_barcode?: string;
  gs1_digital_link?: string;
  nominal_shelf_life_hours: number;
  temp_max_c: number;
  humidity_max_pct: number;
  manufacture_ts: string;
  retail_in_ts: string;
  age_hours_at_retail: number;
  transit_hours: number;
  warehouse_dwell_hours: number;
  cumulative_thermal_exposure: number;
  hours_above_humidity_max: number;
  max_temp_excursion_c: number;
  longest_excursion_hours: number;
  remaining_life_hours_at_retail: number;
}

export interface TelemetryPoint {
  ts: string;
  temp_c: number;
  humidity_pct: number;
}

export interface ExposureSummary {
  risk_level: string;
  primary_concern: string;
  key_events: string[];
  narrative: string;
}

export interface ShelfLifeAnalysis {
  predicted_remaining_hours: number;          // clamped by backend to printed expiry
  predicted_raw?: number;                      // unclamped raw model output
  predicted_interval_low?: number;             // 80% empirical prediction interval — lower bound
  predicted_interval_high?: number;            // 80% empirical prediction interval — upper bound
  prediction_interval_pct?: number;            // e.g. 80
  ground_truth_remaining_hours?: number;
  pct_of_nominal: number;
  printed_remaining_hours?: number;            // hours from retail arrival to printed expiry
  source?: 'bqml_direct' | 'agent' | string;   // trust signal
  confidence: 'low' | 'medium' | 'high' | string;
  interpretation: string;
}

export interface AssessmentDecision {
  headline: string;
  recommended_action: 'Sell Normally' | 'Prioritize Sale' | 'Discount' | 'Inspect' | 'Quarantine' | string;
  confidence: string;
  explanation: string;
}

export interface BatchAssessment {
  batch_id: string;
  exposure_summary: ExposureSummary;
  shelf_life_analysis: ShelfLifeAnalysis;
  decision: AssessmentDecision;
  generated_at: string;
  mode?: 'agent' | 'rule_based_fallback' | string;   // NEW
  agent_error?: string;                                // NEW
  cache_hit?: boolean;
}

export type AssessmentResult = BatchAssessment;

export interface ChartMarkerEvent {
  ts: string;
  label: string;
  type: 'dispatch' | 'warehouse' | 'retail' | 'excursion';
  description?: string;
}
