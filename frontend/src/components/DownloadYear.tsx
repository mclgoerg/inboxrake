import { Download } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState }
  from "react";
import { fmtSize } from "../api";
import { DOC_KINDS, newRun, partial, type YearResult, type YearRun }
  from "../documents";
import { t } from "../i18n";
import type { DocKind, DocsPlan, DocYear } from "../types";
import { DOC_LOOK } from "./docKinds";
import { Button, Checkbox, IconTile, Modal, Notice, Spinner } from "./ui";

/** What the dialog asks for: the kinds ticked, the list, the pin. */
export interface YearAnswer { kinds: DocKind[]; index: boolean; pin: boolean }

/** "Download 2026...": one .zip of a year's documents, made on the user's own
 *  server (folders by kind and month), an optional `index.csv` and, if ticked,
 *  the same mails kept safe in the same step. `run` does the work (the plan,
 *  the download of each part, the pin): the dialog shows it working, ignores
 *  Esc and Cancel meanwhile, and stays open with the error when it fails.
 *  Above `cap` bytes the .zip comes in several downloads - the footer says so. */
export function DownloadYear({ year, cap, loadPlan, run, onResult }: {
  year: DocYear;
  /** The size one download holds at most (the server's cap). */
  cap: number;
  /** The server's plan for these kinds: how many downloads it will be. */
  loadPlan: (kinds: DocKind[]) => Promise<DocsPlan>;
  run: (answer: YearAnswer, progress: (part: number, of: number) => void,
    state: YearRun) => Promise<YearResult>;
  /** What the run saved (also when it was stopped or failed after a part), null
   *  when nothing was. */
  onResult: (result: YearResult | null) => void;
}) {
  // bookings & tickets start unticked (tax time is about the other three);
  // a kind with no document cannot be ticked
  const [kinds, setKinds] = useState<Set<DocKind>>(() => new Set(
    DOC_KINDS.filter((k) => k !== "bookings" && year.kinds[k].files > 0)));
  const [index, setIndex] = useState(true);
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [part, setPart] = useState<[number, number] | null>(null);
  const [stopping, setStopping] = useState(false);
  const state = useRef<YearRun>(newRun());
  const [planned, setPlanned] = useState<{ kinds: string; parts: number } | null>(
    null);
  const [error, setError] = useState("");
  const primary = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  // nothing here is destructive: the action itself takes the focus
  useLayoutEffect(() => { primary.current?.focus(); }, []);

  // A choice changed before any part was saved starts a new run (the old plan
  // was made for the old ticks). Once a part is saved the choices are locked:
  // Try again goes on with the plan - and the ticks - those parts came from.
  const saved = partial(state.current) !== null;
  const locked = busy || saved;
  const choose = (change: () => void) => {
    state.current = newRun();
    change();
  };
  const flip = (k: DocKind) => choose(() => setKinds((s) => {
    const next = new Set(s);
    if (!next.delete(k)) next.add(k);
    return next;
  }));
  const sum = useMemo(() => DOC_KINDS.filter((k) => kinds.has(k)).reduce(
    (n, k) => ({ mails: n.mails + year.kinds[k].mails,
      bytes: n.bytes + year.kinds[k].bytes }), { mails: 0, bytes: 0 }),
  [kinds, year]);
  // how many downloads: the server's plan for these ticks (it cuts by mails, so
  // only it knows), until it answers an estimate from the sizes
  const ticked = DOC_KINDS.filter((k) => kinds.has(k));
  useEffect(() => {
    if (ticked.length === 0) { setPlanned(null); return; }
    let live = true;
    loadPlan(ticked)
      .then((p) => live && setPlanned({ kinds: ticked.join(), parts: p.parts }))
      .catch(() => live && setPlanned(null));
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kinds]);
  const estimate = cap > 0 ? Math.max(1, Math.ceil(sum.bytes / cap)) : 1;
  const downloads = planned && planned.kinds === ticked.join()
    ? planned.parts : estimate;
  const go = async () => {
    const answer = { kinds: DOC_KINDS.filter((k) => kinds.has(k)), index, pin };
    setBusy(true);
    setError("");
    try {
      onResult(await run(answer, (n, of) => setPart([n, of]), state.current));
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
      setPart(null);
    }
  };
  // closing after parts were saved says so (and reads the list again)
  const close = () => onResult(partial(state.current));
  return (
    <Modal size="sm" labelledBy={titleId} describedBy={bodyId}
      onClose={() => { if (!busy) close(); }}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        <div>
          <div id={titleId} className="type-heading">
            {t("docs.zip_title", { year: year.year })}</div>
          <div className="type-meta text-muted">{t("docs.zip_sub")}</div>
        </div>
        <div id={bodyId} className="flex flex-col gap-3 type-body text-body">
          <ul className="divide-y divide-line rounded-card border border-line
            bg-panel">
            {DOC_KINDS.map((k) => {
              const n = year.kinds[k];
              const look = DOC_LOOK[k];
              return (
                <li key={k} className="flex items-center gap-3 px-3 py-2">
                  <Checkbox checked={kinds.has(k)} disabled={locked || n.files === 0}
                    aria-label={t(`docs.kind.${k}`)} onChange={() => flip(k)} />
                  <IconTile tone={look.tone}>{look.icon}</IconTile>
                  <span className="min-w-0 flex-1">
                    <span className="block type-body font-medium">
                      {t(`docs.kind.${k}`)}</span>
                    <span className="block type-meta text-muted">
                      {t("docs.zip_kind_sub", {
                        files: t("docs.zip_files", { n: n.files }),
                        mails: t("n.mails", { n: n.mails }),
                        size: fmtSize(n.bytes) })}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <Checkbox checked={index} disabled={locked} label={t("docs.zip_index")}
            className="type-body text-body"
            onChange={() => choose(() => setIndex(!index))} />
          <Checkbox checked={pin} disabled={locked}
            label={t("docs.zip_pin", { n: sum.mails })}
            className="type-body text-body"
            onChange={() => choose(() => setPin(!pin))} />
          {saved && !busy && (
            <p className="type-meta text-muted">{t("docs.zip_locked")}</p>
          )}
          {error && <Notice tone="danger" role="alert">{error}</Notice>}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-3
        max-sm:flex-col max-sm:items-stretch sm:px-5">
        <span className="type-meta text-muted sm:flex-1">
          {downloads > 1
            ? t("docs.zip_foot_split", { size: fmtSize(sum.bytes),
              n: downloads, cap: fmtSize(cap) })
            : t("docs.zip_foot", { size: fmtSize(sum.bytes) })}
        </span>
        <div className="flex items-center justify-end gap-2
          max-sm:flex-col-reverse max-sm:items-stretch">
          {busy ? (
            // several downloads: stop after the one that is running
            <Button variant="secondary" className="max-sm:min-h-11"
              disabled={stopping || !part || part[1] < 2}
              onClick={() => { state.current.stop = true; setStopping(true); }}>
              {stopping ? t("docs.zip_stopping") : t("docs.zip_stop")}</Button>
          ) : (
            <Button variant="secondary" className="max-sm:min-h-11"
              onClick={close}>{t("Cancel")}</Button>
          )}
          <Button ref={primary} variant="primary" className="inline-flex items-center
            justify-center gap-1.5 max-sm:min-h-11"
            disabled={busy || kinds.size === 0} onClick={() => void go()}>
            {busy ? <Spinner /> : <Download size={16} aria-hidden />}
            {busy
              ? (part && part[1] > 1 ? t("docs.zip_part",
                { n: part[0], of: part[1] }) : t("docs.zip_working"))
              : error ? t("docs.zip_retry") : t("docs.zip_go")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
