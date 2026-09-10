-- Compute the residual standard deviation (approx normal) for the linear model
-- so the API can render an 80% prediction interval as [pred - 1.28*sigma, pred + 1.28*sigma].
--
-- This runs at inference time via /assessment; caching it in a table would be a
-- future improvement. The 1.28 multiplier is the z-score for the 80% two-sided
-- normal interval (10th and 90th percentiles).

WITH residuals AS (
  SELECT
    ABS(p.predicted_remaining_life_hours_at_retail - f.remaining_life_hours_at_retail) AS abs_error,
    (p.predicted_remaining_life_hours_at_retail - f.remaining_life_hours_at_retail) AS signed_error
  FROM ML.PREDICT(MODEL `aayu.shelf_life_linear`, TABLE `aayu.v_batch_features`) p
  JOIN `aayu.v_batch_features` f USING (batch_id)
)
SELECT
  ROUND(AVG(abs_error), 2)                                 AS mae,
  ROUND(STDDEV(signed_error), 2)                           AS sigma,
  ROUND(APPROX_QUANTILES(abs_error, 100)[OFFSET(80)], 2)   AS p80_abs_error,
  ROUND(APPROX_QUANTILES(abs_error, 100)[OFFSET(90)], 2)   AS p90_abs_error
FROM residuals;
