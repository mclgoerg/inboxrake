import { Archive, Bell, Check, Folder, KeyRound, Mail, Plus,
  RefreshCw, Search, Settings as SettingsIcon, Shield, Sparkles, Star,
  Tag as TagIcon, TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState,
  type MutableRefObject, type ReactNode } from "react";
import { api, downloadFile, fmtUsd } from "../api";
import { useEdgeBack } from "../gestures";
import { fmtNum, getNumFormat, isBadDecimal, setNumFormat, type NumFormat } from "../numfmt";
import { getLang, setLang, t, type Lang } from "../i18n";
import { accountAuth, fmtAgo, fmtSize } from "../lib";
import { gotoSettings, SETTINGS_SECTIONS, useSidebar,
  type SettingsSection } from "../nav";
import { PRESET_LABELS, PRESETS, presetLabel } from "../presets";
import type { AdminTenantStats, AppState, AuthMethod, AuthMode, AutoScanUnit, BodySearchMode, Config,
  DigestSchedule, FoldersResp, ImapAccount, OauthProvider, Preset, Security,
  SmtpSecurity } from "../types";
import { FolderSettings } from "./FolderSettings";
import { IndexNote, IndexPanel } from "./IndexPanel";
import { KnowledgeSettings } from "./KnowledgeSettings";
import { BUILTIN_CATEGORIES, CategoryList,
  parseCategories as parseCategoryText, ProtectedList }
  from "./SettingsLists";
import { demoHint, useDemo } from "../demoMode";
import { AccountAvatar, AppearanceControl, Button, cap, choiceDialog,
  confirmDialog, DemoFieldset, DemoHint, Field, IconTile, Input, isModalOpen,
  DecimalInput, LINK_ACCENT, Loading, Notice, PageHeader, PopupSelect, promptDialog, RadioRow, Ring,
  Segmented, Select, SettingsGroup, SettingsRow, Spinner, Stepper, Switch, Tag,
  type TagTone, TextArea, useBulkBarHeight, useToast } from "./ui";

/* Settings as a page (`#/settings/<section>`). From 1024 px a section column
 * (with a search field) sits beside the form; below it an iOS-style root list
 * drills down into one section. Edits are STAGED exactly like the old dialog:
 * all of them live in this component, one Save persists every section, and a
 * floating save bar (Revert / Save) shows only while something differs from
 * what is saved. Appearance and language apply at once (browser-side). */

const imapOf = (c: Config, name: string): ImapAccount =>
  c.accounts[name] ?? c.accounts[c.default_account];

const imapFields = (c: Config, name: string) => {
  const im = imapOf(c, name);
  return {
    preset: (im.preset ?? "proton") as Preset,
    host: im.host,
    port: String(im.port),
    security: (im.security ?? "ssl") as Security,
    smtpHost: im.smtp_host ?? "",
    smtpPort: String(im.smtp_port ?? 1025),
    smtpSecurity: (im.smtp_security ?? "auto") as SmtpSecurity,
    cafile: im.cafile ?? "",
    user: im.user,
    password: "",
    auth: accountAuth(im),
    oauthProvider: (im.oauth?.provider ?? "") as "" | OauthProvider,
    oauthClientId: im.oauth?.client_id ?? "",
    oauthClientSecret: "",
    oauthClientSecretSet: im.oauth?.client_secret_set ?? false,
    oauthConnected: im.oauth?.connected ?? false,
    digestSchedule: (im.digest?.schedule ?? "off") as DigestSchedule,
    digestRecipient: im.digest?.recipient ?? "",
    digestUrl: im.digest?.url ?? "",
    // the language the user reads the app in, until they chose one
    digestLang: (im.digest?.lang || getLang()) as "en" | "de",
    digestTime: `${String(im.digest?.hour ?? 8).padStart(2, "0")}:`
      + `${String(im.digest?.minute ?? 0).padStart(2, "0")}`,
    autoScanEnabled: im.auto_scan?.enabled ?? false,
    autoScanUnit: (im.auto_scan?.unit ?? "hours") as AutoScanUnit,
    autoScanValue: String(im.auto_scan?.value ?? 6),
    autoScanAlign: String(im.auto_scan?.align_minute ?? 0),
    bodySearch: (im.body_search ?? "server") as BodySearchMode,
    smartMin: String(im.smart_min ?? 10),
  };
};

const initialForm = (c: Config, name: string) => ({
  ...imapFields(c, name),
  provider: c.ai.provider,
  endpoint: c.ai.foundry_endpoint,
  model: c.ai.model,
  apiKey: "",
  priceIn: c.ai.price_in ? String(c.ai.price_in) : "",
  priceOut: c.ai.price_out ? String(c.ai.price_out) : "",
  budget: c.ai.budget_usd ? String(c.ai.budget_usd) : "",
  sortInstructions: c.ai.sort_instructions ?? "",
  authMode: c.auth.mode as AuthMode,
  authPassword: "",
  // Server-level fields: only the admin receives them (cfg.auth.oidc /
  // cfg.shared_ai are absent for other users, whose UI hides the
  // sections anyway).
  oidcIssuer: c.auth.oidc?.issuer ?? "",
  oidcClientId: c.auth.oidc?.client_id ?? "",
  oidcSecret: "",
  oidcRedirect: c.auth.oidc?.redirect_base ?? "",
  oidcAllowed: (c.auth.oidc?.allowed ?? []).join("\n"),
  oidcAdmin: c.auth.admin ?? "",
  sharedEnabled: c.shared_ai?.enabled ?? false,
  sharedProvider: c.shared_ai?.provider ?? "anthropic",
  sharedModel: c.shared_ai?.model ?? "claude-sonnet-5",
  sharedEndpoint: c.shared_ai?.foundry_endpoint ?? "",
  sharedKey: "",
  sharedBudget: c.shared_ai?.default_tenant_budget_usd
    ? String(c.shared_ai.default_tenant_budget_usd) : "",
  newSenderWindowDays: String(c.new_sender_window_days ?? 7),
});
type Form = ReturnType<typeof initialForm>;

const catText = (cats: Record<string, string[]>) =>
  Object.entries(cats ?? {})
    .map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n");

/** Everything the page stages: the form, the two list texts and the folder
 *  picker. The baseline is the last saved copy; any difference is a change. */
type Staged = {
  f: Form; protectedText: string; categoriesText: string;
  included: string[]; wildcards: string[];
};

/** Which form fields belong to which part of the "what changed" summary. */
const CHANGE_GROUPS: { label: string; fields: (keyof Form)[] }[] = [
  { label: "settings.chg.connection", fields: ["preset", "host", "port",
    "security", "user", "smtpHost", "smtpPort", "smtpSecurity", "cafile",
    "auth", "oauthClientId", "oauthClientSecret"] },
  { label: "settings.sec.digest", fields: ["digestSchedule", "digestRecipient",
    "digestTime", "digestUrl", "digestLang"] },
  { label: "settings.sec.autoscan", fields: ["autoScanEnabled",
    "autoScanUnit", "autoScanValue", "autoScanAlign"] },
  { label: "settings.sec.general", fields: ["bodySearch", "smartMin",
    "newSenderWindowDays"] },
  { label: "settings.sec.ai", fields: ["provider", "endpoint", "model",
    "apiKey", "priceIn", "priceOut", "budget", "sortInstructions"] },
  { label: "settings.sec.signin", fields: ["authMode", "authPassword",
    "oidcIssuer", "oidcClientId", "oidcSecret", "oidcRedirect", "oidcAllowed",
    "oidcAdmin", "sharedEnabled", "sharedProvider", "sharedModel",
    "sharedEndpoint", "sharedKey", "sharedBudget"] },
];

/** The save bar's text: one change is named ("Password changed", "AI review
 *  changed"), several are counted. */
function changeSummary(a: Staged, b: Staged): { text: string; n: number } {
  const labels: string[] = [];
  if (a.f.password !== b.f.password) labels.push("settings.chg.password");
  for (const g of CHANGE_GROUPS)
    if (g.fields.some((k) => a.f[k] !== b.f[k])) labels.push(g.label);
  if (JSON.stringify([a.included, a.wildcards])
    !== JSON.stringify([b.included, b.wildcards]))
    labels.push("settings.chg.folders");
  if (a.protectedText !== b.protectedText) labels.push("settings.sec.protected");
  if (a.categoriesText !== b.categoriesText)
    labels.push("settings.sec.categories");
  const n = labels.length;
  return { n, text: n === 1
    ? (labels[0] === "settings.chg.password" ? t(labels[0])
      : t("settings.changed", { what: t(labels[0]) }))
    : t("settings.changes", { n }) };
}

const sameStaged = (a: Staged, b: Staged) =>
  JSON.stringify(a) === JSON.stringify(b);

/** What the page offers the app shell. */
export type SettingsControl = {
  /** Staged edits that are not saved. */
  dirty: () => boolean;
  /** Leaving with edits asks Save / Discard / Cancel; true = may leave. */
  confirmLeave: () => Promise<boolean>;
};

type Status = "ok" | "check" | "nocreds";
export const statusOf = (im: ImapAccount): Status =>
  !im.password_set && !im.oauth?.connected ? "nocreds"
    : im.verified === false ? "check" : "ok";
const STATUS_DOT: Record<Status, string> = {
  ok: "bg-safe-fg", check: "bg-review-fg", nocreds: "bg-keep-fg" };

export function StatusDot({ status }: { status: Status }) {
  return <span role="img" aria-label={t(`settings.status.${status}`)}
    title={t(`settings.status.${status}`)}
    className={`inline-block size-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />;
}

type SecDef = {
  id: SettingsSection; label: string; icon: ReactNode; tone: TagTone;
  value?: string;
  /** Row labels of the section: what the search field also matches. */
  rows: string[];
};

export function SettingsPage({ cfg, account, section, routeAccount = null,
  onSection, onClose, onAddAccount, onSaved, onAccountsChanged, aiAnswers = 0,
  onKnowledgeChanged = () => {}, scanState = null, controlRef }: {
  cfg: Config;
  account: string;                       // the ACTIVE account
  /** The open section (`#/settings/<section>`); null = the phone root list
   *  (a section column + the default section from 1024 px). */
  section: SettingsSection | null;
  /** The account named in the route of the account section, if any. */
  routeAccount?: string | null;
  /** Open a section (push = a new history entry), or null for the root. */
  onSection: (s: SettingsSection | null, account?: string | null,
    push?: boolean) => void;
  /** "+ Add account": the app's setup wizard (it names the account itself). */
  onAddAccount: () => void;
  /** Leave the page (Esc / Back from the root): the app returns where the
   *  user came from. */
  onClose: () => void;
  onSaved: (c: Config) => void;
  /** Filed senders: AI answers of the active account that apply now (what
   *  "Keep all AI answers" would keep) and a refresh after a change. */
  aiAnswers?: number;
  onKnowledgeChanged?: () => void;
  /** Accounts were added/removed. `switchTo` names a new account to
   *  activate (or null to let App re-validate the current one). */
  onAccountsChanged: (c: Config, switchTo: string | null) => void;
  /** The active account's scan state (the pill and "Scan now"). */
  scanState?: { account: string; status: AppState["status"];
    scanned_ts: number | null; error: string } | null;
  controlRef?: MutableRefObject<SettingsControl | null>;
}) {
  const wide = useSidebar();
  const toast = useToast();
  const demo = useDemo();
  // Which account the connection fields edit (defaults to the route's, else
  // the active one; independent of the header switcher).
  const startAcct = routeAccount && cfg.accounts[routeAccount] ? routeAccount
    : cfg.accounts[account] ? account : cfg.default_account;
  const [editAcct, setEditAcct] = useState(startAcct);
  const [f, setF] = useState<Form>(() => initialForm(cfg, startAcct));
  const [protectedText, setProtectedText] =
    useState((cfg.protected ?? []).join("\n"));
  const [categoriesText, setCategoriesText] =
    useState(catText(cfg.categories));
  // Folder picker: checked = scanned. Wildcard rules (e.g. Labels/*) are
  // shown as removable chips and win over checkboxes.
  const [folders, setFolders] = useState<FoldersResp | null>(null);
  const [foldersErr, setFoldersErr] = useState("");
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [wildcards, setWildcards] = useState<string[]>([]);
  const cur: Staged = { f, protectedText, categoriesText,
    included: [...included].sort(), wildcards };
  const [baseline, setBaseline] = useState<Staged>(() => ({
    f: initialForm(cfg, startAcct),
    protectedText: (cfg.protected ?? []).join("\n"),
    categoriesText: catText(cfg.categories), included: [], wildcards: [] }));
  const dirty = !sameStaged(baseline, cur);
  const summary = changeSummary(baseline, cur);
  // The latest values for handlers that run after an await (a dialog).
  const latest = useRef({ dirty, cfg, baseline });
  latest.current = { dirty, cfg, baseline };
  const [q, setQ] = useState("");
  // The key is never prefilled: a saved one shows "•••• set · Change…".
  const [changingKey, setChangingKey] = useState(false);
  const note = (msg: string, error = false) =>
    toast.show(msg, { variant: error ? "error" : "success" });

  const [digestTesting, setDigestTesting] = useState(false);
  const [digestTestMsg, setDigestTestMsg] = useState("");
  const sendTestDigest = async () => {
    setDigestTesting(true);
    setDigestTestMsg("");
    try {
      const r = await api.testDigest(editAcct);
      setDigestTestMsg(t(r.demo ? "digest.test_sent_demo" : "digest.test_sent"));
    } catch (e: any) {
      setDigestTestMsg(t("err.generic", { msg: e.message ?? e }));
    }
    setDigestTesting(false);
  };
  // Admin usage overview (Sign-in & users): fetched once when it opens.
  const [tenantStats, setTenantStats] =
    useState<AdminTenantStats[] | null>(null);
  const [tenantStatsErr, setTenantStatsErr] = useState("");

  // Folder discovery is PER ACCOUNT (each provider names folders
  // differently) and needs that account's SAVED credentials.
  // `merge` (a reload after a role choice or a move) keeps the ticks and
  // wildcard chips the user already changed instead of resetting them.
  const touched = useRef(new Set<string>());
  const discoverFolders = (name: string, merge = false) => {
    if (!merge) touched.current.clear();
    setFolders(null);
    setFoldersErr("");
    api.folders(name)
      .then((r) => {
        setFolders(r);
        if (!merge) setWildcards(r.wildcards);
        const nextIncluded = (prev: Set<string>) => new Set(r.folders
          .filter((x) => merge && touched.current.has(x.raw)
            ? prev.has(x.raw) : !x.excluded)
          .map((x) => x.raw));
        setIncluded(nextIncluded);
        // What the server just told us is the saved state, not an edit.
        if (!merge) setBaseline((b) => ({ ...b, wildcards: r.wildcards,
          included: [...nextIncluded(new Set())].sort() }));
      })
      .catch((e) => setFoldersErr(String(e.message ?? e)));
  };
  const tick = (next: Set<string>) => {
    for (const raw of new Set([...included, ...next]))
      if (included.has(raw) !== next.has(raw)) touched.current.add(raw);
    setIncluded(next);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { discoverFolders(editAcct); }, [editAcct]);

  const set = (k: keyof Form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement
      | HTMLTextAreaElement>) =>
      setF((o) => ({ ...o, [k]: e.target.value }));
  const put = <K extends keyof Form>(k: K, v: Form[K]) =>
    setF((o) => ({ ...o, [k]: v }));

  // Which sign-in method a preset starts on: Gmail keeps the saved choice
  // if the account already was Gmail, else App password (the default);
  // Outlook is OAuth-only; custom keeps the saved choice; every other
  // preset has no OAuth at all (so a leftover token block is not used).
  const presetAuth = (p: Preset): AuthMethod => {
    const saved = imapOf(cfg, editAcct);
    return p === "outlook" ? "oauth"
      : p === "gmail" ? (saved.preset === "gmail" ? accountAuth(saved)
        : "password")
      : p === "custom" ? accountAuth(saved)
      : "password";
  };
  const applyPreset = (p: Preset) => {
    if (p === "custom") {
      // Leaving a preset must not keep its CA path (Proton's file does
      // not exist elsewhere); an already-custom account keeps its own.
      setF({ ...f, preset: p, auth: presetAuth(p),
        cafile: f.preset === "custom" ? f.cafile : "" });
      return;
    }
    const pre = PRESETS[p];
    setF({ ...f, preset: p, host: pre.host, port: String(pre.port),
      security: pre.security, smtpHost: pre.smtpHost,
      smtpPort: String(pre.smtpPort), smtpSecurity: pre.smtpSecurity,
      cafile: pre.cafile, auth: presetAuth(p) });
  };
  const presetHint = f.preset === "custom" ? ""
    // Outlook's hint depends on whether this server has a shared
    // Microsoft app (device code, no setup) or not (bring your own).
    : f.preset === "outlook"
      ? (cfg.oauth_ms_device_available ? "preset.hint.oauth_outlook_device"
        : "preset.hint.oauth_outlook_byo")
      : PRESETS[f.preset].hint;
  // The provider preset already says which mail service this is, so it
  // also decides the OAuth provider - no need to ask again. Only when the
  // account signs in via OAuth: gmail -> google, outlook -> microsoft,
  // custom -> whatever its saved oauth block has; others never.
  const oauthProvider: "" | OauthProvider =
    f.preset === "outlook" ? "microsoft"
    : f.auth !== "oauth" ? ""
    : f.preset === "gmail" ? "google"
    : f.preset === "custom" ? f.oauthProvider
    : "";
  // The method actually in force: OAuth only where a provider exists.
  const auth: AuthMethod = oauthProvider ? "oauth" : "password";

  const excludedList = (): string[] | undefined => {
    if (!folders) return undefined;   // picker never loaded: keep old config
    const explicit = folders.folders
      .filter((x) => !included.has(x.raw))
      .map((x) => x.raw);
    return [...wildcards, ...explicit];
  };

  // A save in flight: Save (bar and leave prompt) waits for it.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // Set once the page is about to be replaced by a full navigation (OAuth
  // consent): the browser's "Leave site?" prompt would be false then.
  const leaving = useRef(false);
  // A price / budget that is no number must not silently save as 0 (= no
  // cap): the field is marked invalid and Save is blocked.
  const badDecimal = [f.priceIn, f.priceOut, f.budget, f.sharedBudget]
    .some(isBadDecimal);
  const save = async (extra: Record<string, unknown> = {}) => {
    if (savingRef.current) return null;
    if (badDecimal) { note(t("decimal.invalid"), true); return null; }
    savingRef.current = true;
    setSaving(true);
    try {
      const excluded = excludedList();
      const [digestHour, digestMinute] = f.digestTime.split(":").map(Number);
      const body: Record<string, unknown> = {
        account: editAcct,
        imap: { host: f.host, port: +f.port || 1143,
          security: f.security, smtp_host: f.smtpHost,
          smtp_port: +f.smtpPort || 1025, smtp_security: f.smtpSecurity,
          cafile: f.cafile, preset: f.preset, user: f.user,
          digest: { schedule: f.digestSchedule,
            recipient: f.digestRecipient,
            hour: digestHour || 0, minute: digestMinute || 0,
            url: f.digestUrl.trim(), lang: f.digestLang },
          auto_scan: { enabled: f.autoScanEnabled, unit: f.autoScanUnit,
            value: +f.autoScanValue || 1,
            align_minute: +f.autoScanAlign || 0 },
          body_search: f.bodySearch,
          smart_min: Math.min(50, Math.max(2, Math.round(+f.smartMin) || 10)),
          auth,
          // Google shows an app password as 4 groups of 4 letters; it
          // never contains a space.
          ...(f.password ? { password: f.preset === "gmail"
            ? f.password.replace(/\s+/g, "") : f.password } : {}),
          ...(oauthProvider ? { oauth: { provider: oauthProvider,
            client_id: f.oauthClientId,
            ...(f.oauthClientSecret
              ? { client_secret: f.oauthClientSecret } : {}) } } : {}) },
        ...(excluded ? { excluded_folders: excluded } : {}),
        protected: protectedText.split("\n")
          .map((s) => s.trim()).filter(Boolean),
        categories: parseCategories(),
        new_sender_window_days: +f.newSenderWindowDays || 7,
        ai: { provider: f.provider, model: f.model,
          foundry_endpoint: f.endpoint,
          price_in: +f.priceIn || 0, price_out: +f.priceOut || 0,
          budget_usd: +f.budget || 0,
          sort_instructions: f.sortInstructions,
          ...(f.apiKey ? { api_key: f.apiKey } : {}) },
        // Server-level settings ride along for the admin only - the
        // backend rejects them (403) from anyone else.
        ...(cfg.auth.is_admin ? {
          auth: { mode: f.authMode, admin: f.oidcAdmin.trim(),
            ...(f.authPassword ? { password: f.authPassword } : {}),
            oidc: { issuer: f.oidcIssuer, client_id: f.oidcClientId,
              redirect_base: f.oidcRedirect,
              allowed: f.oidcAllowed.split("\n")
                .map((a) => a.trim()).filter(Boolean),
              ...(f.oidcSecret ? { client_secret: f.oidcSecret } : {}) } },
          shared_ai: { enabled: f.sharedEnabled,
            provider: f.sharedProvider, model: f.sharedModel,
            foundry_endpoint: f.sharedEndpoint,
            default_tenant_budget_usd: +f.sharedBudget || 0,
            ...(f.sharedKey ? { api_key: f.sharedKey } : {}) },
        } : {}),
        ...extra,
      };
      const next = await api.saveConfig(body);
      onSaved(next);
      const nf: Form = { ...f, apiKey: "", authPassword: "", oidcSecret: "",
        sharedKey: "", authMode: next.auth.mode,
        newSenderWindowDays: String(next.new_sender_window_days),
        ...imapFields(next, editAcct) };
      const pt = (next.protected ?? []).join("\n");
      const ct = catText(next.categories);
      setF(nf);
      setChangingKey(false);
      setProtectedText(pt);
      setCategoriesText(ct);
      setBaseline({ f: nf, protectedText: pt, categoriesText: ct,
        included: [...included].sort(), wildcards });
      note(t("Saved."));
      return next;
    } catch (e: any) {
      note(t("err.generic", { msg: e.message ?? e }), true);
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const parseCategories = (): Record<string, string[]> =>
    Object.fromEntries(parseCategoryText(categoriesText)
      .map((c) => [c.name, c.kws]));

  /** Back to the saved copy (the save bar's Revert, a discarded leave). */
  const revert = () => {
    const b = latest.current.baseline;
    touched.current.clear();
    setChangingKey(false);
    setF(b.f);
    setProtectedText(b.protectedText);
    setCategoriesText(b.categoriesText);
    setIncluded(new Set(b.included));
    setWildcards(b.wildcards);
  };

  /** Unsaved edits are about to be lost (leaving, switching account): ask
   *  Save / Discard / Cancel. Resolves the config to continue from, or null
   *  to stay. */
  const resolveUnsaved = async (): Promise<Config | null> => {
    if (!latest.current.dirty) return latest.current.cfg;
    const r = await choiceDialog({
      title: t("settings.leave_title"),
      body: changeSummary(latest.current.baseline, cur).text,
      confirmLabel: t("Save"), altLabel: t("settings.discard"),
    });
    if (r === "confirm") return await save();
    if (r === "alt") { revert(); return latest.current.cfg; }
    return null;
  };
  useLayoutEffect(() => {
    if (!controlRef) return;
    controlRef.current = {
      dirty: () => latest.current.dirty,
      confirmLeave: async () => (await resolveUnsaved()) !== null,
    };
    return () => { controlRef.current = null; };
  });
  // A reload / tab close with staged edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", on);
    return () => window.removeEventListener("beforeunload", on);
  }, [dirty]);

  /** Make `name` the account the connection / digest / scan fields edit:
   *  its fields replace the account-bound ones, in the form and the baseline
   *  alike (they start clean). */
  const loadAccount = (src: Config, name: string) => {
    const fields = imapFields(src, name);
    setEditAcct(name);
    setPwOpen(false);
    setSmtpOpen(false);
    setF((o) => ({ ...o, ...fields }));
    setBaseline((b) => ({ ...b, f: { ...b.f, ...fields } }));
    setDigestTestMsg("");
  };
  const switchAccount = async (name: string): Promise<boolean> => {
    if (name === editAcct) return true;
    const src = await resolveUnsaved();
    if (!src) return false;
    loadAccount(src, name);
    return true;
  };

  // The backend trims names and rejects empty/duplicate ones; say so up
  // front. `own` (the account being renamed) may keep its name.
  const accountNameError = (own?: string) => (value: string) => {
    const name = value.trim();
    if (!name) return t("account.err_empty");
    if (name !== own && Object.hasOwn(cfg.accounts, name)) {
      return t("account.err_dup", { name });
    }
    return null;
  };

  const renameAccount = async () => {
    const name = (await promptDialog({
      title: t("account.rename_title"),
      label: t("account.rename_prompt", { name: editAcct }),
      initial: editAcct, confirmLabel: t("account.rename_confirm"),
      validate: accountNameError(editAcct),
    }))?.trim();
    if (!name || name === editAcct) return;
    try {
      const next = await api.saveConfig(
        { rename_account: { from: editAcct, to: name } });
      onAccountsChanged(next, account === editAcct ? name : null);
      setEditAcct(name);
      gotoSettings("account", name);
      note(t("account.renamed", { name }));
    } catch (e: any) {
      note(t("err.generic", { msg: e.message ?? e }), true);
    }
  };

  const newAccount = async () => {
    if (!await resolveUnsaved()) return;
    onAddAccount();
  };

  const deleteAccount = async () => {
    if (!await confirmDialog({
      title: t("account.delete_title", { name: editAcct }),
      bullets: [t("account.delete_data"), t("account.delete_rules"),
        t("account.delete_mails")],
      confirmLabel: t("account.delete_confirm"), tone: "danger",
    })) return;
    try {
      const next = await api.saveConfig({ delete_account: editAcct });
      onAccountsChanged(next, null);
      loadAccount(next, next.default_account);
      gotoSettings("account", next.default_account);
    } catch (e: any) {
      note(t("err.generic", { msg: e.message ?? e }), true);
    }
  };

  // OAuth connect: the auth-code+PKCE flow is a full-page redirect (the
  // provider's consent screen), so client_id/secret must be saved first.
  // The device-code flow needs neither - it polls this page instead.
  const [deviceInfo, setDeviceInfo] = useState<{
    userCode: string; verificationUri: string; deviceCode: string;
    interval: number;
  } | null>(null);
  const [oauthMsg, setOauthMsg] = useState("");
  // The password field replaces "•••• Change…"; the SMTP fields unfold.
  const [pwOpen, setPwOpen] = useState(false);
  const [smtpOpen, setSmtpOpen] = useState(false);

  const connectOauth = async () => {
    const next = await save();
    if (!next) return;
    leaving.current = true;
    window.location.href = `/api/oauth/imap/login?account=` +
      `${encodeURIComponent(editAcct)}&provider=${oauthProvider}`;
  };

  /** Re-read the account's saved sign-in state after an OAuth change. */
  const refreshAccount = async () => {
    const next = await api.getConfig();
    onSaved(next);
    loadAccount(next, editAcct);
  };

  const disconnectOauth = async () => {
    if (!await confirmDialog({
      title: t("oauth.disconnect_title"), body: t("oauth.disconnect_body"),
      confirmLabel: t("oauth.disconnect"), tone: "danger",
    })) return;
    await api.oauthDisconnect(editAcct);
    await refreshAccount();
  };

  const startDeviceConnect = async () => {
    setOauthMsg("");
    try {
      const r = await api.oauthDeviceStart(editAcct);
      setDeviceInfo({ userCode: r.user_code,
        verificationUri: r.verification_uri, deviceCode: r.device_code,
        interval: r.interval || 5 });
    } catch (e: any) {
      setOauthMsg(t("err.generic", { msg: e.message ?? e }));
    }
  };

  useEffect(() => {
    if (!deviceInfo) return;
    const id = setInterval(async () => {
      try {
        const r = await api.oauthDevicePoll(editAcct, deviceInfo.deviceCode);
        if (r.status === "complete") {
          clearInterval(id);
          setDeviceInfo(null);
          await refreshAccount();
          setOauthMsg(t("oauth.connected"));
        } else if (r.status === "error") {
          clearInterval(id);
          setDeviceInfo(null);
          setOauthMsg(t("err.generic", { msg: r.error ?? "" }));
        }
      } catch {
        /* transient network error - keep polling until it expires */
      }
    }, deviceInfo.interval * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceInfo?.deviceCode]);

  const [pi, po] = cfg.ai.prices_effective;
  const s = cfg.ai_stats;

  const resetStats = async () => {
    if (!await confirmDialog({
      title: t("confirm.reset_spend"),
      body: t("confirm.reset_spend_body", { cost: fmtUsd(s.cost),
        month: fmtUsd(cfg.ai.month_cost ?? 0) }),
      confirmLabel: t("confirm.reset_spend_confirm"), tone: "danger",
    })) return;
    onSaved(await api.saveConfig({ reset_ai_stats: true }));
  };

  const signOutAll = async () => {
    if (!await confirmDialog({
      title: t("confirm.sign_out_all"),
      body: t("confirm.sign_out_all_body"),
      confirmLabel: t("confirm.sign_out_all_confirm"), tone: "danger",
    })) return;
    await api.signOutAll();
    note(t("login.signed_out_all"));
  };

  const clearVerdicts = async () => {
    if (!await confirmDialog({
      title: t("confirm.clear_verdicts"),
      body: t("confirm.clear_verdicts_body"),
      confirmLabel: t("confirm.clear_verdicts_confirm"), tone: "danger",
    })) return;
    onSaved(await api.saveConfig({ clear_ai_verdicts: true }));
    note(t("AI verdict cache cleared."));
  };

  const importInput = useRef<HTMLInputElement>(null);
  const importBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!await confirmDialog({
      title: t("import.title"),
      bullets: [t("import.settings"), t("import.rules"), t("import.merged"),
        t("import.secrets")],
      confirmLabel: t("import.confirm"), tone: "danger",
    })) return;
    try {
      const body = JSON.parse(await file.text());
      const res = await fetch("/api/import_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const r = await res.json();
      onSaved(await api.getConfig());
      note(t("import.done", { rules: r.rules, verdicts: r.verdicts,
        knowledge: r.knowledge ?? 0 })
        + (r.skipped_rules?.length
          ? t("import.skipped", { names: r.skipped_rules.join(", ") }) : ""));
    } catch (err: any) {
      note(t("err.generic", { msg: err.message ?? err }), true);
    }
  };

  /* ---------------------------- navigation model ---------------------------- */

  const admin = !!cfg.auth.is_admin;
  const acctNames = Object.keys(cfg.accounts);
  const multi = acctNames.length > 1;
  const saved = imapOf(cfg, editAcct);
  const sched = saved.digest?.schedule ?? "off";
  const clock = `${String(saved.digest?.hour ?? 8).padStart(2, "0")}:`
    + `${String(saved.digest?.minute ?? 0).padStart(2, "0")}`;
  const scan = saved.auto_scan;
  const aiProvider = { anthropic: "Anthropic", openai: "OpenAI",
    foundry: "Foundry", ollama: "Ollama" }[cfg.ai.provider];
  const sec = (id: SettingsSection, icon: ReactNode, tone: TagTone,
    value: string | undefined, rows: string[]): SecDef =>
    ({ id, icon, tone, value, rows,
      label: t(`settings.sec.${id}`) });
  // the badge counts your own categories, not overrides of built-in ones
  const ownCategories = Object.keys(cfg.categories ?? {})
    .filter((n) => !BUILTIN_CATEGORIES.includes(n)).length;
  const defs: Record<SettingsSection, SecDef> = {
    account: sec("account", null, "neutral", undefined,
      [t("preset.row"), t("Host"), t("IMAP port"), t("imap.security"),
        t("User"), t("Password"), t("smtp.host"), t("SMTP port"),
        t("smtp.security"), t("cafile.label"), t("folders.discover"),
        t("account.rename"), t("account.add")]),
    general: sec("general", <SettingsIcon size={16} />, "neutral", undefined,
      [t("Appearance"), t("Language"), t("settings.new_badge"),
        t("smart.min_label"), t("body_search.label")]),
    notifications: sec("notifications", <Bell size={16} />, "keep", undefined,
      [t("notify.title")]),
    protected: sec("protected", <Shield size={16} />, "safe",
      cfg.protected?.length ? String(cfg.protected.length) : undefined, []),
    categories: sec("categories", <TagIcon size={16} />, "review",
      ownCategories ? String(ownCategories) : undefined,
      [t("Custom categories")]),
    filed: sec("filed", <Folder size={16} />, "info", undefined, []),
    digest: sec("digest", <Mail size={16} />, "attach",
      sched === "off" ? t("digest.off")
        : `${cap(t(`sched.${sched}`))} ${clock}`,
      [t("digest.schedule"), t("digest.recipient"), t("digest.time"),
        t("digest.send_test")]),
    autoscan: sec("autoscan", <RefreshCw size={16} />, "new",
      scan?.enabled
        ? t(scan.unit === "minutes" ? "settings.every_min"
          : "settings.every_h", { n: scan.value }) : t("digest.off"),
      [t("auto_scan.enabled"), t("auto_scan.every"), t("auto_scan.align")]),
    ai: sec("ai", <Sparkles size={16} />, "attach",
      cfg.ai.api_key_set || cfg.ai.source === "shared" ? aiProvider
        : t("settings.not_set_up"),
      [t("Provider"), t("Model"), t("API key"), t("budget.label"),
        t("ai.sort_instructions"), t("ai.usage")]),
    signin: sec("signin", <KeyRound size={16} />, "neutral", undefined,
      [t("login.mode"), t("login.password_label"), t("shared.enabled"),
        t("usage.section")]),
    backup: sec("backup", <Archive size={16} />, "neutral", undefined,
      [t("Export"), t("Import…")]),
  };
  const groups: { key: string; label?: string; ids: SettingsSection[] }[] = [
    { key: "app", label: t("settings.group.app"),
      ids: ["general", "notifications", "protected", "categories", "filed",
        ...(admin ? [] : ["backup" as const])] },
    { key: "automation", label: t("settings.group.automation"),
      ids: ["digest", "autoscan"] },
    { key: "ai", label: t("settings.group.ai"), ids: ["ai"] },
    ...(admin ? [{ key: "server", label: t("settings.group.server"),
      ids: ["signin" as const, "backup" as const] }] : []),
  ];
  const allowed = new Set<SettingsSection>(
    SETTINGS_SECTIONS.filter((id) => id !== "signin" || admin));
  // The section shown: the route's, else the first one on wide layouts.
  const open: SettingsSection | null = section && allowed.has(section)
    ? section : wide ? "general" : null;

  const query = q.trim().toLowerCase();
  const hits = query ? (SETTINGS_SECTIONS.filter((id) => allowed.has(id)
    && id !== "account").map((id) => {
    const d = defs[id];
    const rows = d.rows.filter((r) => r.toLowerCase().includes(query));
    return d.label.toLowerCase().includes(query) || rows.length
      ? { d, rows: d.label.toLowerCase().includes(query) ? [] : rows } : null;
  }).filter(<T,>(x: T | null): x is T => !!x)) : [];
  const acctHits = query
    ? acctNames.filter((n) => n.toLowerCase().includes(query)) : [];
  const accountRows = !query || defs.account.rows
    .some((r) => r.toLowerCase().includes(query));

  const pick = async (id: SettingsSection, name?: string) => {
    if (id === "account") {
      const to = name ?? editAcct;
      if (!await switchAccount(to)) return;
      onSection("account", to, !wide && section === null);
    } else {
      onSection(id, null, !wide && section === null);
    }
    setQ("");
  };

  // Esc leaves the page (or, on a phone, goes up from a section) unless
  // something nearer used it: a dialog, a pop-up, a text field.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isModalOpen()) return;
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;
      e.preventDefault();
      if (!wide && section) { onSection(null); return; }
      void (async () => { if (await resolveUnsaved()) onClose(); })();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  useEffect(() => {
    if (open !== "signin" || !admin || tenantStats) return;
    api.adminStats()
      .then((r) => setTenantStats(r.tenants))
      .catch((e) => setTenantStatsErr(String(e.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Notifications are a browser-side switch (applies at once, not staged).
  const [notifyOn, setNotifyOn] = useState(
    () => localStorage.getItem("pmc_notify") === "1");
  const setNotify = async (on: boolean) => {
    if (!on) {
      localStorage.setItem("pmc_notify", "0");
      setNotifyOn(false);
      return;
    }
    const perm = typeof Notification !== "undefined"
      ? await Notification.requestPermission() : "denied";
    if (perm === "granted") {
      localStorage.setItem("pmc_notify", "1");
      setNotifyOn(true);
    } else {
      note(t("notify.denied"), true);
    }
  };
  // Body search is a switch; the mode it turns back on is the last one used.
  const lastBodyMode = useRef<BodySearchMode>(
    f.bodySearch === "disabled" ? "server" : f.bodySearch);
  if (f.bodySearch !== "disabled") lastBodyMode.current = f.bodySearch;

  /* ------------------------------ section bodies ---------------------------- */

  const oauthCard = !oauthProvider ? null : (
    <div>
      <div className="type-section text-muted">
        {t("oauth.title", { provider: oauthProvider === "google"
          ? "Gmail" : "Outlook" })}
      </div>

      {oauthProvider === "google" && (
        <p className="my-2 type-meta text-muted">{t("oauth.google_help")}</p>
      )}
      {oauthProvider === "microsoft" && cfg.oauth_ms_device_available && (
        <p className="my-2 type-meta text-muted">{t("oauth.ms_device_help")}</p>
      )}
      {oauthProvider === "microsoft" && !cfg.oauth_ms_device_available && (
        <p className="my-2 type-meta text-muted">{t("oauth.ms_byo_help")}</p>
      )}

      {!(oauthProvider === "microsoft"
        && cfg.oauth_ms_device_available) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label={t("oauth.client_id")}>
            <Input className="w-full" value={f.oauthClientId}
              onChange={set("oauthClientId")} />
          </Field>
          <Field label={t("oauth.client_secret")}>
            <Input className="w-full" type="password"
              value={f.oauthClientSecret}
              placeholder={f.oauthClientSecretSet
                ? t("(unchanged)")
                : t(oauthProvider === "microsoft" ? "optional" : "required")}
              onChange={set("oauthClientSecret")} />
          </Field>
        </div>
      )}

      <DemoHint className="mt-2" />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {f.oauthConnected ? (<>
          <span className="inline-flex items-center gap-1.5 type-body
            text-safe-fg">
            <Check size={16} /> {t("oauth.connected")}
          </span>
          <Button variant="secondary" onClick={disconnectOauth}
            disabled={demo}>
            {t("oauth.disconnect")}
          </Button>
        </>) : oauthProvider === "microsoft"
          && cfg.oauth_ms_device_available ? (
          <Button onClick={startDeviceConnect} disabled={demo}>
            {t("oauth.connect_device")}
          </Button>
        ) : (
          <Button onClick={connectOauth} disabled={demo || !f.oauthClientId}>
            {t("oauth.connect")}
          </Button>
        )}
      </div>

      {deviceInfo && (
        <div className="mt-2 rounded-card border border-line bg-panel p-3
          type-body">
          <p>{t("oauth.device_instructions")}</p>
          <p className="mt-1">
            <a href={deviceInfo.verificationUri} target="_blank"
              rel="noreferrer" className={LINK_ACCENT}>
              {deviceInfo.verificationUri}
            </a>
          </p>
          {/* tracking-widest: a code the user types, so keep its letters apart. */}
          <p className="mt-1 font-mono type-heading tracking-widest">
            {deviceInfo.userCode}
          </p>
        </div>
      )}
      {oauthMsg && (
        <p className="mt-2 type-meta text-muted">{oauthMsg}</p>
      )}
    </div>
  );

  /** "Applies to account: [x]" - the digest, auto-scan and search settings
   *  belong to ONE account; with several, this picks which. */
  const scopeRow = multi && (
    <SettingsRow label={t("settings.applies_to")}>
      <PopupSelect name={t("settings.applies_to")} value={editAcct}
        onChange={(v) => { void switchAccount(v); }}
        options={acctNames.map((n) => ({ value: n, label: n }))} />
    </SettingsRow>
  );

  /** The status pill: what the saved credentials say, plus the scan state
   *  where the app has it (only the active account's is loaded). There is no
   *  live connection check, so it says "Signed in", not "Connected". */
  const acctStatus = statusOf(saved);
  const scanning = scanState?.account === editAcct
    && scanState.status === "scanning";
  const scanFailed = scanState?.account === editAcct
    && scanState.status === "error";
  const scanAgo = scanState?.account === editAcct
    ? fmtAgo(scanState.scanned_ts) : "";
  const pillText = [t(`settings.status.${acctStatus}`),
    ...(acctStatus === "nocreds" ? []
      : scanning ? [t("account.scan_running")]
      : scanFailed ? [t("account.scan_failed")]
      : scanState?.account === editAcct
        ? [scanAgo ? t("scan.age", { ago: scanAgo })
          : t("account.never_scanned")] : [])].join(" · ");
  const pillTone: TagTone = acctStatus === "ok" && !scanFailed ? "safe"
    : acctStatus === "check" ? "review" : "keep";
  const scanNow = async () => {
    try { await api.scan(editAcct); note(t("account.scan_started")); }
    catch (e: any) { note(t("err.generic", { msg: e.message ?? e }), true); }
  };
  const pwShown = !saved.password_set || pwOpen || !!f.password;
  const pwLabel = f.preset === "gmail" ? t("signin.password") : t("Password");
  const passwordRow = (
    <SettingsRow label={pwLabel}>
      {pwShown ? (
        <Input className="w-44 sm:w-64" type="password" value={f.password}
          aria-label={pwLabel} autoFocus={pwOpen}
          placeholder={saved.password_set ? t("(unchanged)") : t("required")}
          onChange={set("password")} />
      ) : (<span className="flex items-center gap-2">
        <span aria-hidden className="type-body text-muted tracking-widest">
          ••••••••</span>
        <Button variant="secondary" onClick={() => setPwOpen(true)}>
          {t("account.change")}
        </Button>
      </span>)}
    </SettingsRow>
  );
  const presetFoot = [presetHint ? t(presetHint) : "",
    f.preset === "gmail" && auth === "password" ? t("signin.gmail_apppw_help")
      : ""].filter(Boolean);
  const smtpHost = f.smtpHost.trim();
  const discoverRow = (
    <SettingsRow icon={<RefreshCw size={16} className="text-accent" />}
      label={<span className="text-accent">{t("folders.discover_row")}</span>}
      sub={t("folders.discover_tip")}
      onClick={() => discoverFolders(editAcct)} />
  );

  const accountBody = (<>
    <div className="mb-6 flex flex-wrap items-center gap-4 rounded-card
      border border-line bg-panel p-4">
      <AccountAvatar name={editAcct} size="lg" />
      <div className="min-w-0 flex-1 basis-56">
        <div className="truncate type-title2">{editAcct}</div>
        <div className="truncate type-meta text-muted">
          {saved.user} · {presetLabel(saved.preset ?? "proton")}</div>
        <Tag tone={pillTone} dot className="mt-1.5">{pillText}</Tag>
        {scanFailed && scanState?.error && (
          <div className="mt-1 type-meta text-muted">{scanState.error}</div>
        )}
        {dirty && (
          <div className="mt-1 type-meta text-muted">
            {t("account.scan_save_first")}</div>
        )}
      </div>
      <div className="flex w-full shrink-0 gap-2 sm:w-auto">
        <Button variant="secondary" onClick={renameAccount}>
          {t("account.rename")}
        </Button>
        <Button variant="secondary" onClick={scanNow}
          disabled={demo || scanning || dirty || acctStatus === "nocreds"}>
          <RefreshCw size={14} className="mr-1 inline align-text-bottom" />
          {t("account.scan_now")}
        </Button>
      </div>
    </div>
    <p className="-mt-3 mb-6 px-3 type-meta text-muted">
      {t("account.hint")}{!multi && ` ${t("account.hint_switch")}`}</p>
    <SettingsGroup header={t("settings.connection")}
      footnote={presetFoot.length ? presetFoot.map((x) =>
        <span key={x} className="block">{x}</span>) : undefined}>
      <SettingsRow label={t("preset.row")} sub={t("preset.row_sub")}>
        <PopupSelect name={t("preset.row")} value={f.preset}
          onChange={(p) => applyPreset(p)}
          options={(Object.keys(PRESET_LABELS) as Preset[]).map((p) =>
            ({ value: p, label: presetLabel(p) }))} />
      </SettingsRow>
      <SettingsRow label={t("Host")}>
        <span className="flex items-center gap-1.5">
          <Input className="w-36 sm:w-48" value={f.host} aria-label={t("Host")}
            onChange={set("host")} />
          <span aria-hidden className="text-muted">:</span>
          <Input className="w-20" type="number" value={f.port}
            aria-label={t("IMAP port")} onChange={set("port")} />
        </span>
      </SettingsRow>
      <SettingsRow label={t("imap.security")}>
        <Segmented role="radio" label={t("imap.security")}
          value={f.security} onChange={(v) => put("security", v)}
          options={[{ value: "ssl", label: "SSL/TLS" },
            { value: "starttls", label: "STARTTLS" }]} />
      </SettingsRow>
      <SettingsRow label={t("User")}>
        <Input className="w-56 sm:w-64" value={f.user} aria-label={t("User")}
          onChange={set("user")} />
      </SettingsRow>
      {f.preset === "gmail" && (
        <SettingsRow label={t("signin.label")}>
          <Segmented role="radio" label={t("signin.label")}
            value={auth} onChange={(v) => put("auth", v)}
            options={[
              { value: "password", label: t("signin.password") },
              { value: "oauth", label: t("signin.oauth") }]} />
        </SettingsRow>
      )}
      {auth === "password" && passwordRow}
      {oauthCard && (
        <div className="px-4 py-3">
          {oauthCard}
        </div>
      )}
    </SettingsGroup>
    {!folders && (
      <SettingsGroup header={t("folders.title", { name: editAcct })}>
        {!foldersErr && <Loading className="!p-3" />}
        {foldersErr && (
          <div className="px-4 py-3 type-meta text-danger-fg">
            {foldersErr}
            <span className="ml-1 text-muted">{t("folders.err_hint")}</span>
          </div>
        )}
        {discoverRow}
      </SettingsGroup>
    )}
    {folders && (
      <FolderSettings grouped account={editAcct} data={folders}
        header={t("folders.title", { name: editAcct })} discover={discoverRow}
        included={included} setIncluded={tick} wildcards={wildcards}
        setWildcards={setWildcards}
        reload={() => discoverFolders(editAcct, true)} />
    )}
    <SettingsGroup header={t("settings.advanced")} footnote={t("smtp.help")}>
      <SettingsRow label={t("account.smtp_row")} expanded={smtpOpen}
        value={`${smtpHost || t("account.same_as_imap")} · ${f.smtpPort}`}
        onClick={() => setSmtpOpen((o) => !o)} />
      {smtpOpen && (<>
        <SettingsRow label={t("smtp.host")}>
          <Input className="w-44 sm:w-64" value={f.smtpHost}
            aria-label={t("smtp.host")}
            placeholder={t("smtp.host_placeholder")}
            onChange={set("smtpHost")} />
        </SettingsRow>
        <SettingsRow label={t("SMTP port")}>
          <Input className="w-24" type="number" value={f.smtpPort}
            aria-label={t("SMTP port")} onChange={set("smtpPort")} />
        </SettingsRow>
        <SettingsRow label={t("smtp.security")}>
          <PopupSelect name={t("smtp.security")} value={f.smtpSecurity}
            onChange={(v) => put("smtpSecurity", v)}
            options={[{ value: "auto", label: t("sec.auto") },
              { value: "ssl", label: "SSL/TLS" },
              { value: "starttls", label: "STARTTLS" }]} />
        </SettingsRow>
      </>)}
      <SettingsRow stack label={t("cafile.label")}>
        <Input className="w-full" value={f.cafile} aria-label={t("cafile.label")}
          placeholder="/certs/bridge-cert.pem" onChange={set("cafile")} />
      </SettingsRow>
    </SettingsGroup>
    {multi && (
      <SettingsGroup padded header={t("account.remove_title")}
        footnote={t("account.remove_help")}>
        <Button variant="danger-quiet" onClick={deleteAccount}>
          {t("account.delete", { name: editAcct })}
        </Button>
      </SettingsGroup>
    )}
  </>);

  const generalBody = (<>
    {cfg.secret_key_set === false && <Notice tone="warn" className="mb-4">
      {t("secrets.plaintext_warning")}
    </Notice>}
    <SettingsGroup>
      <SettingsRow label={t("Appearance")} stackOnPhone>
        <AppearanceControl className="max-sm:justify-between" />
      </SettingsRow>
      <SettingsRow label={t("Language")}>
        <PopupSelect name={t("Language")} value={getLang()}
          // The language applies with a reload: staged edits would be lost,
          // so they are saved or discarded first (the leave prompt).
          onChange={(v) => { void (async () => {
            if (v === getLang() || !await resolveUnsaved()) return;
            setLang(v as Lang);
            leaving.current = true;     // our own reload: no "Leave site?"
            window.location.reload();
          })(); }}
          options={[{ value: "en", label: "English" },
            { value: "de", label: "Deutsch" }]} />
      </SettingsRow>
      <SettingsRow label={t("numfmt.label")} sub={t("numfmt.help")}>
        <PopupSelect name={t("numfmt.label")} value={getNumFormat()}
          // Like the language: applied with a reload so every number follows.
          onChange={(v) => { void (async () => {
            if (v === getNumFormat() || !await resolveUnsaved()) return;
            setNumFormat(v as NumFormat);
            leaving.current = true;
            window.location.reload();
          })(); }}
          options={[{ value: "auto", label: t("numfmt.auto") },
            { value: "en", label: "1,234.5" },
            { value: "de", label: "1.234,5" },
            { value: "space", label: "1 234,5" }]} />
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup header={t("settings.senders")}>
      <SettingsRow label={t("settings.new_badge")}
        sub={t("new_sender.window_help")}>
        <Stepper min={1} max={365}
          value={+f.newSenderWindowDays || 7}
          format={(n) => t("settings.n_days", { n })}
          onChange={(n) => put("newSenderWindowDays", String(n))} />
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup header={t("settings.for_account", { name: editAcct })}
      footnote={f.bodySearch === "local" ? undefined
        : t("body_search.help")}>
      {scopeRow}
      <SettingsRow label={t("smart.min_label")} sub={t("smart.min_help")}>
        <Stepper min={2} max={50}
          value={Math.min(50, Math.max(2, Math.round(+f.smartMin) || 10))}
          format={(n) => t("settings.n_mails", { n })}
          onChange={(n) => put("smartMin", String(n))} />
      </SettingsRow>
      <SettingsRow label={t("body_search.label")}>
        <Switch checked={f.bodySearch !== "disabled"}
          onChange={(on) => put("bodySearch",
            on ? lastBodyMode.current : "disabled")} />
      </SettingsRow>
      {f.bodySearch !== "disabled" && (
        <SettingsRow label={t("settings.search_with")}>
          <PopupSelect name={t("settings.search_with")} value={f.bodySearch}
            onChange={(v) => put("bodySearch", v)}
            options={[
              { value: "server", label: t("body_search.server") },
              { value: "local", label: t("body_search.local"),
                disabled: !cfg.secret_key_set }]} />
        </SettingsRow>
      )}
    </SettingsGroup>
    {f.bodySearch === "local" && (
      <SettingsGroup padded footnote={<IndexNote />}>
        <IndexPanel account={editAcct}
          savedMode={(cfg.accounts[editAcct]?.body_search ?? "server"
            ) as BodySearchMode}
          secretKeySet={!!cfg.secret_key_set} />
      </SettingsGroup>
    )}
  </>);

  const notificationsBody = (
    <SettingsGroup>
      <SettingsRow label={t("notify.title")} sub={t("notify.sub")}>
        <Switch checked={notifyOn} onChange={setNotify} />
      </SettingsRow>
    </SettingsGroup>
  );

  const protectedBody = (
    <ProtectedList text={protectedText} onChange={setProtectedText} />
  );

  const categoriesBody = (
    <CategoryList text={categoriesText} onChange={setCategoriesText}
      builtin={cfg.builtin_categories} />
  );

  const filedBody = (
    <KnowledgeSettings aiAnswers={aiAnswers}
      onChanged={onKnowledgeChanged} />
  );

  const digestBody = (<>
    <DemoHint className="mb-3" />
    <DemoFieldset>
      <SettingsGroup footnote={t("digest.help")}>
        {scopeRow}
        <SettingsRow label={t("digest.schedule")}>
          <PopupSelect name={t("digest.schedule")} value={f.digestSchedule}
            onChange={(v) => put("digestSchedule", v)}
            options={[{ value: "off", label: t("digest.off") },
              { value: "daily", label: cap(t("sched.daily")) },
              { value: "weekly", label: cap(t("sched.weekly")) }]} />
        </SettingsRow>
        {f.digestSchedule !== "off" && (
          <SettingsRow label={t("digest.time")}>
            <Input type="time" aria-label={t("digest.time")}
              value={f.digestTime} onChange={set("digestTime")} />
          </SettingsRow>
        )}
        <SettingsRow label={t("digest.recipient")}>
          <Input className="w-full sm:w-64" aria-label={t("digest.recipient")}
            value={f.digestRecipient}
            placeholder={imapOf(cfg, editAcct).user
              || t("digest.recipient_placeholder")}
            onChange={set("digestRecipient")} />
        </SettingsRow>
        <SettingsRow label={t("digest.lang")}
          sub={imapOf(cfg, editAcct).digest?.lang ? undefined
            : t("digest.lang_unset")}>
          <PopupSelect name={t("digest.lang")} value={f.digestLang}
            onChange={(v) => put("digestLang", v)}
            options={[{ value: "en", label: "English" },
              { value: "de", label: "Deutsch" }]} />
        </SettingsRow>
        <SettingsRow label={t("digest.url")} sub={t("digest.url_help")} stack>
          <Input className="w-full" type="url" inputMode="url"
            aria-label={t("digest.url")} value={f.digestUrl}
            placeholder="https://inboxrake.example"
            onChange={set("digestUrl")} />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup footnote={digestTestMsg || undefined}>
        <SettingsRow label={t("digest.send_test")}>
          <Button variant="secondary" size="sm" onClick={sendTestDigest}
            disabled={demo || digestTesting}
            aria-label={t("digest.send_test")}>
            {digestTesting ? <Spinner /> : t("settings.send")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </DemoFieldset>
  </>);

  const everyMax = f.autoScanUnit === "hours" ? 24 : 1440;
  const autoscanBody = (
    <SettingsGroup footnote={t(f.autoScanEnabled ? "auto_scan.help_on"
      : "auto_scan.help")}>
      {scopeRow}
      <SettingsRow label={t("auto_scan.enabled")}>
        <Switch checked={f.autoScanEnabled}
          onChange={(on) => put("autoScanEnabled", on)} />
      </SettingsRow>
      {f.autoScanEnabled && (<>
        <SettingsRow label={t("auto_scan.every")}>
          <div className="flex items-center gap-2">
            <Stepper min={1} max={everyMax}
              value={Math.min(everyMax, Math.max(1, +f.autoScanValue || 1))}
              onChange={(n) => put("autoScanValue", String(n))} />
            <PopupSelect name={t("auto_scan.every")} value={f.autoScanUnit}
              onChange={(u) => setF((o) => ({ ...o, autoScanUnit: u,
                autoScanValue: String(Math.min(
                  u === "hours" ? 24 : 1440, +o.autoScanValue || 1)) }))}
              options={[{ value: "minutes", label: t("auto_scan.unit_minutes") },
                { value: "hours", label: t("auto_scan.unit_hours") }]} />
          </div>
        </SettingsRow>
        <SettingsRow label={t("auto_scan.align")}>
          <Stepper min={0} max={59}
            value={Math.min(59, Math.max(0, +f.autoScanAlign || 0))}
            format={(n) => t("settings.n_min", { n })}
            onChange={(n) => put("autoScanAlign", String(n))} />
        </SettingsRow>
      </>)}
    </SettingsGroup>
  );

  const providerOptions = [
    { value: "anthropic", label: "Anthropic API" },
    { value: "openai", label: "OpenAI" },
    { value: "foundry", label: "Microsoft Foundry" },
    { value: "ollama", label: "Ollama / local (OpenAI-compatible)" }];
  const aiCap = cfg.ai.source === "shared" ? cfg.ai.shared_budget_usd
    : cfg.ai.budget_usd;
  const aiSpent = cfg.ai.month_cost ?? 0;
  const keyInput = (
    <Input className="w-full" type="password" value={f.apiKey}
      aria-label={t("API key")} autoFocus={changingKey}
      placeholder={cfg.ai.api_key_set
        ? t("(unchanged)")
        : f.provider === "ollama"
          ? t("key.optional")
          : cfg.ai.source === "shared"
            ? t("ai.shared_key_ph")
            : t("(no key - AI features hidden)")}
      onChange={set("apiKey")} />
  );

  const aiBody = (<>
    <SettingsGroup padded>
      <div className="flex items-center gap-4">
        {aiCap > 0 ? (
          <Ring px={88} frac={aiSpent / aiCap}
            label={t("ai.budget_of", { spent: fmtUsd(aiSpent),
              cap: fmtUsd(aiCap) })}>
            <span className="type-body font-semibold">{fmtUsd(aiSpent)}</span>
          </Ring>
        ) : null}
        <div className="min-w-0">
          <div className="type-heading">{t("ai.month_title")}</div>
          {aiCap > 0 ? (<>
            <div className="type-body">
              {t("ai.budget_of", { spent: fmtUsd(aiSpent),
                cap: fmtUsd(aiCap) })}
            </div>
            <div className="type-meta text-muted">
              {aiSpent >= aiCap ? t("ai.budget_reached")
                : t("ai.budget_resets")}
            </div>
          </>) : (
            <div className="type-body">
              {t("budget.spent", { spent: fmtUsd(aiSpent) })}
              <span className="type-meta text-muted">
                {" "}· {t("budget.none")}</span>
            </div>
          )}
        </div>
      </div>
    </SettingsGroup>
    <DemoHint className="mb-3" />
    <DemoFieldset>
    <SettingsGroup header={t("AI review (optional)")}
      footnote={t("ai.data_note")}>
      <SettingsRow label={t("Provider")}>
        <PopupSelect name={t("Provider")} value={f.provider}
          onChange={(v) => put("provider", v as Form["provider"])}
          options={providerOptions} />
      </SettingsRow>
      <SettingsRow label={t("Model")}>
        <Input className="w-56 max-w-full" value={f.model}
          aria-label={t("Model")} onChange={set("model")} />
      </SettingsRow>
      {(f.provider === "foundry" || f.provider === "ollama") && (
        <SettingsRow stack label={f.provider === "foundry"
          ? "Foundry endpoint (https://…services.ai.azure.com/anthropic)"
          : `${t("endpoint.label")} (http://…:11434)`}>
          <Input className="w-full" value={f.endpoint}
            aria-label={t("endpoint.label")} onChange={set("endpoint")} />
        </SettingsRow>
      )}
      {cfg.ai.api_key_set && !changingKey && !f.apiKey ? (
        <SettingsRow label={t("API key")} value={t("ai.key_set")}>
          <Button variant="secondary" size="sm"
            onClick={() => setChangingKey(true)}>
            {t("ai.key_change")}
          </Button>
        </SettingsRow>
      ) : (
        <SettingsRow stack label={t("API key")}
          sub={cfg.ai.source === "shared" ? t("ai.shared_note", {
            cap: cfg.ai.shared_budget_usd
              ? fmtUsd(cfg.ai.shared_budget_usd) : t("budget.none") })
            : undefined}>
          {keyInput}
        </SettingsRow>
      )}
    </SettingsGroup>
    <SettingsGroup header={t("ai.prices")}>
      <SettingsRow label={t("ai.price_in")}>
        <DecimalInput className="w-28"
          aria-label={t("ai.price_in")} value={f.priceIn}
          placeholder={t("ai.price_auto", { n: pi })}
          onChange={(v) => put("priceIn", v)} />
      </SettingsRow>
      <SettingsRow label={t("ai.price_out")}>
        <DecimalInput className="w-28"
          aria-label={t("ai.price_out")} value={f.priceOut}
          placeholder={t("ai.price_auto", { n: po })}
          onChange={(v) => put("priceOut", v)} />
      </SettingsRow>
      <SettingsRow label={t("budget.label")}>
        <DecimalInput className="w-28"
          aria-label={t("budget.label")} value={f.budget}
          placeholder={t("budget.none")}
          onChange={(v) => put("budget", v)} />
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup padded header={t("ai.sort_instructions")}
      footnote={t("ai.sort_instructions_help", { max: fmtNum(1500) })}>
      <TextArea className="!min-h-16" maxLength={1500}
        aria-label={t("ai.sort_instructions")}
        value={f.sortInstructions} onChange={set("sortInstructions")} />
    </SettingsGroup>
    </DemoFieldset>
    <SettingsGroup header={t("ai.usage")}>
      <SettingsRow label={t("AI spend")} value={fmtUsd(s.cost)} />
      <SettingsRow label={t("ai.runs")} value={fmtNum(s.runs)} />
      <SettingsRow label={t("ai.tokens")}
        value={`${fmtNum(s.input_tokens)} / ${
          fmtNum(s.output_tokens)}`} />
      <div className="flex flex-wrap gap-2 px-4 py-2.5">
        <Button variant="danger-quiet" size="sm" onClick={resetStats}>
          {t("ai.reset_spend")}
        </Button>
        <Button variant="danger-quiet" size="sm" onClick={clearVerdicts}>
          {t("ai.clear_verdicts")}
        </Button>
      </div>
    </SettingsGroup>
  </>);

  const stackInput = (label: string, k: keyof Form, over: {
    type?: string; placeholder?: string } = {}) => (
    <SettingsRow stack label={label}>
      <Input className="w-full" aria-label={label} value={f[k] as string}
        onChange={set(k)} {...over} />
    </SettingsRow>
  );

  const signinBody = !admin ? null : (<>
    <SettingsGroup radioGroup header={t("login.mode")}
      footnote={t("login.help")}>
      <RadioRow label={t("login.mode_none")} checked={f.authMode === "none"}
        onSelect={() => put("authMode", "none")} />
      <RadioRow label={t("login.mode_password")}
        checked={f.authMode === "password"}
        onSelect={() => put("authMode", "password")} />
      <RadioRow checked={f.authMode === "oidc"} disabled={demo}
        label={t("login.mode_oidc")}
        sub={demo ? demoHint() : undefined}
        onSelect={() => put("authMode", "oidc")} />
    </SettingsGroup>
    {f.authMode === "password" && (
      <SettingsGroup>
        {stackInput(t("login.password_label"), "authPassword", {
          type: "password", placeholder: cfg.auth.password_set
            ? t("(unchanged)") : t("required") })}
      </SettingsGroup>
    )}
    {f.authMode === "oidc" && (
      <SettingsGroup footnote={t("login.tenancy_note")}>
        {stackInput(t("login.oidc_issuer"), "oidcIssuer",
          { placeholder: "https://id.example.com" })}
        {stackInput(t("login.oidc_client"), "oidcClientId")}
        {stackInput(t("login.oidc_secret"), "oidcSecret", {
          type: "password", placeholder: cfg.auth.oidc?.client_secret_set
            ? t("(unchanged)") : t("required") })}
        {stackInput(t("login.oidc_redirect"), "oidcRedirect",
          { placeholder: t("login.oidc_redirect_ph") })}
        {stackInput(t("login.oidc_admin"), "oidcAdmin",
          { placeholder: t("login.oidc_admin_ph") })}
        <SettingsRow stack label={t("login.oidc_allowed")}
          sub={t("login.oidc_allowed_help")}>
          <TextArea className="!min-h-16" aria-label={t("login.oidc_allowed")}
            value={f.oidcAllowed} placeholder={"me@corp.example"}
            onChange={(e) => put("oidcAllowed", e.target.value)} />
          {(!f.oidcAllowed.trim() || !f.oidcAdmin.trim()) && (
            <Notice tone="warn" className="mt-2"
              icon={<TriangleAlert size={16} />}>
              {[!f.oidcAllowed.trim() && t("login.oidc_open_warn"),
                !f.oidcAdmin.trim() && t("login.oidc_noadmin_warn"),
              ].filter(Boolean).join(" ")}
            </Notice>
          )}
        </SettingsRow>
      </SettingsGroup>
    )}
    {cfg.auth.mode !== "none" && (
      <SettingsGroup footnote={t("login.sign_out_all_help")}>
        <div className="px-4 py-2.5">
          <Button variant="danger-quiet" size="sm" onClick={signOutAll}>
            {t("login.sign_out_all")}
          </Button>
        </div>
      </SettingsGroup>
    )}

    <DemoHint className="mb-3" />
    <DemoFieldset>
    <SettingsGroup header={t("shared.section")} footnote={t("shared.help")}>
      <SettingsRow label={t("shared.enabled")}>
        <Switch checked={f.sharedEnabled}
          onChange={(on) => put("sharedEnabled", on)} />
      </SettingsRow>
      <SettingsRow label={t("shared.budget")}>
        <DecimalInput className="w-28"
          aria-label={t("shared.budget")} value={f.sharedBudget}
          placeholder={t("budget.none")}
          onChange={(v) => put("sharedBudget", v)} />
      </SettingsRow>
      {f.sharedEnabled && (<>
        <SettingsRow label={t("Provider")}>
          <PopupSelect name={t("Provider")} value={f.sharedProvider}
            onChange={(v) => put("sharedProvider", v as Form["sharedProvider"])}
            options={providerOptions} />
        </SettingsRow>
        <SettingsRow label={t("Model")}>
          <Input className="w-56 max-w-full" value={f.sharedModel}
            aria-label={t("Model")} onChange={set("sharedModel")} />
        </SettingsRow>
        {(f.sharedProvider === "foundry"
          || f.sharedProvider === "ollama") && (
          stackInput(t("endpoint.label"), "sharedEndpoint")
        )}
        {stackInput(t("API key"), "sharedKey", {
          type: "password", placeholder: cfg.shared_ai?.api_key_set
            ? t("(unchanged)") : t("required") })}
      </>)}
    </SettingsGroup>
    </DemoFieldset>

    <SettingsGroup header={t("usage.section")} footnote={t("usage.help")}
      className="min-w-0">
      {!tenantStats && !tenantStatsErr && <Loading className="!p-3" />}
      {tenantStatsErr && (
        <p className="px-4 py-3 type-meta text-danger-fg">{tenantStatsErr}</p>
      )}
      {tenantStats?.map((u) => {
        // A small stat grid: label over value, so no figure runs on from
        // the previous one or lands alone on a line.
        const stat = (label: string, value: ReactNode) => (
          <span className="block min-w-0">
            <span className="block">{label}</span>
            <span className="block text-body">{value}</span>
          </span>
        );
        return (
          <SettingsRow key={u.id}
            label={<span title={t("tenant.row_tip", { id: u.id,
              accounts: u.accounts, scans: u.scans, rules: u.rules,
              verdicts: u.verdicts })}>
              {u.is_admin_workspace && (
                <Star size={14} className="mr-1 inline align-text-bottom" />
              )}
              {u.label || u.id}
            </span>}
            sub={<span className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2
              sm:grid-cols-3 lg:grid-cols-5">
              {stat(t("usage.mails"), <>{fmtNum(u.mails)}
                {" "}· {fmtSize(u.size)}</>)}
              {/* the same cleaning as Activity: Trash + archive + moves */}
              {stat(t("usage.cleaned"), <>
                {fmtNum(u.actions_month.trash + u.actions_month.archive
                  + u.actions_month.move)}
                {(u.actions_month.purged_bytes ?? 0) > 0
                  && <> · {fmtSize(u.actions_month.purged_bytes ?? 0)}</>}
              </>)}
              {stat(t("usage.ai_month"), <>
                {fmtUsd(u.ai.month_cost)}
                {u.ai.budget_usd ? ` / ${fmtUsd(u.ai.budget_usd)}` : ""}
                {u.ai.source === "shared"
                  ? ` (${t("usage.shared")})` : ""}</>)}
              {stat(t("usage.last_scan"), (fmtAgo(u.last_scan_ts) && t("scan.ago", { ago: fmtAgo(u.last_scan_ts) })) || "-")}
              {stat(t("usage.disk"), fmtSize(u.disk_bytes))}
            </span>} />
        );
      })}
    </SettingsGroup>
  </>);

  const backupBody = (
    <SettingsGroup footnote={t("backup.help")}>
      <SettingsRow label={t("backup.export")}>
        <Button variant="secondary"
          onClick={() => downloadFile("/api/export_config")}>
          {t("Export")}
        </Button>
      </SettingsRow>
      <SettingsRow label={t("backup.import")}>
        <Button variant="secondary" onClick={() => importInput.current?.click()}>
          {t("Import…")}
        </Button>
        <input ref={importInput} type="file" accept="application/json"
          className="hidden" onChange={importBackup} />
      </SettingsRow>
    </SettingsGroup>
  );

  const bodies: Record<SettingsSection, ReactNode> = {
    account: accountBody, general: generalBody,
    notifications: notificationsBody, protected: protectedBody,
    categories: categoriesBody, filed: filedBody, digest: digestBody,
    autoscan: autoscanBody, ai: aiBody, signin: signinBody,
    backup: backupBody,
  };

  /* ------------------------------ section column ---------------------------- */

  const searchField = (
    <div className="relative mb-3">
      <Search size={16} aria-hidden className="pointer-events-none absolute
        left-2.5 top-1/2 -translate-y-1/2 text-muted" />
      <Input type="search" className="w-full pl-8" value={q}
        aria-label={t("settings.search")} placeholder={t("settings.search")}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) void pick(hits[0].d.id);
          else if (e.key === "Enter" && acctHits[0]) void pick("account", acctHits[0]);
        }} />
    </div>
  );
  const noMatch = !!query && !hits.length && !acctHits.length
    && !accountRows && (
    <p className="px-1 type-meta text-muted">
      {t("settings.no_match", { q: q.trim() })}
    </p>
  );
  const rowsHint = (rows: string[]) => rows.length
    ? rows.slice(0, 2).join(" · ") : undefined;

  /** One entry of the wide section column. */
  const navItem = (key: string, icon: ReactNode, label: string, opts: {
    current: boolean; value?: string; sub?: string; onClick: () => void;
    trailing?: ReactNode;
  }) => (
    <button key={key} type="button" onClick={opts.onClick}
      aria-current={opts.current ? "page" : undefined}
      className={`flex min-h-9 w-full items-center gap-2.5 rounded-control
        px-2.5 text-left type-body transition-colors coarse:min-h-11
        ${opts.current ? "bg-accent-tint font-medium text-accent"
          : "text-body hover:bg-chip"}`}>
      <span aria-hidden className="contents">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {opts.sub && (
          <span className="block truncate type-meta font-normal text-muted">
            {opts.sub}
          </span>
        )}
      </span>
      {opts.value && (
        <span className="type-meta tabular-nums text-muted">{opts.value}</span>
      )}
      {opts.trailing}
    </button>
  );
  const tile = (d: SecDef) => <IconTile tone={d.tone}>{d.icon}</IconTile>;
  const heading = (label: string) => (
    <div className="px-2.5 pb-1 pt-4 type-caption font-semibold uppercase
      text-muted">{label}</div>
  );

  const sectionColumn = (
    <nav aria-label={t("Settings")} className="flex w-65 shrink-0 flex-col
      gap-0.5 overflow-y-auto border-r border-line p-3">
      {searchField}
      {query ? (<>
        {accountRows && acctHits.map((n) => navItem(`a-${n}`,
          <AccountAvatar name={n} />, n, {
            current: open === "account" && editAcct === n,
            onClick: () => void pick("account", n) }))}
        {hits.map(({ d, rows }) => navItem(d.id, tile(d), d.label, {
          current: open === d.id, sub: rowsHint(rows),
          onClick: () => void pick(d.id) }))}
        {noMatch}
      </>) : (<>
        {heading(t("settings.group.accounts"))}
        {acctNames.map((n) => navItem(`a-${n}`, <AccountAvatar name={n} />, n, {
          current: open === "account" && editAcct === n,
          trailing: <StatusDot status={statusOf(cfg.accounts[n])} />,
          onClick: () => void pick("account", n) }))}
        <button type="button" onClick={() => void newAccount()}
          disabled={demo} title={demo ? demoHint() : undefined}
          className="flex min-h-9 w-full items-center gap-2.5 rounded-control
            px-2.5 text-left type-body text-accent transition-colors
            enabled:hover:bg-chip disabled:cursor-not-allowed
            disabled:text-faint coarse:min-h-11">
          <Plus size={16} aria-hidden />
          {t("account.add")}
        </button>
        {groups.map((g) => (
          <div key={g.key} className="flex flex-col gap-0.5">
            {heading(g.label!)}
            {g.ids.map((id) => navItem(id, tile(defs[id]), defs[id].label, {
              current: open === id, value: defs[id].value,
              onClick: () => void pick(id) }))}
          </div>
        ))}
      </>)}
    </nav>
  );

  /** The phone root list: account rows, then one grouped list per group. */
  const rootList = (<>
    {searchField}
    {query ? (<>
      {(accountRows ? acctHits : []).length > 0 && (
        <SettingsGroup>
          {acctHits.map((n) => (
            <SettingsRow key={n} label={n}
              icon={<AccountAvatar name={n} size="md" />}
              onClick={() => void pick("account", n)} />
          ))}
        </SettingsGroup>
      )}
      {hits.length > 0 && (
        <SettingsGroup>
          {hits.map(({ d, rows }) => (
            <SettingsRow key={d.id} label={d.label} sub={rowsHint(rows)}
              icon={tile(d)} onClick={() => void pick(d.id)} />
          ))}
        </SettingsGroup>
      )}
      {noMatch}
    </>) : (<>
      <SettingsGroup>
        {acctNames.map((n) => (
          <SettingsRow key={n} label={n}
            sub={`${cfg.accounts[n].user} · ${
              t(`settings.status.${statusOf(cfg.accounts[n])}`)}`}
            icon={<AccountAvatar name={n} size="md" />}
            onClick={() => void pick("account", n)} />
        ))}
        <SettingsRow label={<span className="text-accent">
          {t("account.add")}</span>} disabled={demo}
          icon={<IconTile tone="accent"><Plus size={16} /></IconTile>}
          onClick={() => void newAccount()} />
      </SettingsGroup>
      {groups.map((g) => (
        <SettingsGroup key={g.key}>
          {g.ids.map((id) => (
            <SettingsRow key={id} label={defs[id].label}
              value={defs[id].value} icon={tile(defs[id])}
              onClick={() => void pick(id)} />
          ))}
        </SettingsGroup>
      ))}
    </>)}
  </>);

  const title = open === "account" ? editAcct : open ? defs[open].label : "";
  const content = open && (
    <div key={open === "account" ? `account-${editAcct}` : open}>
      {bodies[open]}
    </div>
  );

  // Installed app: a drag from the left edge goes up from a section (the
  // back link's own handler). The save bar stays out of the sliding part.
  const phoneSlide = useRef<HTMLDivElement>(null);
  useEdgeBack(phoneSlide, () => onSection(null), !wide && !!open,
    () => !isModalOpen());

  const saveBar = dirty && (
    <SaveBar summary={badDecimal ? t("decimal.invalid") : summary.text}
      saving={saving} blocked={badDecimal} onRevert={revert}
      onSave={() => void save()} />
  );

  if (wide) {
    return (
      <div className="flex min-h-0 flex-1">
        {sectionColumn}
        <div className="flex min-w-0 flex-1 flex-col">
          <PageHeader contain="mx-auto max-w-3xl" title={title} />
          <div data-scroll-id="settings" className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-5 pb-28 pt-5">
              {content}
            </div>
          </div>
        </div>
        {saveBar}
      </div>
    );
  }
  return (
    <div className="pb-4">
      <div ref={phoneSlide}>
      {open ? (<>
        <PageHeader variant="large" flush title={title}
          back={{ label: t("Settings"), onClick: () => onSection(null) }} />
        {content}
      </>) : (<>
        <PageHeader variant="large" flush title={t("Settings")} />
        {rootList}
      </>)}
      </div>
      {saveBar}
    </div>
  );
}

/** The floating capsule while edits are staged: what changed, Revert, Save.
 *  Publishes its height like the selection bar (toasts and the tab bar make
 *  room). */
function SaveBar({ summary, saving, blocked = false, onRevert, onSave }: {
  summary: string; saving: boolean; blocked?: boolean; onRevert: () => void;
  onSave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useBulkBarHeight(ref, true);
  return (
    <div ref={ref} role="region" aria-label={t("settings.unsaved")}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-(--z-bulkbar)
        px-2 md:px-5 lg:left-126"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}>
      <div className="pointer-events-auto mx-auto flex w-fit max-w-full
        items-center gap-2 rounded-card border bar-glass py-1.5 pl-4 pr-1.5
        sm:rounded-full
        shadow-bar">
        <span aria-hidden className="size-2 shrink-0 rounded-full
          bg-accent" />
        <span role="status" className="min-w-0 type-meta max-sm:leading-tight sm:truncate md:type-body">
          {summary}
        </span>
        <Button variant="secondary" size="sm" onClick={onRevert}>
          {t("settings.revert")}
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving || blocked}>{t("Save")}</Button>
      </div>
    </div>
  );
}
