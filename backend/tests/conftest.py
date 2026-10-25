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
