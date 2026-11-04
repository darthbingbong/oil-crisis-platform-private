"""Runs the plain-node unit checks for the shared view state (URL parameters) and the 2D map geometry (frontend/e2e/viewstate_unit.mjs)."""
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent.parent / "frontend"
NODE = shutil.which("node")


def _supports_strip_types() -> bool:
    if not NODE:
        return False
    r = subprocess.run([NODE, "--experimental-strip-types", "-e", "0"], capture_output=True, text=True)
    return r.returncode == 0


@pytest.mark.skipif(not _supports_strip_types(), reason="needs node 22.6+ (--experimental-strip-types)")
@pytest.mark.skipif(not (FRONTEND / "node_modules" / "@math.gl" / "web-mercator").exists(), reason="needs `npm ci` in frontend/ (the map transform check compares with deck.gl's own projection)")
def test_view_state_and_map_geometry_checks_pass():
    r = subprocess.run([NODE, "--experimental-strip-types", "e2e/viewstate_unit.mjs"], cwd=FRONTEND, capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]
    assert "checks passed" in r.stdout and "FAIL" not in r.stdout
