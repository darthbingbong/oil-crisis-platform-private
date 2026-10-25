import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
# main.py and the loaders use paths relative to backend/ ("data/..."), and modules import flat.
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))
