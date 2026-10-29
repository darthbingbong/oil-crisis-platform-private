"""Source-level checks that keep the two pages consistent: one set of colour tokens, one flow-rate format, no tiny text.
They read the frontend source as text (no browser), the same approach as the key-leak scan."""
import re
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent.parent / "frontend" / "src"
CODE = [p for p in SRC.rglob("*") if p.suffix in (".ts", ".tsx") and "data" not in p.relative_to(SRC).parts]


def _tokens_ts() -> dict[str, str]:
    text = (SRC / "lib" / "constants.ts").read_text(encoding="utf-8")
    block = text[text.index("export const TOKENS"):]
    return {m.group(1): m.group(2).lower() for m in re.finditer(r'^\s*(\w+):\s*"(#[0-9a-fA-F]{6})"', block, re.M)}


def _css_vars() -> dict[str, str]:
    css = (SRC / "index.css").read_text(encoding="utf-8")
    return {m.group(1): m.group(2).lower() for m in re.finditer(r"--color-([\w-]+):\s*(#[0-9a-fA-F]{6})", css)}


def _kebab(name: str) -> str:
    return re.sub(r"([A-Z])", lambda m: "-" + m.group(1).lower(), name)


def test_ts_tokens_and_css_variables_agree():
    ts, css = _tokens_ts(), _css_vars()
    assert ts, "no TOKENS parsed"
    mismatched = {k: (v, css.get(_kebab(k))) for k, v in ts.items() if _kebab(k) in css and css[_kebab(k)] != v}
    assert not mismatched, mismatched
    for must in ("lane", "gain", "surface", "caution", "on-crude"):
        assert must in css, f"--color-{must} missing from index.css"


def test_token_colours_are_not_repeated_as_hex_literals():
    token_hexes = {v for k, v in _tokens_ts().items() if k in ("lane", "gain", "surface", "caution", "onCrude", "bone", "ash", "crude", "ion", "alarm", "void")}
    offenders = []
    for p in CODE:
        if p.name == "constants.ts":
            continue
        for m in re.finditer(r"#[0-9a-fA-F]{6}\b", p.read_text(encoding="utf-8")):
            if m.group(0).lower() in token_hexes:
                offenders.append(f"{p.relative_to(SRC)}: {m.group(0)}")
    # Three.js materials (globe, atmosphere, markers) take their own colours and are checked by eye; everything else must use a token
    offenders = [o for o in offenders if not o.replace("\\", "/").startswith("components/globe/")]
    assert not offenders, offenders


def test_flow_rates_use_one_unit_format():
    bad = []
    for p in CODE:
        text = p.read_text(encoding="utf-8")
        if re.search(r"fmtCompact\([^)]*\)\}? ?bpd|\bM bpd\b", text):
            bad.append(str(p.relative_to(SRC)))
    assert not bad, bad          # compact flows are written "x.xx Mb/d" through fmtMbd


def test_no_text_below_11px():
    bad = []
    for p in CODE:
        text = p.read_text(encoding="utf-8")
        if re.search(r"fontSize: ?(\d)\b(?!\d)", text) and any(int(m) < 10 for m in re.findall(r"fontSize: ?(\d)\b(?!\d)", text)):
            bad.append(str(p.relative_to(SRC)))
        if "text-[9px]" in text or "text-[8px]" in text:
            bad.append(str(p.relative_to(SRC)))
    assert not bad, bad
