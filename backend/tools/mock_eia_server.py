"""A tiny stand-in for the EIA API v2 spot-price route, for demos and screenshots when no real EIA key is available.

NOT EIA, and NOT live data. It answers on 127.0.0.1 in the documented v2 reply shape with the six daily closes (13 to 20 Oct 2026) that
EIA's public table page showed when it was read on 25 Oct 2026, so the REAL adapter (backend/services/price_feed.py) can be exercised end
to end over real HTTP. Anything the ticker shows from it must be described as "from a mock EIA server", never as EIA data.

    python tools/mock_eia_server.py --mode ok            # 200 with the table below
    python tools/mock_eia_server.py --mode invalid_key   # 403 {"error": {"code": "API_KEY_INVALID", ...}}  (as the real API answers)
    python tools/mock_eia_server.py --mode error         # 503
    python tools/mock_eia_server.py --mode slow          # answers after 20 s (to trigger the client's timeout)

Then start the backend with:  EIA_BASE_URL=http://127.0.0.1:8765/v2  EIA_API_KEY=any-dummy-value
"""

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

ROWS = [  # (period, WTI RWTC, Brent RBRTE): the table EIA's public page showed; 12 Oct is a US holiday (blank)
    ("2026-10-20", "107.89", "115.22"), ("2026-10-19", "110.01", "118.82"), ("2026-10-16", "108.21", "119.33"),
    ("2026-10-15", "104.71", "126.35"), ("2026-10-14", "96.34", "126.55"), ("2026-10-13", "95.39", "125.78"), ("2026-10-12", "", ""),
]
MODE = "ok"


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        if not url.path.endswith("/petroleum/pri/spt/data/"):
            return self._send(404, {"error": {"code": "NOT_FOUND", "message": "no such route"}})
        if "api_key" not in q:
            return self._send(403, {"error": {"code": "API_KEY_MISSING", "message": "No api_key was supplied."}})
        if MODE == "invalid_key":
            return self._send(403, {"error": {"code": "API_KEY_INVALID", "message": "An invalid api_key was supplied."}})
        if MODE == "error":
            return self._send(503, {"error": {"code": "UNAVAILABLE", "message": "upstream unavailable"}})
        if MODE == "slow":
            time.sleep(20)
        wanted = set(q.get("facets[series][]", ["RWTC", "RBRTE"]))
        data = []
        for period, wti, brent in ROWS:
            for series, value in (("RWTC", wti), ("RBRTE", brent)):
                if series in wanted:
                    data.append({"period": period, "series": series, "value": value, "units": "$/BBL"})
        self._send(200, {"response": {"total": len(data), "dateFormat": "YYYY-MM-DD", "frequency": "daily", "data": data}, "apiVersion": "2.1.10-mock"})

    def log_message(self, *args):          # keep the console quiet (and never print query strings)
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["ok", "invalid_key", "error", "slow"], default="ok")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    MODE = args.mode
    print(f"MOCK EIA server (not EIA, not live) on http://127.0.0.1:{args.port}/v2 in mode '{MODE}'", flush=True)
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
