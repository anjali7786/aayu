"""
Train the Aayu BQML shelf-life models, evaluate them, and persist prediction-
interval calibration.

Sequence:
  1. Train boosted-tree regressor (~1-2 min)
  2. Train linear regressor with interaction features (~30 sec)
  3. Evaluate both against their own held-out sets
  4. Compute residual statistics on the linear model and persist to aayu.model_calibration
     so the API can serve 80% / 90% prediction intervals without recomputing residuals.
  5. Print feature importance for the boosted tree
"""

from pathlib import Path

import truststore
from dotenv import load_dotenv
from google.cloud import bigquery

truststore.inject_into_ssl()
load_dotenv()

ML_DIR = Path(__file__).parent


def run_sql_file(client: bigquery.Client, filename: str) -> bigquery.QueryJob:
    sql = (ML_DIR / filename).read_text()
    return client.query(sql)


def main() -> None:
    client = bigquery.Client()

    print("training boosted-tree model (~1-2 min)...")
    run_sql_file(client, "queries/training.sql").result()
    print("  boosted tree trained.\n")

    print("training linear model with interaction features (~30 sec)...")
    run_sql_file(client, "queries/training_linear.sql").result()
    print("  linear model trained.\n")

    # Evaluate both against their own held-out sets
    for model_name in ("shelf_life_boosted_tree", "shelf_life_linear"):
        print(f"=== {model_name} ===")
        sql = f"SELECT * FROM ML.EVALUATE(MODEL `aayu.{model_name}`)"
        for row in client.query(sql).result():
            for k, v in row.items():
                if isinstance(v, float):
                    print(f"  {k:30} {v:>10.3f}")
                else:
                    print(f"  {k:30} {v!s:>10}")
        print()

    print("computing prediction-interval calibration for shelf_life_linear...")
    run_sql_file(client, "queries/save_prediction_interval.sql").result()
    for row in client.query("SELECT * FROM `aayu.model_calibration`").result():
        print(f"  mae            = {row['mae']:.2f}h")
        print(f"  sigma          = {row['sigma']:.2f}h")
        print(f"  80% interval   = ±{row['p80_abs_error']:.2f}h (empirical)")
        print(f"  90% interval   = ±{row['p90_abs_error']:.2f}h (empirical)")
    print()

    print("feature importance (boosted tree):")
    for row in run_sql_file(client, "queries/feature_importance.sql").result():
        print(f"  {row['feature']:35} weight={row['importance_weight']:>8.2f}")


if __name__ == "__main__":
    main()
