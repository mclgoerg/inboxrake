import { ChevronRight, Eye, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, fmtSize } from "../api";
import { fmtNum, fmtPct } from "../numfmt";
import { t } from "../i18n";
import type { TrackerReport } from "../types";
import { Avatar, Button, confirmDialog, EmptyState, Loading, Modal, PanelHeader,
  ProgressBar, Ring, SectionLabel, Spinner, Tag } from "./ui";

/** Senders listed before "Show all N". */
const TOP_SENDERS = 6;

const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);

function Figure({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="min-w-0">
      <div className="type-heading tabular-nums">{value}</div>
      <div className="type-meta text-muted">{label}</div>
    </div>
  );
}

/** Tools -> Trackers: which senders put tracking pixels or click-tracking
 *  links in their mail. Everything comes from the local body index (the
 *  detection runs while it is built), so without an index the panel says
 *  so and offers the build; mails indexed before this feature get a
 *  "Check older mails" rebuild. */
export function TrackersPanel({ account, onClose, onPickSender, onShowAll }: {
  account: string;
  onClose: () => void;
  /** A sender row was tapped: the caller filters the list to it. */
  onPickSender: (key: string) => void;
  /** "Show all in Senders": the caller applies the `has:tracker` filter. */
  onShowAll: () => void;
}) {
  const [rep, setRep] = useState<TrackerReport | null>(null);
  const [error, setError] = useState("");
  const [showAllSenders, setShowAllSenders] = useState(false);
  const alive = useRef(true);

  const load = useCallback(() => {
    api.trackers()
      .then((r) => alive.current && setRep(r))
      .catch((e) => alive.current && setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; };
  }, [load]);

  // Follow a running index job.
  const running = rep?.job.status === "running";
  useEffect(() => {
    if (!running) return;
    const h = setInterval(load, 1500);
    return () => clearInterval(h);
  }, [running, load]);

  const build = async (rebuild: boolean) => {
    if (!rep) return;
    const est = rep.estimate_full;
    if (est.mails > 0 && !await confirmDialog({
      title: t(rebuild ? "tracker.check_older" : "tracker.build"),
      bullets: [
        t("index.confirm_read", { n: est.mails }),
        t("tracker.confirm_note"),
        t("index.confirm_disk", { size: fmtSize(est.bytes),
          max: fmtSize(est.bytes_max), free: fmtSize(est.free) }),
        t("index.confirm_time"),
      ],
      confirmLabel: t(rebuild ? "tracker.check_older" : "tracker.build"),
    })) return;
    setError("");
    try { await api.indexBuild(account, rebuild); }
    catch (e: any) { setError(String(e.message ?? e)); }
    load();
  };

  const body = () => {
    if (!rep) return error ? null : <Loading />;
    if (!rep.scanned) {
      return <EmptyState icon={<Eye size={18} />}
        title={t("tracker.scan_first")} />;
    }
    if (running) {
      return (
        <div className="flex flex-col gap-1 p-4">
          <ProgressBar value={rep.job.done} max={rep.job.total}
            label={t("tracker.checking")} />
          <div className="type-meta text-muted">
            <Spinner /> {t("tracker.checking")} {rep.job.progress}
          </div>
        </div>
      );
    }
    if (!rep.usable) {
      const hint = !rep.secret_key_set ? t("index.need_key")
        : rep.mode !== "local" ? t("tracker.enable_local")
        : rep.reason === "index_key" ? t("index.key_changed")
        : t("tracker.none_hint");
      return (
        <EmptyState icon={<Eye size={18} />} title={t("tracker.none_title")}
          hint={hint}
          action={rep.secret_key_set && rep.mode === "local" ? (
            <Button onClick={() => build(false)}>{t("tracker.build")}</Button>
          ) : undefined} />
      );
    }
    const missing = Math.max(0, rep.docs - rep.checked);
    const checkOlder = missing > 0 && (
      <Button variant="secondary" onClick={() => build(true)}>
        {t("tracker.check_older")}
      </Button>
    );
    if (rep.checked === 0) {
      return (
        <EmptyState icon={<Eye size={18} />}
          title={t("tracker.unchecked_title")}
          hint={t("tracker.unchecked_hint")} action={checkOlder || undefined} />
      );
    }
    const share = pct(rep.pixel, rep.checked);
    const maxHost = Math.max(1, ...rep.top_hosts.map((h) => h.mails));
    return (
      <div className="space-y-4 p-4 type-body sm:p-5">
        <div className="space-y-4 rounded-card bg-panel2 p-4">
          <div className="flex items-center gap-4">
            <Ring frac={share / 100} px={96} label={rep.pixel > 0
              ? t("tracker.headline", { pct: fmtPct(share) })
              : t("tracker.headline_none")}>
              <span className="type-title2 tabular-nums">{fmtPct(share)}</span>
            </Ring>
            <div className="min-w-0 flex-1 type-heading">
              {rep.pixel > 0 ? t("tracker.ring_title")
                : t("tracker.headline_none")}
            </div>
          </div>
          {/* Under the ring, on the card's full width: three columns of
              words that fit (they wrapped one word per line beside it). */}
          <div className="grid grid-cols-3 gap-4 border-t border-line pt-3">
            <Figure value={fmtNum(rep.pixel)} label={t("tracker.pixel_short")} />
            <Figure value={fmtNum(rep.click)} label={t("tracker.click_short")} />
            <Figure value={fmtNum(rep.senders)} label={t("tracker.senders")} />
          </div>
        </div>
        <div className="flex items-start gap-2 rounded-card bg-safe-bg p-3
          type-meta text-safe-fg">
          <ShieldCheck size={16} aria-hidden className="mt-0.5 shrink-0" />
          <span>{t("tracker.safe_line")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 type-meta text-muted">
          <span>{t("tracker.checked",
            { n: fmtNum(rep.checked),
              total: fmtNum(rep.docs) })}</span>
          {checkOlder}
        </div>

        {rep.top_hosts.length > 0 && (
          <div className="rounded-card bg-panel2 p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <SectionLabel>{t("tracker.top_hosts")}</SectionLabel>
              <span className="truncate type-meta text-muted">
                {t("tracker.hosts_hint")}</span>
            </div>
            <ul className="space-y-3">
              {rep.top_hosts.map((h) => (
                <li key={h.host}>
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate">{h.host}</span>
                    <span className="shrink-0 type-meta text-muted">
                      {t("n.mails", { n: h.mails })} ·{" "}
                      {t("tracker.n_senders", { n: h.senders })}
                    </span>
                  </div>
                  <div aria-hidden className="mt-1 h-1.5 rounded-full bg-chip">
                    {/* bar width = this host's share of the busiest host */}
                    <div className="h-full rounded-full bg-accent"
                      style={{ width: `${(100 * h.mails) / maxHost}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {rep.top_senders.length > 0 && (
          <div className="rounded-card bg-panel2 py-3">
            <div className="mb-1 flex items-baseline justify-between gap-2 px-3">
              <SectionLabel>{t("tracker.top_senders")}</SectionLabel>
              <button type="button" onClick={onShowAll}
                className="shrink-0 cursor-pointer whitespace-nowrap type-meta
                  text-accent hover:underline coarse:min-h-11">
                {t("tracker.show_all")}
              </button>
            </div>
            <ul>
              {(showAllSenders ? rep.top_senders
                : rep.top_senders.slice(0, TOP_SENDERS)).map((s) => (
                <li key={s.key} className="border-b border-line last:border-0">
                  <button type="button" onClick={() => onPickSender(s.key)}
                    aria-label={t("tracker.pick", { name: s.label })}
                    className="flex w-full cursor-pointer items-center gap-3
                      px-3 py-2 text-left hover:bg-chip coarse:min-h-11">
                    <Avatar name={s.label} size="md" />
                    <span className="min-w-0 flex-1">
                      {/* Name and its chips share the first line (the chips
                          used to take a line of their own on phones). */}
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 truncate">{s.label}</span>
                        {s.pixel > 0 && (
                          <Tag tone="review" className="shrink-0">
                            {t("tracker.tag_pixel")}</Tag>
                        )}
                        {s.click > 0 && (
                          <Tag tone="info" className="shrink-0">
                            {t("tracker.tag_click")}</Tag>
                        )}
                      </span>
                      <span className="flex gap-1 type-meta text-muted">
                        <span className="shrink-0">
                          {t("tracker.sender_meta", { tracked: s.tracked,
                            of: s.checked, count: s.checked })}
                        </span>
                        {s.hosts.length > 0 && (<>
                          <span aria-hidden className="shrink-0">·</span>
                          <span className="min-w-0 truncate">
                            {s.hosts.join(", ")}
                          </span>
                        </>)}
                      </span>
                    </span>
                    <ChevronRight size={16} aria-hidden
                      className="shrink-0 text-faint" />
                  </button>
                </li>
              ))}
            </ul>
            {rep.top_senders.length > TOP_SENDERS && (
              <div className="px-3 pt-1">
                <Button variant="plain" size="sm" aria-expanded={showAllSenders}
                  onClick={() => setShowAllSenders((v) => !v)}>
                  {showAllSenders ? t("stats.show_less")
                    : t("stats.show_all", { n: rep.top_senders.length })}
                </Button>
              </div>
            )}
          </div>
        )}
        {rep.top_senders.length === 0 && (
          <div className="type-meta text-muted">
            {t("tracker.nothing_found", { n: rep.checked })}
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal onClose={onClose} size="lg">
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Eye size={18} /> {t("tracker.title")}
        </span>}
        sub={t("tracker.sub")} onClose={onClose} />
      <div data-scroll-id="panel" className="min-h-0 flex-1 overflow-y-auto">
        {error && <div className="p-4 type-body text-danger-fg">{error}</div>}
        {body()}
      </div>
    </Modal>
  );
}
