"""Every number quoted in a report's text must match a value in the same report payload (or a documented constant).

The summaries are templates filled with computed values, so this guards against a template quoting a hard-coded or stale number
that disagrees with the chart data. For each number in a summary / takeaway / warning we apply the display scale (a trailing
"million") and precision (digits after the decimal point) and require some payload value to round to it.
"""

import re

import pytest
from fastapi.testclient import TestClient

from main import app
from services.config import DEFAULT_CONFIG as CFG

client = TestClient(app)

NUMBER = re.compile(r"(?<![A-Za-z0-9.\-])([+\-]?)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s+million)?")

# Constants that legitimately appear in text but are not per-scenario payload values. Each one is documented config, not a free literal.
ALLOWED = {
    CFG.elasticity_abs,          # "supply loss divided by 0.15" (the Phase 1 formula)
    CFG.price_band_pp,           # "plus or minus 13.09 percentage points"
    CFG.li_kg_per_kwh,           # "0.10 kg Li per kWh" in the chemistry caveat
    10.0,                        # "per +10% oil price" (the IMF rule of thumb is stated per 10%)
    2024.0,                      # "ICCT 2024" in the chemistry caveat (source year, cited in config)
}

SCENARIOS = [
    dict(route_id="hormuz", duration_days=30),                                            # outside the validated range, bypass sensitivity
    dict(route_id="hormuz", duration_days=45, blocked_share_pct=60, lithium_availability_pct=40),
    dict(route_id="suez", disruption_type="detour", detour_days=20, duration_days=60),     # the demo case
    dict(route_id="suez", disruption_type="detour", duration_days=30),                     # default detour
    dict(route_id="bab_el_mandeb", disruption_type="detour", detour_days=10, duration_days=90, ev_substitution_rate_pct=50),
    dict(route_id="malacca", duration_days=20, blocked_share_pct=100),                     # only China sourced as an importer
    dict(route_id="danish_straits", disruption_type="detour", detour_days=5),              # no importer data at all
    dict(route_id="suez", blocked_share_pct=20),                                           # fully covered by bypass: zero displaced
    dict(route_id="turkish_straits", disruption_type="detour", detour_days=3, horizon_years=3),
]


# The dense daily series (181 points each) would let almost any number match by chance, so they are not part of the pool:
# a quoted number has to equal a real headline value (KPI, section numbers, chart summary values), not just lie on a curve.
DENSE_SERIES = {"trajectory", "series"}


def payload_numbers(obj, out=None):
    out = [] if out is None else out
    if isinstance(obj, bool) or obj is None:
        return out
    if isinstance(obj, (int, float)):
        out.append(abs(float(obj)))
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k not in DENSE_SERIES:
                payload_numbers(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            payload_numbers(v, out)
    return out


def quoted_numbers(text):
    """(value, decimals, scale, raw) for every number in `text`."""
    found = []
    for sign, digits, million in NUMBER.findall(text):
        decimals = len(digits.split(".")[1]) if "." in digits else 0
        found.append((float(digits.replace(",", "")), decimals, 1e6 if million else 1.0, f"{sign}{digits}{million}"))
    return found


def matches(value, decimals, scale, numbers):
    tol = 0.5 * 10 ** (-decimals) + 1e-9
    return any(abs(n / scale - value) <= tol for n in numbers)


def texts_to_check(report):
    for key, sec in report["sections"].items():
        yield f"{key}.summary", sec["summary"]
        yield f"{key}.takeaway", sec["takeaway"]
    if report["kpis"].get("validated_note"):
        yield "kpis.validated_note", report["kpis"]["validated_note"]
    for i, c in enumerate(report["caveats"]):
        yield f"caveats[{i}]", c


@pytest.mark.parametrize("body", SCENARIOS, ids=lambda b: f"{b['route_id']}-{b.get('disruption_type', 'blockade')}-{len(b)}")
def test_every_quoted_number_matches_the_payload(body):
    r = client.post("/api/v1/simulate/report", json=body)
    assert r.status_code == 200, r.text
    report = r.json()
    numbers = payload_numbers(report) + [abs(a) for a in ALLOWED]
    problems = []
    checked = 0
    for where, text in texts_to_check(report):
        for value, decimals, scale, raw in quoted_numbers(text):
            checked += 1
            if not matches(value, decimals, scale, numbers):
                problems.append(f"{where}: '{raw}' is not in the payload  <-  ...{text[max(0, text.find(raw) - 40):text.find(raw) + 40]}...")
    assert checked > 30, "the number extractor found suspiciously few numbers"
    assert not problems, "\n" + "\n".join(problems)


def test_the_checker_actually_catches_a_wrong_number():
    """Guard the guard: if a summary quoted 999 barrels, this test machinery must flag it."""
    report = client.post("/api/v1/simulate/report", json=SCENARIOS[2]).json()
    numbers = payload_numbers(report) + [abs(a) for a in ALLOWED]
    assert not matches(4_271_999.0, 0, 1.0, numbers)                                    # off by a few hundred barrels
    assert not matches(27.9, 1, 1.0, numbers)                                           # the real price move is 27.6
    assert matches(round(report["kpis"]["price_impact_pct"], 1), 1, 1.0, numbers)
    assert matches(round(report["kpis"]["displaced_bpd"]), 0, 1.0, numbers)


def test_demo_case_numbers_in_the_text_equal_the_kpis():
    rep = client.post("/api/v1/simulate/report", json=SCENARIOS[2]).json()
    k = rep["kpis"]
    assert f"{k['displaced_bpd']:,.0f}" in rep["sections"]["barrels"]["summary"]
    assert f"{k['price_impact_pct']:+.1f}%" in rep["sections"]["price"]["summary"]
    assert f"{k['evs_required'] / 1e6:,.1f} million" in rep["sections"]["evs"]["summary"]
    assert f"{k['extra_lithium_t_lce']:,.0f}" in rep["sections"]["lithium"]["summary"]
    assert f"{k['lithium_deficit_t_lce']:,.0f}" in rep["sections"]["lithium"]["summary"]


# ---------------------------------------------------------------------------
# The brief asks for a 2 to 4 sentence summary per section.
# ---------------------------------------------------------------------------
SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z(])")


def sentence_count(text):
    return len([p for p in SENTENCE_END.split(text.strip()) if p])


@pytest.mark.parametrize("body", SCENARIOS, ids=lambda b: f"{b['route_id']}-{b.get('disruption_type', 'blockade')}-{len(b)}")
def test_every_section_summary_is_two_to_four_sentences(body):
    report = client.post("/api/v1/simulate/report", json=body).json()
    bad = {k: sentence_count(sec["summary"]) for k, sec in report["sections"].items() if not 2 <= sentence_count(sec["summary"]) <= 4}
    assert not bad, f"summaries outside 2-4 sentences: {bad}"


def test_sentence_counter_counts_decimals_and_percentages_as_one_sentence():
    assert sentence_count("A 4.14% loss implies +27.6% (divided by 0.15). It holds for 60 days.") == 2
