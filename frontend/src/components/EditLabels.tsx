import { Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { t } from "../i18n";
import { FILE_KINDS, filedKindName } from "../smart";
import type { Group, KnowledgeEntry, SenderLabels, Verdict } from "../types";
import { currentFiling } from "./SenderFiling";
import type { FileEntry } from "./SenderList";
import { Button, cap, Input, Loading, Modal, PopupSelect, SectionLabel,
  Segmented, useOptionalToast } from "./ui";

const VERDICTS: Verdict[] = ["delete_safe", "review", "keep"];
const VERDICT_FG: Record<Verdict, string> = {
  delete_safe: "text-safe-fg", review: "text-review-fg", keep: "text-info-fg",
};
const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** A removable category chip: the name and a 44 px (touch) remove button. */
function TagChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-chip
      pl-3 type-meta text-chiptext">
      {name}
      <button type="button" aria-label={t("labels.remove", { name })}
        onClick={onRemove}
        className="inline-flex size-8 cursor-pointer items-center
          justify-center rounded-full text-muted hover:text-body coarse:size-11">
        <X size={14} aria-hidden />
      </button>
    </span>
  );
}

/** "Edit labels": the user's own verdict, categories and Smart group for ONE
 *  sender (desktop dialog / phone bottom sheet). Everything is staged until
 *  Done; Cancel / Esc discard. The user's verdict wins over the AI, survives
 *  rescans and never makes a protected sender "safe" (backend labelstore.py);
 *  "Reset to automatic" puts verdict and categories back to what the AI and
 *  the keyword rules say. The Smart group is the existing sender filing
 *  (`onFile` / `onReset` = the knowledge API, with its own Undo toast). */
export function EditLabels({ senderKey, sender, categories, onFile, onReset,
  onSaved, onClose }: {
  senderKey: string;                   // the sender's address
  sender?: Group;                      // its live record (Smart placement)
  categories: string[];                // the user's own categories (filing)
  onFile?: (entries: FileEntry[], senders: number) => Promise<boolean>;
  onReset?: (keys: string[]) => Promise<boolean>;
  onSaved: () => void;                 // something changed: reload the state
  onClose: () => void;
}) {
  const toast = useOptionalToast();
  const titleId = useId();
  const [info, setInfo] = useState<SenderLabels | null>(null);
  const [failed, setFailed] = useState(false);
  const [entries, setEntries] = useState<Map<string, KnowledgeEntry>>(new Map());
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [filing, setFiling] = useState<string | null>(null);   // null: untouched
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.labels(senderKey).then((l) => {
      if (!alive) return;
      setInfo(l);
      setVerdict(l.verdict);
      setTags(l.tags_now);
    }).catch(() => alive && setFailed(true));
    if (sender) {
      api.knowledge()
        .then((r) => alive && setEntries(new Map(r.entries.map((e) => [e.key, e]))))
        .catch(() => { /* the select still shows where the sender sits */ });
    }
    return () => { alive = false; };
  }, [senderKey, !!sender]);

  const filed = sender ? currentFiling(sender, entries) : null;
  const filedNow = filing ?? filed?.mine ?? "auto";
  const knownKinds = new Set<string>([...FILE_KINDS,
    ...categories.map((c) => `cat:${c}`)]);
  const canFile = !!sender && !!onFile && !!onReset;

  const verdictChanged = !!info && verdict !== info.verdict;
  const tagsChanged = !!info && !sameList(tags, info.tags_now);
  const filingChanged = filing !== null && filing !== filed?.mine;
  const automatic = !!info && verdict === null
    && sameList(tags, info.auto_tags);

  const addTag = (raw: string) => {
    const name = raw.trim().replace(/\s+/g, " ").toLowerCase();
    if (name && !tags.includes(name)) setTags([...tags, name]);
    setDraft("");
  };
  const submitDraft = () => { addTag(draft); setAdding(false); };

  const save = async () => {
    if (!info || busy) return;
    setBusy(true);
    setError("");
    try {
      let changed = false;
      if (verdictChanged || tagsChanged) {
        await api.labelsPut({ key: senderKey,
          ...(verdictChanged ? { verdict } : {}),
          // back on the automatic list = no override at all
          ...(tagsChanged ? { tags: sameList(tags, info.auto_tags)
            ? null : tags } : {}) });
        changed = true;
      }
      if (filingChanged && canFile) {
        const ok = filing === "auto"
          ? (filed?.own ? await onReset!([filed.own.key]) : true)
          : await onFile!([{ key: `a:${senderKey}`, kind: filing! }], 1);
        if (!ok) { setBusy(false); if (changed) onSaved(); return; }
        changed = true;
      }
      if (verdictChanged || tagsChanged) toast?.show(t("labels.saved"),
        { variant: "success" });
      if (changed) onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusy(false);
    }
  };

  const protectedNote = info?.protected ? t("labels.protected") : "";
  const verdictName = (v: Verdict) => cap(t(`v.${v}`));
  const aiLine = !info ? null : verdict ? (
    <>
      {info.ai ? (
        <>{t("labels.ai_said")}{" "}
          <span className={`font-semibold ${VERDICT_FG[info.ai.verdict]}`}>
            {verdictName(info.ai.verdict)}</span></>
      ) : t("labels.ai_none")}
      {" · "}{t("labels.wins")}
    </>
  ) : (
    <>
      {t("labels.auto")}{" "}
      {info.ai ? (
        <>{t("labels.ai_said")}{" "}
          <span className={`font-semibold ${VERDICT_FG[info.ai.verdict]}`}>
            {verdictName(info.ai.verdict)}</span>.</>
      ) : t("labels.ai_none")}
    </>
  );
  const suggestions = (info?.suggestions ?? []).filter((s) => !tags.includes(s));

  // Portaled to <body>: the detail pane (>= 1280 px) is a side column, and a
  // dialog inside it would dim and trap only that column.
  return createPortal(
    <Modal size="sm" labelledBy={titleId} onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <Button variant="plain" size="sm" onClick={onClose}
            className="-ml-2.5 sm:hidden">{t("Cancel")}</Button>
          <h2 id={titleId}
            className="min-w-0 flex-1 truncate text-center type-heading sm:text-left">
            {t("labels.title")}
          </h2>
          <span aria-hidden className="w-12 sm:hidden" />
        </div>

        {failed ? (
          <p role="alert" className="type-body text-danger-fg">
            {t("labels.load_failed")}</p>
        ) : !info ? (
          <Loading label={t("labels.loading")} />
        ) : (
          <>
            <section className="space-y-2">
              <SectionLabel>{t("labels.verdict")}</SectionLabel>
              <Segmented<Verdict> fill equal tall role="radio"
                label={t("labels.verdict_aria")} value={verdict}
                onChange={setVerdict}
                options={VERDICTS.map((v) => ({ value: v,
                  label: t(`labels.opt_${v === "delete_safe" ? "safe" : v}`),
                  // a protected sender is never "safe to delete"
                  disabled: v === "delete_safe" && info.protected,
                  describedBy: v === "delete_safe" && info.protected
                    ? `${titleId}-prot` : undefined }))} />
              {protectedNote && (
                <p id={`${titleId}-prot`} className="type-meta text-muted">
                  {protectedNote}</p>
              )}
              <p className="type-meta text-muted">{aiLine}</p>
            </section>

            <section className="space-y-2">
              <SectionLabel>{t("labels.categories")}</SectionLabel>
              <div className="flex flex-wrap items-center gap-2">
                {tags.length === 0 && !adding && (
                  <span className="type-meta text-muted">{t("labels.none")}</span>
                )}
                {tags.map((name) => (
                  <TagChip key={name} name={name}
                    onRemove={() => setTags(tags.filter((x) => x !== name))} />
                ))}
                {adding ? (
                  <form className="flex items-center gap-1.5"
                    onSubmit={(e) => { e.preventDefault(); submitDraft(); }}>
                    <Input autoFocus value={draft} maxLength={40}
                      className="w-40" aria-label={t("labels.add_aria")}
                      placeholder={t("labels.add_placeholder")}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        // Esc closes the field, not the whole sheet
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          setDraft("");
                          setAdding(false);
                        }
                      }} />
                    <Button type="submit" variant="secondary" size="sm">
                      {t("labels.add_confirm")}
                    </Button>
                  </form>
                ) : (
                  <Button variant="plain" size="sm" onClick={() => setAdding(true)}>
                    <span className="inline-flex items-center gap-1">
                      <Plus size={14} aria-hidden /> {t("labels.add")}
                    </span>
                  </Button>
                )}
              </div>
              {suggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5
                  type-meta text-muted">
                  <span>{t("labels.suggestions")}</span>
                  {suggestions.map((name) => (
                    <button key={name} type="button"
                      aria-label={t("labels.suggest_add", { name })}
                      onClick={() => addTag(name)}
                      className="min-h-6 cursor-pointer rounded-badge px-1
                        text-accent hover:text-accenth coarse:min-h-11">
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {canFile && (
              <section className="space-y-2">
                <SectionLabel>{t("labels.smart")}</SectionLabel>
                <div className="flex items-center justify-between gap-3">
                  <span className="type-body">{t("labels.filed_under")}</span>
                  <PopupSelect<string> value={filedNow} className="w-48"
                    name={t("labels.filed_under")} disabled={busy}
                    onChange={setFiling}
                    options={[
                      { value: "auto", label: t("know.box_auto") },
                      ...FILE_KINDS.map((k) => ({ value: k,
                        label: filedKindName(k) })),
                      ...categories.map((c) => ({ value: `cat:${c}`,
                        label: filedKindName(`cat:${c}`) })),
                      ...(filedNow !== "auto" && !knownKinds.has(filedNow)
                        ? [{ value: filedNow, label: filedKindName(filedNow) }]
                        : []),
                    ]} />
                </div>
              </section>
            )}

            {error && (
              <p role="alert" className="type-meta text-danger-fg">{error}</p>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3
        sm:px-5">
        <Button variant="plain" size="sm"
          disabled={!info || busy || automatic}
          onClick={() => { setVerdict(null); setTags(info!.auto_tags); }}>
          {t("labels.reset")}
        </Button>
        <Button variant="secondary" className="ml-auto max-sm:hidden"
          onClick={onClose}>{t("Cancel")}</Button>
        <Button disabled={!info || busy} onClick={save}
          className="max-sm:ml-auto">
          {t("labels.done")}
        </Button>
      </div>
    </Modal>,
    document.body);
}
