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


def _bqml_prediction(batch_id: str) -> dict | None:
    """
    Direct BQML prediction — bypasses the LLM. The Shelf-Life Analyst agent
    occasionally hallucinates or adjusts the tool output; this reads BQML's
    output straight from the model to guarantee the displayed number is what
    the model actually predicted.

    Returns both `predicted` (clamped to printed expiry — what the UI shows)
    and `predicted_raw` (unclamped — used for drift monitoring). An operator
    would never trust "Aayu says it lasts longer than the printed label", so
    the clamp is applied server-side as a hard product invariant.
    """
    sql = """
    WITH cal AS (
      SELECT p80_abs_error, p90_abs_error
      FROM `aayu.model_calibration`
      WHERE model_name = 'shelf_life_linear'
      LIMIT 1
    )
    SELECT
      ROUND(pred.predicted_remaining_life_hours_at_retail, 2) AS predicted_raw,
      ROUND(f.remaining_life_hours_at_retail, 2) AS ground_truth,
      f.nominal_shelf_life_hours AS nominal,
      ROUND(f.printed_remaining_life_hours, 2) AS printed_remaining,
      cal.p80_abs_error,
      cal.p90_abs_error
    FROM ML.PREDICT(
      MODEL `aayu.shelf_life_linear`,
      (SELECT * FROM `aayu.v_batch_features` WHERE batch_id = @batch_id)
    ) pred
    JOIN `aayu.v_batch_features` f USING (batch_id)
    LEFT JOIN cal ON TRUE
    """
    try:
        job = _bq.query(
            sql,
            job_config=bigquery.QueryJobConfig(
                query_parameters=[bigquery.ScalarQueryParameter("batch_id", "STRING", batch_id)]
            ),
        )
        rows = list(job.result())
        if not rows:
            return None
        r = rows[0]
        predicted_raw = float(r["predicted_raw"])
        printed_remaining = (
            float(r["printed_remaining"]) if r["printed_remaining"] is not None else None
        )
        # Server-side clamp: hard invariant that Aayu never claims more life than printed.
        predicted_clamped = (
            min(predicted_raw, printed_remaining)
            if printed_remaining is not None
            else predicted_raw
        )
        # 80% empirical prediction interval, computed offline from training residuals.
        # Falls back to None if aayu.model_calibration hasn't been populated yet.
        p80 = float(r["p80_abs_error"]) if r["p80_abs_error"] is not None else None
        interval_low = max(0.0, round(predicted_clamped - p80, 2)) if p80 is not None else None
        interval_high = (
            round(min(printed_remaining, predicted_clamped + p80), 2)
            if p80 is not None and printed_remaining is not None
            else (round(predicted_clamped + p80, 2) if p80 is not None else None)
        )
        return {
            "predicted": round(predicted_clamped, 2),
            "predicted_raw": round(predicted_raw, 2),
            "predicted_interval_low": interval_low,
            "predicted_interval_high": interval_high,
            "prediction_interval_pct": 80 if p80 is not None else None,
            "ground_truth": float(r["ground_truth"]),
            "nominal": int(r["nominal"]),
            "printed_remaining": printed_remaining,
        }
    except Exception as e:
        print(f"[warn] direct BQML query failed for {batch_id}: {e}")
        return None


def _rule_based_decision(bqml: dict, batch_row: dict | None) -> dict:
    """
    Deterministic fallback recommendation when the ADK/LLM stack is unavailable.
    Uses the same thresholds as the Decision Agent's instruction, applied to the
    BQML prediction + exposure signals from v_batch_features. This is the
    guarantee that Aayu never returns 500 because an LLM died.
    """
    predicted = bqml["predicted"]
    nominal = bqml["nominal"]
    pct = (predicted / nominal * 100) if nominal else 0

    peak_excursion = float(batch_row.get("max_temp_excursion_c", 0) or 0) if batch_row else 0
    thermal_hours = float(batch_row.get("cumulative_thermal_exposure", 0) or 0) if batch_row else 0

    if pct < 15 or peak_excursion > 8:
        action = "Quarantine"
    elif peak_excursion > 5 and pct > 30:
        action = "Inspect"
    elif pct < 30:
        action = "Discount"
    elif pct < 60:
        action = "Prioritize Sale"
    else:
        action = "Sell Normally"

    if peak_excursion > 0:
        headline = (
            f"Rule-based recommendation: {action}. Peak excursion {peak_excursion:.1f}°C "
            f"and {thermal_hours:.1f}h of thermal exposure; model predicts {pct:.0f}% "
            f"of nominal shelf life remaining."
        )
    else:
        headline = (
            f"Rule-based recommendation: {action}. Cold chain clean; model predicts "
            f"{pct:.0f}% of nominal shelf life remaining."
        )

    return {
        "exposure_summary": {
            "risk_level": (
                "severe" if peak_excursion > 8 else "moderate" if peak_excursion > 0 else "minimal"
            ),
            "primary_concern": "thermal_excursion" if peak_excursion > 0 else "none",
            "key_events": (
                [
                    f"Peak excursion {peak_excursion:.1f}°C over max",
                    f"{thermal_hours:.1f}h cumulative thermal exposure",
                ]
                if peak_excursion > 0
                else ["No thermal excursion recorded"]
            ),
            "narrative": (
                f"Cold-chain telemetry shows {'a peak excursion of ' + f'{peak_excursion:.1f}°C over the safe threshold' if peak_excursion > 0 else 'no excursions'}. "
                f"Rule-based synthesis (LLM agents unavailable — fallback mode)."
            ),
        },
        "shelf_life_analysis": {
            "predicted_remaining_hours": bqml["predicted"],
            "predicted_raw": bqml["predicted_raw"],
            "predicted_interval_low": bqml.get("predicted_interval_low"),
            "predicted_interval_high": bqml.get("predicted_interval_high"),
            "prediction_interval_pct": bqml.get("prediction_interval_pct"),
            "ground_truth_remaining_hours": bqml["ground_truth"],
            "pct_of_nominal": round(pct, 2),
            "printed_remaining_hours": bqml["printed_remaining"],
            "confidence": "medium",
            "source": "bqml_direct",
            "interpretation": (
                f"BQML linear regression predicts {predicted:.1f}h remaining "
                f"({pct:.0f}% of {nominal}h nominal). Fallback path — LLM narrative unavailable."
            ),
        },
        "decision": {
            "headline": headline,
            "recommended_action": action,
            "confidence": "medium",
            "explanation": (
                f"Deterministic rules applied: pct_of_nominal={pct:.1f}%, "
                f"peak_excursion={peak_excursion:.1f}°C. "
                f"LLM decision agent unavailable — this recommendation follows the "
                f"same thresholds the agent uses."
            ),
        },
    }


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

    Resilience: if the ADK/MCP/LLM stack fails (agent errors, MCP unreachable,
    Vertex quota), fall back to a deterministic rule-based decision from BQML
    output. The frontend never sees a 500 from this endpoint.
    """
    generated_at = datetime.now(timezone.utc).isoformat()

    # Always precompute the BQML prediction — it's the source of truth for numbers
    # and the fallback data source.
    bqml = _bqml_prediction(batch_id)
    if bqml is None:
        raise HTTPException(
            status_code=404,
            detail=f"batch {batch_id!r} has no BQML prediction available",
        )

    # Try the agent stack. On any failure, degrade to rule-based.
    agent_result = None
    agent_error: str | None = None
    try:
        session = await _runner.session_service.create_session(app_name="aayu", user_id="api")
        message = types.Content(
            role="user",
            parts=[types.Part(text=f"Assess batch_id={batch_id}")],
        )
        async for _ in _runner.run_async(user_id="api", session_id=session.id, new_message=message):
            pass

        session = await _runner.session_service.get_session(
            app_name="aayu", user_id="api", session_id=session.id
        )
        agent_result = {
            "exposure_summary": _strip_json_fences(session.state.get("exposure_summary", "")),
            "shelf_life_analysis": _strip_json_fences(session.state.get("shelf_life_analysis", "")),
            "decision": _strip_json_fences(session.state.get("decision", "")),
        }
    except Exception as e:
        agent_error = f"{type(e).__name__}: {e}"
        print(f"[warn] ADK orchestrator failed for {batch_id}: {agent_error}")

    if agent_result is None or not isinstance(agent_result.get("decision"), dict):
        # Fallback: fetch batch features for exposure numbers and synthesize a rule-based response.
        batch_row = None
        try:
            job = _bq.query(
                "SELECT max_temp_excursion_c, cumulative_thermal_exposure FROM `aayu.v_batch_features` WHERE batch_id = @b",
                job_config=bigquery.QueryJobConfig(
                    query_parameters=[bigquery.ScalarQueryParameter("b", "STRING", batch_id)]
                ),
            )
            rows = list(job.result())
            if rows:
                batch_row = dict(rows[0])
        except Exception as e:
            print(f"[warn] fallback batch feature fetch failed: {e}")

        fallback = _rule_based_decision(bqml, batch_row)
        result = {
            "batch_id": batch_id,
            "exposure_summary": fallback["exposure_summary"],
            "shelf_life_analysis": fallback["shelf_life_analysis"],
            "decision": fallback["decision"],
            "generated_at": generated_at,
            "mode": "rule_based_fallback",
            "agent_error": agent_error,
        }
    else:
        # Happy path: agents ran; override numeric fields with direct BQML for integrity.
        result = {
            "batch_id": batch_id,
            "exposure_summary": agent_result["exposure_summary"],
            "shelf_life_analysis": agent_result["shelf_life_analysis"],
            "decision": agent_result["decision"],
            "generated_at": generated_at,
            "mode": "agent",
        }
        sla = result.get("shelf_life_analysis")
        if isinstance(sla, dict):
            sla["predicted_remaining_hours"] = bqml["predicted"]
            sla["predicted_raw"] = bqml["predicted_raw"]
            sla["predicted_interval_low"] = bqml.get("predicted_interval_low")
            sla["predicted_interval_high"] = bqml.get("predicted_interval_high")
            sla["prediction_interval_pct"] = bqml.get("prediction_interval_pct")
            sla["ground_truth_remaining_hours"] = bqml["ground_truth"]
            sla["pct_of_nominal"] = round(bqml["predicted"] / bqml["nominal"] * 100, 2)
            sla["printed_remaining_hours"] = bqml["printed_remaining"]
            sla["source"] = "bqml_direct"

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
    # Parse both GS1-128 (parenthesized) and GS1 Digital Link (URL) formats.
    # Using COALESCE + two simple patterns instead of a lookahead — RE2 (BQ's
    # regex engine) handles this more reliably than Python-style lookaheads.
    sql = r"""
    WITH parsed AS (
      SELECT
        COALESCE(
          REGEXP_EXTRACT(@scanned_code, r'\(01\)([0-9]{13,14})'),
          REGEXP_EXTRACT(@scanned_code, r'/01/([0-9]{13,14})')
        ) AS gtin,
        COALESCE(
          REGEXP_EXTRACT(@scanned_code, r'\(10\)([A-Za-z0-9]+?)\(17\)'),
          REGEXP_EXTRACT(@scanned_code, r'/10/([A-Za-z0-9]+?)/17/'),
          REGEXP_EXTRACT(@scanned_code, r'\(10\)([A-Za-z0-9]+)$'),
          REGEXP_EXTRACT(@scanned_code, r'/10/([A-Za-z0-9]+)$')
        ) AS lot_number
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
