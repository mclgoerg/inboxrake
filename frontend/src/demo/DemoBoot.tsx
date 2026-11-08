/* The first-load screen of the in-browser demo: honest progress while the
 * backend downloads and starts, and a plain failure state (never a spinner
 * that spins forever). */

import { Check, Circle, Copy, Trash2, Users } from "lucide-react";
import { t } from "../i18n";
import { fmtNum } from "../numfmt";
import { Button, Notice, ProgressBar, Spinner } from "../components/ui";
import { STEPS, type StepId } from "./protocol";
import type { BootState } from "./runtime";

const LABEL: Record<StepId, string> = {
  download: "demo.boot.download",
  python: "demo.boot.python",
  libraries: "demo.boot.libraries",
  seed: "demo.boot.seed",
};

const TRY = [
  { icon: Users, key: "demo.boot.try1" },
  { icon: Trash2, key: "demo.boot.try2" },
  { icon: Copy, key: "demo.boot.try3" },
] as const;

const fmtMb = (n: number) => fmtNum(n, { digits: 1 });

export function DemoBoot({ state, onRetry }: {
  state: Exclude<BootState, { phase: "ready" }>; onRetry: () => void;
}) {
  const failed = state.phase === "failed";
  // Whole steps done, plus how far the (long) download got.
  const progress = failed ? 0 : state.done.length
    + (state.step === "download" && state.totalMb > 0
      ? Math.min(state.mb / state.totalMb, 1) : 0);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center
      justify-center gap-5 p-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width="64"
        height="64" className="shrink-0 rounded-dialog shadow-popover" />
      <div className="text-center">
        <h1 className="type-title2">{t("demo.boot.title")}</h1>
        <p className="mt-1 type-body text-muted">{t("demo.boot.privacy")}</p>
      </div>
      {failed ? (
        <>
          <Notice tone="danger" className="w-full">
            <p className="font-medium">{t("demo.fail.title")}</p>
            <p>{t(`demo.fail.${state.reason}`)}</p>
          </Notice>
          <Button onClick={onRetry}>{t("demo.retry")}</Button>
        </>
      ) : (
        <>
          <ProgressBar value={progress} max={STEPS.length}
            label={t("demo.boot.title")} />
          <ol className="flex w-full flex-col gap-2 type-body">
            {STEPS.map((s) => {
              const done = state.done.includes(s);
              const active = state.step === s;
              return (
                <li key={s} aria-current={active ? "step" : undefined}
                  className={`flex items-center gap-2.5 ${
                    done ? "text-muted" : active ? "font-semibold"
                      : "text-faint"}`}>
                  <span className="flex size-5 shrink-0 items-center
                    justify-center">
                    {done ? <Check size={16} aria-label={t("demo.boot.done")}
                        className="text-safe-fg" />
                      : active ? <Spinner />
                      : <Circle size={16} aria-hidden />}
                  </span>
                  <span>{t(LABEL[s])}</span>
                  {s === "download" && active && state.totalMb > 0 && (
                    <span className="ml-auto type-meta font-normal text-muted
                      tabular-nums">
                      {t("demo.boot.mb", { done: fmtMb(state.mb),
                        total: fmtMb(state.totalMb) })}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <section aria-labelledby="demo-boot-try"
            className="w-full rounded-card border border-line bg-panel p-4">
            <h2 id="demo-boot-try" className="type-body font-semibold">
              {t("demo.boot.try")}</h2>
            <ul className="mt-2 space-y-1.5 type-body text-muted">
              {TRY.map(({ icon: Icon, key }) => (
                <li key={key} className="flex items-center gap-2.5">
                  <Icon size={16} aria-hidden
                    className="shrink-0 text-accent" />
                  {t(key)}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <p className="text-center type-meta text-muted">{t("demo.boot.hint")}</p>
    </main>
  );
}
