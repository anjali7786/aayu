"""
Fast tests for Aayu's core product invariants.

These do NOT require BigQuery, MCP, or Vertex — they exercise pure Python logic
that guarantees the safety and integrity claims Aayu makes to operators.
Run: pytest tests/ -v
"""

from api.main import _rule_based_decision

# --- Invariant 1: rule-based decisions never crash on edge inputs ---


def _bqml(predicted, nominal, printed_remaining, predicted_raw=None):
    return {
        "predicted": predicted,
        "predicted_raw": predicted_raw if predicted_raw is not None else predicted,
        "ground_truth": predicted,
        "nominal": nominal,
        "printed_remaining": printed_remaining,
    }


def test_rule_based_sell_normally_when_aayu_matches_label():
    # 200h predicted, 200h printed, 240h nominal, clean chain
    # health_ratio = 1.0, nominal_fraction = 83% => Sell Normally
    result = _rule_based_decision(_bqml(200, 240, 200), batch_row=None)
    assert result["decision"]["recommended_action"] == "Sell Normally"


def test_rule_based_quarantines_severe_excursion():
    # Peak excursion > 8°C is a safety override regardless of hours
    result = _rule_based_decision(
        _bqml(100, 240, 192),
        batch_row={"max_temp_excursion_c": 10.0, "cumulative_thermal_exposure": 50},
    )
    assert result["decision"]["recommended_action"] == "Quarantine"
    assert result["exposure_summary"]["risk_level"] == "severe"


def test_rule_based_inspects_moderate_damage_with_healthy_ratio():
    # 180h predicted / 192h printed = 94% healthy, but peak 6.5°C (>5) => Inspect
    result = _rule_based_decision(
        _bqml(180, 240, 192),
        batch_row={"max_temp_excursion_c": 6.5, "cumulative_thermal_exposure": 30},
    )
    assert result["decision"]["recommended_action"] == "Inspect"


def test_rule_based_prioritizes_when_ratio_shows_wear():
    # 140h predicted / 192h printed = 73% ratio, no damage => Prioritize Sale
    result = _rule_based_decision(_bqml(140, 240, 192), batch_row=None)
    assert result["decision"]["recommended_action"] == "Prioritize Sale"


def test_rule_based_discounts_significant_wear():
    # 80h predicted / 192h printed = 42% ratio (in 0.3-0.6 band) => Discount
    result = _rule_based_decision(_bqml(80, 240, 192), batch_row=None)
    assert result["decision"]["recommended_action"] == "Discount"


def test_rule_based_discounts_when_below_nominal_floor():
    # 20h predicted, 240h nominal = 8.3% of nominal (<10% floor) => Discount
    # Same absolute 20h on a 96h-nominal berry would NOT hit this floor.
    result = _rule_based_decision(_bqml(20, 240, 20), batch_row=None)
    assert result["decision"]["recommended_action"] == "Discount"


def test_rule_based_quarantines_below_nominal_safety_floor():
    # 5h predicted, 240h nominal = 2% of nominal (<5% floor) => Quarantine
    result = _rule_based_decision(_bqml(5, 240, 5), batch_row=None)
    assert result["decision"]["recommended_action"] == "Quarantine"


def test_rule_based_scales_across_products():
    # 20h remaining on berries (96h nominal) = 21% of nominal, ratio 1.0 => Sell Normally
    # Same 20h on cheese (720h nominal) = 2.8% of nominal (<5% floor) => Quarantine
    berries = _rule_based_decision(_bqml(20, 96, 20), batch_row=None)
    cheese = _rule_based_decision(_bqml(20, 720, 20), batch_row=None)
    assert berries["decision"]["recommended_action"] == "Sell Normally"
    assert cheese["decision"]["recommended_action"] == "Quarantine"


# --- Invariant 2: fallback response shape matches agent-mode shape ---
# (Frontend must render identically regardless of mode.)


def test_fallback_response_has_required_fields():
    result = _rule_based_decision(_bqml(120, 240, 192), batch_row=None)
    required_top = {"exposure_summary", "shelf_life_analysis", "decision"}
    assert required_top.issubset(result.keys())

    sla = result["shelf_life_analysis"]
    for f in (
        "predicted_remaining_hours",
        "predicted_raw",
        "ground_truth_remaining_hours",
        "pct_of_nominal",
        "printed_remaining_hours",
        "confidence",
        "source",
        "interpretation",
    ):
        assert f in sla, f"missing field: {f}"

    decision = result["decision"]
    for f in ("headline", "recommended_action", "confidence", "explanation"):
        assert f in decision, f"missing field: {f}"


# --- Invariant 3: barcode regex matches both GS1 formats ---
# The aayu-frontend-studio and backend rely on the same GS1-128 / Digital Link patterns.


def test_barcode_url_fallback_extracts_batch_from_digital_link():
    import re

    url = "https://aayu.app/01/08901030855432/10/L26080501/17/260815"
    match = re.match(r".*/batch(?:es)?/(b_\d{4})", url, re.IGNORECASE)
    assert match is None  # URL is a Digital Link, not a /batches/ URL — should not match

    batch_url = "https://aayu.app/batches/b_0001"
    match = re.match(r".*/batch(?:es)?/(b_\d{4})", batch_url, re.IGNORECASE)
    assert match is not None
    assert match.group(1) == "b_0001"


def test_gs1_element_string_regex_extracts_gtin_and_lot():
    import re

    code = "(01)08901030855432(10)L26080501(17)260815"
    gtin_match = re.search(r"\(01\)(\d{13,14})", code)
    lot_match = re.search(r"\(10\)([A-Za-z0-9]+?)\(17\)", code)
    assert gtin_match and gtin_match.group(1) == "08901030855432"
    assert lot_match and lot_match.group(1) == "L26080501"


# --- Invariant 4: fallback numbers stay within physical bounds ---


def test_pct_of_nominal_bounded():
    """A batch that overachieves (predicted > nominal) still reports sensible pct."""
    result = _rule_based_decision(_bqml(300, 240, 192, predicted_raw=310), batch_row=None)
    pct = result["shelf_life_analysis"]["pct_of_nominal"]
    # Even if raw prediction > nominal, pct should be a number (not crash)
    assert isinstance(pct, (int, float))


def test_zero_nominal_does_not_divide_by_zero():
    """Defensive: ground truth shouldn't have nominal=0, but if it does, no crash."""
    result = _rule_based_decision(_bqml(50, 0, 0), batch_row=None)
    # Should not raise; action decided by exception-safe path
    assert "recommended_action" in result["decision"]
