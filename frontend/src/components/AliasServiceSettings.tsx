import { Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "../api";
import { t } from "../i18n";
import type { AliasServiceStatus } from "../types";
import { Button, confirmDialog, DemoFieldset, Input, Loading, Notice, Segmented,
  SettingsGroup, SettingsRow, Tag } from "./ui";

/** Settings > Alias service: optional link to SimpleLogin or addy.io so
 *  Your addresses can switch an alias off. Not staged with the form: choosing
 *  the service, setting the key and disconnecting act at once (the key goes
 *  to the server and never comes back - "•••• set · Change…"). */
export function AliasServiceSection() {
  const [st, setSt] = useState<AliasServiceStatus | null>(null);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.aliasService()
    .then((s) => { setSt(s); setError(""); })
    .catch((e) => setError(String(e?.message ?? e))), []);
  useEffect(() => { void load(); }, [load]);

  const run = async (job: () => Promise<AliasServiceStatus | void>) => {
    setBusy(true);
    setError("");
    try {
      const next = await job();
      if (next) setSt(next); else await load();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
    setBusy(false);
  };

  if (!st) return error
    ? <Notice tone="danger" role="alert">{error}</Notice> : <Loading />;

  const service = st.service || null;
  const connection = st.error
    ? <Tag tone="keep">{errorText(st.error)}</Tag>
    : st.aliases != null
      ? <Tag tone="safe" className="inline-flex items-center gap-1">
        <Check size={14} aria-hidden />{t("alias.found", { n: st.aliases })}
      </Tag>
      : <Tag>{t("alias.not_connected")}</Tag>;
  const asking = !st.key_set || changing;

  return (
    <DemoFieldset>
      {error && <Notice tone="danger" role="alert" className="mb-3">
        {error}</Notice>}
      <SettingsGroup footnote={t("alias.footnote")}>
        <SettingsRow label={t("alias.service")}
          sub={t("alias.service_sub")}>
          <Segmented<"simplelogin" | "addy"> role="radio"
            label={t("alias.service_label")} value={service}
            onChange={async (v) => {
              if (v === service) return;
              // another service forgets the key (and the alias list) of this one
              if (st.key_set && !await confirmDialog({
                title: t("alias.switch_title", { name: t(`alias.${v}`) }),
                body: t("alias.switch_body", { name: t(`alias.${service}`) }),
                tone: "danger", confirmLabel: t("alias.switch_btn") })) return;
              void run(() => api.aliasServicePut(v));
            }}
            options={[{ value: "simplelogin", label: t("alias.simplelogin") },
              { value: "addy", label: t("alias.addy") }]} />
        </SettingsRow>
        {asking ? (
          <SettingsRow stack label={t("alias.api_key")}>
            <form className="flex flex-wrap gap-2" onSubmit={(e) => {
              e.preventDefault();
              if (!service || !key.trim()) return;
              void run(async () => {
                const next = await api.aliasServicePut(service, key.trim());
                setKey("");
                setChanging(false);
                return next;
              });
            }}>
              <Input type="password" autoComplete="off" value={key}
                aria-label={t("alias.api_key")} disabled={!service || busy}
                placeholder={t("alias.key_placeholder")}
                className="min-w-0 flex-1" onChange={(e) => setKey(e.target.value)} />
              <Button type="submit" disabled={!service || !key.trim() || busy}>
                {t("alias.key_connect")}
              </Button>
              {changing && (
                <Button type="button" variant="secondary" disabled={busy}
                  onClick={() => { setChanging(false); setKey(""); }}>
                  {t("alias.key_cancel")}
                </Button>
              )}
            </form>
          </SettingsRow>
        ) : (
          <SettingsRow label={t("alias.api_key")} value={t("alias.key_set")}>
            <Button variant="secondary" size="sm" disabled={busy}
              onClick={() => setChanging(true)}>
              {t("alias.key_change")}
            </Button>
          </SettingsRow>
        )}
        <SettingsRow label={t("alias.connection")}>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {connection}
            {st.key_set && (
              <Button variant="secondary" size="sm" disabled={busy}
                onClick={() => void run(() => api.aliasServiceRefresh())}>
                {t("alias.check")}
              </Button>
            )}
          </div>
        </SettingsRow>
      </SettingsGroup>
      {st.key_set && (
        <Button variant="danger-quiet" disabled={busy} onClick={async () => {
          if (!await confirmDialog({
            title: t("alias.disconnect_title"),
            body: t("alias.disconnect_body"), tone: "danger",
            confirmLabel: t("alias.disconnect") })) return;
          void run(async () => { await api.aliasServiceDisconnect(); });
        }}>{t("alias.disconnect")}</Button>
      )}
    </DemoFieldset>
  );
}
