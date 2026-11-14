#!/usr/bin/env python3
"""Dev-only interop check: the official MCP Python SDK client against our
/mcp endpoint, on both protocol legs.

Starts scripts/demo.py on its own port (it does not switch on the in-browser
demo mode; login mode is "none"), switches the admin cap on, creates a read
token through /api/assistants/tokens, then - once per protocol leg (the
2025-era initialize handshake, and 2026-07-28 stateless) - lists the tools and
calls every one of them, checking that each answer is a success whose
structured content matches its text block.

The SDK is NOT a dependency of Inboxrake: it is pinned with hashes in
scripts/mcp-interop/requirements.txt, outside the runtime and dev lockfiles.

    python -m venv /tmp/mcp-venv
    /tmp/mcp-venv/bin/pip install --require-hashes -r scripts/mcp-interop/requirements.txt
    /tmp/mcp-venv/bin/python scripts/mcp-interop.py --server-python python3

`--server-python` is the interpreter that has the backend's dependencies and
starts the demo server (default: this one). `--url` talks to a server that is
already running instead (nothing is started)."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = ["list_accounts", "mailbox_overview", "list_groups", "list_mails",
            "search_mails", "count_matches", "list_rules", "recent_activity"]


def http(url: str, method: str = "GET", body: dict | None = None,
         timeout: float = 20.0) -> dict:
    req = urllib.request.Request(
        url, method=method, data=None if body is None
        else json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_up(base: str, proc: subprocess.Popen | None, seconds: float) -> None:
    end = time.time() + seconds
    while time.time() < end:
        if proc is not None and proc.poll() is not None:
            raise SystemExit(f"the demo server exited early ({proc.returncode})")
        try:
            http(base + "/api/version", timeout=2)
            return
        except (urllib.error.URLError, OSError, ValueError):
            time.sleep(0.5)
    raise SystemExit("the demo server did not come up")


class Failures(list):
    def check(self, cond: bool, what: str) -> None:
        print(("  ok   " if cond else "  FAIL ") + what)
        if not cond:
            self.append(what)


async def leg(base: str, secret: str, mode: str, bad: Failures) -> None:
    from mcp import Client
    from mcp.client.streamable_http import streamable_http_client
    from mcp.shared._httpx_utils import create_mcp_http_client

    print(f"leg {mode}")
    transport = streamable_http_client(
        base + "/mcp", http_client=create_mcp_http_client(
            headers={"Authorization": f"Bearer {secret}"}))
    async with Client(transport, mode=mode) as client:
        bad.check(client.protocol_version in (
            ("2026-07-28",) if mode != "legacy"
            else ("2025-11-25", "2025-06-18")),
            f"negotiated protocol {client.protocol_version}")
        tools = (await client.list_tools()).tools
        bad.check([t.name for t in tools] == EXPECTED, "the 8 read tools")
        bad.check(all(t.annotations and t.annotations.read_only_hint
                      and t.output_schema for t in tools),
                  "read-only annotations and output schemas")
        first = await client.call_tool("list_groups", {"limit": 3})
        groups = (first.structured_content or {}).get("groups") or []
        key = groups[0]["key"] if groups else "example"
        args = {
            "list_accounts": {}, "mailbox_overview": {},
            "list_groups": {"limit": 5, "sort": "size"},
            "list_mails": {"key": key, "limit": 5},
            "search_mails": {"query": key[:6] if len(key) > 2 else "example"},
            "count_matches": {"filter": "is:unsub"}, "list_rules": {},
            "recent_activity": {"limit": 5}}
        for name in EXPECTED:
            res = await client.call_tool(name, args[name])
            text = json.loads(res.content[0].text)
            bad.check(not res.is_error and res.structured_content == text,
                      f"{name}: success, structured content = text block")
        res = await client.call_tool("list_groups", {"limit": 0})
        bad.check(bool(res.is_error), "bad input is a tool error")


async def run(base: str, secret: str) -> list[str]:
    bad = Failures()
    for mode in ("legacy", "2026-07-28"):
        try:
            await leg(base, secret, mode, bad)
        except Exception as exc:        # a leg that cannot even connect
            bad.check(False, f"leg {mode} raised {type(exc).__name__}: {exc}")
    return list(bad)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--server-python", default=sys.executable)
    ap.add_argument("--url", help="use a running server (nothing is started)")
    args = ap.parse_args()

    proc = None
    if args.url:
        base = args.url.rstrip("/")
    else:
        port = free_port()
        base = f"http://127.0.0.1:{port}"
        env = {**os.environ, "DEMO_PORT": str(port)}
        env.pop("INBOXRAKE_DEMO", None)         # not the in-browser demo
        proc = subprocess.Popen([args.server_python,
                                 str(ROOT / "scripts" / "demo.py")],
                                cwd=ROOT, env=env)
    try:
        wait_up(base, proc, 180)
        http(base + "/api/config", "POST",
             {"assistants": {"access": "read_propose"}})
        accounts = list(http(base + "/api/accounts/summary"))
        made = http(base + "/api/assistants/tokens", "POST", {
            "name": "interop", "accounts": accounts[:1], "level": "read",
            "subjects": True, "expires_days": 30})
        failures = asyncio.run(run(base, made["secret"]))
    finally:
        if proc is not None:
            proc.terminate()                    # our own child only
            try:
                proc.wait(15)
            except subprocess.TimeoutExpired:
                proc.kill()
    print("FAILED: " + "; ".join(failures) if failures else "interop OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
