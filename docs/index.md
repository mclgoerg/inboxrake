---
title: "Inboxrake documentation"
description: "Self-hosted mailbox cleanup: see which senders fill your mailbox, then trash, block or unsubscribe in bulk."
---

# Inboxrake

Inboxrake is a self-hosted web app for a mailbox that has piled up. It
scans your mailbox read-only over IMAP, groups the mail by sender, subject,
thread or company, and shows how many mails each group has, how much space
it takes and how much of it you actually read.

<!-- demo:start -->
> **Try it before you install**
>
> The whole app runs right in your browser, on made-up mailboxes.
>
> [Open the demo](https://inboxrake.com/demo/)
<!-- demo:end -->

You then decide in bulk: move to Trash, block, unsubscribe, or keep. It runs
as a single container and talks plain IMAP, so it works with Gmail, Outlook,
iCloud, Fastmail, GMX, mailbox.org, Yahoo, Proton Mail (through the Bridge)
and any other IMAP server.

## Get started

<div class="cards">

- **[Install](install.md)**\
  The starter compose file, plain `docker run`, NAS recipes.
- **[Providers & OAuth](providers.md)**\
  Presets, app passwords, Gmail and Microsoft OAuth, Proton Bridge.
- **[Configuration](configuration.md)**\
  Every environment variable the container reads.

</div>

## Using Inboxrake

<div class="cards">

- **[Features](features.md)**\
  Everything Inboxrake can do.
- **[Filter syntax](filters.md)**\
  The query language behind the filter box and saved rules: `age:>1y unread:>80`
- **[FAQ](faq.md)**\
  Does it delete anything? What leaves my machine? How heavy is it?

</div>

## The safety promises

<div class="cards cards--small">

- **You see it first**\
  Nothing is deleted without asking: moving to Trash always shows the exact count first.
- **Undo**\
  Moving to Trash can be undone - each account keeps its last 10 undoable actions.
- **Scans only read**\
  Scans are read-only. Nothing changes until you say so.
- **Protected stays**\
  Rules and the Trash and Junk page purges skip protected senders and pinned mails.

</div>

Permanent deletion exists only in Trash and Junk: the manual actions
confirm with exact counts, and an opt-in purge rule only acts after you
have reviewed a report run. Moving a protected group or a single pinned mail
to Trash asks first. Empty Trash empties everything in Trash. The optional
AI review only ever receives mail metadata, never bodies or attachments.
[Security & privacy](security.md) has the details and the exceptions: login,
multi-user, secrets, what leaves your machine.

Source code and issues:
[github.com/mclgoerg/inboxrake](https://github.com/mclgoerg/inboxrake).
