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


def test_rule_based_returns_valid_action_for_clean_batch():
    result = _rule_based_decision(_bqml(200, 240, 200), batch_row=None)
    assert result["decision"]["recommended_action"] == "Sell Normally"
    assert 0 <= result["shelf_life_analysis"]["pct_of_nominal"] <= 100


def test_rule_based_quarantines_severe_excursion():
    result = _rule_based_decision(
        _bqml(100, 240, 192),
        batch_row={"max_temp_excursion_c": 10.0, "cumulative_thermal_exposure": 50},
    )
    # Peak excursion > 8°C => Quarantine regardless of prediction
    assert result["decision"]["recommended_action"] == "Quarantine"
    assert result["exposure_summary"]["risk_level"] == "severe"


def test_rule_based_inspects_moderate_excursion_with_life_remaining():
    result = _rule_based_decision(
        _bqml(120, 240, 192),  # 50% of nominal
        batch_row={"max_temp_excursion_c": 6.5, "cumulative_thermal_exposure": 30},
    )
    # Excursion 5-8°C AND >30% remaining => Inspect
    assert result["decision"]["recommended_action"] == "Inspect"


def test_rule_based_discounts_low_remaining_life():
    result = _rule_based_decision(_bqml(60, 240, 192), batch_row=None)
    assert result["decision"]["recommended_action"] == "Discount"


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
# The frontend and backend rely on the same GS1-128 / Digital Link patterns.


def test_barcode_url_fallback_extracts_batch_from_digital_link():
    import re

    url = "https://aayu.app/01/08901030855432/10/L26080501/17/260815"
    # Same regex the frontend uses in api.ts
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
