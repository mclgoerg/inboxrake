import { t } from "./i18n";
import type {
  AssistantTokenList, AssistantToken, AssistantTokenRequest, ConnectDecision, ConnectRedirect, ConnectRequest,
  AccountSummary, AllAccountsResp, AddressReport, AddressRetired, AdminTenantStats, AliasServiceStatus, AiFilterResult, AiGroupResult, AppState, AttMail, AuditBy, AuditResp, AuthProbe,
  KnowledgeList, KnowledgeSaved, KnowledgeSrc, SenderLabels, Verdict,
  AttSummary, Config, ConversationResp, DupKind, DupSet, DupSummary, FilterPreset, FoldersResp, Grouping, IndexInfo, TrackerReport,
  ExpiredResp, Mail, MessageDetail, SubReminder, SubscriptionsResp,
  WaitingDetail, WaitingReminder, WaitingResp, WaitingSender,
  WaitingSettingsResp,
  LookalikeCount, MailsResp, OverviewResp, Rule, RuleCheckup, RuleRun, SearchResp, SenderChangesResp, SortEstimate, StatsResp, TrashResp, WrappedResp,
  FolderMoveResp, FolderRole, PurgePreview, PurgeResult, PurgeSelect,
  UndoEntry, UndoIdent, UnsubBulkResult, UnsubPreview, UnsubResult,
  UnsubRunItem, KeepSafeCheck, KeepSafeClass, KeepSafeScope,
  CopyJob, CopyKindId, CopyPlan, CopyTell, TmListing, TmPreview,
} from "./types";
import { userZone, type ArrivalSlot, type RhythmPeriod, type RhythmResp }
  from "./rhythm";

/** The body of a Time machine preview / restore: `point` = the id of the
 *  newest step that STAYS ("" = before every step), `top` = the newest step
 *  the preview counted (a restore leaves newer steps alone), `senders` = Pick
 *  senders, `pause` = the rules to switch to Report only. */
export interface TmRequest {
  point: string;
  top?: string;
  senders?: string[] | null;
  pause?: string[];
}

/* Active account: every API call is scoped to exactly one account (strict
 * separation - the backend never mixes them). Set once by App on startup
 * and whenever the user switches. */
let ACCOUNT = "";

export function setAccount(name: string) {
  ACCOUNT = name;
}

/** Pin a call to one account (the one being edited in Settings, which is
 *  not necessarily the active one). */
const forAccount = (path: string, account?: string): string =>
  account ? `${path}${path.includes("?") ? "&" : "?"}account=`
    + encodeURIComponent(account) : path;

export function withAccount(path: string): string {
  if (!ACCOUNT || path.includes("account=")) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}account=${encodeURIComponent(ACCOUNT)}`;
}

/* iOS Safari, when installed as a standalone PWA, does not reliably
 * handle a plain `<a href=url>` navigation to a Content-Disposition:
 * attachment response: `download` opens its Quick Look preview with no
 * way to dismiss it short of a swipe, and target="_blank" opens a blank
 * in-app browser tab that neither renders nor saves anything. Fetching
 * the file ourselves and handing the browser a blob: URL instead is the
 * one approach that reliably triggers an actual save/share sheet on
 * every platform. */
export async function downloadFile(url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  saveBlob(/filename="?([^"]+)"?/.exec(cd)?.[1] ?? "download", blob);
}

/** Hand a blob to the browser as a download (blob: link, so it also works in
 *  iOS standalone mode). */
export function saveBlob(name: string, blob: Blob): void {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/* Stable error codes the backend answers with (the HTTP `detail`; see
 * mailops.py / knowledgestore.py) -> the `t()` key of the translated text. */
const ERROR_CODES: Record<string, string> = {
  action_cancelled: "ferr.action_cancelled",
  protected_sender_selected: "ferr.protected_sender_selected",
  undo_copy_unknown: "ferr.undo_copy_unknown",
  no_message_id: "pin.no_message_id",
  pinned_mails: "pin.refused",
  protected_mails: "fp.protected_refused",
  all_pinned: "toast.all_pinned",
  delete_protected: "toast.delete_protected",
  // private sender knowledge (backend/knowledgestore.py)
  knowledge_bad_request: "know.err.bad_request",
  knowledge_bad_key: "know.err.bad_key",
  knowledge_bad_kind: "know.err.bad_kind",
  knowledge_bad_note: "know.err.bad_note",
  knowledge_full: "know.err.full",
  knowledge_ai_running: "know.err.ai_running",
  knowledge_unscanned: "know.err.unscanned",
  // a sender's own verdict / tags (backend/labelstore.py)
  labels_bad_request: "labels.err.bad_request",
  labels_bad_key: "labels.err.bad_key",
  labels_bad_verdict: "labels.err.bad_verdict",
  labels_bad_tags: "labels.err.bad_tags",
  labels_full: "labels.err.full",
  labels_unscanned: "labels.err.unscanned",
  labels_scan_running: "labels.err.scan_running",
  labels_unknown_sender: "labels.err.unknown_sender",
  // the digest's app address (backend/config.py)
  digest_bad_url: "digest.err.bad_url",
  // special-folder choices (backend/mailops.py)
  role_not_candidate: "folder.err.not_candidate",
  role_ambiguous: "folder.err.ambiguous",
  move_unsafe: "folder.err.move_unsafe",
  not_lookalike: "folder.err.not_lookalike",
  // Empty Trash, permanent deletion, Folders panel moves, undo (mailops.py)
  busy_action: "ferr.busy_action",
  busy_purge: "ferr.busy_purge",
  busy_scan: "ferr.busy_scan",
  busy_rule: "ferr.busy_rule",
  count_required: "ferr.count_required",
  role_missing: "ferr.role_missing",
  inbox_missing: "ferr.inbox_missing",
  data_not_writable: "ferr.data_not_writable",
  junk_needs_trash: "ferr.junk_needs_trash",
  role_unconfirmed: "ferr.role_unconfirmed",
  junk_is_trash: "ferr.junk_is_trash",
  folder_changed: "ferr.folder_changed",
  folder_changed_rescan: "ferr.folder_changed_rescan",
  partial_unsafe: "ferr.partial_unsafe",
  partial_unsafe_changed: "ferr.partial_unsafe_changed",
  cannot_open: "ferr.cannot_open",
  cannot_list: "ferr.cannot_list",
  cannot_flag: "ferr.cannot_flag",
  cannot_expunge: "ferr.cannot_expunge",
  cannot_move: "ferr.cannot_move",
  cannot_remove_copies: "ferr.cannot_remove_copies",
  cannot_read_moved: "ferr.cannot_read_moved",
  uv_unreadable: "ferr.uv_unreadable",
  no_known_selected: "ferr.no_known_selected",
  unknown_target: "ferr.unknown_target",
  target_is_trash: "ferr.target_is_trash",
  nothing_to_undo: "ferr.nothing_to_undo",
  unknown_point: "ferr.unknown_point",
  deleted_then_failed: "ferr.deleted_then_failed",
  stranded_then_failed: "ferr.stranded_then_failed",
  moved_then_failed: "ferr.moved_then_failed",
  // purge rules (backend/rules.py)
  rule_report_first: "ferr.rule_report_first",
  rule_folder_changed: "ferr.rule_folder_changed",
  rule_purge_grouping: "ferr.rule_purge_grouping",
  rule_purge_keep_latest: "ferr.rule_purge_keep_latest",
  rule_purge_needs_age: "ferr.rule_purge_needs_age",
  rule_purge_filter: "ferr.rule_purge_filter",
  rule_purge_filter_domain: "ferr.rule_purge_filter_domain",
  rule_filter_invalid: "ferr.rule_filter_invalid",
  rule_filter_invalid_run: "ferr.rule_filter_invalid_run",
  rule_filter_window: "ferr.rule_filter_window",
  rule_filter_window_run: "ferr.rule_filter_window_run",
  rule_filter_too_long: "ferr.rule_filter_too_long",
  request_too_large: "ferr.request_too_large",
  block_key_invalid: "ferr.block_key_invalid",
  // List-Unsubscribe mailto: refused (backend/smtpout.py)
  mailto_unsafe: "ferr.mailto_unsafe",
  no_account: "ferr.no_account",
  cafile_missing: "ferr.cafile_missing",
  auth_failed: "ferr.auth_failed",
  host_unreachable: "ferr.host_unreachable",
  tls_failed: "ferr.tls_failed",
  host_not_found: "ferr.host_not_found",
  conn_refused: "ferr.conn_refused",
  conn_timeout: "ferr.conn_timeout",
  tls_mismatch: "ferr.tls_mismatch",
  not_imap: "ferr.not_imap",
  cert_failed: "ferr.cert_failed",
  connect_failed: "ferr.connect_failed",
  scan_failed: "ferr.scan_failed",
  internal_error: "ferr.internal_error",
  oauth_reconnect: "ferr.oauth_reconnect",
  idp_unavailable: "ferr.idp_unavailable",
  // a move on a server without MOVE/UIDPLUS refused (backend/mailops.py)
  move_foreign_deleted: "ferr.move_foreign_deleted",
  // the other unsubscribe failures (backend/unsub.py classify)
  unsub_blocked: "ferr.unsub_blocked",
  unsub_http: "ferr.unsub_http",
  unsub_tls: "ferr.unsub_tls",
  unsub_unreachable: "ferr.unsub_unreachable",
  unsub_timeout: "ferr.unsub_timeout",
  unsub_bad_url: "ferr.unsub_bad_url",
  unsub_no_method: "ferr.unsub_no_method",
  unsub_mail_failed: "ferr.unsub_mail_failed",
  unsub_pooled: "ferr.unsub_pooled",
  unsub_protected: "ferr.unsub_protected",
  unsub_unknown_group: "ferr.unsub_unknown_group",
  unsub_failed: "ferr.unsub_failed",
  // plain words -> filter (backend/aifilter.py)
  aifilter_not_configured: "aif.err.not_configured",
  aifilter_text_empty: "aif.err.text_empty",
  aifilter_text_too_long: "aif.err.text_too_long",
  aifilter_budget: "aif.err.budget",
  // password login throttle (backend/auth.py)
  login_throttled: "ferr.login_throttled",
  login_wrong_password: "ferr.login_wrong_password",
  login_password_off: "ferr.login_password_off",
  login_sso_off: "ferr.login_sso_off",
  copy_unknown_account: "ferr.copy_unknown_account",
  copy_same_account: "ferr.copy_same_account",
  copy_busy: "ferr.copy_busy",
  copy_nothing: "ferr.copy_nothing",
  copy_not_scanned: "ferr.copy_not_scanned",
  copy_folder_name: "ferr.copy_folder_name",
  copy_cannot_create: "ferr.copy_cannot_create",
  copy_source_changed: "ferr.copy_source_changed",
  copy_append_refused: "ferr.copy_append_refused",
  copy_target_full: "ferr.copy_target_full",
  copy_no_job: "ferr.copy_no_job",
  copy_same_mailbox: "ferr.copy_same_mailbox",
  copy_cannot_confirm: "ferr.copy_cannot_confirm",
  copy_folder_reserved: "ferr.copy_folder_reserved",
  // the in-browser demo (backend/demo.py)
  not_in_demo: "ferr.not_in_demo",
  // Web Push (backend/webpush.py)
  push_invalid: "ferr.push_invalid",
  push_unknown: "ferr.push_unknown",
  push_http: "ferr.push_http",
  push_unreachable: "ferr.push_unreachable",
  // alias service (backend/aliasservice.py)
  alias_no_service: "ferr.alias_no_service",
  alias_key: "ferr.alias_key",
  alias_unreachable: "ferr.alias_unreachable",
  alias_http: "ferr.alias_http",
  alias_not_found: "ferr.alias_not_found",
  alias_bad_address: "ferr.alias_bad_address",
  // AI assistant access tokens (backend/assistanttokens.py)
  assistants_off: "ferr.assistants_off",
  level_not_available: "ferr.level_not_available",
  assistant_token_name: "ferr.assistant_token_name",
  assistant_token_accounts: "ferr.assistant_token_accounts",
  assistant_token_expiry: "ferr.assistant_token_expiry",
  assistant_token_cap: "ferr.assistant_token_cap",
  assistant_token_level: "ferr.assistant_token_level",
  assistant_token_limit: "ferr.assistant_token_limit",
  assistant_token_unknown: "ferr.assistant_token_unknown",
};

/** Codes of the hosted-app (OAuth) features (backend/oauthserver.py,
 *  oauthclients.py, assistanttokens.py, config.py). A separate map: they are
 *  answered by those modules, not the folder-feature set `ERROR_CODES` mirrors
 *  (tests/test_error_codes.py). */
const OAUTH_ERROR_CODES: Record<string, string> = {
  name_taken: "ferr.name_taken",
  assistant_grant_limit: "ferr.assistant_grant_limit",
  oauth_needs_login: "ferr.oauth_needs_login",
  oauth_needs_public_url: "ferr.oauth_needs_public_url",
  oauth_needs_access: "ferr.oauth_needs_access",
  connect_request_gone: "ferr.connect_request_gone",
  connect_request_mismatch: "ferr.connect_request_mismatch",
  connect_request_invalid: "ferr.connect_request_invalid",
  connect_redirect_uri: "ferr.connect_redirect_uri",
  connect_no_accounts: "ferr.connect_no_accounts",
  connect_level_above_ceiling: "ferr.connect_level_above_ceiling",
  client_invalid_url: "ferr.client_invalid_url",
  client_unreachable: "ferr.client_unreachable",
  client_blocked: "ferr.client_blocked",
  client_bad_response: "ferr.client_bad_response",
  client_invalid_document: "ferr.client_invalid_document",
  client_rate_limited: "ferr.client_rate_limited",
};

/** The role names a `role=` param stands for (translated). */
const ROLE_NAMES: Record<string, string> = {
  trash: "Trash", junk: "Junk", archive: "ferr.role_archive",
};

/** A coded error detail: `code` or `code:key=value,...` (mailops.coded; the
 *  values are percent-encoded, so a folder name or a nested `cause=` can hold
 *  any character). Counts are `n`. `null` unless it is one of our codes with
 *  well-formed params - the caller then shows the raw text. */
export function parseErrorDetail(detail: string):
    { code: string; params: Record<string, string | number> } | null {
  if (typeof detail !== "string") return null;   // e.g. a 422's error list
  const i = detail.indexOf(":");
  const code = i < 0 ? detail : detail.slice(0, i);
  if (!Object.hasOwn(ERROR_CODES, code)
      && !Object.hasOwn(OAUTH_ERROR_CODES, code)) return null;
  const params: Record<string, string | number> = {};
  if (i >= 0) {
    try {
      for (const pair of detail.slice(i + 1).split(",")) {
        const eq = pair.indexOf("=");
        if (eq < 1) return null;
        const key = pair.slice(0, eq);
        const value = decodeURIComponent(pair.slice(eq + 1));
        params[key] = key === "n" && /^\d+$/.test(value) ? Number(value) : value;
      }
    } catch {
      return null;                     // a broken % escape: show it raw
    }
  }
  return { code, params };
}

/** The user-language text of a backend error `detail`: a known code with
 *  its params, a nested `cause` translated the same way; anything else (an
 *  unknown code, plain English from an older server, a raw IMAP error) as it
 *  is. */
export function errorText(detail: string): string {
  const parsed = parseErrorDetail(detail);
  if (!parsed) return detail;
  const { code, params } = parsed;
  const text: Record<string, string | number> = { ...params };
  if (typeof params.cause === "string") text.cause = errorText(params.cause);
  if (typeof params.role === "string")
    text.folder = t(ROLE_NAMES[params.role] ?? params.role);
  return t(ERROR_CODES[code] ?? OAUTH_ERROR_CODES[code], text);
}

/** The label of an Undo entry in the user's language: the structured label
 *  (key + params) the backend recorded for it, else the label as sent - a
 *  sender, a folder name, or an entry from before labels were structured. */
export const undoLabel = (u: UndoLabelled): string =>
  u.label_key ? t(u.label_key, u.label_params) : u.label;

type UndoLabelled = Pick<UndoEntry, "label" | "label_key" | "label_params">;

/** Notice params with a structured `label` (`label_key` + `label_<param>`,
 *  see mailops.undo_last) worded in the user's language. */
export function noticeParams(
    params: Record<string, string | number>): Record<string, string | number> {
  const key = params.label_key;
  if (typeof key !== "string") return params;
  const sub: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params))
    if (k.startsWith("label_") && k !== "label_key") sub[k.slice(6)] = v;
  return { ...params, label: t(key, sub) };
}

async function req<T>(path: string, body?: unknown,
                      method?: "PUT" | "DELETE" | "PATCH",
                      signal?: AbortSignal): Promise<T> {
  const res = await fetch(withAccount(path), {
    signal,
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = await res.text();
    try {
      detail = JSON.parse(detail).detail ?? detail;
    } catch {
      /* plain text */
    }
    const parsed = parseErrorDetail(detail);
    const err: Error & { code?: string } =
      new Error(detail ? errorText(detail) : `HTTP ${res.status}`);
    if (parsed) err.code = parsed.code;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  state: () => req<AppState>("/api/state"),
  scan: (account?: string) =>
    req<{ ok: boolean }>(forAccount("/api/scan", account), {}),
  group: (grouping: Grouping, key: string) =>
    req<Mail[]>(`/api/group?grouping=${grouping}&key=${encodeURIComponent(key)}`),
  message: (folder: string, uid: number) =>
    req<MessageDetail>(
      `/api/message?folder=${encodeURIComponent(folder)}&uid=${uid}`),
  // Several mails' text over ONE IMAP connection (conversation reader).
  messages: (items: [string, number][]) =>
    req<{ messages: (Partial<MessageDetail> & { folder: string; uid: number;
      error?: string })[] }>("/api/messages", { items }),
  thread: (folder: string, uid: number) =>
    req<ConversationResp>(
      `/api/thread?folder=${encodeURIComponent(folder)}&uid=${uid}`),
  deleteGroups: (grouping: Grouping, keys: string[],
                 action = "trash", dest = "", force = false,
                 keepLatest: number | null = null,
                 olderThanDays: number | null = null,
                 onlyAddrs: string[] | null = null,
                 /** a bulk path (the All accounts page): never a protected
                  *  sender, whatever the action */
                 skipProtected = false, account?: string) =>
    req<{ ok: boolean; queued: number; skipped: number;
      skipped_pinned?: number }>(forAccount("/api/delete", account),
      { grouping, keys, action, dest, force, keep_latest: keepLatest,
        older_than_days: olderThanDays,
        ...(onlyAddrs ? { only_addrs: onlyAddrs } : {}),
        ...(skipProtected ? { skip_protected: true } : {}) }),
  protect: (entry: string, on: boolean) =>
    req<{ protected: string[] }>("/api/protect", { entry, on }),
  // The AI writes a filter query from a sentence (nothing else is sent).
  aiFilter: (text: string, lang: string) =>
    req<AiFilterResult>("/api/ai/filter", { text, lang }),
  aiSortEstimate: () => req<SortEstimate>("/api/ai_sort/estimate"),
  aiSort: () => req<{ units: number; senders: number }>("/api/ai_sort", {}),
  aiSortClear: () => req<{ cleared: number }>("/api/ai_sort/clear", {}),
  // A sender's own verdict / tags (per account). `verdict` / `tags`: a value
  // sets it, null goes back to automatic, left out = unchanged.
  labels: (key: string) => req<SenderLabels>(
    `/api/labels?key=${encodeURIComponent(key)}`),
  labelsPut: (body: { key: string; verdict?: Verdict | null;
      tags?: string[] | null; reset?: boolean }) =>
    req<SenderLabels>("/api/labels", body, "PUT"),
  // Private sender knowledge (per user, shared by all accounts).
  knowledge: () => req<KnowledgeList>("/api/knowledge"),
  // File entries ({key, kind, note?, src?, ts?}) and / or remove keys in one
  // request; `previous` is what an Undo puts back.
  knowledgePut: (body: { entries?: { key: string; kind: string;
      note?: string; src?: KnowledgeSrc; ts?: number }[]; remove?: string[] }) =>
    req<KnowledgeSaved>("/api/knowledge", body, "PUT"),
  // Keep the AI's cached answers of the current account as your own rules.
  knowledgeKeepAi: () =>
    req<{ ok: boolean; kept: number; senders: number; skipped: number }>(
      "/api/knowledge/keep_ai", { all: true }),
  knowledgeForgetAi: () =>
    req<{ ok: boolean; forgotten: number }>("/api/knowledge/forget_ai", {}),
  // Refused (code knowledge_unscanned) unless every account has a finished scan.
  knowledgeRemoveUnused: () =>
    req<{ ok: boolean; removed: number }>("/api/knowledge/remove_unused", {}),
  // Merge a knowledge section ({version, entries}) - just this, no settings.
  knowledgeImport: (section: unknown) =>
    req<{ ok: boolean; knowledge: number }>("/api/import_config",
      { knowledge: section }),
  protectMany: (entries: string[], on: boolean) =>
    req<{ protected: string[] }>("/api/protect", { entries, on }),
  deleteMessages: (items: [string, number][], action = "trash", dest = "",
                   force = false) =>
    req<{ ok: boolean; queued: number }>("/api/delete_messages",
      { items, action, dest, force }),
  pin: (folder: string, uid: number, pinned: boolean) =>
    req<{ ok: boolean; pinned: boolean }>("/api/pin",
      { folder, uid, pinned }),
  // Keep-safe: which mails of a Trash move look worth keeping, and the pin of
  // the ticked classes before the move (the server decides the classes).
  // `account`: the one the move belongs to (a pin must never land in another).
  keepSafeCheck: (scope: KeepSafeScope, account?: string) =>
    req<KeepSafeCheck>(forAccount("/api/keepsafe/check", account), scope),
  keepSafePin: (scope: KeepSafeScope, classes: KeepSafeClass[],
                account?: string) =>
    req<{ pinned: number; items: [string, number][] }>(
      forAccount("/api/keepsafe/pin", account), { ...scope, classes }),
  pinGroup: (grouping: Grouping, key: string, pinned: boolean) =>
    req<{ ok: boolean; pinned: boolean; changed: number; skipped: number }>(
      "/api/pin_group", { grouping, key, pinned }),
  /** "Protect these N": pin the given mails (the kind of a sender's mail). */
  pinMails: (items: [string, number][], pinned: boolean) =>
    req<{ ok: boolean; pinned: boolean; changed: number; skipped: number }>(
      "/api/pin_mails", { items, pinned }),
  // `rerate` (with keys): also send groups that already have a verdict and
  // replace it - an explicit second opinion, billed again.
  aiReview: (grouping: Grouping, keys?: string[], rerate = false) =>
    req<{ ok: boolean }>("/api/ai",
      { grouping, keys: keys ?? null, rerate }),
  aiGroup: (grouping: Grouping, key: string, offset = 0, limit = 200,
      uids?: [string, number][]) =>
    req<AiGroupResult>("/api/ai_group",
      { grouping, key, offset, limit, uids: uids ?? null }),
  getConfig: () => req<Config>("/api/config"),
  /** Per account: what its last scan holds (the account switcher's cards). */
  accountsSummary: () => req<Record<string, AccountSummary>>(
    "/api/accounts/summary"),
  /** All accounts page: every mailbox's card and the senders that write to
   *  several of them. `since` = per account the epoch seconds its "+N new"
   *  counts from (the remembered visit). Read-only, no mail server, and it
   *  selects nothing. */
  accountsOverview: (since: Record<string, number> = {}) => req<AllAccountsResp>(
    Object.keys(since).length
      ? `/api/accounts/overview?since=${encodeURIComponent(JSON.stringify(since))}`
      : "/api/accounts/overview"),
  saveConfig: (body: unknown) => req<Config>("/api/config", body),
  /** AI assistants (MCP): this workspace's access tokens. */
  assistantTokens: () => req<AssistantTokenList>("/api/assistants/tokens"),
  /** The secret is in this answer and nowhere else. */
  createAssistantToken: (body: AssistantTokenRequest) =>
    req<{ token: AssistantToken; secret: string }>(
      "/api/assistants/tokens", body),
  setAssistantCap: (id: string, daily_cap: number) =>
    req<{ token: AssistantToken }>(
      `/api/assistants/tokens/${encodeURIComponent(id)}`, { daily_cap },
      "PATCH"),
  /** Hosted apps over OAuth: the request this browser's sign-in started
   *  (`/oauth/authorize` sets its cookie) and the user's decision on it. */
  assistantConnect: () =>
    req<ConnectRequest | ConnectRedirect>("/api/assistants/connect"),
  assistantConnectDecide: (body: ConnectDecision) =>
    req<ConnectRedirect>("/api/assistants/connect", body),
  revokeAssistantToken: (id: string) =>
    req<{ ok: boolean }>(`/api/assistants/tokens/${encodeURIComponent(id)}`,
      undefined, "DELETE"),
  /** `skipProtected`: refuse a protected sender (the All accounts page, a bulk
   *  path); `account`: run it in that account, not the selected one. */
  unsubscribe: (grouping: Grouping, key: string, skipProtected = false,
      account?: string) =>
    req<UnsubResult>(forAccount("/api/unsubscribe", account), skipProtected
      ? { grouping, key, skip_protected: true } : { grouping, key }),
  unsubscribeBulk: (grouping: Grouping, keys: string[]) =>
    req<UnsubBulkResult>("/api/unsubscribe_bulk", { grouping, keys }),
  unsubscribePreview: (grouping: Grouping, keys: string[], single = false) =>
    req<UnsubPreview>("/api/unsubscribe/preview", { grouping, keys, single }),
  unsubscribeResults: () =>
    req<{ run: number; items: UnsubRunItem[] }>("/api/unsubscribe/results"),
  unsubscribeAck: (addr: string, done = true, account?: string) =>
    req<{ status?: string; ok?: boolean }>(
      forAccount("/api/unsubscribe/ack", account), { addr, done }),
  /** `assistant`: the step is in the AI assistants' list. */
  undo: (index = -1, ident?: UndoIdent, account?: string,
      assistant = false) =>
    req<{ restored: number; of: number; rescan: boolean;
      ambiguous?: number }>(
      forAccount("/api/undo", account),
      { index, ...(ident ? { ident } : {}),
        ...(assistant ? { assistant: true } : {}) }),
  timeMachine: (account?: string) =>
    req<TmListing>(forAccount("/api/timemachine", account)),
  timeMachinePreview: (body: TmRequest, account?: string) =>
    req<TmPreview>(forAccount("/api/timemachine/preview", account), body),
  timeMachineRestore: (body: TmRequest, account?: string) =>
    req<{ started: boolean; steps: number; point_ts: number }>(
      forAccount("/api/timemachine/restore", account), body),
  emptyTrash: (counted: { uv: number; max_uid: number }) =>
    req<{ deleted: number }>("/api/empty_trash", counted),
  cancel: (target: "scan" | "ai" | "delete" | "atts" | "unsub" | "index") =>
    req<{ ok: boolean }>("/api/cancel", { target }),
  clearNotice: (keys?: string[]) =>
    req<{ ok: boolean }>("/api/notice/clear", keys ? { keys } : {}),
  /** `slot`: only the mails that arrive in one slot of the "When mail
   *  arrives" card (a view parameter beside `q`). */
  mails: (p: { offset: number; limit: number; sort: string; dir: string;
            q: string; slot?: ArrivalSlot | null; finding?: string }) => {
    const z = userZone();
    return req<MailsResp>(`/api/mails?offset=${p.offset}&limit=${p.limit}`
      + `&sort=${p.sort}&dir=${p.dir}&q=${encodeURIComponent(p.q)}`
      + (p.finding ? `&finding=${encodeURIComponent(p.finding)}` : "")
      + (p.slot ? `&slot=${p.slot.from}-${p.slot.to}`
        + `&slot_kind=${p.slot.kind}&slot_period=${p.slot.period}`
        + `&slot_days=${p.slot.days.join(",")}`
        + `&tz=${encodeURIComponent(z.tz)}&tzoff=${z.tzoff}` : ""));
  },
  search: (q: string, body = false) =>
    req<SearchResp>(`/api/search?q=${encodeURIComponent(q)}`
      + (body ? "&scope=body" : "")),
  folders: (account?: string) =>
    req<FoldersResp>(account
      ? `/api/folders?account=${encodeURIComponent(account)}`
      : "/api/folders"),
  setFolderRole: (role: string, folder: string, account?: string) =>
    req<{ role: string; folder: string | null; source: string | null }>(
      forAccount("/api/folders/role", account), { role, folder }),
  lookalike: (folder: string, account?: string) =>
    req<LookalikeCount>(forAccount(
      `/api/folders/lookalike?folder=${encodeURIComponent(folder)}`, account)),
  moveLookalike: (folder: string, uv: number, max_uid: number,
                  account?: string) =>
    req<{ moved: number; target?: string; role?: string;
          undo: UndoIdent | null }>(
      forAccount("/api/folders/move_contents", account),
      { folder, uv, max_uid }),
  exportUrl: (grouping: Grouping, keys?: string[]) =>
    withAccount(`/api/export?grouping=${grouping}`
      + (keys?.length
        ? keys.map((k) => `&keys=${encodeURIComponent(k)}`).join("")
        : "")),
  // `cap`: the effective per-run cap every rule run obeys
  rules: () => req<{ rules: Rule[]; cap: number }>("/api/rules"),
  createRule: (body: Partial<Rule>) => req<Rule>("/api/rules", body),
  updateRule: (id: string, body: Partial<Rule>) =>
    req<Rule>(`/api/rules/${id}`, body),
  deleteRule: async (id: string): Promise<void> => {
    const res = await fetch(`/api/rules/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
  },
  runRule: (id: string) => req<RuleRun>(`/api/rules/${id}/run`, {}),
  /** The Rule checkup (read-only) and Ignore / Show again for one finding. */
  ruleCheckup: () => req<RuleCheckup>("/api/rules/checkup"),
  ignoreFinding: (id: string, ignored = true) =>
    req<{ ok: boolean }>("/api/rules/checkup/ignore", { id, ignored }),
  createPreset: (name: string, query: string) =>
    req<FilterPreset>("/api/presets", { name, query }),
  updatePreset: (id: string, name: string, query: string) =>
    req<FilterPreset>(`/api/presets/${id}`, { name, query }),
  deletePreset: async (id: string): Promise<void> => {
    const res = await fetch(`/api/presets/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
  },
  block: (grouping: Grouping, key: string, label = "",
          trashExisting = false, account?: string) =>
    req<{ rule: Rule; trashed?: { queued: number; skipped: number };
          trash_error?: string }>(forAccount("/api/block", account),
      { grouping, key, label, trash_existing: trashExisting }),
  startAttachments: () => req<{ ok: boolean }>("/api/attachments", {}),
  attachments: () => req<AttMail[]>("/api/attachments"),
  attachmentsSummary: () => req<AttSummary>("/api/attachments/summary"),
  duplicates: () => req<DupSet[]>("/api/duplicates"),
  duplicatesSummary: () => req<DupSummary>("/api/duplicates/summary"),
  duplicateVersions: () => req<DupSet[]>("/api/duplicates/versions"),
  possibleDuplicates: () => req<DupSet[]>("/api/duplicates/possible"),
  /** "Keep all": hide one duplicate set (nothing is moved). */
  dismissDuplicates: (kind: DupKind, key: string) =>
    req<{ ok: boolean }>("/api/duplicates/dismiss", { kind, key }),
  /** Show one hidden set again, or (no arguments) every hidden set. */
  restoreDuplicates: (set?: { kind: DupKind; key: string }) =>
    req<{ ok: boolean }>("/api/duplicates/restore",
      set ? { ...set } : { all: true }),
  stats: () => req<StatsResp>("/api/stats"),
  /** When mail arrives: weekday x hour counts in the browser's time zone. */
  rhythm: (period: RhythmPeriod) => {
    const z = userZone();
    return req<RhythmResp>(`/api/rhythm?period=${period}`
      + `&tz=${encodeURIComponent(z.tz)}&tzoff=${z.tzoff}`);
  },
  /** `tz` = the browser's offset in minutes EAST of UTC. */
  wrapped: (year?: number) =>
    req<WrappedResp>(`/api/wrapped?tz=${-new Date().getTimezoneOffset()}`
      + (year === undefined ? "" : `&year=${year}`)),
  /** `since` = epoch seconds of the previous Overview visit. */
  overview: (since?: number | null) =>
    req<OverviewResp>("/api/overview"
      + (since == null ? "" : `?since=${Math.floor(since)}`)),
  /** Mail past its date: counts per reason (the Overview line and sheet), and
   *  the [folder, uid] pairs of the ticked reasons for the Trash step. */
  expired: () => req<ExpiredResp>("/api/expired"),
  expiredMails: (reasons: string[]) =>
    req<{ items: [string, number][] }>(
      `/api/expired/mails?reasons=${encodeURIComponent(reasons.join(","))}`),
  /** The Statistics card: senders that got louder / came back (30 days). */
  senderChanges: () => req<SenderChangesResp>("/api/sender-changes"),
  audit: (offset = 0, limit = 50, by: AuditBy = "all") =>
    req<AuditResp>(`/api/audit?offset=${offset}&limit=${limit}`
      + (by === "all" ? "" : `&by=${by}`)),
  auditExportUrl: () => withAccount("/api/audit/export"),
  trash: () => req<TrashResp>("/api/trash"),
  foldersPanel: (role: FolderRole) =>
    req<TrashResp>(`/api/folders_panel?role=${role}`),
  folderMove: (role: FolderRole, action: "not_junk" | "trash",
               uids: number[], uv: number, force = false) =>
    req<FolderMoveResp>("/api/folders_panel/move",
      { role, action, uids, uv, force }),
  // Permanent delete (Trash / Junk): count first (a fresh server listing),
  // then send back exactly the counted uv + UIDs.
  // `inFolderDays` (what a purge rule counts): only mails Inboxrake has seen
  // in the folder that long - it only ever narrows the selection.
  purgePreview: (role: FolderRole, select: PurgeSelect, inFolderDays?: number) =>
    req<PurgePreview>("/api/folders_panel/purge_preview", {
      role, ...select,
      ...(inFolderDays ? { in_folder_days: inFolderDays } : {}) }),
  // role / folder / trash_folder / uv / uids all come from the preview.
  purge: (role: FolderRole, uids: number[], uv: number, folder: string,
          trash_folder: string | null) =>
    req<PurgeResult>("/api/folders_panel/purge",
      { role, uids, uv, folder, trash_folder }),
  trashRestore: (uids: number[], dest: string, uv: number) =>
    req<{ restored: number; rescan: boolean }>("/api/trash/restore", { uids, dest, uv }),
  // `signal` lets the wizard walk away from a slow test (the server's own
  // attempt gives up by itself)
  testConnection: (account?: string, signal?: AbortSignal) =>
    req<{ ok: boolean; folders: number }>(
      forAccount("/api/test_connection", account), {}, undefined, signal),
  authProbe: () => req<AuthProbe>("/api/auth"),
  // cache: "no-store" - this specifically must never answer from a cached
  // response, or an update-available check can never detect anything.
  version: () => fetch(withAccount("/api/version"), { cache: "no-store" })
    .then((r) => r.json() as Promise<{ build: string }>),
  login: (password: string) =>
    req<{ ok: boolean }>("/api/login", { password }),
  logout: () => req<{ ok: boolean }>("/api/logout", {}),
  // Web Push (backend/webpush.py; push.ts)
  pushKey: () => req<{ key: string }>("/api/push/key"),
  pushSubscribe: (body: { endpoint: string;
    keys: { p256dh: string; auth: string }; lang: string }) =>
    req<{ ok: boolean }>("/api/push/subscribe", body),
  pushUnsubscribe: (endpoint: string) =>
    req<{ ok: boolean }>("/api/push/unsubscribe", { endpoint }),
  pushTest: (endpoint: string) =>
    req<{ ok: boolean }>("/api/push/test", { endpoint }),
  // keepalive: "hidden" must still leave a page that is being frozen
  pushPresence: (endpoint: string, visible: boolean) =>
    fetch("/api/push/presence", {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, visible }) }),
  signOutAll: () => req<{ ok: boolean }>("/api/auth/sign_out_all", {}),
  adminStats: () =>
    req<{ tenants: AdminTenantStats[] }>("/api/admin/stats"),
  oauthDeviceStart: (account: string) =>
    req<{ device_code: string; user_code: string; verification_uri: string;
      expires_in: number; interval: number }>(
      `/api/oauth/imap/device/start?account=${encodeURIComponent(account)}`,
      {}),
  oauthDevicePoll: (account: string, deviceCode: string) =>
    req<{ status: "pending" | "complete" | "error"; error?: string }>(
      `/api/oauth/imap/device/poll?account=${encodeURIComponent(account)}` +
      `&device_code=${encodeURIComponent(deviceCode)}`, {}),
  oauthDisconnect: (account: string) =>
    req<{ ok: boolean }>(
      `/api/oauth/imap/disconnect?account=${encodeURIComponent(account)}`, {}),
  // Copy to another account: explicit source / target, never the active one
  copyPlan: (source: string, target: string) =>
    req<CopyPlan>(`/api/account_copy/plan?source=${encodeURIComponent(source)}`
      + `&target=${encodeURIComponent(target)}`),
  /** The target's free space (null: no quota) and, for a folder name,
   *  whether it exists (the mails are added) or is reserved (refused). */
  copySpace: (target: string, folder = "") =>
    req<{ free: number | null; exists: boolean; reserved: boolean }>(
      `/api/account_copy/space?target=${encodeURIComponent(target)}`
      + (folder ? `&folder=${encodeURIComponent(folder)}` : "")),
  copyStatus: () => req<{ job: CopyJob | null }>("/api/account_copy/status"),
  copyStart: (source: string, target: string, kinds: CopyKindId[],
              folder: string) =>
    req<{ job: CopyJob }>("/api/account_copy/start",
      { source, target, kinds, folder }),
  copyPause: () => req<{ job: CopyJob }>("/api/account_copy/pause", {}),
  copyResume: () => req<{ job: CopyJob }>("/api/account_copy/resume", {}),
  copyCancel: () => req<{ job: CopyJob }>("/api/account_copy/cancel", {}),
  copyDismiss: () => req<{ job: null }>("/api/account_copy/dismiss", {}),
  copyTell: (source: string, target: string) =>
    req<CopyTell>(`/api/account_copy/tell?source=${encodeURIComponent(source)}`
      + `&target=${encodeURIComponent(target)}`),
  copySetTold: (source: string, target: string, addr: string, done: boolean) =>
    req<CopyTell>("/api/account_copy/tell", { source, target, addr, done }),
  trackers: () => req<TrackerReport>("/api/trackers"),
  subscriptions: () => req<SubscriptionsResp>("/api/subscriptions"),
  subscriptionReminders: () =>
    req<{ reminders: SubReminder[] }>("/api/subscriptions/reminders"),
  subscriptionHide: (key: string, hidden: boolean) =>
    req<{ ok: boolean }>("/api/subscriptions/hide", { key, hidden }),
  subscriptionRemind: (key: string, on: boolean) =>
    req<{ ok: boolean }>("/api/subscriptions/remind", { key, on }),
  subscriptionKeep: (key: string, pinned: boolean) =>
    req<{ ok: boolean; pinned: boolean; changed: number }>(
      "/api/subscriptions/keep", { key, pinned }),
  subscriptionSettingsGet: (account?: string) =>
    req<{ body_amounts: boolean }>(
      forAccount("/api/subscriptions/settings", account)),
  /** The opt-in to read the latest receipt's text for its amount; `account`
   *  = the one being edited (Settings), else the active one. */
  subscriptionSettings: (bodyAmounts: boolean, account?: string) =>
    req<{ ok: boolean; body_amounts: boolean }>(
      forAccount("/api/subscriptions/settings", account),
      { body_amounts: bodyAmounts }),
  subscriptionAmounts: () =>
    req<{ read: number; found: number }>("/api/subscriptions/amounts", {}),
  // Waiting for a reply (backend/waiting.py): local data, nothing is sent
  waiting: () => req<WaitingResp>("/api/waiting"),
  waitingItem: (id: string) =>
    req<WaitingDetail>(`/api/waiting/item?id=${encodeURIComponent(id)}`),
  waitingNeeded: (id: string, needed: boolean) =>
    req<{ ok: boolean }>("/api/waiting/needed", { id, needed }),
  /** Remind me about one mail at `at` (epoch s); null cancels. */
  waitingRemind: (id: string, at: number | null) =>
    req<{ ok: boolean; at: number | null }>("/api/waiting/remind", { id, at }),
  waitingReminders: () =>
    req<{ reminders: WaitingReminder[] }>("/api/waiting/reminders"),
  /** The mail you are waiting on from one address (the sender pane's line). */
  waitingSender: (addr: string) =>
    req<{ waiting: WaitingSender | null }>(
      `/api/waiting/sender?addr=${encodeURIComponent(addr)}`),
  /** This account's switch (`account` = the one being edited in Settings)
   *  and the per-user notification settings. */
  waitingSettingsGet: (account?: string) =>
    req<WaitingSettingsResp>(forAccount("/api/waiting/settings", account)),
  waitingSettings: (patch: Partial<WaitingSettingsResp>, account?: string) =>
    req<WaitingSettingsResp>(forAccount("/api/waiting/settings", account),
      patch),
  // Your addresses (backend/addresses.py) and the optional alias service
  addresses: () => req<AddressReport>("/api/addresses"),
  addressesSummary: () =>
    req<{ leaked: number; total: number; scanned: boolean }>(
      "/api/addresses/summary"),
  retireAddress: (address: string, newAlias: boolean, toJunk: boolean) =>
    req<AddressRetired>("/api/addresses/retire",
      { address, new_alias: newAlias, to_junk: toJunk }),
  restoreAddress: (address: string) =>
    req<{ ok: boolean }>("/api/addresses/restore", { address }),
  addressStrangersToJunk: (address: string) =>
    req<{ ok: boolean; queued: number; skipped_protected: number;
      skipped_pinned: number }>("/api/addresses/strangers_to_junk",
      { address }),
  /** "Not a leak": the strangers belong to the sender. `undo` (the marks
   *  `previous` returned) restores the earlier marks instead. */
  addressNotALeak: (address: string, undo?: string[]) =>
    req<{ ok: boolean; previous: string[] }>("/api/addresses/related",
      undo ? { address, undo } : { address }),
  aliasService: () => req<AliasServiceStatus>("/api/alias-service"),
  aliasServicePut: (service: string, apiKey?: string) =>
    req<AliasServiceStatus>("/api/alias-service",
      apiKey ? { service, api_key: apiKey } : { service }, "PUT"),
  aliasServiceRefresh: () =>
    req<AliasServiceStatus>("/api/alias-service/refresh", {}),
  aliasServiceDisconnect: async (): Promise<void> => {
    const res = await fetch("/api/alias-service", { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
  },
  indexInfo: (account: string) =>
    req<IndexInfo>(`/api/index?account=${encodeURIComponent(account)}`),
  indexBuild: (account: string, rebuild = false) =>
    req<{ ok: boolean }>(
      `/api/index/build?account=${encodeURIComponent(account)}`, { rebuild }),
  indexDelete: (account: string) =>
    req<{ ok: boolean }>(
      `/api/index/delete?account=${encodeURIComponent(account)}`, {}),
  indexCancel: (account: string) =>
    req<{ ok: boolean }>(
      `/api/cancel?account=${encodeURIComponent(account)}`,
      { target: "index" }),
  testDigest: (account: string) =>
    req<{ sent: boolean; demo: boolean }>(
      `/api/digest/test?account=${encodeURIComponent(account)}`, {}),
};

export { fmtSize, fmtUsd, mailKey } from "./lib";
