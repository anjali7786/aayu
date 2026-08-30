"""
Aayu Gemini explainer.

Turns a prediction dict from model/predict.py into a structured JSON
explanation with headline, reasoning, recommended action, and confidence.

Routed through Vertex AI (uses the service-account credentials in
GOOGLE_APPLICATION_CREDENTIALS), not the AI Studio API key.
"""

import json
import os
import warnings

import truststore
from dotenv import load_dotenv
from google import genai

from model.predict import predict_batch

truststore.inject_into_ssl()
load_dotenv()


warnings.filterwarnings("ignore", message=".*automatic function calling.*")

MODEL = "gemini-2.5-flash"

_client = genai.Client(
    vertexai=True,
    project=os.environ["GCP_PROJECT_ID"],
    location=os.environ["GCP_REGION"],
)

# The schema the LLM must produce. Enforced during decoding.
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {
            "type": "string",
            "description": "One sentence. What should the operator know at a glance.",
        },
        "explanation": {
            "type": "string",
            "description": (
                "2-3 sentences citing specific numeric features. "
                "Never invent numbers not in the input."
            ),
        },
        "recommended_action": {
            "type": "string",
            "enum": ["Sell Normally", "Prioritize Sale", "Discount", "Inspect", "Quarantine"],
        },
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
    },
    "required": ["headline", "explanation", "recommended_action", "confidence"],
}

SYSTEM_INSTRUCTION = (
    "You are a food-safety operations analyst helping a retail store manager "
    "decide what to do with a batch of perishable food that just arrived. "
    "You are given: the product's safe temperature and humidity limits, "
    "the batch's journey timing, and aggregated exposure features from "
    "cold-chain telemetry, plus a model-predicted remaining shelf life. "
    "Rules: "
    "(1) Cite only numeric values present in the input. Never invent readings. "
    "(2) Focus on what shortened shelf life — age, thermal exposure, humidity, "
    "or excursion severity. "
    "(3) If nothing shortened it meaningfully, say so plainly. "
    "(4) Match your recommended_action to the risk: "
    "'Sell Normally' when remaining life > 60% of nominal; "
    "'Prioritize Sale' when 30-60%; "
    "'Discount' when 15-30%; "
    "'Inspect' when significant excursion regardless of remaining life; "
    "'Quarantine' when remaining life < 15% or excursion peak > 6°C over max."
)


def explain(prediction: dict) -> dict:
    """
    Take a prediction dict from predict_batch() and return a structured explanation.
    """
    payload = _build_payload(prediction)
    resp = _client.models.generate_content(
        model=MODEL,
        contents=json.dumps(payload),
        config={
            "system_instruction": SYSTEM_INSTRUCTION,
            "temperature": 0.2,
            "response_mime_type": "application/json",
            "response_schema": RESPONSE_SCHEMA,
        },
    )
    return json.loads(resp.text)


def _build_payload(prediction: dict) -> dict:
    """Small, structured input for Gemini — features + prediction, no raw telemetry."""
    nominal = prediction["nominal_shelf_life_hours"]
    predicted = prediction["predicted_remaining_life_hours"]
    return {
        "product_type": prediction["product_type"],
        "safe_temperature_max_c": prediction["temp_max_c"],
        "safe_humidity_max_pct": prediction["humidity_max_pct"],
        "nominal_shelf_life_hours": nominal,
        "predicted_remaining_life_hours": predicted,
        "predicted_remaining_pct_of_nominal": round(predicted / nominal * 100, 1),
        "journey_features": prediction["features"],
    }


if __name__ == "__main__":

    for bid in ("b_0000", "b_0001"):
        pred = predict_batch(bid)
        result = explain(pred)
        print(f"=== {bid} ===")
        print(
            f"predicted: {pred['predicted_remaining_life_hours']}h / "
            f"nominal: {pred['nominal_shelf_life_hours']}h"
        )
        print(json.dumps(result, indent=2))
        print()
