"""
Load the 4 synthetic CSVs into BigQuery tables.

Usage:
    python data/load_data.py

Runs idempotently — overwrites existing tables (WRITE_TRUNCATE).
"""

import os
from pathlib import Path

import truststore
from dotenv import load_dotenv
from google.cloud import bigquery

truststore.inject_into_ssl()
load_dotenv()


CSV_DIR = Path(__file__).parent / "csv"
DATASET = f"{os.environ['GCP_PROJECT_ID']}.aayu"

# Explicit schemas — safer than autodetect for timestamps
SCHEMAS = {
    "products": [
        bigquery.SchemaField("batch_id", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("product_type", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("brand_name", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("display_name", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("gtin", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("lot_number", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("manufacture_ts", "TIMESTAMP", mode="REQUIRED"),
        bigquery.SchemaField("expiry_date", "DATE", mode="REQUIRED"),
        bigquery.SchemaField("nominal_shelf_life_hours", "INT64", mode="REQUIRED"),
        bigquery.SchemaField("temp_min_c", "FLOAT64", mode="REQUIRED"),
        bigquery.SchemaField("temp_max_c", "FLOAT64", mode="REQUIRED"),
        bigquery.SchemaField("humidity_max_pct", "FLOAT64", mode="REQUIRED"),
        bigquery.SchemaField("gs1_barcode", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("gs1_digital_link", "STRING", mode="REQUIRED"),
    ],
    "events": [
        bigquery.SchemaField("batch_id", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("event_type", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("ts", "TIMESTAMP", mode="REQUIRED"),
        bigquery.SchemaField("location", "STRING", mode="NULLABLE"),
    ],
    "telemetry": [
        bigquery.SchemaField("batch_id", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("ts", "TIMESTAMP", mode="REQUIRED"),
        bigquery.SchemaField("temp_c", "FLOAT64", mode="REQUIRED"),
        bigquery.SchemaField("humidity_pct", "FLOAT64", mode="REQUIRED"),
    ],
    "ground_truth": [
        bigquery.SchemaField("batch_id", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("remaining_life_hours_at_retail", "FLOAT64", mode="REQUIRED"),
    ],
}


def load_table(client: bigquery.Client, table_name: str) -> None:
    csv_path = CSV_DIR / f"{table_name}.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"{csv_path} not found — run generate_data.py first")

    table_id = f"{DATASET}.{table_name}"
    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.CSV,
        skip_leading_rows=1,
        schema=SCHEMAS[table_name],
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
    )

    with csv_path.open("rb") as f:
        job = client.load_table_from_file(f, table_id, job_config=job_config)
    job.result()

    table = client.get_table(table_id)
    print(f"  loaded {table.num_rows:>7} rows -> {table_id}")


def main() -> None:
    client = bigquery.Client()
    print(f"loading into {DATASET}")
    for name in ("products", "events", "telemetry", "ground_truth"):
        load_table(client, name)
    print("done.")


if __name__ == "__main__":
    main()
