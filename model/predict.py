"""
Predict remaining shelf life for a batch.

Usage:
    from model.predict import predict_batch
    result = predict_batch("b_0001")

Returns a dict with:
    batch_id, product_type, nominal_shelf_life_hours, temp_max_c, humidity_max_pct,
    features (a nested dict of the damage/journey features),
    predicted_remaining_life_hours,
    ground_truth_remaining_life_hours

The prediction is served by the linear regression model, which achieved
MAE 3.77h / R² 0.994 vs. the boosted tree's MAE 19.2h / R² 0.900 on this dataset.
"""

import json

import truststore
from dotenv import load_dotenv
from google.cloud import bigquery

truststore.inject_into_ssl()
load_dotenv()


_client = bigquery.Client()

PREDICT_SQL = """
SELECT
  p.batch_id,
  p.product_type,
  p.nominal_shelf_life_hours,
  p.temp_max_c,
  p.humidity_max_pct,
  p.age_hours_at_retail,
  p.transit_hours,
  p.warehouse_dwell_hours,
  p.cumulative_thermal_exposure,
  p.hours_above_humidity_max,
  p.max_temp_excursion_c,
  p.longest_excursion_hours,
  p.remaining_life_hours_at_retail AS ground_truth,
  pred.predicted_remaining_life_hours_at_retail AS prediction
FROM ML.PREDICT(
  MODEL `aayu.shelf_life_linear`,
  (SELECT * FROM `aayu.v_batch_features` WHERE batch_id = @batch_id)
) AS pred
JOIN `aayu.v_batch_features` p USING (batch_id);
"""


def predict_batch(batch_id: str) -> dict:
    """Return prediction + features for one batch."""
    job = _client.query(
        PREDICT_SQL,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("batch_id", "STRING", batch_id)]
        ),
    )
    rows = list(job.result())
    if not rows:
        raise ValueError(f"batch_id {batch_id!r} not in v_batch_features")

    r = dict(rows[0])
    return {
        "batch_id": r["batch_id"],
        "product_type": r["product_type"],
        "nominal_shelf_life_hours": r["nominal_shelf_life_hours"],
        "temp_max_c": r["temp_max_c"],
        "humidity_max_pct": r["humidity_max_pct"],
        "features": {
            "age_hours_at_retail": round(r["age_hours_at_retail"], 2),
            "transit_hours": round(r["transit_hours"], 2),
            "warehouse_dwell_hours": round(r["warehouse_dwell_hours"], 2),
            "cumulative_thermal_exposure": round(r["cumulative_thermal_exposure"], 2),
            "hours_above_humidity_max": round(r["hours_above_humidity_max"], 2),
            "max_temp_excursion_c": round(r["max_temp_excursion_c"], 2),
            "longest_excursion_hours": round(r["longest_excursion_hours"], 2),
        },
        "predicted_remaining_life_hours": round(r["prediction"], 2),
        "ground_truth_remaining_life_hours": round(r["ground_truth"], 2),
    }


if __name__ == "__main__":

    for bid in ("b_0000", "b_0001"):
        result = predict_batch(bid)
        print(json.dumps(result, indent=2, default=str))
        print("---")
