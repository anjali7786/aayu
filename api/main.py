"""
Aayu FastAPI backend.

Endpoints:
  GET  /health                            — liveness check
  GET  /batches                           — list all batches (with product identity)
  GET  /batches/{batch_id}                — batch metadata + features
  GET  /batches/{batch_id}/telemetry      — temperature series
  POST /batches/{batch_id}/assessment     — runs ADK orchestrator, logs to Firestore
  POST /barcode/lookup                    — resolve a scanned GS1 code to a batch_id

Run:
  uvicorn api.main:app --reload --port 8000

Requires:
  - MCP Toolbox running at $AAYU_MCP_URL (default http://127.0.0.1:5000/mcp)
  - GOOGLE_APPLICATION_CREDENTIALS pointing at a service account with BQ + Firestore + Vertex access
  - GOOGLE_GENAI_USE_VERTEXAI=true, GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION set
"""

from __future__ import annotations

import truststore

truststore.inject_into_ssl()

import json
import os
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.adk.runners import InMemoryRunner
from google.cloud import bigquery, firestore
from google.genai import types
from pydantic import BaseModel

from agents.orchestrator import aayu_orchestrator

# ---- clients ----
app = FastAPI(title="Aayu API", version="0.1.0")

# CORS: allow the AI Studio frontend to call us. Widen for dev; tighten before prod.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_bq = bigquery.Client()
_fs = firestore.Client()
_runner = InMemoryRunner(agent=aayu_orchestrator, app_name="aayu")


# ---- helpers ----
def _strip_json_fences(text: str) -> dict | str:
    """Gemini wraps JSON in ```json ... ``` fences. Strip and parse."""
    stripped = text.strip()
    if stripped.startswith("```"):
        # remove first line (```json or ```) and last line (```)
        lines = stripped.split("\n")
        if len(lines) >= 2:
            stripped = "\n".join(lines[1:-1]).strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return text  # give raw text back if it wasn't JSON


# ---- endpoints ----
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/batches")
def list_batches():
    """All batches with full product identity — for the batch portfolio view."""
    sql = """
    SELECT
      p.batch_id,
      p.product_type,
      p.brand_name,
      p.display_name,
      p.gtin,
      p.lot_number,
      p.expiry_date,
      p.manufacture_ts,
      p.nominal_shelf_life_hours,
      p.gs1_barcode,
      p.gs1_digital_link,
      MAX(e.ts) AS retail_in_ts
    FROM `aayu.products` p
    JOIN `aayu.events` e USING (batch_id)
    WHERE e.event_type = 'retail_in'
    GROUP BY
      p.batch_id, p.product_type, p.brand_name, p.display_name,
      p.gtin, p.lot_number, p.expiry_date, p.manufacture_ts,
      p.nominal_shelf_life_hours, p.gs1_barcode, p.gs1_digital_link
    ORDER BY p.batch_id
    """
    return [dict(r) for r in _bq.query(sql).result()]


@app.get("/batches/{batch_id}")
def get_batch(batch_id: str):
    """Batch metadata + feature-view row for one batch."""
    sql = """
    SELECT *
    FROM `aayu.v_batch_features`
    WHERE batch_id = @batch_id
    """
    job = _bq.query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("batch_id", "STRING", batch_id)]
        ),
    )
    rows = list(job.result())
    if not rows:
        raise HTTPException(status_code=404, detail=f"batch {batch_id!r} not found")
    return dict(rows[0])


@app.get("/batches/{batch_id}/telemetry")
def get_telemetry(batch_id: str):
    """Full temperature/humidity time series for one batch."""
    sql = """
    SELECT ts, temp_c, humidity_pct
    FROM `aayu.telemetry`
    WHERE batch_id = @batch_id
    ORDER BY ts
    """
    job = _bq.query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("batch_id", "STRING", batch_id)]
        ),
    )
    return [dict(r) for r in job.result()]


@app.post("/batches/{batch_id}/assessment")
async def get_assessment(batch_id: str):
    """
    Run the ADK 3-agent orchestrator on the given batch.
    Returns exposure_summary, shelf_life_analysis, decision.
    Writes the decision to Firestore for audit.
    """
    session = await _runner.session_service.create_session(app_name="aayu", user_id="api")
    message = types.Content(
        role="user",
        parts=[types.Part(text=f"Assess batch_id={batch_id}")],
    )
    async for _ in _runner.run_async(user_id="api", session_id=session.id, new_message=message):
        pass  # events are consumed but we care about final state

    session = await _runner.session_service.get_session(
        app_name="aayu", user_id="api", session_id=session.id
    )

    result = {
        "batch_id": batch_id,
        "exposure_summary": _strip_json_fences(session.state.get("exposure_summary", "")),
        "shelf_life_analysis": _strip_json_fences(session.state.get("shelf_life_analysis", "")),
        "decision": _strip_json_fences(session.state.get("decision", "")),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    # audit to Firestore (best-effort — never fail the request over audit)
    try:
        doc_id = f"{batch_id}_{result['generated_at']}"
        _fs.collection("decisions").document(doc_id).set(result)
    except Exception as e:
        print(f"[warn] firestore audit write failed: {e}")

    return result


# ---- barcode lookup ----
class BarcodeLookupRequest(BaseModel):
    scanned_code: str


@app.post("/barcode/lookup")
def lookup_by_barcode(req: BarcodeLookupRequest):
    """
    Resolve a scanned GS1 code — either a GS1-128 element string
    "(01)08901030855432(10)L26080501(17)260815" or a GS1 Digital Link URL
    "https://aayu.app/01/08901030855432/10/L26080501/17/260815" — to a batch_id
    plus product identity. Frontend calls this after a QR/barcode scan.
    """
    sql = """
    WITH parsed AS (
      SELECT
        REGEXP_EXTRACT(@scanned_code, r'(?:\\(01\\)|/01/)([0-9]{13,14})') AS gtin,
        REGEXP_EXTRACT(@scanned_code, r'(?:\\(10\\)|/10/)([A-Za-z0-9]+?)(?=\\(|/|$)') AS lot_number
    )
    SELECT
      p.batch_id,
      p.product_type,
      p.brand_name,
      p.display_name,
      p.gtin,
      p.lot_number,
      p.expiry_date,
      p.manufacture_ts,
      p.nominal_shelf_life_hours,
      p.gs1_barcode
    FROM `aayu.products` p
    JOIN parsed pa
      ON p.gtin = pa.gtin AND p.lot_number = pa.lot_number
    LIMIT 1
    """
    job = _bq.query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("scanned_code", "STRING", req.scanned_code)
            ]
        ),
    )
    rows = list(job.result())
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"No batch found for scanned code. Check the barcode format.",
        )
    return dict(rows[0])
