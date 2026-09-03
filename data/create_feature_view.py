"""
Create or replace the aayu.v_batch_features view.
"""

from pathlib import Path

import truststore
from dotenv import load_dotenv
from google.cloud import bigquery

truststore.inject_into_ssl()
load_dotenv()


SQL_PATH = Path(__file__).parent / "queries" / "features.sql"


def main() -> None:
    sql = SQL_PATH.read_text()
    client = bigquery.Client()
    client.query(sql).result()
    print(f"view aayu.v_batch_features created/updated.")


if __name__ == "__main__":
    main()
