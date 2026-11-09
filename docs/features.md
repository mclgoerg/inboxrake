---
title: "Features"
---

# Features

Everything Inboxrake can do, in one list. The [README](../README.md) has
the short version; [install.md](install.md) covers running it and
[security.md](security.md) the login, multi-user and secrets options.

- **Overview** - the start page and a balance of the active account (accounts
  are never mixed): the main card shows size, mails and senders, how the size
  changed against a month ago and an 8-week chart of mails that arrived versus
  mails you cleaned (lighter bars are estimates from the mails still in the
  mailbox). Beside it a **Last week | Since last visit** card (new mails, new
  senders, senders still mailing after you unsubscribed, mails in Junk, new AI
  verdicts), "Next steps" (the suggestions, see "Suggestions" below), "Biggest
  senders" with a storage bar and "What fills your inbox" (the last 30 days by
  kind). Everything else is one click away in the sidebar (on screens 1024 px
  and wider) or the tab bar at the bottom (phones and tablets: Overview,
  Senders, Clean up, Insights). A fresh load without a route in the address opens on the Overview.
- **Views** - five of them: Sender, Smart (every big sender keeps its own row;
  the long tail of small senders is pooled by company - all `noreply@`,
  `news@`, … of one domain - and by what their mails are about: orders &
  deliveries, appointments & bookings, job applications, support & inquiries,
  accounts & security, newsletters, people you write to, …, so hundreds of
  rows become ~50. A company row says what its mails are about; open a pooled
  row to see its senders and act on just some of them. The per-account
  threshold is "Own row from N mails", default 10), Subject (normalized:
  merges `Order 123` / `Order 456`, strips Re:/Fwd:), Thread (whole
  conversations) and a flat "All mails" list. The grouping control sits in the
  Senders toolbar; "All mail" is its own sidebar item on wide screens. The
  grouping starts at Sender.
- **Cleanup signals** - mail count, total size (find attachment hogs),
  unread percentage, first->last date range (short dates, e.g. "7 Oct"), category tags
  (shipping, finance, shopping, social, travel, newsletters,
  automated…).
- **Swipe triage** - Triage (sidebar: Clean up; phones: the Clean up tab)
  deals out the groups of the current list as a stack of cards: swipe left to
  Trash, right to Keep, up to Unsubscribe - or use the round buttons or the
  arrow keys; a running tally shows your decisions and "Undo last decision"
  takes the previous card back. Nothing happens while you decide; at the end
  one confirm names every decision, then protects, unsubscribes and trashes
  (with the usual Undo).
- **Sender detail** - every mail of a group with date/size/unread, per-mail
  selection and deletion ("Trash selected", or "Move N mails to Trash" for the
  whole group, the button at the bottom). Under the name sit the figures
  (Mails, Size, Opened), the sender's signals (new, replied, protected,
  blocked, how it is unsubscribed) and the actions for the sender as a whole:
  Unsubscribe (when the sender offers it), Block, Protect, Move (all of the
  sender's mails to a folder, with the same confirm, protected-mail handling
  and Undo as moving selected mails), **Edit labels** and a More menu (rate
  with AI, read the conversation, protect all mails of the group, Sieve
  export). Mails sort by date or size, and a "Select…" menu picks all
  or none or the mails older than 6 months / 1 year / 2 years. On screens
  1280 px and wider the group opens in a **side pane** next to the list, so
  you can keep scanning the list while you read; below that it is a dialog
  (full screen on a phone).
- **Edit labels** - in a sender's detail: set its AI verdict (Safe to delete /
  Review / Keep) and its categories yourself, and see or change how it is
  filed in Smart. Your choice wins over the AI and over the keyword rules,
  survives rescans and shows as "set by you"; "Reset to automatic" puts verdict
  and categories back. A protected sender is still never "safe to delete" and
  a row that contains a sender you put on hold is never offered as AI-safe.
  Your labels are part of the settings backup.
- **Mail reader** - a mail opens like in a mail app: sender, readable date, a
  big subject, chips for attachments and tracking, quoted history folded away
  ("Show quoted text") and, when the mail carries an unsubscribe link, a card
  that says how it unsubscribes. The body is always plain text: HTML is
  converted, no remote content is loaded and no tracking pixel fires. A
  toolbar acts on the open mail: Trash, Pin, Move, Conversation and a More
  menu (Open sender, Copy address, Show headers, Block sender); previous / next
  arrows walk the list you came from. **Conversation** shows the whole thread
  as cards, oldest first, with your own replies from Sent marked "from Sent";
  a card's text is fetched when you expand it. Mails in Sent are read-only.
- **AI review (optional)** - coarse verdicts per group
  (delete-safe/review/keep) and a fine-grained mode that rates every mail
  *inside* a group, with selection by rating. Verdicts are cached (by group
  key and Message-ID), so rescans and reopened groups cost nothing. Sends
  only metadata (addresses, counts, subject lines) - never mail bodies.
  Providers: Anthropic API, OpenAI, Claude on Microsoft Foundry, or any
  OpenAI-compatible local endpoint (Ollama, LM Studio, vLLM). Token usage
  and cost are tracked with a built-in price table.
- **AI sorting of Smart's "Other" row (optional)** - a button on that row
  asks your AI to pick one of the fixed kinds (orders, appointments,
  applications, support, accounts, newsletters, individuals, other) for the
  senders the rules could not place. It shows the scope and cost first,
  sends only the sender's name and address, mail count and up to three
  recent subject lines (plus your own instructions from Settings, which you
  can edit), places senders without moving or deleting any mail, caches each
  answer until that sender's mails change, and can be removed again.
- **Filing senders in Smart** - tick senders in a pooled row and choose
  "File in Smart as…" (a kind, or one of your own categories) to decide
  where a sender - or its whole company - belongs. It only places the
  sender: no mail is moved, it is remembered (per user, on your server
  only, never sent to an AI), undoable, and a sender's detail view shows
  how it is filed and why. After an AI sorting run you can keep its answers
  as your own rules too; clearer mail still wins over a kept answer.
  Settings -> Filed senders lists everything Inboxrake knows this way as a
  grouped list - searchable, filterable (All / By you / AI / Unused), with
  "Change group" and "Forget" per entry and, in the "…" menus, "Remove unused",
  the AI-answer actions, sorting (Sort by / Order) and download / upload of
  just this list.
- **Attachment explorer** (sidebar: Clean up -> Attachments) - an on-demand
  BODYSTRUCTURE pass (structure only, no content downloaded). It shows how much
  space each kind of file (PDF, images, video, archives, …) takes, which files
  were sent again in several mails, and one tile (or list row) per file that
  you can filter by kind and age. It adds a 📎 aggregate to groups and
  enables the `att:>10m` filter. IMAP can't strip single attachments, so
  selecting a file selects its mail(s) and cleanup means moving the whole mail
  to Trash (reversible as always).
- **Statistics** (sidebar: Insights -> Statistics) - charts with a period
  switch (30 days / 12 months / all time) for the volume chart and the mail,
  size and unread figures, a category donut, top senders with bars (click one
  to open it), top domains by size, scan history and per-month cleanup tallies
  ("moved to Trash" and, for permanent deletes only, "freed"), persisted across
  restarts.
- **Space map** (sidebar: Insights -> Space map) - the whole mailbox by size,
  opening with a sentence ("61 % of your space is mail you barely engage
  with") and the space per colour. Switch between **Tiles** (readable tiles
  with gaps and names, sized by mail size) and **Rings** (domains inside,
  their senders outside; the "Biggest here" list beside it holds every figure).
  Tiles are domains; tiny ones fold into an "Other" tile. A tap or click shows
  a tile's details (size, share of the mailbox, how often opened, last mail,
  AI verdict) with "Show in Senders"; double-tap, double-click or the zoom
  button zooms in to its senders. Color by engagement, age of the last mail or
  AI verdict. "Select" ticks tiles (protected senders are skipped), and
  "Review in Senders" hands exactly those senders to the Sender list's normal
  selection for Trash / Archive with the usual confirmation - the map itself
  never moves mail.
- **Your year in mail** (sidebar: Insights -> Your year in mail, or from
  Statistics) - a full-screen story of one calendar year, one coloured card per
  topic with charts for months, weekdays and hours: how many mails you
  received, your loudest senders, the month that buried you, your busiest
  weekday and hour, ghost senders (10+ mails, none ever opened), your biggest
  mail and what you cleaned up (moves, permanent deletes, unsubscribes, rule
  runs). Tap right/left, swipe or use the arrow keys, hold to pause; the intro
  has a year switcher. The last card
  saves a summary image, generated in your browser with sender names hidden
  unless you tick "Show names". Based on the mail in the mailbox now; metadata
  only, nothing is uploaded.
- **Duplicate finder** (sidebar: Clean up -> Duplicates) - opens with one number
  and one button: **Remove N copies** keeps the newest copy of every identical
  set and moves the rest to Trash through the usual confirm and Undo (sets that
  contain a pinned mail or a protected sender are left alone and counted).
  **Review each** switches to manual selection. Three sections, switched with
  "Identical | Versions | Possible". **Identical copies**: mails with
  the same Message-ID and the same size (e.g. copies across folders),
  grouped into sets with one click to select everything but the newest
  copy - the only place that button and the "reclaimable" figure apply.
  **Same mail, different versions**: the same Message-ID but different
  sizes (a mailing-list copy next to a direct one, a copy whose attachments
  another client stripped), plus mails without a usable Message-ID (missing,
  or junk such as `<>`) that share sender + subject + size (and the
  identical id text, if there is one); the largest copy is tagged, nothing
  is selected for you. Two mails with their own, different Message-IDs (say,
  two monthly statements) are never copies or versions of each other; at
  most they show up under **Possible duplicates**: the same sender and
  subject sent within ten minutes of each other (so they may differ in
  content), never repeating a mail from the first two sections. Nothing
  there is selected for you either. **Compare** opens two mails of a set side
  by side with the differences highlighted (received, size, folder, read,
  Message-ID; a pair switcher walks bigger sets) and lets you move all but the
  newest to Trash or choose **Keep all**: that hides the set from the list
  (remembered per account; "Show hidden" brings it back). "Select all but
  newest" only changes the identical sets - rows you ticked in the other two
  sections stay ticked.
- **Moving mails (folder picker)** - every Move (a sender's mails, selected
  mails, one opened mail) uses a searchable folder list with mail counts and
  your folder hierarchy; "Suggested" offers your Archive folder and the folders
  you moved to recently (remembered per account in this browser, and only once a
  move really went through). It is a popover on wide screens and a bottom sheet
  on phones. When you move everything from one sender or domain you can switch
  on **Always move new mail from <sender> here**: after the move this creates a
  rule (manual schedule: it runs only when you run it) that starts in report
  mode, so nothing is moved automatically until you arm it in Rules.
- **Rules + scheduler** - save a filter query (same syntax as the filter
  box) plus an action as a rule, run it manually or daily/weekly. Rules read
  like sentences with a **Report only / Active** switch on each card; a rule is
  built from pop-ups in a side panel (a dialog on small screens) with a live
  preview of how many senders and mails match. Rules
  always start in **report mode** (they only tell you what they would do);
  execute mode can be enabled after at least one report run. Every run is
  capped at 500 mails, skips protected senders, and uses the normal
  Trash/undo pipeline - the scheduler is a background loop inside the
  container, no cron needed.
- **Retention actions** - restrict a bulk action or a rule to "keep the
  newest N mails" or "only mails older than N days" per group instead of
  the whole group - mutually exclusive, computed against the real mail
  list rather than just the group count.
- **Block a sender/domain in one click** - from a group's detail view,
  instantly creates a standing daily auto-trash rule for that sender or
  domain (optionally trashing what's already there too). Reversible any
  time by unblocking, which just deletes the rule; protected senders
  can't be blocked.
- **Saved filter presets** - save the current filter query under a name and
  recall it with one tap from the Filter button's menu (a sheet on phones),
  next to the built-in quick filters; edit a saved preset's query later with the same filter builder, or
  delete it. Account-scoped like everything else.
- **New-sender review** - a sender new to the mailbox since your last few
  scans gets a 🆕 badge and shows up under a one-tap "New senders" entry in the Filter
  menu (`is:new`), so it doesn't get lost among a thousand others - block,
  protect or unsubscribe right from there. Purely a read-only signal (first
  scan seeds silently, nothing is ever auto-actioned); the window it stays
  flagged for (default 7 days) is configurable in settings.
- **Unsubscribe watchdog** - a sender you unsubscribed from successfully that
  still delivers mail more than two days later is flagged "Still mailing" on
  its row, collected under a one-tap Filter-menu entry and the filter
  `is:still-mailing`, and can be blocked from its detail view. Based on when
  the mail arrived, not its Date header; the digest counts them.
- **Activity digest email** - an optional daily/weekly summary per
  account (Settings -> Activity digest), laid out like the Overview: mails that
  arrived and were cleaned up, your mailbox size, what needs you (for example
  senders still mailing after you unsubscribed) and what Inboxrake did since the
  last digest (permanently deleted mails/bytes freed, rule previews still
  awaiting review, unsubscribe outcomes), sent as a branded HTML +
  plain-text mail at a time of day you pick; skipped entirely when
  nothing happened, with a "send test digest" button to preview it
  first and every send itself audit-logged. Two settings shape the mail:
  **Language of the mail** (English or Deutsch; until you save the section it
  goes out in English) and **Link to Inboxrake** - the address your Inboxrake is
  reachable at (`http://` or `https://`, no `?` or `#`). With it the mail's
  buttons open the right page; without it they are left out.
- **"Never replied" signal** - each scan also reads the To/Cc headers of
  your Sent folder (headers only, cached across scans): groups you have
  written to get a ↩ replied tag, filter with `is:replied` /
  `is:noreply-ever`, and the AI leans towards keeping senders you actually
  correspond with.
- **Protected senders** - mark addresses or whole domains (a shield
  toggle in a group's detail view, or a list in settings) as
  never-bulk-delete: selection presets and bulk trash skip them
  (trashing one explicitly asks first), and the AI is told - and
  forced - to never rate their mails "safe to delete". Filter them with
  `is:protected`.
- **Protected mails** - the same safety net for a single mail: the pin
  toggle on a mail row in a group's detail view ("Protect this mail")
  makes it exempt from every bulk action - group actions (trash/archive/
  move), saved rules and retention actions (also in their report
  numbers), selection presets and AI picks (its AI rating is forced to
  "keep"). Marking read still works; acting on a protected mail yourself
  asks first. "Protect all mails in this group" (in the detail view's ... menu) pins everything currently in a group - later mail isn't covered, that's what the shield is for. It is remembered per account by Message-ID, so it survives
  rescans and folder moves. Filter groups with `has:pinned`. (This is a
  protection against accidental cleanup, not a PIN code or privacy lock.)
- **Engagement score** - every group gets a 0-100 score for how much you
  actually engage with it, computed locally from what a scan already
  knows: the share of its mails you read (the backbone), a strong boost if
  you have written to its senders, a damping factor for newsletters/bulk
  mail, and a fade for senders that have been silent for months. It shows
  as a small three-step meter on each row (tap or hover for the breakdown), sorts
  via "Sort: engagement", and filters with `eng:low` / `eng:medium` /
  `eng:high` (tiers <=33 / 34-66 / >=67) - usable in rules and saved
  presets, e.g. `eng:low age:>1y`. The score is never sent to the AI.
- **Tracker report** - Insights -> Trackers (sidebar, or the Insights tab on a
  phone) shows which senders put tracking pixels or click-tracking links in
  their mail: a ring with the share of checked mails that carry a pixel, the
  hosts behind them ("Who is watching"), the senders that
  track most (tap one to see its mails) and "Show all in Senders", plus a small eye badge on each row (tap
  for the breakdown) and the `has:tracker` filter. It is detected locally from
  the HTML of mails while the local body index is built (generic heuristics,
  no vendor lists - hosts are read from your own mail); nothing is loaded,
  sent or given to the AI, and only two flags plus plain tracker domains are
  kept per mail. Mails indexed before this existed show up under "Check older
  mails" (a rebuild of the index, with the usual confirm).
- **Unsubscribe** - from a group's detail view, from an opened mail, from
  Triage or in bulk (select any number of groups), always through one sheet
  that shows **how each sender is unsubscribed before anything is sent**:
  one click (RFC 8058 one-click POST, done right away), a mail sent from your
  address through the account's SMTP server, or a web page you confirm
  yourself ("Open page", then "Mark as done"); a sender without a usable link
  is listed as not unsubscribable. Optionally tick "Also move their N mails to
  Trash" (off by default): once the run finishes, the mails of the senders
  that are done are moved to Trash (protected senders, pinned mails and
  senders that still need you on their page stay; undoable). The run goes on
  in the background with live progress and cancel, and the sheet lists what
  happened per sender. Every
  outcome (done / needs a confirmation page / failed) is remembered per
  sender and survives rescans and restarts, shown as a badge on the
  group and filterable with `is:unsubscribed` / `is:not-unsubscribed`
  (and `is:still-mailing`, see the Unsubscribe watchdog).
  Protected senders are always skipped.
- **Sieve export** (Proton accounts only) - generate a Proton Sieve
  filter for a sender or domain (move to folder / delete on arrival / mark
  read) with a copy button, so future mail never clutters the mailbox
  again.
- **Undo** - every move to Trash ends in a toast ("Moved 618 mails to Trash")
  with an **Undo** button; older deletions can be restored from the Undo list
  in the status line above the list or from the Activity page ("Undo history",
  above the audit log) (destination UID and UIDVALIDITY tracking). If a server
  cannot identify a moved copy safely, its Undo entry is kept for manual
  recovery from the destination.
- **Trash page** - Trash in the sidebar (Clean up; on a phone the Clean up
  tab), with the count as of the last scan, opens the real Trash (also mail
  deleted outside the app). A card shows how much space it holds and the
  **Empty automatically** switch (see "Purge rules" below). You can search
  it, **Restore** any mail with the button on its row (back to the Inbox),
  use **Select** to restore several to any folder, or empty it with "Empty
  Trash" at the bottom, which always asks first, naming how many mails will
  be deleted permanently.
- **Junk page** - Junk in the same place lists the junk mails by sender, as
  checked by your mail server. Each sender has **Not junk** (moves its mails
  back to your inbox, undoable; your mail server learns from that too if it
  supports it, and Inboxrake then offers to protect the sender), **Block** and
  a move to Trash. Senders you have replied to before are tagged "known" and
  gathered under a banner ("N senders you know - you replied to them before,
  probably not junk") with a "Show" button that lists only them.
- **Delete permanently (Trash and Junk)** - on the Trash and Junk pages,
  select mails or a sender, delete everything received more than N days ago
  ("Delete older than…"), or use "Empty Junk". The count is read live from the
  server, the confirm shows it (plus the mails from protected senders and the
  protected mails that are skipped - they are never deleted; remove the
  protection first to delete them) and only exactly those mails are deleted,
  on the server, irreversibly. That skipping applies to these actions only:
  **"Empty Trash" deletes everything in Trash, protected or not**, and its
  confirm says so. Junk mails go through Trash first. Refused while
  Trash/Junk is ambiguous and not confirmed in Settings. Nothing is ever
  deleted without your click and the confirm.
- **Purge rules (Trash and Junk)** - an opt-in kind of rule (Rules ->
  "Applies to": Junk or Trash) that deletes mail that has been in that folder for more
  than N days (default 30, weekly) **permanently, on the server**. The Trash
  page's **Empty automatically** switch is a shortcut for exactly such a rule
  (Trash, every sender, by age, once a day): turning it on first shows what
  it would delete right now, and only your confirm creates the rule, runs its
  report and arms it; changing the age of an armed rule goes through the same
  preview and confirm. Turning it off removes a rule the switch made, or only
  disarms one you made yourself in Rules. The
  days count from when Inboxrake first saw the mail there (so a mail you
  trash by mistake today is safe for N days, whatever its date), and the
  mail must also have been received more than N days ago; after an upgrade
  or a folder reset the count starts again. Nothing creates one without your
  confirm; a new one starts in report mode (counts and a sender-level preview, nothing
  is deleted), may only be switched to execute after a report run of its
  current definition behind a confirm, and goes back to report mode when
  its folder, filter or age is edited - or when its account is renamed,
  its server / login changes, or the Junk / Trash folder it resolves to
  changes (also a folder deleted and re-created). Deleting an account
  deletes its purge rules (its ordinary rules stay and stop running). Every run is
  capped per run (oldest first; the confirm names the cap), skips protected
  senders and protected mails with no override, and deletes through the
  same exact-UID path as the manual delete above (refused when the role is
  ambiguous, UIDVALIDITY changed or the server lacks UIDPLUS). An empty
  filter means all senders in that folder. Audited as `rule:<id>`, counted as permanent
  deletes in the digest and statistics.
- **Persistent audit log** - every mailbox action (trash/archive/move/
  mark-read, incl. rule-triggered ones, rule runs, unsubscribes, undo,
  empty-trash) is recorded with a timestamp, actor, outcome and bytes
  freed - browsable in-app and exportable as CSV.
- **Selection bar** - a floating capsule at the bottom, there only once
  something is selected: how many groups and mails you picked, Clear
  selection, Unsubscribe, Archive, Move, a More menu (Mark read, AI review,
  Export CSV, "Limit to…" - the retention limiter, shown as a removable token
  while active) and the **Trash N** button. Tick rows with **Select** in the
  Senders toolbar (round checkboxes appear until you press Done; on a wide
  screen they also show when you hover a row, on a phone only in Select mode),
  or press `x` on the focused row. Destructive actions ask first in an in-app confirmation
  that names what they affect (e.g. "618 mails from 6 groups will be
  affected"), mentions skipped protected senders and mails, and focuses
  Cancel; on a phone it is a bottom sheet.
- **Filter menu** - the Filter button in the Senders toolbar (a sheet on
  phones) holds the one-tap filters: quick filters (AI-safe groups, Not yet
  unsubscribed, plus New senders and Still mailing when there are any),
  **Inactive for: 6+ months | 1+ year | 2+ years**, your saved filters,
  "Save current filter…", "Build a filter…" and "Describe a filter (AI)…".
  Each row shows how many groups it matches. The Filter button lights up and the
  active filter shows as a removable token next to the filter box; filters never
  combine - use the filter box for that. Pick a filter to apply it, pick it
  again to switch it off. While a filter is active, a **Select all N matches**
  bar tops the list: it selects every match (across all pages; protected
  groups stay unselected and are counted), and once they are all selected it
  reads "All N matches selected" with a Clear that un-selects exactly those.
- **Sort menu** - the sort control next to the filter box (an icon on phones)
  opens a menu with "Sort by" (the columns of the list) and "Order"
  (Ascending / Descending); the column headers still toggle with one click.
  The mail lists use the same menu pattern for Date / Size.
- **Suggestions** - after a scan, the Overview's "Next steps" suggest a few cleanups (old
  newsletters you never open, quiet low-engagement senders, mail from senders
  you already unsubscribed from, big old attachments, what the AI rated safe)
  with how much each frees. Review opens the Senders page with the step's
  filter in the box and its matches selected ("Review N" in the header does
  that for the steps you ticked); Clean up goes straight to the
  usual Trash confirm (protected senders skipped, Undo afterwards); the x
  ("Not now" on phones, in the More menu) hides a step until a later scan finds
  25 % more.
- **Filter builder** - the sliders button next to the filter box (Senders
  toolbar) opens a click-together builder (category, AI verdict, age, unread
  %, attachments, flags such as "not yet unsubscribed" or "rarely engaged
  with"); on phones it opens as a bottom sheet. It writes the same filter
  syntax you can type, and the result can be saved as a preset.
- **Describe a filter** - with an AI provider set up, "Describe a filter
  (AI)…" in the Filter menu turns a sentence ("shop newsletters I have not
  opened in a year") into a filter you can read and edit, with a live preview
  of how many groups, mails and how much space it matches. Apply it, save it
  as a preset, or start a rule from it (rules still begin in report mode).
  Only your sentence, the filter syntax and your tag names are sent to the
  provider - no mail data - and nothing is selected or changed.
- **Sidebar and tabs** - on screens 1024 px and wider a sidebar holds the
  account switcher, "Search all mails", Overview, Senders, All mail, **Clean up**
  (Triage, Duplicates, Attachments, Rules, Junk, Trash), **Insights**
  (Statistics, Space map, Your year in mail, Trackers) and, at the bottom,
  Activity and Settings. Junk and Trash show their mail counts. On wide screens
  each tool opens as a page in the content column next to the sidebar (and has
  its own address, e.g. `#/triage`, so reload and the browser's Back / forward
  keep you there); below 1024 px they open as a window (full
  screen on phones). Tool pages have a large title and a back link on phones.
  On phones and tablets the same things sit behind a bottom
  tab bar (Overview, Senders, Clean up, Insights); the Clean up and Insights
  tabs are pages with a tile per tool and a glance at its last result, and
  search and the account menu (your avatar) are in the top bar. AI review and
  Export CSV live in the Senders toolbar's
  More (…) menu; once something is selected they scope to the selection,
  otherwise they act on everything.
- **Search** ("Search all mails" in the sidebar, the magnifier in the top bar
  on phones) - shows matching senders and mails as you type (from two
  characters), with a **Recent** list (kept in this browser only) and ready-made
  "Try" searches with their live counts (big attachments, unread for over a
  year, people you replied to, older than 5 years) that open Senders with the
  matching filter. Scope: "Subject & sender" or "Also mail text" (see "Local
  mail-text search index" below for how that is searched); results can be
  narrowed by time and folder, selected and moved to Trash with the usual
  confirm, and a mail opens in the reader. At most the newest 500 matches are
  shown.
- **Activity** - this month's cleaning (what you restored with Undo is
  subtracted), your undo history as cards, and a timeline of every mailbox
  action grouped by month with an ok / failed status; undone actions are
  marked "undone" and a failed unsubscribe can be retried right there.
- **Gestures on phones** - swipe a sender row left for Trash (a full swipe),
  Block and More, right for Protect and Read; swipe a mail row left for Trash,
  right for Pin and Read. Every swipe action asks the same confirmation as its
  button. Below 1024 px (phones and tablets), pull down from the top of Overview, Senders or All mail to scan
  (the header shows the scan's progress). Sheets close with a swipe down. In the
  installed app (PWA), where no browser chrome answers it, a swipe from the
  left edge goes back from a tool page, a sender or a Settings section.
- **Back closes overlays** - below 1024 px every full-screen window, bottom
  sheet and opened mail or conversation takes one browser-history step while
  it is open, so the browser's Back, Android's system Back and Safari's back
  swipe close the top-most one and land on the page underneath instead of
  leaving the app.
- **Bulk workflows** - background deletion queue with live progress and
  cancel, global mail search (optionally inside the message text, a
  per-account setting: your mail server does that search per query and nothing
  is stored, or an opt-in local word index for instant searches - see below),
  Empty Trash (Trash page), cancellable scans and AI runs.
  Results and errors arrive as toasts instead of a status line you have to
  scroll back to.
- **Multiple accounts** - connect several providers at once (e.g. Proton
  Bridge + Gmail). Every account is strictly separate: its own scans, groups,
  rules, saved presets, digest settings, statistics, folder exclusions,
  duplicate and label choices and replied/verdict/known-senders caches - nothing
  is ever mixed or aggregated. The account switcher (top of the sidebar; the
  avatar on a phone) shows a card per account with its sign-in state, last scan,
  mails and size and switches the whole view between accounts; a card whose
  sign-in is broken leads straight to that account's settings. It also holds
  "Add account" (always the setup wizard, also from Settings), Appearance and
  the links to Activity and Settings. Accounts can be renamed (all their data
  follows) and removed in settings, and each has its own folder-discovery
  picker.
- **Fast to open** - each account's last scan is cached on disk and shown
  instantly after a restart or account switch (with its age); a rescan
  refreshes it. Live updates stream only small status deltas - the full
  group list is re-fetched just when it actually changed.
- **Safe by design** - deletions are IMAP `MOVE` to Trash (reversible);
  the only irreversible actions are the explicit permanent-delete ones in
  Trash and Junk (manual, or an opt-in purge rule), which confirm with
  counts. UIDVALIDITY is checked before every move, scans are read-only,
  UID bookkeeping stays server-side, the container runs as a non-root
  user.
- **Keyboard shortcuts** - on the Senders page (grouped views), `j`/`k` (or
  ↑/↓) move through the list, `Enter` or `o` opens the group, `x` selects it,
  `#` trashes the selection (or the focused group; it still asks first), `/`
  jumps to the filter box and `Esc` closes the side pane. In the All mails
  view only `/` and `Esc` apply.
- **Appearance** - System (the default: follows your device), Light or Dark,
  in the account switcher and under Settings -> General; remembered per browser.
- **Number format** - Settings -> General -> Number format: Automatic (follows
  the language: English "1,732", German "1.732"), or pin one style: `1,234.5`,
  `1.234,5` or `1 234,5`. It applies to every count, size and percentage in
  the app, is remembered per browser and leaves exports unchanged.
- **Phone layout** - the same app on a small screen: touch-sized controls, a
  bottom tab bar, filters and confirmations as bottom sheets, a compact list.
- **Settings** - a page (sidebar: the gear; the account switcher on a phone)
  with a section list and search; on phones it works like the iOS Settings
  app, drilling into one section at a time. Sections: Account (sign-in and scan
  status with "Scan now", connection, folders to scan as switches, the
  password only shown when you choose Change…), General (appearance,
  language, number format, how long the "New" badge stays, Smart's "Own row
  from N mails", mail text search), Notifications, Protected senders and
  Categories (lists with add and remove buttons), Filed senders, Activity
  digest, Auto-scan, AI review and, for the admin, Sign-in & users and Backup
  & restore. Changes are staged and saved from a floating bar that only
  appears when something changed; leaving with unsaved changes asks first.
  **Backup & restore** (config, your labels and AI verdict export + import; all
  passwords, tokens and API keys are left out) is under Server for the admin
  and under App otherwise.
- **Polish** - installable as a PWA (manifest + icon), optional desktop
  notifications when background jobs finish, monthly AI budget cap, a welcome
  screen and a short first-run setup (provider -> sign in and test, with
  folders as an optional step -> optional password -> first scan; also behind
  "Add account"), and error messages that are translated rather than raw
  server text.
- **Languages** - English and German. Translations live in
  `frontend/src/locales/`; to contribute one, copy `de.ts`, translate the
  values and register the locale in `frontend/src/i18n.ts`.
- **Stack** - FastAPI backend (SSE live updates), React + TypeScript +
  Tailwind frontend, single container, no external assets at runtime.

## Local mail-text search index (opt-in)

Settings -> General -> *Search inside mail text* -> **Local word index**
(needs `INBOXRAKE_SECRET_KEY`) builds, on a button press, a small SQLite
index per account next to the scan snapshots. It stores **no readable mail
text**: for every mail only keyed hashes (HMAC-SHA256 with a key derived
from `INBOXRAKE_SECRET_KEY` plus a random per-index salt) of its distinct
words, and the same message handles the scan snapshot holds. A copied
`/data` therefore reveals no mail content, and an index built under a
different key is unusable until rebuilt. Searches match **whole words**
(case and accents ignored, several words are ANDed) - not word parts or
phrases - and are instant for any provider. The build reads the first
~256 KB of every scanned mail from your server once (cancellable, with
progress); later scans only add new mails and drop vanished ones. Before
anything is read, Settings shows the **estimated disk use** and the free
space of the data volume and asks for confirmation (about 5-6 KB per mail,
up to ~12 KB for text-heavy mail: roughly 0.5-1.2 GB for 100,000 mails; the
build is refused if even the typical estimate would not fit). It is meant
for large mailboxes and slow providers - for a few thousand mails the
server-side search is already fast.
Switching the mode off or deleting the account removes the index.
