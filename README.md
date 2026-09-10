# Aayu — Dynamic Shelf-Life Intelligence for Perishable Food

AI-powered estimation of *effective* remaining shelf life for perishable food,
based on the product's real cold-chain journey — not just the date printed on the pack.

---

## The problem

Every year, roughly **one-third of all food produced globally is wasted** — about $1T in losses. A large share is perishable food that expires prematurely because the *printed* shelf life assumes ideal storage, while real cold chains have gaps: transit delays, warehouse temperature excursions, retail floor mishandling.

Two batches of pasteurized milk with the same "expires Aug 15" stamp can have wildly different real freshness by the time they hit the shelf. Retailers, wholesalers, and 3PLs currently have no way to know. They discard or sell based on the label, not on reality.

## The idea

Aayu combines cold-chain telemetry, product characteristics, and Gemini reasoning to compute a **Dynamic Shelf-Life Score** per batch and recommend the next best operational action — Sell Normally, Prioritize Sale, Discount, Inspect, or Quarantine.

## What it does

1. **Ingest** synthetic cold-chain telemetry (temperature + humidity, 15-min intervals) for 500 batches across 10 SKUs.
2. **Store** in BigQuery with a feature view (`v_batch_features`) that aggregates damage signals.
3. **Predict** remaining shelf life with a BigQuery ML linear regression (MAE **9.24h**, R² **0.985**).
4. **Analyze** via a Google ADK 3-agent orchestrator (Exposure Analyst → Shelf-Life Analyst → Decision Agent), backed by an MCP Toolbox exposing BQ read tools.
5. **Serve** via FastAPI on Cloud Run with a React frontend generated in AI Studio Build.
6. **Scan** real GS1-128 barcodes and GS1 Digital Link URLs — production-grade identifier handling, not fake barcodes.

## Live demo

- **Frontend**: <https://aayu-shelf.ai.studio/>
- **Backend API**: `https://aayu-api-241157484581.us-central1.run.app`
- **MCP Toolbox**: `https://aayu-mcp-toolbox-241157484581.us-central1.run.app`

Try it:
```bash
curl -X POST https://aayu-api-241157484581.us-central1.run.app/batches/b_0001/assessment | jq .
```

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                            React + Vite (Cloud Run)                        │
│  Landing · Batch List · Batch Detail · Compare · Scan QR                   │
└──────────────────────────────┬─────────────────────────────────────────────┘
                               │  HTTPS
                               ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                        FastAPI (Cloud Run, 2Gi / 300s)                     │
│  /batches  /batches/{id}  /batches/{id}/assessment  /barcode/lookup        │
│                                                                            │
│  ┌────────────────────────────┐    ┌────────────────────────────────────┐ │
│  │  ADK Sequential Agent      │    │  _bqml_prediction  (source of truth)│ │
│  │  Exposure → Shelf-Life →   │    │  ML.PREDICT  +  interval calibration │ │
│  │  Decision                  │    │  Clamps predicted ≤ printed expiry  │ │
│  └──────────┬─────────────────┘    └────────────────┬───────────────────┘ │
│             │ tool calls                            │                      │
│             ▼                                       ▼                      │
└─────────────┼───────────────────────────────────────┼──────────────────────┘
              │                                       │
              ▼                                       ▼
┌──────────────────────────────┐        ┌─────────────────────────────────┐
│  MCP Toolbox (Cloud Run)      │        │  BigQuery                        │
│  Google MCP Toolbox v1.10.0   │        │  aayu.telemetry (raw sensors)    │
│  get-batch-features           │───────▶│  aayu.events (journey milestones)│
│  get-batch-telemetry-summary  │        │  aayu.products (SKU + GS1)       │
│  get-batch-events             │        │  aayu.v_batch_features (view)    │
│  predict-shelf-life           │        │  aayu.shelf_life_linear (BQML)   │
│  lookup-batch-by-*            │        │  aayu.shelf_life_boosted_tree   │
└──────────────────────────────┘        │  aayu.model_calibration          │
                                        └─────────────────────────────────┘

                    Decision audit → Firestore (Native)
                    Numeric integrity → server-side clamp + prediction intervals
```

**Design principles**
- **Single source of truth** for numeric prediction. LLMs generate narrative; BQML generates numbers. The API overrides any agent-generated number with a direct `ML.PREDICT` call so the operator sees what the model actually said.
- **Server-side product invariants.** Aayu never claims more shelf life than the printed label — clamp lives in the API, not the UI, so partner integrations get the same guarantee.
- **Graceful degradation.** If MCP or Vertex is down, the endpoint falls back to a deterministic rule-based decision from BQML output. `/assessment` never returns 500 because an LLM died. Response includes `mode: "agent" | "rule_based_fallback"` so the caller knows.
- **Calibrated confidence.** Every prediction ships with an empirical 80% interval calibrated from held-out residuals, not a false-precision point estimate.

## Model quality

Trained on 500 batches × 10 SKUs of synthetic cold-chain data with per-product damage coefficients grounded in food-science literature (Arrhenius-like thermal decay, humidity thresholds per USDA guidelines).

| Model | MAE (h) | R² | Median abs error (h) | Notes |
|---|---:|---:|---:|---|
| **shelf_life_linear** (production) | **9.24** | **0.985** | **5.5** | Interaction features (`thermal × time`, `excursion²`, `thermal × transit`); L2 regularization |
| shelf_life_boosted_tree (challenger) | 33.4 | 0.898 | 33.1 | Overfits at 500-batch scale; kept for when real data volume arrives |

**80% empirical prediction interval: ±12.11h**  |  **90%: ±18.03h** (from residuals on training set)

**Top 5 features by importance** (boosted tree feature importance as a proxy):
1. `age_h` (weight 197) — time since manufacture dominates
2. `nominal_h` (133) — product-specific baseline shelf life
3. `cum_therm` (56) — cumulative thermal exposure
4. `long_exc_h` (31) — longest continuous excursion
5. `thermal_x_time_s` (24) — the interaction feature earns its place

See [`docs/ABLATION.md`](docs/ABLATION.md) for the head-to-head comparison of rule-only vs. BQML+rule vs. full agent stack across 20 sample batches.

## Google Cloud services used

| Service | Role |
|---|---|
| BigQuery | Telemetry + events store, feature view, model calibration table |
| BigQuery ML | Linear + boosted-tree regressors, `ML.PREDICT` for serving |
| Vertex AI | Gemini 2.5 Flash for agent narrative and decision synthesis |
| Google ADK | 3-agent orchestrator (`SequentialAgent`) |
| MCP Toolbox for Databases | Exposes BQ read + ML predict as MCP tools |
| Cloud Run | Backend, MCP, and frontend hosting |
| Firestore | Decision audit log (Native mode) |
| Cloud Build | Auto-triggered image builds on `gcloud run deploy --source` |

## Application stack

Beyond the Google Cloud services above, the application layer uses:

- **Backend** — Python 3.14 · FastAPI · Google ADK (`SequentialAgent`) · MCP Toolbox for Databases (v1.10.0)
- **Frontend** — React 18 · Vite · TypeScript · Tailwind · Recharts · TanStack Query · `html5-qrcode` (camera scan) · `qrcode.react` (rendered GS1 codes)
- **Standards** — GS1-128 element strings `(01)…(10)…(17)…` and GS1 Digital Link URLs `/01/{gtin}/10/{lot}/17/{expiry}` — the same formats used in real retail supply chains, not synthetic identifiers

---

## Repository layout

```
aayu/
├── data/                    # Synthetic generator + BigQuery loaders
│   ├── generate_data.py     # 500 batches, 10 SKUs, per-product damage coeffs
│   ├── load_data.py         # BQ table + view creation
│   └── queries/features.sql # v_batch_features view (interaction features baked in)
├── model/                   # BQML training + calibration
│   ├── train.py
│   └── queries/
│       ├── training.sql
│       ├── training_linear.sql
│       ├── save_prediction_interval.sql
│       └── feature_importance.sql
├── mcp/                     # MCP Toolbox config
│   ├── tools.yaml           # 6 tools exposed to the agent
│   └── Dockerfile
├── agents/                  # ADK orchestrator
│   └── orchestrator.py      # Exposure → Shelf-Life → Decision (SequentialAgent)
├── api/                     # FastAPI backend
│   └── main.py              # Endpoints + BQML override + rule-based fallback
├── scripts/                 # Ablation study, one-off scripts
│   └── ablation.py
├── tests/                   # Fast pytest suite (no BQ/Vertex needed)
│   └── test_invariants.py
├── aayu-frontend-studio/    # React frontend (generated + deployed via AI Studio Build)
├── docs/
│   ├── BUSINESS_CASE.md
│   └── ABLATION.md
├── Dockerfile               # Backend container (Python 3.14 slim)
└── README.md
```

---

## Running it end-to-end

Prerequisites:
- Python 3.10+ (3.14 tested)
- GCP project with BigQuery, Vertex AI, Firestore, Cloud Run APIs enabled
- Service account with `bigquery.admin`, `aiplatform.user`, `datastore.user`, `run.developer`

### 1. Seed data + train models (in Cloud Shell)

```bash
git clone https://github.com/anjali7786/aayu.git
cd aayu
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Seed BigQuery
python -m data.generate_data
python -m data.load_data

# Build view + train both models + compute prediction intervals
bq query --use_legacy_sql=false < data/queries/features.sql
python -m model.train
```

### 2. Deploy MCP + backend

```bash
# MCP Toolbox
gcloud run deploy aayu-mcp-toolbox --source ./mcp --region us-central1 --allow-unauthenticated

# FastAPI backend (needs AAYU_MCP_URL pointing at the MCP service)
gcloud run deploy aayu-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --timeout 300 \
  --min-instances 1 \
  --set-env-vars "AAYU_MCP_URL=https://aayu-mcp-toolbox-241157484581.us-central1.run.app/mcp,GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=$(gcloud config get-value project),GOOGLE_CLOUD_LOCATION=us-central1"
```

### 3. Run tests

```bash
pytest tests/ -v
```

### 4. Run the ablation study

```bash
python -m scripts.ablation --n 20 --output docs/ABLATION.md
```

Takes ~2 min. Regenerates `docs/ABLATION.md` with a fresh comparison table.
