"""The reader's header facts on /api/message and /api/messages: attachments
(attachment analysis), trackers (body index), the unsubscribe method (stored
List-Unsubscribe header) and the pin state - metadata only, additive."""

import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import bodyindex
from backend import config as cfgmod
from backend import mailops
from backend.main import app
from conftest import make_msg

client = TestClient(app)

PIX = ('<img src="https://t.tracker.example/o/Ab3dEf9hIj2kLm5nOp.gif" '
       'width="1" height="1">')


@pytest.fixture(autouse=True)
def secret_key(monkeypatch):
    monkeypatch.setenv("INBOXRAKE_SECRET_KEY", "test-key-one")


def get(folder, uid):
    r = client.get("/api/message", params={"folder": folder, "uid": uid})
    assert r.status_code == 200, r.text
    return r.json()


def wait(key, timeout=5.0):
    acc = accountsmod.get()
    end = time.time() + timeout
    while time.time() < end:
        with acc.lock:
            if acc.state[key]["status"] != "running":
                return acc.state[key]
        time.sleep(0.02)
    raise TimeoutError(key)


@pytest.fixture
def scanned(bridge):
    bridge.mailbox["INBOX"].append(make_msg(
        5, frm="Pal <pal@friends.example>", subject="Mail only",
        unsub="<mailto:stop@friends.example?subject=stop>"))
    bridge.mailbox["INBOX"].append(make_msg(
        6, frm="Pal <pal@friends.example>", subject="Broken header",
        unsub="<>"))
    bridge.mailbox["INBOX"][0]["html"] = f"<p>Parcel</p>{PIX}"
    cfgmod.update_config({"imap": {"body_search": "local"}})
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return bridge


def test_unsubscribe_method_comes_from_the_stored_header(scanned):
    # https URL + the one-click flag -> one click (the run POSTs it)
    assert get("INBOX", 4)["unsub"] == {"method": "one_click",
                                        "one_click": True}
    # a page the user confirms
    assert get("INBOX", 1)["unsub"] == {"method": "http", "one_click": False}
    # a mailto only
    assert get("INBOX", 5)["unsub"] == {"method": "mailto",
                                        "one_click": False}
    # no header, or one without a usable URI
    assert get("INBOX", 3)["unsub"] is None
    assert get("INBOX", 6)["unsub"] is None


def test_the_method_never_exposes_the_link(scanned):
    assert "dhl.example" not in str(get("INBOX", 1)["unsub"])


def test_attachments_appear_once_the_analysis_ran(scanned):
    assert get("INBOX", 4)["atts"] is None          # not analysed yet
    assert client.post("/api/attachments", json={}).json() == {"ok": True}
    wait("atts")
    assert get("INBOX", 4)["atts"] == [
        {"name": "catalog.pdf", "size": 25000},
        {"name": "promo.jpg", "size": 3000}]
    assert get("INBOX", 3)["atts"] is None          # analysed, none found


def test_trackers_appear_once_the_body_index_checked_the_mail(scanned):
    assert get("INBOX", 1)["trackers"] is None      # no index yet
    bodyindex.start_build(accountsmod.get(), rebuild=False)
    assert wait("index")["status"] == "done"
    assert get("INBOX", 1)["trackers"] == {
        "pixel": True, "click": False, "hosts": ["tracker.example"]}
    assert get("INBOX", 3)["trackers"] == {
        "pixel": False, "click": False, "hosts": []}
    # a mail outside the scan (Sent) was never checked
    assert get("Sent", 20)["trackers"] is None


def test_pin_state(scanned):
    assert get("INBOX", 4)["pinnable"] is True
    assert get("Sent", 20)["pinnable"] is False     # not in the index
    assert get("INBOX", 4)["pinned"] is False
    assert client.post("/api/pin", json={"folder": "INBOX", "uid": 4,
                                         "pinned": True}).status_code == 200
    assert get("INBOX", 4)["pinned"] is True
    assert get("Sent", 20)["pinned"] is False       # not in the index


def test_batch_endpoint_carries_the_same_fields(scanned):
    r = client.post("/api/messages", json={
        "items": [["INBOX", 4], ["INBOX", 999], ["Sent", 20]]})
    assert r.status_code == 200
    a, missing, sent = r.json()["messages"]
    assert a["unsub"]["method"] == "one_click" and a["pinned"] is False
    assert a["atts"] is None and a["trackers"] is None
    assert missing == {"folder": "INBOX", "uid": 999,
                       "error": "unknown message"}
    assert sent["unsub"] is None and sent["atts"] is None
