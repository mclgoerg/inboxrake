import { Check, ChevronRight, Plus, ScrollText, Settings as SettingsIcon, Star,
  Power } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../i18n";
import { fmtAgo, fmtSize } from "../lib";
import type { AccountSummary, Config } from "../types";
import { demoHint } from "../demoMode";
import { statusOf, StatusDot } from "./SettingsPage";
import { AccountAvatar, IconTile, Meta, Segmented } from "./ui";

type Appearance = "system" | "light" | "dark";

/** The account menu's body: one card per account (avatar, name, address,
 *  status dot, sign-in state + last scan + mails and size), Add account,
 *  Appearance, Settings / Activity rows and the version. The same markup sits
 *  in the desktop popover (`menu`: role=menu items, arrows move) and in the
 *  phone sheet. A card of an account whose sign-in is broken leads to THAT
 *  account's settings (`onFix`) instead of switching to it. */
export function AccountSwitcher({ menu, cfg, account, summary, appearance,
  onAppearance, onSwitch, onFix, onAdd, onSettings, onActivity, onLogout,
  identity, admin, demo, version }: {
  /** Inside a `Menu` popover (items need the menu roles). */
  menu: boolean;
  cfg: Config;
  account: string;
  /** Last scan per account (`/api/accounts/summary`); absent until loaded. */
  summary: Record<string, AccountSummary> | null;
  appearance: Appearance;
  onAppearance: (a: Appearance) => void;
  onSwitch: (name: string) => void;
  onFix: (name: string) => void;
  onAdd: () => void;
  onSettings: () => void;
  onActivity: () => void;
  /** Present only when a sign-in is configured. */
  onLogout?: () => void;
  /** The signed-in identity (SSO) shown above the cards. */
  identity?: string;
  admin?: boolean;
  demo?: boolean;
  version?: string;
}) {
  const row = (label: ReactNode, icon: ReactNode, onClick: () => void,
    chevron = true) => (
    <button type="button" role={menu ? "menuitem" : undefined}
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-3 px-3 text-left
        type-body enabled:hover:bg-panel2">
      <IconTile>{icon}</IconTile>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {chevron && <ChevronRight size={16} aria-hidden
        className="shrink-0 text-faint" />}
    </button>
  );
  return (
    <div className={`flex flex-col gap-3 p-2 ${menu ? "w-80" : "w-full"}`}>
      {identity && (
        <div className="truncate px-1 type-meta text-muted">
          {identity}
          {admin && (
            <span className="inline-flex items-center gap-1">
              {" "}<Star size={14} aria-hidden /> {t("login.admin_tip")}
            </span>
          )}
        </div>
      )}
      <div role="group" aria-label={t("menu.accounts")}
        className="flex flex-col gap-2">
        {Object.entries(cfg.accounts).map(([name, im]) => {
          const status = statusOf(im);
          const broken = status !== "ok";
          const active = name === account;
          const sum = summary?.[name];
          // Each bit stays whole on a wrapped line ("227.4 MB" never sits
          // alone), see `Meta`.
          const done = sum?.scanned_ts && sum.status !== "scanning";
          const bits = [
            t(`settings.status.${status}`),
            sum?.status === "scanning" ? t("account.scan_running")
              : sum?.scanned_ts ? t("scan.age", { ago: fmtAgo(sum.scanned_ts) })
              : sum ? t("account.never_scanned") : "",
            done ? t("n.mails", { n: sum.mails }) : "",
            done ? fmtSize(sum.size) : "",
          ];
          return (
            <div key={name} className={`rounded-card border bg-panel
              ${active ? "border-accent" : "border-line"}`}>
              <button type="button"
                role={menu ? "menuitemradio" : undefined}
                aria-checked={menu ? active : undefined}
                aria-current={!menu && active ? "true" : undefined}
                onClick={() => !active && onSwitch(name)}
                className="flex min-h-11 w-full items-center gap-3
                  rounded-card p-3 text-left enabled:hover:bg-panel2">
                <AccountAvatar name={name} size="md" className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 type-body
                    font-medium">
                    <span className="truncate">{name}</span>
                    <StatusDot status={status} />
                  </span>
                  <span className="block truncate type-meta text-muted">
                    {im.user}
                  </span>
                  {!broken && (
                    <Meta items={bits}
                      className="block type-meta text-muted" />
                  )}
                </span>
                {active ? <Check size={16} aria-hidden className="text-accent" />
                  : <ChevronRight size={16} aria-hidden
                    className="shrink-0 text-faint" />}
              </button>
              {broken && (
                // Its own control: the card still switches on tap.
                <button type="button" role={menu ? "menuitem" : undefined}
                  onClick={() => onFix(name)}
                  className="mx-3 mb-2 min-h-9 text-left type-meta
                    text-danger-fg underline-offset-2 hover:underline
                    coarse:min-h-11">
                  {t(status === "check" ? "menu.signin_failed"
                    : "menu.signin_missing")}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" role={menu ? "menuitem" : undefined}
        disabled={demo} onClick={onAdd}
        className="flex min-h-11 w-full flex-col items-center justify-center
          rounded-card border border-line type-body font-medium text-accent
          enabled:hover:bg-panel2 disabled:cursor-not-allowed
          disabled:text-faint">
        <span className="inline-flex items-center gap-1.5">
          <Plus size={16} aria-hidden />{t("account.add")}
        </span>
        {demo && <span className="type-meta font-normal">{demoHint()}</span>}
      </button>
      {/* A click in the popover closes it; the theme switch stays open to
          show the change (the cards above leave on purpose). */}
      <div onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 px-1 type-caption font-semibold uppercase
          tracking-wide text-muted">{t("Appearance")}</div>
        <Segmented<Appearance> role="radio" fill equal tall
          label={t("Appearance")} value={appearance} onChange={onAppearance}
          options={(["system", "light", "dark"] as const).map((a) => ({
            value: a, label: t(`appearance.${a}`) }))} />
      </div>
      <div className="divide-y divide-line overflow-hidden rounded-card
        border border-line bg-panel">
        {row(t("Settings"), <SettingsIcon size={16} />, onSettings)}
        {row(t("nav.activity"), <ScrollText size={16} />, onActivity)}
        {onLogout && row(t("login.logout"), <Power size={16} />, onLogout,
          false)}
      </div>
      {version && (
        <div className="text-center type-meta text-muted">{version}</div>
      )}
    </div>
  );
}
