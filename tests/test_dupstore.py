"""dupstore: the per-account memory of duplicate sets the user chose to keep -
persistence, read-side tolerance, tenants, rename / drop."""

import json
import os
import stat

import pytest

from backend import dupstore, tenants

KEY = "<a@x.example>"


def _file(tmp_path):
    return tmp_path / "duplicates_kept.json"


def test_dismiss_restore_round_trip_survives_a_restart(tmp_path):
    assert dupstore.dismiss("identical", KEY, "acc") is True
    assert dupstore.dismiss("identical", KEY, "acc") is False
    dupstore.dismiss("possible", "p:abc", "acc")
    assert dupstore.load_account("acc") == {
        "identical": {KEY}, "possible": {"p:abc"}}
    assert dupstore.load_account("other") == {}
    dupstore._cache.clear()                         # a fresh process
    assert dupstore.load_account("acc")["identical"] == {KEY}
    assert dupstore.restore("identical", KEY, "acc") is True
    assert dupstore.restore("identical", KEY, "acc") is False
    assert "identical" not in dupstore.load_account("acc")
    assert dupstore.restore_all("acc") == 1
    assert dupstore.load_account("acc") == {}
    assert dupstore.restore_all("acc") == 0


def test_the_file_is_private_and_atomic(tmp_path):
    dupstore.dismiss("versions", KEY, "acc")
    f = _file(tmp_path)
    assert stat.S_IMODE(os.stat(f).st_mode) == 0o600
    assert json.loads(f.read_text()) == {
        "version": 1, "accounts": {"acc": {"versions": [KEY]}}}
    assert not f.with_suffix(".tmp").exists()


@pytest.mark.parametrize("kind,key", [
    ("nope", KEY), ("identical", ""), ("identical", 5),
    ("identical", "x" * 401), ("identical", "a\x00b")])
def test_bad_input_writes_nothing(tmp_path, kind, key):
    with pytest.raises(ValueError):
        dupstore.dismiss(kind, key, "acc")
    with pytest.raises(ValueError):
        dupstore.restore(kind, key, "acc")
    assert not _file(tmp_path).exists()


def test_a_damaged_file_only_forgets_what_it_cannot_read(tmp_path):
    _file(tmp_path).write_text(json.dumps({"version": 1, "accounts": {
        "acc": {"identical": [KEY, 7, "", "x" * 999], "versions": "nope",
                "bogus": [KEY]},
        "bad": ["x"]}}))
    assert dupstore.load_account("acc") == {"identical": {KEY}}
    assert dupstore.load_account("bad") == {}
    dupstore._cache.clear()
    _file(tmp_path).write_text("{not json")
    assert dupstore.load_account("acc") == {}
    dupstore._cache.clear()
    _file(tmp_path).write_text("[]")
    assert dupstore.load_account("acc") == {}


def test_the_oldest_keys_are_forgotten_past_the_cap(monkeypatch):
    monkeypatch.setattr(dupstore, "MAX_KEYS", 3)
    for i in range(5):
        dupstore.dismiss("identical", f"<{i}@x.example>", "acc")
    assert dupstore.load_account("acc")["identical"] == {
        f"<{i}@x.example>" for i in (2, 3, 4)}


def test_rename_and_drop_account():
    dupstore.dismiss("identical", KEY, "old")
    dupstore.rename_account("old", "new")
    assert dupstore.load_account("old") == {}
    assert dupstore.load_account("new") == {"identical": {KEY}}
    dupstore.drop_account("new")
    assert dupstore.load_account("new") == {}
    dupstore.drop_account("never")                  # no error


def test_tenants_do_not_share_a_file():
    dupstore.dismiss("identical", "<a@x>", "default")
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        assert dupstore.load_account("default") == {}
        dupstore.dismiss("identical", "<b@x>", "default")
        assert dupstore.load_account("default") == {"identical": {"<b@x>"}}
    assert dupstore.load_account("default") == {"identical": {"<a@x>"}}
    assert (alice.root / "duplicates_kept.json").is_file()
