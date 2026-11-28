"""Per-account runtime state, strictly separated.

Every connected account gets its own AccountState: scan state, message
index, folder UIDVALIDITYs/roles, replied cache, cancel flags and delete
queue - nothing is ever shared across accounts or acted on in one call
(`allaccounts.py` only READS them side by side, for the All accounts page).
Instances are created lazily from the configured account names.
"""

from __future__ import annotations

import threading
import time

from . import config as cfgmod
from . import tenants

# "smart" pools the long tail of small senders (mailops.build_smart); it is
# derived from the sender records, never built from the mails directly.
GROUPINGS = ("sender", "smart", "domain", "subject", "thread")


def _initial_state() -> dict:
    return {
        "status": "idle", "progress": "", "error": "", "folders": [],
        "groups": {g: {} for g in GROUPINGS},
        "ai": {"status": "idle", "grouping": "", "progress": "", "error": "",
               "usage": None},
        "delete": {"status": "idle", "progress": "", "error": "", "moved": 0,
                   # Job sequence, seeded from the clock so it never goes
                   # backwards across a server restart (a client that stayed
                   # open compares it monotonically).
                   "seq": int(time.time())},
        "atts": {"status": "idle", "progress": "", "error": "",
                 "mails": 0, "size": 0},   # attachment analysis (lazy)
        "unsub": {"status": "idle", "progress": "", "error": "", "total": 0,
                  "done": 0, "links": 0, "failed": 0, "skipped": 0,
                  # run id (see unsub.start_bulk); seeded from the clock so
                  # it never goes backwards across a server restart
                  "seq": int(time.time())},
        "trash_count": None,   # mails currently in Trash (None = unknown)
        "junk_count": None,    # same for Junk (header chip)
        "notice": None,        # one-shot info for the UI: {key, params}|None
        "scanned_ts": None,    # when the current groups were scanned
        "groups_rev": 1,       # bumped whenever groups/index change - SSE
                               # clients refetch the (big) group list only
                               # when this moves
        "undo": [],            # summaries of undoable move jobs (newest last)
        "assistant_undo": [],  # the same for AI assistants' steps (own list)
        "undo_total": 0,       # how many steps the lists hold (the summaries
        "assistant_undo_total": 0,    # above are the newest 100 of them)
        # the Time machine's restore job (see timemachine.py): one job at a
        # time per account, progress in steps and mails
        "restore": {"status": "idle", "progress": "", "error": "",
                    "steps_done": 0, "steps_total": 0, "moved": 0, "seq": 0},
        "folders_raw": [],     # raw IMAP folder names (targets for move-to)
        "index": {"status": "idle", "progress": "", "error": "",
                  "done": 0, "total": 0},   # local body index job
        "rules": [],           # this account's rules (mirrored for SSE)
        "presets": [],         # this account's saved filter presets (SSE)
    }


class AccountState:
    """All mutable runtime state of one account. `lock` guards `state`,
    `index`, `undo_log` and `delete_pending` (same discipline the old
    module-level STATE_LOCK had)."""

    def __init__(self, name: str, tenant: tenants.Tenant | None = None):
        self.name = name
        # The workspace this account belongs to. Background workers use it
        # to re-enter the right tenant context (threads don't inherit the
        # spawning request's contextvars).
        self.tenant = tenant or tenants.current()
        self.lock = threading.Lock()
        self.state = _initial_state()
        self.index: dict[str, dict] = {}     # "folder\x00uid" -> metadata
        # Gmail only: the label copies of a message whose kept copy is in
        # `index` ("folder\x00uid" -> metadata). Never counted or acted on;
        # cached so a rescan does not refetch them and can promote one when
        # the kept copy leaves its folder.
        self.label_copies: dict[str, dict] = {}
        # When the last finished scan ended: start_scan() clears the public
        # `scanned_ts`, but the arrivals diff of the next scan needs it.
        self.prev_scan_ts: int | None = None
        # When the newest scan FAILED (None = it did not, or none ran since
        # the server started): the All accounts page's "scan failed 2 h ago".
        self.scan_failed_ts: int | None = None
        self.folder_uv: dict[str, int] = {}  # folder -> UIDVALIDITY at scan
        self.folder_roles: dict[str, str] = {}   # role -> raw folder name
        # Role folders (Trash, later Junk ...) never enter `index`; each
        # gets its own small incremental cache instead: role -> {"folder\x00uid":
        # metadata} and role -> {folder: UIDVALIDITY at refresh}. Guarded by
        # `lock` like `index`.
        self.role_index: dict[str, dict[str, dict]] = {}
        self.role_uv: dict[str, dict[str, int]] = {}
        self.undo_log: list[dict] = []
        # Steps of AI assistants (MCP): never mixed into `undo_log`, so an
        # assistant cannot push the user's own steps out of it.
        self.assistant_undo: list[dict] = []
        # the undo lists changed and are not on disk yet (see
        # mailops.flush_undo: written after the lock is released)
        self.undo_dirty = False
        self.undo_busy = 0          # steps off their list while an undo runs
        self.undo_seq = 0
        self.undo_written = 0
        self.undo_write = threading.Lock()
        self.replied: set[str] = set()
        self.replied_loaded = False
        self.cancel = {"scan": False, "ai": False, "delete": False,
                       "atts": False, "unsub": False, "index": False}
        self.delete_pending: list[dict] = []
        # Per-sender outcomes of the newest bulk unsubscribe (guarded by
        # `lock`); `run` matches state["unsub"]["seq"].
        self.unsub_results: dict = {"run": 0, "items": []}
        # Held for the whole of one permanent deletion (Empty Trash, purge of
        # Trash / Junk mails): two of them never run side by side.
        self.purge_lock = threading.Lock()
        # Held for the whole of one folder operation (Your folders: create /
        # rename / merge / delete): a move job refuses to start meanwhile and
        # the operation refuses to start while a job runs.
        self.folder_lock = threading.Lock()
        # Held (non-blocking) for the whole of one return of snoozed mail
        # (backend/snooze.py): two returns never overlap.
        self.release_lock = threading.Lock()
        # UIDs of the delete job currently being processed (guarded by
        # `lock`) - new jobs dedup against these too, not just the queue.
        self.inflight: dict[str, set[int]] = {}
        # (smart_min, protected list) the smart groups were last built
        # with - a settings save only rebuilds them when this changed.
        self.smart_sig: tuple | None = None


# Keyed (tenant id, account name) - two tenants may both call an account
# "default" without ever sharing state.
_REGISTRY: dict[tuple[str, str], AccountState] = {}
_REG_LOCK = threading.Lock()


def names() -> list[str]:
    return list(cfgmod.load_config()["accounts"])


def default_name() -> str:
    return names()[0]


def get(name: str | None = None) -> AccountState:
    """The AccountState for `name` in the CURRENT TENANT (default: its
    first configured account). Raises KeyError for unknown names - API
    layers turn that into a 400, so one tenant probing another tenant's
    account names learns nothing."""
    known = names()
    name = name or known[0]
    if name not in known:
        raise KeyError(f"unknown account {name!r}")
    tenant = tenants.current()
    with _REG_LOCK:
        return _REGISTRY.setdefault((tenant.id, name),
                                    AccountState(name, tenant))


def all_instantiated() -> list[AccountState]:
    with _REG_LOCK:
        return list(_REGISTRY.values())


def rename(old: str, new: str) -> None:
    """Carry a renamed account's runtime state over to its new name."""
    tid = tenants.current().id
    with _REG_LOCK:
        acc = _REGISTRY.pop((tid, old), None)
        if acc is not None:
            acc.name = new
            _REGISTRY[(tid, new)] = acc


def drop(name: str) -> None:
    """Forget the runtime state of a deleted account."""
    with _REG_LOCK:
        _REGISTRY.pop((tenants.current().id, name), None)


def reset() -> None:
    """Tests only: forget every account's runtime state."""
    with _REG_LOCK:
        _REGISTRY.clear()
