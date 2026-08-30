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
  product_type
)
OPTIONS(
  model_type = 'LINEAR_REG',
  input_label_cols = ['remaining_life_hours_at_retail'],
  data_split_method = 'AUTO_SPLIT'
) AS
SELECT
  remaining_life_hours_at_retail,
  age_hours_at_retail, transit_hours, warehouse_dwell_hours,
  cumulative_thermal_exposure, hours_above_humidity_max,
  max_temp_excursion_c, longest_excursion_hours,
  nominal_shelf_life_hours, product_type
FROM `aayu.v_batch_features`;
