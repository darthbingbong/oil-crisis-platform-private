"""Repo hygiene: .env.example lists every variable the code reads (with no real values), secrets and the big workbook are git-ignored and untracked,
and no key value from the local .env appears in any tracked file. Checks that need git are skipped on a clean export (no .git folder)."""
import re
import subprocess
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
HAS_GIT = (ROOT / ".git").exists()


def _env_names_read_by_code() -> set[str]:
    names: set[str] = set()
    for p in list(BACKEND.glob("*.py")) + list((BACKEND / "services").glob("*.py")) + list((BACKEND / "routers").glob("*.py")) + list((BACKEND / "news").glob("*.py")):
        text = p.read_text(encoding="utf-8")
        names |= set(re.findall(r'os\.environ\.get\(\s*"([A-Z][A-Z0-9_]+)"', text))
        names |= set(re.findall(r'os\.environ\[\s*"([A-Z][A-Z0-9_]+)"\s*\]', text))
        names |= set(re.findall(r'getenv\(\s*"([A-Z][A-Z0-9_]+)"', text))
    # SECRET_ENV_NAMES / KEY_ENV constants name the keys too
    names |= set(re.findall(r'KEY_ENV\s*=\s*"([A-Z][A-Z0-9_]+)"', (BACKEND / "services" / "ais_feed.py").read_text(encoding="utf-8")))
    return names


def _example_assignments() -> dict[str, str]:
    """Every NAME=value line in .env.example, including the commented-out optional ones ("# NAME=value")."""
    out: dict[str, str] = {}
    for line in (BACKEND / ".env.example").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*#?\s*([A-Z][A-Z0-9_]+)=(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def test_env_example_lists_every_variable_the_code_reads():
    read, listed = _env_names_read_by_code(), set(_example_assignments())
    assert read, "no environment variables found: the scan is broken"
    assert not (read - listed), f"read by the code but missing from .env.example: {sorted(read - listed)}"


def test_env_example_has_no_real_values():
    for name, value in _example_assignments().items():
        if "KEY" in name:
            assert value == "", f"{name} has a value in .env.example"
        assert not re.search(r"[A-Za-z0-9_\-]{30,}", value), f"{name} looks like a secret in .env.example"


def test_gitignore_covers_the_secrets_and_the_big_workbook():
    text = (ROOT / ".gitignore").read_text(encoding="utf-8")
    assert "backend/.env" in text and "backend/data/globalEnergyOwnership.xlsx" in text


def test_readme_says_where_to_download_the_workbook():
    text = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "globalenergymonitor.org/projects/global-energy-ownership-tracker" in text and "globalEnergyOwnership.xlsx" in text


@pytest.mark.skipif(not HAS_GIT, reason="needs a git checkout")
def test_no_env_file_or_workbook_is_tracked():
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8").stdout.splitlines()
    assert not [f for f in tracked if re.search(r"(^|/)\.env($|\.)", f) and not f.endswith(".example")]
    assert not [f for f in tracked if f.lower().endswith((".xlsx", ".xls"))]


@pytest.mark.skipif(not HAS_GIT or not (BACKEND / ".env").exists(), reason="needs a git checkout and a local .env")
def test_no_key_value_from_the_local_env_is_in_a_tracked_file_or_in_history():
    values = []
    for line in (BACKEND / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Z_]+)\s*=(.*)$", line)
        if m and "KEY" in m.group(1) and len(m.group(2).strip().strip("\"'")) >= 8:
            values.append(m.group(2).strip().strip("\"'"))
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8").stdout.splitlines()
    for f in tracked:
        try:
            text = (ROOT / f).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        assert not any(v in text for v in values), f"a key value from .env is in tracked file {f}"
    for v in values:                                    # pickaxe over every commit on every branch
        hits = subprocess.run(["git", "log", "--all", "--oneline", "-S" + v], cwd=ROOT, capture_output=True, text=True, encoding="utf-8").stdout.strip()
        assert hits == "", "a key value from .env is in git history"
