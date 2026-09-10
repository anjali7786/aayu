-- Train the Aayu shelf-life boosted-tree regressor.
-- Predicts remaining_life_hours_at_retail from journey and damage features.
--
-- TRANSFORM() bakes preprocessing into the model so inference can never
-- diverge from training (no manual scaling / one-hot lookups).
--
-- Interaction features are added in the SELECT for parity with the linear model;
-- boosted trees can learn interactions themselves but including them explicitly
-- makes both models comparable on the same feature set and gives the tree
-- a strong prior signal that generalizes better on the small (500-batch) dataset.

CREATE OR REPLACE MODEL `aayu.shelf_life_boosted_tree`
TRANSFORM(
  remaining_life_hours_at_retail,
  ML.STANDARD_SCALER(age_hours_at_retail)                OVER () AS age_h,
  ML.STANDARD_SCALER(transit_hours)                      OVER () AS transit_h,
  ML.STANDARD_SCALER(warehouse_dwell_hours)              OVER () AS warehouse_h,
  ML.STANDARD_SCALER(cumulative_thermal_exposure)        OVER () AS cum_therm,
  ML.STANDARD_SCALER(hours_above_humidity_max)           OVER () AS hum_h,
  ML.STANDARD_SCALER(max_temp_excursion_c)               OVER () AS max_exc_c,
  ML.STANDARD_SCALER(longest_excursion_hours)            OVER () AS long_exc_h,
  ML.STANDARD_SCALER(CAST(nominal_shelf_life_hours AS FLOAT64)) OVER () AS nominal_h,
  -- Interaction features (physics-motivated)
  ML.STANDARD_SCALER(thermal_x_time)                     OVER () AS thermal_x_time_s,
  ML.STANDARD_SCALER(excursion_squared)                  OVER () AS excursion_sq_s,
  ML.STANDARD_SCALER(thermal_x_transit)                  OVER () AS thermal_x_transit_s,
  -- Explicit one-hot for the categorical. Boosted trees in BQML do not auto-encode
  -- string features inside TRANSFORM(), so without this the tree ignores product_type
  -- entirely (feature importance = 0).
  ML.ONE_HOT_ENCODER(product_type)                       OVER () AS product_type
)
OPTIONS(
  model_type              = 'BOOSTED_TREE_REGRESSOR',
  input_label_cols        = ['remaining_life_hours_at_retail'],
  data_split_method       = 'AUTO_SPLIT',
  num_parallel_tree       = 1,
  max_tree_depth          = 6,
  learn_rate              = 0.1,
  min_split_loss          = 0.0,
  subsample               = 0.85,
  early_stop              = TRUE,
  min_rel_progress        = 0.005
) AS
SELECT
  remaining_life_hours_at_retail,
  age_hours_at_retail,
  transit_hours,
  warehouse_dwell_hours,
  cumulative_thermal_exposure,
  hours_above_humidity_max,
  max_temp_excursion_c,
  longest_excursion_hours,
  nominal_shelf_life_hours,
  product_type,
  cumulative_thermal_exposure * age_hours_at_retail                                 AS thermal_x_time,
  max_temp_excursion_c * max_temp_excursion_c                                       AS excursion_squared,
  cumulative_thermal_exposure * transit_hours                                       AS thermal_x_transit
FROM `aayu.v_batch_features`;
