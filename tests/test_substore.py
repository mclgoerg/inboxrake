"""substore: what the user decided about subscriptions - persistence,
read-side tolerance, limits."""

import json
import os
import stat

import pytest

from backend import substore

KEY = "fittrack.example"


def _file(tmp_path):
    return tmp_path / "subscriptions.json"


def test_decisions_survive_a_restart_and_the_file_is_private(tmp_path):
    substore.set_hidden(KEY, True, "acc")
    substore.set_reminder("other.example", True, "acc")
    substore.set_amount(KEY, 7.99, "EUR", 1700000000, "acc")
    substore.set_body_amounts(True, "acc")
    f = _file(tmp_path)
    assert stat.S_IMODE(os.stat(f).st_mode) == 0o600
    assert not f.with_suffix(".tmp").exists()
    substore._cache.clear()                          # a fresh process
    b = substore.load_account("acc")
    assert b["hidden"] == [KEY] and b["body_amounts"] is True
    assert b["reminders"] == {"other.example": {"sent": ""}}
    assert b["amounts"] == {KEY: {"amount": 7.99, "currency": "EUR",
                                  "ts": 1700000000}}
    assert substore.load_account("nobody") == {
        "hidden": [], "kept": {}, "reminders": {}, "fired": [],
        "amounts": {}, "body_amounts": False}


@pytest.mark.parametrize("key", ["", 5, "x" * 201, "a\x00b", None])
def test_bad_keys_write_nothing(tmp_path, key):
    for call in (lambda: substore.set_hidden(key, True, "acc"),
                 lambda: substore.set_reminder(key, True, "acc"),
                 lambda: substore.set_amount(key, 1.0, "EUR", 1, "acc")):
        with pytest.raises(ValueError):
            call()
    assert not _file(tmp_path).exists()


def test_a_damaged_file_only_forgets_what_it_cannot_read(tmp_path):
    _file(tmp_path).write_text(json.dumps({"accounts": {
        "acc": {"hidden": [KEY, 7, "", "x" * 999], "reminders": {
            KEY: {"sent": "2027-01-05"}, "bad": {"sent": "yesterday"},
            "": {}},
            "amounts": {KEY: {"amount": 7.99, "currency": "EUR", "ts": 5},
                        "neg": {"amount": -1, "currency": "EUR", "ts": 5},
                        "cur": {"amount": 1, "currency": "euro", "ts": 5},
                        "none": {"amount": None, "ts": 9},
                        "junk": "x"},
            "fired": [{"key": KEY, "ts": 5}, {"key": 3}, "x"],
            "body_amounts": "yes"},
        "bad": ["x"]}}))
    b = substore.load_account("acc")
    assert b["hidden"] == [KEY]
    assert b["reminders"] == {KEY: {"sent": "2027-01-05"}, "bad": {"sent": ""}}
    assert set(b["amounts"]) == {KEY, "none"}
    assert b["fired"] == [{"key": KEY, "ts": 5}]
    assert b["body_amounts"] is False                  # only a real True
    assert substore.load_account("bad")["hidden"] == []
    for text in ("{not json", "[]", '{"accounts": []}'):
        substore._cache.clear()
        _file(tmp_path).write_text(text)
        assert substore.load_account("acc")["hidden"] == []


def test_hiding_drops_the_reminder_and_unhiding_does_not_bring_it_back():
    substore.set_reminder(KEY, True, "acc")
    substore.set_hidden(KEY, True, "acc")
    assert substore.load_account("acc")["reminders"] == {}
    substore.set_hidden(KEY, False, "acc")
    assert substore.load_account("acc")["reminders"] == {}


def test_mark_sent_is_true_once_per_date():
    substore.set_reminder(KEY, True, "acc")
    assert substore.mark_sent(KEY, "2027-01-05", "acc") is True
    assert substore.mark_sent(KEY, "2027-01-05", "acc") is False
    assert substore.mark_sent(KEY, "2027-02-05", "acc") is True
    assert substore.mark_sent("nope.example", "2027-01-05", "acc") is False


def test_the_lists_are_capped(monkeypatch):
    monkeypatch.setattr(substore, "MAX_KEYS", 3)
    for i in range(5):
        substore.set_hidden(f"k{i}.example", True, "acc")
    assert substore.load_account("acc")["hidden"] == [
        "k2.example", "k3.example", "k4.example"]
    for i in range(5):
        substore.add_fired(f"k{i}.example", i, "acc")
    assert len(substore.load_account("acc")["fired"]) <= substore.MAX_FIRED
