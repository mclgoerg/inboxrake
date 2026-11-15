import { Info } from "lucide-react";
import { t } from "../i18n";
import type { AssistantAccess, AssistantLevel } from "../types";
import { Checkbox, Field, Input, Notice, RadioRow, Segmented, Stepper,
  Switch } from "./ui";

/* What an assistant connection may do: the choices of the "New access token"
 * dialog and of the consent page of a hosted app (#/connect), which differ
 * only in where the level ceiling comes from (the admin's cap / the cap cut to
 * what the app asked for). The parent owns the values and the submit. */

export const NAME_MAX = 60;
export const DAILY_DEFAULT = 2000;

export type Expiry = "30" | "90" | "never";

export interface Choices {
  name: string;
  accounts: Set<string>;
  level: AssistantLevel;
  subjects: boolean;
  expiry: Expiry;
  daily: number;
}

const RANK: Record<AssistantLevel, number> = { read: 0, propose: 1, act: 2 };

/** Whether tokens of `level` may work under the admin's cap. */
export const capAllows = (access: AssistantAccess,
    level: AssistantLevel): boolean =>
  access === "act" || (access === "read_propose" && level !== "act");

/** The highest of the offered levels the cap lets a token have (null = off). */
export const topLevel = (access: AssistantAccess,
    levels: AssistantLevel[]): AssistantLevel | null =>
  [...levels].reverse().find((l) => capAllows(access, l)) ?? null;

/** `expires_days` of the API for the expiry choice. */
export const expiryDays = (e: Expiry): 30 | 90 | null =>
  e === "never" ? null : e === "30" ? 30 : 90;

export const expiryOf = (days: number | null | undefined): Expiry =>
  days === null ? "never" : days === 30 ? "30" : "90";

/** The field errors of the choices (null = fine). */
export function choiceErrors(c: Choices):
    { name: string | null; accounts: string | null } {
  return {
    name: !c.name.trim() ? t("assistants.name_required") : null,
    accounts: c.accounts.size === 0 ? t("assistants.accounts_required") : null,
  };
}

export function TokenChoices({ value, onChange, accounts, levels, ceiling,
  capNote, touched, nameTaken = false, autoFocusName = false }: {
  value: Choices;
  onChange: (next: Choices) => void;
  accounts: string[];
  /** The levels on offer. */
  levels: AssistantLevel[];
  /** The highest level that may be picked; null = none. */
  ceiling: AssistantLevel | null;
  /** Why a level above the ceiling is disabled. */
  capNote: string;
  /** Show the field errors (after a first submit). */
  touched: boolean;
  /** The server said the name is already used. */
  nameTaken?: boolean;
  /** Only the token dialog focuses a field; the consent page focuses none, so
   *  an Enter or Space cannot decide for the user. */
  autoFocusName?: boolean;
}) {
  const set = (patch: Partial<Choices>) => onChange({ ...value, ...patch });
  const errors = choiceErrors(value);
  const nameError = nameTaken ? t("assistants.name_taken") : errors.name;
  const single = levels.length <= 1;
  const allowed = (l: AssistantLevel) =>
    ceiling !== null && RANK[l] <= RANK[ceiling];
  return (<>
    <div>
      <Field label={t("assistants.name")}>
        <Input className="w-full" value={value.name} maxLength={NAME_MAX}
          autoFocus={autoFocusName} aria-invalid={(touched || nameTaken)
            && !!nameError}
          placeholder={t("assistants.name_ph")}
          onChange={(e) => set({ name: e.target.value })} />
      </Field>
      {(touched || nameTaken) && nameError
        ? <p role="alert" className="mt-1 type-meta text-danger-fg">
          {nameError}</p>
        : <p className="mt-1 type-meta text-muted">
          {t("assistants.name_help")}</p>}
    </div>
    <fieldset className="min-w-0">
      <legend className="mb-1 type-meta text-muted">
        {t("assistants.accounts")}
      </legend>
      <div className="flex flex-wrap gap-x-4">
        {accounts.map((a) => (
          <Checkbox key={a} label={a} checked={value.accounts.has(a)}
            onChange={(e) => {
              const n = new Set(value.accounts);
              if (e.target.checked) n.add(a); else n.delete(a);
              set({ accounts: n });
            }} />
        ))}
      </div>
      {touched && errors.accounts && (
        <p role="alert" className="mt-1 type-meta text-danger-fg">
          {errors.accounts}</p>
      )}
    </fieldset>
    <div>
      <div className="mb-1 type-meta text-muted">
        {t("assistants.may_do")}
      </div>
      {single ? (
        <p className="type-body">
          <span className="font-medium">
            {t(`assistants.level.${levels[0] ?? "read"}`)}
          </span>
          {" - "}{t(`assistants.level_sub.${levels[0] ?? "read"}`)}
        </p>
      ) : (
        <div role="radiogroup" aria-label={t("assistants.may_do")}
          className="divide-y divide-line overflow-hidden rounded-card
            border border-line bg-panel">
          {levels.map((l) => (
            <RadioRow key={l} checked={value.level === l}
              disabled={!allowed(l)}
              label={t(`assistants.level_row.${l}`)}
              sub={allowed(l) ? t(`assistants.level_sub.${l}`) : capNote}
              onSelect={() => set({ level: l })} />
          ))}
        </div>
      )}
      {value.level === "act" && (<>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="type-body">{t("assistants.daily")}</span>
          <Stepper value={value.daily} onChange={(daily) => set({ daily })}
            min={100} max={10000} step={100} label={t("assistants.daily")}
            format={(n) => t("assistants.daily_fmt", { n })} />
        </div>
        <Notice tone="warn" className="mt-3"
          icon={<Info size={16} aria-hidden />}>
          {t("assistants.act_warn")}
        </Notice>
      </>)}
    </div>
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="type-body">{t("assistants.subjects")}</div>
        <p className="type-meta text-muted">
          {t("assistants.subjects_help")}
        </p>
      </div>
      <Switch checked={value.subjects} onChange={(subjects) =>
        set({ subjects })} label={t("assistants.subjects")} />
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="type-body">{t("assistants.expires")}</span>
      <Segmented<Expiry> role="radio" label={t("assistants.expires")}
        value={value.expiry} onChange={(expiry) => set({ expiry })}
        options={[
          { value: "30", label: t("assistants.exp.30") },
          { value: "90", label: t("assistants.exp.90") },
          { value: "never", label: t("assistants.exp.never") }]} />
    </div>
    <p className="type-meta text-muted">{t("assistants.provider_note")}</p>
  </>);
}
