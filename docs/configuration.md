---
title: "Configuration"
description: "Every environment variable Inboxrake reads."
---

# Configuration

Everything here is optional **bootstrap**. The settings UI can change all of
it at runtime and saves to the `/data` volume, which then wins over the
environment. Put the variables in the `.env` next to the starter compose
file ([`deploy/.env.example`](../deploy/.env.example)) or pass them with
`-e` to `docker run`.

## Server (INBOXRAKE_\*)

| Variable | Default | What it does |
|---|---|---|
| `INBOXRAKE_SECRET_KEY` | unset | Encrypts stored secrets (IMAP passwords, API keys, OIDC client secret, OAuth tokens) in `/data`. Any string works; generate one with `openssl rand -base64 32`. Unset means plaintext (a startup warning says so). Also required for the local body-search index. Keep it out of backups. |
| `INBOXRAKE_ALLOWED_HOSTS` | unset | Without a login only `localhost` and IP addresses are answered. List extra host names here: comma separated, exact names, `*.example.org` for subdomains, `*` for any. |
| `INBOXRAKE_MS_CLIENT_ID` | unset | Client ID of an administrator-provided Microsoft (Entra) public app; no such app ships with Inboxrake. When set, Outlook accounts sign in with a device code and need no app registration of their own. Leave it unset and each user registers their own app. |
| `INBOXRAKE_MS_TENANT` | `consumers` | Microsoft tenant for sign-in: a tenant ID or domain, `organizations` or `common` for work/school accounts. |
| `INBOXRAKE_BIND` | `127.0.0.1` | Read by the starter compose file only (not by the app): the host address the port is published on. Use `0.0.0.0` only after setting a login. |
| `INBOXRAKE_PUSH_CONTACT` | unset | Contact for the push services (RFC 8292 `sub`): a `mailto:` or `https:` address they can reach you at. Unset means the address the app is opened at, else a placeholder. |
| `INBOXRAKE_PUSH_HOSTS` | unset | Extra push service host suffixes (comma separated) the server may send to, on top of Apple, Google, Mozilla and Microsoft. Only needed for a browser with its own push service. |
| `INBOXRAKE_PUBLIC_URL` | unset | The address the internet reaches this server at, for [hosted AI apps over OAuth](assistants.md#connect-claudeai-or-chatgpt-oauth) (claude.ai, ChatGPT). Format `https://mail.home.example`: **https only**, a host name and optionally a port, **no path, no trailing slash**. Anything else counts as unset. It is the OAuth issuer and the audience of every hosted app's token, and is never read from `Host` or `X-Forwarded-*`. **Changing it ends every hosted-app connection** (the old tokens no longer match): remove the old connections and reconnect the apps. Restart after changing it. Not needed for tokens. |
| `INBOXRAKE_PORT` | `8765` | Read by the starter compose file only: the host port. |


## First mail account (headless setups)

Leave these unset to use the setup wizard instead. Set them only for a
setup that should come up configured; they bootstrap **one** account.

| Variable | Default | What it does |
|---|---|---|
| `IMAP_HOST` | `127.0.0.1` | IMAP server. |
| `IMAP_PORT` | `1143` | IMAP port. |
| `IMAP_SECURITY` | `ssl` | `ssl` or `starttls`. |
| `IMAP_USER` | empty | Login name. |
| `IMAP_PASSWORD` | empty | Password or app password. |
| `IMAP_CAFILE` | see text | CA file for self-signed certificates (Proton Bridge). Leave it **empty** for normal providers. When unset, Proton Bridge's usual path `/certs/bridge-cert.pem` is used only if that file exists. |
| `SMTP_HOST` | empty | SMTP server, used only to send unsubscribe mails. Empty means the IMAP host. |
| `SMTP_PORT` | `1025` | SMTP port. |
| `SMTP_SECURITY` | `auto` | `auto`, `ssl` or `starttls`. |

## Login

| Variable | Default | What it does |
|---|---|---|
| `AUTH_MODE` | `none` | `none`, `password` or `oidc`. A mode whose prerequisites are missing (no password, or no issuer / client ID / secret) falls back to `none`. |
| `AUTH_PASSWORD` | empty | The shared password for `password` mode (hashed with scrypt at start). |
| `OIDC_ISSUER` | empty | Issuer URL of your OpenID Connect provider. |
| `OIDC_CLIENT_ID` | empty | Client ID registered at the provider. |
| `OIDC_CLIENT_SECRET` | empty | Client secret. |
| `OIDC_ALLOWED` | empty | Comma-separated emails allowed to sign in. Empty admits any account at the provider. |
| `OIDC_REDIRECT_BASE` | empty | Only needed when auto-detection through `X-Forwarded-*` headers does not work. The callback is `<base>/api/oidc/callback`. |
| `OIDC_ADMIN` | empty | Identity that owns the pre-SSO workspace and the server settings. Empty means the first SSO login claims it. |

A login saved in Settings -> Sign-in & users wins over these variables; if
you forgot the password, see [the FAQ](faq.md#forgot-the-password). See
[Security & privacy](security.md) for what each mode protects.

Behind a reverse proxy, also set uvicorn's `FORWARDED_ALLOW_IPS` (default
`127.0.0.1,::1`; read by uvicorn, not by Inboxrake) to the proxy's address
or its network in CIDR form (the proxy's own address is safer than a whole
Docker subnet), so failed password logins are counted per
visitor instead of against the proxy. Never use `*`: the visitor could then
choose the address that is counted. Whatever is trusted must carry only the
proxy's traffic, so keep `INBOXRAKE_BIND=127.0.0.1` (the default) or do not
publish the port. Details in
[Security & privacy](security.md#password-login-throttling).

## AI review

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | API key for the optional AI review. Can also be set in Settings -> AI review. |
| `AI_MODEL` | `claude-sonnet-5` | Model name used for it. |

## Tuning and paths

| Variable | Default | What it does |
|---|---|---|
| `LOG_LEVEL` | `INFO` | Python log level. |
| `AUTOSCAN_INTERVAL` | `60` | Seconds between scheduler checks for due automatic scans. |
| `DIGEST_INTERVAL` | `1800` | Seconds between checks for a due digest. |
| `RULES_INTERVAL` | `600` | Seconds between checks for due rules. |
| `RULE_CAP` | `500` | Most mails one rule run may act on. |
| `NEW_SENDER_WINDOW_DAYS` | `7` | How long a sender counts as "new" (`is:new`). |
| `STATIC_DIR` | bundled UI | Where the built web UI is served from. |

State files default to names inside `/data` and normally need no change:

| Variable | Default file | What it holds |
|---|---|---|
| `CONFIG_PATH` | `config.json` | The accounts and their settings. |
| `SERVER_PATH` | `server.json` | Server-level settings (login and the shared AI). |
| `STATS_PATH` | `ai_usage.json` | AI usage. |
| `STATS_HISTORY_PATH` | `stats_history.json` | The cleanup history: per-scan snapshots and per-month action tallies. |
| `RULES_PATH` | `rules.json` | Your saved rules. |
| `AUTOSCAN_PATH` | `autoscan.json` | When each account's automatic scan last ran. |
| `DIGEST_PATH` | `digest.json` | When each account's activity digest was last sent. |
| `PRESETS_PATH` | `presets.json` | Saved filter presets. |
| `PINS_PATH` | `pinned_mails.json` | Pinned mails. |
| `ACCOUNT_COPY_PATH` | `account_copy.json` | The copy to another account (its progress, and which senders you already told). |
| `ACCOUNT_COPY_LEDGER_PATH` | `account_copy_ledger.jsonl` | Which mails of that copy are done, so it carries on after a restart without copying twice. |
| `ADDRESSES_PATH` | `addresses.json` | Your addresses: retired aliases and the "not a leak" marks (per user and account). |
| `ALIAS_SERVICE_PATH` | `alias_service.json` | The optional alias service (SimpleLogin or addy.io): the service, its API key (encrypted when `INBOXRAKE_SECRET_KEY` is set) and the last alias list (per user; not part of the settings export). |
| `PUSH_KEY_PATH` | `push_vapid_key.pem` | The instance's signing key for notifications, created on first use (keep it out of backups you share; a new one only means devices must turn notifications on again). |
| `PUSH_SUBS_PATH` | `push_subscriptions.json` | The devices registered for notifications (per user; not part of the settings export). |
| `REPLIED_PATH` | `replied.json` | Who you have written to (To/Cc of the Sent folder). |
| `VERDICTS_PATH` | `ai_verdicts.json` | Cached AI verdicts. |
| `AI_SORT_PATH` | `ai_sort.json` | Cached answers of the optional AI sorting. |
| `SENDER_KNOWLEDGE_PATH` | `sender_knowledge.json` | Where you (or the AI) filed a sender or a company. |
| `LABELS_PATH` | `sender_labels.json` | The verdicts and categories you set with "Edit labels". |
| `DUPS_PATH` | `duplicates_kept.json` | The duplicate sets you chose to keep. |
| `SUBS_PATH` | `subscriptions.json` | What you decided about [subscriptions](features.md#subscriptions): the ones marked "not a subscription", the reminders you asked for, and - only with the opt-in - the amounts read from a receipt (amount and currency, no text). |
| `SENDER_CHANGES_PATH` | `sender_changes.json` | The weekly mail counts per sender (about 26 weeks, numbers only: how many mails reached the mailbox each week) and the time of each sender's last mail, kept by each scan for [Sender changes](features.md#sender-changes) - per user and account. An older release ignores the file. |
| `RULE_CHECKUP_PATH` | `rule_checkup.json` | The Rule checkup findings you chose to Ignore (per user and account; a fingerprint of each finding, nothing from your mail). An older release ignores the file. |
| `KNOWN_SENDERS_PATH` | `known_senders.json` | Which senders were first seen when (for "new sender"). |
| `UNSUB_STATE_PATH` | `unsub_state.json` | Which senders you already unsubscribed from. |
| `AUDIT_LOG_PATH` | `audit_log.jsonl` | The append-only log of every action on a mailbox. |
| `SESSION_SECRET_PATH` | `session_secret` | The secret behind login sessions. |
| `TENANTS_DIR` | `tenants` | One isolated folder per additional SSO user (the admin keeps the top-level files in `/data`). |
| `SNAPSHOT_DIR` | `/data` | The scan caches. |

## Settings with no environment variable

Some options exist only in the UI and are stored with the account in `/data`
(or, for the browser ones, in your browser):

| Setting | Where | What it does |
|---|---|---|
| Digest **Link to Inboxrake** | Settings -> Activity digest, per account (`digest.url`) | The address the digest mail's buttons open: `http://` or `https://`, no `?` or `#`, at most 300 characters. Empty leaves the buttons out. |
| Digest **Language of the mail** | Settings -> Activity digest, per account (`digest.lang`) | `en` or `de`. Not chosen yet means English until the section is saved. |
| **Assistant access** | Settings -> AI assistants, admin only (`assistants.access` in `server.json`) | Whether AI assistants may connect to the [MCP endpoint](assistants.md) at all: Off (default; `/mcp` answers 404) or On (read, and propose rules for the user to approve). Users create their own access tokens there. |
| **Let hosted apps connect** | Settings -> AI assistants, admin only (`assistants.oauth` in `server.json`) | Whether claude.ai, ChatGPT and other hosted apps may connect over [OAuth](assistants.md#connect-claudeai-or-chatgpt-oauth). Off by default; there is no environment variable. It can only be switched on with a login (password or SSO), a valid `INBOXRAKE_PUBLIC_URL` and assistant access not Off, and acts as off again if one of those stops holding (the connections are kept). |
| **Notify me about proposals** | Settings -> AI assistants, per user (`assistants_notify.email` in the user's config) | Whether a mail is sent when an assistant proposes a rule. On by default; at most one mail every 10 minutes, sent with the proposal's account to the digest recipient (or the account's own address), with a link built from the digest's **Link to Inboxrake**. |
| **Find amounts in the receipt text** | Settings -> General, per account (`subscriptions.json`) | Off by default. On: Insights -> Subscriptions reads the text of the latest receipt of a subscription whose subject names no amount, on this server only, and keeps only the amount and its currency. Off forgets the amounts found. |
| **Number format** | Settings -> General, this browser only | Automatic (follows the language) or a pinned style. Not part of the backup. |
