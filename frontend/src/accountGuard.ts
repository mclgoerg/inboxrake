/* Account-switch guard for work that outlives a render: a panel awaits a
 * preview, a confirm, a re-fetch - and meanwhile the user picks another
 * account. Every API call is scoped to the account that is active when it is
 * SENT, so a step that starts after the switch would apply what the old
 * account showed (keys, UIDs, a confirm that named its counts) to the new
 * one. `App.switchAccount` bumps the epoch; a flow takes a guard before its
 * first await and stands down when it reports a switch.
 *
 * Same idea as `accountGeneration` in App (actOn), reachable from panels
 * without threading a ref through every prop. */

let epoch = 0;

/** Called once per account switch (App.switchAccount). */
export const noteAccountSwitch = (): void => { epoch++; };

/** The current epoch: App's `accountGeneration` reads it, so there is one
 *  counter for the whole app. */
export const accountEpoch = (): number => epoch;

/** Take it before the first await: `const switched = accountGuard();`, then
 *  `if (switched()) return;` after each await and before every write. */
export const accountGuard = (): (() => boolean) => {
  const at = epoch;
  return () => at !== epoch;
};
