r"""Copy the raw ShipFinder data (git-ignored) and the provider call log to a local backup folder.

    cd backend
    python tools\backup_ais_data.py                      # -> %USERPROFILE%\oil-crisis-backups\ais_<UTC timestamp>\
    python tools\backup_ais_data.py D:\backups\ais       # -> D:\backups\ais\ais_<UTC timestamp>\

What is copied: backend/data/ais_raw/ (recorded responses, snapshots, tracks, route plans) and logs/ais_calls.jsonl.
What is never copied: backend/.env or anything that could hold the key. The files contain provider data only, but the destination is scanned
for the key value anyway and the backup is deleted if the key is found (it should never be).
The raw data must stay out of git (see .gitignore); the key expires on 2026-11-13, so run this before then and keep the copy.
"""

import re
import shutil
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
SOURCES = [(BACKEND / "data" / "ais_raw", "ais_raw"), (ROOT / "logs" / "ais_calls.jsonl", "logs/ais_calls.jsonl")]


def _key_value(env_path: Path) -> str:
    if not env_path.exists():
        return ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^AIS_API_KEY=(.*)$", line)
        if m:
            return m.group(1).strip().strip("\"'")
    return ""


def backup(dest_root: Path, sources=SOURCES, env_path: Path = BACKEND / ".env") -> tuple[Path, int, int]:
    """Returns (backup folder, file count, bytes). Raises RuntimeError (and removes the copy) if the key value is found in it."""
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    dest, n = dest_root / f"ais_{stamp}", 1
    while dest.exists():                       # two backups in the same second (a capture step followed straight by another) must not collide
        n += 1
        dest = dest_root / f"ais_{stamp}_{n}"
    files = 0
    for src, name in sources:
        if not src.exists():
            continue
        target = dest / name
        if src.is_dir():
            shutil.copytree(src, target)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, target)
    key = _key_value(env_path)
    total = 0
    for f in dest.rglob("*") if dest.exists() else []:
        if f.is_file():
            files += 1
            total += f.stat().st_size
            if key and len(key) >= 8 and key in f.read_text(encoding="utf-8", errors="ignore"):
                shutil.rmtree(dest)
                raise RuntimeError(f"the key value was found in {f.name}; the backup was deleted. Find out how it got there before copying anything.")
    return dest, files, total


if __name__ == "__main__":
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "oil-crisis-backups"
    root.mkdir(parents=True, exist_ok=True)
    folder, n, size = backup(root)
    print(f"backed up {n} files ({size / 1024:.0f} KB) to {folder}")
    if n == 0:
        print("nothing to copy yet (no raw AIS data recorded).")
