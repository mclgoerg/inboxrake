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
}

export interface AuditResp {
  total: number;
  entries: AuditEntry[];
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
}

/** Where a rule looks: the main cleanup index, or the Junk / Trash folder
 *  (those rules delete permanently, on the server). */
export type RuleScope = "mail" | "junk" | "trash";

export interface Rule {
  id: string;
  name: string;
  scope: RuleScope;
  grouping: Grouping;
  query: string;
  action: string;
  dest: string;
  schedule: "manual" | "daily" | "weekly";
  mode: "report" | "execute";
  keep_latest: number | null;
  older_than_days: number | null;
  /** "auto_empty": the Trash page's "Empty automatically" switch made it. */
  origin: "manual" | "block" | "auto_empty";
  report_runs: number;
  /** Purge rules: why an armed rule went back to report mode (shown on the
   *  card). */
  reset_reason?: "" | "edited" | "account" | "folder";
  /** Parts of the filter Inboxrake does not understand (a rule saved before
   *  filters were validated); its execute runs are skipped. */
  filter_invalid?: string[];
  created: number;
  last_run: RuleRun | null;
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
  junk_count?: number | null;
  notice: { key: string; params: Record<string, string | number> } | null;
  undo: UndoEntry[];
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
  new_sender_window_days: number;
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
