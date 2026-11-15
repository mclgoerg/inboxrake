import { CircleAlert, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import type { AssistantLevel, ConnectRequest } from "../types";
import { Avatar, Button, Notice, Spinner } from "./ui";
import { type Choices, choiceErrors, expiryDays, expiryOf, TokenChoices }
  from "./TokenChoices";

/* `#/connect`: where a hosted AI app (claude.ai, ChatGPT) asks to be let in.
 * `/oauth/authorize` sent the browser here after sign-in; the server holds the
 * request (a cookie names it). A full page with no app shell: what the user
 * sees is who asks (the host of its `client_id`, large; the name it gives
 * itself is only its claim), where they go back to, and what it may do.
 * Neither button takes focus, so a stray Enter or Space decides nothing.
 * Refusals that cannot name a safe place to go back to are shown here; the
 * server answers the others with a redirect URL we follow at once. */

const LEVELS: AssistantLevel[] = ["read", "propose", "act"];
/** Answers that mean the request itself is gone: no retry on this page. */
const DEAD = ["connect_request_gone", "connect_request_mismatch"];

type View =
  | { kind: "loading" }
  | { kind: "ask"; req: ConnectRequest }
  | { kind: "error"; text: string }
  | { kind: "leaving"; host: string };

const toChoices = (r: ConnectRequest): Choices => ({
  name: r.defaults.name, accounts: new Set(r.accounts),
  level: r.defaults.level, subjects: r.defaults.subjects,
  expiry: expiryOf(r.defaults.expires_days), daily: r.defaults.daily_cap });

export function ConnectPage({ onLeave, navigate = (url) =>
  window.location.assign(url) }: {
  /** Back to the app (the page's own exit when the request is dead). */
  onLeave: () => void;
  /** Where the browser goes next: the app's redirect URI. */
  navigate?: (url: string) => void;
}) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [choices, setChoices] = useState<Choices | null>(null);
  const [touched, setTouched] = useState(false);
  const [nameTaken, setNameTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(false);

  // The request is read once: a redirect answer ends it on the server.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.assistantConnect().then((r) => {
      if ("redirect_url" in r) {
        setView({ kind: "leaving", host: hostOf(r.redirect_url) });
        navigate(r.redirect_url);
        return;
      }
      setChoices(toChoices(r));
      setView({ kind: "ask", req: r });
    }).catch((e) => setView({ kind: "error", text: failText(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (req: ConnectRequest, approve: boolean) => {
    if (busy || !choices) return;
    if (approve) {
      setTouched(true);
      const bad = choiceErrors(choices);
      if (bad.name || bad.accounts) return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api.assistantConnectDecide(approve ? {
        request_id: req.request_id, approve: true, name: choices.name.trim(),
        accounts: req.accounts.filter((a) => choices.accounts.has(a)),
        level: choices.level, subjects: choices.subjects,
        expires_days: expiryDays(choices.expiry),
        ...(choices.level === "act" ? { daily_cap: choices.daily } : {}),
      } : { request_id: req.request_id, approve: false });
      setView({ kind: "leaving", host: req.client.redirect_host });
      navigate(r.redirect_url);
    } catch (e: any) {
      if (e?.code && DEAD.includes(e.code)) {
        setView({ kind: "error", text: failText(e) });
      } else if (e?.code === "name_taken") setNameTaken(true);
      else setError(failText(e));
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <main aria-labelledby="connect-title"
      className="flex h-dvh justify-center overflow-y-auto bg-surface px-4
        py-8 pt-[max(2rem,env(safe-area-inset-top))]
        pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
      {/* `my-auto` centres a short card and still lets a tall one scroll */}
      <div className="my-auto w-full max-w-lg sm:rounded-dialog sm:border
        sm:border-line sm:bg-panel sm:p-8 sm:shadow-popover">
        {children}
      </div>
    </main>
  );

  if (view.kind === "loading" || view.kind === "leaving") {
    return shell(
      <div role="status" className="flex flex-col items-center gap-3
        py-10 text-center">
        <Spinner size="lg" />
        <h1 id="connect-title" className="type-body text-muted">
          {view.kind === "leaving"
            ? t("connect.leaving", { host: view.host })
            : t("connect.loading")}
        </h1>
      </div>);
  }

  if (view.kind === "error") {
    return shell(
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span aria-hidden className="text-keep-fg">
            <CircleAlert size={18} /></span>
          <h1 id="connect-title" className="type-title2">
            {t("connect.err.title")}</h1>
        </div>
        <Notice role="alert" tone="danger">{view.text}</Notice>
        <p className="type-meta text-muted">{t("connect.err.hint")}</p>
        <Button variant="secondary" className="w-full" onClick={onLeave}>
          {t("connect.err.leave")}
        </Button>
      </div>);
  }

  const { req } = view;
  const c = choices!;
  const cn = req.client;
  return shell(
    <div className="space-y-5">
      <header className="flex flex-col items-start gap-3">
        <Avatar name={cn.host} size="lg" />
        <h1 id="connect-title">
          {/* the host the request was made from: the one fact we can vouch
              for; the app's own name is only what it says about itself */}
          <span className="block break-all type-largetitle">{cn.host}</span>
          <span className="block type-body text-muted">
            {t("connect.wants")}</span>
        </h1>
        {cn.name && cn.name !== cn.host && (
          <p className="type-meta text-muted">
            {t("connect.calls_itself", { name: cn.name })}</p>
        )}
      </header>
      <Notice tone="warn" icon={<Info size={16} aria-hidden />}>
        {t("connect.notice")}
      </Notice>
      <p className="type-body">
        {t("connect.back_to", { host: cn.redirect_host })}
      </p>
      <form noValidate className="space-y-4"
        onSubmit={(e) => { e.preventDefault(); void decide(req, true); }}>
        <TokenChoices value={c} onChange={(n) => {
          setNameTaken(false);
          setChoices(n);
        }} accounts={req.accounts} levels={LEVELS} ceiling={req.ceiling}
        touched={touched} nameTaken={nameTaken}
        capNote={t("connect.above_ceiling")} />
        {error && (
          <p role="alert" className="type-meta text-danger-fg">{error}</p>
        )}
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4
          sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={busy}
            onClick={() => void decide(req, false)}>
            {t("connect.deny")}
          </Button>
          <Button type="submit" disabled={busy}>
            {t("connect.allow")}
          </Button>
        </div>
      </form>
    </div>);
}

/** The host a redirect URL leads to ("" when it is not a URL). */
function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

/** A refusal in words: a coded one is already translated by the api layer;
 *  anything else (a server without OAuth answers a bare 404) is "unavailable". */
function failText(e: any): string {
  return e?.code ? String(e.message) : t("connect.err.unavailable");
}
