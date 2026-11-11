r"""Make the export's documents follow the export's own data (estimated voyage distances, no saved tankers).
Usage: python export_docs.py <export folder> <python of a venv that has the backend requirements>"""
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

DEST = Path(sys.argv[1]).resolve()
PY = sys.argv[2]
PROJECT = Path(r"C:\oil-crisis-platform")
HERE = Path(__file__).resolve().parent


def dump(py, tree):
    env = {k: v for k, v in os.environ.items() if k not in ("HOSTED_MODE", "AIS_TODAY")}
    env.update(PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1")
    r = subprocess.run([py, str(HERE / "claims_dump.py"), str(tree / "backend" / "tools" / "check_claims.py")], cwd=tree / "backend", capture_output=True, text=True, encoding="utf-8", env=env)
    line = next((l for l in r.stdout.splitlines() if l.startswith("@@JSON@@")), None)
    if not line:
        raise SystemExit("claims dump failed:\n" + r.stdout[-800:] + r.stderr[-1500:])
    return json.loads(line[len("@@JSON@@"):])


priv = dump(str(PROJECT / "backend" / "venv" / "Scripts" / "python.exe"), PROJECT)
pub = dump(PY, DEST)


def keyed(rows):
    seen, out = defaultdict(int), {}
    for ok, doc, label, exp in rows:
        seen[(doc, label)] += 1
        out[(doc, label, seen[(doc, label)])] = exp
    return out


kp, ku = keyed(priv), keyed(pub)
changes = [(k, kp[k], ku[k]) for k in kp if k in ku and kp[k] != ku[k] and k[0] in ("README.md", "LIMITATIONS_AND_FUTURE_WORK.md")]
docs = {n: (DEST / n).read_text(encoding="utf-8") for n in ("README.md", "LIMITATIONS_AND_FUTURE_WORK.md")}
done, ambiguous = 0, []
for (doc, label, _), old, new in changes:
    if docs[doc].count(old) == 1:
        docs[doc] = docs[doc].replace(old, new)
        done += 1
    elif doc == "README.md" and "Worked example, a **20-day detour of Suez**" in docs[doc]:
        i = docs[doc].index("Worked example, a **20-day detour of Suez**")
        j = docs[doc].find("\n## ", i)
        j = len(docs[doc]) if j < 0 else j
        region = docs[doc][i:j]
        if old in region:
            docs[doc] = docs[doc][:i] + region.replace(old, new) + docs[doc][j:]
            done += 1
        else:
            ambiguous.append((doc, label, old, docs[doc].count(old)))
    else:
        ambiguous.append((doc, label, old, docs[doc].count(old)))
print(f"claims remapped to the estimated set: {done}; ambiguous: {ambiguous}")

# fixed passages that describe the private copy
README_EDITS = [
    ("**Version 2.0.**", "> **Public edition.** This is the public copy of the project. It contains **no ShipFinder data** (no real vessel positions, tracks or route-planning responses; whether a provider's data may be shown publicly is unconfirmed, `docs/DECISIONS.md` D10, D27, D29): vessels are **SIMULATED**, and the voyage lengths are the project's **earlier estimates** (great-circle sums over illustrative waypoints, divided by 14 knots), so the Suez worked example below uses 21.2 days. Passages that talk about the saved real tankers, the 19.5-day ShipFinder voyage, the author's demo script or the screenshots describe the author's private copy and are kept as the project's history; the files they mention are not in this repository. The hosted-mode switches are in [Hosted mode](#hosted-mode-m16).\n>\n> **Version 2.0.**"),
]
for a, b in README_EDITS:
    assert a in docs["README.md"], a
    docs["README.md"] = docs["README.md"].replace(a, b, 1)


def replace_line(text, starts, new):
    lines = text.split("\n")
    idx = [i for i, l in enumerate(lines) if l.startswith(starts)]
    assert len(idx) == 1, (starts, idx)
    lines[idx[0]] = new
    return "\n".join(lines)


R = docs["README.md"]
R = replace_line(R, "| ShipFinder Open Platform (Starter plan key", "| ShipFinder Open Platform | **Not in this public edition.** In the author's private copy only: planned sea distances for the voyage days and 12 saved real tankers with their tracks. None of that data is in this repository (public display unconfirmed, DECISIONS D10, D27, D29) | 2026-11 | <https://docs.shipfinder.com> |")
R = replace_line(R, "| 2 | Voyage length T |", "| 2 | Voyage length T | estimated sea distance Ras Tanura to Rotterdam (great-circle sum over illustrative waypoints, 7,126 nm) / 14 knots | 21.2 days |")
R = replace_line(R, "6. **Voyage days**", "6. **Voyage days** are an ESTIMATE in this public edition: a great-circle distance summed over illustrative waypoints, divided by 14 knots (the project's tanker speed, an assumption). The default Suez detour (12.7 days) is the Cape estimate minus the Suez estimate. The author's private copy uses ShipFinder planned distances instead (D29). The globe lines are illustrative.")
R = replace_line(R, "- **Voyage days now come from real planned sea distances**", "- **Voyage days (private copy only): real planned sea distances** (ShipFinder route planning, retrieved 2026-11-02) replaced great-circle sums over hand-placed waypoints: Suez and Bab el-Mandeb 21.2 to 19.5 days, Hormuz and Malacca 17.2 to 17.5, Turkish Straits 5.1 to 5.0, Danish Straits 4.2 (unchanged), the Cape voyage 33.9 to 33.5, the default Suez detour 12.7 to 14.0 days. **This public edition keeps the earlier values** (before: `docs/m10_voyage_before.json`).")
R = replace_line(R, "- Raw provider responses are kept only in git-ignored folders;", "- No raw provider response and no ShipFinder-derived number is in this repository; the voyage lengths are the earlier estimates.")
docs["README.md"] = R
for n, t in docs.items():
    (DEST / n).write_text(t, encoding="utf-8", newline="\n")

