"""The AIS backup tool copies raw provider data and the call log, and refuses to keep a copy that contains the key value."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import backup_ais_data  # noqa: E402


def _tree(tmp_path: Path, secret_in_file: bool = False):
    raw = tmp_path / "ais_raw"
    raw.mkdir()
    (raw / "ports.json").write_text('{"port_code": "AEFJR"}', encoding="utf-8")
    (raw / "nested").mkdir()
    (raw / "nested" / "track.json").write_text('{"leak": "SECRETSECRET123"}' if secret_in_file else "{}", encoding="utf-8")
    log = tmp_path / "ais_calls.jsonl"
    log.write_text('{"service": "port_info", "status": 0}\n', encoding="utf-8")
    env = tmp_path / ".env"
    env.write_text("EIA_API_KEY=otherkeyotherkey\nAIS_API_KEY=SECRETSECRET123\n", encoding="utf-8")
    return [(raw, "ais_raw"), (log, "logs/ais_calls.jsonl")], env


def test_backup_copies_raw_data_and_log(tmp_path):
    sources, env = _tree(tmp_path)
    folder, files, size = backup_ais_data.backup(tmp_path / "out", sources, env)
    assert files == 3 and size > 0
    assert (folder / "ais_raw" / "nested" / "track.json").exists() and (folder / "logs" / "ais_calls.jsonl").exists()
    assert not list(folder.rglob(".env"))


def test_backup_is_deleted_if_it_contains_the_key(tmp_path):
    sources, env = _tree(tmp_path, secret_in_file=True)
    with pytest.raises(RuntimeError, match="key value was found"):
        backup_ais_data.backup(tmp_path / "out", sources, env)
    assert not any((tmp_path / "out").glob("ais_*"))


def test_backup_with_nothing_recorded_is_not_an_error(tmp_path):
    folder, files, size = backup_ais_data.backup(tmp_path / "out", [(tmp_path / "missing", "ais_raw")], tmp_path / ".env")
    assert files == 0 and size == 0


def test_two_backups_in_the_same_second_do_not_collide(tmp_path, monkeypatch):
    sources, env = _tree(tmp_path)
    monkeypatch.setattr(backup_ais_data.time, "gmtime", lambda *a: __import__("time").struct_time((2026, 11, 3, 16, 28, 13, 0, 0, 0)))
    first, n1, _ = backup_ais_data.backup(tmp_path / "out", sources, env)
    second, n2, _ = backup_ais_data.backup(tmp_path / "out", sources, env)
    assert first != second and n1 == n2 == 3 and second.name.endswith("_2")
    third, _, _ = backup_ais_data.backup(tmp_path / "out", sources, env)
    assert third.name.endswith("_3") and (first / "ais_raw" / "ports.json").exists()
