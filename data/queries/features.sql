-- Aayu feature view: one row per batch, ready for BQML training.
--
-- Aggregates raw telemetry into the same features the ground-truth formula uses.
CREATE OR REPLACE VIEW `aayu.v_batch_features` AS

WITH journey_timing AS (
  -- One row per batch with the four key journey timestamps and derived durations.
  SELECT
    batch_id,
    MAX(IF(event_type = 'transit_start', ts, NULL)) AS transit_start_ts,
    MAX(IF(event_type = 'transit_end',   ts, NULL)) AS transit_end_ts,
    MAX(IF(event_type = 'warehouse_in',  ts, NULL)) AS warehouse_in_ts,
    MAX(IF(event_type = 'warehouse_out', ts, NULL)) AS warehouse_out_ts,
    MAX(IF(event_type = 'retail_in',     ts, NULL)) AS retail_in_ts
  FROM `aayu.events`
  GROUP BY batch_id
),

temp_aggregates AS (
  -- Simple per-batch aggregates over telemetry.
  -- Time step = 15 min = 0.25 h, used to convert row counts to hours.
  SELECT
    t.batch_id,
    SUM(GREATEST(t.temp_c - p.temp_max_c, 0)) * 0.25       AS cumulative_thermal_exposure,
    SUM(IF(t.humidity_pct > p.humidity_max_pct, 1, 0)) * 0.25 AS hours_above_humidity_max,
    MAX(GREATEST(t.temp_c - p.temp_max_c, 0))              AS max_temp_excursion_c
  FROM `aayu.telemetry` t
  JOIN `aayu.products` p USING (batch_id)
  GROUP BY t.batch_id
),

temp_flagged AS (
  -- Flag every telemetry row: is it above the batch's temp_max?
  -- Also assign a "run id" using the gaps-and-islands trick:
  --   subtract the running count of above-max rows from the running row number.
  -- Consecutive above-max rows share the same difference; a below-max row breaks it.
  SELECT
    t.batch_id,
    t.ts,
    IF(t.temp_c > p.temp_max_c, 1, 0) AS is_above,
    ROW_NUMBER() OVER (PARTITION BY t.batch_id ORDER BY t.ts)
      - SUM(IF(t.temp_c > p.temp_max_c, 1, 0))
        OVER (PARTITION BY t.batch_id ORDER BY t.ts) AS run_id
  FROM `aayu.telemetry` t
  JOIN `aayu.products` p USING (batch_id)
),

temp_excursion_runs AS (
  -- Count the length of each above-max run (in 15-min steps),
  -- take the longest per batch, convert to hours.
  SELECT
    batch_id,
    MAX(run_length) * 0.25 AS longest_excursion_hours
  FROM (
    SELECT
      batch_id,
      run_id,
      COUNT(*) AS run_length
    FROM temp_flagged
    WHERE is_above = 1
    GROUP BY batch_id, run_id
  )
  GROUP BY batch_id
)

SELECT
  p.batch_id,
  p.product_type,
  p.brand_name,
  p.display_name,
  p.gtin,
  p.lot_number,
  p.expiry_date,
  p.gs1_barcode,
  p.gs1_digital_link,
  p.nominal_shelf_life_hours,
  p.temp_max_c,
  p.humidity_max_pct,
  p.manufacture_ts,
  j.retail_in_ts,

  -- Journey durations (in hours)
  TIMESTAMP_DIFF(j.retail_in_ts, p.manufacture_ts, SECOND) / 3600.0 AS age_hours_at_retail,
  TIMESTAMP_DIFF(j.transit_end_ts, j.transit_start_ts, SECOND) / 3600.0 AS transit_hours,
  TIMESTAMP_DIFF(j.warehouse_out_ts, j.warehouse_in_ts, SECOND) / 3600.0 AS warehouse_dwell_hours,

  -- Damage signals (nulls -> 0 for batches with no excursions)
  COALESCE(a.cumulative_thermal_exposure, 0)   AS cumulative_thermal_exposure,
  COALESCE(a.hours_above_humidity_max, 0)      AS hours_above_humidity_max,
  COALESCE(a.max_temp_excursion_c, 0)          AS max_temp_excursion_c,
  COALESCE(e.longest_excursion_hours, 0)       AS longest_excursion_hours,

  -- Interaction features (physics-motivated) — baked into the view so ML.PREDICT
  -- can read them directly without recomputation, keeping training and serving
  -- from a single source of truth.
  COALESCE(a.cumulative_thermal_exposure, 0)
    * (TIMESTAMP_DIFF(j.retail_in_ts, p.manufacture_ts, SECOND) / 3600.0)         AS thermal_x_time,
  COALESCE(a.max_temp_excursion_c, 0)
    * COALESCE(a.max_temp_excursion_c, 0)                                          AS excursion_squared,
  COALESCE(a.cumulative_thermal_exposure, 0)
    * (TIMESTAMP_DIFF(j.transit_end_ts, j.transit_start_ts, SECOND) / 3600.0)      AS thermal_x_transit,

  -- Printed-expiry ceiling: hours between retail arrival and the stamped expiry date.
  -- The Aayu prediction should never exceed this (an operator would never trust
  -- "Aayu says it lasts longer than the label"). Backend clamps to this value.
  GREATEST(
    TIMESTAMP_DIFF(TIMESTAMP(p.expiry_date), j.retail_in_ts, SECOND) / 3600.0,
    0
  ) AS printed_remaining_life_hours,

  -- Training label
  g.remaining_life_hours_at_retail
FROM `aayu.products` p
JOIN journey_timing j USING (batch_id)
LEFT JOIN temp_aggregates a USING (batch_id)
LEFT JOIN temp_excursion_runs e USING (batch_id)
JOIN `aayu.ground_truth` g USING (batch_id);
