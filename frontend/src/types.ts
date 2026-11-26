// "domain" is no longer a tab (Smart replaced it) but stays a grouping for
// rules, `domain:` filters and the block/protect shortcuts.
export type Grouping = "sender" | "smart" | "domain" | "subject" | "thread";
/** What a Smart row is: an own row for a big sender, a company pool, or a
 *  bucket of small senders (see backend mailops.build_smart). */
export type SmartKind = "sender" | "company" | "protected" | "replied"
  | "orders" | "appointments" | "jobs" | "support" | "accounts" | "category"
  | "newsletter" | "individuals" | "other";
/** Why a sender sits in its Smart row (SENDER records only; the backend
 *  ships a structured reason, the UI words it - see smart.ts smartReason). */
export interface SmartWhy {
  r: string;        // own | protected | replied | company | purpose | weak |
                    // competing | category | category_conflict | newsletter |
                    // individual | notification | ai | rule | kept_ai | none
  k?: string;       // purpose (r = purpose / weak), kind (r = rule / kept_ai)
  by?: "a" | "co";  // r = rule / kept_ai: filed by this sender's own entry or its company's
  entry?: string;   // r = rule / kept_ai: key of the knowledge entry that decided it
  n?: number;       // mails matching ...
  of?: number;      // ... of this many mails
  name?: string;    // category name
  co?: string;      // placed with the other senders of this company
  sure?: boolean;   // r = ai: the AI was confident (for "other": it belongs there)
}
export type Verdict = "delete_safe" | "review" | "keep";

/** Private sender knowledge (GET /api/knowledge): where the user filed a
 *  sender (`a:<address>`) or a company (`co:<company>`) in Smart. */
export type KnowledgeSrc = "user" | "ai";
export interface KnowledgeStored {
  kind: string;               // a fixed kind, or `cat:<name>` of an own category
  src: KnowledgeSrc;          // "ai": an AI answer the user chose to keep
  ts: number;
  note: string;
}
export interface KnowledgeEntry extends KnowledgeStored {
  key: string;
  // active | no_effect | inactive | inert | unused | unknown
  status: string;
  reason: string;             // why it has no effect (see know.reason.*)
  senders: number;            // matching senders in the loaded mailboxes
  mails: number;              // their mails in the loaded mailboxes
  filed: number;              // ... of which this entry decides right now
  rows: string[];             // Smart rows they sit in now
}
export interface KnowledgeList {
  entries: KnowledgeEntry[];
  complete: boolean;          // every account has a finished scan
  unscanned: string[];
  categories: string[];       // the user's own categories (can be filed into)
  max: number;
  ai_running: boolean;
}
export interface KnowledgeSaved {
  ok: boolean;
  saved: number;
  removed: number;
  previous: Record<string, KnowledgeStored | null>;   // what an Undo restores
}

export interface GroupAi {
  verdict: Verdict;
  reason: string;
  /** "user": the verdict was set by hand (Edit labels) and wins over the AI. */
  src?: "user";
  /** "user": the AI said "safe" but the row holds a sender the user put on
   *  hold, so it is shown as "review" (backend mailops._group_ai). */
  capped?: "user";
  /** When the AI verdict came about (epoch s); absent on older verdicts and
   *  on a verdict the user set. */
  ts?: number;
}

/** One sender's own labels (GET/PUT /api/labels): what the user set, what
 *  automatic would be, and tags worth suggesting. `verdict` / `tags` are null
 *  while automatic. */
export interface SenderLabels {
  key: string;
  verdict: Verdict | null;       // the user's choice (null = automatic)
  tags: string[] | null;         // the user's tags (null = automatic)
  tags_now: string[];            // what the sender shows now
  auto_tags: string[];           // what automatic gives (Reset)
  ai: { verdict: Verdict; reason: string } | null;   // the AI's own answer
  protected: boolean;            // a protected sender is never "safe"
  suggestions: string[];
}

/** Unsubscribe state of one group's senders (null = none ever attempted).
 *  `status` is "done" only once EVERY sender with a List-Unsubscribe
 *  header is recorded done; "pending" covers a partially-handled
 *  domain/subject group (n < of, nothing failed); "link"/"failed" is the
 *  worst outstanding case and wins over "pending". `addr`/`link` are only
 *  set for "link" (the sender needing manual confirmation). */
export interface GroupUnsub {
  n: number;
  of: number;
  status: "done" | "pending" | "link" | "failed";
  link: string;
  addr: string;
}

export interface StillMailing {
  n: number;            // this row's mails delivered after the unsubscribe
  senders: number;      // distinct senders behind them
  since_ts: number;     // unix time of the (earliest) unsubscribe
  last_ts?: number;     // arrival of the newest mail after it (absent in old snapshots)
  addrs: string[];      // those senders, capped
}

export interface GroupLouder {
  addr: string; label: string;
  /** mails of the last 7 days, the usual week (median), their ratio */
  n: number; usual: number; factor: number;
  /** arrival times (epoch s) of those mails */
  ts: number[];
}
export interface GroupBack {
  addr: string; label: string;
  /** arrival of the mail that broke the silence (epoch s) */
  ts: number;
  gap_days: number;
  /** its mails since (and including) it */
  n: number;
  /** older mail of the sender is still here and none of it was opened */
  never_opened: boolean;
}

export interface Group {
  key: string;
  label: string;
  sub: string;
  count: number;
  size: number;
  unread: number;
  first: string;
  last: string;
  tags: string[];
  samples: string[];
  bulk: boolean;
  unsub: boolean;
  ai: GroupAi | null;
  ratings: { delete_safe: number; review: number; keep: number } | null;
  protected: boolean;
  replied: boolean;
  att_size: number;
  unsubscribed: GroupUnsub | null;
  new: boolean;
  /** When the group's newest sender was first seen (epoch s); 0 = unknown. */
  new_ts?: number;
  // Mails that ARRIVED after the sender's unsubscribe + grace (see
  // backend mailops._group_still_mailing); absent in old snapshots.
  still_mailing?: StillMailing | null;
  /** Got louder: its last 7 days against its usual week (backend
   *  senderchanges.py); absent when it did not. A group of several senders
   *  names the loudest in `addr` / `label`. */
  louder?: GroupLouder;
  /** Came back: the first mail after 6+ months of silence; absent when
   *  there was none lately. */
  back?: GroupBack;
  pinned: number;   // mails of this group protected from bulk actions
  engagement: number;   // 0-100, see lib.ts engagementTier()
  trackers?: GroupTrackers;   // only when the body index checked its mails
  // Smart grouping only. The backend ships fields, the UI words them
  // (lib.ts smartView): `sub` is empty and `label` is an English fallback
  // for pooled rows.
  kind?: SmartKind;
  n_senders?: number;
  members?: string[];   // sender addresses, capped - NOT the full membership
  smart_key?: string;   // SENDER records: key of the Smart row they landed in
  smart_why?: SmartWhy; // SENDER records: why they landed there
  purposes?: Record<string, number>;   // company rows: mails per purpose, live
  addr?: string;        // own rows: the sender's address
  domain?: string;      // company rows: the ONE exact domain, else ""
  category?: string;    // category rows: the category name
}

/** Tracking found in a group's mails while the body index was built
 *  (backend/trackers.py): how many checked mails carry a pixel / a
 *  click-tracking link, and the most common tracker hosts. */
export interface GroupTrackers {
  checked: number;
  pixel: number;
  click: number;
  hosts: string[];
}

export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cost?: number;
  total_cost?: number;
}

export interface AiState {
  status: "idle" | "running" | "done" | "error";
  grouping: string;
  progress: string;
  error: string;
  usage: AiUsage | null;
}

export interface DeleteState {
  status: "idle" | "running" | "done" | "error";
  progress: string;
  error: string;
  moved: number;
  seq?: number;   // bumped by the backend whenever a new job starts
  /** Who runs / ran the current job (`user`, `rule:<id>`, `mcp:<token name>`)
   *  and what it does; absent before a job ran. */
  actor?: string;
  action?: string;
}

export interface AttsState {
  status: "idle" | "running" | "done" | "error";
  progress: string;
  error: string;
  mails: number;
  size: number;
}

export interface UnsubState {
  status: "idle" | "running" | "done" | "error";
  progress: string;
  error: string;
  total: number;
  done: number;
  links: number;
  failed: number;
  skipped: number;
  /** Run id (backend unsub.start_bulk): the sheet that started a run waits
   *  for ITS run. Absent in older servers / test fixtures. */
  seq?: number;
}

export interface AttMail extends Mail {
  att_size: number;
  atts: AttFile[];
}

/** One attachment of a mail; `copies` = mails carrying the same name + size. */
export interface AttFile {
  name: string; size: number; kind: AttKind; ext: string; copies: number;
}

export type AttKind = "pdf" | "images" | "video" | "audio" | "archives"
  | "documents" | "other";

/** Whole-index numbers behind the attachment page (GET
 *  /api/attachments/summary); `repeats` = the same (name, size) in more
 *  than one mail. */
export interface AttSummary {
  total: number; mails: number;
  kinds: { kind: AttKind; bytes: number; count: number }[];
  repeats: { files: number; mails: number; bytes: number };
}

/** Full counts behind the duplicate lists (GET /api/duplicates/summary). */
export interface DupSummary {
  /** Identical-copy sets. */
  sets: number;
  /** What deleting all but the newest of each identical set would free. */
  wasted: number;
  /** Sets of the same mail in different versions. */
  versions: number;
  /** Likely double-sends to compare. */
  possible: number;
  /** Sets the user chose to keep ("Keep all"): left out of everything above. */
  dismissed: number;
}

export type DupKind = "identical" | "versions" | "possible";

export interface DupSet {
  /** What "Keep all" remembers the set by (POST /api/duplicates/dismiss). */
  key: string;
  wasted: number;
  /** A copy is a pinned mail / from a protected sender: the backend refuses
   *  to move such a set, so the one-tap cleanup leaves it alone. */
  locked: "pinned" | "protected" | null;
  mails: Mail[];    // newest first
}

export interface SenderGroup {
  addr: string;
  count: number;
  size: number;
  unread: number;
  ts: number;
  date: string;
  /** The sender's earliest mail in this folder ("first seen"; 0 / "" =
   *  unknown, e.g. a server that predates the field). */
  first_ts?: number;
  first_date?: string;
  uids: number[];
}

export interface TrashResp {
  folder: string;
  uv: number;
  total: number;
  max_uid: number;
  mails: Mail[];
  /** whole folder grouped by sender (folders panel listing) */
  senders?: SenderGroup[];
  /** roles a permanent delete from this page would refuse because several
   *  folders could be them (names as shown); the listing itself used the
   *  deterministic pick */
  ambiguous?: { role: FolderRole; choices: string[] }[];
}

export type FolderRole = "junk" | "trash";

/** One entry of the Undo list. `label` is its English text and (with ts and
 *  count) its identity; `label_key` + `label_params` (when present) let the
 *  UI word the label itself in the user's language - see `undoLabel`. */
export interface UndoEntry {
  id?: string;
  ts: number;
  label: string;
  count: number;
  action: string;
  quiet?: boolean;
  label_key?: string;
  label_params?: Record<string, string | number>;
  /** An AI assistant's step (the `assistant_undo` list): its audit actor
   *  (`mcp:<token name>`) and token id. */
  actor?: string;
  token?: string;
}

export interface FolderMoveResp {
  moved: number;
  rescan: boolean;
  senders: string[];
  undo: { ts: number; label: string; count: number } | null;
}

/** What a permanent delete acts on: exactly one of these. */
export type PurgeSelect =
  | { uids: number[] } | { senders: string[] }
  | { older_than_days: number } | { everything: true };

/** The live count of a permanent delete (fresh server listing): the counted
 *  UIDVALIDITY and the exact UIDs to send back, plus what is skipped. */
export interface PurgePreview {
  role: FolderRole;
  /** the folder the count was read from (and, for Junk, the Trash folder it
   *  goes through): sent back with the delete, the server refuses if the
   *  role resolves to another folder by then */
  folder: string;
  trash_folder: string | null;
  uv: number;
  uids: number[];
  count: number;
  total: number;
  size: number;
  skipped_protected: number;
  skipped_pinned: number;
  via_trash: boolean;
}

export interface PurgeResult {
  deleted: number;
  skipped_protected: number;
  skipped_pinned: number;
  missing: number;
  capped: number;
  /** Junk mails moved to Trash that could not be verified for permanent
   *  deletion: they are still in Trash. */
  unverified: number;
  /** the undo entry of the mails left in Trash (when unverified > 0) */
  undo: { ts: number; label: string; count: number } | null;
}

export interface StatsResp {
  mails: number;
  size: number;
  unread: number;
  bulk: number;
  oldest: string;
  senders: number;
  replied_senders: number;
  ai_groups: { delete_safe: number; review: number; keep: number;
    unrated: number };
  rated_mails: { delete_safe: number; review: number; keep: number };
  years: { year: string; count: number; size: number }[];
  months: { month: string; count: number; size: number }[];
  /** full month history / last 31 days with the unread share per bucket
   *  (absent on a backend from before the period switch) */
  months_all?: { month: string; count: number; size: number;
    unread: number }[];
  days?: { day: string; count: number; size: number; unread: number }[];
  categories: { tag: string; count: number; size: number }[];
  top_domains: { domain: string; count: number; size: number }[];
  top_senders: { key: string; label: string; count: number;
    size: number }[];
  scans: { ts: number; mails: number; size: number; senders: number }[];
  actions: Record<string, { trash: number; archive: number; move: number;
    mark_read: number; freed: number; purge?: number;
    /** bytes really freed by permanent deletes (the old `freed` was
     *  move-based history and is never shown as freed space) */
    purged_bytes?: number }>;
}

export interface AuditEntry {
  ts: number;
  account: string;
  actor: string;
  action: string;
  count: number;
  bytes: number;
  label: string;
  outcome: string;
  error: string;
  /** Stable id of newer entries (absent on old ones). */
  id?: string;
  /** A move OUT of Junk / Trash (a rescue, not cleaning); newer entries. */
  from_role?: "junk" | "trash";
  /** On an undo entry: it restored `count` mails of the entry `id`. */
  undoes?: { id: string; count: number };
  /** A rule run: mails it left alone because they look worth keeping. */
  kept_safe?: number;
  /** On a Time machine restore: the same for every step it undid. */
  undoes_many?: { id: string; count: number }[];
}

/** Who did it, for the Activity filter. */
export type AuditBy = "all" | "user" | "rules" | "assistants"
  | `token:${string}`;   // one assistant token's steps (its id)

export interface AuditResp {
  total: number;
  entries: AuditEntry[];
}

/** The kinds of mail a big cleanup offers to keep (backend/keepsafe.py). */
export type KeepSafeClass = "invoices" | "bookings" | "contracts" | "jobs"
  | "accounts";
export type KeepSafeSettings = Record<KeepSafeClass, boolean>
  & { rules: boolean };
/** The mails a Trash move would act on: a selection of mails or groups (with
 *  the move's own retention / sender limits). */
export type KeepSafeScope =
  | { items: [string, number][]; role?: "junk" | "trash" }
  | { grouping: Grouping; keys: string[]; keep_latest?: number | null;
      older_than_days?: number | null; only_addrs?: string[] | null };
export interface KeepSafeGroup {
  id: KeepSafeClass;
  count: number;
  senders: { name: string; count: number }[];
  subjects: { subject: string; sender: string; ts: number }[];
}
export interface KeepSafeCheck {
  /** The account the answer is for: the pin goes to the same one. */
  account?: string;
  /** Mails the move would act on, and how many of them look worth keeping. */
  total: number;
  kept: number;
  classes: KeepSafeGroup[];
}

export interface RuleRun {
  pending?: boolean;
  queued?: number;
  ts: number;
  mode: "report" | "execute";
  groups: number;
  mails: number;
  /** Purge rules: bytes of the mails counted in `mails`. */
  size?: number;
  acted: number;
  capped: number;
  skipped_protected: number;
  skipped_pinned: number;
  preview: { key: string; label: string; count: number }[];
  error: string;
  /** Purge rules: mails moved to Trash but not verified for deletion. */
  unverified?: number;
  /** Keep-safe: mails a Trash run left alone, per class (absent on older
   *  runs and on rules that do not check). */
  kept_safe?: Partial<Record<KeepSafeClass, number>>;
}

/** Where a rule looks: the main cleanup index, or the Junk / Trash folder
 *  (those rules delete permanently, on the server). */
export type RuleScope = "mail" | "junk" | "trash";

export interface Rule {
  id: string;
  name: string;
  /** The account the rule runs on (absent: the default account). */
  account?: string;
  scope: RuleScope;
  grouping: Grouping;
  query: string;
  action: string;
  dest: string;
  schedule: "manual" | "daily" | "weekly";
  mode: "report" | "execute";
  keep_latest: number | null;
  older_than_days: number | null;
  /** The third retention choice, exclusive with the two above: act only on
   *  the mails of this kind (`ads`, ...). Absent on older rules. */
  only_kind?: string | null;
  /** "auto_empty": the Trash page's "Empty automatically" switch made it.
   *  "mcp": an AI assistant proposed it (a proposal while it is in report
   *  mode; still "mcp" once the user approved it, "manual" after an edit). */
  origin: "manual" | "block" | "auto_empty" | "mcp";
  /** Which assistant token proposed it, and when (kept as history after an
   *  edit). */
  proposed_by?: { token_id: string; name: string; at: number };
  report_runs: number;
  /** Purge rules: why an armed rule went back to report mode (shown on the
   *  card). */
  reset_reason?: "" | "edited" | "account" | "folder";
  /** Parts of the filter Inboxrake does not understand (a rule saved before
   *  filters were validated); its execute runs are skipped. */
  filter_invalid?: string[];
  created: number;
  /** When the rule's definition (filter, action, target, ...) last changed. */
  edited?: number;
  last_run: RuleRun | null;
}

/** The Rule checkup's kinds, in the order they are listed. */
export type CheckupKind = "conflict" | "overlap" | "dest_missing"
  | "only_protected" | "never_matches" | "stale_report";

/** One sender row of a Compare (a sender both rules reach). `n` = the mails
 *  at stake there (left by the keep-rule, or acted on by both). */
export interface CheckupSender {
  addr: string; label: string; n: number; last: number | null;
}

/** One finding of the Rule checkup (GET /api/rules/checkup). `rules` are rule
 *  ids in the order the rules run (creation order). */
export interface CheckupFinding {
  id: string;
  kind: CheckupKind;
  rules: string[];
  ignored: boolean;
  /** conflict / overlap: how many mails, and the senders involved. */
  n?: number;
  senders?: CheckupSender[];
  /** Every sender address of the finding (`senders` lists the first rows
   *  only); `senders_total` is how many there are. */
  addrs?: string[];
  senders_total?: number;
  /** conflict: the rule created first (acts first). */
  first?: string;
  /** overlap: the rule whose "keep" is defeated, and the one that takes the
   *  mails; the defeated rule's retention. A purge overlap has no mails. */
  defeated?: string;
  by?: string;
  purge?: boolean;
  scope?: "junk" | "trash";
  keep_latest?: number | null;
  older_than_days?: number | null;
  winner_days?: number;
  compare?: { unit: "senders" | "mails"; only_a: number; both: number;
              only_b: number } | null;
  /** dest_missing */
  folder?: string;
  due?: boolean;
  /** only_protected */
  protected?: number;
  pinned?: number;
  /** never_matches */
  runs?: number;
  since?: number;
  /** stale_report */
  days?: number;
  last?: number;
}

export interface RuleCheckup {
  account: string;
  scanned_ts: number | null;
  /** false: no finished scan, so the checks that read the mails were skipped. */
  analysed: boolean;
  needs_scan: boolean;
  checked: number;
  rules: number;
  findings: CheckupFinding[];
}

/** Slim live-update payload (SSE): AppState without `groups`. */
export type StatusMsg = Omit<AppState, "groups">;

export interface AppState {
  account: string;
  status: "idle" | "scanning" | "done" | "error";
  scanned_ts: number | null;
  groups_rev: number;
  progress: string;
  error: string;
  folders: string[];
  groups: Record<Grouping, Record<string, Group>>;
  ai: AiState;
  delete: DeleteState;
  atts: AttsState;
  unsub: UnsubState;
  trash_count: number | null;
  /** Bytes in Trash; null until the Trash page has listed it (or when the
   *  listing is older than the folder's count). */
  trash_size?: number | null;
  junk_count?: number | null;
  notice: { key: string; params: Record<string, string | number> } | null;
  undo: UndoEntry[];
  /** AI assistants' own undo list (never mixed into `undo`). */
  assistant_undo?: UndoEntry[];
  /** How many steps the lists hold: `undo` / `assistant_undo` carry the
   *  newest 100 of them. */
  undo_total?: number;
  assistant_undo_total?: number;
  /** The Time machine's restore job (absent on an older server). */
  restore?: RestoreState;
  folders_raw: string[];
  rules: Rule[];
  presets: FilterPreset[];
}

/** A saved filter-box query, recallable as a one-tap chip (not to be
 *  confused with `Preset` below, the IMAP provider preset). */
export interface FilterPreset {
  id: string;
  name: string;
  query: string;
  account: string;
}

export interface FolderInfo {
  raw: string;
  name: string;
  delim?: string | null;  // hierarchy delimiter LIST announced
  role: string | null;    // trash | sent | junk | drafts | archive | all
  view?: boolean;         // virtual view (Gmail Starred / Important)
  role_source?: "flag" | "name" | "override" | null;
  ambiguous?: boolean;    // another folder is an equally good candidate
  looks_like?: string | null;  // a role another folder already holds
  excluded: boolean;
}

/** One detected special-folder role: where it points and how it was found. */
export interface SpecialRole {
  role: string;
  raw: string;
  name: string;
  source: "flag" | "name" | "override";
  ambiguous: boolean;      // tied candidates and no confirmed choice yet
  /** The tied folders to pick from (empty when nothing ties). */
  choices: { raw: string; name: string; count: number | null }[];
}

export interface FoldersResp {
  special?: SpecialRole[];
  folders: FolderInfo[];
  wildcards: string[];
  /** Mails per raw folder name from the last scan (absent from older
   *  backends; folders the scan did not see are missing). */
  mail_counts?: Record<string, number>;
}

export interface LookalikeCount {
  role: string;
  target: string;
  target_name: string;
  count: number;
  uv: number;
  max_uid: number;
}

export interface UndoIdent { id?: string; ts: number; label: string; count: number }

export interface Mail {
  uid: number;
  folder: string;
  date: string;
  ts: number;
  subject: string;
  addr: string;
  size: number;
  seen: boolean;
  ai: Verdict | null;
  pinned?: boolean;   // absent in search/attachment lists
  /** What kind of mail it is (`ads`, `orders`, ... - see kinds.ts); "" = no
   *  kind. Sent with a group's mails only. */
  kind?: string;
  /** Search across accounts only: the account the mail is in. */
  account?: string;
  /** Search across accounts only: from a protected sender (a Trash leaves it
   *  out; `pinned` says the same for a pinned mail). */
  protected?: boolean;
  msgid?: string;     // duplicate lists only (Compare)
  sent?: boolean;     // conversation reader: the user's own mail (Sent)
}

export interface MailsResp {
  total: number;           // after filtering, for "x of y"
  offset: number;
  mails: Mail[];
  ignored: string[];       // group-level qualifiers from q that don't apply
}

export interface MessageDetail {
  from: string;
  to: string;
  date: string;
  subject: string;
  text: string;
  // Present when the mail belongs to a conversation worth reading as one.
  thread?: { count: number } | null;
  // What the scan / attachment analysis / body index already know about the
  // mail (metadata only; null / absent = not known, e.g. Sent or Junk).
  pinnable?: boolean;     // in the scan index with a Message-ID: can be pinned
  pinned?: boolean;
  atts?: { name: string; size: number }[] | null;
  trackers?: { pixel: boolean; click: boolean; hosts: string[] } | null;
  unsub?: { method: "one_click" | "mailto" | "http"; one_click: boolean }
    | null;
}

export interface ConversationResp {
  key: string;
  label: string;
  mails: Mail[];           // oldest first, incl. the user's replies from Sent
  notes: SearchNote[];
}

export interface AiGroupResult {
  verdicts: [string, number, Verdict][];
  note: string;
  reviewed: number;
  remaining: number;
  total: number;
  usage: AiUsage;
}

/** How a sender is unsubscribed (from its stored List-Unsubscribe header):
 *  an automated HTTPS POST, a mail from the user's address, or a page the
 *  user confirms. Null = no usable method. */
export type UnsubVia = "one_click" | "mailto" | "http" | null;

export interface UnsubResult {
  action: "done" | "link";
  method: string;
  detail: string;
  addr: string;
  via?: UnsubVia;
}

/** One sender of the unsubscribe sheet's preview. */
export interface UnsubPreviewSender {
  addr: string;
  name: string;
  via: UnsubVia;
  mails: number;
  size: number;
}

export interface UnsubPreview {
  senders: UnsubPreviewSender[];
  skipped_protected: number;
  skipped_done: number;
  capped: number;
  /** Selected groups none of whose senders offers an unsubscribe link. */
  skipped_no_header: number;
  skipped_pooled?: number;
  /** What "also move their mails to Trash" would move: whole groups that
   *  consist only of these senders' mails (never protected; pinned mails
   *  left out). */
  trash: {
    groups: { key: string; addrs: string[]; mails: number; size: number }[];
    mails: number; size: number; pinned: number;
  };
}

/** One sender's outcome in a bulk run (GET /api/unsubscribe/results). */
export interface UnsubRunItem {
  addr: string;
  status: "done" | "link" | "failed";
  via: UnsubVia;
  link: string;
  error: string;
}

export interface UnsubBulkResult {
  queued: number;
  /** The run's id (state.unsub.seq); only when something was queued. */
  run?: number;
  skipped_protected: number;
  skipped_done: number;
  capped: number;
  skipped_pooled?: number;   // Smart only: pooled rows are never unsubscribed in one go
}

export type Security = "ssl" | "starttls";
export type SmtpSecurity = "auto" | "ssl" | "starttls";
export type Preset = "proton" | "gmail" | "outlook" | "icloud" | "fastmail"
  | "gmx" | "mailbox" | "yahoo" | "custom";

export type DigestSchedule = "off" | "daily" | "weekly";

export interface DigestSettings {
  schedule: DigestSchedule;
  recipient: string;       // "" = the account's own address
  hour: number;            // local server time, 24h
  minute: number;
  url?: string;            // the app's address for the mail's buttons ("" = none)
  lang?: "" | "en" | "de"; // the mail's language ("" = not chosen: English)
}

export type BodySearchMode = "disabled" | "server" | "local";

// What a build/update would add (see bodyindex.estimate).
export interface IndexEstimate {
  mails: number;           // scanned mails the index still lacks
  bytes: number;           // typical disk use
  bytes_max: number;       // text-heavy mail
  free: number;            // free space of the data volume
}

// GET /api/index: the account's local mail-text index.
export interface IndexInfo {
  mode: BodySearchMode;
  secret_key_set: boolean;
  exists: boolean;
  usable: boolean;
  reason: "index_missing" | "index_key" | null;
  docs: number;
  built_ts: number | null;
  bytes: number;
  estimate: IndexEstimate;        // build / update
  estimate_full: IndexEstimate;   // rebuild
  job: { status: "idle" | "running" | "done" | "error"; progress: string;
         error: string; done: number; total: number };
}

// GET /api/addresses: the Your addresses page (backend/addresses.py).
export type AddressKind = "main" | "tag" | "alias" | "catchall" | "other";
export interface AddressStranger {
  party: string;
  name: string;
  addr: string;
  addrs: string[];     // the sender addresses that wrote to this address
  addr_total: number;  // all its sender addresses (addrs keeps the 10 most used)
  to_block: string[];  // of those, the ones a Block still has to cover
  mails: number;
  protected: boolean;
  blocked: boolean;
}
export interface AddressLeak {
  quiet_days: number;  // how long only the first sender wrote
  quiet_mails: number;
  first_stranger: { ts: number; party: string; name: string; addr: string };
  followed: number;    // other strangers within 2 weeks of the first
  stranger_mails: number;
  dmarc_failed: number | null;   // null: the scan has no sender-check data
  strangers: AddressStranger[];
}
export interface AddressRow {
  address: string;
  kind: AddressKind;
  tag: string;
  mails: number;
  senders: number;
  first_ts: number;
  last_ts: number;
  given_to: { name: string; addr: string; ts: number; subject: string } | null;
  leak: AddressLeak | null;
  retired: boolean;
  retired_ts: number;
  /** An alias: who manages it (an alias service Inboxrake can talk to, or
   *  Firefox Relay / iCloud, which it can only recognise). */
  via?: "service" | "relay" | "icloud";
  related?: string[];
  status: "" | "clean" | "leaked" | "last_seen";
  days_ago?: number | null;
}
export interface AliasServiceStatus {
  service: "simplelogin" | "addy" | "";
  key_set: boolean;
  aliases: number | null;    // null: never read
  synced_ts: number;
  error: string;             // a coded error of the last check, or ""
  services: string[];
}
export interface AddressReport {
  scanned: boolean;
  main: string;
  mails: number;
  read: number;              // mails whose receiving address is known
  total: number;
  leaked: number;
  addresses: AddressRow[];
  service: AliasServiceStatus & { connected: boolean };
}
export interface AddressRetired {
  ok: boolean;
  address: string;
  new_alias?: string;
  new_alias_error?: string;
  junk?: { queued: number; skipped_protected: number; skipped_pinned: number };
  junk_error?: string;
}

// GET /api/trackers: the tracker report built from the body index.
export interface TrackerSender {
  key: string;
  label: string;
  checked: number;
  tracked: number;   // checked mails with a pixel or click tracking
  pixel: number;
  click: number;
  hosts: string[];
}
export interface TrackerHost { host: string; mails: number; senders: number }
export interface TrackerReport {
  usable: boolean;
  reason: "index_missing" | "index_key" | null;
  docs: number;       // mails in the index
  checked: number;    // of those, mails with a tracker result
  pixel: number;
  click: number;
  any: number;
  senders: number;    // senders with at least one tracked mail
  top_senders: TrackerSender[];
  top_hosts: TrackerHost[];
  mode: BodySearchMode;
  secret_key_set: boolean;
  scanned: boolean;
  estimate_full: IndexEstimate;
  job: IndexInfo["job"];
}

// Translatable caveat of a mail-text search (key -> `search.note.<key>`).
export interface SearchNote {
  key: string;
  params: Record<string, string | number>;
  /** Search across accounts: the account the note is about. */
  account?: string;
}

/** Search across accounts (`GET /api/accounts/search`): the hits with their
 *  account, the senders that match, the notes of each account's search. */
export interface AcrossSearchResp {
  mails: Mail[];
  notes: SearchNote[];
  senders: { account: string; key: string; label: string; count: number;
    size: number }[];
}

export interface SearchResp {
  mails: Mail[];
  notes: SearchNote[];
}

export type AutoScanUnit = "minutes" | "hours";

export interface AutoScanSettings {
  enabled: boolean;
  unit: AutoScanUnit;
  value: number;           // the N in "every N <unit>"
  align_minute: number;    // 0-59, minute-of-hour phase
}

export interface ImapAccount {
  excluded_folders: string[];
  host: string;
  port: number;
  security: Security;
  smtp_host: string;
  smtp_port: number;
  smtp_security: SmtpSecurity;
  user: string;
  password: string;
  password_set: boolean;
  /** False until a connection test, an OAuth connect or a scan succeeded
   *  for the saved sign-in; absent from older backends (= verified). */
  verified?: boolean;
  cafile: string;
  preset: Preset;
  /** How the account signs in; absent from older backends (derive it with
   *  `accountAuth`). */
  auth?: AuthMethod;
  oauth: ImapOauth | null;
  digest: DigestSettings;
  auto_scan: AutoScanSettings;
  body_search?: BodySearchMode;   // absent from older backends = "server"
  smart_min?: number;             // Smart: own row from N mails (default 10)
}

export type AuthMethod = "password" | "oauth";
export type OauthProvider = "google" | "microsoft";

// Never carries a token - just enough to render connect status and let
// the user re-enter their own client credentials.
export interface ImapOauth {
  provider: OauthProvider;
  client_id: string;
  client_secret_set: boolean;
  connected: boolean;
}

export type AuthMode = "none" | "password" | "oidc";

export interface AuthProbe {
  mode: AuthMode;
  authed: boolean;
  sub?: string;        // OIDC identity of the session (empty otherwise)
  is_admin?: boolean;  // may edit server-level settings (auth, shared AI)
  demo?: boolean;      // the in-browser demo: network controls are disabled
  idp_host?: string;   // SSO, signed out: the provider's host (sign-in page)
}

// Non-admins only ever receive {mode, is_admin} - the server-side login
// details (incl. the allow-list) are admin-only.
export interface AuthCfg {
  mode: AuthMode;
  is_admin: boolean;
  password_set?: boolean;
  admin?: string;
  oidc?: {
    issuer: string;
    client_id: string;
    client_secret_set: boolean;
    redirect_base: string;
    allowed: string[];
  };
}

// Admin-only usage overview: one row per tenant workspace. Counts,
// spend and disk only - the backend never includes account names,
// addresses or any mail-derived data here.
export interface AdminTenantStats {
  id: string;
  label: string;              // display name (admin identity); "" = use id
  is_admin_workspace: boolean;
  accounts: number;
  mails: number;
  size: number;
  scans: number;
  last_scan_ts: number | null;
  rules: number;
  verdicts: number;
  actions_month: { trash: number; archive: number; move: number;
    mark_read: number; freed: number; purge?: number;
    purged_bytes?: number };
  ai: { source: "own" | "shared" | null; runs: number;
    input_tokens: number; output_tokens: number; cost: number;
    month_cost: number; budget_usd: number };
  disk_bytes: number;
}

// Admin-only: the server-side AI key shared with all tenants.
export interface SharedAiCfg {
  enabled: boolean;
  provider: "anthropic" | "foundry" | "openai" | "ollama";
  model: string;
  foundry_endpoint: string;
  price_in: number;
  price_out: number;
  default_tenant_budget_usd: number;
  api_key: string;
  api_key_set: boolean;
}

export interface Config {
  accounts: Record<string, ImapAccount>;
  /** No account has host, user and credentials yet (first run); absent
   *  from older backends. */
  setup_needed?: boolean;
  default_account: string;
  oauth_providers: OauthProvider[];
  oauth_ms_device_available: boolean;
  secret_key_set?: boolean;   // INBOXRAKE_SECRET_KEY configured (local index)
  auth: AuthCfg;
  protected: string[];
  categories: Record<string, string[]>;
  /** The keywords the six built-in categories ship with (read-only);
   *  absent from older backends. */
  builtin_categories?: Record<string, string[]>;
  new_sender_window_days: number;
  /** Keep-safe switches (per class, plus "Check rule runs too"). Absent from
   *  older backends. */
  keep_safe?: KeepSafeSettings;
  ai: {
    provider: "anthropic" | "foundry" | "openai" | "ollama";
    model: string;
    foundry_endpoint: string;
    price_in: number;
    price_out: number;
    budget_usd: number;
    sort_instructions?: string;        // the user's own text for AI sorting
    month_cost: number;
    prices_effective: [number, number];
    api_key: string;
    api_key_set: boolean;
    available: boolean;
    source: "own" | "shared" | null;   // which key AI runs would use
    shared_budget_usd: number;         // effective cap when on the shared key
  };
  shared_ai?: SharedAiCfg;             // present for the admin only
  /** AI assistants (MCP): the admin's cap and the levels a token can have
   *  today; `options` (the cap's values) is for the admin only. Absent from
   *  older backends. */
  assistants?: { access: AssistantAccess; levels?: AssistantLevel[];
    options?: AssistantAccess[];
    /** "Notify me about proposals": the email switch and, per account, where
     *  the mail would go and whether the account can send one. */
    notify?: { email: boolean;
      accounts: Record<string, { to: string; can_send: boolean }> };
    /** Admin only: unexpired tokens of EVERY user per level (numbers only). */
    token_counts?: Record<AssistantLevel, number>;
    /** Hosted apps (claude.ai, ChatGPT) signing in over OAuth. `available`:
     *  the preconditions hold; `reason` says which one does not (a code,
     *  see `OAUTH_REASONS`); `public_url` is for the admin only. Absent from
     *  a backend without OAuth. */
    oauth?: { enabled: boolean; available: boolean; reason: string;
      mcp_url: string; public_url?: string } };
  ai_stats: {
    input_tokens: number;
    output_tokens: number;
    cost: number;
    runs: number;
  };
}

/** What AI sorting of the Other row would send and cost (nothing is sent). */
export interface SortEstimate {
  units: number;
  senders: number;
  tokens_in: number;
  tokens_out: number;
  cost: number;
  sorted: number;             // senders the AI placed
  checked: number;            // senders it looked at and left in Other
  blocked: string;            // set: why a run cannot start (budget used up)
  available: boolean;
  has_instructions: boolean;
}

/** What the AI wrote for a sentence (POST /api/ai/filter). `query` holds only
 *  tokens the filter understands; what it could not express is `unsupported`. */
export interface AiFilterResult {
  query: string;
  unsupported: string[];
  explanation: string;
  cost: number;
}

/** GET /api/wrapped: one calendar year of one account, metadata only. */
export interface WrappedSender {
  label: string; addr: string; mails: number; bytes: number;
}
/** One window of the Overview's "Last week" card (GET /api/overview). */
export interface OverviewWindow {
  from: number;            // epoch s the window starts at
  mails: number;           // mails that arrived in it (still in the index)
  senders: number;         // distinct senders of those
  newsletters: number;     // ... of which mails with a List-Unsubscribe header
  new_senders: number;     // senders first seen by a scan in it
  still_mailing: number;   // senders that wrote in it after their unsubscribe
  verdicts: number;        // senders rated by the AI in it
  verdicts_safe: number;   // ... of which "safe to delete"
  /** Senders louder than their usual week in it (a window longer than 7 days
   *  counts as the last 7) and the loudest one; absent from an older server. */
  louder?: number;
  louder_top?: { label: string; n: number; usual: number } | null;
  /** Senders whose first mail after 6+ months of silence arrived in it, and
   *  the newest one (`months` = the shortest silence of them). */
  back?: number;
  back_top?: { label: string; months: number; never_opened: boolean } | null;
}
/** GET /api/sender-changes: the Statistics card (last 30 days). */
export interface ChangeRow {
  key: string; label: string;
  /** an unsubscribe is open for it / it is on the protected list / you
   *  have written to it */
  unsub: boolean; protected: boolean; replied: boolean;
}
export interface LouderRow extends ChangeRow {
  n: number; usual: number; factor: number; start: number; end: number;
}
export interface BackRow extends ChangeRow {
  ts: number; gap_days: number; n: number;
}
export interface SenderChangesResp {
  days: number;
  since: number | null;
  louder: LouderRow[];
  back: BackRow[];
}
/** GET /api/subscriptions (backend/subscriptions.py): the senders that bill
 *  on a schedule, found from receipt subjects in the scan index. */
export interface SubUse {
  /** signin / read = in use (an alert, an opened mail within 90 days);
   *  unused = older evidence only; never = no evidence at all. */
  state: "signin" | "read" | "unused" | "never";
  in_use: boolean;
  /** epoch s of the latest evidence (0 = none) */
  ts: number;
  /** unused only: what the latest evidence was, and how many of their other
   *  mails came since (none of them opened) */
  since?: "signin" | "read";
  others?: number;
}
export interface SubReceipt { subject: string; ts: number; folder: string;
  uid: number }
export interface Subscription {
  /** the company (registrable domain; the full address on a shared platform) */
  key: string;
  name: string;
  addr: string;
  cadence: "monthly" | "yearly";
  every_days: number;
  /** monthly: the usual day of the month */
  day: number;
  /** epoch s: first receipt of the current run, the latest, the next expected */
  since: number; last: number; next: number;
  /** The next expected date as the SERVER counts it (UTC, "YYYY-MM-DD") - the
   *  date the reminder and the .ics use, never re-read from `next`. */
  next_date: string;
  /** whole days until `next` (negative = overdue) */
  next_days: number;
  receipts: number;
  /** per receipt; null = the subject names no price */
  amount: number | null;
  currency: string;
  amount_source: "subject" | "receipt" | null;
  /** yearly / 12 */
  monthly: number | null;
  total: number | null;
  total_estimated: boolean;
  /** one square per month (year): 1 = a receipt came; from `slots_from` */
  slots: number[];
  slots_from: number;
  use: SubUse;
  /** newest first */
  latest: SubReceipt[];
  hidden: boolean;
  reminder: boolean;
  /** every receipt is pinned */
  kept: boolean;
}
export interface SubTotals {
  count: number;
  /** the currency the sums are in ("" = no amount anywhere) */
  currency: string;
  other_currencies: string[];
  with_amount: number;
  monthly: number | null;
  unused: number;
  unused_monthly: number | null;
  renewing: number;
}
export interface SubscriptionsResp {
  scanned: boolean;
  now: number;
  /** the opt-in: read the latest receipt's text for its amount */
  body_amounts: boolean;
  /** subscriptions whose latest receipt has not been read yet */
  unread_amounts: number;
  totals: SubTotals;
  items: Subscription[];
}
/** `GET /api/expired`: Mail past its date (backend/pastdate.py). */
export type ExpiredReasonId = "codes" | "parcels" | "events" | "offers";
export interface ExpiredReason {
  id: ExpiredReasonId; mails: number; size: number;
  /** the server's suggestion: offers that have ended start unticked */
  ticked: boolean;
}
export interface ExpiredResp {
  mails: number; size: number;
  /** receipts, invoices and bookings of the same orders / appointments */
  kept: number;
  reasons: ExpiredReason[];
}
export interface SubReminder {
  key: string; ts: number; name: string; next: number;
  amount: number | null; currency: string;
}

/** GET /api/waiting (backend/waiting.py): the mails you sent that nobody
 *  answered, matched from the headers of your Sent folder. */
export interface WaitingItem {
  /** the sent mail's Message-ID (what every decision is keyed by) */
  id: string;
  uid: number;
  state: "open" | "answered" | "needed";
  /** `name` is the display name, else the address */
  person: { addr: string; name: string };
  subject: string;
  /** epoch s you sent it, whole seconds / days open */
  ts: number;
  age: number;
  days: number;
  overdue: boolean;
  /** after how many days it counts as overdue (their usual time or the days
   *  of the setting) */
  limit_days: number;
  /** how many days this person usually takes (null = not known: fewer than
   *  two earlier conversations) and from how many conversations */
  usual_days: number | null;
  usual_n: number;
  answered_ts: number | null;
  answered_days: number | null;
  /** people the mail went to (lists and no-reply addresses not counted) */
  recipients: number;
  reminder: { at: number; fired: number } | null;
}
/** What the Last week row and the phone card show. */
export interface WaitingSummary {
  /** this account watches its sent mail (Settings > Account) */
  watching: boolean;
  overdue: number;
  open: number;
  /** how many different people the overdue mails wait on */
  people_n: number;
  /** up to three names (or addresses), most overdue first, and how many more */
  people: string[];
  more: number;
  oldest_days: number;
  /** the usual answer time of the oldest one (null = not known yet) */
  oldest_usual: number | null;
}
export interface WaitingResp {
  watching: boolean;
  scanned: boolean;
  /** "Overdue after": their usual time | fixed days, and the days */
  mode: "usual" | "fixed";
  days: number;
  counts: { open: number; answered: number; needed: number };
  kpis: { overdue: number; open: number; typical_days: number | null };
  summary: WaitingSummary;
  items: WaitingItem[];
}
/** GET|POST /api/waiting/settings: this account's switch and the per-user
 *  notification settings. */
export interface WaitingSettingsResp {
  watch: boolean;
  notify: boolean;
  mode: "usual" | "fixed";
  days: number;
  subject: boolean;
}
export interface WaitingEvent {
  ts: number;
  kind: "in" | "out";
  /** "" = you (out) or the person you wrote to (in); else somebody else */
  who: string;
  subject: string;
  /** a mail of yours: when they answered it (before your next one) */
  answered_ts?: number | null;
}
export interface WaitingDetail {
  id: string;
  timeline: WaitingEvent[];
  /** their newsletters since (never an answer) */
  newsletters: number;
  /** your sent mail: "Read conversation" opens the reading view from it */
  sent: { folder: string; uid: number };
}
export interface WaitingReminder { id: string; ts: number; name: string;
  days: number }
/** GET /api/waiting/sender: the mail you wait on from one address. */
export interface WaitingSender {
  id: string; ts: number; days: number; overdue: boolean;
  usual_days: number | null; subject: string;
}

/** GET /api/overview: counts behind the Overview, one account. */
export interface OverviewResp {
  now: number;
  /** Mails that arrived per rolling 7-day bucket, oldest first (8). */
  weeks: number[];
  /** Per bucket: true = an estimate from the mails still in the mailbox
   *  (no arrival record covers it), false = counted at the scans. */
  weeks_estimated: boolean[];
  /** Per bucket: what the mails still in the mailbox alone give. */
  weeks_in_mailbox: number[];
  week: OverviewWindow;
  /** The window since the previous visit; null without one. */
  since: OverviewWindow | null;
  kinds: { days: number; total: number;
    items: { kind: string; count: number }[] };
  /** The scan nearest to a month back; null when there is none to compare. */
  trend: { ts: number; size: number; mails: number } | null;
}

export interface WrappedResp {
  year: number;
  /** The year is still running ("so far"). */
  partial: boolean;
  years: number[];
  received: { mails: number; bytes: number; senders: number; read: number;
    new_senders: number };
  top_senders: WrappedSender[];
  /** 1-12 */
  loudest_month: { month: number; mails: number } | null;
  /** Mails per month (Jan..Dec), per weekday (Mon..Sun), per hour (0-23). */
  by_month: number[]; by_weekday: number[]; by_hour: number[];
  /** 0 = Monday */
  busiest_weekday: { weekday: number; mails: number } | null;
  busiest_hour: { hour: number; mails: number } | null;
  biggest: { label: string; addr: string; bytes: number } | null;
  ghosts: { count: number; top: WrappedSender[] };
  cleanup: {
    trashed: number; archived: number; purged: number; freed_bytes: number;
    unsubscribes: number; rule_runs: number;
    top_rule: { name: string; deleted: boolean; mails: number } | null;
  };
}

/** One account's last scan in short (`GET /api/accounts/summary`). */
export interface AccountSummary {
  status: string;
  scanned_ts: number | null;
  mails: number;
  size: number;
}

/** The admin's cap on AI assistants (the `assistants.access` server setting). */
export type AssistantAccess = "off" | "read_propose" | "act";
export type AssistantLevel = "read" | "propose" | "act";

/** One AI-assistant access token as the API lists it (never its secret). A
 *  hosted app's OAuth connection ("grant") is the same record with
 *  `kind: "oauth"`: it shows the app's host instead of a token prefix. */
export interface AssistantToken {
  id: string;
  name: string;
  /** "token" (a static `irk_` token; absent from older backends) or "oauth". */
  kind?: "token" | "oauth";
  /** `irk_` + 4 characters: all that is shown of it afterwards (tokens). */
  prefix?: string;
  /** OAuth connections: the app's host, its own name for itself, its scopes. */
  client_host?: string;
  client_name?: string;
  scope?: string;
  accounts: string[];
  level: AssistantLevel;
  subjects: boolean;
  daily_cap: number;
  created: number;                     // epoch seconds
  expires: number | null;
  last_used: number | null;
  calls_today: number;
  mails_today: number;
  /** its proposals still waiting for the user */
  proposals?: number;
}

export interface AssistantTokenList {
  tokens: AssistantToken[];
  access: AssistantAccess;
  levels: AssistantLevel[];
}

export interface AssistantTokenRequest {
  name: string;
  accounts: string[];
  level: AssistantLevel;
  subjects: boolean;
  expires_days: 30 | 90 | null;
  daily_cap?: number;
}

/* Copy to another account (backend/accountcopy.py). */
export type CopyKindId = "replied" | "orders" | "accounts" | "appointments"
  | "protected" | "pinned" | "newsletter" | "other";

export interface CopyPlan {
  source: { name: string; address: string; mails: number; size: number };
  target: { name: string; address: string };
  /** The default name of the new folder ("From <source>"). */
  folder: string;
  kinds: { id: CopyKindId; mails: number; size: number; default: boolean }[];
  /** Bit of each kind in a combo's `mask`. */
  bits: Record<CopyKindId, number>;
  /** Mails + bytes per distinct set of kinds: a mail in two kinds is one
   *  combo, so any ticked set sums to a de-duplicated figure. */
  combos: { mask: number; mails: number; size: number }[];
  scanned: boolean;
  scanning: boolean;
}

export type CopyStatus = "running" | "paused" | "done" | "cancelled" | "error";

export interface CopyJob {
  id: string;
  source: string;
  target: string;
  folder: string;
  kinds: CopyKindId[];
  status: CopyStatus;
  total: number;
  bytes_total: number;
  /** Finished mails: copied + already there + over 50 MB + gone. */
  processed: number;
  copied: number;
  skipped: number;
  checked: number;
  unchecked: number;
  too_large: number;
  missing: number;
  failed: number;
  /** Id-less mails whose APPEND was never confirmed and that the target does
   *  not show: they may not have been copied. */
  unsure: number;
  bytes_done: number;
  started: number;
  finished: number;
  /** A coded error (see ERROR_CODES) when `status` is "error". */
  error: string;
  active_s: number;
  eta_s: number | null;
}

export interface CopyTellSender {
  addr: string;
  name: string;
  mails: number;
  last: number;
  done: boolean;
}

export interface CopyTell {
  source: { name: string; address: string };
  target: { name: string; address: string };
  total: number;
  done: number;
  senders: CopyTellSender[];
  newsletters: number;
  newsletter_keys: string[];
}

/** One step of the Time machine (`/api/timemachine`): an audit entry's
 *  fields plus what a restore would do with it. `status`: `back` = it has an
 *  undo step, `cant` = it moved mail that can't be found (`reason`), `undone`
 *  = an undo put it back, `stays` = nothing to undo. */
export interface TmStep {
  id: string;
  ts: number;
  action: string;
  actor: string;
  count: number;
  bytes: number;
  label: string;
  outcome: string;
  error?: string;
  from_role?: "junk" | "trash";
  status: "back" | "cant" | "undone" | "stays";
  /** why a `cant` step cannot come back */
  reason?: "emptied" | "untracked" | "deleted";
  /** when the Trash was emptied (reason `emptied`) */
  at?: number;
  /** on a `back` step: mails it can still bring back, what it lost to an
   *  emptied Trash, its senders (most mails first) */
  mails?: number;
  lost?: number;
  senders?: { addr: string; n: number }[];
  senders_total?: number;
  token?: string;
}

/** Steps less than 30 minutes apart; `first` / `last` = oldest / newest step. */
export interface TmSession {
  start: number;
  end: number;
  steps: number;
  mails: number;
  first: string;
  last: string;
}

export interface TmListing {
  /** newest first */
  steps: TmStep[];
  /** newest first */
  sessions: TmSession[];
  now: number;
  keep_days: number;
  step_cap: number;
}

export interface TmPreview {
  /** the newest step the preview counted */
  top: string;
  point: string;
  point_ts: number;
  /** undoable steps after the point */
  steps: number;
  /** sessions newer than the point's own the restore reaches into */
  newer_sessions: number;
  mails: number;
  bytes: number;
  folders: { folder: string; name: string; mails: number }[];
  senders: { addr: string; mails: number; bytes: number }[];
  cant: { reason: string; mails: number; at: number | null }[];
  stays: { kind: string; n: number }[];
  skipped: { protected: number; pinned: number };
  rules: { id: string; name: string; mails: number }[];
}

export interface RestoreState {
  status: "idle" | "running" | "done" | "error";
  progress: string;
  error: string;
  seq: number;
  steps_done: number;
  steps_total: number;
  moved: number;
  point_ts?: number;
  skipped_protected?: number;
  skipped_pinned?: number;
  cant?: number;
  /** mails left alone because their Message-ID belongs to another mail too */
  ambiguous?: number;
  paused?: string[];
}

/** `GET /api/assistants/connect`: what the consent page shows. */
export interface ConnectRequest {
  request_id: string;
  client: { client_id: string; host: string; name: string;
    redirect_host: string };
  /** The highest level the page may offer (the app's ask, cut to the cap). */
  ceiling: AssistantLevel;
  accounts: string[];
  defaults: { level: AssistantLevel; subjects: boolean;
    expires_days: 30 | 90 | null; daily_cap: number; name: string };
}

/** The decision answers: where to send the browser next. */
export interface ConnectRedirect { redirect_url: string }

export interface ConnectDecision {
  request_id: string;
  approve: boolean;
  name?: string;
  accounts?: string[];
  level?: AssistantLevel;
  subjects?: boolean;
  expires_days?: 30 | 90 | null;
  daily_cap?: number;
}

/* ---- the All accounts page (`GET /api/accounts/overview`) ---- */

/** One mailbox's card. `failed`: its newest scan failed (`failed_ts` = when,
 *  null after a restart); `scanned_ts` stays the last GOOD scan. */
export interface AllAccountCard {
  name: string;
  user: string;
  status: string;
  progress: string;
  scanned_ts: number | null;
  failed: boolean;
  failed_ts: number | null;
  mails: number;
  size: number;
  senders: number;
  junk: number | null;
  trash: number | null;
  /** mails newer than the remembered visit (`new_basis` "visit") or the last
   *  week ("week") */
  new: number;
  new_basis: "visit" | "week";
  /** the account's `groups_rev`: it moves when a scan or a move changed it */
  rev: number;
  /** a move / unsubscribe job is still running there */
  busy: boolean;
  /** a job that ended with an error (`id` = one message per job) */
  job_failed: { id: string; error: string } | null;
  /** its newest Undo steps by the id of the queued job that made them
   *  ("Undo all N" finds the step of its OWN job, never "the newest") */
  undo_jobs: Record<string, { id?: string; ts: number; label: string;
    count: number; action: string }>;
}

/** One account's part of a sender that writes to several accounts. */
export interface SameSenderPart {
  account: string;
  /** the address that stands for the sender in that account */
  addr: string;
  mails: number;
  size: number;
  /** pinned mails among `mails` (they never move) */
  pinned: number;
  /** this account already blocks the address (a Block rule) */
  blocked: boolean;
  /** its mails carry an unsubscribe link / address */
  unsub: boolean;
  /** this account's own unsubscribe record */
  state: "done" | "link" | "failed" | null;
  /** how THAT account would unsubscribe */
  via: UnsubVia;
}

export interface SameSenderRow {
  /** company domain, or the exact address on freemail / shared hosts */
  key: string;
  name: string;
  match: "address" | "domain";
  accounts: SameSenderPart[];
  /** accounts where the sender is protected: never part of a step */
  left_out: { account: string; addr: string; why: "protected" }[];
  mails: number;
  size: number;
  /** percent of these mails the user opened */
  opened: number;
}

export interface AllAccountsResp {
  now: number;
  accounts: AllAccountCard[];
  totals: { mails: number; size: number; senders: number };
  same_sender: SameSenderRow[];
}

/* ---- "Same mails in several accounts" (`GET /api/accounts/copies`) ---- */

/** What a move of ONE account's copies to Trash would take: `trash` mails of
 *  `size` bytes, `held` left out (pinned, or from a protected sender). */
export interface CopiesSide { trash: number; size: number; held: number }

/** The exact copies (same Message-ID and size) between two accounts. */
export interface CopiesPair {
  a: string;
  b: string;
  mails: number;
  size: number;
  /** oldest / newest of them (epoch seconds) */
  first: number;
  last: number;
  in_a: CopiesSide;
  in_b: CopiesSide;
}

export interface CopiesResp {
  pairs: CopiesPair[];
  /** copies "Move to another account" made: never offered */
  left_out: number;
}

/* ---- Your folders (`GET /api/your_folders`, backend/yourfolders.py) ---- */

/** Why a folder is locked (no rename / merge / delete): the inbox, a role
 *  folder (Archive, Sent, Drafts, Junk, Trash), a provider's own folder, a
 *  parent-only folder. */
export type FolderLock = "inbox" | "role" | "provider" | "noselect";
/** The reason one operation is off for a folder (null = allowed). */
export type FolderWhy = FolderLock | "label" | "move_unsafe" | "children"
  | "rules" | "not_empty";
export type FolderHint = "look" | "empty" | "stale";

/** A rule as a folder row names it. */
export interface FolderRule {
  id: string;
  name: string;
  mode: "report" | "execute";
  schedule?: "manual" | "daily" | "weekly";
}

export interface YourFolderRow {
  raw: string;
  /** readable name (the whole path) */
  name: string;
  delim: string | null;
  lock: FolderLock | null;
  role: string | null;
  /** a mail can carry several of these (Gmail labels, Proton "Labels/...") */
  label: boolean;
  scanned: boolean;
  /** why a folder the scan did not read is out: an exclusion pattern, or its
   *  own switch */
  off: "pattern" | "switch" | null;
  pattern: string;
  /** the last scan's numbers; null = the scan did not read it */
  mails: number | null;
  size: number | null;
  newest: number | null;
  unread: number | null;
  /** the senders with most mail in it (up to three) */
  top: { addr: string; label: string; n: number }[];
  used_by: FolderRule[];
  children: number;
  hints: FolderHint[];
  /** the folder it looks like (raw name) */
  twin: string | null;
  can: { rename: FolderWhy | null; merge: FolderWhy | null;
         delete: FolderWhy | null };
}

export interface YourFoldersResp {
  rows: YourFolderRow[];
  hints: { kind: FolderHint; folders: string[] }[];
  /** the account's special folders (not rows: the page's footer names them) */
  special: { raw: string; name: string; why: FolderLock | null;
             role: string | null }[];
  totals: { scanned: number; mails: number; size: number;
            not_scanned: number };
  scanned: boolean;
  gmail: boolean;
  /** the code of what keeps folders from being changed right now */
  busy: string | null;
  scanned_ts?: number | null;
}

/** The live numbers and rules of an operation, for its confirm. */
export interface FolderCheck {
  folder: string;
  name: string;
  target?: string;
  target_name?: string;
  /** merge: the mails to move (live) and what the move is bound to */
  count?: number;
  uv?: number;
  max_uid?: number;
  /** the rules that move mail into this folder (rename / merge) */
  rules?: FolderRule[];
  pinned?: number;
  protected?: number;
  /** merge: why "then delete the folder" is not offered (null = it is) */
  can_delete?: FolderWhy | null;
  /** rename: the new raw / readable name and what it changes */
  new?: string;
  new_name?: string;
  children?: number;
  stops_scanning?: boolean;
}

export interface FolderMergeResult {
  moved: number;
  target?: string;
  undo: UndoIdent | null;
  rules: { id: string; name: string; mode: "report" | "execute" }[];
  deleted: boolean;
  /** why the emptied folder was kept ("then delete" was ticked) */
  kept: string;
}
