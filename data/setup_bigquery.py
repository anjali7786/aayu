import os

import truststore
from dotenv import load_dotenv
from google.cloud import bigquery

truststore.inject_into_ssl()

load_dotenv()

client = bigquery.Client()

# Create dataset if it doesn't exist
dataset_id = f"{os.environ['GCP_PROJECT_ID']}.aayu"
dataset = bigquery.Dataset(dataset_id)
dataset.location = os.environ["GCP_REGION"]
client.create_dataset(dataset, exists_ok=True)
print(f"Dataset {dataset_id} ready.")
