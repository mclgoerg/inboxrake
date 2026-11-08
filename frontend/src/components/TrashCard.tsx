import { Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText, fmtSize } from "../api";
import { t } from "../i18n";
import type { Rule, TrashResp } from "../types";
import { Button, confirmDialog, IconTile, SettingsGroup, SettingsRow,
  Stepper, Switch, useToast } from "./ui";

/** What the switch starts with (the purge-rule default of rules.py). */
const DEFAULT_DAYS = 30;

/** The standing purge rule behind the "Empty automatically" switch: Trash,
 *  every sender, by age only, once a day. A rule you made yourself in Rules
 *  that reads the same is the same thing, so it is found and shown here. */
export function autoEmptyRule(rules: Rule[]): Rule | undefined {
  const same = rules.filter((r) => r.scope === "trash"
    && r.action === "purge" && r.schedule === "daily" && !r.query.trim()
    && r.keep_latest == null && r.older_than_days != null);
  return same.find((r) => r.mode === "execute") ?? same[0];
}

/** The size card of the Trash page: how much the folder holds, and the
 *  "Empty automatically" switch.
 *
 *  The switch is a purge rule (scope trash, `older_than_days`, daily) made
 *  through the rules API and it deletes mail for good, so it keeps the
 *  safety order of rules.py: the rule is created in REPORT mode, one report
 *  run says what it would delete right now, and only an explicit confirm of
 *  that preview arms it (`mode: "execute"`). Nothing here ever arms a rule
 *  by itself: changing the age sends an armed rule back to report on the
 *  server, and "Apply" goes through the same preview + confirm again; a
 *  declined confirm leaves a report-only rule (switch off), or removes the
 *  rule this click just created. Off = the rule is deleted. */
export function TrashCard({ list, rules, onChanged }: {
  list: TrashResp | null; rules: Rule[]; onChanged: () => void;
}) {
  const toast = useToast();
  const rule = autoEmptyRule(rules);
  const armed = rule?.mode === "execute";
  const [days, setDays] = useState(rule?.older_than_days ?? DEFAULT_DAYS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [next, setNext] = useState<{ count: number; size: number } | null>(
    null);

  // the age the rule really has wins over a stale draft
  const ruleDays = rule?.older_than_days ?? null;
  useEffect(() => { if (ruleDays != null) setDays(ruleDays); }, [ruleDays]);

  // "next run": what the armed rule would delete now - the same selection
  // as its report (old enough AND long enough in the folder), live
  useEffect(() => {
    if (!armed || ruleDays == null) { setNext(null); return; }
    let live = true;
    api.purgePreview("trash", { older_than_days: ruleDays }, ruleDays)
      .then((p) => { if (live) setNext({ count: p.count, size: p.size }); })
      .catch(() => { if (live) setNext(null); });
    return () => { live = false; };
  }, [armed, ruleDays, list?.total, list?.uv]);

  const total = list ? list.total : null;
  const size = list
    ? (list.senders ?? []).reduce((n, g) => n + g.size, 0)
      || list.mails.reduce((n, m) => n + m.size, 0)
    : 0;

  /** Report first, then arm on an explicit confirm of the preview. */
  const enable = async () => {
    let r = rule;
    let created = false;
    if (!r) {
      r = await api.createRule({
        name: t("fp.auto_rule_name"), scope: "trash", action: "purge",
        grouping: "sender", query: "", schedule: "daily",
        older_than_days: days });
      created = true;
    } else if (r.older_than_days !== days) {
      r = await api.updateRule(r.id, { older_than_days: days });
    }
    const undo = async () => { if (created) await api.deleteRule(r!.id); };
    let report;
    let cap = 500;
    try {
      report = await api.runRule(r.id);
      cap = (await api.rules()).cap;
    } catch (e) {
      await undo().catch(() => {});
      throw e;
    }
    const skipped = [
      report.skipped_protected > 0
        && t("fp.purge_b_protected", { n: report.skipped_protected }),
      report.skipped_pinned > 0
        && t("fp.purge_b_pinned", { n: report.skipped_pinned }),
    ].filter(Boolean) as string[];
    const sure = await confirmDialog({
      title: t("fp.auto_confirm_title"), tone: "danger",
      body: t("fp.auto_confirm_body", { n: days, cap }),
      bullets: [
        report.mails > 0
          ? t("fp.auto_now", { n: report.mails, size: fmtSize(report.size ?? 0) })
          : t("fp.auto_now_none"),
        ...skipped],
      confirmLabel: t("fp.auto_confirm_btn") });
    if (!sure) { await undo(); return; }
    await api.updateRule(r.id, { mode: "execute" });
    toast.show(t("fp.auto_on"), { variant: "success" });
  };

  const disable = async () => {
    if (rule) await api.deleteRule(rule.id);
    toast.show(t("fp.auto_off"));
  };

  const run = async (go: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try { await go(); }
    catch (e: any) { setErr(t("err.generic", { msg: e.message ?? e })); }
    setBusy(false);
    onChanged();
  };

  const last = rule?.last_run;
  const changed = armed && ruleDays != null && days !== ruleDays;
  return (
    <SettingsGroup className="mb-4">
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="type-largetitle tabular-nums">{fmtSize(size)}</span>
          {total != null && (
            <span className="type-meta text-muted">
              {t("fp.size_in_mails", { n: total })}
            </span>
          )}
        </div>
      </div>
      <SettingsRow icon={<IconTile tone="new"><Timer size={16} /></IconTile>}
        label={t("fp.auto_title")}
        sub={rule && !armed
          ? t("fp.auto_report_only")
          : t("fp.auto_sub", { n: armed ? ruleDays ?? days : days })}>
        <Switch checked={armed} disabled={busy}
          onChange={(on) => void run(on ? enable : disable)} />
      </SettingsRow>
      <SettingsRow label={t("fp.auto_days")}>
        <div className="flex items-center gap-2">
          {changed && (
            <Button size="sm" variant="tinted" disabled={busy}
              onClick={() => void run(enable)}>{t("fp.auto_apply")}</Button>
          )}
          <Stepper value={days} min={1} max={3650} disabled={busy}
            onChange={setDays}
            format={(n) => t("settings.n_days", { n })} />
        </div>
      </SettingsRow>
      {armed && (next || last || err) && (
        <div className="space-y-0.5 px-4 py-2.5 type-meta text-muted">
          {next && (
            <div>{next.count > 0
              ? t("fp.auto_next", { n: next.count, size: fmtSize(next.size) })
              : t("fp.auto_next_none")}</div>
          )}
          {last && !last.error && last.mode === "execute" && (
            <div>{last.acted > 0
              ? t("fp.auto_last", { n: last.acted })
              : t("fp.auto_last_none")}</div>
          )}
          {last?.error && (
            <div className="text-danger-fg">{errorText(last.error)}</div>
          )}
        </div>
      )}
      {err && (
        <div role="alert" className="px-4 py-2.5 type-meta text-danger-fg">
          {err}
        </div>
      )}
    </SettingsGroup>
  );
}
