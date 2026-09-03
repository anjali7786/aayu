"""
Aayu dashboard

Command to run : python -m streamlit run app/streamlit_app.py
"""

import plotly.graph_objects as go
import streamlit as st
import truststore
from dotenv import load_dotenv
from google.cloud import bigquery

from model.predict import predict_batch
from reasoning.llm_client import explain

truststore.inject_into_ssl()
load_dotenv()

st.set_page_config(page_title="Aayu — Dynamic Shelf Life", layout="wide")


@st.cache_resource
def _bq():
    return bigquery.Client()


@st.cache_data(ttl=300)
def list_batches() -> list[dict]:
    """All batches with basic info for the picker dropdown."""
    sql = """
    SELECT
        p.batch_id,
        p.product_type,
        p.manufacture_ts,
        p.nominal_shelf_life_hours,
        MAX(e.ts) AS retail_in_ts
    FROM `aayu.products` p
    JOIN `aayu.events` e USING (batch_id)
    WHERE e.event_type = 'retail_in'
    GROUP BY p.batch_id, p.product_type, p.manufacture_ts, p.nominal_shelf_life_hours
    ORDER BY p.batch_id
    """
    return [dict(r) for r in _bq().query(sql).result()]


@st.cache_data(ttl=300)
def get_prediction(batch_id: str) -> dict:
    return predict_batch(batch_id)


@st.cache_data(ttl=300)
def get_explanation(batch_id: str, predicted_hours: float) -> dict:
    pred = predict_batch(batch_id)
    return explain(pred)


@st.cache_data(ttl=300)
def get_telemetry(batch_id: str):
    sql = """
    SELECT ts, temp_c, humidity_pct
    FROM `aayu.telemetry`
    WHERE batch_id = @batch_id
    ORDER BY ts
    """
    job = _bq().query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("batch_id", "STRING", batch_id)]
        ),
    )
    return [dict(r) for r in job.result()]


ACTION_COLORS = {
    "Sell Normally": "#22c55e",  # green
    "Prioritize Sale": "#eab308",  # yellow
    "Discount": "#f97316",  # orange
    "Inspect": "#ef4444",  # red
    "Quarantine": "#7f1d1d",  # dark red
}

# Event markers — vertical dotted lines
# Alternate label heights so adjacent events don't collide
EVENT_LABEL_YSHIFT = {
    "dispatch": -8,
    "transit_start": -22,
    "transit_end": -8,
    "warehouse_in": -22,
    "warehouse_out": -8,
    "retail_in": -22,
}


def render_action_badge(action: str) -> None:
    color = ACTION_COLORS.get(action, "#6b7280")
    st.markdown(
        f"""
        <div style="
            display: inline-block;
            padding: 0.5rem 1rem;
            background-color: {color};
            color: white;
            border-radius: 0.5rem;
            font-weight: 600;
            font-size: 1.1rem;
        ">{action}</div>
        """,
        unsafe_allow_html=True,
    )


@st.cache_data(ttl=300)
def get_events(batch_id: str):
    sql = """
    SELECT event_type, ts
    FROM `aayu.events`
    WHERE batch_id = @batch_id
    ORDER BY ts
    """
    job = _bq().query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("batch_id", "STRING", batch_id)]
        ),
    )
    return [dict(r) for r in job.result()]


st.title("Aayu — Dynamic Shelf-Life Predictor")

batches = list_batches()
batch_labels = [
    f"{b['batch_id']} — {b['product_type']} — mfd {b['manufacture_ts'].strftime('%Y-%m-%d %H:%M')}"
    for b in batches
]
label_to_batch = {label: b for label, b in zip(batch_labels, batches)}

with st.sidebar:
    st.header("Batch")
    selected_label = st.selectbox(
        "Select a batch",
        batch_labels,
        index=1,
    )
    selected_batch = label_to_batch[selected_label]


st.subheader(f"Batch {selected_batch['batch_id']}")

col1, col2, col3, col4 = st.columns(4)
col1.metric("Product", selected_batch["product_type"])
col2.metric("Nominal shelf life", f"{selected_batch['nominal_shelf_life_hours']} h")
col3.metric("Manufactured", selected_batch["manufacture_ts"].strftime("%Y-%m-%d"))
col4.metric("Arrived at retail", selected_batch["retail_in_ts"].strftime("%Y-%m-%d"))


# ---- prediction + explanation ----
with st.spinner("Predicting and reasoning..."):
    pred = get_prediction(selected_batch["batch_id"])
    exp = get_explanation(selected_batch["batch_id"], pred["predicted_remaining_life_hours"])

st.divider()
st.subheader("Aayu assessment")

# Compare Aayu's estimate to what the printed date alone would say
printed_remaining = pred["nominal_shelf_life_hours"] - pred["features"]["age_hours_at_retail"]
aayu_remaining = pred["predicted_remaining_life_hours"]
delta_h = aayu_remaining - printed_remaining
pct_of_nominal = aayu_remaining / pred["nominal_shelf_life_hours"] * 100

metric_col1, metric_col2, metric_col3 = st.columns(3)
metric_col1.metric(
    "Printed expiry (remaining)",
    f"{printed_remaining:.0f} h",
    help="Simple: nominal shelf life minus age at retail.",
)
metric_col2.metric(
    "Aayu estimate",
    f"{aayu_remaining:.0f} h",
    delta=f"{delta_h:+.1f} h vs printed",
    delta_color="normal",
    help="Predicted remaining life after accounting for actual cold-chain journey.",
)
metric_col3.metric(
    "% of nominal",
    f"{pct_of_nominal:.1f}%",
)

st.markdown("**Recommended action**")
render_action_badge(exp["recommended_action"])
st.caption(f"Confidence: {exp['confidence']}")

st.divider()
st.subheader("Reasoning")
st.markdown(f"**{exp['headline']}**")
st.write(exp["explanation"])

# ---- feature detail (collapsible) ----
with st.expander("Journey features (what the model saw)"):
    features = pred["features"]
    fc1, fc2, fc3 = st.columns(3)
    fc1.metric("Age at retail", f"{features['age_hours_at_retail']:.1f} h")
    fc1.metric("Transit", f"{features['transit_hours']:.1f} h")
    fc1.metric("Warehouse dwell", f"{features['warehouse_dwell_hours']:.1f} h")
    fc2.metric("Cumulative thermal exp", f"{features['cumulative_thermal_exposure']:.1f} °C·h")
    fc2.metric("Peak excursion", f"{features['max_temp_excursion_c']:.1f} °C")
    fc2.metric("Longest excursion run", f"{features['longest_excursion_hours']:.2f} h")
    fc3.metric("Hours above humidity max", f"{features['hours_above_humidity_max']:.1f} h")


st.divider()
st.subheader("Temperature journey")

telemetry = get_telemetry(selected_batch["batch_id"])
events = get_events(selected_batch["batch_id"])

temp_max = pred["temp_max_c"]

fig = go.Figure()

# Safe range band (translucent green): from -2 to temp_max
fig.add_hrect(
    y0=-2,
    y1=temp_max,
    fillcolor="rgba(34, 197, 94, 0.12)",
    line_width=0,
    annotation_text="safe range",
    annotation_position="top left",
)

# Danger threshold — dashed red horizontal line at temp_max
fig.add_hline(
    y=temp_max,
    line_dash="dash",
    line_color="rgba(239, 68, 68, 0.6)",
    annotation_text=f"temp max ({temp_max}°C)",
    annotation_position="right",
)

# Actual temperature series
fig.add_trace(
    go.Scatter(
        x=[r["ts"] for r in telemetry],
        y=[r["temp_c"] for r in telemetry],
        mode="lines",
        name="Temperature",
        line=dict(color="#3b82f6", width=2),
        hovertemplate="%{x|%b %d %H:%M}<br>%{y:.2f}°C<extra></extra>",
    )
)

for e in events:
    yshift = EVENT_LABEL_YSHIFT.get(e["event_type"], -8)
    fig.add_vline(
        x=e["ts"],
        line_dash="dot",
        line_color="rgba(107, 114, 128, 0.35)",
        annotation_text=e["event_type"].replace("_", " "),
        annotation_position="top",
        annotation_font_size=10,
        annotation_yshift=yshift,
    )

fig.update_layout(
    xaxis_title="Time",
    yaxis_title="Temperature (°C)",
    height=420,
    margin=dict(t=40, b=40, l=40, r=100),
    hovermode="x unified",
    showlegend=False,
)

st.plotly_chart(fig, use_container_width=True)
