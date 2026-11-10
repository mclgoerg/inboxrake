import { ChevronRight, LayoutGrid } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtNum, fmtPct } from "../numfmt";
import { t } from "../i18n";
import { fmtBig, buildDomains, childTiles, levelTiles, pct, senderIndex,
  soleSender, toggleItem, toneSums, type ColorBy, type MapItem }
  from "../spacemap";
import type { Group } from "../types";
import { BulkBar, Button, Chip, EmptyState, Modal, PanelHeader,
  Segmented, useIsPage, useMediaQuery } from "./ui";
import { SpaceDetails, SpaceList } from "./SpaceDetails";
import { SpaceRings } from "./SpaceRings";
import { SpaceTiles } from "./SpaceTiles";
import { nameOf, SpaceHeadline } from "./spaceUi";

type View = "tiles" | "rings";
const VIEW_KEY = "pmc_space_view";
/** Two taps on the same tile within this are a double-tap (zoom in). */
const DOUBLE_TAP_MS = 350;

const loadView = (): View =>
  localStorage.getItem(VIEW_KEY) === "rings" ? "rings" : "tiles";

/** The mailbox by size, as readable tiles or as rings: domains first, tap
 *  one for its details, double-tap (or the zoom button) to see its senders.
 *  A "Select" mode ticks senders; "Review in Senders" hands the ticked keys
 *  to the main list (the usual bulk bar, confirm and undo do the rest) -
 *  nothing is moved from in here. "Show in Senders" hands over a filter. */
export function SpaceMapPanel({ groups, onDone, onShow, onClose }: {
  groups: Record<string, Group>;
  onDone: (keys: string[]) => void;
  /** Open the Senders list filtered by this query. */
  onShow: (query: string) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState<string[]>([]);
  const [by, setBy] = useState<ColorBy>("engagement");
  const [view, setView] = useState<View>(loadView);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  // The item whose details are shown (by id; resolved again on every render).
  const [focusId, setFocusId] = useState<string | null>(null);
  const page = useIsPage();
  const coarse = useMediaQuery("(pointer: coarse)");
  const lastTap = useRef({ id: "", at: 0 });
  const scroller = useRef<HTMLDivElement>(null);
  const cardEl = useRef<HTMLElement>(null);
  const [cardH, setCardH] = useState(0);
  // Where keyboard focus goes after the next render (an item id, or "first").
  const refocus = useRef<string | null>(null);

  const domains = useMemo(() => buildDomains(groups), [groups]);
  const hasAi = useMemo(
    () => Object.values(groups).some((g) => g.ai), [groups]);
  const index = useMemo(() => senderIndex(domains), [domains]);
  const totals = useMemo(() => domains.reduce(
    (a, d) => ({ size: a.size + d.size, count: a.count + d.count }),
    { size: 0, count: 0 }), [domains]);
  // The drilled-into items, resolved by id on every render so a refreshed
  // mailbox never leaves a stale tile behind (a vanished one ends the trail).
  const { trail, level } = useMemo(() => {
    const trail: MapItem[] = [];
    let level = levelTiles(domains);
    for (const id of path) {
      const hit = level.find((i) => i.id === id);
      if (!hit) break;
      trail.push(hit);
      level = levelTiles(hit.children, hit.kind === "domain");
    }
    return { trail, level };
  }, [domains, path]);
  const trailIds = trail.map((i) => i.id);

  // Everything a tap can land on: the level and (rings) what is inside it,
  // each with the item it sits in.
  const known = useMemo(() => {
    const m = new Map<string, { it: MapItem; parent: MapItem | null }>();
    for (const it of level) {
      m.set(it.id, { it, parent: null });
      for (const c of childTiles(it)) m.set(c.id, { it: c, parent: it });
    }
    return m;
  }, [level]);
  const focus = focusId ? known.get(focusId)?.it ?? null : null;
  const chainOf = (it: MapItem): MapItem[] => {
    const p = known.get(it.id)?.parent;
    return p ? [p, it] : [it];
  };

  // A selection only ever covers what is on this level (DESIGN, UX6).
  const visibleKeys = useMemo(
    () => new Set(level.flatMap((it) => it.keys)), [level]);
  useEffect(() => {
    setSel((s) => {
      const keep = [...s].filter((k) => visibleKeys.has(k));
      return keep.length === s.size ? s : new Set(keep);
    });
  }, [visibleKeys]);
  const picked = [...sel].filter((k) => visibleKeys.has(k) && index.has(k));
  const pickedSize = picked.reduce((a, k) => a + index.get(k)!.size, 0);

  const goTo = (ids: string[]) => { setPath(ids); setFocusId(null); };
  const tick = (it: MapItem) => setSel((s) => toggleItem(it, s));
  /** Zoom into `chain` (parent first). A domain with a single sender has
   *  nothing to zoom into: its card is the sender's. */
  const zoom = (it: MapItem, chain: MapItem[] = chainOf(it)) => {
    if (it.kind === "sender") return;
    const sole = soleSender(it);
    if (sole) {
      setPath([...trailIds, ...chain.slice(0, -1).map((i) => i.id)]);
      setFocusId(sole.id);
      return;
    }
    goTo([...trailIds, ...chain.map((i) => i.id)]);
  };
  const press = (it: MapItem, chain: MapItem[] = [it]) => {
    if (selecting) { tick(it); return; }
    const now = Date.now();
    if (lastTap.current.id === it.id && now - lastTap.current.at < DOUBLE_TAP_MS) {
      lastTap.current = { id: "", at: 0 };
      zoom(it, chain);
      return;
    }
    lastTap.current = { id: it.id, at: now };
    setFocusId(it.id);
  };
  // A row opens what is behind it (also while selecting: its checkbox ticks).
  // A sender - or a domain with one sender, which has no level of its own -
  // has nothing behind it: selecting ticks it, else its card opens.
  const openRow = (it: MapItem) => {
    if (selecting && (it.kind === "sender" || soleSender(it))) tick(it);
    else if (it.kind !== "sender") { refocus.current = "first"; zoom(it); }
    else setFocusId(it.id);
  };
  // Leaving Select mode drops the selection and its capsule.
  const toggleSelecting = () => {
    if (selecting) setSel(new Set());
    setSelecting(!selecting);
    setFocusId(null);
  };
  const closeCard = (back = true) => {
    if (back && focusId) refocus.current = focusId;
    setFocusId(null);
  };
  const setViewKeep = (v: View) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ }
  };
  const selectItem = (it: MapItem) => {
    setSelecting(true);
    setFocusId(null);
    setSel((s) => {
      const next = new Set(s);
      for (const k of it.keys) next.add(k);
      return next;
    });
  };
  const showQuery = (it: MapItem): string | null =>
    it.kind === "sender" ? `from:${it.label}`
      : it.kind === "domain" ? `@${it.label}` : null;

  const modes: { value: ColorBy; label: string }[] = [
    { value: "engagement", label: t("space.by_engagement") },
    { value: "age", label: t("space.by_age") },
    ...(hasAi ? [{ value: "ai" as ColorBy, label: t("space.by_ai") }] : []),
  ];
  const mode = modes.some((m) => m.value === by) ? by : "engagement";

  const protectedHere = level.some((it) => it.protectedSenders > 0);
  const where = trail.length ? nameOf(trail[trail.length - 1]) : null;
  const headline = <SpaceHeadline items={level} by={mode} where={where} />;
  const { total: levelTotal, sums } = toneSums(level, mode);
  const caption = t(`space.ring_${mode}`, { p: fmtPct(pct(sums[0].size, levelTotal)) });
  const docked = !!focus && !selecting && !page;
  // The docked card must never hide what was tapped: the page keeps a
  // spacer of the card's height and the tapped item is scrolled above the card.
  useEffect(() => {
    const el = cardEl.current;
    if (!docked || !el) { setCardH(0); return; }
    const sync = () => setCardH(el.offsetHeight);
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [docked, focus?.id]);
  const focusShown = docked ? focus?.id : null;
  useEffect(() => {
    const box = scroller.current;
    if (!focusShown || !box || !cardH) return;
    const at = [...box.querySelectorAll<HTMLElement | SVGElement>(
      "[data-item], [data-seg]")]
      .find((e) => (e.dataset.item ?? e.dataset.seg) === focusShown);
    if (!at) return;
    const r = at.getBoundingClientRect(), v = box.getBoundingClientRect();
    const top = v.top + 8, bottom = v.bottom - cardH - 8;
    // taller than the free space: its top edge wins
    if (r.height > bottom - top || r.top < top) box.scrollBy({ top: r.top - top });
    else if (r.bottom > bottom) box.scrollBy({ top: r.bottom - bottom });
  }, [focusShown, cardH]);
  // Esc closes the card first, wherever focus is, and only then the page.
  const cardOpen = !!focus && !selecting;
  useEffect(() => {
    if (!cardOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      closeCard();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  // Focus back to the tile (or its list row) after the card closes; after a
  // zoom to the first row of the new level.
  useEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const box = scroller.current;
    if (!box) return;
    const all = [...box.querySelectorAll<HTMLElement>("[data-item], [data-row]")];
    const hit = want === "first"
      ? box.querySelector<HTMLElement>("[data-row]")
      : all.find((e) => e.dataset.item === want)
        ?? all.find((e) => e.dataset.row === want);
    hit?.focus();
  });
  const card = focus && !selecting && (
    <SpaceDetails item={focus} hasAi={hasAi} totalSize={totals.size}
      docked={!page}
      canShow={showQuery(focus) !== null}
      onShow={() => { const q = showQuery(focus); if (q) onShow(q); }}
      onSelect={() => selectItem(focus)}
      onZoom={focus.kind === "sender" ? undefined
        : () => { refocus.current = "first"; zoom(focus); }}
      onClose={() => closeCard()} cardRef={cardEl} />
  );
  const list = (
    <SpaceList level={level} by={mode} sel={sel} selecting={selecting}
      focusId={focus?.id ?? null} onOpen={openRow} onTick={tick} />
  );
  const lastTrail = trail[trail.length - 1];
  const domainLevel = lastTrail?.kind === "domain";
  const map = view === "tiles" ? (
    <SpaceTiles level={level} by={mode} wide={page} sel={sel}
      selecting={selecting} focusId={focus?.id ?? null}
      domainLevel={domainLevel} onPress={(it) => press(it)} />
  ) : (
    <SpaceRings level={level} trail={trail} by={mode} sel={sel}
      selecting={selecting} focus={focus} totals={totals} caption={caption}
      onPress={press} onZoom={zoom} />
  );

  return (
    <Modal full onClose={onClose} label={t("space.title")}>
      <PanelHeader title={<span className="inline-flex items-center gap-2">
        <LayoutGrid size={18} /> {t("space.title")}
      </span>}
        sub={domains.length ? `${t("space.total", {
          size: fmtBig(totals.size), mails: fmtNum(totals.count),
          n: totals.count })} · ${t(view === "tiles" ? "space.sub_tiles"
          : "space.sub_rings")}` : undefined}
        onClose={onClose} />
      {!domains.length ? (
        <div className="p-4"><EmptyState>{t("space.empty")}</EmptyState></div>
      ) : (
        <>
          <div data-scroll-id="panel" ref={scroller}
            className={`min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5
              ${picked.length ? "pb-28" : ""}`}>
            {!(page && view === "rings") && headline}
            <div className="flex flex-wrap items-center gap-2">
              <Segmented label={t("space.color_by")} value={mode}
                options={modes} onChange={setBy} />
              <Segmented label={t("space.view")} role="radio" value={view}
                options={[{ value: "tiles", label: t("space.view_tiles") },
                  { value: "rings", label: t("space.view_rings") }]}
                onChange={setViewKeep} />
              <Chip on={selecting} onClick={toggleSelecting}>
                {t("space.select")}
              </Chip>
            </div>
            {/* main column + a fixed-width side column (details, list) */}
            <div className={page ? "grid grid-cols-[minmax(0,1fr)_24rem] items-start gap-4"
              : "space-y-3"}>
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <nav aria-label={t("space.crumbs")}
                    className="flex flex-wrap items-center gap-x-1 type-meta">
                    {trail.length === 0
                      ? <span className="font-medium">{t("space.all")}</span>
                      : <Button variant="quiet" size="sm"
                        onClick={() => goTo([])}>{t("space.all")}</Button>}
                    {trail.map((it, i) => (
                      <span key={it.id} className="inline-flex items-center gap-1">
                        <ChevronRight size={14} className="text-faint" aria-hidden />
                        {i === trail.length - 1
                          ? <span aria-current="page" className="font-medium">
                            {nameOf(it)}</span>
                          : <Button variant="quiet" size="sm"
                            onClick={() => goTo(path.slice(0, i + 1))}>
                            {nameOf(it)}
                          </Button>}
                      </span>
                    ))}
                  </nav>
                  <span className="type-meta text-muted">
                    {selecting ? t("space.select_hint")
                      : t(coarse ? "space.hint_touch" : "space.hint_mouse")}
                  </span>
                </div>
                {map}
                {selecting && protectedHere && (
                  <p className="type-meta text-muted">{t("space.protected_note")}</p>
                )}
              </div>
              <div className="min-w-0 space-y-3">
                {page && view === "rings" && headline}
                {page && card}
                {list}
              </div>
            </div>
            {/* room for the pinned card, so nothing ends up under it */}
            {docked && <div aria-hidden style={{ height: cardH }} />}
            {!page && card}
          </div>
          {picked.length > 0 && (
            <BulkBar
              summary={t("space.selected", { n: picked.length,
                size: fmtBig(pickedSize) })}
              onClear={() => setSel(new Set())}
              actions={null}
              primary={
                <Button size="sm" onClick={() => onDone(picked)}
                  className="inline-flex min-h-9 items-center gap-1.5
                    whitespace-nowrap rounded-full">
                  {t("space.review")}
                </Button>} />
          )}
        </>
      )}
    </Modal>
  );
}

