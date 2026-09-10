-- Aayu shelf-life linear regressor.
-- Linear models can't learn feature interactions on their own, so we bake three
-- physics-motivated interaction terms into the SELECT: thermal_x_time captures
-- that heat damage compounds with time exposed; excursion_squared captures
-- non-linear damage above safe threshold; and thermal_x_transit isolates
-- damage sustained during the (often less-controlled) transit leg.
-- Expected MAE improvement: 10.9h -> ~7h.
CREATE OR REPLACE MODEL `aayu.shelf_life_linear`
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
  -- Interaction features (linear can't learn these itself)
  ML.STANDARD_SCALER(thermal_x_time)                     OVER () AS thermal_x_time_s,
  ML.STANDARD_SCALER(excursion_squared)                  OVER () AS excursion_sq_s,
  ML.STANDARD_SCALER(thermal_x_transit)                  OVER () AS thermal_x_transit_s,
  -- Explicit one-hot for parity with the boosted-tree TRANSFORM. Linear regression
  -- would auto-encode strings; making it explicit means both models share the exact
  -- same feature representation and their comparison is apples-to-apples.
  ML.ONE_HOT_ENCODER(product_type)                       OVER () AS product_type
)
OPTIONS(
  model_type = 'LINEAR_REG',
  input_label_cols = ['remaining_life_hours_at_retail'],
  data_split_method = 'AUTO_SPLIT',
  l2_reg = 0.1
) AS
SELECT
  remaining_life_hours_at_retail,
  age_hours_at_retail, transit_hours, warehouse_dwell_hours,
  cumulative_thermal_exposure, hours_above_humidity_max,
  max_temp_excursion_c, longest_excursion_hours,
  nominal_shelf_life_hours, product_type,
  thermal_x_time, excursion_squared, thermal_x_transit
FROM `aayu.v_batch_features`;
