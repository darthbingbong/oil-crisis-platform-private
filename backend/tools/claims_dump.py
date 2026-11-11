"""Run tools/check_claims.py up to its report section and print every claim as JSON: [[ok, doc, label, expected], ...]. Usage: python claims_dump.py <path to check_claims.py>"""
import json
import re
import sys
from pathlib import Path

p = Path(sys.argv[1])
src = p.read_text(encoding="utf-8")
head = re.split(r"# -+ report\n", src)[0]
g = {"__file__": str(p), "__name__": "claims_dump"}
sys.path.insert(0, str(p.parent.parent))
import logging  # noqa: E402

logging.disable(logging.CRITICAL)
exec(compile(head, str(p), "exec"), g)
print("@@JSON@@" + json.dumps(g["results"]))
