import type { YourFoldersResp } from "./types";

/* The last Your folders answer per account and scan. The phone Clean up tab
 * shows how many folders there are and how many look worth tidying; asking
 * the mail server costs a connection, so it is asked once per scan - not on
 * every visit of the tab. The page itself refreshes the answer whenever it
 * reads the folders (a created or deleted folder changes no scan). */

const cache = new Map<string, { scan: number | null; data: YourFoldersResp }>();

/** The answer read for this account after this scan, if there is one. */
export const cachedFolders = (account: string,
  scan: number | null | undefined): YourFoldersResp | null => {
  const hit = cache.get(account);
  return hit && hit.scan === (scan ?? null) ? hit.data : null;
};

export const rememberFolders = (account: string,
  scan: number | null | undefined, data: YourFoldersResp): void => {
  cache.set(account, { scan: scan ?? null, data });
};

export const forgetFolders = (account?: string): void => {
  if (account === undefined) cache.clear(); else cache.delete(account);
};
