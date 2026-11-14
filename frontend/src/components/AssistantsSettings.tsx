import { Bot, Check, CircleCheck, Copy, Eye, EyeOff, Info, ListChecks,
  Plus, ExternalLink, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState,
  type ReactNode } from "react";
import { api } from "../api";
import { getLang, t } from "../i18n";
import { fmtAgo, fmtTs } from "../lib";
import { useDemo } from "../demoMode";
import type { AssistantAccess, AssistantLevel, AssistantToken,
  Config } from "../types";
import { Button, Checkbox, confirmDialog, DemoFieldset, EmptyState,
  Field, IconTile, Input, LINK_ACCENT, Loading, Modal, Notice, ProgressBar,
  RadioRow, Segmented, SettingsGroup, SettingsRow, Stepper, Switch, Tag,
  tabPanelProps, type TagTone, useToast } from "./ui";

/* Settings > AI assistants: the admin's cap, the address to connect, the
 * access tokens (create / revoke) and what each level allows. Which levels
 * exist comes from the server (`cfg.assistants.levels`), so Propose and Act
 * appear here on their own once the backend offers them. The staged cap lives
 * in SettingsPage (one Save bar for every server setting); the token list is
 * not staged - creating and revoking act at once. */

/** The setup guide on the website (page: docs/assistants.md). */
export const ASSISTANTS_DOCS_URL = "https://inboxrake.com/docs/assistants/";

const ALL_LEVELS: readonly AssistantLevel[] = ["read", "propose", "act"];
const ACCESS_RANK: Record<AssistantAccess, number> =
  { off: 0, read_propose: 1, act: 2 };
const NAME_MAX = 60;
const DAILY_DEFAULT = 2000;

/** Whether tokens of `level` may work under the admin's cap. */
export const capAllows = (access: AssistantAccess,
    level: AssistantLevel): boolean =>
  access === "act" || (access === "read_propose" && level !== "act");

/** The highest of the offered levels the cap lets a token have (null = off). */
const topLevel = (access: AssistantAccess,
    levels: AssistantLevel[]): AssistantLevel | null =>
  [...levels].reverse().find((l) => capAllows(access, l)) ?? null;

/** The cap's values the admin can pick, with their labels: only what the
 *  server offers. With Read alone the control is Off / On. */
export function accessChoices(levels: AssistantLevel[]):
    { value: AssistantAccess; label: string }[] {
  const more = levels.some((l) => l !== "read");
  return [
    { value: "off", label: t("assistants.access.off") },
    { value: "read_propose", label: t(more ? "assistants.access.propose"
      : "assistants.access.on") },
    ...(levels.includes("act")
      ? [{ value: "act" as const, label: t("assistants.access.act") }] : []),
  ];
}

/** The stored cap as the control shows it: a hand-edited "act" without an Act
 *  level on offer reads as the highest value that exists. */
const shownAccess = (access: AssistantAccess,
    levels: AssistantLevel[]): AssistantAccess =>
  access === "act" && !levels.includes("act") ? "read_propose" : access;

/** How many lines "What each level allows" lists per level. */
const LEVEL_BULLETS: Record<AssistantLevel, number> =
  { read: 3, propose: 3, act: 4 };
const LEVEL_ICON: Record<AssistantLevel, ReactNode> = {
  read: <Eye size={14} aria-hidden />,
  propose: <ListChecks size={14} aria-hidden />,
  act: <WandSparkles size={14} aria-hidden />,
};
const LEVEL_TONE: Record<AssistantLevel, TagTone> =
  { read: "neutral", propose: "info", act: "review" };

function LevelPill({ level }: { level: AssistantLevel }) {
  return (
    <Tag tone={LEVEL_TONE[level]} className="inline-flex items-center gap-1">
      {LEVEL_ICON[level]}{t(`assistants.level.${level}`)}
    </Tag>
  );
}

/** The workspace's tokens, fetched once (not in the demo, and not from a
 *  server that predates assistants); `load` refreshes after a change. */
export function useAssistantTokens(enabled: boolean) {
  const [tokens, setTokens] = useState<AssistantToken[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() =>
    Promise.resolve().then(() => api.assistantTokens())
      .then((r) => { setTokens(r.tokens); setError(""); })
      .catch((e) => setError(String(e?.message ?? e))), []);
  useEffect(() => { if (enabled) void load(); }, [enabled, load]);
  return { tokens, error, load };
}

const isExpired = (tk: AssistantToken): boolean =>
  !!tk.expires && tk.expires * 1000 <= Date.now();

/** The text an assistant client is set up with, for the real address and the
 *  full token. */
export type SetupKind = "claude-code" | "cursor" | "vscode" | "desktop"
  | "other";
const SETUP_KINDS: SetupKind[] = ["claude-code", "cursor", "vscode",
  "desktop", "other"];

export function setupSnippet(kind: SetupKind, url: string,
    token: string): string {
  switch (kind) {
    case "claude-code":
      return `claude mcp add --transport http inboxrake \\\n  ${url} \\\n`
        + `  --header "Authorization: Bearer ${token}"`;
    case "cursor":
      return `{\n  "mcpServers": {\n    "inboxrake": {\n`
        + `      "url": "${url}",\n`
        + `      "headers": { "Authorization": "Bearer ${token}" }\n`
        + `    }\n  }\n}`;
    case "vscode":
      return `{\n  "servers": {\n    "inboxrake": {\n`
        + `      "type": "http",\n      "url": "${url}",\n`
        + `      "headers": { "Authorization": "Bearer ${token}" }\n`
        + `    }\n  }\n}`;
    case "desktop":
      return `{\n  "mcpServers": {\n    "inboxrake": {\n`
        + `      "command": "npx",\n`
        + `      "args": ["mcp-remote", "${url}",\n`
        + `               "--header", "Authorization:\${AUTH}"],\n`
        + `      "env": { "AUTH": "Bearer ${token}" }\n    }\n  }\n}`;
    default:
      return `${t("assistants.address")}: ${url}\n`
        + `${t("assistants.other_header")}: Authorization: Bearer ${token}`;
  }
}

/** Copy text; the clipboard API needs a secure origin, which a self-hosted
 *  install on plain http often is not, so fall back to a hidden field. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.className = "fixed -left-96 top-0";
    document.body.append(el);
    el.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* not allowed */ }
    el.remove();
    return ok;
  }
}

/** Copy button: a labelled one or an icon-only one; shows a check for a
 *  moment. `onCopied` lets a dialog know the user copied something. */
function CopyButton({ text, name, labelled = false, onCopied }: {
  text: string; name: string; labelled?: boolean; onCopied?: () => void;
}) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const click = async () => {
    if (!await copyText(text)) {
      toast.show(t("assistants.copy_failed"), { variant: "error" });
      return;
    }
    onCopied?.();
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 2000);
  };
  const icon = done ? <Check size={16} aria-hidden />
    : <Copy size={16} aria-hidden />;
  return labelled ? (
    <Button type="button" variant="secondary" onClick={() => void click()}
      className="inline-flex shrink-0 items-center gap-1.5">
      {icon}{done ? t("assistants.copied") : t("Copy")}
    </Button>
  ) : (
    <Button type="button" variant="quiet" size="icon" label={name}
      onClick={() => void click()}>{icon}</Button>
  );
}

/* ------------------------------ new token ------------------------------ */

type Expiry = "30" | "90" | "never";

function NewTokenDialog({ accounts, levels, access, onClose, onCreated }: {
  accounts: string[]; levels: AssistantLevel[]; access: AssistantAccess;
  onClose: () => void;
  onCreated: (token: AssistantToken, secret: string) => void;
}) {
  const titleId = useId();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(accounts));
  const [level, setLevel] = useState<AssistantLevel>(levels[0] ?? "read");
  const [subjects, setSubjects] = useState(false);
  const [expiry, setExpiry] = useState<Expiry>("90");
  const [daily, setDaily] = useState(DAILY_DEFAULT);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameError = !name.trim() ? t("assistants.name_required") : null;
  const acctError = picked.size === 0 ? t("assistants.accounts_required")
    : null;
  const single = levels.length <= 1;

  const submit = async () => {
    setTouched(true);
    if (nameError || acctError || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.createAssistantToken({
        name: name.trim(),
        accounts: accounts.filter((a) => picked.has(a)),
        level, subjects,
        expires_days: expiry === "never" ? null : expiry === "30" ? 30 : 90,
        ...(level === "act" ? { daily_cap: daily } : {}),
      });
      onCreated(r.token, r.secret);
    } catch (e: any) {
      // coded refusals (assistants off, level not offered, 20 tokens, an
      // unknown account) arrive already worded by the api layer
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  };

  return (
    <Modal size="sm" labelledBy={titleId} onClose={onClose}>
      <form className="flex min-h-0 flex-1 flex-col" noValidate
        onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <div id={titleId} className="type-heading">
            {t("assistants.new_title")}
          </div>
          <div>
            <Field label={t("assistants.name")}>
              <Input className="w-full" value={name} maxLength={NAME_MAX}
                autoFocus aria-invalid={touched && !!nameError}
                placeholder={t("assistants.name_ph")}
                onChange={(e) => { setName(e.target.value); }} />
            </Field>
            {touched && nameError
              ? <p role="alert" className="mt-1 type-meta text-danger-fg">
                {nameError}</p>
              : <p className="mt-1 type-meta text-muted">
                {t("assistants.name_help")}</p>}
          </div>
          <fieldset className="min-w-0">
            <legend className="mb-1 type-meta text-muted">
              {t("assistants.accounts")}
            </legend>
            <div className="flex flex-wrap gap-x-4">
              {accounts.map((a) => (
                <Checkbox key={a} label={a} checked={picked.has(a)}
                  onChange={(e) => setPicked((p) => {
                    const n = new Set(p);
                    if (e.target.checked) n.add(a); else n.delete(a);
                    return n;
                  })} />
              ))}
            </div>
            {touched && acctError && (
              <p role="alert" className="mt-1 type-meta text-danger-fg">
                {acctError}</p>
            )}
          </fieldset>
          <div>
            <div className="mb-1 type-meta text-muted">
              {t("assistants.may_do")}
            </div>
            {single ? (
              <p className="type-body">
                <span className="font-medium">
                  {t(`assistants.level.${levels[0] ?? "read"}`)}
                </span>
                {" - "}{t(`assistants.level_sub.${levels[0] ?? "read"}`)}
              </p>
            ) : (
              <div role="radiogroup" aria-label={t("assistants.may_do")}
                className="divide-y divide-line overflow-hidden rounded-card
                  border border-line bg-panel">
                {levels.map((l) => {
                  const allowed = capAllows(access, l);
                  return (
                    <RadioRow key={l} checked={level === l}
                      disabled={!allowed}
                      label={t(`assistants.level_row.${l}`)}
                      sub={allowed ? t(`assistants.level_sub.${l}`)
                        : t("assistants.above_cap", { level: t(
                          `assistants.upto.${topLevel(access, levels)
                            ?? "read"}`) })}
                      onSelect={() => setLevel(l)} />
                  );
                })}
              </div>
            )}
            {level === "act" && (<>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="type-body">{t("assistants.daily")}</span>
                <Stepper value={daily} onChange={setDaily} min={100}
                  max={10000} step={100} label={t("assistants.daily")}
                  format={(n) => t("assistants.daily_fmt", { n })} />
              </div>
              <Notice tone="warn" className="mt-3"
                icon={<Info size={16} aria-hidden />}>
                {t("assistants.act_warn")}
              </Notice>
            </>)}
          </div>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="type-body">{t("assistants.subjects")}</div>
              <p className="type-meta text-muted">
                {t("assistants.subjects_help")}
              </p>
            </div>
            <Switch checked={subjects} onChange={setSubjects}
              label={t("assistants.subjects")} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="type-body">{t("assistants.expires")}</span>
            <Segmented<Expiry> role="radio" label={t("assistants.expires")}
              value={expiry} onChange={setExpiry} options={[
                { value: "30", label: t("assistants.exp.30") },
                { value: "90", label: t("assistants.exp.90") },
                { value: "never", label: t("assistants.exp.never") }]} />
          </div>
          <p className="type-meta text-muted">{t("assistants.provider_note")}</p>
          {error && (
            <p role="alert" className="type-meta text-danger-fg">{error}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3
          sm:px-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {t("assistants.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ----------------------------- token created ----------------------------- */

function CreatedDialog({ token, secret, url, onClose }: {
  token: AssistantToken; secret: string; url: string; onClose: () => void;
}) {
  const titleId = useId();
  const [kind, setKind] = useState<SetupKind>("claude-code");
  const copied = useRef(false);
  const mark = () => { copied.current = true; };
  const snippet = setupSnippet(kind, url, secret);
  // The secret is shown once: leaving before anything was copied asks first.
  const close = async () => {
    if (!copied.current && !await confirmDialog({
      title: t("assistants.copied_q"), body: t("assistants.copied_q_body"),
      confirmLabel: t("assistants.copied_yes"),
      cancelLabel: t("assistants.copied_no"),
    })) return;
    onClose();
  };
  const names: Record<SetupKind, string> = {
    "claude-code": "Claude Code", cursor: "Cursor", vscode: "VS Code",
    desktop: "Claude Desktop", other: t("assistants.setup.other") };
  return (
    <Modal size="sm" labelledBy={titleId} onClose={() => void close()}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <IconTile tone="safe"><CircleCheck size={16} /></IconTile>
          <div id={titleId} className="type-heading min-w-0 flex-1 break-words">
            {t("assistants.created_title", { name: token.name })}
          </div>
        </div>
        <div>
          <label htmlFor={`${titleId}-secret`}
            className="mb-1 block type-meta text-muted">
            {t("assistants.your_token")}
          </label>
          <div className="flex gap-2">
            <Input id={`${titleId}-secret`} readOnly value={secret}
              className="min-w-0 flex-1 font-mono type-meta"
              onFocus={(e) => e.currentTarget.select()} />
            <CopyButton labelled text={secret} name={t("Copy")}
              onCopied={mark} />
          </div>
          <Notice tone="warn" className="mt-2"
            icon={<EyeOff size={16} aria-hidden />}>
            {t("assistants.once")}
          </Notice>
        </div>
        <div className="space-y-2">
          <div className="type-meta text-muted">
            {t("assistants.setup_title")}
          </div>
          {/* five clients do not fit one row of a dialog: wrap, never hide */}
          <Segmented<SetupKind> label={t("assistants.setup_title")}
            idPrefix="assistant-setup" value={kind} onChange={setKind}
            className="flex-wrap"
            options={SETUP_KINDS.map((k) => ({ value: k,
              label: names[k] }))} />
          <div {...tabPanelProps("assistant-setup", kind)}
            className="relative rounded-control bg-panel2">
            <pre className="whitespace-pre-wrap break-all p-3 pr-12 font-mono
              type-meta text-body">{snippet}</pre>
            <span className="absolute right-1 top-1">
              <CopyButton text={snippet} onCopied={mark}
                name={t("assistants.copy_setup", { name: names[kind] })} />
            </span>
          </div>
          <p className="type-meta text-muted">
            {t("assistants.try_asking")} ·{" "}
            <a href={ASSISTANTS_DOCS_URL} target="_blank"
              rel="noopener noreferrer" className={LINK_ACCENT}>
              {t("assistants.guide")}</a>
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t
        border-line px-4 py-3 sm:px-5">
        <span className="min-w-0 type-meta text-muted">
          {tokenSummary(token)}
        </span>
        <Button type="button" onClick={() => void close()}>
          {t("assistants.done")}
        </Button>
      </div>
    </Modal>
  );
}

const expiryText = (tk: AssistantToken): string =>
  !tk.expires ? t("assistants.never_expires")
    : t(isExpired(tk) ? "assistants.expired" : "assistants.expires_on",
      { date: fmtTs(tk.expires, getLang(), false) });

const tokenSummary = (tk: AssistantToken): string =>
  [t(`assistants.level.${tk.level}`), tk.accounts.join(", "),
    expiryText(tk)].join(" · ");

/* ------------------------------ token rows ------------------------------ */

function TokenRow({ tk, busy, onRevoke }: {
  tk: AssistantToken; busy: boolean; onRevoke: () => void;
}) {
  const expired = isExpired(tk);
  const ago = fmtAgo(tk.last_used);
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className={expired ? "opacity-60" : ""}>
        <IconTile tone="info"><Bot size={16} /></IconTile>
      </span>
      <div className={`min-w-0 flex-1 space-y-0.5 ${expired
        ? "text-muted" : ""}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words type-body font-medium">
            {tk.name}
          </span>
          <LevelPill level={tk.level} />
        </div>
        <div className="type-meta text-muted">
          {[`${tk.prefix}…`, tk.accounts.join(", "),
            t(tk.subjects ? "assistants.subjects_on"
              : "assistants.subjects_off"),
            expiryText(tk)].join(" · ")}
        </div>
        <div className="type-meta text-muted">
          {[ago ? t("assistants.used", { ago })
            : t("assistants.never_used"),
          t("assistants.calls", { n: tk.calls_today })].join(" · ")}
        </div>
        {tk.level === "act" && !expired && (
          <div className="flex items-center gap-2 pt-1 type-meta text-muted">
            <ProgressBar className="max-w-40 flex-1" value={tk.mails_today}
              max={tk.daily_cap} label={t("assistants.daily")} thin />
            <span>{t("assistants.moved", { n: tk.mails_today,
              cap: tk.daily_cap })}</span>
          </div>
        )}
      </div>
      <Button size="sm" disabled={busy}
        aria-label={t(expired ? "assistants.remove_named"
          : "assistants.revoke_named", { name: tk.name })}
        variant={expired ? "secondary" : "danger-quiet"} onClick={onRevoke}>
        {t(expired ? "assistants.remove" : "assistants.revoke")}
      </Button>
    </li>
  );
}

/* -------------------------------- section -------------------------------- */

export function AssistantsSection({ cfg, admin, access, onAccess, tokens,
  tokensError, reload }: {
  cfg: Config; admin: boolean;
  /** The cap as staged (the admin's control); the saved one is in `cfg`. */
  access: AssistantAccess;
  onAccess: (a: AssistantAccess) => void;
  tokens: AssistantToken[] | null; tokensError: string;
  reload: () => Promise<unknown>;
}) {
  const demo = useDemo();
  const toast = useToast();
  const offered: AssistantLevel[] = cfg.assistants?.levels?.length
    ? cfg.assistants.levels : ["read"];
  const levels = offered.filter((l) => ALL_LEVELS.includes(l));
  const saved = cfg.assistants?.access ?? "off";
  const shown = shownAccess(access, levels);
  // The demo shows the section as it would be (its token API refuses).
  const on = demo || saved !== "off";
  const url = `${window.location.origin}/mcp`;
  const accounts = Object.keys(cfg.accounts);
  const [dialog, setDialog] = useState<{ token: AssistantToken;
    secret: string } | "new" | null>(null);
  const [busyId, setBusyId] = useState("");
  const list = tokens ?? [];
  // After a dialog closes the "New access token…" control takes focus (the
  // empty state's button is gone once the list reloads, so look it up then).
  const refocus = useRef(false);
  const closeDialog = () => { refocus.current = true; setDialog(null); };
  useEffect(() => {
    if (!refocus.current || dialog) return;
    const el = document.querySelector<HTMLElement>("[data-new-token]");
    if (el) { el.focus(); refocus.current = false; }
  }, [dialog, tokens]);
  const live = list.filter((tk) => !isExpired(tk));

  const change = async (next: AssistantAccess) => {
    if (next === shown) return;
    // lowering is measured against what the server has now: raising and
    // lowering again before Save changes nothing, so it asks nothing
    if (ACCESS_RANK[next] < ACCESS_RANK[shownAccess(saved, levels)]) {
      // the cap is server-wide: count the tokens of every user, as of now
      const fresh = await api.getConfig().catch(() => null);
      const counts = fresh?.assistants?.token_counts
        ?? cfg.assistants?.token_counts;
      const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0)
        : live.length;
      const acting = counts ? counts.act ?? 0
        : live.filter((tk) => tk.level === "act").length;
      const off = next === "off";
      const bullets = off
        ? (total ? [t("assistants.lower.off_tokens", { n: total }),
          t("assistants.lower.off_back")] : [])
        : (acting ? [t("assistants.lower.act_tokens", { n: acting })] : []);
      if (!await confirmDialog({
        title: off ? t("assistants.lower.off_title")
          : t("assistants.lower.title", { level: t(
            `assistants.upto.${topLevel(next, levels) ?? "read"}`) }),
        body: bullets.length ? undefined : t(off
          ? "assistants.lower.off_body" : "assistants.lower.body"),
        bullets: bullets.length ? bullets : undefined,
        confirmLabel: t(off ? "assistants.lower.off_confirm"
          : "assistants.lower.confirm"),
      })) return;
    }
    onAccess(next);
  };

  const revoke = async (tk: AssistantToken) => {
    if (!isExpired(tk) && !await confirmDialog({
      title: t("assistants.revoke_title", { name: tk.name }),
      body: t("assistants.revoke_body"),
      confirmLabel: t("assistants.revoke"), tone: "danger",
    })) return;
    setBusyId(tk.id);
    try {
      await api.revokeAssistantToken(tk.id);
      toast.show(t(isExpired(tk) ? "assistants.removed"
        : "assistants.revoked", { name: tk.name }), { variant: "success" });
    } catch (e: any) {
      toast.show(t("err.generic", { msg: e?.message ?? e }),
        { variant: "error" });
    }
    setBusyId("");
    await reload();
  };

  const revokeAll = async () => {
    if (!await confirmDialog({
      title: t("assistants.revoke_all_title", { n: list.length }),
      body: t("assistants.revoke_all_body"),
      confirmLabel: t("assistants.revoke_all_confirm", { n: list.length }),
      tone: "danger",
    })) return;
    const res = await Promise.allSettled(
      list.map((tk) => api.revokeAssistantToken(tk.id)));
    const failed = res.filter((r) => r.status === "rejected").length;
    if (failed) toast.show(t("assistants.revoke_all_failed", { n: failed }),
      { variant: "error" });
    else toast.show(t("assistants.revoked_all"), { variant: "success" });
    await reload();
  };

  const control = admin && (
    <DemoFieldset>
      <SettingsGroup header={t("assistants.group.server")}>
        <SettingsRow label={t("assistants.access")}
          sub={t("assistants.access_sub")}>
          <Segmented<AssistantAccess> role="radio"
            label={t("assistants.access")} value={shown}
            onChange={(v) => void change(v)} options={accessChoices(levels)} />
        </SettingsRow>
      </SettingsGroup>
    </DemoFieldset>
  );

  const intro = <p className="mb-5 type-body text-muted">
    {t("assistants.intro")}</p>;

  if (!on) {
    // switched off on this server: the admin sees the control and why
    // nothing else is there; everyone else just that it is off
    return admin ? (<>
      {intro}{control}
      <p className="-mt-3 px-3 type-meta text-muted">
        {t(shown === "off" ? "assistants.off_admin"
          : "assistants.save_first")}
      </p>
    </>) : (
      <EmptyState icon={<Bot size={18} aria-hidden />}
        title={t("assistants.off_title")} hint={t("assistants.off_hint")} />
    );
  }

  const cap = topLevel(saved, levels);
  const newButton = (
    <Button onClick={() => setDialog("new")} data-new-token
      className="inline-flex items-center gap-1.5">
      <Plus size={16} aria-hidden />{t("assistants.new")}
    </Button>
  );
  const cols = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2",
    3: "sm:grid-cols-3" }[Math.min(3, Math.max(1, levels.length))];

  return (<>
    {intro}
    {demo && (
      <Notice className="mb-3" icon={<Info size={16} aria-hidden />}>
        {t("assistants.demo")}
      </Notice>
    )}
    {control}
    {!admin && !demo && cap && (
      <Notice className="mb-4" icon={<Info size={16} aria-hidden />}>
        {t("assistants.admin_allows", { level: t(`assistants.upto.${cap}`) })}
      </Notice>
    )}
    <DemoFieldset>
      <SettingsGroup header={t("assistants.group.connect")}>
        <SettingsRow label={t("assistants.address")}
          sub={<span className="break-all font-mono">{url}</span>}>
          <CopyButton text={url} name={t("assistants.copy_address")} />
        </SettingsRow>
        <SettingsRow label={t("assistants.setup_title")}
          sub={t("assistants.setup_sub")}>
          <a href={ASSISTANTS_DOCS_URL} target="_blank"
            rel="noopener noreferrer" className={`inline-flex min-h-9
              items-center gap-1 coarse:min-h-11 ${LINK_ACCENT}`}>
            {t("assistants.guide")}<ExternalLink size={14} aria-hidden />
          </a>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup header={t("assistants.group.tokens")}
        footnote={list.length ? (<>
          {t("assistants.tokens_note")}{" "}
          <button type="button" className={LINK_ACCENT}
            onClick={() => void revokeAll()}>
            {t("assistants.revoke_all")}</button>
        </>) : undefined}>
        {tokens === null && !tokensError && !demo && (
          <Loading className="!p-3" />
        )}
        {tokensError && (
          <p role="alert" className="px-4 py-3 type-meta text-danger-fg">
            {tokensError}</p>
        )}
        {(tokens !== null || demo) && !list.length && (
          <EmptyState icon={<Bot size={18} aria-hidden />}
            title={t("assistants.none_title")} hint={t("assistants.none_hint")}
            action={newButton} />
        )}
        {list.length > 0 && (<>
          <ul className="divide-y divide-line">
            {list.map((tk) => (
              <TokenRow key={tk.id} tk={tk} busy={busyId === tk.id}
                onRevoke={() => void revoke(tk)} />
            ))}
          </ul>
          <button type="button" onClick={() => setDialog("new")}
            data-new-token className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5
              text-left text-accent transition-colors hover:bg-panel2">
            <IconTile tone="accent"><Plus size={16} /></IconTile>
            <span className="type-body">{t("assistants.new")}</span>
          </button>
        </>)}
      </SettingsGroup>
    </DemoFieldset>

    <SettingsGroup header={t("assistants.group.levels")}>
      <div className={`grid grid-cols-1 divide-y divide-line sm:divide-x
        sm:divide-y-0 ${cols}`}>
        {levels.map((l) => (
          <div key={l} className="space-y-1.5 p-4">
            <div className="flex items-center gap-1.5 type-body font-medium">
              {LEVEL_ICON[l]}{t(`assistants.level.${l}`)}
            </div>
            <ul className="list-disc space-y-1 pl-5 type-meta text-muted">
              {Array.from({ length: LEVEL_BULLETS[l] }, (_, i) => (
                <li key={i}>{t(`assistants.lv.${l}.${i + 1}`)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="p-4 type-meta text-muted">
        <span className="font-medium text-body">
          {t("assistants.never_lead")}</span>{" "}{t("assistants.never")}
      </p>
    </SettingsGroup>

    {dialog === "new" && (
      <NewTokenDialog accounts={accounts} levels={levels} access={saved}
        onClose={closeDialog}
        onCreated={(token, secret) => {
          setDialog({ token, secret });
          void reload();
        }} />
    )}
    {dialog && dialog !== "new" && (
      <CreatedDialog token={dialog.token} secret={dialog.secret} url={url}
        onClose={closeDialog} />
    )}
  </>);
}
