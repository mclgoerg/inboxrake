import { useEffect, useState } from "react";
import { api } from "../api";
import { useCoarsePointer } from "../gestures";
import { t } from "../i18n";
import type { WaitingSettingsResp } from "../types";
import { Segmented, SettingsGroup, SettingsRow, Switch,
  useOptionalToast } from "./ui";

/** The settings of Waiting for a reply as one hook: read once, changed at
 *  once (not staged with the rest of a form). */
function useWaitingSettings(account?: string) {
  const [cfg, setCfg] = useState<WaitingSettingsResp | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useOptionalToast();

  useEffect(() => {
    let live = true;
    setCfg(null);
    Promise.resolve().then(() => api.waitingSettingsGet(account))
      .then((r) => live && setCfg(r), () => live && setCfg(null));
    return () => { live = false; };
  }, [account]);

  const change = async (patch: Partial<WaitingSettingsResp>) => {
    setBusy(true);
    try { setCfg(await api.waitingSettings(patch, account)); return true; }
    catch (e: any) {
      toast?.show(t("err.generic", { msg: e.message ?? e }),
        { variant: "error" });
      return false;
    } finally { setBusy(false); }
  };
  return { cfg, busy, change };
}

/** Settings > Account > Sent mail: "Watch my sent mail for replies" (default
 *  OFF), per account. Off: the scan reads nothing extra from the Sent folder
 *  and the index of it is dropped. `onChanged` tells the app (the Overview
 *  row and the phone card follow the switch). */
export function WaitingSettings({ account, onChanged }: {
  account: string; onChanged?: () => void;
}) {
  const { cfg, busy, change } = useWaitingSettings(account);
  return (
    <SettingsGroup header={t("waiting.settings_title")}>
      <SettingsRow label={t("waiting.settings_watch")}
        sub={t("waiting.settings_watch_sub")}>
        <Switch checked={!!cfg?.watch}
          onChange={(on) => void change({ watch: on })
            .then((ok) => ok && onChanged?.())}
          disabled={cfg === null || busy} />
      </SettingsRow>
    </SettingsGroup>
  );
}

/** Settings > Notifications, under today's two rows: when and how a push
 *  tells you a reply is overdue. Per user (the push switch above is, too);
 *  "Tell me" needs that switch and says so while it is off. */
export function WaitingNotifySettings({ notificationsOn, onChanged }: {
  notificationsOn: boolean; onChanged?: () => void;
}) {
  const { cfg, busy, change } = useWaitingSettings();
  const coarse = useCoarsePointer();
  const off = cfg === null || busy;
  const set = (patch: Partial<WaitingSettingsResp>) =>
    void change(patch).then((ok) => ok && onChanged?.());
  return (
    <SettingsGroup header={t("waiting.notify_title")}>
      <SettingsRow label={t("waiting.notify_tell")}
        sub={<>
          {t("waiting.notify_tell_sub")}
          {!notificationsOn && <> {t("waiting.notify_needs")}</>}
        </>}>
        <Switch checked={!!cfg?.notify && notificationsOn}
          onChange={(on) => set({ notify: on })}
          disabled={off || !notificationsOn} />
      </SettingsRow>
      <SettingsRow label={t("waiting.after")} sub={t("waiting.after_sub")}>
        <Segmented role="radio" label={t("waiting.after")} tall={coarse}
          value={cfg?.mode ?? null} onChange={(v) => set({ mode: v })}
          options={[
            { value: "usual" as const, label: t("waiting.after_usual"),
              disabled: off },
            { value: "fixed" as const, label: t("waiting.after_fixed"),
              disabled: off }]} />
      </SettingsRow>
      <SettingsRow label={t("waiting.days")} sub={t("waiting.days_sub")}>
        <Segmented role="radio" label={t("waiting.days")} tall={coarse}
          value={cfg ? String(cfg.days) : null}
          onChange={(v) => set({ days: Number(v) })}
          options={[2, 3, 7].map((n) => ({
            value: String(n), label: t("settings.n_days", { n }),
            disabled: off }))} />
      </SettingsRow>
      <SettingsRow label={t("waiting.subject")}
        sub={t("waiting.subject_sub")}>
        <Switch checked={!!cfg?.subject}
          onChange={(on) => set({ subject: on })} disabled={off} />
      </SettingsRow>
    </SettingsGroup>
  );
}
