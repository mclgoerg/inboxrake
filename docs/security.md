---
title: "Security & privacy"
---

# Login, multi-user and secrets

Out of the box Inboxrake has **no login**: anyone who can reach the port
can read your mail metadata and reconfigure the IMAP host or AI endpoint
(and so read the stored credentials). Pick one of:

- keep the port on localhost, or behind a reverse proxy with its own
  authentication (Traefik + tinyauth/Authelia, ...), or
- turn on the built-in login in Settings -> Sign-in & users: a
  **password** (scrypt-hashed, session cookie), or **SSO via any OpenID
  Connect provider** (Pocket ID, Authentik, Keycloak, ...). Register the app
  at the provider with the callback URL `https://your-host/api/oidc/callback`,
  then enter issuer, client ID and secret. Both can also be bootstrapped
  from the environment (`AUTH_MODE`, `AUTH_PASSWORD`, `OIDC_*` - see
  [`deploy/.env.example`](../deploy/.env.example)).

Docker published ports bypass `ufw`, so a host firewall is not enough.

## Password login throttling

Password login allows 5 attempts per 15 minutes per client address (IPv6
per /64); further attempts get a "try again in N minutes" answer without
any password check, even with the right password. Attempts are counted
before the check, so parallel requests do not get around the limit. The
counters live in memory only: a restart forgives.

Inboxrake never trusts `X-Forwarded-For` itself. Behind a reverse proxy
every visitor therefore shares the proxy's address, so **5 wrong passwords
from anyone lock everyone out for 15 minutes**, unless uvicorn is told
which proxy to believe. Set `FORWARDED_ALLOW_IPS` in the container
environment to your proxy's address, or to its network in CIDR form (for
example the Docker network's subnet), and attempts are counted per visitor.
**Never set it to `*`**: uvicorn then believes the leftmost
`X-Forwarded-For` entry, which the visitor writes themselves (proxies
append to the header they received), so anyone can dodge the throttle by
sending a different fake address with every attempt.

The trusted address must carry **only the reverse proxy's traffic**. Prefer
the proxy container's own address over a whole Docker subnet: the subnet
includes its gateway, and anything that reaches the app through Docker's
own port forwarding (a process on the host, or IPv6 clients when the port
is published without IPv6 on the bridge) arrives from the gateway and
could then fake `X-Forwarded-For`. When a proxy fronts Inboxrake, keep
`INBOXRAKE_BIND=127.0.0.1` (the default) or do not publish the port at all.

## Behaviour worth knowing

- **Host check (no login only).** Without a login, Inboxrake refuses
  requests whose `Host` is not `localhost` or an IP address (protection
  against DNS rebinding), and refuses cross-site writes. To open it under a
  host name add `INBOXRAKE_ALLOWED_HOSTS=<name>` (comma list,
  `*.example.org` for subdomains) to the container environment. A blocked
  browser sees a page that says so.
- **Password mode** slows down repeated wrong passwords per client.
- **Sessions.** Changing the password, the login method, the allowed users,
  the admin or the identity provider (also via `.env` + restart) signs every
  browser out, as does Settings -> Sign-in & users -> *Sign out all sessions*. Logging
  out only clears that browser's cookie.
- **SSO and `email_verified`.** An identity returning an email must also return
  `email_verified: true`. Missing, false or malformed verification is refused.
  Tenant ownership uses the immutable issuer and provider subject, not email. Keep the allowed-users list filled: **empty means every
  account at the provider may sign in** and gets its own workspace (a startup
  warning says so).

## Multi-user (SSO mode)

With SSO enabled, **every signed-in identity gets its own isolated
workspace**: their own mail accounts, scans, AI verdicts, rules, statistics
and settings - nothing is shared or visible across users. One identity is the
**admin** (set `OIDC_ADMIN` or enter it in settings; first-login bootstrap
is allowed only with an allow-list containing exactly one identity): the admin owns the workspace that existed before SSO was enabled,
plus the server-level settings (login config and the optional **shared AI
key** - users without their own key can use the admin's, capped by a
per-user monthly budget). Password mode and "none" stay single-workspace.

## Secrets encryption at rest

Set `INBOXRAKE_SECRET_KEY` (e.g. `openssl rand -base64 32`) and every stored
secret - IMAP passwords, AI API keys, the OIDC client secret, OAuth client
secrets and tokens - is encrypted on disk (Fernet/AES). That protects
**volume backups**: without the key, a copied `/data` contains no usable
credentials. Keep the key in the environment only, never in the backups; if
it is lost, re-enter the secrets. Unset = plaintext (a startup log line
reminds you). The alias-service API key (below) is encrypted the same way.

## Microsoft tenant

Outlook / Microsoft 365 sign-in uses the `consumers` tenant by default
(personal accounts). For a work or school tenant set `INBOXRAKE_MS_TENANT`
to its tenant ID or domain (or `organizations` / `common`); the shared
client ID, if you run one, is `INBOXRAKE_MS_CLIENT_ID` (see
[install.md](install.md#microsoft-oauth-setup)).

## The safety promises

- **Nothing is deleted without asking.** Trashing is an IMAP move to the
  Trash folder, behind a confirmation (the mail count; a single protected
  group or pinned mail asks "anyway?" naming it instead). UIDVALIDITY is checked before acting on cached UIDs, and scans
  are read-only.
- **Moves normally offer Undo**, kept for 30 days (and written to the
  data volume, so a restart keeps them). When the server cannot identify
  the moved copies safely, the entry is kept and recovery must be done
  manually from the destination. The **Time machine** undoes several steps
  at once, newest first, and never touches protected senders or pinned
  mails.
  Permanent-delete actions in Trash and Junk cannot be undone. The manual ones confirm with exact counts; an opt-in
  purge rule only acts after you have reviewed a report run, then runs on
  its schedule within its age limit and per-run cap. Rules start in report
  mode too.
- **Protected senders and pinned mails:** rules and the Trash and Junk page
  purges always skip them. Moving a protected group, or a single pinned
  mail, to Trash asks for an extra confirmation. Individual-message moves
  refuse protected senders until they are unprotected in their group. **Empty Trash empties
  everything in Trash**, protected or not.
- **Accounts stay strictly separate** - an action never runs across
  accounts in one call (the All accounts page reads them side by side, then
  runs one step per account, each with its own Undo and Activity entry), and
  with SSO nothing is shared between users: each person sees only their own
  accounts there.

## What the optional AI review sends

Only mail **metadata**, and only to the AI provider you configure (a cloud
provider or a local model such as Ollama): sender names and addresses,
mail counts, sizes, dates, read state, category tags, subject lines,
protected-sender markers and whether you ever replied to a sender. Mail
bodies and attachments are never sent. AI sorting of the "Other" row sends,
per sender, its name and address, mail count, whether it offers an
unsubscribe link and up to three recent subject lines, plus your own sorting
instructions. Describing a filter in words sends only your sentence, the
filter syntax and the names of your tags. The review is off until you set it
up and consent in the UI.

## AI assistants (MCP)

The optional [MCP endpoint](assistants.md) lets an assistant you run read your
mailbox metadata. It is off by default (an admin switches it on), changes no
mail unless you also give a token the opt-in Act level, and authenticated by per-user bearer tokens (or, if you switch it on, [OAuth connections of claude.ai or ChatGPT](#hosted-apps-over-oauth-claudeai-chatgpt) with the same limits): stored as SHA-256, limited
to chosen accounts, optionally with subject lines, expiring, revocable, and
dead the moment their owner can no longer sign in. It returns no mail bodies,
no attachments, no unsubscribe links and none of your own tags or category
names, and offers no way to send, unsubscribe or delete for good. With the
Propose level it can leave a cleanup rule that waits in report mode: only you
can switch it on, from the app, and a token cannot. With the Act level it can
move mail, but only reversibly, from a preview of exact mails, never protected
or pinned mail, within a daily limit per token, with every step recorded and
undoable.

What it cannot control is the assistant. Whatever it reads goes to that
assistant's own AI provider, and sender names and subjects can carry
instructions aimed at the model (prompt injection). With no URL in any answer,
Inboxrake cannot be the way out, but another tool in the
same chat (web fetch, mail sending) could be: do not combine them. With Act, a
fooled assistant can still move mail to Trash up to its daily limit (you can
undo it): use Act only with an assistant you watch. Details,
limits and proxy advice are on the [assistants page](assistants.md#privacy).

### Hosted apps over OAuth (claude.ai, ChatGPT)

Optional and **off by default**. With the admin switch on, Inboxrake is its
own OAuth server for hosted AI apps, so that claude.ai or ChatGPT can ask
*you* for approval instead of using a token you paste. It is meant for an
instance that is already public with a login; it is refused without a login,
without an https `INBOXRAKE_PUBLIC_URL` and with assistant access Off, and it
stops working again if one of those changes. The
[setup is on the assistants page](assistants.md#connect-claudeai-or-chatgpt-oauth).
What a connection can do is exactly what a token can do (same levels, caps,
limits and undo), and Activity and an alert record each new one.

What could go wrong, and what stands in the way:

| What could go wrong | What stops it |
|---|---|
| **Inboxrake fetches a hostile address.** An app is identified by a web address Inboxrake has to read. | It only fetches after you have signed in, never for an anonymous visitor. Only public https on port 443, every resolved address must be public, the connection is pinned to it, no redirects, 5 KiB and 5 seconds at most, rate limited. The app's logo is never loaded. |
| **A look-alike app asks for approval.** | The approval page leads with the app's real host, not its self-chosen name. It also shows where you go back to, which must be on the same host. Without your clicking Allow nothing is connected. |
| **Someone sends you their own connect link** (consent phishing). | The page says to continue only if you just started it yourself. The attacker's link can still look right, so the other layers matter: the level can never exceed your admin's cap, the approval code lives 60 seconds, every new connection raises an alert and an Activity entry, and **Disconnect** works at once. |
| **A redirect sends you or a code somewhere else.** | There is no "return to" parameter. The return address must exactly match one the app published, on its own host. Errors found before that is known are shown in the page and never redirected. |
| **A stolen authorization code.** | PKCE (S256) is required, the code works once within 60 seconds, and reusing it ends the connection it made. |
| **Another site makes you approve** (cross-site request, framing). | Approval needs your signed-in session, an anti-forgery check, and a request bound to your browser through an HttpOnly cookie; the page cannot be embedded in another site. |
| **A stolen refresh token.** | Every use replaces it, so a copy is worthless once the real app has used it; a replay ends the whole connection and is recorded. Idle for 30 days it dies, and the expiry you chose is a hard end. The owner is checked again on every refresh. |
| **Mix-up between servers.** | Every answer carries Inboxrake's address as issuer, and there is only one. |
| **A token meant for another server, or the reverse.** | A token names Inboxrake's `/mcp` address as its audience, checked when it is issued and on every call; the tokens are opaque and only valid here. Inboxrake makes no calls on the app's behalf. Changing `INBOXRAKE_PUBLIC_URL` ends them all. |
| **Registration spam.** | There is no self-registration. Pending requests are capped, limited per address, and a connection exists only after you approve (at most 20 per user). |
| **You forget it is public.** | Off by default; refused without a login; a permanent note in Settings while on; an alert on each connection. The admin's access cap still limits every connection. |
| **A token in a log or URL.** | A token in a URL is refused, token answers are never cached, tokens are never logged, and an access token lasts one hour. |

What it does not protect against: an assistant that is fooled by text in your
mail (see above), and the vendor itself. What the app reads goes to that
vendor, so choose levels with that in mind. On the network side, nothing in
front of `/mcp`, `/oauth/*` and `/.well-known/oauth-*` may demand a login of
its own, but you can limit the token endpoints to the vendors' addresses (see
[the proxy notes](assistants.md#for-claudeai-and-chatgpt-oauth)).

## Alias service (optional)

Off until you add an API key in Settings -> Alias service (SimpleLogin or
addy.io). Then Inboxrake talks to that service's public API host (and only
that) to read your alias list, switch one off or on, and make a new one on
request; it never sends mail, mail addresses of other people or message
content. The key is stored like the other secrets, never shown again and never
logged; an admin who does not want the connection simply leaves it unset. The
page "Your addresses" itself reads only the scan's metadata and needs no
connection.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).


## SSO identity upgrade and legacy workspaces

Upgrading to immutable SSO identities invalidates existing SSO sessions;
sign in again. The configured administrator binds to the first verified
matching provider subject and keeps the existing root workspace. Later
identities with a recycled email cannot take it over. Configure the admin
before exposing SSO with a broad allow-list.

Existing non-admin email-owned tenant directories are retained, but are
not automatically assigned to new identities. Before upgrading, export each
user's settings backup. Restore it in the new workspace and reconnect the
mail accounts, or explicitly map the old directory identity to the new one
with `INBOXRAKE_OIDC_LEGACY_BINDINGS`. This environment variable is a JSON
object mapping an immutable `oidc:<sha256>` identity to the old email/subject,
for example `{"oidc:<identity hash>": "member@team.example"}`. The signed-in
user's immutable identity is returned as `identity` by `/api/auth`. Only the
operator should create these mappings after verifying the provider subject;
never derive them automatically from matching emails.

Importing a settings backup never imports secrets. If it changes a mail
server, account identity, transport/certificate settings, or the AI provider
endpoint, the corresponding stored credentials are cleared. Re-enter them
before connecting to the changed endpoint.
