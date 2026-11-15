import { useEffect, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { confirmDialog, SettingsGroup, SettingsRow, Switch,
  useOptionalToast } from "./ui";

/** Settings > General: the opt-in of Insights > Subscriptions to read the
 *  text of the LATEST receipt of a subscription whose subject has no amount.
 *  It runs on this server through the existing local mail fetch, keeps only
 *  the amount and its currency and sends nothing anywhere. Off by default;
 *  takes effect at once (not staged with the rest of the form); switching it
 *  off forgets the amounts it found. */
export function SubscriptionsSettings({ account }: { account: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useOptionalToast();

  useEffect(() => {
    let live = true;
    setOn(null);
    Promise.resolve().then(() => api.subscriptionSettingsGet(account))
      .then((r) => live && setOn(r.body_amounts), () => live && setOn(false));
    return () => { live = false; };
  }, [account]);

  const change = async (next: boolean) => {
    if (next && !await confirmDialog({
      title: t("sub.find_amounts"),
      bullets: [t("sub.find_confirm_read"), t("sub.find_confirm_keep"),
        t("sub.find_confirm_off")],
      confirmLabel: t("sub.find_amounts_confirm"),
    })) return;
    setBusy(true);
    try {
      await api.subscriptionSettings(next, account);
      setOn(next);
    } catch (e: any) {
      toast?.show(t("err.generic", { msg: e.message ?? e }),
        { variant: "error" });
    } finally { setBusy(false); }
  };

  return (
    <SettingsGroup header={t("sub.settings_title")}>
      <SettingsRow label={t("sub.settings_row")} sub={t("sub.settings_sub")}>
        <Switch checked={!!on} onChange={(v) => void change(v)}
          disabled={on === null || busy} />
      </SettingsRow>
    </SettingsGroup>
  );
}
