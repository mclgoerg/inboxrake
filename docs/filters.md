---
title: "Filter syntax"
description: "The query language of the filter box and of saved rules."
---

# Filter syntax

The filter box above the group list (and its Filter menu), saved rules and the
"describe a filter" helper all use the same small query language. The browser
(`frontend/src/lib.ts`) and the backend rules engine (`backend/rules.py`)
implement it identically, so a rule matches exactly what you saw in the UI.

A query is a list of words separated by spaces; **all** of them must match
(logical AND). Matching is case-insensitive.

## Free words

A word without a qualifier must appear in the group's key (sender address,
domain or subject), its label, or its sub-label. `shop` finds
`news@shop.example`.

## Qualifiers

| Qualifier | Meaning | Example |
|---|---|---|
| `tag:<name>` | A category tag of the group contains this text (substring, one word). | `tag:newsletter` |
| `ai:safe\|review\|keep` | The AI verdict of the group. | `ai:safe` |
| `age:>N(m\|y)` | The last mail of the group is older than N months or years. | `age:>1y` |
| `unread:>N` | At least N percent of the group's mails are unread (0-100). | `unread:>80` |
| `att:>N(k\|m\|g)` | The group's attachments add up to at least N kilo-, mega- or gigabytes; the unit is optional and a bare number means bytes (a total over the group, not single mails). Needs attachment analysis. | `att:>10m` |
| `is:unsub` | At least one sender has an unsubscribe link. | `is:unsub` |
| `is:unsubscribed` | Every unsubscribable sender is already unsubscribed. | |
| `is:not-unsubscribed` | Some sender could still be unsubscribed. | |
| `is:protected` | The group contains protected senders. | |
| `is:replied` | You have written to the sender before. | |
| `is:noreply-ever` | You never wrote to any of its senders. | |
| `is:new` | A recently first-seen sender (see `NEW_SENDER_WINDOW_DAYS` in [Configuration](configuration.md)). | |
| `is:still-mailing` | Mail kept arriving after a successful unsubscribe. | |
| `is:louder` | The sender got louder: in the last 7 days it sent more than twice its usual week (the median of its counted weeks, up to 26) and at least 4 mails. See [Sender changes](features.md#sender-changes). | |
| `is:back` | The sender came back: its first mail after 6 or more months of silence arrived in the last 30 days. | |
| `has:pinned` | The group contains at least one pinned mail. | |
| `has:tracker` | A checked mail carries a tracking pixel or click tracking (needs the local body index). | |
| `in:<N>(min\|h\|d)` | A time window of N minutes, hours or days back from now, only valid next to `is:new`, `is:still-mailing`, `is:louder`, `is:back` or `ai:` (see below). | `is:new in:7d` |
| `eng:low\|medium\|high` | How much you engage with the sender: scores up to 33 are low, 34-66 medium, 67 and up high. | `eng:low` |
| `from:<address>` | Exactly this sender address (sender grouping only). | `from:news@shop.example` |
| `domain:<domain>` | Exactly this domain (domain grouping). | `domain:shop.example` |

`age:` also accepts the number without `>`; `age:>6m` and `age:6m` mean
the same.

> [!NOTE]
> **`in:` time windows.** `in:<N>min`, `in:<N>h` or `in:<N>d` narrows one of
> the time-aware conditions to the last N minutes, hours or days. With `is:new`
> the sender must have been first seen in that window - the window *replaces* the
> configured new-sender window (`NEW_SENDER_WINDOW_DAYS`), so it can widen it.
> With `is:still-mailing` a late mail must have arrived in the window, and with
> `ai:` the AI verdict must have been given in it; for these two it narrows.
> With `is:louder` the mails are counted over the window (never more than the
> last 7 days - louder is a weekly idea, so a longer window counts those 7 days);
> with `is:back` the mail that broke the silence must have arrived in it, and the
> window *replaces* the default 30 days (up to the 26 weeks the counts are kept).
> `in:` alone is refused in a rule (it would act on every match), changes nothing
> on the Senders page, and in the **All mails** list means "mails that arrived in
> the window" (the Overview's "Last week" rows open it that way). A bad value
> such as `in:7w` is read as a free word in the filter box, but a rule refuses
> it. A rule also allows only one `in:`.
> Examples: `is:new in:7d`, `is:still-mailing in:2d`, `ai:safe in:1h`,
> `is:louder in:2d`, `is:back in:60d`.

> [!WARNING]
> **Typos can widen a filter.** An unknown qualifier name, or a bad value for
> `is:`, `has:` or `eng:`, is treated as a free
> word and usually matches nothing. But an invalid `age:`, `unread:` or
> `att:` value (for example `age:>2w`, `unread:high`, `att:>10mb`) is
> silently **ignored** and the rest of the filter still applies - so the
> filter matches *more* mail, not less. `tag:newsletter age:>2w` selects
> every newsletter group. Check the result list before you act. Saving a **rule**
> with such a part is refused with an error that names it, and a rule saved
> before that check shows a warning: its execute runs are skipped (report runs
> still run) until you edit the filter. Giving a single-value qualifier (`age:`, `unread:`, `att:`, `eng:`, `ai:`, `from:`, `domain:`, or both `is:replied` and `is:noreply-ever` / `is:unsubscribed` and `is:not-unsubscribed`) twice is refused the same way, because only the last one would count. Words that contain a colon (such as `re:` or `10:30`) are read as
> qualifiers in a rule and refused unless they are valid ones. The AI filter writer validates strictly
> and retries when the filter it wrote contains a bad token.

## Words only the All mail list knows

The flat **All mail** list reads a smaller language, per mail: free words,
`age:`, `size:`, `att:`, `from:`, `domain:`, `folder:`, `is:unread|read`,
`has:pinned` and `in:`. These words are only known there:

| Qualifier | Meaning | Example |
|---|---|---|
| `is:expired` | The mail is past its date: a sign-in code older than a day, a shipping update whose parcel has arrived, a reminder for something that is over, an offer that has ended - every reason of [Mail past its date](features.md#mail-past-its-date), ticked or not (the automatic mail too). Receipts, invoices and bookings, protected mails and mail from protected senders are never in it. It narrows with the other words. | `is:expired from:shop@example.org` |
| `is:auto` | The automatic mail among those: out-of-office replies and delivery failures older than a week, and read receipts and calendar answers (which need their header: a disposition-notification report, a calendar `REPLY`) - the last three reasons of [Mail past its date](features.md#mail-past-its-date). Mail in one of Keep-safe's classes (a job application, an invoice, ...), protected mails and mail from protected senders are never in it. It narrows with the other words. | `is:auto age:>1y` |
| `kind:` | What kind of mail it is, read from the subject: `ads` (newsletter-style mail with no purpose), `orders` (order confirmations), `shipping` (shipping updates), `invoices`, `appointments`, `jobs`, `support`, `accounts`. Mails of no kind match none of them; two different kinds together match nothing. It narrows with the other words. See [What they send](features.md#what-they-send). | `kind:ads from:shop@example.org` |

None of them is a group word or a rule word: in the Senders filter box they
read as free words and find nothing, and a rule refuses them (rules match
groups, not single mails). A rule can still be limited to one kind: that is the third
retention choice of the rule editor ("only one kind of mail"), next to "keep
newest N" and "only mails older than N days".

The old word `folder:text` matches the mails whose folder name contains the
text. For a name with spaces - or to mean exactly one folder - write it in
quotes: `folder:"Receipts 2019"` is that whole folder, in any case. That is what
**Open in All mail** on [Your folders](features.md#your-folders) uses.

## Combining

```text
tag:newsletter age:>1y unread:>80
```

means: newsletter-tagged groups whose last mail is over a year old and
that you mostly never opened.

## Rules

A saved rule is a filter plus an action and a schedule (manual, daily,
weekly). Rules always start in **report mode** - a run only records what
would happen - and editing a rule's filter, action, target, retention
or account sends it back to report mode (it needs one report run of the
new definition before it acts again). Every run is capped
(`RULE_CAP`, default 500 mails).
Executed trash actions are normal reversible moves.

**Purge rules** are the only irreversible kind: they permanently delete
from Junk or Trash. They are opt-in, need a report run of their current
definition first, skip protected senders and pinned mails, and accept only
a filter over sender, date and read state (plus `has:tracker`) - the qualifiers `tag:`, `ai:`,
`is:`, `has:pinned`, `eng:`, `att:` and `domain:` are refused there.
