"""Your folders over HTTP (GET /api/your_folders, POST .../check, create,
rename, merge, delete): the shapes the page reads, coded 409 refusals, the
account parameter, and the quoted `folder:"Two Words"` mail filter its
"Open in All mail" uses."""

from fastapi.testclient import TestClient

from backend import mailops
from backend.main import app
from conftest import wait_scan_done
from test_your_folders import box, rows  # noqa: F401
from test_multiaccount import _two_accounts

client = TestClient(app)


def post(path, **body):
    return client.post(f"/api/your_folders/{path}", json=body)


def test_the_page_endpoint_returns_rows_hints_totals_and_the_special_folders(
        box):
    r = client.get("/api/your_folders")
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"rows", "hints", "special", "totals", "scanned",
                         "gmail", "busy"}
    row = next(x for x in body["rows"] if x["name"] == "Receipts")
    assert set(row) >= {"raw", "name", "lock", "role", "label", "scanned",
                        "off", "mails", "size", "newest", "unread",
                        "used_by", "children", "hints", "twin", "can"}
    assert row["mails"] == 3 and row["can"]["merge"] is None
    assert body["busy"] is None and body["scanned"] is True
    assert {h["kind"] for h in body["hints"]} == {"look", "empty", "stale"}


def test_create_rename_delete_over_http(box):
    assert post("create", name="Taxes").json() == {"raw": "Taxes",
                                                   "name": "Taxes"}
    chk = post("check", op="rename", folder="Taxes", name="Taxes 2026").json()
    assert chk["new_name"] == "Taxes 2026" and chk["rules"] == []
    r = post("rename", folder="Taxes", name="Taxes 2026", rules=[])
    assert r.status_code == 200 and r.json()["raw"] == "Taxes 2026"
    wait_scan_done()
    chk = post("check", op="delete", folder="Taxes 2026").json()
    assert chk["count"] == 0
    assert post("delete", folder="Taxes 2026", uv=chk["uv"]).json() == {
        "deleted": "Taxes 2026"}
    assert "Taxes 2026" not in box.mailbox


def test_merge_over_http_and_its_check(box):
    chk = post("check", op="merge", folder="Receipts 2019",
               target="Receipts").json()
    assert chk["count"] == 2
    r = post("merge", folder="Receipts 2019", target="Receipts",
             uv=chk["uv"], max_uid=chk["max_uid"], delete_after=True,
             rules=[])
    assert r.status_code == 200
    out = r.json()
    assert out["moved"] == 2 and out["deleted"] is True
    assert out["undo"]["count"] == 2


def test_refusals_are_409_with_a_stable_code(box):
    for path, body, code in (
            ("rename", dict(folder="INBOX", name="X"), "folder_locked"),
            ("delete", dict(folder="Travel"), "folder_not_empty"),
            ("create", dict(name="travel"), "folder_exists"),
            ("merge", dict(folder="Trash", target="Travel", uv=1,
                           max_uid=9), "folder_locked"),
            ("check", dict(op="merge", folder="Travel", target="Sent"),
             "folder_target_bad")):
        r = post(path, **body)
        assert r.status_code == 409, (path, r.text)
        assert r.json()["detail"].partition(":")[0] == code, path
    assert "INBOX" in box.mailbox and len(box.mailbox["Travel"]) == 2


def test_an_unknown_operation_is_rejected(box):
    assert post("check", op="shred", folder="Travel").status_code == 422


def test_the_page_follows_the_account_parameter(monkeypatch):
    from conftest import make_msg
    fakes = _two_accounts(monkeypatch)
    fakes["host-two"].mailbox["Only here"] = [make_msg(50, msgid="<o@x>")]
    fakes["host-two"].uv["Only here"] = 1
    got = {n: {r["name"] for r in client.get(
        "/api/your_folders", params={"account": n}).json()["rows"]}
        for n in ("one", "two")}
    assert "Only here" in got["two"] and "Only here" not in got["one"]
    assert client.get("/api/your_folders",
                      params={"account": "nobody"}).status_code == 400


# ---------------------------------------------------- the quoted folder filter

def _mails(**params):
    r = client.get("/api/mails", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_a_quoted_folder_filter_is_the_whole_name_and_may_hold_spaces(box):
    got = _mails(q='folder:"Receipts 2019"')
    assert {m["folder"] for m in got["mails"]} == {"Receipts 2019"}
    assert got["total"] == 2
    # exactly that folder, whatever the case - not the ones it is part of
    got = _mails(q='folder:"receipts"')
    assert {m["folder"] for m in got["mails"]} == {"Receipts"}
    # the plain word keeps meaning "contains" (and still combines)
    got = _mails(q="folder:receipts")
    assert {m["folder"] for m in got["mails"]} == {"Receipts", "Receipts 2019"}
    got = _mails(q='folder:"Receipts" old@store.example')
    assert got["total"] == 0


def test_the_quoted_folder_filter_parses_beside_other_words():
    f = mailops.parse_mail_query('is:unread folder:"My Folder" size:>1k')
    assert f["folder_exact"] == "my folder" and f["read"] is False
    assert f["size_min"] == 1024 and f["folder"] is None
    assert mailops.parse_mail_query("folder:x")["folder_exact"] is None
