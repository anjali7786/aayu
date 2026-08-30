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

    print("training model (~1-2 min)...")
    # run_sql_file(client, "queries/training.sql").result()
    run_sql_file(client, "queries/training_linear.sql").result()

    print("  training complete.\n")

    print("evaluation metrics:")
    for row in run_sql_file(client, "queries/evaluate.sql").result():
        for k, v in row.items():
            if isinstance(v, float):
                print(f"  {k:30} {v:>10.3f}")
            else:
                print(f"  {k:30} {v!s:>10}")

    print("\nfeature importance:")
    for row in run_sql_file(client, "queries/feature_importance.sql").result():
        print(f"  {row['feature']:35} weight={row['importance_weight']:>8.2f}")


if __name__ == "__main__":
    main()
