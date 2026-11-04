import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
# main.py and the loaders use paths relative to backend/ ("data/..."), and modules import flat.
os.chdir(BACKEND)
os.environ["NEWS_WARMUP"] = "0"   # the route-news warm-up hits GDELT: never start it under test (a test can opt in with monkeypatch)
sys.path.insert(0, str(BACKEND))

# /simulate reads the news pipeline's price state from SQLite. The app creates its tables in the server's startup hook, which
# TestClient does not run, so on a fresh checkout the tables would be missing. init_db() is idempotent (CREATE IF NOT EXISTS).
from news import db as _news_db  # noqa: E402

_news_db.init_db()


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _fixed_ais_date(monkeypatch):
    """The AIS key expires on 2026-11-13 and the client then refuses every call. Tests that exercise the client must not depend on the real date, so it is pinned
    before the expiry unless a test sets AIS_TODAY itself (tests/test_ais_expiry.py does)."""
    monkeypatch.setenv("AIS_TODAY", "2026-11-04")
