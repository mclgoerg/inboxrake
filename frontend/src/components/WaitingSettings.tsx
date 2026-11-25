import { useEffect, useState } from "react";
import { api } from "../api";
import { useCoarsePointer } from "../gestures";
import { t } from "../i18n";
import { Segmented, SettingsGroup, SettingsRow, Switch,
  useOptionalToast } from "./ui";

/** Settings > Account > Folders: "Track mails waiting for a reply" (default
 *  on) and how long a mail waits before it counts. Per account; takes effect
 *  at once (not staged with the rest of the form). Off: the scan reads
 *  nothing extra from the Sent folder and the index of it is dropped. */
export function WaitingSettings({ account }: { account: string }) {
  const [cfg, setCfg] = useState<{ track: boolean; days: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useOptionalToast();
  const coarse = useCoarsePointer();

  useEffect(() => {
    let live = true;
    setCfg(null);
    Promise.resolve().then(() => api.waitingSettingsGet(account))
      .then((r) => live && setCfg(r), () => live && setCfg(null));
    return () => { live = false; };
  }, [account]);

  const change = async (patch: { track?: boolean; days?: number }) => {
    setBusy(true);
    try { setCfg(await api.waitingSettings(patch, account)); }
    catch (e: any) {
      toast?.show(t("err.generic", { msg: e.message ?? e }),
        { variant: "error" });
    } finally { setBusy(false); }
  };

  return (
    <SettingsGroup header={t("waiting.settings_title")}>
      <SettingsRow label={t("waiting.settings_track")}
        sub={t("waiting.settings_track_sub")}>
        <Switch checked={!!cfg?.track}
          onChange={(on) => void change({ track: on })}
          disabled={cfg === null || busy} />
      </SettingsRow>
      <SettingsRow label={t("waiting.settings_days")}
        sub={t("waiting.settings_days_sub")}>
        <Segmented role="radio" label={t("waiting.settings_days")} tall={coarse}
          value={cfg ? String(cfg.days) : null}
          onChange={(v) => void change({ days: Number(v) })}
          options={[2, 3, 7].map((n) => ({
            value: String(n), label: t("settings.n_days", { n }),
            disabled: cfg === null || busy || !cfg.track }))} />
      </SettingsRow>
    </SettingsGroup>
  );
}
