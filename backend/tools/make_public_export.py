r"""Make the clean public export of one tag of the private repository. Usage: python make_public_export.py <git-ref> <destination-folder>

* The destination must be OUTSIDE the project and empty or missing.  Nothing is ever pushed from here.
* The source is `git archive <ref>`: tracked files only, so .env, logs, the GEM workbook, raw AIS data and every git-ignored file cannot be in it.
* Then everything that must not be redistributed is removed (see REMOVE below) and the voyage distances are replaced by the earlier ESTIMATED set (DECISIONS D29).
* No git history is copied; the folder is NOT a git repository when this finishes.
"""
import io
import json
import re
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

PROJECT = Path(r"C:\oil-crisis-platform")
ref, dest = sys.argv[1], Path(sys.argv[2]).resolve()
assert PROJECT not in dest.parents and dest != PROJECT, "the export must be outside the project folder"
assert not dest.exists() or not any(dest.iterdir()), "destination is not empty"

REMOVE_EXACT = [
    "MASTER_PROMPT.md", "MASTER_PROMPT_2.md",                         # private build prompts
    "backend/data/ais_route_plans.json",                               # raw ShipFinder route-planning responses (provider data)
    "docs/ais_verification.md", "docs/ais_budget_proposal.md",         # notes on the provider's responses and account
    "docs/m10_route_planning_before_after.md", "docs/m10_voyage_after.json",   # ShipFinder-derived voyage numbers
    "backend/tools/prewarm_ais.py", "backend/tools/backup_ais_data.py", "backend/tools/plan_routes.py", "backend/tools/apply_route_plans.py",
    "backend/tools/make_public_export.py", "backend/tools/export_docs.py", "backend/tools/claims_dump.py",   # the export tooling itself
    "DEMO_SCRIPT.md", "backend/tools/make_demo_script.py", "backend/tools/demo_script_template.md",   # a script for presenting the author's saved tankers; generated from them
    "frontend/verify_debug_hover_shot.png",
]
REMOVE_PREFIX = [".claude/", "logs/", "backend/logs/"]
REMOVE_REGEX = [r"^docs/(?!m16_)[a-z0-9_]*screenshots/"]              # evidence screenshots show real tanker positions; only the hosted (simulated-only) set stays

dest.mkdir(parents=True, exist_ok=True)
raw = subprocess.run(["git", "archive", ref], cwd=PROJECT, capture_output=True, check=True).stdout
with tarfile.open(fileobj=io.BytesIO(raw)) as t:
    t.extractall(dest, filter='data')
commit = subprocess.run(["git", "rev-parse", ref + "^{commit}"], cwd=PROJECT, capture_output=True, text=True, check=True).stdout.strip()

removed = []
for p in sorted(dest.rglob("*")):
    if not p.is_file():
        continue
    rel = p.relative_to(dest).as_posix()
    if rel in REMOVE_EXACT or any(rel.startswith(x) for x in REMOVE_PREFIX) or any(re.search(x, rel) for x in REMOVE_REGEX):
        p.unlink()
        removed.append(rel)
for d in sorted([d for d in dest.rglob("*") if d.is_dir()], key=lambda x: -len(x.parts)):
    if not any(d.iterdir()):
        d.rmdir()


# ---- identifiers of real vessels (from the local, git-ignored provider data) are replaced by invented ones; emails are removed; e2e scripts that need the saved tankers are dropped
def local_identifiers():
    mm, names = set(), set()
    raw = PROJECT / "backend" / "data" / "ais_raw"
    for f in raw.rglob("*.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        stack = [d]
        while stack:
            x = stack.pop()
            if isinstance(x, dict):
                for k, v in x.items():
                    if k in ("mmsi", "MMSI") and re.fullmatch(r"\d{9}", str(v)):
                        mm.add(str(v))
                    if k in ("name", "vessel_name", "seed_name", "VesselName") and isinstance(v, str) and len(v) >= 6 and v.upper() == v:
                        names.add(v)
                    stack.append(v)
            elif isinstance(x, list):
                stack.extend(x)
    return mm, names


mmsis, vnames = local_identifiers()
text_files = [p for p in dest.rglob("*") if p.is_file() and p.suffix.lower() in {".md", ".py", ".ts", ".tsx", ".mjs", ".json", ".txt", ".csv", ".html", ".example", ".svg", ""} and "venv" not in p.parts]
used_mm = {m for p in text_files for m in mmsis if m in p.read_text(encoding="utf-8", errors="ignore")}
mm_map = {m: f"99{i:07d}" for i, m in enumerate(sorted(used_mm), 1)}
named = sorted({n for n in vnames if any(re.search(rf"\b{re.escape(n)}\b", p.read_text(encoding="utf-8", errors="ignore"), re.I) for p in text_files)}, key=len, reverse=True)
name_map = {n: f"TANKER {chr(65 + i)}" if i < 26 else f"TANKER {i}" for i, n in enumerate(named)}
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
scrubbed = []
for p in text_files:
    t = p.read_text(encoding="utf-8", errors="ignore")
    o = t
    for m, f in mm_map.items():
        t = re.sub(rf"(?<!\d){m}(?!\d)", f, t)
    for n, f in name_map.items():
        t = re.sub(rf"\b{re.escape(n)}\b", f, t, flags=re.I)
    t = EMAIL.sub("[email removed]", t)
    if t != o:
        p.write_bytes(t.encode("utf-8"))
        scrubbed.append(p.relative_to(dest).as_posix())
print(f"scrubbed {len(mm_map)} MMSIs and {len(name_map)} vessel names (invented stand-ins) in {len(scrubbed)} files")

# e2e scripts that drive the saved real tankers cannot run without them: drop them
dropped = []
for p in (dest / "frontend" / "e2e").glob("*.mjs"):
    t = p.read_text(encoding="utf-8", errors="ignore")
    if any(f in t for f in mm_map.values()) or any(f in t for f in name_map.values()) or "watchlist" in t.lower() or "DEMO_SCRIPT" in t:
        if p.name not in ("m16_hosted.mjs", "m16_bundle_scan.mjs", "viewstate_unit.mjs", "markets_unit.mjs", "vessels_ais_mock.mjs"):
            dropped.append(p.name)
            p.unlink()
print("dropped e2e scripts that need the saved tankers or the author's demo script:", dropped)

# estimated voyage distances baked into routes.json (the same function hosted mode uses)
sys.path.insert(0, str(dest / "backend"))
from services.voyage_sets import estimated_voyages  # noqa: E402

rp = dest / "backend" / "data" / "routes.json"
doc = json.loads(rp.read_text(encoding="utf-8"))
rp.write_text(json.dumps(estimated_voyages(doc), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
for pc in list(dest.rglob("__pycache__")):
    shutil.rmtree(pc, ignore_errors=True)
(dest / "EXPORT_INFO.txt").write_text(
    f"Clean export of the private project at {commit} ({ref}).\nNo git history. Removed: provider (ShipFinder) data, raw route plans, local tooling, private prompts, evidence screenshots showing real vessels.\n"
    "Voyage distances are the earlier ESTIMATES (DECISIONS D29).\n", encoding="utf-8")
print(f"exported {ref} ({commit[:7]}) to {dest}; removed {len(removed)} files")
for r in removed[:12]:
    print("  -", r)
