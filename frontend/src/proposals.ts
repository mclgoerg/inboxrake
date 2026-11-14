/* Rules an AI assistant proposed (backend `propose_rule`): small helpers
 * shared by the Rules page, the badges and the alerts. */

import type { Rule } from "./types";

/** A proposal waiting for the user: assistant-made and still in report mode.
 *  (Once the user approved it, it is an ordinary active rule.) */
export const isProposal = (r: Rule): boolean =>
  r.origin === "mcp" && r.mode === "report";

/** The proposals waiting for the user, oldest first. */
export const openProposals = (rules: Rule[] | undefined): Rule[] =>
  (rules ?? []).filter(isProposal)
    .sort((a, b) => (a.proposed_by?.at ?? 0) - (b.proposed_by?.at ?? 0));
