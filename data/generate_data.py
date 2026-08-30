"""
Aayu synthetic data generator.

Produces 4 CSVs under data/csv/ representing cold-chain journeys for perishable products:
    products.csv, events.csv, telemetry.csv, ground_truth.csv

Runs are deterministic (SEED=42). Batches 0 and 1 are hard-coded showcase pairs.
"""

from __future__ import annotations

import csv
import os
import random
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

# ---- config ----
N_BATCHES = 200
SEED = 42
TELEMETRY_INTERVAL_MIN = 15
CSV_DIR = Path(__file__).parent / "csv"

PRODUCTS = {
    "pasteurized_milk": {"shelf_life_hours": 240, "temp_min": 0, "temp_max": 4, "humidity_max": 85},
    "yogurt": {"shelf_life_hours": 336, "temp_min": 2, "temp_max": 5, "humidity_max": 85},
    "leafy_greens": {"shelf_life_hours": 168, "temp_min": 1, "temp_max": 4, "humidity_max": 95},
}

# ---- events ----
EVENT_COLUMNS = ["batch_id", "event_type", "ts", "location"]

# fixed segment order in a journey
EVENT_SEQUENCE = [
    "dispatch",
    "transit_start",
    "transit_end",
    "warehouse_in",
    "warehouse_out",
    "retail_in",
]

# ---- telemetry ----
TELEMETRY_COLUMNS = ["batch_id", "ts", "temp_c", "humidity_pct"]

# probability a batch has an excursion in transit (delayed batches are more likely)
EXCURSION_PROB_NORMAL = 0.15
EXCURSION_PROB_DELAYED = 0.55  # long transit -> more likely to lose cooling
DELAYED_TRANSIT_HOURS = 24  # threshold to be considered "delayed"

# how far above temp_max an excursion goes
EXCURSION_TEMP_ABOVE_MAX_RANGE = (1.5, 6.0)
EXCURSION_DURATION_HOURS_RANGE = (0.5, 8.0)

# sensor noise (std deviation, degrees C / % humidity)
TEMP_NOISE_STD = 0.3
HUMIDITY_NOISE_STD = 2.0

# possible locations per event type — just labels for realism
LOCATIONS = {
    "dispatch": ["plant_bengaluru", "plant_pune", "plant_ahmedabad"],
    "transit_start": ["truck_A12", "truck_B04", "truck_C07"],
    "transit_end": ["truck_A12", "truck_B04", "truck_C07"],
    "warehouse_in": ["wh_delhi", "wh_mumbai", "wh_hyderabad"],
    "warehouse_out": ["wh_delhi", "wh_mumbai", "wh_hyderabad"],
    "retail_in": ["store_042", "store_118", "store_207"],
}

# ---- ground truth ----
GROUND_TRUTH_COLUMNS = ["batch_id", "remaining_life_hours_at_retail"]

# tune these to control the learning problem's difficulty
K_THERMAL = 0.6  # hrs of shelf life lost per degree-hour above temp_max
K_HUMIDITY = 0.05  # hrs lost per hour above humidity_max
K_EXCURSION_SQ = 0.8  # NONLINEAR: hrs lost per (longest_excursion_hours)^2
GROUND_TRUTH_NOISE_STD = 4.0  # hours; realistic measurement noise
GROUND_TRUTH_FLOOR_HOURS = 0.0  # never go below zero


# ---- showcase batches (hard-coded for reliable demo) ----
SHOWCASE_PRODUCT = "pasteurized_milk"
SHOWCASE_MANUFACTURE_TS = datetime(2026, 8, 5, 0, 0)

SHOWCASE_OVERRIDES = {
    "b_0000": {
        "transit_hours": 14,
        "warehouse_dwell_hours": 24,
        "force_excursion": False,
    },
    "b_0001": {
        "transit_hours": 14,
        "warehouse_dwell_hours": 24,
        "force_excursion": True,
        "excursion_hours": 6.0,
        "excursion_peak_c": 10.0,
    },
}


def main() -> None:
    random.seed(SEED)
    CSV_DIR.mkdir(exist_ok=True)

    products = generate_products()
    write_csv("products.csv", products, PRODUCT_COLUMNS)
    print(f"wrote {len(products)} products")

    all_events = []
    for product in products:
        all_events.extend(generate_events_for_batch(product))
    write_csv("events.csv", all_events, EVENT_COLUMNS)
    print(f"wrote {len(all_events)} events")

    all_telemetry = []
    for product in products:
        batch_events = [e for e in all_events if e["batch_id"] == product["batch_id"]]
        all_telemetry.extend(generate_telemetry_for_batch(product, batch_events))
    write_csv("telemetry.csv", all_telemetry, TELEMETRY_COLUMNS)
    print(f"wrote {len(all_telemetry)} telemetry rows")

    ground_truth_rows = []
    for product in products:
        batch_id = product["batch_id"]
        batch_events = [e for e in all_events if e["batch_id"] == batch_id]
        batch_telemetry = [t for t in all_telemetry if t["batch_id"] == batch_id]
        ground_truth_rows.append(
            compute_ground_truth_for_batch(product, batch_events, batch_telemetry)
        )
    write_csv("ground_truth.csv", ground_truth_rows, GROUND_TRUTH_COLUMNS)
    print(f"wrote {len(ground_truth_rows)} ground truth rows")


# ---- products ----
PRODUCT_COLUMNS = [
    "batch_id",
    "product_type",
    "manufacture_ts",
    "nominal_shelf_life_hours",
    "temp_min_c",
    "temp_max_c",
    "humidity_max_pct",
]


@dataclass
class Segment:
    """One leg of the journey — e.g., 'transit_start' -> 'transit_end'."""

    name: str  # e.g., "transit"
    start_ts: datetime
    end_ts: datetime
    baseline_temp_c: float


def generate_products() -> list[dict]:
    """One row per batch. Random product type + manufacture timestamp."""
    products = []
    base_ts = datetime(2026, 8, 1, 0, 0)  # dataset starts Aug 1 2026

    for i in range(N_BATCHES):
        batch_id = f"b_{i:04d}"

        if batch_id in SHOWCASE_OVERRIDES:
            product_type = SHOWCASE_PRODUCT
            manufacture_ts = SHOWCASE_MANUFACTURE_TS
        else:
            product_type = random.choice(list(PRODUCTS.keys()))
            manufacture_ts = base_ts + timedelta(hours=random.randint(0, 24 * 7))

        profile = PRODUCTS[product_type]
        products.append(
            {
                "batch_id": f"b_{i:04d}",
                "product_type": product_type,
                "manufacture_ts": manufacture_ts.isoformat(),
                "nominal_shelf_life_hours": profile["shelf_life_hours"],
                "temp_min_c": profile["temp_min"],
                "temp_max_c": profile["temp_max"],
                "humidity_max_pct": profile["humidity_max"],
            }
        )

    return products


def generate_events_for_batch(product: dict) -> list[dict]:
    """Return 6 events for one batch, timestamped forward from manufacture_ts."""
    manufacture_ts = datetime.fromisoformat(product["manufacture_ts"])
    batch_id = product["batch_id"]

    override = SHOWCASE_OVERRIDES.get(batch_id)
    if override:
        hours_to_dispatch = 6
        loading_hours = 1
        transit_hours = override["transit_hours"]
        unloading_hours = 1
        warehouse_dwell_hours = override["warehouse_dwell_hours"]
        last_mile_hours = 2
    else:
        hours_to_dispatch = random.uniform(4, 12)
        loading_hours = random.uniform(0.5, 2)
        transit_hours = _sample_transit_hours()
        unloading_hours = random.uniform(0.5, 2)
        warehouse_dwell_hours = random.uniform(12, 96)
        last_mile_hours = random.uniform(1, 4)

    segment_hours = [
        hours_to_dispatch,
        loading_hours,
        transit_hours,
        unloading_hours,
        warehouse_dwell_hours,
        last_mile_hours,
    ]

    events = []
    current_ts = manufacture_ts
    for event_type, hours in zip(EVENT_SEQUENCE, segment_hours):
        current_ts += timedelta(hours=hours)
        events.append(
            {
                "batch_id": batch_id,
                "event_type": event_type,
                "ts": current_ts.isoformat(timespec="seconds"),
                "location": random.choice(LOCATIONS[event_type]),
            }
        )

    return events


def _sample_transit_hours() -> float:
    """Transit is mostly 6-24 hrs, but ~15% of the time we hit a delay (24-72 hrs)."""
    if random.random() < 0.15:
        return random.uniform(24, 72)
    return random.uniform(6, 24)


def segments_from_events(product: dict, events: list[dict]) -> list[Segment]:
    """
    Split the journey into named segments with a baseline temperature per segment.
    'manufacture' + 6 events = 7 timestamps = 6 segments between them.
    """
    ts_points = [datetime.fromisoformat(product["manufacture_ts"])]
    ts_points.extend(datetime.fromisoformat(e["ts"]) for e in events)

    temp_max = product["temp_max_c"]
    temp_min = product["temp_min_c"]

    # A believable baseline is just above temp_min (well within safe range).
    # Different environments (truck vs warehouse) drift a bit.
    def env_baseline(name: str) -> float:
        drift = {
            "at_plant": 0.5,
            "loading": 1.0,
            "transit": 1.5,  # trucks run warmer than chillers
            "unloading": 1.0,
            "at_warehouse": 0.8,
            "last_mile": 1.2,
        }[name]
        return temp_min + drift

    segment_names = ["at_plant", "loading", "transit", "unloading", "at_warehouse", "last_mile"]

    segments = []
    for i, name in enumerate(segment_names):
        segments.append(
            Segment(
                name=name,
                start_ts=ts_points[i],
                end_ts=ts_points[i + 1],
                baseline_temp_c=env_baseline(name),
            )
        )
    return segments


def generate_telemetry_for_batch(product: dict, events: list[dict]) -> list[dict]:
    """Sample temp + humidity every TELEMETRY_INTERVAL_MIN across the whole journey."""
    segments = segments_from_events(product, events)
    batch_id = product["batch_id"]
    temp_max = product["temp_max_c"]

    # Decide if this batch has an excursion window.
    transit_segment = next(s for s in segments if s.name == "transit")
    transit_hours = (transit_segment.end_ts - transit_segment.start_ts).total_seconds() / 3600
    is_delayed = transit_hours >= DELAYED_TRANSIT_HOURS
    excursion_prob = EXCURSION_PROB_DELAYED if is_delayed else EXCURSION_PROB_NORMAL

    override = SHOWCASE_OVERRIDES.get(batch_id)
    if override and override.get("force_excursion"):
        # Deterministic excursion for demo
        ex_start = transit_segment.start_ts + timedelta(hours=3)
        ex_end = ex_start + timedelta(hours=override["excursion_hours"])
        excursion_window = (ex_start, ex_end, override["excursion_peak_c"])
    elif override:
        excursion_window = None
    else:
        excursion_window = None
        if random.random() < excursion_prob:
            excursion_window = _pick_excursion_window(transit_segment, temp_max)

    # Walk the timeline in 15-min steps.
    rows = []
    ts = segments[0].start_ts
    interval = timedelta(minutes=TELEMETRY_INTERVAL_MIN)
    end_ts = segments[-1].end_ts

    while ts <= end_ts:
        seg = _segment_containing(segments, ts)
        temp = seg.baseline_temp_c + random.gauss(0, TEMP_NOISE_STD)

        if excursion_window is not None:
            ex_start, ex_end, ex_peak = excursion_window
            if ex_start <= ts <= ex_end:
                temp = ex_peak + random.gauss(0, TEMP_NOISE_STD)

        humidity = _humidity_for_segment(product, seg)

        rows.append(
            {
                "batch_id": batch_id,
                "ts": ts.isoformat(timespec="seconds"),
                "temp_c": round(temp, 2),
                "humidity_pct": round(humidity, 1),
            }
        )
        ts += interval

    return rows


def _pick_excursion_window(
    transit_seg: Segment, temp_max: float
) -> tuple[datetime, datetime, float]:
    """Choose a start, end, and peak temperature for one excursion inside transit."""
    total_hours = (transit_seg.end_ts - transit_seg.start_ts).total_seconds() / 3600
    duration_hours = random.uniform(*EXCURSION_DURATION_HOURS_RANGE)
    duration_hours = min(duration_hours, total_hours * 0.8)

    max_start_offset = max(0.0, total_hours - duration_hours)
    start_offset = random.uniform(0, max_start_offset)

    ex_start = transit_seg.start_ts + timedelta(hours=start_offset)
    ex_end = ex_start + timedelta(hours=duration_hours)
    peak = temp_max + random.uniform(*EXCURSION_TEMP_ABOVE_MAX_RANGE)
    return ex_start, ex_end, peak


def _segment_containing(segments: list[Segment], ts: datetime) -> Segment:
    """Find which segment this timestamp falls into."""
    for seg in segments:
        if seg.start_ts <= ts <= seg.end_ts:
            return seg
    return segments[-1]  # fallback for the final boundary


def _humidity_for_segment(product: dict, seg: Segment) -> float:
    """Simple humidity model — baseline plus a bump near the warehouse."""
    baseline = product["humidity_max_pct"] - 15
    if seg.name in ("at_warehouse", "loading", "unloading"):
        baseline += random.uniform(3, 10)
    return baseline + random.gauss(0, HUMIDITY_NOISE_STD)


def compute_ground_truth_for_batch(
    product: dict,
    events: list[dict],
    telemetry: list[dict],
) -> dict:
    """
    Synthetic 'true' remaining shelf life at retail arrival.

    Formula:
        remaining = nominal - age
                    - k1 * cumulative_thermal_exposure
                    - k2 * hours_above_humidity_max
                    - k3 * longest_excursion_hours ** 2
                    + noise
    Floor at 0.
    """
    manufacture_ts = datetime.fromisoformat(product["manufacture_ts"])
    retail_in_ts = _event_ts(events, "retail_in")

    nominal = product["nominal_shelf_life_hours"]
    age_hours = (retail_in_ts - manufacture_ts).total_seconds() / 3600

    # Aggregate features from telemetry
    temp_max = product["temp_max_c"]
    humidity_max = product["humidity_max_pct"]
    step_hours = TELEMETRY_INTERVAL_MIN / 60

    cumulative_thermal_exposure = 0.0  # degree-hours above temp_max
    hours_above_humidity_max = 0.0
    current_excursion_hours = 0.0
    longest_excursion_hours = 0.0

    for row in telemetry:
        temp = float(row["temp_c"])
        humidity = float(row["humidity_pct"])

        if temp > temp_max:
            cumulative_thermal_exposure += (temp - temp_max) * step_hours
            current_excursion_hours += step_hours
            if current_excursion_hours > longest_excursion_hours:
                longest_excursion_hours = current_excursion_hours
        else:
            current_excursion_hours = 0.0

        if humidity > humidity_max:
            hours_above_humidity_max += step_hours

    remaining = (
        nominal
        - age_hours
        - K_THERMAL * cumulative_thermal_exposure
        - K_HUMIDITY * hours_above_humidity_max
        - K_EXCURSION_SQ * (longest_excursion_hours**2)
        + random.gauss(0, GROUND_TRUTH_NOISE_STD)
    )
    remaining = max(remaining, GROUND_TRUTH_FLOOR_HOURS)

    return {
        "batch_id": product["batch_id"],
        "remaining_life_hours_at_retail": round(remaining, 2),
    }


def _event_ts(events: list[dict], event_type: str) -> datetime:
    """Look up the timestamp of a specific event type for one batch."""
    for e in events:
        if e["event_type"] == event_type:
            return datetime.fromisoformat(e["ts"])
    raise ValueError(f"missing {event_type} event")


def write_csv(name: str, rows: list[dict], columns: list[str]) -> None:
    path = CSV_DIR / name
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
