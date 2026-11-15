import { BellOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { t } from "../i18n";
import type { CopyTell } from "../types";
import { Avatar, Button, Checkbox, EmptyState, Loading, Notice } from "./ui";

/** Senders listed before "N more". */
const SHOWN = 8;

/** `text` with the `{address}` of a translation in bold: the translation is
 *  split at a marker so the word order stays the translator's. */
function withAddress(key: string, address: string): ReactNode {
  const MARK = "\u0001";
  const [pre, post = ""] = t(key, { address: MARK }).split(MARK);
  return <>{pre}<b className="font-semibold text-body">{address}</b>{post}</>;
}

/** Step 3 of "Move to another account": the senders that still wrote to the
 *  old address in the last 90 days, as a checklist (the ticks are kept per
 *  account pair); newsletters are not told - their senders go to the
 *  unsubscribe review of the old account instead. */
export function AccountCopyTell({ source, target, onReviewUnsubs }: {
  source: string; target: string;
  onReviewUnsubs: (account: string, keys: string[]) => void;
}) {
  const [data, setData] = useState<CopyTell | null>(null);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const load = useCallback(() => {
    setData(null);
    api.copyTell(source, target)
      .then((d) => alive.current && setData(d))
      .catch((e) => alive.current && setError(String(e.message ?? e)));
  }, [source, target]);
  useEffect(() => load(), [load]);

  const tick = async (addr: string, done: boolean) => {
    // the box answers at once; the server's list (with the new count) follows
    setData((d) => d && { ...d, done: d.done + (done ? 1 : -1),
      senders: d.senders.map((s) => s.addr === addr ? { ...s, done } : s) });
    try {
      const d = await api.copySetTold(source, target, addr, done);
      if (alive.current) setData(d);
    } catch (e: any) {
      if (alive.current) { setError(String(e.message ?? e)); load(); }
    }
  };

  if (error) return <Notice tone="danger" role="alert">{error}</Notice>;
  if (!data) return <Loading />;
  const oldAddress = data.source.address || source;
  const shown = all ? data.senders : data.senders.slice(0, SHOWN);
  const more = data.total - shown.length;
  return (
    <div className="max-w-2xl space-y-4">
      <p className="type-body text-muted">
        {withAddress("copy.tell_intro", oldAddress)}</p>
      {data.senders.length === 0 ? (
        <EmptyState title={t("copy.tell_none", { address: oldAddress })} />
      ) : (
        <section className="overflow-hidden rounded-card border border-line
          bg-panel">
          <ul className="divide-y divide-line">
            {shown.map((s) => (
              <li key={s.addr}>
                <Checkbox round checked={s.done}
                  aria-label={t("copy.tell_check", { name: s.name || s.addr })}
                  onChange={(e) => void tick(s.addr, e.target.checked)}
                  className="w-full px-3 py-1.5"
                  label={
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={s.name || s.addr} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate type-body-mobile
                          md:type-body ${s.done ? "text-muted line-through"
                          : ""}`}>{s.name || s.addr}</span>
                        <span className="block truncate type-meta
                          text-muted">{s.addr}</span>
                      </span>
                    </span>} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-x-2 border-t
            border-line px-3 py-2 type-meta text-muted">
            <span>{t("copy.tell_done",
              { done: data.done, total: data.total })}</span>
            {more > 0 && (
              <button type="button" onClick={() => setAll(true)}
                className="cursor-pointer text-accent hover:underline
                  coarse:min-h-11">{"· "}{t("copy.tell_more", { n: more })}
              </button>
            )}
            {all && data.total > SHOWN && (
              <button type="button" onClick={() => setAll(false)}
                className="cursor-pointer text-accent hover:underline
                  coarse:min-h-11">{t("copy.tell_fewer")}</button>
            )}
          </div>
        </section>
      )}
      {data.newsletters > 0 && (
        <section className="rounded-card border border-line bg-panel p-4">
          <div className="flex items-center gap-2 type-heading">
            <BellOff size={16} aria-hidden className="text-muted" />
            {t("copy.news_title", { n: data.newsletters })}
          </div>
          <p className="mt-1 type-body text-muted">{t("copy.news_text")}</p>
          <Button variant="tinted" className="mt-3"
            onClick={() => onReviewUnsubs(source, data.newsletter_keys)}>
            {t("copy.news_review", { n: data.newsletters })}</Button>
        </section>
      )}
    </div>
  );
}
