import { useCallback, useEffect, useId, useRef, useState } from "react";
import { localIso } from "../activity";
import { api } from "../api";
import { getLang, t } from "../i18n";
import { fmtDate, fmtSizeGb as fmtSize } from "../lib";
import { fmtPct } from "../numfmt";

import type { BodySearchMode, IndexEstimate, IndexInfo } from "../types";
import { Button, confirmDialog, ProgressBar, Spinner } from "./ui";

/** The "how the index works" note under the index: one short line and the
 *  long technical text behind a disclosure. */
export function IndexNote() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="block">
      {t("index.short")}{" "}
      <button type="button" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(!open)}
        className="cursor-pointer text-accent underline
          underline-offset-2">
        {t("index.how")}
      </button>
      {open && <span id={id} className="mt-1 block">
        {t("body_search.local_help")}</span>}
    </span>
  );
}

/** Settings -> mail-text search = "local index": status of the account's
 *  keyed word index plus build / update / rebuild / cancel / delete. The
 *  panel talks to the SAVED configuration: the mode has to be saved as
 *  "local" before an index can be built. */
export function IndexPanel({ account, savedMode, secretKeySet }: {
  account: string;
  savedMode: BodySearchMode;
  secretKeySet: boolean;
}) {
  const [info, setInfo] = useState<IndexInfo | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  // Nothing to ask the server about until the mode is saved as "local".
  const enabled = secretKeySet && savedMode === "local";

  const load = useCallback(() => {
    if (!enabled) return;
    api.indexInfo(account)
      .then((i) => alive.current && setInfo(i))
      .catch((e) => alive.current && setError(String(e.message ?? e)));
  }, [account, enabled]);

  useEffect(() => {
    alive.current = true;
    setInfo(null);
    load();
    return () => { alive.current = false; };
  }, [load]);

  // Follow a running job.
  const running = info?.job.status === "running";
  useEffect(() => {
    if (!running) return;
    const h = setInterval(load, 1500);
    return () => clearInterval(h);
  }, [running, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError("");
    try { await fn(); } catch (e: any) { setError(String(e.message ?? e)); }
    load();
  };

  const params = (est: IndexEstimate) => ({
    n: est.mails, size: fmtSize(est.bytes), max: fmtSize(est.bytes_max),
    free: fmtSize(est.free) });
  const tight = (est: IndexEstimate) =>
    est.free > 0 && est.bytes_max > est.free * 0.9;

  const build = async (rebuild: boolean) => {
    const est = rebuild ? info!.estimate_full : info!.estimate;
    // Nothing to read (e.g. an up-to-date index): nothing to consent to.
    if (est.mails > 0 && !await confirmDialog({
      title: t(!info!.usable ? "index.build"
        : rebuild ? "index.rebuild" : "index.update"),
      bullets: [
        t("index.confirm_read", params(est)),
        t("index.confirm_disk", params(est)),
        t("index.confirm_time"),
        ...(tight(est) ? [<span className="text-danger-fg">
          {t("index.confirm_tight")}</span>] : []),
      ],
      confirmLabel: t(!info!.usable ? "index.build"
        : rebuild ? "index.rebuild" : "index.update"),
    })) return;
    act(() => api.indexBuild(account, rebuild));
  };

  if (!secretKeySet) {
    return <p className="mt-2 type-meta text-muted">{t("index.need_key")}</p>;
  }
  if (savedMode !== "local") {
    return <p className="mt-2 type-meta text-muted">{t("index.save_first")}</p>;
  }
  if (!info) return <div className="mt-2"><Spinner /></div>;

  const built = info.built_ts
    ? fmtDate(localIso(info.built_ts), undefined,
      { lang: getLang(), time: true }) : "";
  return (
    <div className="mt-2 flex flex-col gap-2">
      {running && (
        <div className="flex flex-col gap-1">
          <ProgressBar value={info.job.done} max={info.job.total}
            label={t("index.building")} />
          <div className="type-meta text-muted">
            <Spinner /> {t("index.building")} {info.job.progress}
            {info.job.total > 0 && (
              ` (${fmtPct(Math.round(100 * info.job.done / info.job.total))})`
            )}
          </div>
        </div>
      )}
      <div className="type-meta text-muted">
        {info.job.status === "running"
          ? null
          : info.usable
            ? t("index.status", { docs: info.docs, ts: built,
              size: fmtSize(info.bytes) })
            : info.reason === "index_key"
              ? t("index.key_changed") : t("index.none")}
        {info.job.status === "error" && (
          <span className="ml-2 text-danger-fg">{info.job.error}</span>
        )}
      </div>
      {info.exists && !(info.usable && !running) && (
        <div className="type-meta text-muted">
          {t("index.disk", { size: fmtSize(info.bytes) })}
        </div>
      )}
      {!running && info.estimate.mails > 0 && (
        <div className={`type-meta ${tight(info.estimate)
          ? "text-danger-fg" : "text-muted"}`}>
          {t("index.estimate", params(info.estimate))}
          {tight(info.estimate) && ` ${t("index.confirm_tight")}`}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button variant="secondary" onClick={() => act(() =>
            api.indexCancel(account))}>{t("cancel")}</Button>
        ) : (<>
          <Button variant="tinted" onClick={() => build(false)}>
            {info.usable ? t("index.update") : t("index.build")}
          </Button>
          {info.usable && (
            <Button variant="secondary" onClick={() => build(true)}>
              {t("index.rebuild")}
            </Button>
          )}
          {info.exists && (
            <Button variant="danger-quiet" className="ml-auto"
              onClick={async () => {
              if (await confirmDialog({
                title: t("index.delete_title"),
                body: t("index.delete_body", { name: account }),
                confirmLabel: t("index.delete"), tone: "danger",
              })) act(() => api.indexDelete(account));
            }}>{t("index.delete")}</Button>
          )}
        </>)}
      </div>
      {error && <div className="type-meta text-danger-fg">{error}</div>}
    </div>
  );
}
