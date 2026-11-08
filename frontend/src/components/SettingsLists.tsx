import { CircleMinus, CirclePlus, Pencil, RotateCcw, Trash2, X }
  from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { t } from "../i18n";
import { Avatar, Button, Input, SettingsGroup, SettingsRow, Switch, Tag }
  from "./ui";

/* The two list editors of Settings: Protected senders and Custom
 * categories. Both stay a plain text underneath (one entry / "name: kw1, kw2"
 * per line) - the exact value that is staged, compared and saved - and only
 * edit it through add / remove / rename, so nothing about what is stored
 * changed. */

/** Give focus back after the element it left has been put back. */
const refocus = (el: HTMLElement | null) =>
  requestAnimationFrame(() => el?.focus());

/** What an add handler answers: null = took it all; a message = refused;
 *  `rest` = took part of it, `rest` is what is still to fix. */
type AddResult = string | null | { error: string; rest: string };

/** A "+ Add …" row that turns into an inline input (Enter adds, Esc closes).
 *  `onSubmit` gets the typed text and returns an error message, or null when
 *  it took the value. `keepOpen` stays open for the next entry; `multi`
 *  takes a pasted block of several lines at once (a text input would
 *  otherwise glue them into one line). */
function InlineAdd({ label, placeholder, onSubmit, keepOpen = false,
  multi = false }: {
  label: string; placeholder: string;
  onSubmit: (raw: string) => AddResult;
  keepOpen?: boolean; multi?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false); setVal(""); setErr("");
    refocus(trigger.current);
  };
  const submit = (raw: string) => {
    const e = onSubmit(raw);
    if (e && typeof e === "object") { setVal(e.rest); setErr(e.error); return; }
    if (e) { setErr(e); return; }
    setVal(""); setErr("");
    if (keepOpen) return;
    close();
  };
  if (!open) {
    return (
      <button ref={trigger} type="button" onClick={() => setOpen(true)}
        className="flex min-h-12 w-full cursor-pointer items-center gap-3
          px-4 py-2.5 text-left type-body text-accent transition-colors
          hover:bg-panel2">
        <CirclePlus size={18} aria-hidden className="shrink-0" />
        {label}
      </button>
    );
  }
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input autoFocus className="min-w-0 flex-1 basis-48" value={val}
          aria-label={label} placeholder={placeholder}
          aria-invalid={err ? true : undefined}
          onChange={(e) => { setVal(e.target.value); setErr(""); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && val.trim()) {
              e.preventDefault();
              submit(val);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (!multi || !/[\r\n]/.test(text)) return;
            e.preventDefault();
            submit(text);
          }} />
        <Button size="sm" disabled={!val.trim()} onClick={() => submit(val)}>
          {t("settings.add")}
        </Button>
        <Button size="sm" variant="secondary" onClick={close}>
          {t("Cancel")}
        </Button>
      </div>
      {err && (
        <p role="alert" className="mt-1.5 type-meta text-danger-fg">{err}</p>
      )}
    </div>
  );
}

/* ----------------------------- protected senders ---------------------------- */

// What the server stores (`normalize_protected`): any address or domain
// without blanks; the shapes below only rule out the meaningless ones.
const ADDRESS = /^[^\s@]+@[^\s@]+$/;
const DOMAIN = /^@[^\s@]+$/;

/** The entries of the stored text (one per line). */
export const protectedEntries = (text: string): string[] =>
  text.split("\n").map((s) => s.trim()).filter(Boolean);

/** One typed or pasted entry as it is stored: lower case, a bare domain
 *  gets its "@" (what the server does as well, so `user@localhost` and
 *  `@intranet` are fine); null = neither an address nor a domain. */
export function normalizeProtected(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  const v = e.includes("@") ? e : `@${e}`;
  return ADDRESS.test(v) || DOMAIN.test(v) ? v : null;
}

/** Protected senders as a list: avatar (or "@" for a whole domain), the
 *  address or "Everyone at <domain>", a remove button, and an "Add address
 *  or domain…" row. `text` is the stored value (one entry per line). */
export function ProtectedList({ text, onChange }: {
  text: string; onChange: (text: string) => void;
}) {
  const entries = protectedEntries(text);
  const add = (raw: string): AddResult => {
    const typed = raw.split(/[\s,;]+/).filter(Boolean);
    const next: string[] = [];
    const bad: string[] = [];
    for (const piece of typed) {
      const v = normalizeProtected(piece);
      if (!v) bad.push(piece);
      else if (!entries.includes(v) && !next.includes(v)) next.push(v);
    }
    if (next.length) onChange([...entries, ...next].join("\n"));
    if (bad.length) {
      const error = t("protected.err_invalid", { entry: bad.join(", ") });
      return next.length ? { error, rest: bad.join("\n") } : error;
    }
    return next.length ? null
      : t("protected.err_dup", { entry: typed.join(", ") });
  };
  return (
    <SettingsGroup footnote={t("protected.help")}>
      {entries.map((e, i) => (
        <SettingsRow key={e}
          icon={e.startsWith("@")
            ? <span className="inline-flex size-8 shrink-0 items-center
                justify-center rounded-full bg-chip type-meta font-semibold
                text-chiptext">@</span>
            : <Avatar name={e} size="md" />}
          label={e.startsWith("@")
            ? <>{t("protected.everyone")} <b>{e.slice(1)}</b></> : e}>
          <button type="button" aria-label={t("protected.remove", { entry: e })}
            title={t("protected.remove", { entry: e })}
            onClick={() => onChange(entries.filter((_, j) => j !== i)
              .join("\n"))}
            className="inline-flex min-h-11 min-w-11 cursor-pointer
              items-center justify-center rounded-full text-muted
              transition-colors hover:text-danger-fg">
            <CircleMinus size={18} aria-hidden />
          </button>
        </SettingsRow>
      ))}
      <InlineAdd label={t("protected.add")} placeholder={t("protected.add_ph")}
        onSubmit={add} keepOpen multi />
    </SettingsGroup>
  );
}

/* ------------------------------ custom categories ---------------------------- */

/** The categories the backend ships (`mailops.CATEGORY_RULES`). A custom
 *  category with one of these names replaces its keywords; with no keywords
 *  it turns that built-in off. */
export const BUILTIN_CATEGORIES = ["shipping", "finance", "shopping",
  "social", "travel", "dev/cloud"];

export type Category = { name: string; kws: string[] };

/** Parse the stored text ("name: kw1, kw2" per line; lines without a name
 *  before the colon are ignored). Names and keywords are lower-cased; a name
 *  that repeats keeps its first place and its last keywords. */
export function parseCategories(text: string): Category[] {
  const out = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!name) continue;
    out.set(name, line.slice(i + 1).split(",")
      .map((s) => s.trim().toLowerCase()).filter(Boolean));
  }
  return [...out].map(([name, kws]) => ({ name, kws }));
}

export const categoriesText = (cats: Category[]): string =>
  cats.map((c) => `${c.name}: ${c.kws.join(", ")}`).join("\n");

const CHIP_X = `inline-flex min-h-8 min-w-8 cursor-pointer items-center
  justify-center rounded-full text-muted transition-colors
  hover:text-danger-fg coarse:min-h-11 coarse:min-w-11`;
const ICON_BTN = `inline-flex min-h-11 min-w-11 cursor-pointer items-center
  justify-center rounded-full text-muted transition-colors hover:text-body`;

/** One category: name (renamable), keyword chips with × and "+ keyword", and
 *  for a built-in name the on / off switch ("off" = the stored empty list). */
function CategoryRow({ cat, builtin, stored, startAdding, nameError, onChange,
  onRename, onToggle, onDelete }: {
  cat: Category; builtin: boolean;
  /** In the text (an override); false = a built-in added by name that
   *  stores nothing until it has a keyword. */
  stored: boolean; startAdding: boolean;
  nameError: (name: string) => string | null;
  onChange: (kws: string[]) => void;
  onRename: (name: string) => void;
  onToggle: (on: boolean) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(cat.name);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(startAdding);
  const [kw, setKw] = useState("");
  const addBtn = useRef<HTMLButtonElement>(null);
  const off = builtin && stored && cat.kws.length === 0;
  const addKeywords = (raw: string) => {
    const more = raw.split(",").map((s) => s.trim().toLowerCase())
      .filter((s) => s && !cat.kws.includes(s));
    if (more.length) onChange([...cat.kws, ...new Set(more)]);
    setKw("");
  };
  const commitRename = () => {
    const name = draft.trim().toLowerCase();
    if (name === cat.name) { setRenaming(false); return; }
    const e = nameError(name);
    if (e) { setErr(e); return; }
    setRenaming(false);
    onRename(name);
  };
  return (
    <div role="group" aria-label={cat.name} className="px-4 py-2.5">
      <div className="flex items-center gap-2">
        {renaming ? (
          <Input autoFocus className="min-w-0 flex-1" value={draft}
            aria-label={t("categories.rename", { name: cat.name })}
            aria-invalid={err ? true : undefined}
            onChange={(e) => { setDraft(e.target.value); setErr(""); }}
            onBlur={() => setRenaming(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(); }
              else if (e.key === "Escape") {
                e.preventDefault();
                setRenaming(false);
              }
            }} />
        ) : (
          <span className="min-w-0 flex-1 truncate type-body font-semibold">
            {cat.name}
          </span>
        )}
        {builtin && !renaming && <Tag>{t("categories.builtin")}</Tag>}
        {builtin && !renaming && (
          // off = the stored empty list (only this switch makes it); on
          // again drops the override, so the built-in keywords are back
          <Switch checked={!off}
            label={t("categories.enabled", { name: cat.name })}
            onChange={onToggle} />
        )}
        {!renaming && (
          <button type="button" className={ICON_BTN}
            aria-label={t("categories.rename", { name: cat.name })}
            title={t("categories.rename", { name: cat.name })}
            onClick={() => { setDraft(cat.name); setErr("");
              setRenaming(true); }}>
            <Pencil size={16} aria-hidden />
          </button>
        )}
        {!renaming && !off && (builtin ? stored : true) && (
          <button type="button" className={ICON_BTN}
            aria-label={t(builtin ? "categories.restore"
              : "categories.delete", { name: cat.name })}
            title={t(builtin ? "categories.restore"
              : "categories.delete", { name: cat.name })}
            onClick={onDelete}>
            {builtin ? <RotateCcw size={16} aria-hidden />
              : <Trash2 size={16} aria-hidden />}
          </button>
        )}
      </div>
      {err && (
        <p role="alert" className="mt-1 type-meta text-danger-fg">{err}</p>
      )}
      {off ? (
        <p className="mt-1 type-meta text-muted">{t("categories.off")}</p>
      ) : (<>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {cat.kws.map((k) => (
            <span key={k} className="inline-flex items-center rounded-full
              bg-chip pl-3 type-meta">
              {k}
              <button type="button" className={CHIP_X}
                aria-label={t("categories.kw_remove",
                  { kw: k, name: cat.name })}
                onClick={() => onChange(cat.kws.filter((x) => x !== k))}>
                <X size={14} aria-hidden />
              </button>
            </span>
          ))}
          {adding ? (
            <Input autoFocus className="w-36"
              value={kw} placeholder={t("categories.kw_ph")}
              aria-label={t("categories.kw_add_to", { name: cat.name })}
              onChange={(e) => setKw(e.target.value)}
              onBlur={() => { addKeywords(kw); setAdding(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addKeywords(kw); }
                else if (e.key === "Escape") {
                  e.preventDefault();
                  setKw("");
                  setAdding(false);
                  refocus(addBtn.current);
                }
              }} />
          ) : (
            <button ref={addBtn} type="button" onClick={() => setAdding(true)}
              aria-label={t("categories.kw_add_to", { name: cat.name })}
              className="inline-flex min-h-8 cursor-pointer items-center
                gap-1 rounded-full px-2 type-meta text-accent
                transition-colors hover:bg-chip coarse:min-h-11">
              <CirclePlus size={14} aria-hidden />
              {t("categories.kw_ph")}
            </button>
          )}
        </div>
        {builtin ? (
          <p className="mt-1 type-meta text-muted">{t("categories.replaced")}</p>
        ) : cat.kws.length === 0 && (
          <p className="mt-1 type-meta text-muted">{t("categories.no_kw")}</p>
        )}
      </>)}
    </div>
  );
}

/** Custom categories as one row per category (see `CategoryRow`), plus an
 *  "Add category…" row. `text` is the stored value ("name: kw1, kw2" per
 *  line, an empty list = a built-in turned off). */
export function CategoryList({ text, onChange }: {
  text: string; onChange: (text: string) => void;
}): ReactNode {
  const cats = parseCategories(text);
  const [fresh, setFresh] = useState<string | null>(null);
  // Built-ins shown without an override (added by name, or just given back
  // their keywords): they are not in the text.
  const [bare, setBare] = useState<string[]>([]);
  const shown = [...cats.map((c) => ({ ...c, stored: true })),
    ...bare.filter((n) => !cats.some((c) => c.name === n))
      .map((name) => ({ name, kws: [] as string[], stored: false }))];
  const set = (next: Category[]) => onChange(categoriesText(next));
  const unbare = (name: string) => setBare((b) => b.filter((n) => n !== name));
  const nameError = (name: string): string | null =>
    !name ? t("categories.err_empty")
      : name.includes(":") ? t("categories.err_colon")
      : shown.some((c) => c.name === name)
        ? t("categories.err_dup", { name }) : null;
  return (
    <SettingsGroup footnote={t("categories.help")}>
      {shown.length === 0 && (
        <p className="px-4 py-3 type-body text-muted">{t("categories.none")}</p>
      )}
      {shown.map((c) => {
        const builtin = BUILTIN_CATEGORIES.includes(c.name);
        const i = cats.findIndex((x) => x.name === c.name);
        return (
          <CategoryRow key={c.name} cat={c} builtin={builtin}
            stored={c.stored} startAdding={fresh === c.name}
            nameError={nameError}
            onChange={(kws) => {
              if (builtin && kws.length === 0) {
                // the last chip of an override goes: the override goes
                // with it (the built-in keywords are back), it is not "off"
                set(cats.filter((_, j) => j !== i));
                setBare((b) => [...b, c.name]);
              } else if (c.stored) {
                set(cats.map((x, j) => j === i ? { ...x, kws } : x));
              } else {
                unbare(c.name);
                set([...cats, { name: c.name, kws }]);
              }
            }}
            onRename={(name) => {
              if (c.stored) set(cats.map((x, j) => j === i ? { ...x, name } : x));
              else { unbare(c.name); set([...cats, { name, kws: [] }]); }
            }}
            onDelete={() => {
              unbare(c.name);
              if (c.stored) set(cats.filter((_, j) => j !== i));
            }}
            // the switch: off = the empty-list override, on = no override
            onToggle={(on) => {
              if (on) {
                set(cats.filter((_, j) => j !== i));
                setBare((b) => [...b, c.name]);
              } else {
                unbare(c.name);
                set(c.stored ? cats.map((x, j) =>
                  j === i ? { ...x, kws: [] } : x)
                  : [...cats, { name: c.name, kws: [] }]);
              }
            }} />
        );
      })}
      <InlineAdd label={t("categories.add")} placeholder={t("categories.add_ph")}
        onSubmit={(raw) => {
          const name = raw.trim().toLowerCase();
          const e = nameError(name);
          if (e) return e;
          setFresh(name);
          // a built-in name starts ON and stores nothing until it has a keyword
          if (BUILTIN_CATEGORIES.includes(name)) setBare((b) => [...b, name]);
          else set([...cats, { name, kws: [] }]);
          return null;
        }} />
    </SettingsGroup>
  );
}
