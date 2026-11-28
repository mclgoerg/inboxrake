"""Your documents on the demo mailboxes: every kind has papers over several
years (invented `.example` senders), one tax notice is kept safe, and a file
is really read from the demo's own mail server when it is downloaded."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "scripts" / "demo.py"
ENV = {**os.environ, "DEMO_NOW": "1790000000", "LOG_LEVEL": "WARNING",
       "PYTHONHASHSEED": "0"}

DRIVER = r"""
import base64, json, runpy, sys
path = sys.argv[1]
runpy.run_path(path, run_name="demo_driver")["main"]([], serve=False)
from fastapi.testclient import TestClient
from backend.main import app
c = TestClient(app, base_url="http://localhost")
out = {}
for acct in ("proton", "icloud"):
    summ = c.get("/api/documents/summary", params={"account": acct}).json()
    years = {}
    for y in summ["years"]:
        page = c.get("/api/documents", params={"account": acct,
                                               "year": y["year"]}).json()
        years[y["year"]] = page["rows"]
    out[acct] = {"summary": summ, "rows": years}
# one file of the newest proton row
rows = out["proton"]["rows"][max(out["proton"]["rows"], key=int)]
row = rows[0]
f = row["files"][0]
r = c.post("/api/documents/file", params={"account": "proton"}, json={
    "folder": row["folder"], "uid": row["uid"], "name": f["name"],
    "size": f["size"]})
out["download"] = {"status": r.status_code, "size": len(r.content),
                   "head": r.headers.get("content-disposition"),
                   "type": r.headers.get("content-type"),
                   "name": f["name"], "subject": row["subject"]}
print(json.dumps(out))
"""


def test_the_demo_shows_every_kind_over_several_years():
    proc = subprocess.run([sys.executable, "-c", DRIVER, str(DEMO)], env=ENV,
                          capture_output=True, text=True, timeout=300,
                          check=True)
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    proton = out["proton"]
    assert proton["summary"]["analyzed"] is True
    years = [y["year"] for y in proton["summary"]["years"]]
    assert len(years) >= 3 and years == sorted(years)
    kinds = {k: sum(y["kinds"][k]["files"] for y in proton["summary"]["years"])
             for k in ("invoices", "contracts", "bookings", "tax")}
    assert all(n > 0 for n in kinds.values()), kinds
    # the page's own invented papers are there
    subjects = {r["subject"] for rows in proton["rows"].values()
                for r in rows}
    assert {"Your policy documents", "Bescheid für 2025"} <= subjects
    assert any(s.startswith("Ihre Versicherungspolice") for s in subjects)
    # the newest tax notice is kept safe; a mail with two files lists both
    rows = [r for rows in proton["rows"].values() for r in rows]
    pinned = [r for r in rows if r["pinned"]]
    assert any(r["subject"] == "Bescheid für 2025" for r in pinned)
    assert any(len(r["files"]) == 2 and r["kind"] == "contracts"
               for r in rows)
    # the second account has documents of its own (receipts, a rent contract)
    assert out["icloud"]["summary"]["years"]
    # a file is read from the demo's mail server and handed over
    dl = out["download"]
    assert dl["status"] == 200 and dl["size"] > 1000, dl
    assert dl["type"] == "application/octet-stream"
    assert dl["head"].startswith("attachment; filename=")
