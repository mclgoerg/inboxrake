import { CircleAlert, CloudOff, Eye, EyeOff, KeyRound, MailWarning, Timer }
  from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import { t } from "../i18n";
import type { AuthMode } from "../types";
import { Button, Input, LINK_ACCENT, Notice, Spinner } from "./ui";

/** The short "how do I get back in" section of the FAQ (docs/faq.md). */
const RESET_DOCS_URL = "https://inboxrake.com/docs/faq/#forgot-the-password";

type LoginError = { text: string; tone: "danger" | "warn"; code?: string };

/** What the SSO legs (backend/main.py `_login_refused`) put in
 *  `?login_error=`. Anything else - an older server, a hand-made link - gets
 *  the generic text. */
const SSO_REFUSALS = ["email_unverified", "sso_rejected", "sso_not_allowed",
  "sso_no_admin", "sso_expired"];

function ssoRefusal(code: string): LoginError {
  if (code === "idp_unavailable")
    return { text: errorText(code), tone: "warn", code };
  if (code === "login_sso_off")
    return { text: errorText(code), tone: "danger", code };
  return {
    text: t(SSO_REFUSALS.includes(code) ? `login.err.${code}`
      : "login.err.generic"),
    tone: "danger", code,
  };
}

const ICON = {
  login_throttled: Timer,
  idp_unavailable: CloudOff,
  email_unverified: MailWarning,
} as Record<string, typeof CircleAlert>;

/** Full-page gate shown while the API demands a login. */
export function Login({ mode, idpHost, onLogin }: {
  mode: AuthMode;
  /** SSO: the identity provider's host, shown under the button. */
  idpHost?: string;
  onLogin: () => void;
}) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<LoginError | null>(() => {
    const code = new URLSearchParams(window.location.search).get("login_error");
    return code ? ssoRefusal(code) : null;
  });
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("login_error")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onLogin();
    } catch (err: any) {
      // A coded refusal (api.ts sets `code`) is worded in the user's
      // language; plain text (an offline server, a proxy's error page) is not.
      setError(err?.code
        ? { text: String(err.message), tone: err.code === "login_throttled"
              ? "warn" : "danger", code: err.code }
        : { text: t("login.err.generic"), tone: "danger" });
      setBusy(false);
      field.current?.focus();
    }
  };

  const invalid = error !== null && mode === "password";
  const Icon = (error?.code && ICON[error.code]) || CircleAlert;
  const notice = error && (
    <Notice id="login-error" role="alert" tone={error.tone}
      icon={<Icon size={16} aria-hidden />}>
      {error.text}
    </Notice>
  );

  return (
    <main aria-labelledby="login-title"
      className="flex min-h-dvh items-center justify-center bg-surface px-6
        py-10 pt-[max(2.5rem,env(safe-area-inset-top))]
        pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-100 sm:rounded-dialog sm:border
        sm:border-line sm:bg-panel sm:p-8 sm:shadow-popover">
        <div className="flex flex-col items-center text-center">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width="56"
            height="56" className="mb-4 shrink-0 rounded-card" />
          <h1 id="login-title" className="type-largetitle">
            {t("login.title")}</h1>
          <p className="mt-1 type-meta text-muted">{window.location.host}</p>
        </div>
        {mode === "password" && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="login-password"
                className="mb-1 block type-meta font-medium text-body">
                {t("Password")}
              </label>
              <div className="relative">
                <Input id="login-password" ref={field} className="w-full pr-11
                  aria-invalid:border-danger-fg aria-invalid:focus:border-danger-fg
                  aria-invalid:outline-danger-fg"
                  type={show ? "text" : "password"} autoFocus
                  autoComplete="current-password"
                  value={password}
                  aria-invalid={invalid ? true : undefined}
                  aria-describedby={invalid ? "login-error" : undefined}
                  onChange={(e) => setPassword(e.target.value)} />
                <Button type="button" variant="quiet" size="icon"
                  label={t("login.show_password")} aria-pressed={show}
                  className="absolute inset-y-0 right-0 text-muted after:absolute
                    after:content-[''] coarse:after:-inset-0.5"
                  onClick={() => setShow(!show)}>
                  {show ? <EyeOff size={18} aria-hidden />
                    : <Eye size={18} aria-hidden />}
                </Button>
              </div>
            </div>
            {notice}
            <Button className="w-full" disabled={busy || !password}>
              {busy ? <Spinner size="sm" className="text-on-accent" />
                : t("login.submit")}
            </Button>
          </form>
        )}
        {mode === "oidc" && (
          <div className="mt-6 space-y-4">
            {notice}
            <div>
              <a href="/api/oidc/login"
                className="flex min-h-11 items-center justify-center gap-2
                  rounded-control bg-accent px-3 py-2 type-body font-medium
                  text-on-accent hover:bg-accenth">
                <KeyRound size={16} aria-hidden />
                {t("login.sso")}
              </a>
              {idpHost && (
                <p className="mt-2 text-center type-meta text-muted">
                  {idpHost}</p>
              )}
            </div>
          </div>
        )}
        <p className="mt-6 text-center type-meta text-muted">
          {mode === "password" && <>{t("login.forgot")}{" "}</>}
          <a href={RESET_DOCS_URL} target="_blank" rel="noopener noreferrer"
            className={LINK_ACCENT}>
            {t(mode === "password" ? "login.forgot_link" : "login.trouble")}
          </a>
        </p>
      </div>
    </main>
  );
}
