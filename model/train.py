"""
Train the Aayu BQML shelf-life model, then print evaluation and feature importance.

Training takes ~1-2 minutes.
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

    print("training linear model (~30 sec)...")
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

    print("feature importance (boosted tree):")
    for row in run_sql_file(client, "queries/feature_importance.sql").result():
        print(f"  {row['feature']:35} weight={row['importance_weight']:>8.2f}")


if __name__ == "__main__":
    main()
