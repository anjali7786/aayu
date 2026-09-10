-- Persist the linear model's residual statistics into a tiny table so the API
-- can look them up in one cheap query at inference time instead of recomputing
-- residuals over the whole feature table on every /assessment call.
CREATE OR REPLACE TABLE `aayu.model_calibration` AS
WITH residuals AS (
  SELECT
    ABS(p.predicted_remaining_life_hours_at_retail - f.remaining_life_hours_at_retail) AS abs_error,
    (p.predicted_remaining_life_hours_at_retail - f.remaining_life_hours_at_retail) AS signed_error
  FROM ML.PREDICT(MODEL `aayu.shelf_life_linear`, TABLE `aayu.v_batch_features`) p
  JOIN `aayu.v_batch_features` f USING (batch_id)
)
SELECT
  'shelf_life_linear' AS model_name,
  ROUND(AVG(abs_error), 4)                                 AS mae,
  ROUND(STDDEV(signed_error), 4)                           AS sigma,
  ROUND(APPROX_QUANTILES(abs_error, 100)[OFFSET(80)], 4)   AS p80_abs_error,
  ROUND(APPROX_QUANTILES(abs_error, 100)[OFFSET(90)], 4)   AS p90_abs_error,
  CURRENT_TIMESTAMP()                                       AS computed_at
FROM residuals;
