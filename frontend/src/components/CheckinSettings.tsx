import { useEffect, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import type { CheckinSettingsResp } from "../types";
import { SettingsGroup, SettingsRow, Switch, useOptionalToast } from "./ui";

/** Settings > Notifications, the last row: "Remind me of my weekly check-in",
 *  a push on Monday 09:00 when some place wants a look - no names, no
 *  subjects. Per user, like the push switch above it, and ON by default for
 *  everyone: it only ever reaches a device that has notifications on (without
 *  one there is nothing to send to, so the row says what it needs). Changed at
 *  once, not staged with the rest of the form. */
export function CheckinNotifySettings({ notificationsOn }: {
  notificationsOn: boolean;
}) {
  const [cfg, setCfg] = useState<CheckinSettingsResp | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useOptionalToast();

  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => api.checkinSettingsGet())
      .then((r) => live && setCfg(r), () => live && setCfg(null));
    return () => { live = false; };
  }, []);

  const change = async (push: boolean) => {
    setBusy(true);
    try { setCfg(await api.checkinSettings({ push })); }
    catch (e: any) {
      toast?.show(t("err.generic", { msg: e.message ?? e }),
        { variant: "error" });
    } finally { setBusy(false); }
  };

  return (
    <SettingsGroup>
      <SettingsRow label={t("checkin.notify_row")}
        sub={<>
          {t("checkin.notify_sub")}
          {!notificationsOn && <> {t("checkin.notify_needs")}</>}
        </>}>
        <Switch checked={!!cfg?.push} onChange={(on) => void change(on)}
          disabled={cfg === null || busy} />
      </SettingsRow>
    </SettingsGroup>
  );
}
