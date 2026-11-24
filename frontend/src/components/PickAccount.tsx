import { ChevronRight, Users } from "lucide-react";
import { t } from "../i18n";
import type { Config } from "../types";
import { Avatar, Button, EmptyState, Modal, PanelHeader } from "./ui";

/** The account list of "Pick an account": what a page that works on ONE
 *  account at a time (Rules, Junk, Settings of an account ...) shows while
 *  All accounts is selected - never a dead end. Picking switches to that
 *  account and stays on the same page. */
export function PickAccountList({ cfg, page, onPick, onOverview }: {
  cfg: Config;
  /** The page's name ("Rules"). */
  page: string;
  onPick: (account: string) => void;
  /** Back to the Overview of all accounts (omitted where it is no step). */
  onOverview?: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-md p-4 sm:py-10">
      <EmptyState icon={<Users size={18} />} title={t("pick.title")}
        hint={t("pick.text", { page })} />
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-card
        border border-line bg-panel">
        {Object.entries(cfg.accounts).map(([name, im]) => (
          <li key={name}>
            <button type="button" onClick={() => onPick(name)}
              className="flex min-h-14 w-full items-center gap-3 px-3 py-2
                text-left enabled:hover:bg-panel2">
              <Avatar name={name} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate type-body font-medium">
                  {name}</span>
                <span className="block truncate type-meta text-muted">
                  {im.user}</span>
              </span>
              <ChevronRight size={16} aria-hidden
                className="shrink-0 text-faint" />
            </button>
          </li>
        ))}
      </ul>
      {onOverview && (
        <div className="mt-3 flex justify-center">
          <Button variant="quiet" onClick={onOverview}>
            {t("pick.back")}</Button>
        </div>
      )}
    </div>
  );
}

/** The same list in the place of a tool panel (a page from 1024 px, a
 *  full-screen / sheet modal below): the tool's own header, its close, and
 *  the list. */
export function PickAccountTool({ cfg, page, onPick, onClose }: {
  cfg: Config; page: string;
  onPick: (account: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} size="md" fit>
      <PanelHeader title={page} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PickAccountList cfg={cfg} page={page} onPick={onPick} />
      </div>
    </Modal>
  );
}
