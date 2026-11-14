---
title: "FAQ"
description: "Short answers on safety, privacy, exposure, footprint and backups."
---

# FAQ

Short answers first - open a question for the details.

## Safety

<details class="faq-q">
<summary><h3 id="does-it-delete-anything-without-asking">Does it delete anything without asking?</h3><span class="faq-short">No. Trashing is an IMAP move to the Trash folder, always behind a confirmation, with an Undo.</span></summary>

No. Trashing is an IMAP move to the Trash folder, always behind a
confirmation, with an Undo. The confirmation gives the number of mails;
the exception is explicitly trashing a single protected group or a single
pinned mail, which asks "anyway?" naming it instead of giving a count.
UIDVALIDITY is checked before every move, and scans are read-only.
Permanent deletion exists only as explicit actions in Trash and Junk: the
manual ones confirm with exact counts, and an opt-in purge rule only acts
after you have reviewed a report run (then it runs on its schedule within
its age limit and per-run cap). Rules and the Trash and Junk page purges always
skip protected senders and pinned mails. Moving a protected group, or a
single pinned mail, to Trash asks for an extra confirmation; individually
selected mails from a protected sender are not checked. **Empty Trash
empties everything in Trash**, protected or not. Rules also start in report
mode.

</details>

<details class="faq-q">
<summary><h3 id="how-far-back-does-undo-go">How far back does Undo go?</h3><span class="faq-short">Each account keeps its last 10 undoable actions, in memory only.</span></summary>

Each account keeps its last 10 undoable actions, in memory only: a restart
or an image update (e.g. an auto-updated `:latest`) empties the list. An
undo tracks destination UIDs and UIDVALIDITY, using server COPYUID responses
when available and otherwise identifying newly arrived copies. It never
restores a pre-existing matching copy. If identity cannot be established
safely, the entry is kept and you must restore those mails manually from
the destination folder -
Trash for a trash action, the destination folder for an archive or move -
so it only works while they are still there; once they are emptied from
Trash or moved on, they cannot be brought back this way.

</details>

## Privacy

<details class="faq-q">
<summary><h3 id="what-leaves-my-machine">What leaves my machine?</h3><span class="faq-short">Mailbox access goes to your mail provider; unsubscribe actions contact the sender, SSO contacts your identity provider, and optional AI review sends only metadata.</span></summary>

Mailbox access goes to your mail provider. Unsubscribe actions contact the
sender, and SSO contacts your identity provider. Optional AI review sends
only metadata, never mail bodies or attachments (see
[what exactly](security.md#what-the-optional-ai-review-sends)). A local model
(Ollama, LM Studio, vLLM) keeps the AI traffic on your own network. The AI is optional and you can set a monthly
budget in Settings -> AI review. The UI loads no external assets.

</details>

<details class="faq-q">
<summary><h3 id="why-does-it-need-my-imap-password">Why does it need my IMAP password?</h3><span class="faq-short">Use an app password where your provider offers one.</span></summary>

Inboxrake reads and moves mail over IMAP, and IMAP has no way to do that
without a credential. Use an app password where your provider offers one
(Gmail, iCloud, Fastmail, Yahoo ...): it is separate from your main
password and you can revoke it in your account at any time, which cuts
Inboxrake off instantly. Some providers (e.g. Fastmail) let you limit it
to mail. Providers that only allow OAuth (Outlook) use a token instead.
The credential is stored in `/data`; it is encrypted only if you set
`INBOXRAKE_SECRET_KEY` (without a key it is plaintext and every start logs
a warning). It is only ever sent to your own mail server.

</details>

## Running it

<details class="faq-q">
<summary><h3 id="how-heavy-is-it">How heavy is it?</h3><span class="faq-short">One container, about 80 MB to download and roughly 55 MB of RAM while idle.</span></summary>

One container, about 80 MB to download and roughly 55 MB of RAM while idle
(measured by the maintainer on amd64 with the demo; scanning a large mailbox
uses more while it runs). Images are published for amd64 and arm64, for
example Raspberry Pi 4/5.

</details>

<details class="faq-q">
<summary><h3 id="is-it-safe-to-expose">Is it safe to expose?</h3><span class="faq-short">There is no login by default - keep the port on localhost or behind an authenticating proxy.</span></summary>

There is no login by default - keep the port on localhost or behind an
authenticating proxy, or enable the built-in password or SSO login. Without
a login it also answers only to `localhost` and IP addresses; for a host
name set `INBOXRAKE_ALLOWED_HOSTS`. Details in [Security & privacy](security.md).

</details>

<details class="faq-q">
<summary><h3 id="forgot-the-password">I forgot the sign-in password - how do I reset it?</h3><span class="faq-short">Set a new <code>AUTH_PASSWORD</code> and delete the saved <code>auth</code> entry in <code>server.json</code>. There is no reset by mail.</span></summary>

Inboxrake has one shared login and no account recovery by mail, so the reset
happens on the server. Changing `AUTH_PASSWORD` alone is not enough once
Inboxrake has saved its sign-in settings: a saved `auth` entry in
`server.json` (in the data folder: `/data/server.json`, unless `SERVER_PATH`
says otherwise) wins over the environment. That entry is created by the
first save of Settings -> Sign-in & users, the first save of the shared AI
settings and every SSO sign-in - so on most servers it exists, even if you
only ever set the password in the environment.

1. Stop the container.
2. Set the new `AUTH_PASSWORD` (and `AUTH_MODE=password`) in its environment.
3. Open `server.json` and delete the `"auth"` entry - leave the rest. For a
   Docker volume:
   `docker run --rm -it -v <volume>:/data alpine vi /data/server.json`.
   If the file has no `"auth"` entry, there is nothing to delete.
4. Start the container. The login now comes from the environment, so the new
   password works at once and the login is never off.

**SSO** (the page says "Trouble signing in?"): "The sign-in provider isn't
reachable" means the container could not reach your provider - check the
issuer URL and the container's network, then try again. "Your SSO account has
no verified email address" means the provider did not confirm the address -
verify it there. "This account isn't allowed to sign in here" means the
account is not in the allowed users (`OIDC_ALLOWED`, or Settings -> Sign-in &
users), and "no administrator is configured yet" means the SSO administrator
(`OIDC_ADMIN`) is still unset. If the provider is gone for good, use the
steps above with `AUTH_MODE=password` and an `AUTH_PASSWORD`. Deleting the
`"auth"` entry also drops the saved SSO administrator, so set `OIDC_ADMIN` (or
choose the administrator again in Settings) before you switch back to SSO.

</details>

<details class="faq-q">
<summary><h3 id="cannot-write-to-data">"Cannot write to /data"</h3><span class="faq-short">The image runs as user ID 1000. Give your folder to 1000 and restart.</span></summary>

The image runs as user ID 1000. A host folder you created yourself is
usually owned by root; give it to 1000 (`chown -R 1000:1000 <folder>`) and
restart. See [Install](install.md#data-folder-ownership).

</details>

<details class="faq-q">
<summary><h3 id="backup-and-uninstall">Backup and uninstall?</h3><span class="faq-short">Everything lives in the /data volume. Your mailbox is never modified by installing or removing Inboxrake.</span></summary>

Everything lives in the `/data` volume; Settings -> Backup & restore has a backup
export, which leaves out all passwords, tokens and API keys (the mail
password, OAuth tokens and client secrets, AI keys) - after a restore you
re-enter them. Stop the container and delete the
volume to remove it. Your mailbox is never modified by installing or
removing Inboxrake.

</details>

## The project

<details class="faq-q">
<summary><h3 id="why-not-just-use-filters-or-sieve">Why not just use filters or Sieve?</h3><span class="faq-short">Filters work forward in time. Inboxrake shows what already piled up.</span></summary>

Filters work forward in time. Inboxrake shows what already piled up - which
senders, how many mails, how much space, how much you actually read - so
you decide in bulk, and can then block a sender, unsubscribe or export a
Sieve rule so it stays gone.

</details>

<details class="faq-q">
<summary><h3 id="how-is-it-different-from-other-tools">How is it different from other tools?</h3><span class="faq-short">Inboxrake looks at what has already piled up and lets you decide in bulk.</span></summary>

- **Server-side filters / Sieve** act on new mail as it arrives. Inboxrake
  looks at what has already piled up and lets you decide in bulk (and can
  export a Sieve rule afterwards, see above).
- **Mail-client search and rules** work on a mail or a search result at a
  time; they do not group a whole mailbox by sender with counts, sizes and
  how much you actually read.
- **Scriptable IMAP tools** (imapfilter and the like) are powerful if you
  want to write and maintain scripts; Inboxrake is a point-and-click web UI
  with confirmation and Undo instead.
- **Hosted cleanup services** run on someone else's servers and read your
  mailbox there. Inboxrake runs on yours; mail only travels between your
  server and your mail server (plus metadata to an AI provider if you turn
  that on).

</details>

<details class="faq-q">
<summary><h3 id="what-is-the-projects-status">What is the project's status?</h3><span class="faq-short">One maintainer, MIT-licensed.</span></summary>

One maintainer, MIT-licensed. Releases are cut with release-please from
the commit history, see the [changelog](../CHANGELOG.md). Security reports
go through [SECURITY.md](../SECURITY.md); nothing is promised beyond what
is written there.

</details>

<details class="faq-q">
<summary><h3 id="is-there-an-api">Is there an API?</h3><span class="faq-short">No public one - but AI assistants can connect over MCP.</span></summary>

No public one. The web UI talks to JSON endpoints under `/api/`, but they
are internal and may change in any release.

For AI assistants there is a separate, supported door: a read-only
[MCP endpoint](assistants.md) at `/mcp` (off until an admin switches it on,
one access token per assistant, metadata only). It is meant for assistants,
not as a general-purpose API.

</details>

<details class="faq-q">
<summary><h3 id="where-do-i-report-a-vulnerability">Where do I report a vulnerability?</h3><span class="faq-short">Not in a public issue - see SECURITY.md.</span></summary>

Not in a public issue - see [SECURITY.md](../SECURITY.md).

</details>
