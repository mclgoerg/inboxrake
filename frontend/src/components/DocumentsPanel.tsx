import { Download, FileText, Paperclip, Pin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtSize, mailKey } from "../api";
import { t } from "../i18n";
import { DOC_KINDS, dayShort, downloadYear, filesLine, latestYear, mailOf,
  savedText, yearLine, yearOf, type YearResult } from "../documents";
import { fmtNum } from "../numfmt";
import type { AppState, DocFile, DocKind, DocRow, DocsPage, DocsSummary, Mail }
  from "../types";
import { DOC_LOOK } from "./docKinds";
import { DownloadYear } from "./DownloadYear";
import { MessageView } from "./MailList";
import { Avatar, Button, EmptyState, IconTile, Loading, Menu, MenuItem, Modal,
  PanelHeader, PopupSelect, Segmented, Spinner, customDialog, useIsPage,
  useMediaQuery, useToast } from "./ui";

/** Up to this many years the year switch is a segmented control, beyond it a
 *  menu (a long row of years would not fit). */
const SEGMENTED_YEARS = 6;

/** Insights -> Your documents: the mails of one year that carry a file and
 *  read like a document - Keep-safe's invoices & bills, contracts & policies,
 *  bookings & tickets plus tax & official mail - with the file one tap away.
 *  Everything is read from the scan and the attachment analysis (which the
 *  page offers to run first); a file is read from the mail server only when it
 *  is downloaded. Nothing is sent anywhere else and nothing is changed or
 *  deleted - the pin is the app's own "protect this mail". */
export function DocumentsPanel({ account, scannedTs, atts, onAnalyze,
  onClose }: {
  account: string;
  /** The last finished scan: the list is fetched again. */
  scannedTs?: number | null;
  /** The attachment analysis (status / progress / error). */
  atts?: AppState["atts"];
  /** Start the attachment analysis (the page's "Analyze"). */
  onAnalyze: () => Promise<void>;
  onClose: () => void;
}) {
  const [sum, setSum] = useState<DocsSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const [page, setPage] = useState<{ year: number; data: DocsPage } | null>(
    null);
  const [pageFailed, setPageFailed] = useState(false);
  const [kind, setKind] = useState<DocKind | null>(null);
  const [view, setView] = useState<Mail | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const phone = useMediaQuery("(max-width: 767px)");
  const onPage = useIsPage();
  const toast = useToast();
  const alive = useRef(true);
  const card = onPage ? "bg-panel" : "bg-panel2";
  const status = atts?.status;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const s = await api.documentsSummary();
      if (!alive.current) return;
      setSum(s);
      setFailed(false);
    } catch {
      if (alive.current) setFailed(true);
    }
  }, []);
  useEffect(() => { void loadSummary(); },
    [loadSummary, account, scannedTs, status]);

  // The year the page shows: the newest with documents until the user picks
  // one; one that no longer has any (after a scan) falls back to the newest.
  useEffect(() => {
    if (!sum) return;
    if (year === null || !yearOf(sum, year)) setYear(latestYear(sum));
  }, [sum, year]);

  const loadPage = useCallback(async (y: number) => {
    try {
      const data = await api.documents(y);
      if (!alive.current) return;
      setPage({ year: y, data });
      setPageFailed(false);
    } catch {
      if (alive.current) setPageFailed(true);
    }
  }, []);
  useEffect(() => {
    if (year !== null && yearOf(sum, year)) void loadPage(year);
  // the list is fetched again when the year, a scan or the analysis changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, scannedTs, status, !!sum]);

  const fail = (e: any) =>
    toast.show(String(e?.message ?? e), { variant: "error" });
  const mark = (key: string, on: boolean) => setBusy((s) => {
    const next = new Set(s);
    if (on) next.add(key); else next.delete(key);
    return next;
  });

  const download = async (r: DocRow, f: DocFile) => {
    const key = `${mailKey(r)}\u0000${f.name}`;
    if (busy.has(key)) return;
    mark(key, true);
    try { await api.downloadDocument(r.folder, r.uid, f); }
    catch (e) { fail(e); }
    finally { if (alive.current) mark(key, false); }
  };

  const setPinned = (r: { folder: string; uid: number }, pinned: boolean) =>
    setPage((p) => p && ({ ...p, data: { ...p.data, rows: p.data.rows.map(
      (x) => x.folder === r.folder && x.uid === r.uid ? { ...x, pinned } : x) } }));
  const togglePin = async (r: DocRow) => {
    try {
      await api.pin(r.folder, r.uid, !r.pinned);
      if (alive.current) setPinned(r, !r.pinned);
    } catch (e: any) {
      toast.show(`${t("pin.error")}: ${e?.message ?? e}`, { variant: "error" });
    }
  };

  const analyze = async () => {
    setStarting(true);
    try { await onAnalyze(); }
    catch (e) { fail(e); }
    finally { if (alive.current) setStarting(false); }
  };
  const cancel = async () => {
    try { await api.cancel("atts"); } catch { /* too late */ }
  };

  const y = yearOf(sum, year);
  const shown = page && page.year === year ? page.data : null;
  const rows = shown ? shown.rows.filter((r) => !kind || r.kind === kind) : [];
  const running = starting || status === "running";

  // ------------------------------------------------------------- the head
  const yearPick = sum && sum.years.length > 1 && year !== null && (
    sum.years.length <= SEGMENTED_YEARS ? (
      <Segmented<string> value={String(year)} label={t("docs.years")}
        role="radio" tall={phone}
        onChange={(v) => { setYear(Number(v)); setKind(null); }}
        options={sum.years.map((x) => ({ value: String(x.year),
          label: String(x.year) }))} />
    ) : (
      <PopupSelect<string> label={t("docs.years")} value={String(year)}
        onChange={(v) => { setYear(Number(v)); setKind(null); }}
        options={sum.years.map((x) => ({ value: String(x.year),
          label: String(x.year) }))} />
    ));

  const sub = y ? yearLine(y) : t("docs.sub_none");

  // "Download 2026...": the dialog makes the .zip of the year; the list is read
  // again after it when mails were kept safe in the same step
  const openDownload = async () => {
    if (!y) return;
    const result = await customDialog<YearResult>((done) => (
      <DownloadYear year={y} cap={sum?.cap ?? 0}
        loadPlan={(kinds) => api.documentsPlan(y.year, kinds)}
        run={(answer, progress, state) =>
          downloadYear(y.year, answer, progress, state)}
        onResult={done} />));
    if (!result || !alive.current) return;
    toast.show(savedText(y.year, result), { variant:
      result.skipped || result.stopped ? "info" : "success" });
    if (result.pinned) void loadPage(y.year);
  };
  const downloadBtn = y && (
    <Button variant="primary" onClick={() => void openDownload()}
      className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Download size={16} aria-hidden />{t("docs.zip_btn", { year: y.year })}
    </Button>
  );

  // ------------------------------------------------------------- the body
  const tiles = y && (
    <div role="group" aria-label={t("docs.kinds")}
      className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {DOC_KINDS.map((k) => {
        const look = DOC_LOOK[k];
        const on = kind === k;
        return (
          <button key={k} type="button" aria-pressed={on}
            onClick={() => setKind(on ? null : k)}
            className={`flex min-h-16 cursor-pointer items-center gap-3
              rounded-card ${card} p-3 text-left transition-colors
              ${onPage ? "hover:bg-panel2" : "hover:bg-chip"}
              ${on ? "ring-2 ring-accent" : ""}`}>
            <IconTile tone={look.tone}>{look.icon}</IconTile>
            <span className="min-w-0 flex-1">
              <span className="block break-words type-body font-semibold">
                {t(`docs.kind.${k}`)}</span>
              <span className="block type-meta text-muted">
                {t("docs.n_files", { n: y.kinds[k].files })}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  const row = (r: DocRow) => {
    const first = r.files[0];
    const pinLabel = t(r.pinned ? "pin.unprotect_tip" : "pin.protect_tip");
    const downloading = r.files.some((f) =>
      busy.has(`${mailKey(r)}\u0000${f.name}`));
    return (
      <li key={mailKey(r)} data-testid="doc-row"
        className="flex items-center gap-1 pr-2 first:rounded-t-card
          last:rounded-b-card">
        <button type="button" onClick={() => setView(mailOf(r))}
          className={`flex min-h-16 min-w-0 flex-1 cursor-pointer items-center
            gap-3 px-3 py-2.5 text-left ${onPage ? "hover:bg-panel2"
            : "hover:bg-chip"}`}>
          <span className="hidden w-20 shrink-0 whitespace-nowrap type-body
            font-semibold tabular-nums sm:block">{dayShort(r.ts)}</span>
          <Avatar name={r.name || r.addr} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate type-body font-medium">
              {r.subject || t("(no subject)")}</span>
            <span className="block truncate type-meta text-muted">
              <span className="sm:hidden">{dayShort(r.ts)} · </span>
              {r.name || r.addr}
              <span className="hidden sm:inline">
                {" · "}
                <Paperclip size={14} aria-hidden
                  className="inline align-text-bottom" /> {filesLine(r)}
              </span>
            </span>
            {/* a phone has no room beside the sender: the files go below it */}
            <span className="block truncate type-meta text-muted sm:hidden">
              <Paperclip size={14} aria-hidden
                className="inline align-text-bottom" /> {filesLine(r)}
            </span>
          </span>
          <span className="hidden w-40 shrink-0 text-right type-meta
            text-muted md:block">{t(`docs.kind.${r.kind}`)}</span>
        </button>
        {r.files.length === 1 ? (
          <Button variant="quiet" size="icon" disabled={downloading}
            label={t("docs.download", { file: first.name })}
            onClick={() => void download(r, first)}>
            {downloading ? <Spinner /> : <Download size={16} aria-hidden />}
          </Button>
        ) : (
          <Menu variant="quiet" icon label={t("docs.download_pick",
            { n: r.files.length })} triggerClass="coarse:size-11"
            trigger={downloading ? <Spinner />
              : <Download size={16} aria-hidden />}>
            {r.files.map((f) => (
              <MenuItem key={f.name + f.size} sub={fmtSize(f.size)}
                onClick={() => void download(r, f)}>{f.name}</MenuItem>
            ))}
          </Menu>
        )}
        <Button variant={r.pinned ? "tinted" : "quiet"} size="icon"
          aria-pressed={r.pinned} disabled={!r.pinnable} label={pinLabel}
          onClick={() => void togglePin(r)}>
          <Pin size={16} aria-hidden fill={r.pinned ? "currentColor" : "none"} />
        </Button>
      </li>
    );
  };

  const list = shown === null ? (
    pageFailed ? (
      <div className="flex items-center gap-3 p-4 type-body text-muted">
        <span>{t("docs.load_failed")}</span>
        <Button variant="quiet" size="sm"
          onClick={() => year !== null && void loadPage(year)}>
          {t("tab.retry")}</Button>
      </div>
    ) : <Loading />
  ) : rows.length === 0 ? (
    <EmptyState icon={<FileText size={18} />} title={t("docs.none_kind")} />
  ) : (
    <ul className={`divide-y divide-line overflow-hidden rounded-card ${card}`}>
      {rows.map(row)}
    </ul>
  );

  const analyzeCard = (
    <div className={`mx-auto flex max-w-xl items-center gap-3 rounded-card
      ${card} p-4`}>
      <IconTile tone="attach"><Paperclip size={16} /></IconTile>
      <div className="min-w-0 flex-1">
        <div className="type-body font-semibold">{t("docs.analyze_title")}</div>
        <div className="type-meta text-muted">{t("docs.analyze_hint")}</div>
        {status === "error" && (
          <div className="type-meta text-danger-fg">{atts?.error}</div>
        )}
      </div>
      <Button onClick={() => void analyze()}>{t("docs.analyze")}</Button>
    </div>
  );

  const content = () => {
    if (!sum) {
      return failed ? (
        <div className="flex items-center gap-3 p-4 type-body text-muted">
          <span>{t("docs.load_failed")}</span>
          <Button variant="quiet" size="sm"
            onClick={() => void loadSummary()}>{t("tab.retry")}</Button>
        </div>
      ) : <Loading />;
    }
    if (!sum.scanned) {
      return <EmptyState icon={<FileText size={18} />}
        title={t("docs.scan_first")} hint={t("docs.scan_first_hint")} />;
    }
    if (running) {
      return (
        <div className="flex flex-col items-center gap-3 p-6">
          <Loading label={starting && !atts?.progress ? t("Starting…")
            : atts?.progress} />
          <Button variant="secondary" onClick={() => void cancel()}>
            {t("cancel")}</Button>
        </div>
      );
    }
    if (!sum.analyzed) return <div className="p-4 sm:p-5">{analyzeCard}</div>;
    if (sum.years.length === 0) {
      return <EmptyState icon={<FileText size={18} />}
        title={t("docs.empty_title")} hint={t("docs.empty_hint")} />;
    }
    return (
      <div className="min-w-0 space-y-4 p-4 sm:p-5">
        {phone && (yearPick || downloadBtn) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {yearPick}{downloadBtn}
          </div>
        )}
        {tiles}
        {list}
        {shown?.capped && (
          <p className="type-meta text-muted">
            {t("docs.capped", { n: fmtNum(shown.rows.length) })}</p>
        )}
        <p className="px-1 type-meta text-muted">{t("docs.footnote")}</p>
      </div>
    );
  };

  const empty = !!sum && (!sum.scanned || (!sum.analyzed && !running)
    || (sum.analyzed && sum.years.length === 0 && !running));
  return (
    <Modal onClose={onClose} size="lg" full={!empty || !!view}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <FileText size={18} /> {t("docs.menu")}
        </span>}
        sub={sub} actions={!phone && (yearPick || downloadBtn)
          ? <>{yearPick}{downloadBtn}</> : undefined}
        onClose={onClose} />
      {view ? (
        <MessageView mail={view} onBack={() => setView(null)}
          backLabel={t("docs.menu")}
          actions={{ pinned: (m, on) => setPinned(m, on) }}
          nav={{ onOpen: setView,
            list: (shown?.rows ?? []).filter((r) => !kind || r.kind === kind)
              .map(mailOf) }} />
      ) : (
        <div data-scroll-id="panel" className="min-h-0 flex-1 overflow-y-auto
          max-sm:pb-[env(safe-area-inset-bottom)]">
          {content()}
        </div>
      )}
    </Modal>
  );
}
