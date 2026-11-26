"""The demo's mails with files: `real_atts` serves what BODYSTRUCTURE declares
as real files, so a file can be read, downloaded and taken out of the mail."""

from fastapi.testclient import TestClient

from backend import mimecut
from backend.main import app
from conftest import make_msg, wait_delete_done
from rmfiles_util import analyse, body, server

client = TestClient(app)


def test_a_demo_mail_with_files_reads_as_a_mail_and_loses_a_file(monkeypatch):
    m = make_msg(1, frm='"Photo Archive" <hello@photoarchive.example>',
                 subject="Scans", atts=[("scan-1.pdf", 6000),
                                        ("scan-2.pdf", 6000)])
    fake = server(monkeypatch, [m], real_atts=True)
    analyse(client)
    detail = client.get("/api/message", params={"folder": "INBOX",
                                                "uid": 1}).json()
    # it reads as a normal mail (its text, not its MIME)
    assert detail["text"] == "Hello mail body"
    assert [a["size"] for a in detail["atts"]] == [6000, 6000]
    root = mimecut.parse(fake._attached(m))
    assert [a.size for a in mimecut.attachments(root)] == [6000, 6000]
    r = client.post("/api/attachments/remove", json=body(
        [("scan-1.pdf", 6000)], [["INBOX", 1]], confirm=1))
    assert r.status_code == 200
    wait_delete_done()
    (copy,) = fake.mailbox["INBOX"]
    assert [a.name for a in mimecut.attachments(mimecut.parse(
        copy["raw"]))] == ["scan-2.pdf"]
    assert len(fake.mailbox["Trash"]) == 1
