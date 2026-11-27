import { useEffect, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { Button, SettingsGroup, SettingsRow, Switch, useOptionalToast }
  from "./ui";

/** Settings > General, the last rows: the switch of "You keep doing this"
 *  (staged with the rest of the form by the page: `on` / `onChange`) and the
 *  senders the user said "Not this one" to, with Show to bring them back (at
 *  once, not staged). The list is the active account's. */
export function HabitsSettings({ account, on, onChange, onShown }: {
  account: string; on: boolean; onChange: (on: boolean) => void;
  /** After Show: the suggestions are fetched again. */
  onShown?: () => void;
}) {
  const [hidden, setHidden] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useOptionalToast();
  useEffect(() => {
    let live = true;
    setHidden(null);
    Promise.resolve().then(() => api.habits(account))
      .then((r) => live && setHidden(r.hidden), () => live && setHidden(0));
    return () => { live = false; };
  }, [account]);
  const show = async () => {
    setBusy(true);
    try {
      await api.habitsShow(account);
      setHidden(0);
      toast?.show(t("habit.set.shown"));
      onShown?.();
    } catch (e: any) {
      toast?.show(t("err.generic", { msg: e.message ?? e }),
        { variant: "error" });
    } finally { setBusy(false); }
  };
  return (
    <SettingsGroup>
      <SettingsRow label={t("habit.set.row")} sub={t("habit.set.sub")}>
        <Switch checked={on} onChange={onChange} />
      </SettingsRow>
      <SettingsRow label={t("habit.set.hidden")}
        sub={hidden ? t("habit.set.hidden_n", { n: hidden })
          : t("habit.set.none")}>
        {!!hidden && (
          <Button variant="tinted" size="sm" disabled={busy}
            onClick={() => void show()}>{t("habit.set.show")}</Button>
        )}
      </SettingsRow>
    </SettingsGroup>
  );
}
