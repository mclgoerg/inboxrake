import { ChevronRight, CircleCheck } from "lucide-react";
import { t } from "../i18n";
import { Button } from "./ui";

/** First row of a filtered result list (Gmail-style): "Select all N matches"
 *  adds every match - across all pages, protected groups stay out - to the
 *  selection; once they are all selected it reads "All N matches selected"
 *  with a Clear that removes exactly those again (the filter stays).
 *  `n` counts the matches that are not protected, `skipped` the protected
 *  ones. Not a list row: a plain button in tab order. */
export function SelectMatches({ n, skipped, allSelected, onSelect, onClear }: {
  n: number; skipped: number; allSelected: boolean;
  onSelect: () => void; onClear: () => void;
}) {
  const sub = skipped > 0 && (
    <span className="type-meta text-muted">
      {t("select.matches_protected", { n: skipped })}
    </span>
  );
  // Phones: title over sub line; from 768 px one left-aligned line.
  const text = (title: string) => (
    <span className="flex min-w-0 flex-col md:flex-row md:items-baseline
      md:gap-3">
      <span className="font-semibold text-accent">{title}</span>
      {sub}
    </span>
  );
  return (
    <div data-testid="select-matches" className="bg-accent-tint">
      {allSelected ? (
        <div className="flex items-center gap-3 px-3 py-2.5">
          <CircleCheck size={18} aria-hidden className="shrink-0 text-accent" />
          {text(t("select.matches_all", { n }))}
          <Button variant="plain" size="sm" className="ml-auto md:ml-0"
            onClick={onClear}>
            {t("select.matches_clear")}
          </Button>
        </div>
      ) : (
        <button type="button" onClick={onSelect}
          className="flex min-h-11 w-full items-center gap-3 px-3 py-2.5
            text-left type-body hover:bg-accent-tint">
          <CircleCheck size={18} aria-hidden className="shrink-0 text-accent" />
          {text(t("select.matches", { n }))}
          <ChevronRight size={16} aria-hidden
            className="ml-auto shrink-0 text-accent md:hidden" />
        </button>
      )}
    </div>
  );
}
