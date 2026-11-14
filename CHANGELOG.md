# Changelog

## [2.4.0](https://github.com/mclgoerg/inboxrake/compare/v2.3.0...v2.4.0) (2026-11-14)


### Features

* AI assistants section in Settings ([#363](https://github.com/mclgoerg/inboxrake/issues/363)) ([e7ceb5a](https://github.com/mclgoerg/inboxrake/commit/e7ceb5a824e935255e22467118f96ee9d1188e80))
* notifications that reach you with the app closed, iPhone included ([#358](https://github.com/mclgoerg/inboxrake/issues/358)) ([2537669](https://github.com/mclgoerg/inboxrake/commit/2537669bad294873488c949753615dcc0edda2e5))
* read-only MCP endpoint for AI assistants ([#361](https://github.com/mclgoerg/inboxrake/issues/361)) ([589abac](https://github.com/mclgoerg/inboxrake/commit/589abac33628306580dffc13f4a7c9deafd5e000))


### Bug Fixes

* notification titles say what happened instead of repeating the app name ([#360](https://github.com/mclgoerg/inboxrake/issues/360)) ([82b7630](https://github.com/mclgoerg/inboxrake/commit/82b7630433c208f1d4a411441f19fca5f909d64c))

## [2.3.0](https://github.com/mclgoerg/inboxrake/compare/v2.2.1...v2.3.0) (2026-11-10)


### Features

* a calmer sender detail with the actions up front ([#266](https://github.com/mclgoerg/inboxrake/issues/266)) ([2a5e60b](https://github.com/mclgoerg/inboxrake/commit/2a5e60ba5276a23c2fc7101ad03efc70af7dd973))
  <!-- release-notes:266 -->
  - The sender detail is calmer: the actions (Unsubscribe, Block, Protect, Move) sit right under the name, with Mails / Size / Opened figures and the sender's signals in the header.
  - New: "Move" in the detail moves all of a sender's mails to a folder (same confirmation, protected-mail handling and Undo as moving selected mails).
  - "Trash all N" is now "Move N mails to Trash".
* a clearer 8-week chart and a tidier Overview ([#343](https://github.com/mclgoerg/inboxrake/issues/343)) ([832fb30](https://github.com/mclgoerg/inboxrake/commit/832fb30c4f6cf3207201851382e1168855568478))
  <!-- release-notes:343 -->
  The Overview's 8-week chart now shows what arrived and what you cleaned as two separate rows, each with its own scale and a total, with week dates underneath. Estimated weeks are hatched. The Overview cards also line up with the page header, and Next steps rows are easier to read.
* a floating bar for selected senders ([#268](https://github.com/mclgoerg/inboxrake/issues/268)) ([b806421](https://github.com/mclgoerg/inboxrake/commit/b806421130e6a0948b2d90023aeaef2b1b64d4b6))
  <!-- release-notes:268 -->
  - The bar for selected senders and mails is now a floating capsule with Unsubscribe, Archive, Move and a More menu; the Limit setting shows as a visible tag while active.
* a slimmer demo bar, things to try and a clearer start screen ([#325](https://github.com/mclgoerg/inboxrake/issues/325)) ([04f6bc4](https://github.com/mclgoerg/inboxrake/commit/04f6bc46b646b52c0ba35dfe40878056fcef1cea))
  <!-- release-notes:325 -->
  - The in-browser demo has a slim bar above the whole app (nothing is hidden behind the sidebar any more), shows "Three things to try" on the first visit, and its start screen shows progress and what to try while it loads.
* a welcome screen and a shorter first-run setup ([#265](https://github.com/mclgoerg/inboxrake/issues/265)) ([e39dc96](https://github.com/mclgoerg/inboxrake/commit/e39dc964bf80432a643eb672340b130dddf6463c))
  <!-- release-notes:265 -->
  - New first-run experience: a welcome screen, then a shorter setup. Choosing which folders to scan is now optional and tucked behind "Choose folders…" on the sign-in step; the defaults are unchanged.
  - The first scan shows a progress ring with a short checklist.
* account settings with status and grouped rows ([#288](https://github.com/mclgoerg/inboxrake/issues/288)) ([88cd0cb](https://github.com/mclgoerg/inboxrake/commit/88cd0cb7180fcc56dcdc0c5f420810e503072ba5))
  <!-- release-notes:288 -->
  - Account settings are clearer: a card shows the account's sign-in and scan status with a Scan now button, and the connection, folders and advanced options are grouped.
  - Folders to scan are switches; the password is only shown when you choose Change….
* account switcher with a card per account ([#313](https://github.com/mclgoerg/inboxrake/issues/313)) ([649daf8](https://github.com/mclgoerg/inboxrake/commit/649daf87d2cfaa0c664c9df499f4e09bc3bb01b6))
  <!-- release-notes:313 -->
  - The account menu shows a card per account with its sign-in state, last scan, mails and size; a broken sign-in links straight to its settings.
  - "Add account" always opens the setup wizard, also from Settings.
  - "Empty Trash…" moved out of the account menu; it is on the Trash page.
* activity as a timeline ([#287](https://github.com/mclgoerg/inboxrake/issues/287)) ([666cb81](https://github.com/mclgoerg/inboxrake/commit/666cb81ec3eff0f7580a3fd8f76b3fed524be8d3))
  <!-- release-notes:287 -->
  The Activity page now shows this month's cleaning, what you can still undo as cards, and a timeline grouped by month with ok / failed status. A failed unsubscribe can be retried right there.
* activity summary knows what was undone ([#291](https://github.com/mclgoerg/inboxrake/issues/291)) ([e913ad3](https://github.com/mclgoerg/inboxrake/commit/e913ad32a25ebaa0fb9b7779d6c6fc1b039dbd36))
  <!-- release-notes:291 -->
  - The "This month" card on the Activity page now subtracts mails you restored with Undo.
  - Undone actions are marked "undone" in the timeline.
  - Older log entries keep working; they just can't be marked as undone.
* an Activity page that says what happened ([#349](https://github.com/mclgoerg/inboxrake/issues/349)) ([d166661](https://github.com/mclgoerg/inboxrake/commit/d166661b548e407600aaa409ebee739c65ede301))
  <!-- release-notes:349 -->
  The Activity page now describes each entry in plain words ("Moved 150 mails to Trash", "Unsubscribed from …"), says who did it (a rule or you), and shows Done or Failed with the reason one click away. On wide screens the log sits beside a month summary with the numbers per week and a split by rules / you / unsubscribes.
* attachments by kind of file, repeats and file tiles ([#302](https://github.com/mclgoerg/inboxrake/issues/302)) ([d0db248](https://github.com/mclgoerg/inboxrake/commit/d0db248f3ec4dc2aa6808dd628677e2bbf464fd3))
  <!-- release-notes:302 -->
  - Attachments now shows how much space each kind of file (PDF, images, video, archives…) takes, and which files were sent again in several mails.
  - Files appear as tiles (or a list) you can filter by kind and age; selecting one picks its mail(s) - the whole mail goes to Trash, not only the file.
  - The overview covers your whole mailbox, not just the 300 largest mails.

  The whole-mailbox bar refreshes after a background delete finishes; tiles update immediately.
* built-in categories you can see, and tidier settings ([#350](https://github.com/mclgoerg/inboxrake/issues/350)) ([a6463cc](https://github.com/mclgoerg/inboxrake/commit/a6463ccb6534baaf96cbe62f668899a7b72f4209))
  <!-- release-notes:350 -->
  - Settings > Categories now shows the six built-in categories with their keywords, an Edit button and an on/off switch, above your own categories.
  - Settings is easier to read on phones (Appearance, stepper rows), the search index shows one status line, and special folders no longer repeat their names.
  - No upgrade steps.
* calmer sender rows and a Select mode ([#270](https://github.com/mclgoerg/inboxrake/issues/270)) ([d79d8cb](https://github.com/mclgoerg/inboxrake/commit/d79d8cb57f83d2a7759d8727c57f555bcd74b172))
  <!-- release-notes:270 -->
  - Sender lists are calmer: one status badge per row instead of several columns; the details are in the sender panel.
  - New "Select" button to pick several senders; checkboxes also appear when you hover a row.
  - Phones show the checkboxes only in Select mode.
* clearer Duplicates, sender mail list and Trash ([#344](https://github.com/mclgoerg/inboxrake/issues/344)) ([141b49c](https://github.com/mclgoerg/inboxrake/commit/141b49c2ab459ac7ce658c4d244dc7c4ca31af5c))
  <!-- release-notes:344 -->
  Duplicates, a sender's mail list and the Trash page are easier to scan on phones: duplicate sets are cards that show which copy stays, long mail lists have month headings and load 100 at a time, and Trash groups mails by month with a compact restore button.
* clearer rule cards and a tidier rule editor ([#345](https://github.com/mclgoerg/inboxrake/issues/345)) ([e841dbd](https://github.com/mclgoerg/inboxrake/commit/e841dbd79d0c38754c6881281677ace3205360cb))
  <!-- release-notes:345 -->
  Rules look clearer: each card shows when it last ran in your language's date format and what it did, a failed run keeps its error visible, and the new-rule editor is aligned (grouped into "Which mail" / "What happens" on phones). The intro is shorter and links to how rules work. No change to what rules do.
* correct a sender's verdict and categories yourself ([#295](https://github.com/mclgoerg/inboxrake/issues/295)) ([566286a](https://github.com/mclgoerg/inboxrake/commit/566286a624083c7edf2b540b4247787b0ed9eaa0))
  <!-- release-notes:295 -->
  - New "Edit labels" on every sender: set Safe to delete / Review / Keep yourself, and add or remove its categories. Your choice wins over the AI, survives rescans and shows as "set by you"; "Reset to automatic" undoes it.
  - A protected sender is still never "safe to delete", and rows that contain a sender you put on hold are never offered as AI-safe.
  - Your choices are part of the settings backup.
* duplicates page with one-tap cleanup and compare ([#303](https://github.com/mclgoerg/inboxrake/issues/303)) ([c60a8c8](https://github.com/mclgoerg/inboxrake/commit/c60a8c82068afdc740dd9a65bb747ef461a31f88))
  <!-- release-notes:303 -->
  - Duplicates now opens with one number and one button: "Remove 13 copies" keeps the newest of each identical set and moves the rest to Trash (with the usual confirm and Undo); "Review each" is the old manual selection.
  - Versions and possible double-sends get a Compare view with the differences highlighted; "Keep all" hides a set you want to keep (Show hidden brings it back).
* filed senders as a grouped list ([#314](https://github.com/mclgoerg/inboxrake/issues/314)) ([1017678](https://github.com/mclgoerg/inboxrake/commit/10176780455e46566548f2443bb47d2b981a8610))
  <!-- release-notes:314 -->
  Settings › Filed senders is now a grouped list with search and an All / By you / AI / Unused filter. Change group, forget, download, upload and the AI-answer actions moved into "…" menus; sorting moved into the "…" menu (Sort by / Order).
* friendlier protected senders, categories and AI settings ([#289](https://github.com/mclgoerg/inboxrake/issues/289)) ([ee53655](https://github.com/mclgoerg/inboxrake/commit/ee53655675d29bcdfcd3fc273db6c5c21bc9be59))
  <!-- release-notes:289 -->
  - Protected senders and custom categories are now easy lists with add and remove buttons and keyword chips instead of text boxes.
  - AI review shows this month's spend against your budget as a ring; the API key is shown as "set" with a Change button.
  - Login method and shared AI key settings (admins) use clearer rows. Nothing you saved changes.
* livelier Clean up and Insights tabs on phones ([#282](https://github.com/mclgoerg/inboxrake/issues/282)) ([a38df0b](https://github.com/mclgoerg/inboxrake/commit/a38df0b8c852f2e39a97d60f33bd5592068569b8))
  <!-- release-notes:282 -->
  - The Clean up and Insights tabs on phones now show what is waiting (space ready to clean, Triage, live counts) and small previews of Statistics, Space map, Trackers and recent activity.
* numbers formatted for your language ([#294](https://github.com/mclgoerg/inboxrake/issues/294)) ([64a58ea](https://github.com/mclgoerg/inboxrake/commit/64a58ea6c695ddb9c67998f233ecb40e60b3329d))
  <!-- release-notes:294 -->
  Numbers and sizes now follow your language (German "1.732", "11,3 MB"). New Settings > General > Number format lets you pick another style. Exports are unchanged.
* one toolbar with a Filter menu ([#269](https://github.com/mclgoerg/inboxrake/issues/269)) ([cddfe9f](https://github.com/mclgoerg/inboxrake/commit/cddfe9f388165868d7a3c52c13f69d3d478efc8c))
  <!-- release-notes:269 -->
  - Search, filter and sort now share one tidy toolbar; the row of quick-filter chips is replaced by a Filter menu (quick filters, your saved filters, "Describe a filter").
  - The Filter button lights up and the active filter shows as a removable token.
* one-tap filters and a visible "Select all matches" ([#278](https://github.com/mclgoerg/inboxrake/issues/278)) ([ee1d1f6](https://github.com/mclgoerg/inboxrake/commit/ee1d1f60d575bf1002e958353476531468fb5f1d))
  <!-- release-notes:278 -->
  - One tap per filter: pick a quick, "Inactive for" or saved filter, tap it again to switch it off - with the number of matching groups shown per row.
  - A visible "Select all N matches" bar above the filtered list replaces the hidden second tap (protected groups still stay out).
  - "Inactive for" is its own list (6+ months / 1+ year / 2+ years); on phones Filter opens as a sheet and the toolbar is calmer.
* Overview as the new start page ([#272](https://github.com/mclgoerg/inboxrake/issues/272)) ([699c3e0](https://github.com/mclgoerg/inboxrake/commit/699c3e02c6d9c6bca9e964f45577a98a96399c8d))
  <!-- release-notes:272 -->
  - New Overview start page: total size, the biggest senders and ready-made cleanup suggestions at a glance.
  - Quick wins moved there as "Suggestions"; the app now always opens on the Overview instead of remembering All mail.
* overview shows your mailbox balance and last week ([#297](https://github.com/mclgoerg/inboxrake/issues/297)) ([5e5d602](https://github.com/mclgoerg/inboxrake/commit/5e5d602fb07b7e45438010d45558310146bbda2a))
  <!-- release-notes:297 -->
  - The Overview now shows how your mailbox changed: size and a trend against a month ago, an 8-week chart of mails that arrived vs mails you cleaned, "Last week" / "Since last visit", next steps as a checklist and what fills your inbox.
  - Nothing is lost: the biggest senders and every suggestion (Review, Clean up, Not now) are still there.
  - "New AI verdicts" only counts verdicts rated from this version on.
* pick a folder from a searchable list when moving ([#312](https://github.com/mclgoerg/inboxrake/issues/312)) ([516f5d4](https://github.com/mclgoerg/inboxrake/commit/516f5d4f25053099a716ea1437638b33c66b5623))
  <!-- release-notes:312 -->
  Moving mails now uses a searchable folder list with suggestions (your Archive folder and recently used folders) and mail counts instead of a drop-down. When you move everything from one sender you can also choose to always file their new mail there - this creates a rule that starts as a preview, nothing is moved automatically until you arm it.
* pop-up buttons instead of browser dropdowns ([#279](https://github.com/mclgoerg/inboxrake/issues/279)) ([b1a6cdd](https://github.com/mclgoerg/inboxrake/commit/b1a6cdd6c29338e67653b5ab24bbfd6fd597a4c9))
  <!-- release-notes:279 -->
  Menus instead of browser dropdowns for sorting, moving and filtering, and calmer segmented controls.
* read mail like in a mail app ([#316](https://github.com/mclgoerg/inboxrake/issues/316)) ([4eb33a4](https://github.com/mclgoerg/inboxrake/commit/4eb33a41aab2277b44980e0e4e154fc1e72a53b2))
  <!-- release-notes:316 -->
  - Mails now open like in a mail app: sender, readable date, big subject, tracking and attachment chips, folded quotes and an unsubscribe card when the mail has one.
  - A toolbar on every opened mail: Trash, Pin, Move, Conversation and More (open sender, copy address, show headers, block sender); previous / next arrows where you came from a list.
  - Conversations read as cards, your own replies marked "from Sent".
* rules that read like sentences ([#284](https://github.com/mclgoerg/inboxrake/issues/284)) ([7f8d5c9](https://github.com/mclgoerg/inboxrake/commit/7f8d5c93fb7771c5cc49b9d8e629d19b887aa864))
  <!-- release-notes:284 -->
  - Rules now read like sentences, with a Report only / Active switch right on each card.
  - New and edited rules are built from pop-ups in a side panel with a live preview of how many senders and mails match.
  - Nothing about how rules run changes.

  Review follow-ups: per-language sentence templates (DE case/commas), Esc yields to pop-ups and the nested filter sheet, focus moves into/out of the side panel, run/mode errors show on the card. The editor is a side panel at >= 1024 px and a nested full dialog below (centred dialog from 640 px, the existing modal rule).
* search shows senders and mails as you type ([#299](https://github.com/mclgoerg/inboxrake/issues/299)) ([c05ad46](https://github.com/mclgoerg/inboxrake/commit/c05ad464deb6c107fc419d7d5630ae880416528b))
  <!-- release-notes:299 -->
  Search now shows matching senders and mails as you type, with a Recent list and ready-made "Try" searches. Mail-text search is a scope next to "Subject & sender" instead of a checkbox.
* settings as a page with grouped sections ([#283](https://github.com/mclgoerg/inboxrake/issues/283)) ([f6f122b](https://github.com/mclgoerg/inboxrake/commit/f6f122bc657df194398213a07c3527d84440cb60))
  <!-- release-notes:283 -->
  - Settings is now a full page with a section list and search instead of a pop-up window; on phones it works like the iOS Settings app.
  - Changes are saved from a floating bar that appears only when something changed, and Inboxrake asks before you leave with unsaved changes.
  - General settings use switches, steppers and appearance thumbnails.
* sidebar navigation on wide screens ([#267](https://github.com/mclgoerg/inboxrake/issues/267)) ([c33ce17](https://github.com/mclgoerg/inboxrake/commit/c33ce17e2fa53c5b613db24b2248d812111448aa))
  <!-- release-notes:267 -->
  - On wide screens (1024 px and up) a sidebar replaces the Tools menu: cleanup and insight tools, Junk/Trash, search, activity and settings are one click away, and "All mail" is a page of its own.
  - Phones and narrow windows look exactly as before.
* space map as readable tiles or rings ([#308](https://github.com/mclgoerg/inboxrake/issues/308)) ([68d4145](https://github.com/mclgoerg/inboxrake/commit/68d4145f54313f598bf7514f9c1c3b04d9aef3f8))
  <!-- release-notes:308 -->
  - The space map now opens with a sentence ("61 % of your space is mail you barely engage with") and the MB per colour, and shows tiles you can read, with gaps and names.
  - Tap a tile for its details (size, how often opened, last mail, AI verdict) and jump to its senders; double-tap to zoom in.
  - New "Rings" view next to "Tiles": domains inside, their senders outside.
  - Upgrade note: a tap on a tile now shows details instead of zooming in - double-tap or use the zoom button to drill in.
* Statistics as cards all the way down, one colour per category ([#346](https://github.com/mclgoerg/inboxrake/issues/346)) ([df1406b](https://github.com/mclgoerg/inboxrake/commit/df1406bbb323aaa1501dd5fa53d403d2a38a188f))
  <!-- release-notes:346 -->
  Statistics is tidier: four matching figure tiles, mails per year as bars, the cleanup history, AI verdicts and recent scans as cards with proper dates, and top domains / senders that open up with "Show all". Categories now have translated names (in German too) and one colour each across the Overview, Statistics and the space map.
* statistics with charts ([#281](https://github.com/mclgoerg/inboxrake/issues/281)) ([511ac2c](https://github.com/mclgoerg/inboxrake/commit/511ac2c41110a0c84f28fa96e838c879abe43fa3))
  <!-- release-notes:281 -->
  The Statistics page now shows charts and a period switch (30 days / 12 months / all time) for the volume chart and the mail, size and unread figures. It also has a category donut and top senders with bars (click one to open it). All previous figures are still there.
* swipe down to close sheets on phones ([#280](https://github.com/mclgoerg/inboxrake/issues/280)) ([1719920](https://github.com/mclgoerg/inboxrake/commit/17199204bedfb06e51142cd5afa8a61bb06fe1aa))
  <!-- release-notes:280 -->
  On phones, sheets can be swiped down to close.
* swipe rows, pull to scan and swipe back on phones ([#305](https://github.com/mclgoerg/inboxrake/issues/305)) ([7c31984](https://github.com/mclgoerg/inboxrake/commit/7c319840537374fd5eaf6e5db5d3683ffaae98a6))
  <!-- release-notes:305 -->
  - On phones you can now swipe a sender or mail row: left for Trash (or Block / More), right for Protect, Pin and Read. Every action asks the same confirmations as its button.
  - Pull down from the top of Overview, Senders or All mail to scan; the header shows the scan's progress.
  - In the installed app, swipe from the left edge to go back from tool pages, a sender and Settings sections.
* tab bar navigation on phones and tablets ([#271](https://github.com/mclgoerg/inboxrake/issues/271)) ([f878c6b](https://github.com/mclgoerg/inboxrake/commit/f878c6b8aa2b02e40bf4fc0ca897669b4d7fbb0a))
  <!-- release-notes:271 -->
  - On phones and tablets, navigation moves to a tab bar at the bottom (Senders, Clean up, Insights); the Tools menu and header links are replaced by the Clean up and Insights pages, and your account menu is the avatar at the top right.
  - Fixes a sideways scroll on very narrow phones.
* the digest mail shows your week like the Overview ([#301](https://github.com/mclgoerg/inboxrake/issues/301)) ([61beb58](https://github.com/mclgoerg/inboxrake/commit/61beb580f4450690d27dfb9d494ff92dc9885bd2))
  <!-- release-notes:301 -->
  The weekly digest mail now shows your week like the Overview: mails that arrived and were cleaned up, your mailbox size, what needs you and what happened. Set "Link to Inboxrake" in Settings > Weekly digest to get buttons that open the right page, and choose the mail's language (English / Deutsch).
* tool pages get a large title and a back link ([#300](https://github.com/mclgoerg/inboxrake/issues/300)) ([a61c34d](https://github.com/mclgoerg/inboxrake/commit/a61c34dc61bc4160d0667e854800362538f77287))
  <!-- release-notes:300 -->
  Tool pages (Duplicates, Attachments, Rules, Statistics, Trash, ...) have a large title with a back link on phones and a cleaner page title on desktop.
* tools open as pages beside the sidebar ([#273](https://github.com/mclgoerg/inboxrake/issues/273)) ([2d9a079](https://github.com/mclgoerg/inboxrake/commit/2d9a07915448d4b9e6634ef1febcc4e223a37f5c))
  <!-- release-notes:273 -->
  Tools such as Triage, Rules, Trash, Statistics and the Space map now open as pages next to the sidebar on wide screens, and Back / forward and reload keep you on them. The new Activity page lists what you can undo above the audit log. Phones and tablets are unchanged.
* trackers page shows who is watching ([#311](https://github.com/mclgoerg/inboxrake/issues/311)) ([a122756](https://github.com/mclgoerg/inboxrake/commit/a1227562a099ece2c4a19c1815b99f74eecc4167))
  <!-- release-notes:311 -->
  The Trackers page now shows the share of tracked mails as a ring, which tracker hosts are behind them, and which senders track most - with a shortcut to list them all in Senders.
* Trash and Junk pages with auto-empty and restore per mail ([#304](https://github.com/mclgoerg/inboxrake/issues/304)) ([96e0650](https://github.com/mclgoerg/inboxrake/commit/96e06500cda240b64df1d934512ee0b5871347eb))
  <!-- release-notes:304 -->
  - Trash and Junk are now their own pages. Trash shows how much space it holds, has an "Empty automatically" switch (it first shows what it would delete and only starts after you confirm) and a Restore button on every mail.
  - Junk lists senders with Not junk / Block / Trash on each, and points out senders you have replied to.
  - Upgrade: nothing to do; an automatic-empty rule is only created when you turn the switch on.
* triage as a card stack ([#285](https://github.com/mclgoerg/inboxrake/issues/285)) ([fbfd53a](https://github.com/mclgoerg/inboxrake/commit/fbfd53a7d1704c11afad07e0c32f96f8fcbd7bbc))
  <!-- release-notes:285 -->
  Triage now shows your senders as a stack of cards with big round buttons, direction hints while you swipe and a running tally of your decisions.
* Triage uses the width on desktops ([#348](https://github.com/mclgoerg/inboxrake/issues/348)) ([20df621](https://github.com/mclgoerg/inboxrake/commit/20df621885d1ed15c91b5005eef9efdacaad3c57))
  <!-- release-notes:348 -->
  Triage makes better use of wide screens: the buttons show their keyboard shortcuts and sit right under the card, an "Up next" list shows the following cards, and the counters say what they count. Phones are unchanged.
* unsubscribe shows how each sender is unsubscribed ([#317](https://github.com/mclgoerg/inboxrake/issues/317)) ([44fc1ea](https://github.com/mclgoerg/inboxrake/commit/44fc1ea7dcbfd9c11453baf5b46b7b75892a888a))
  <!-- release-notes:317 -->
  - Unsubscribing now shows how each sender is handled before anything is sent: one click, an unsubscribe mail from your address, or a web page you confirm.
  - Optionally move the sender's mails to Trash in the same step (off by default, undoable); the result lists what happened per sender, with "Open page" for web ones.
* warm graphite theme, system font and appearance setting ([#263](https://github.com/mclgoerg/inboxrake/issues/263)) ([cf30219](https://github.com/mclgoerg/inboxrake/commit/cf30219153acc34c2ef21a23ccc04cbf0c5965ab))
  <!-- release-notes:263 -->
  - New calmer look: warm graphite surfaces with a caramel accent, in dark and light.
  - The theme now follows your system's light/dark setting unless you picked one under Appearance (profile menu or Settings > General).
  - If you had chosen a theme before, it is kept.
* your year in mail as a full-screen story ([#315](https://github.com/mclgoerg/inboxrake/issues/315)) ([3a17bcc](https://github.com/mclgoerg/inboxrake/commit/3a17bcc21c5dcb6bd02cfb04b7c1a990bee0627c))
  <!-- release-notes:315 -->
  Your year in mail is now a full-screen story with a colourful card per topic and charts for months, weekdays and hours. Swipe or tap to move on; saving the summary image works as before.


### Bug Fixes

* a clearer sign-in page with translated errors ([#347](https://github.com/mclgoerg/inboxrake/issues/347)) ([08c7ca6](https://github.com/mclgoerg/inboxrake/commit/08c7ca67bd1d8d1709605f0cd8e595d8ff3f4683))
  <!-- release-notes:347 -->
  - The sign-in page is clearer: a centred card with a show / hide password button and its errors in your language.
  - When single sign-on fails (provider unreachable, account not allowed, ...) you now land on the sign-in page with a message instead of a raw error.
  - New FAQ entry on resetting a forgotten password.
* actions finish on the account they started on ([#331](https://github.com/mclgoerg/inboxrake/issues/331)) ([6d3c1c3](https://github.com/mclgoerg/inboxrake/commit/6d3c1c39760da21dd5d857416f3720168bf8126b))
  <!-- release-notes:331 -->
  - Switching accounts while an action is still waiting (turning on "Empty automatically", emptying Junk / Trash, applying Triage, AI rating) no longer lets it run on the other account.
  - "Also move their mails to Trash" after an unsubscribe only moves the mails of the senders you unsubscribed from.
* Back closes tools and sender details on phones ([#309](https://github.com/mclgoerg/inboxrake/issues/309)) ([8364d9c](https://github.com/mclgoerg/inboxrake/commit/8364d9cde8717c9a25ddb6291c5de5da14f324f1))
  <!-- release-notes:309 -->
  - On phones and tablets, the Back button / swipe now closes the open tool, sender or mail first and returns to the page you came from, instead of leaving the app or the page underneath.
* Clean up tiles count every kind of duplicate ([#298](https://github.com/mclgoerg/inboxrake/issues/298)) ([3e6622e](https://github.com/mclgoerg/inboxrake/commit/3e6622edf9ee60f3bd9512cc123970b4749314b9))
  <!-- release-notes:298 -->
  - The Duplicates tile on Clean up now counts every kind of duplicate, matching the Duplicates page.
  - The Attachments tile says "Find big attachments" until a scan result exists, and the result survives a restart.
* clearer settings, tracker list and German wording ([#357](https://github.com/mclgoerg/inboxrake/issues/357)) ([8479c49](https://github.com/mclgoerg/inboxrake/commit/8479c49ca1bc17822e13b35e3426c6ab4453d0eb))
  <!-- release-notes:357 -->
  Settings and the Trackers list are tidier (clearer units, price placeholders, a stat grid, top senders with "Show all"), German wording is fixed, and the demo's monthly figures now agree across pages. No upgrade steps.
* clearing AI verdicts stays inside your own accounts ([#324](https://github.com/mclgoerg/inboxrake/issues/324)) ([943aaab](https://github.com/mclgoerg/inboxrake/commit/943aaabd53a4c133aab88de5bd7dfc224297fbeb))
  <!-- release-notes:324 -->
  Multi-user (OIDC) installs: clearing AI verdicts in Settings no longer touches other users' accounts.
* colours and labels that agree across pages ([#355](https://github.com/mclgoerg/inboxrake/issues/355)) ([dc1dfe2](https://github.com/mclgoerg/inboxrake/commit/dc1dfe28f3304e4eba9585683e22d33b6a3e63fb))
  <!-- release-notes:355 -->
  Colours and labels now agree across pages: "Keep" verdicts are blue instead of red, the Space map shows high-engagement mail in a real colour, and the Insights tab's Recent activity reads like the Activity page. Counts on the Clean up tiles now say what they count.
* dates, numbers and German wording follow your language everywhere ([#353](https://github.com/mclgoerg/inboxrake/issues/353)) ([868306f](https://github.com/mclgoerg/inboxrake/commit/868306f96611e2fbdffb2018ca2fb8c1f844a573))
  <!-- release-notes:353 -->
  Dates, sizes and percentages now follow your language and number format everywhere (no more US-style dates, "30 %" in German, sizes and counts no longer wrap between number and unit), relative times read "vor 3 Min." in German, and a few German wordings were fixed.
* Duplicates and Attachments act only on what you see ([#330](https://github.com/mclgoerg/inboxrake/issues/330)) ([dc0bdbc](https://github.com/mclgoerg/inboxrake/commit/dc0bdbc73d6e5eaa793351472702ee969cde5973))
  <!-- release-notes:330 -->
  - Duplicates: "Trash selected" and "Select all but newest" only act on the tab you are looking at, and Attachments only trashes tiles that are shown.
  - Switching account while Duplicates / Attachments is working no longer moves mails in the other account.
  - Confirmations for a single mail now name its subject.
* Duplicates and Attachments tiles show their last result ([#292](https://github.com/mclgoerg/inboxrake/issues/292)) ([1bfeecb](https://github.com/mclgoerg/inboxrake/commit/1bfeecbd479f6063a81f1127866931e43890ae91))
  <!-- release-notes:292 -->
  The Duplicates and Attachments tiles on the Clean up tab now show their last result instead of "Check".
* every page keeps its own scroll position ([#290](https://github.com/mclgoerg/inboxrake/issues/290)) ([724939d](https://github.com/mclgoerg/inboxrake/commit/724939de4a247cb57e89b9b83cedcc5d1ec85fe8))
  <!-- release-notes:290 -->
  Each page now keeps its own scroll position: new pages open at the top, and going back returns you to where you were.
* Junk works in the demo and a second Junk folder is named up front ([#326](https://github.com/mclgoerg/inboxrake/issues/326)) ([310ccc1](https://github.com/mclgoerg/inboxrake/commit/310ccc177b3cf58c45858cf3909be99674b56821))
  <!-- release-notes:326 -->
  - Junk and Trash pages now tell you up front when two folders could be your Junk or Trash folder, with a button to choose one, instead of failing when you press Empty or Delete permanently.
  - The online demo's Junk page can now be emptied.
* mails on the Junk page open instead of failing ([#306](https://github.com/mclgoerg/inboxrake/issues/306)) ([a9e0cb4](https://github.com/mclgoerg/inboxrake/commit/a9e0cb4beedebad89847820183c484544b5d9035))
  <!-- release-notes:306 -->
  - Mails on the Junk page open again instead of showing "unknown message".
* menus are never cut off by their card ([#293](https://github.com/mclgoerg/inboxrake/issues/293)) ([3ac3299](https://github.com/mclgoerg/inboxrake/commit/3ac3299f6e4ceaa262ace6631d4c8053763d6773))
  <!-- release-notes:293 -->
  Pop-up menus (e.g. the language picker in Settings on a phone) are no longer cut off and no longer make the page jump.
* one page header everywhere ([#354](https://github.com/mclgoerg/inboxrake/issues/354)) ([7a28158](https://github.com/mclgoerg/inboxrake/commit/7a281587629768d234c10d00f948d1ffbc072531))
  <!-- release-notes:354 -->
  Every page now has the same header layout. Page titles, subtitles and buttons sit in the same place on desktop and tablet, and the Senders table headers line up with the Mails / Size column.
* show the demo bar in Safari on iPhone and iPad ([#342](https://github.com/mclgoerg/inboxrake/issues/342)) ([7506801](https://github.com/mclgoerg/inboxrake/commit/75068012b39d5ec27f1fc0c999472d31e1963f0e))
  <!-- release-notes:342 -->
  - The demo's top bar (DEMO, tips, Reset) now shows in Safari on iPhone and iPad.
* small fixes on the new UX7 pages ([#319](https://github.com/mclgoerg/inboxrake/issues/319)) ([933aad3](https://github.com/mclgoerg/inboxrake/commit/933aad34dc802ddce4189f9d43998a8ff9a124ec))
  <!-- release-notes:319 -->
  Filed senders are easier to read on phones, the German Trackers page says "Öffnungen", and the folder picker no longer remembers folders for cancelled moves or clicks through when dismissed.
* small layout fixes across pages ([#352](https://github.com/mclgoerg/inboxrake/issues/352)) ([0d67bed](https://github.com/mclgoerg/inboxrake/commit/0d67bed51e17808d421ff921f86ea1827c5f5a2e))
  <!-- release-notes:352 -->
  - All mail on phones now has the same search / filter toolbar as Senders, and the Junk, Trackers, Space map, Clean up and account screens got layout fixes (no cut-off labels, nothing wrapping beside pills, a calmer dark Space map).
  - The Trash tile on Clean up shows the size of the Trash once it has been opened; the demo's account menu shows only the version.
* small layout fixes on the new tool pages ([#307](https://github.com/mclgoerg/inboxrake/issues/307)) ([279d16a](https://github.com/mclgoerg/inboxrake/commit/279d16a7929a9b8c4befcfeee4c2d2d42d758be2))
  <!-- release-notes:307 -->
  - Smaller layout fixes: file tiles, the Junk page buttons, the German search field, the scan progress line (now names the folder) and the account User field on phones.
* small layout leftovers after the redesign ([#276](https://github.com/mclgoerg/inboxrake/issues/276)) ([70ff13b](https://github.com/mclgoerg/inboxrake/commit/70ff13bf54b960b6a8dfdd267323ae794a0f39c1))
  <!-- release-notes:276 -->
  Small layout fixes: toasts sit in the right place, phone suggestions show protected mails skipped, tools return to their tab, and the Smart pile header no longer clips.
* solid backgrounds for success and error toasts ([#275](https://github.com/mclgoerg/inboxrake/issues/275)) ([5a7a3e5](https://github.com/mclgoerg/inboxrake/commit/5a7a3e5a45781c9302e4fc513b934c29fcb43f02))
  <!-- release-notes:275 -->
  Success and error messages are readable again over busy lists.
* statistics period edges ([#286](https://github.com/mclgoerg/inboxrake/issues/286)) ([f21fe4b](https://github.com/mclgoerg/inboxrake/commit/f21fe4babf7825aff34d09729e82a0164ab23456))
  <!-- release-notes:286 -->
  The "12 months" statistics view now always shows the last 12 calendar months, and the "All time" chart labels the year.
* steadier lists and rows ([#356](https://github.com/mclgoerg/inboxrake/issues/356)) ([eb1840d](https://github.com/mclgoerg/inboxrake/commit/eb1840def4c148459aee80aa72d7a2419183fdb8))
  <!-- release-notes:356 -->
  Lists and rows are steadier: read and unread mails line up, long sender addresses shorten with an ellipsis instead of breaking mid-word, and small layout details on phones (Rules, Activity, Search, All mail while loading) are tidied.
* take Debian security updates when building the image ([#340](https://github.com/mclgoerg/inboxrake/issues/340)) ([acbe6a2](https://github.com/mclgoerg/inboxrake/commit/acbe6a2b3647b67fdf2c8bd26bdf64a51f9388d7))
  <!-- release-notes:340 -->
  - The container image now includes Debian's latest security updates (fixes two zlib vulnerabilities, CVE-2026-76844 and CVE-2026-85091).
* the reader and sender detail act on the mail you are looking at ([#332](https://github.com/mclgoerg/inboxrake/issues/332)) ([f3a5ae2](https://github.com/mclgoerg/inboxrake/commit/f3a5ae259d9d46426f1d2c527a168e5921ef74b9))
  <!-- release-notes:332 -->
  - Sender and conversation details, the reader and the Senders list now always act on what you are looking at: hidden selections are left out of Trash / Move, and trashing a mail from a conversation trashes that mail.
  - "Restore to…" on the Trash page uses the folder picker and no longer offers Trash itself.
* tidier sort menu and round checkboxes in mail lists ([#310](https://github.com/mclgoerg/inboxrake/issues/310)) ([5234e4e](https://github.com/mclgoerg/inboxrake/commit/5234e4e0af62f2bff1459ce1e41028389b8abedb))
  <!-- release-notes:310 -->
  Sort menus are tidier ("Sort by" and "Order" sections) and mail lists use round checkboxes everywhere.
* Undo after Junk and Trash moves, and clearer Junk / Trash notices ([#329](https://github.com/mclgoerg/inboxrake/issues/329)) ([c4c3f0d](https://github.com/mclgoerg/inboxrake/commit/c4c3f0d5b9e41252147f2636935a5fd60c876842))
  <!-- release-notes:329 -->
  - Undo after "Not junk" and Trash on the Junk page works again, and the page updates after it.
  - The "Moved N mails…" banner no longer stays at the top of the app after a Junk or Trash move.
  - When two folders could be your Junk and/or Trash folder, one notice says so, the disabled delete buttons say why, and "Choose folder" takes you straight to the chooser.
* unexpected server errors no longer show internal details ([#341](https://github.com/mclgoerg/inboxrake/issues/341)) ([22c6f46](https://github.com/mclgoerg/inboxrake/commit/22c6f4636a421537e89731d2be058c562af18662))
  <!-- release-notes:341 -->
  Unexpected server errors now show a short, generic message ("Something went wrong on the server - try again; if it keeps happening, check the server log.") instead of internal details; the full error is in the server log.

## [2.2.1](https://github.com/mclgoerg/inboxrake/compare/v2.2.0...v2.2.1) (2026-11-07)


### Bug Fixes

* keep manual picks on "Select all but newest" and complete the duplicates hints ([#261](https://github.com/mclgoerg/inboxrake/issues/261)) ([107073d](https://github.com/mclgoerg/inboxrake/commit/107073d1bdbf9c2914803e0dcc8cbe2ac36be854))
  <!-- release-notes:261 -->
  - "Select all but newest" in the Duplicates panel no longer clears mails you ticked by hand under "Same mail, different versions" or "Possible duplicates".
  - The "No duplicates found" hint now covers all three sections.

## [2.2.0](https://github.com/mclgoerg/inboxrake/compare/v2.1.0...v2.2.0) (2026-11-07)


### Features

* split duplicates into identical copies, different versions and possible duplicates ([#259](https://github.com/mclgoerg/inboxrake/issues/259)) ([c7461f6](https://github.com/mclgoerg/inboxrake/commit/c7461f6801d170d8336830fe40f011544abcb9af))
  <!-- release-notes:259 -->
  - Duplicates are now split into **Identical copies** (same Message-ID and size), **Same mail, different versions** and **Possible duplicates**.
  - Copies of the same mail that differ in size (for example one with its attachments stripped) are listed separately, tagged "largest", and are no longer selected by "Select all but newest" or counted as reclaimable.


### Bug Fixes

* drop Proton-only wording from the attachments hint and docs ([#258](https://github.com/mclgoerg/inboxrake/issues/258)) ([94e1207](https://github.com/mclgoerg/inboxrake/commit/94e1207694e140c2c8924ffdaee4c01e7d171a58))
  <!-- release-notes:258 -->
  - The attachments panel no longer mentions Proton on other providers: it now says that no provider supports removing a single attachment over IMAP, so deleting removes the whole mail (which can be undone).

## [2.1.0](https://github.com/mclgoerg/inboxrake/compare/v2.0.0...v2.1.0) (2026-11-07)


### Features

* improve first-use guidance and mailbox cleanup feedback ([#257](https://github.com/mclgoerg/inboxrake/issues/257)) ([53ca670](https://github.com/mclgoerg/inboxrake/commit/53ca6702cecd76babdb8b63b396b0cda0ca220b5))
  <!-- release-notes:257 -->
  - Account switching, protected senders and Undo are safer; ambiguous server copies require manual restoration from the destination folder.
  - Rules and duplicate cleanup show actual results and failures. Setup, encryption guidance and Trash warnings are clearer.
  - **Upgrading SSO:** sign in again. Existing non-admin tenants require operator-verified `INBOXRAKE_OIDC_LEGACY_BINDINGS`, or settings backup/import and mailbox reconnection; see `docs/security.md`. Administrator ownership binds to a verified immutable provider identity.
  - Settings imports that change connection identity or endpoints clear the corresponding credentials; reconnect before use.


### Bug Fixes

* harden mailbox actions, Undo and SSO identity ownership ([#257](https://github.com/mclgoerg/inboxrake/issues/257)) ([53ca670](https://github.com/mclgoerg/inboxrake/commit/53ca6702cecd76babdb8b63b396b0cda0ca220b5))
* refresh app and website branding with release version ([#255](https://github.com/mclgoerg/inboxrake/issues/255)) ([47973c2](https://github.com/mclgoerg/inboxrake/commit/47973c28ee4611364a3b2a643051d164d9298de7))
  <!-- release-notes:255 -->
  - Refreshed the app, README and website with a smoother rake-and-envelope icon in coffee, caramel and cream.
  - Website and documentation headers now show the current release version, linked to its release notes.

## [2.0.0](https://github.com/mclgoerg/inboxrake/compare/v1.11.0...v2.0.0) (2026-11-06)


### ⚠ BREAKING CHANGES

* rename Mailbroom to Inboxrake ([#204](https://github.com/mclgoerg/inboxrake/issues/204))
  <!-- release-notes:204 -->
  Mailbroom is now **Inboxrake**, because another email app already uses the old name.
  - **Upgrading:** in your compose file, change the image to `ghcr.io/mclgoerg/inboxrake:latest`; the old image gets no more updates. Keep your volume, `.env` and the rest of the compose file as they are. The old `MAILBROOM_*` settings still work, and the log tells you which ones to rename to `INBOXRAKE_*`. `MAILBROOM_BIND`/`MAILBROOM_PORT` belong to your compose file's `ports:` line - rename them only together with it.
  - If you turned on the local mail-text index, Settings shows it as built with a different key after the upgrade - your key is fine, click **Rebuild** once.

### Features

* browser demo shell ([#223](https://github.com/mclgoerg/inboxrake/issues/223)) ([6509cf3](https://github.com/mclgoerg/inboxrake/commit/6509cf378736021848617996245379a537e7f840))
  <!-- release-notes:223 -->
  Inboxrake now has a try-it-in-your-browser demo. It runs entirely in your browser tab with invented mailboxes: no account, no mailbox, nothing leaves your browser.
* demo-mode gating in the UI ([#218](https://github.com/mclgoerg/inboxrake/issues/218)) ([1fe38d5](https://github.com/mclgoerg/inboxrake/commit/1fe38d5ccd0080fc51d824063b2e8995584919b1))
  <!-- release-notes:218 -->
  Inboxrake can now run as the public in-browser demo: controls that need a network (adding accounts, AI, OAuth sign-in, digests, connection tests) are shown greyed out with a "Not available in the demo" note. Normal installs are unchanged.
* possible duplicates - the same mail sent twice within minutes ([#251](https://github.com/mclgoerg/inboxrake/issues/251)) ([a669a2a](https://github.com/mclgoerg/inboxrake/commit/a669a2aedb4dd9c967d461ec74a4eccecf40f0bc))
  <!-- release-notes:251 -->
  - The Duplicates panel now also lists possible duplicates: the same sender and subject sent twice within ten minutes (different Message-IDs). Nothing there is selected for you - open the mails, compare, and tick what to trash.
* rename Mailbroom to Inboxrake ([#204](https://github.com/mclgoerg/inboxrake/issues/204)) ([cbae001](https://github.com/mclgoerg/inboxrake/commit/cbae001ff0723e469f10c38f982aebf29be2d5e9))


### Bug Fixes

* a failed connection test no longer counts as finished setup ([#235](https://github.com/mclgoerg/inboxrake/issues/235)) ([111c1d6](https://github.com/mclgoerg/inboxrake/commit/111c1d60811b0ac09adb41f28dd14cafb851c592))
  <!-- release-notes:235 -->
  If the connection test fails during setup, the home screen now says the account still needs setting up and offers to continue, instead of inviting a scan that hangs. Existing accounts are unaffected.
* a fresh install points to setup instead of Scan ([#249](https://github.com/mclgoerg/inboxrake/issues/249)) ([e803926](https://github.com/mclgoerg/inboxrake/commit/e8039267ed612b7b586ea8b2623223d3d933061d))
  <!-- release-notes:249 -->
  - On a fresh install the main button now says "Set up your mailbox" and opens the setup wizard, instead of offering a Scan that could only fail.
* a rescan no longer forgets attachment sizes ([#252](https://github.com/mclgoerg/inboxrake/issues/252)) ([fa09a11](https://github.com/mclgoerg/inboxrake/commit/fa09a112e7dc67c0fd3eda661ab65185881d322c))
  <!-- release-notes:252 -->
  - Rescanning (including after "Not junk" or Undo) no longer resets attachment sizes, so the attachment-based quick wins stay.
* block rules can't be widened by a crafted sender address ([#240](https://github.com/mclgoerg/inboxrake/issues/240)) ([639e4da](https://github.com/mclgoerg/inboxrake/commit/639e4daefc38599f95e700a2973ec2e4445955c1))
  <!-- release-notes:240 -->
  - Blocking a sender or domain now refuses unusual addresses instead of creating a rule that could match a different sender.
* demo unsubscribe explains instead of opening a dead page ([#228](https://github.com/mclgoerg/inboxrake/issues/228)) ([bec8a1d](https://github.com/mclgoerg/inboxrake/commit/bec8a1de9b4ac26f3919912bfaa464dacc2e5d65))
  <!-- release-notes:228 -->
  The website demo no longer opens a dead page on Unsubscribe; it explains what happens in a real install.
* duplicates are only mails that really are the same ([#248](https://github.com/mclgoerg/inboxrake/issues/248)) ([de60446](https://github.com/mclgoerg/inboxrake/commit/de60446a8138b29cacce7fb1c5aa913245040f17))
  <!-- release-notes:248 -->
  - The duplicate finder now only lists mails that really are the same: the same Message-ID, in any folder. Two different mails from the same sender with the same subject and size (say, monthly statements) are no longer treated as duplicates, so "Select all but newest" can't pick the older one.
  - Mails without a usable Message-ID (missing, or junk such as `<>` / `@` / `-`, or cut off) are still matched by identical sender + subject + size, but only with each other.
* editing an armed rule sends it back to report mode ([#233](https://github.com/mclgoerg/inboxrake/issues/233)) ([a9d2d57](https://github.com/mclgoerg/inboxrake/commit/a9d2d57ca9c78c3db8f7b8054925f359d9366b70))
  <!-- release-notes:233 -->
  - Editing a rule's filter, action, target folder, retention or account now sends it back to report mode. It needs one report run of the new definition before it acts again.
  - Renaming a rule, changing its schedule or enabling/disabling it does not reset it.
  - Existing armed rules keep running as they are until their next edit.
* keep the undo entry when an Undo fails ([#220](https://github.com/mclgoerg/inboxrake/issues/220)) ([b52cea8](https://github.com/mclgoerg/inboxrake/commit/b52cea821848d033bc53a0ae4bcf8e9e02045ece))
  <!-- release-notes:220 -->
  - A failed Undo (server unreachable, Trash cannot be opened, connection dropped halfway) no longer throws the undo entry away: it stays in the list, in the same place, and you can retry. Mails that were already restored are not restored twice.
* limit request body size ([#243](https://github.com/mclgoerg/inboxrake/issues/243)) ([b2b2efe](https://github.com/mclgoerg/inboxrake/commit/b2b2efe47e41cb1b996628df4ae67fa79f2b34fb))
  <!-- release-notes:243 -->
  - The server now refuses oversized requests (HTTP 413) instead of reading them into memory. A settings backup up to 64 MiB can still be imported.
* login throttle holds under parallel attempts ([#229](https://github.com/mclgoerg/inboxrake/issues/229)) ([6cf1a88](https://github.com/mclgoerg/inboxrake/commit/6cf1a886788d762d7b7c45c03388979ad7c11645))
  <!-- release-notes:229 -->
  - Login throttling now also holds against parallel attempts: the 6th attempt within 15 minutes is refused even when many arrive at once.
  - IPv6 clients are counted per /64 network.
  - Behind a reverse proxy, set `FORWARDED_ALLOW_IPS` to the proxy's address (never `*`) so attempts are counted per visitor; without it, 5 wrong passwords from anyone lock everyone out for 15 minutes.
* new rules no longer say they were reset ([#238](https://github.com/mclgoerg/inboxrake/issues/238)) ([fc84b8e](https://github.com/mclgoerg/inboxrake/commit/fc84b8ee397d4d1d0d0847d873b241776a045a59))
  <!-- release-notes:238 -->
  A newly created rule (including Block rules and imported rules) no longer shows "Back in report mode: what the rule acts on was changed".
* Outlook device sign-in no longer sends tokens to the browser ([#230](https://github.com/mclgoerg/inboxrake/issues/230)) ([5e9f69e](https://github.com/mclgoerg/inboxrake/commit/5e9f69e959f30bade6a6d0c913782fc5337678ee))
  <!-- release-notes:230 -->
  - Outlook device-code sign-in no longer sends the access and refresh tokens to the browser; they stay on the server, where they were already saved.
* Outlook setup no longer calls an optional secret required ([#236](https://github.com/mclgoerg/inboxrake/issues/236)) ([3ca9ff4](https://github.com/mclgoerg/inboxrake/commit/3ca9ff4950851356a8b36b2636fe883d0089ce1f))
  <!-- release-notes:236 -->
  The Outlook / Microsoft 365 setup no longer marks the client secret as required; a public client doesn't need one.
* purge rules wait until mail has been in Trash or Junk for N days ([#234](https://github.com/mclgoerg/inboxrake/issues/234)) ([a9cd0d6](https://github.com/mclgoerg/inboxrake/commit/a9cd0d63d6c6f082d55d8920277471073879e0de))
  <!-- release-notes:234 -->
  - Purge rules (Trash/Junk) now delete a mail only once it has been in that folder for more than N days, counted from when Inboxrake first saw it there - a mail you trash by mistake today is no longer deleted on the next run just because it is old.
  - The received-date condition still applies on top.
  - Upgrade note: Inboxrake has no "first seen" time for mail already in Trash/Junk, so after upgrading armed purge rules delete nothing for their first N days. Manual purges in the Folders panel are unchanged.
* rules refuse a qualifier given twice ([#242](https://github.com/mclgoerg/inboxrake/issues/242)) ([6004e58](https://github.com/mclgoerg/inboxrake/commit/6004e582cc28048d46b50671954ab1d15309b400))
  <!-- release-notes:242 -->
  - A rule filter that names the same qualifier twice (for example two `age:` parts) is now refused when saved; before, only the last one counted and the rule could match more mail than intended. Existing rules like that are flagged and don't execute until edited.
* rules refuse filters with mistyped parts ([#237](https://github.com/mclgoerg/inboxrake/issues/237)) ([fb0c09e](https://github.com/mclgoerg/inboxrake/commit/fb0c09e728cc76c512f6d29137d7d2845ad8cc3c))
  <!-- release-notes:237 -->
  - Saving a rule (create or edit) whose filter has a part Inboxrake doesn't understand is refused, with an error naming the part. The editor shows it next to the filter field.
  - Rules saved earlier with such a filter stay saved and show a warning on their card; their execute runs are skipped until you edit the filter. Report runs still work.
* the connection test gives up quickly and can be cancelled ([#246](https://github.com/mclgoerg/inboxrake/issues/246)) ([fd27d13](https://github.com/mclgoerg/inboxrake/commit/fd27d138eb53b5b8b53f0b633e017526990ce97b))
  <!-- release-notes:246 -->
  - Testing a mail connection now gives up after 15 seconds instead of spinning for minutes, and can be cancelled (button, X or Esc).
  - Connection errors say what is wrong: host not found, port closed, no answer, wrong security setting for the port (try STARTTLS on 143 / SSL/TLS on 993), not an IMAP server, or an untrusted certificate.
* the setup card names the mailbox, not its internal id ([#241](https://github.com/mclgoerg/inboxrake/issues/241)) ([b422707](https://github.com/mclgoerg/inboxrake/commit/b422707ae70fdc322a1735f8d75115321c8b4110))
  <!-- release-notes:241 -->
  The "Finish setting up" card now names your mailbox address instead of the internal account name (for example "default").
* undo copes with unusual Message-IDs ([#232](https://github.com/mclgoerg/inboxrake/issues/232)) ([c9362a1](https://github.com/mclgoerg/inboxrake/commit/c9362a1b4ae7dfb9b47d078117773d9a88ef5136))
  <!-- release-notes:232 -->
  - Undo no longer fails, or restores the wrong mails, when a mail's Message-ID contains quotes or other unusual characters.
* undo shows its result where you are ([#247](https://github.com/mclgoerg/inboxrake/issues/247)) ([1fa2051](https://github.com/mclgoerg/inboxrake/commit/1fa205144328ae2b5c1defc9e6631fd3c760aae2))
  <!-- release-notes:247 -->
  - Undo now confirms in a toast where you are ("Restored 120 mails (ACME Store)", or how many came back if only some did) instead of a notice above the list that was often out of view.
  - The page no longer jumps to the top of the list after you confirm an Undo.

## [1.11.0](https://github.com/mclgoerg/mailbroom/compare/v1.10.0...v1.11.0) (2026-11-06)


### Features

* first-run setup wizard ([#206](https://github.com/mclgoerg/mailbroom/issues/206)) ([2b8fb4e](https://github.com/mclgoerg/mailbroom/commit/2b8fb4ef3de59c25daf6eb1a57719300b36ad456))
  <!-- release-notes:206 -->
  New: a first-run setup wizard. A fresh install now walks you through provider, sign-in, folders, an optional password and the first scan; "Add account" in the profile menu uses the same steps. Connection problems are explained in your language (wrong password, server not reachable, certificate problem).
* let Gmail accounts sign in with an app password again ([780e4a8](https://github.com/mclgoerg/mailbroom/commit/780e4a88ec5a57ffd44b82e01b6c915de5c37b13))


### Bug Fixes

* a fresh install no longer fails on the first scan ([#191](https://github.com/mclgoerg/mailbroom/issues/191)) ([0e858a6](https://github.com/mclgoerg/mailbroom/commit/0e858a6c849ae0597772cb51ff754e0efb087052))
  <!-- release-notes:191 -->
  Fixed: a fresh install no longer fails the first scan with a raw file error. Mailbroom now tells you in your language to set up an account first, or names a missing certificate file. The welcome card stays visible after a failed scan, and choosing "Custom" no longer keeps Proton's certificate path.
  Upgrade note: the Proton Bridge certificate path is only assumed when the file exists; set `IMAP_CAFILE` explicitly otherwise.
* accounts connected via OAuth can test the connection and start the first scan ([780e4a8](https://github.com/mclgoerg/mailbroom/commit/780e4a88ec5a57ffd44b82e01b6c915de5c37b13))
* changing an account's provider preset no longer keeps signing in via OAuth ([780e4a8](https://github.com/mclgoerg/mailbroom/commit/780e4a88ec5a57ffd44b82e01b6c915de5c37b13))
* forbid embedding Mailbroom in other sites' frames ([#184](https://github.com/mclgoerg/mailbroom/issues/184)) ([026510d](https://github.com/mclgoerg/mailbroom/commit/026510d921f242e0123a177983cc7db7c960fa4a))
  <!-- release-notes:184 -->
  Other websites can no longer embed Mailbroom in a frame (clickjacking protection); browsers also stop guessing content types and send no referrer to other sites.
* group the Tools menu ([#186](https://github.com/mclgoerg/mailbroom/issues/186)) ([282ce66](https://github.com/mclgoerg/mailbroom/commit/282ce666d17af949d7496638ff7d6bd303f495dd))
  <!-- release-notes:186 -->
  - The Tools menu is now sorted into three sections: Clean up, Insights, and AI & export.
* health checks no longer fill the log ([#192](https://github.com/mclgoerg/mailbroom/issues/192)) ([734bfb6](https://github.com/mclgoerg/mailbroom/commit/734bfb69a8fdd2cae41daa8fc080826a305d9337))
  <!-- release-notes:192 -->
  The container log no longer gets a line every minute from the built-in health check.
* hide folders that can't hold mail, like Gmail's [Gmail] parent ([#196](https://github.com/mclgoerg/mailbroom/issues/196)) ([f43fcff](https://github.com/mclgoerg/mailbroom/commit/f43fcff59f42812a322ded111a063709e9e98a04))
  <!-- release-notes:196 -->
  Folders that only group other folders and can't hold mail (like Gmail's "[Gmail]") no longer show up under Folders to scan and are never scanned or used as a move target.
* keep sign-in tokens out of the settings backup ([#180](https://github.com/mclgoerg/mailbroom/issues/180)) ([310c1a1](https://github.com/mclgoerg/mailbroom/commit/310c1a1e03cd7da4b5e6181e56d1dcd148551932))
  <!-- release-notes:180 -->
  - Settings backups no longer contain sign-in (OAuth) tokens or client secrets.
  - Backup files made by earlier versions may contain such tokens: delete them or keep them private. Importing a backup never changes the sign-in tokens or passwords already on the instance.
* label the Junk and Trash counts in the header ([#181](https://github.com/mclgoerg/mailbroom/issues/181)) ([700fdac](https://github.com/mclgoerg/mailbroom/commit/700fdac4c4630305605d94cad4d2a4de3b427a0b))
  <!-- release-notes:181 -->
  - The Junk and Trash counts in the header now say what they are ("Junk 11", "Trash 70") on tablets and desktops.
* less clutter above the group list ([#203](https://github.com/mclgoerg/mailbroom/issues/203)) ([fad4032](https://github.com/mclgoerg/mailbroom/commit/fad4032ef42d0dc8bbec65ad050d1a00cbb72a0b))
  <!-- release-notes:203 -->
  - The "cached AI verdicts" message is now a small note at the end of the status line instead of a banner.
  - Quick wins remembers per account whether you collapsed it, and a collapsed strip is a single slim line.
  - On phones the quick-filter chips sit on one scrollable line, so more groups fit on the first screen.
* mailto unsubscribe can no longer add mail headers ([#189](https://github.com/mclgoerg/mailbroom/issues/189)) ([f47e4d8](https://github.com/mclgoerg/mailbroom/commit/f47e4d892e5e178be8f9db06cea06a8b452a2b93))
  <!-- release-notes:189 -->
  - Unsubscribing by e-mail now refuses addresses or texts that would add extra recipients or headers to the unsubscribe mail; the sender is then shown as failed.
* never purge other apps' deleted mails while moving ([#199](https://github.com/mclgoerg/mailbroom/issues/199)) ([ca3d9b3](https://github.com/mclgoerg/mailbroom/commit/ca3d9b3080d748e924df58f03af1db68024d2168))
  <!-- release-notes:199 -->
  - On mail servers without the MOVE extension, deleting or restoring mail can no longer permanently remove mails that another mail program had only marked for deletion; the move now stops with a clear message instead.
* refuse requests from other websites when no login is set ([#179](https://github.com/mclgoerg/mailbroom/issues/179)) ([54e5a09](https://github.com/mclgoerg/mailbroom/commit/54e5a0903ea3d0a6b4323b5029be95b588e7e552))
  <!-- release-notes:179 -->
  - Mailbroom now refuses requests that other websites try to make through your browser (DNS rebinding and cross-site form posts).
  - **Upgrade caveat:** if you run without a login and open Mailbroom under a host name (not localhost or an IP address), add `MAILBROOM_ALLOWED_HOSTS=<that name>` to the container environment.
* refuse single sign-on with an unverified email ([759d23e](https://github.com/mclgoerg/mailbroom/commit/759d23ef96d41ea9b36b4a6c2a1b74b1e25c8217))
* save the scan snapshot before a delete job reports done ([#209](https://github.com/mclgoerg/mailbroom/issues/209)) ([6557221](https://github.com/mclgoerg/mailbroom/commit/6557221ff1cbd779aecfcb8ee0c815178a720e2e))
  <!-- release-notes:209 -->
  - A restart right after a delete or move no longer risks bringing back the cleaned-up groups from an older cached scan.
* say clearly when the data folder is not writable ([#194](https://github.com/mclgoerg/mailbroom/issues/194)) ([04bdf61](https://github.com/mclgoerg/mailbroom/commit/04bdf6110e172631b86f8ed3490cb75ab5fcc166))
  <!-- release-notes:194 -->
  - If the data folder is not writable (typically a new host folder mounted at `/data`), Mailbroom now logs the exact fix at startup and the UI says so in plain words instead of showing a raw permission error.
  - The install guide explains the folder ownership (user ID 1000) for Synology, Unraid and TrueNAS.
* send "Describe a filter" with Ctrl+Enter ([#198](https://github.com/mclgoerg/mailbroom/issues/198)) ([c4517f5](https://github.com/mclgoerg/mailbroom/commit/c4517f5e4cea56e16ce6b04475bcde5da44a9b12))
  <!-- release-notes:198 -->
  - "Describe a filter": a hint now says you can send your sentence with Ctrl+Enter (⌘+Enter on a Mac), and the shortcut no longer adds a stray new line.
* show Unsubscribe in a group's view on phones ([#182](https://github.com/mclgoerg/mailbroom/issues/182)) ([5e8b2a5](https://github.com/mclgoerg/mailbroom/commit/5e8b2a52ad69c9a372d9bdbf3a6df45cd157bd69))
  <!-- release-notes:182 -->
  - On phones, the Unsubscribe button is now visible in a sender's view instead of being hidden in the "..." menu.
* sign everyone out when the login changes ([#205](https://github.com/mclgoerg/mailbroom/issues/205)) ([bcfa037](https://github.com/mclgoerg/mailbroom/commit/bcfa037b845aec4e9c157add10ff43ffeb591cf9))
  <!-- release-notes:205 -->
  - Changing the login password, the login method, the allowed SSO users or the admin now signs every other browser out; new "Sign out all sessions" button in Settings -> Server.
  - **Upgrade caveat:** sessions from before this update are refused once - everyone signs in again after updating.
* slow down password guessing on the login page ([#208](https://github.com/mclgoerg/mailbroom/issues/208)) ([b91ea9a](https://github.com/mclgoerg/mailbroom/commit/b91ea9aa51c05e1dac1a95866785927cd8df46c2))
  <!-- release-notes:208 -->
  After 5 wrong passwords within 15 minutes the login page asks you to wait (the message says how long). Behind a reverse proxy all visitors share the proxy's address, so the wait applies to them together.
* Smart rows of a single sender show its AI verdict ([#200](https://github.com/mclgoerg/mailbroom/issues/200)) ([9e8cb7d](https://github.com/mclgoerg/mailbroom/commit/9e8cb7dd3aedbf7dfc012661eb9b67238a4dea52))
  <!-- release-notes:200 -->
  - On the Smart tab, rows that are a single sender now show the AI verdict that sender already has on the Sender tab (pooled company/kind rows are unchanged).
* tell status badges and category tags apart in the group list ([#190](https://github.com/mclgoerg/mailbroom/issues/190)) ([bc250ab](https://github.com/mclgoerg/mailbroom/commit/bc250abf9cbc4e0351964c266eada48891b343d4))
  <!-- release-notes:190 -->
  - In the group list, category tags (newsletter, shopping...) are now outlined and listed after the status badges, so the two are easy to tell apart. The column header reads "Status & tags".
* the deploy starter kit works out of the box ([#178](https://github.com/mclgoerg/mailbroom/issues/178)) ([96348c4](https://github.com/mclgoerg/mailbroom/commit/96348c4a69e9a270b040765e22b896a119d528df))
  <!-- release-notes:178 -->
  - Single sign-on set up through the starter `.env` was broken by stray comment text being read as the issuer, allow-list and redirect values - fixed.
  - The Proton starter kit now needs `BRIDGE_IMAGE` set in `.env` (Mailbroom ships no Bridge image); compose says so if it is missing.
* the trash confirmation names what is moved ([#193](https://github.com/mclgoerg/mailbroom/issues/193)) ([19f500f](https://github.com/mclgoerg/mailbroom/commit/19f500f292ffcbc6ecba9812e383e8d8b52f5bb1))
  <!-- release-notes:193 -->
  - The "Move to Trash" confirmation now names the senders or groups being moved (e.g. "120 mails from Gadget Weekly") and reminds you that the move can be undone from the result message.
* unknown API paths answer 404 ([#188](https://github.com/mclgoerg/mailbroom/issues/188)) ([c17eac6](https://github.com/mclgoerg/mailbroom/commit/c17eac6e5a8477da19840713c10d635df0100155))
  <!-- release-notes:188 -->
  Requests to API addresses that do not exist now get a proper 404 instead of the web page, so scripts and monitors no longer mistake them for success.
* unsubscribe failures say what went wrong in plain words ([#207](https://github.com/mclgoerg/mailbroom/issues/207)) ([e5a0390](https://github.com/mclgoerg/mailbroom/commit/e5a03900499b2386f5e11f549a4434c18deefa78))
  <!-- release-notes:207 -->
  - When an unsubscribe fails, the message now says what went wrong in plain words (and in German), e.g. the sender's page refused, could not be reached, or the link points to an internal address.
* unsubscribe links can no longer reach internal addresses ([#185](https://github.com/mclgoerg/mailbroom/issues/185)) ([790c1a8](https://github.com/mclgoerg/mailbroom/commit/790c1a8f10514e6c5255517d25d8f2a200a44ca0))
  <!-- release-notes:185 -->
  - One-click unsubscribe now refuses links that point at internal or private network addresses, and no longer follows redirects.
  - Unsubscribe links using plain `http` are now handed to you to open yourself instead of being posted automatically.
  - One-click unsubscribe no longer goes through an `HTTPS_PROXY` (it connects straight to the validated address; a proxy would resolve the name again).
* warn when any account at the identity provider may sign in ([759d23e](https://github.com/mclgoerg/mailbroom/commit/759d23ef96d41ea9b36b4a6c2a1b74b1e25c8217))

## [1.10.0](https://github.com/mclgoerg/mailbroom/compare/v1.9.0...v1.10.0) (2026-11-01)


### Features

* describe a filter in your own words and let the AI write it ([#156](https://github.com/mclgoerg/mailbroom/issues/156)) ([5832fa9](https://github.com/mclgoerg/mailbroom/commit/5832fa9e289b7f9802616fc0770f532c191b276f))
  <!-- release-notes:156 -->
  - Describe a filter in your own words: your AI turns the sentence into the filter syntax, which you can check and edit with a live preview before applying it, saving it as a preset or starting a rule from it.
  - Only your sentence, the filter syntax and your tag names are sent to the AI provider - no mail data. Needs an AI provider in Settings.
* flag senders who keep mailing after you unsubscribed ([#155](https://github.com/mclgoerg/mailbroom/issues/155)) ([81545dc](https://github.com/mclgoerg/mailbroom/commit/81545dc668d497582585042090eb170fd4e455c6))
  <!-- release-notes:155 -->
  - Senders that keep mailing more than two days after a successful unsubscribe are now flagged "Still mailing", with a chip, the filter `is:still-mailing` and a one-tap block in the detail view.
  - The activity digest counts them.
* quick-win cleanup suggestions after a scan ([#159](https://github.com/mclgoerg/mailbroom/issues/159)) ([2783e2d](https://github.com/mclgoerg/mailbroom/commit/2783e2d77f13c8644ad46c86c078d9569365a77a))
  <!-- release-notes:159 -->
  After a scan, Mailbroom suggests a few quick cleanups (old newsletters you never open, quiet senders, mail from senders you already unsubscribed from, big old attachments, what the AI rated safe) with how much each frees. Review them in the list or clean up with the usual confirm and Undo; "Not now" hides a card until it grows.
* show which senders track your opens and clicks ([#157](https://github.com/mclgoerg/mailbroom/issues/157)) ([4f9eaa0](https://github.com/mclgoerg/mailbroom/commit/4f9eaa0a3a002d704e1950c8d496996db038594d))
  <!-- release-notes:157 -->
  - See which senders put tracking pixels or click-tracking links in their mail: Tools -> Trackers, a badge on the row, and the filter `has:tracker`.
  - Detected locally while the body index is built - nothing is loaded or sent. Needs the local body index; mails indexed earlier appear under "Check older mails" (a rebuild with the usual confirm).
* space map of what fills your mailbox ([#160](https://github.com/mclgoerg/mailbroom/issues/160)) ([988a8c6](https://github.com/mclgoerg/mailbroom/commit/988a8c6921f6786572c544ad10d6419a0f1952cd))
  <!-- release-notes:160 -->
  - A new space map (Tools -> Space map) shows what fills your mailbox as tiles sized by storage; tap to drill from domains to senders.
  - Tick tiles and hand them to the normal selection to clean up with the usual confirmation and undo.
* swipe through groups to triage them ([#161](https://github.com/mclgoerg/mailbroom/issues/161)) ([17a3586](https://github.com/mclgoerg/mailbroom/commit/17a35861047c5deda843aad26abf1d68f6527e5e))
  <!-- release-notes:161 -->
  - New **Triage** view (Tools menu, button on phones): swipe through groups - left Trash, right Keep, up Unsubscribe - and apply all decisions with one confirm at the end.
  - Buttons, arrow keys and Undo work too; protected senders can never be trashed from it and nothing changes until you confirm.
* your year in mail, story-style ([#162](https://github.com/mclgoerg/mailbroom/issues/162)) ([42bd6a0](https://github.com/mclgoerg/mailbroom/commit/42bd6a0832bf18fe5a89cbb30c9cd8ecf62420d3))
  <!-- release-notes:162 -->
  "Your year in mail" (Tools or Statistics) tells the story of your mailbox year in cards - who wrote most, ghost senders, what you cleaned up - and can save a summary image with sender names hidden.
  It is based on the mail in your mailbox now; mail you deleted since is not counted as received.


### Bug Fixes

* address the user as du everywhere in German ([#165](https://github.com/mclgoerg/mailbroom/issues/165)) ([536528d](https://github.com/mclgoerg/mailbroom/commit/536528d9c2f7702bb379b0c6b36225f98735b83e))
  <!-- release-notes:165 -->
  The German interface now addresses you consistently with "du" (a few hints and the plain-words filter panel still used "Sie").
* arrow keys in Your year in mail act on the loaded cards right away ([#166](https://github.com/mclgoerg/mailbroom/issues/166)) ([b7c03bd](https://github.com/mclgoerg/mailbroom/commit/b7c03bda7b0534ac8ab5c2e70eb826064268b379))
  <!-- release-notes:166 -->
  "Your year in mail": the arrow keys now always move to the next card, even when pressed the moment the story has loaded.
* keep Triage in the Tools menu only ([#164](https://github.com/mclgoerg/mailbroom/issues/164)) ([7229a78](https://github.com/mclgoerg/mailbroom/commit/7229a7811d84fb4812a3d56b1a28f372b912e8b6))
  <!-- release-notes:164 -->
  On phones, Triage now opens from the Tools menu like the other tools; the extra toolbar button is gone, so the toolbar fits on one line again (also in German).
* make the quick-wins strip compact on phones ([#163](https://github.com/mclgoerg/mailbroom/issues/163)) ([4e3fdef](https://github.com/mclgoerg/mailbroom/commit/4e3fdefce282399b73046b0527b94825c290c4d6))
  <!-- release-notes:163 -->
  The quick-wins suggestions take less room on phones: shorter cards, "Not now" is an ✕ in the card's corner, and "more" sits at the end of the swipeable row.

## [1.9.0](https://github.com/mclgoerg/mailbroom/compare/v1.8.0...v1.9.0) (2026-10-28)


### Features

* delete mails in Trash and Junk permanently ([#139](https://github.com/mclgoerg/mailbroom/issues/139)) ([f5d6829](https://github.com/mclgoerg/mailbroom/commit/f5d682916f81dbd27c7f6ce51fb6ef9893c72bd6))
  <!-- release-notes:139 -->
  - New: delete mails in Trash and Junk permanently from the Folders panel - selected mails, one sender, everything received more than N days ago, or "Empty Junk". The count is read live from the server and shown in a confirm that also lists skipped mails from protected senders and protected mails (they are never deleted; remove the protection first to delete them). Junk mails go through Trash first. Irreversible; refused while Trash/Junk is ambiguous and not confirmed in Settings.
  - **The "freed" number changes meaning**: it now counts permanent deletes only (Empty Trash, Junk/Trash deletes), in the Statistics panel, the admin usage table and the digest email. Moving mail to Trash no longer counts as freed. "Freed" only counts permanent deletions from this version on; earlier months show no figure. The digest email gains a "Permanently deleted" line.
* Junk and Trash in one Folders panel ([#138](https://github.com/mclgoerg/mailbroom/issues/138)) ([0e63cfa](https://github.com/mclgoerg/mailbroom/commit/0e63cfad178fe2e57105d0ee103aa9e8aee49638))
  <!-- release-notes:138 -->
  - New Folders panel: browse Junk and Trash side by side, grouped by sender, from a Junk count chip in the header or Tools > Junk & Trash.
  - "Not junk" moves false alarms back to your inbox (undoable) and offers to protect the sender; Junk mails can also be moved to Trash.
  - Nothing is deleted permanently from Junk.
* purge rules for Trash and Junk ([#140](https://github.com/mclgoerg/mailbroom/issues/140)) ([61470f9](https://github.com/mclgoerg/mailbroom/commit/61470f99b5477e03d459ab12d43b1b78c59cf63a))
  <!-- release-notes:140 -->
  - New, opt-in: purge rules for Junk and Trash (Rules -> "Applies to"). A rule deletes mail older than N days (default 30, weekly) **permanently, on the server**.
  - Nothing creates one for you; a new rule only reports what it would delete until you run a report and switch it to execute behind a confirm. Editing its folder, filter or age switches it back to report, and so do renaming its account, changing the account's server or login, or the Junk/Trash folder resolving to another folder (also a folder deleted and re-created).
  - Protected senders and protected mails are never touched; each run is capped (the confirm names the cap). An empty filter means all senders in that folder.
  - Deleting an account deletes its Junk/Trash purge rules; its ordinary mail rules stay and stop running, as before (the delete confirm says so).
  - Fix: rules created while another account was shown were saved for, and ran on, the default account. Check the default account's Rules for any that belong elsewhere (existing misfiled rules are not moved).
  - Upgrade caveat: existing rules are unchanged. If you roll back to an older version, a purge rule is rejected as an unknown action instead of running.
* Settings shows special folders by name and lets you choose between look-alikes ([#137](https://github.com/mclgoerg/mailbroom/issues/137)) ([df5bd5c](https://github.com/mclgoerg/mailbroom/commit/df5bd5cf3191e81af0bb8e31049f341abe53d0de))
  <!-- release-notes:137 -->
  - Settings > Folders now lists special folders (Trash, Junk, Sent, Drafts, Archive, All mail) by their translated names and shows how each was found; subfolders are indented.
  - If two folders could be your Trash or Junk, you can pick the right one; empty-Trash and other permanent actions use exactly that folder.
  - A folder that looks like a second Trash/Junk/Sent/Drafts can have its mail moved into the real folder in one step (undoable).


### Bug Fixes

* count a Gmail mail once even when it has several labels ([#134](https://github.com/mclgoerg/mailbroom/issues/134)) ([0991254](https://github.com/mclgoerg/mailbroom/commit/09912544bef2fb26c703e850a0a06d8d006a7ac8))
  <!-- release-notes:134 -->
  - Gmail: a mail that carries several labels is now counted once (the INBOX copy is preferred), and the Duplicates panel no longer lists label copies as duplicates.
  - Counts on Gmail drop to the real number after the next scan; the first scan also adds one cheap request per folder to learn Gmail's message ids.
  - Other mail providers are unaffected.
* Empty Trash only deletes the mails it counted ([#132](https://github.com/mclgoerg/mailbroom/issues/132)) ([194c828](https://github.com/mclgoerg/mailbroom/commit/194c828b5de0851e42c1731c65894f5172b506d4))
  <!-- release-notes:132 -->
  - Empty Trash now deletes only the mails that were counted in the confirmation; a mail that arrives in Trash meanwhile is kept.
  - It refuses if the server renumbered the Trash folder, and a failed Empty Trash no longer wipes the undo history (after a successful one, only the undo entries of the deleted mails go).
* focus confirm and prompt dialogs in the same commit that opens them ([#147](https://github.com/mclgoerg/mailbroom/issues/147)) ([8106d54](https://github.com/mclgoerg/mailbroom/commit/8106d54475b422d36768ae9d25f1f53befb5e159))
* keep INBOX subfolders directly under INBOX in the Settings folder list ([#141](https://github.com/mclgoerg/mailbroom/issues/141)) ([ef038ae](https://github.com/mclgoerg/mailbroom/commit/ef038aefbe02dd23d9b474e8b28a0d24a87a3999))
  <!-- release-notes:141 -->
  - Settings > Folders: folders that live inside INBOX are now listed directly under INBOX (they used to appear under the next folder in the list, e.g. the archive). Only the display changed; which folders are scanned is unchanged.
* make the segments of the Folders panel toggles equally wide ([#142](https://github.com/mclgoerg/mailbroom/issues/142)) ([fb81f2e](https://github.com/mclgoerg/mailbroom/commit/fb81f2e36ed70b1b1e48592f7fab482e40f7413a))
  <!-- release-notes:142 -->
  - Folders panel: the Junk | Trash switch and the By sender | Mails switch now have equally wide segments.
* neutralise spreadsheet formulas in CSV exports ([#146](https://github.com/mclgoerg/mailbroom/issues/146)) ([79b23e2](https://github.com/mclgoerg/mailbroom/commit/79b23e2132278caab938df100d4179cb60aac1f0))
  <!-- release-notes:146 -->
  - CSV exports (audit log and group list) no longer run spreadsheet formulas: a text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return now gets a leading apostrophe, so Excel, LibreOffice and Sheets show it as text.
  - Numbers, dates and ordinary text are unchanged; text that merely starts with one of those characters (for example `+1 555...`, `@handle` or `- Newsletter`) now shows a leading apostrophe in the spreadsheet.
* never scan Gmail's Starred and Important views as extra copies ([#131](https://github.com/mclgoerg/mailbroom/issues/131)) ([47a0ec7](https://github.com/mclgoerg/mailbroom/commit/47a0ec7fa54bccae7ee772baa57e865fd53ad994))
  <!-- release-notes:131 -->
  - Gmail's Starred and Important views are no longer scanned as extra copies of your mail.
  - Gmail counts drop to the real number after the next scan.
  - Proton Bridge's Starred folder (also a flagged view) is no longer scanned either; it was already excluded by name, so counts there only change if it had been ticked.
* recognise more special folders and pick one when two look alike ([#135](https://github.com/mclgoerg/mailbroom/issues/135)) ([4eb55f7](https://github.com/mclgoerg/mailbroom/commit/4eb55f7612d8651cfdba82cddd3e27e5d9cb32ff))
  <!-- release-notes:135 -->
  - Folders that look like a second Trash, Junk or Sent (for example a mail client's "Gelöschte Elemente" or "Junk-E-Mail" next to the server's own Trash and Junk) are no longer scanned, so their mail no longer shows up as cleanup candidates. This also applies if you had ticked them in Settings. Counts may drop after the next scan.
  - Empty Trash is refused while two folders look like Trash and none is confirmed (it says "Trash is ambiguous - choose it in Settings first"); moving mail to Trash keeps using the automatic pick.
  - Special folders are recognised in more cases (INBOX-prefixed names, more German and Outlook names, Gmail's older attributes); a folder that is now recognised as Trash, Junk, Sent, Drafts or All Mail also stops being scanned.
* show the errors of the folder features in the user's language ([#145](https://github.com/mclgoerg/mailbroom/issues/145)) ([3a39803](https://github.com/mclgoerg/mailbroom/commit/3a39803a0ad9f9c2c4ee74fae7397d06769b1294))
  <!-- release-notes:145 -->
  - The errors of the folder features (Empty Trash, permanent delete, moving mails in the Folders panel, look-alike folders, Undo, Junk / Trash purge rules) now appear in the interface language instead of English - including on a rule's last-run line.
  - The Undo list and the restore confirmation word "2 mails from Junk" in your language (and "1 mail", not "1 mails").
  - Nothing changes in what is refused or when.
* show the purge-rule warning in a danger tone ([#143](https://github.com/mclgoerg/mailbroom/issues/143)) ([8b95128](https://github.com/mclgoerg/mailbroom/commit/8b951287be866c27cd48238cfbb960c98a932e4c))
  <!-- release-notes:143 -->
  - Rules: the "deletes mail on the server, permanently" warning for Junk / Trash rules is now shown in red so it cannot be mistaken for a plain hint.


### Performance Improvements

* keep an incremental index of Trash instead of refetching it on every open ([#136](https://github.com/mclgoerg/mailbroom/issues/136)) ([7d2d97c](https://github.com/mclgoerg/mailbroom/commit/7d2d97ca717740167498b2748850581ec48f170a))
  <!-- release-notes:136 -->
  - Opening the Trash panel is much faster on big Trash folders: only mail that arrived since the last open is fetched.
  - The first Trash open after the upgrade fetches the whole folder once.

## [1.8.0](https://github.com/mclgoerg/mailbroom/compare/v1.7.0...v1.8.0) (2026-10-21)


### Features

* file senders in Smart and keep AI answers ([#121](https://github.com/mclgoerg/mailbroom/issues/121)) ([3301b04](https://github.com/mclgoerg/mailbroom/commit/3301b04055a10894748b26f5be9cbced5fb612e8))
  <!-- release-notes:121 -->
  - **File senders yourself**: in a Smart row, tick senders and choose "File in Smart as…" to put a sender - or its whole company - under any kind or one of your own categories. It never moves mail, is remembered on your server and can be undone.
  - A sender's detail view now shows how Mailbroom files it and why, and lets you change or reset that.
  - After an AI sorting run you can **keep its answers** as your own rules; clearer mail still wins over a kept answer.
* manage what Mailbroom knows about your senders in Settings ([#122](https://github.com/mclgoerg/mailbroom/issues/122)) ([52b16d8](https://github.com/mclgoerg/mailbroom/commit/52b16d8366de239c8bdce7d7380228f462199282))
  <!-- release-notes:122 -->
  - **A new Settings tab "Filed senders"** shows everything you have filed in Smart and every kept AI answer: search and sort it, edit an entry in place, delete (and undo), remove entries that no longer match any sender, keep or forget AI answers in one go, and download or upload just this list.
  - The list stays on your server and is never sent to an AI. Backups (Settings > General > Export) now include it and, like before, list sender addresses - keep the file private.
* private sender knowledge (backend) ([#120](https://github.com/mclgoerg/mailbroom/issues/120)) ([320fb6c](https://github.com/mclgoerg/mailbroom/commit/320fb6c5561f7a60b06aa8ca16889fb80e98f259))
* re-rate groups from the AI review entries ([#106](https://github.com/mclgoerg/mailbroom/issues/106)) ([ed73f8e](https://github.com/mclgoerg/mailbroom/commit/ed73f8eefc957df22484ac8f7500a27fb381c55f))
  <!-- release-notes:106 -->
  - **AI review can now re-rate**: when some of the groups you are reviewing already have an AI verdict, AI review asks whether to review only the new ones or to re-rate all of them (uses tokens again). Nothing changes if no group is rated yet.
* smart grouping replaces the Domain tab ([#105](https://github.com/mclgoerg/mailbroom/issues/105)) ([891713e](https://github.com/mclgoerg/mailbroom/commit/891713e995db61f8f46939cfb3554299ace089ef))
  <!-- release-notes:105 -->
  - The **Domain tab is replaced by Smart**: big senders keep their own row, small senders are pooled by company and by what their mails are about (orders, appointments, applications, support, accounts & security, newsletters, ...), cutting hundreds of rows to about 50.
  - Open a pooled row to see its senders and trash, archive, move, mark read or protect just the ones you tick. Company rows say what their mails are about.
  - Categories you define or edit still decide first and now apply without a rescan; the built-in keyword categories no longer place rows.
  - Optional: a button on the Other row lets your AI sort the senders the rules could not place (you see the scope and cost first; only sender names, addresses, counts and a few subject lines are sent; you can add your own instructions in Settings and remove the sorting again).
  - Settings > "Own row from N mails" (default 10). Domain rules, domain blocks and `@domain` protect entries keep working. After the upgrade the Smart rows are re-derived from the saved scan (no rescan needed).


### Bug Fixes

* bump the python base image to pick up OpenSSL and PCRE2 security fixes ([#114](https://github.com/mclgoerg/mailbroom/issues/114)) ([a63dd52](https://github.com/mclgoerg/mailbroom/commit/a63dd5254f52332b8f5f768ae360b4becd57a519))
  <!-- release-notes:114 -->
  Container image rebuilt on an updated Debian base with OpenSSL and PCRE2 security fixes. No configuration changes; pull the new image to get them.
* count AI sorting and kept answers in senders everywhere ([#123](https://github.com/mclgoerg/mailbroom/issues/123)) ([6c53989](https://github.com/mclgoerg/mailbroom/commit/6c53989dc34bf3519f5899a799b9a8eca470365d))
  <!-- release-notes:123 -->
  - **AI sorting counts in senders everywhere**: the cost dialog, progress, the "done" notice, the Keep button and its result now all use the same unit - senders - instead of mixing senders, groups and answers.
  - The "placed" number no longer counts answers that cannot apply (a shop-type answer for a free-mail sender), so it matches what "Keep these answers" keeps.
* don't reopen the Action menu after a confirm dialog on touch ([#117](https://github.com/mclgoerg/mailbroom/issues/117)) ([e65b0c1](https://github.com/mclgoerg/mailbroom/commit/e65b0c111d063f1b3905411d7b2f349cfee1d515))
  <!-- release-notes:117 -->
  - Fixed: on iPhone/iPad the Action menu no longer pops open again after you confirm an action from it.


### Performance Improvements

* AI group review asks for low reasoning effort ([#118](https://github.com/mclgoerg/mailbroom/issues/118)) ([3a7390f](https://github.com/mclgoerg/mailbroom/commit/3a7390f58e9128a8b1f3a61fc42665aaf59d56f8))
  <!-- release-notes:118 -->
  - **AI review is faster and cheaper**: it now asks the model for low reasoning effort, which roughly halves the time and cuts the cost by about a third; the verdicts come out about the same, slightly more cautious.

## [1.7.0](https://github.com/mclgoerg/mailbroom/compare/v1.6.0...v1.7.0) (2026-10-08)


### Features

* accessibility and polish across the UI ([#100](https://github.com/mclgoerg/mailbroom/issues/100)) ([4148a10](https://github.com/mclgoerg/mailbroom/commit/4148a108d3728e06030fbf6aebdf1dc6e412b37a))
  <!-- release-notes:100 -->
  Better keyboard and screen-reader support (dialogs keep focus inside, phone cards can be opened from the keyboard, labelled pagers), correct singular/plural wording ("1 mail") in English and German, cleaner thread avatars, and a tidier group view on phones. German now says "KI" consistently.
* clearer focus and disabled states, groundwork for the UI refresh ([#91](https://github.com/mclgoerg/mailbroom/issues/91)) ([fa9f510](https://github.com/mclgoerg/mailbroom/commit/fa9f510d5eca1dd739a95310a773590ae669964a))
  <!-- release-notes:91 -->
  - Clearer keyboard focus ring and a consistent greyed-out look for disabled buttons and fields.
  - AI verdict pills are readable in the light theme, and fainter text is easier to read.
  - Rules and Statistics now open full-screen on phones.
* clearer settings layout and filter builder ([#99](https://github.com/mclgoerg/mailbroom/issues/99)) ([a6917a6](https://github.com/mclgoerg/mailbroom/commit/a6917a621d7ae627426e1d561c1f2d68dcb83acd))
  <!-- release-notes:99 -->
  Settings are easier to use: the tabs fit on phones, Save/Cancel sit at the bottom, backup export/import moved to General, and deleting an account or clearing AI data is clearly marked and confirmed. The filter builder's fields line up and open as a sheet on phones.
* clearer, safer destructive actions with in-app confirmations ([#97](https://github.com/mclgoerg/mailbroom/issues/97)) ([83e877f](https://github.com/mclgoerg/mailbroom/commit/83e877f8e6e3c16a293ea675f631c6dbbdbc8c14))
  <!-- release-notes:97 -->
  Deleting is clearer and safer: the group view says exactly how many mails "Trash all" moves, reading a single mail offers "Trash this mail", "Empty Trash" is set apart in the menu and also available in the Trash panel, and confirmations are proper dialogs listing what will happen. The rule form now labels its fields.
* compact dates and a cleaner group table ([#95](https://github.com/mclgoerg/mailbroom/issues/95)) ([b2e7a62](https://github.com/mclgoerg/mailbroom/commit/b2e7a624ddcf4e5bafa6e02384278cf7d8d5088c))
  <!-- release-notes:95 -->
  Dates are shown in a short readable form (e.g. "6 Oct", older ones with the year), so the group table no longer wraps every row onto two lines. Column headers line up, and clicking anywhere on a row opens it.
* compact, consistent mail lists in all panels ([#98](https://github.com/mclgoerg/mailbroom/issues/98)) ([5e414f3](https://github.com/mclgoerg/mailbroom/commit/5e414f3222b8127e9433be0ad43d4bb840a5747c))
  <!-- release-notes:98 -->
  Search, Trash, Attachments, Duplicates, All mails and the group mail lists share one compact two-line mail row (about twice as many mails per screen on phones). Delete buttons only appear once something is selected, and empty panels explain what to do instead of showing unusable buttons.
* flat all-mails view like a classic mail client ([#83](https://github.com/mclgoerg/mailbroom/issues/83)) ([763f8aa](https://github.com/mclgoerg/mailbroom/commit/763f8aa918eaaf98512f5b0885eb7d2a5675055f))
  <!-- release-notes:83 -->
  New "All mails" tab: every scanned mail in one date-sorted list, like a classic mail client. Sort by date, size or sender, filter by words, `from:`, `domain:`, `folder:`, `age:`, `size:`, `is:unread` and more, and act on selected mails (archive, move, mark read, trash). Pinned mails keep their confirmation.
* group mails by conversation thread ([#84](https://github.com/mclgoerg/mailbroom/issues/84)) ([abb945e](https://github.com/mclgoerg/mailbroom/commit/abb945ef96784547fa38f45ae84b1dce380ed2d1))
  <!-- release-notes:84 -->
  New "Thread" tab groups mails by conversation (Message-ID / References), so you can trash whole old conversations at once; threads work with rules, AI review, protected senders and pinned mails.
  **Upgrade note:** after updating, each account is empty until its first scan, which re-fetches all headers once. Mails without reply headers show up as one-mail threads.
* harmonize the UI onto a layered type and spacing scale ([#92](https://github.com/mclgoerg/mailbroom/issues/92)) ([7e13567](https://github.com/mclgoerg/mailbroom/commit/7e13567444f46854daebbb953b7ac9f34aae24a2))
  <!-- release-notes:92 -->
  Consistent text sizes, buttons and colours across all screens. The light theme's status labels are now light, and checkboxes are larger and easier to tap.
* opt-in local mail-text search index with keyed word hashes ([#87](https://github.com/mclgoerg/mailbroom/issues/87)) ([de3c28c](https://github.com/mclgoerg/mailbroom/commit/de3c28cac0919366bc5f645a0cd684e4a9b66e25))
  <!-- release-notes:87 -->
  New opt-in **local word index** for searching inside mail text, meant for **large mailboxes and slow providers** (Settings -> Mail account -> Mail text search -> *Local word index*; needs `MAILBROOM_SECRET_KEY`). Before building, Settings shows the **estimated disk space** (about 5-6 KB per mail) and the free space of the data volume and asks you to confirm; the build is cancellable and shows a progress bar, and every scan then keeps the index current. It stores **no readable mail text** - only keyed hashes of each mail's words - so a copied data volume reveals nothing. Searches match whole words (case/accents ignored), not parts of words, and are instant on any provider. Turning it off deletes the index. The server-side search stays available as before and is already fast for mailboxes of a few thousand mails.
* optional server-side body search with a per-account setting ([#82](https://github.com/mclgoerg/mailbroom/issues/82)) ([b4c5a2c](https://github.com/mclgoerg/mailbroom/commit/b4c5a2cd301c7b53a33db9191b262e6e9bdea38b))
  <!-- release-notes:82 -->
  Search can now look inside mail text: tick "Also search mail text" in the search panel. Your mail server does the searching and Mailbroom stores nothing; remote providers can be slower than Proton Bridge. Turn it off per account under Settings -> Mail account -> Mail text search. On servers without UTF-8 search, accented characters may not match (you get a note).
* per-group engagement score with sort and eng: filter ([#79](https://github.com/mclgoerg/mailbroom/issues/79)) ([1e74dce](https://github.com/mclgoerg/mailbroom/commit/1e74dce931265c60a8420df6e0a66cddd99a8d6b))
  <!-- release-notes:79 -->
  Every group now has an engagement score from 0 to 100 (how much of it you actually read, whether you reply to that sender, how recent it is), shown as a three-bar meter in a new sortable "Eng." column. Sort by engagement, or filter with `eng:low`, `eng:medium` and `eng:high` (also in rules and saved filters). It is computed locally from scan data; nothing new is sent to the AI.
* pin single mails so no bulk action, rule, or AI pick can delete them ([#77](https://github.com/mclgoerg/mailbroom/issues/77)) ([edfc0c4](https://github.com/mclgoerg/mailbroom/commit/edfc0c4b25c62693d046d83eda71789f812de6ae))
  <!-- release-notes:77 -->
  Protect single mails: pin a mail (pin icon on mail rows) and no bulk action, rule, retention window or AI verdict will ever move or delete it. Pinned mails are skipped in group actions and counted in a badge on the group; acting on one directly asks for confirmation first. Filter with `has:pinned`. Undo and the Trash browser are unaffected.
* read a conversation as one thread, including your own replies from Sent ([#86](https://github.com/mclgoerg/mailbroom/issues/86)) ([b2280b9](https://github.com/mclgoerg/mailbroom/commit/b2280b9050a76e3933dc88d8131368c6cad9042d))
  <!-- release-notes:86 -->
  Read a whole conversation as one thread: open any mail that belongs to a thread and tap **Read conversation** (also in the "..." menu of a Thread group). It shows the mails oldest first, **including your own replies from the Sent folder**, with the quoted history of earlier mails folded away. Mails load when you expand them; nothing is stored. If your Sent folder can't be read you still see the received mails, with a note.
* side-by-side group details on wide screens ([#101](https://github.com/mclgoerg/mailbroom/issues/101)) ([0fc75b5](https://github.com/mclgoerg/mailbroom/commit/0fc75b5fa31a13ac8b763e0baaf06bbb0cb40028))
  <!-- release-notes:101 -->
  On wide screens (1280 px and up) a group's mails now open beside the list instead of on top of it, so you can step through senders with j/k and act without closing a popup. Smaller screens are unchanged.
* tidier toolbar with a labelled Tools menu ([#94](https://github.com/mclgoerg/mailbroom/issues/94)) ([0bd30ca](https://github.com/mclgoerg/mailbroom/commit/0bd30ca468a765a51eb6f4a77ccc5b7741ebe148))
  <!-- release-notes:94 -->
  The toolbar is reorganised: Rules, Attachments, Duplicates, Statistics, Audit log, AI review and CSV export are now in one labelled Tools menu, the filter box always gets enough room, and the three "Inactive" quick filters are one compact control. Phones show the list much sooner, and the card layout now stays up to 767 px wide.
* visible result toasts with undo, clearer status and progress ([#93](https://github.com/mclgoerg/mailbroom/issues/93)) ([dfaea61](https://github.com/mclgoerg/mailbroom/commit/dfaea61838d680513121d53524f98790df6d2a4a))
  <!-- release-notes:93 -->
  Results and errors now appear as a message at the bottom of the screen (with Undo after moving mails) instead of a small line at the top that was out of sight after scrolling. A thin progress bar shows running scans and jobs. Filtering to zero results no longer claims there was no scan and offers "Clear filter".


### Bug Fixes

* account menu no longer hidden behind the table header ([#90](https://github.com/mclgoerg/mailbroom/issues/90)) ([483f1b7](https://github.com/mclgoerg/mailbroom/commit/483f1b7fdf8ad58098149805042c84582a5fa377))
  <!-- release-notes:90 -->
  On desktop, the profile menu's theme switch and the Undo list were partly covered by the list header (a click there re-sorted the list). Menus and popups now always appear above the list.
* don't write the full digest recipient address to the server log ([#104](https://github.com/mclgoerg/mailbroom/issues/104)) ([dc003a4](https://github.com/mclgoerg/mailbroom/commit/dc003a4f8ccf9d0c14a12104f097fe98f2f868bc))
  <!-- release-notes:104 -->
  The server log no longer contains the full email address an activity digest was sent to (it shows a masked form like "j***@example.com"); the audit log in the app still shows the recipient.
* open conversations much faster ([#88](https://github.com/mclgoerg/mailbroom/issues/88)) ([c35941e](https://github.com/mclgoerg/mailbroom/commit/c35941eab1bbda298c6b020ad7fa1fd1a745826d))
  <!-- release-notes:88 -->
  Opening a conversation is much faster: looking up your own replies in Sent now takes one search instead of one per reply (about 25x faster on iCloud), results are cached for five minutes, and expanding several mails uses a single connection instead of one per mail.
* restored mails reappear after undo without a manual rescan ([#80](https://github.com/mclgoerg/mailbroom/issues/80)) ([9333a29](https://github.com/mclgoerg/mailbroom/commit/9333a29644eb1d9e4c1297a09bfe343fd06a982e))
  <!-- release-notes:80 -->
  Undo and restoring from the Trash browser now bring the restored mails back into the groups automatically (an incremental rescan runs for you). If another job is running at that moment the restore still works and the notice tells you to rescan.
* scan mails whose headers contain raw non-ASCII characters ([#89](https://github.com/mclgoerg/mailbroom/issues/89)) ([e08c735](https://github.com/mclgoerg/mailbroom/commit/e08c73550366beceb111f335275d52882e422ffb))
  <!-- release-notes:89 -->
  Mails whose headers contain raw non-ASCII characters (for example an unencoded "Müller" in the sender or a non-ASCII Message-ID) are no longer silently skipped or filed under "(unparseable sender)" by scans. They appear after the next scan; no action needed.
* selected end segment keeps the pill's rounded corner ([#102](https://github.com/mclgoerg/mailbroom/issues/102)) ([87c9d9a](https://github.com/mclgoerg/mailbroom/commit/87c9d9a467468dafef43ea67edee3192094e4eb8))
  <!-- release-notes:102 -->
  The selected option at the end of a segmented control (e.g. "2 yr" in the Inactive filter, or "All mails") now keeps the rounded corner instead of showing a square, clipped outline.
* selection bar no longer hides the last rows; compact layout ([#96](https://github.com/mclgoerg/mailbroom/issues/96)) ([9a928d3](https://github.com/mclgoerg/mailbroom/commit/9a928d3c7cc4a8bc635ca4cc0fd4de076f68df71))
  <!-- release-notes:96 -->
  The selection bar at the bottom no longer covers the last rows of the list, takes less space (a single row on larger screens), and the selection checkboxes on phones are much easier to tap.
* touch targets misaligned after rotating the installed iOS PWA ([#81](https://github.com/mclgoerg/mailbroom/issues/81)) ([cb4ca44](https://github.com/mclgoerg/mailbroom/commit/cb4ca44db270c53c8bbcab6da8030992ef8c3d8e))
  <!-- release-notes:81 -->
  Fixes taps landing at an offset in the installed iPhone app after rotating the device or after closing the keyboard from a text field. Text fields are now 16px on touch devices (this stops iOS zooming into them), so form text looks slightly larger on phones.

## [1.6.0](https://github.com/mclgoerg/mailbroom/compare/v1.5.1...v1.6.0) (2026-10-02)


### Features

* configurable auto-scan schedule per account ([#68](https://github.com/mclgoerg/mailbroom/issues/68)) ([44249c2](https://github.com/mclgoerg/mailbroom/commit/44249c2b59154a73d84c4b4190fa837b643837dd))
* incremental scanning - fetch only new/changed mail ([#66](https://github.com/mclgoerg/mailbroom/issues/66)) ([7c901d8](https://github.com/mclgoerg/mailbroom/commit/7c901d840c0d7d6e079e733188448d1a0c8d15da))

## [1.5.1](https://github.com/mclgoerg/mailbroom/compare/v1.5.0...v1.5.1) (2026-10-02)


### Bug Fixes

* make the new-sender window configurable from Settings ([#62](https://github.com/mclgoerg/mailbroom/issues/62)) ([fa264a5](https://github.com/mclgoerg/mailbroom/commit/fa264a5b54fd6ec87cbf94ed9ced0e2876fb75ef))
* use a dark background for the PWA home-screen icon ([#64](https://github.com/mclgoerg/mailbroom/issues/64)) ([07457fe](https://github.com/mclgoerg/mailbroom/commit/07457fe848afb5bdfbc14a99a9d5ccc7aa3d4e34))

## [1.5.0](https://github.com/mclgoerg/mailbroom/compare/v1.4.0...v1.5.0) (2026-10-02)


### Features

* contextual bulk-action bar + quick-select chips, replacing the always-visible toolbar ([#53](https://github.com/mclgoerg/mailbroom/issues/53)) ([b87f340](https://github.com/mclgoerg/mailbroom/commit/b87f3401789acd5ae2e4b7d75b29aae9d6cfb29e))
* daily or weekly activity digest email per account ([#60](https://github.com/mclgoerg/mailbroom/issues/60)) ([4695d4f](https://github.com/mclgoerg/mailbroom/commit/4695d4fe2e02f7d837f386b710f4a7b8f8a27d48))
* flag first-time senders with an is:new filter and review chip ([#61](https://github.com/mclgoerg/mailbroom/issues/61)) ([faaf986](https://github.com/mclgoerg/mailbroom/commit/faaf98671e45b08cf38ad5acb6ba9800ef5ac012))
* group rows drop inline Trash/Block/Protect for an avatar + tap-to-open-detail ([#52](https://github.com/mclgoerg/mailbroom/issues/52)) ([0fb70e9](https://github.com/mclgoerg/mailbroom/commit/0fb70e9fee77f62ba815e4927ff44dbb34e6fb8a))
* redesign the group detail view's filter/selection toolbar ([#58](https://github.com/mclgoerg/mailbroom/issues/58)) ([762a5ed](https://github.com/mclgoerg/mailbroom/commit/762a5edb76d47a2ff6a1dd688a3ec8b0257e9797))
* replace emoji icons with a lucide-react line-icon set ([#51](https://github.com/mclgoerg/mailbroom/issues/51)) ([4e4dd58](https://github.com/mclgoerg/mailbroom/commit/4e4dd5892865209c551f560a5f23284fc124fc72))
* saved filter presets as one-tap chips ([#59](https://github.com/mclgoerg/mailbroom/issues/59)) ([4656b09](https://github.com/mclgoerg/mailbroom/commit/4656b09246cef98a791240e6c3324afb870029e9))
* selection-scoped AI review and CSV export ([#54](https://github.com/mclgoerg/mailbroom/issues/54)) ([af6ae27](https://github.com/mclgoerg/mailbroom/commit/af6ae27f9ad0f216d3546b4cc257bf5786ffad6a))


### Bug Fixes

* disabled selects/inputs dim like disabled buttons ([#50](https://github.com/mclgoerg/mailbroom/issues/50)) ([a696247](https://github.com/mclgoerg/mailbroom/commit/a69624732dcc3b5ab33b612b226b4724803dbde1))
* stop sort control from floating alone with a stray gap ([#57](https://github.com/mclgoerg/mailbroom/issues/57)) ([63c7ffa](https://github.com/mclgoerg/mailbroom/commit/63c7ffae9b5e5141715872e8d9481cd64638bc24))

## [1.4.0](https://github.com/mclgoerg/mailbroom/compare/v1.3.0...v1.4.0) (2026-10-01)


### Features

* block a sender or domain in one click via a standing auto-trash rule ([#48](https://github.com/mclgoerg/mailbroom/issues/48)) ([61657f4](https://github.com/mclgoerg/mailbroom/commit/61657f4f83db38d7d58f6ba2017876f18f7a2527))
* persistent audit log of every mailbox action ([#49](https://github.com/mclgoerg/mailbroom/issues/49)) ([4044654](https://github.com/mclgoerg/mailbroom/commit/40446544605d590d619d5f6913d11ba48c2913e6))
* retention actions - keep the newest N mails or only the last N days of a group ([#47](https://github.com/mclgoerg/mailbroom/issues/47)) ([07a8f1b](https://github.com/mclgoerg/mailbroom/commit/07a8f1ba8db1f8ab84d79e54b7017c895507f32b))


### Bug Fixes

* restructure the SPA containment check as a guard clause ([#46](https://github.com/mclgoerg/mailbroom/issues/46)) ([1ee4e69](https://github.com/mclgoerg/mailbroom/commit/1ee4e691be570066fde8200cdd1c2a2fbf5acb22))
* stop the Server settings tab scrolling sideways on mobile ([#44](https://github.com/mclgoerg/mailbroom/issues/44)) ([d5b5fff](https://github.com/mclgoerg/mailbroom/commit/d5b5fffebbfcd87e84f80c9652bcde1ea8ade68b))
