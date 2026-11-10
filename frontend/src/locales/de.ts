/* German translations. To add a language: copy this file, translate
 * the values, and register it in ../i18n.ts. */

export const DE: Record<string, string> = {
  "ferr.action_cancelled": "Die Aktion wurde abgebrochen; eingereihte Mails wurden nicht verschoben.",
  "confirm.empty_trash_protection": "Auch Mails geschützter Absender und angeheftete Mails im Papierkorb werden endgültig gelöscht.",
  "smart.first_use": "Smart fasst kleine Absender nach Unternehmen oder Art zusammen; große Absender behalten eigene Zeilen. Öffne eine Gruppe und prüfe ihre Absender vor dem Aufräumen.",
  "confirm.b_space": "Das Verschieben in den Papierkorb gibt erst nach dem endgültigen Löschen Speicher auf dem Server frei.",
  "notice.rule_queued": "Regel \"{name}\": {queued} Mails eingereiht. Der Abschluss wird im Aktionsfortschritt angezeigt.",
  "ferr.protected_sender_selected": "Einige ausgewählte Mails gehören zu einem geschützten Absender. Hebe dessen Schutz in der Gruppe auf, bevor du diese Mails verschiebst.",
  "rule.queued": "{n} Mails eingereiht; der Abschluss wird im Aktionsfortschritt angezeigt.",
  "ferr.undo_copy_unknown": "Einige verschobene Kopien konnten nicht sicher erkannt werden. Der Rückgängig-Eintrag bleibt erhalten; öffne den Zielordner und stelle diese Mails dort manuell wieder her.",
  "secrets.plaintext_warning": "Gespeicherte Passwörter und API-Schlüssel sind nicht verschlüsselt. Setze INBOXRAKE_SECRET_KEY in der Container-Umgebung, bevor du Zugangsdaten eingibst, und starte Inboxrake neu. Siehe die Installationsanleitung.",
  "notice.scan_cancelled": "Scan abgebrochen.",
  "notice.action_cancelled": "Aktion abgebrochen.",
  "status.cached_verdicts": "{n} KI-Bewertungen aus dem Cache",
  "notice.cached_verdicts":
    "{n} zwischengespeicherte KI-Bewertungen übernommen (die KI-Prüfung bewertet nur neue Gruppen).",
  "notice.restored":
    "{restored} von {of} Mails wiederhergestellt ({label}).",
  "notice.restored_rescan":
    "{restored} von {of} Mails wiederhergestellt ({label}) - zum Anzeigen neu scannen.",
  "notice.emptied_trash":
    "Papierkorb geleert ({count} Mails endgültig gelöscht).",
  "notice.emptied_trash_one": "Papierkorb geleert (1 Mail endgültig gelöscht).",
  "notice.ai_all_cached":
    "Alle Gruppen haben bereits KI-Bewertungen - nichts zu prüfen.",
  "notice.ai_cancelled": "KI-Prüfung nach {done}/{total} Gruppen abgebrochen.",
  "confirm.act_mails": "{verb}: {n} ausgewählte Mails?",
  "confirm.act_mails_one": "{verb}: 1 ausgewählte Mail?",
  "confirm.unsub_pooled_skipped":
    "{n} gebündelte Zeilen werden übersprungen: öffne eine, um einen einzelnen "
    + "Absender abzubestellen.",
  "toast.unsub_pooled":
    "Abbestellen geht pro Absender: öffne eine gebündelte Zeile und nutze das "
    + "Abbestellen des Absenders.",
  "confirm.restore": "{count} Mails wiederherstellen ({label})?",
  "confirm.restore_one": "1 Mail wiederherstellen ({label})?",
  "ai.usage": "Nutzung",
  "ai.month_title": "Diesen Monat",
  "ai.budget_of": "{spent} von {cap}",
  "ai.budget_resets": "Budget startet am 1. jedes Monats neu",
  "ai.budget_reached": "Budget erreicht – die KI-Prüfung pausiert.",
  "ai.key_set": "•••• gesetzt",
  "ai.key_change": "Ändern…",
  "ai.prices": "Preise",
  "ai.price_in": "Preis Eingabe ($ pro 1 Mio. Token)",
  "ai.price_out": "Preis Ausgabe ($ pro 1 Mio. Token)",
  "ai.price_auto": "automatisch: {n}",
  "ai.runs": "Läufe",
  "ai.tokens": "Token ein / aus",
  "ai.reset_spend": "Kosten zurücksetzen…",
  "ai.clear_verdicts": "KI-Bewertungscache leeren…",
  "confirm.clear_verdicts": "Alle gespeicherten KI-Bewertungen löschen",
  "confirm.clear_verdicts_body":
    "Die Gruppen werden beim nächsten KI-Review neu bewertet - das "
    + "verbraucht Tokens.",
  "confirm.clear_verdicts_confirm": "Cache leeren",
  "confirm.reset_spend": "KI-Kostenzähler zurücksetzen",
  "confirm.reset_spend_body":
    "Die KI-Gesamtkosten ({cost}) und die Kosten dieses Monats ({month}), "
    + "die auf dein Monatsbudget angerechnet werden, beginnen wieder bei null.",
  "confirm.reset_spend_confirm": "Kosten zurücksetzen",
  "confirm.switch_profile":
    "Zum Kontoprofil „{name}“ wechseln? Danach neu scannen.",
  "note.ai_selected": "{note} - {n}/{of} ausgewählt",
  "note.ai_truncated": " (nur die ersten {n} Mails)",
  "note.background": "{verb} - läuft im Hintergrund…",
  "show_more": "{n} weitere anzeigen · noch {hidden}",
  "day.today": "Heute",
  "day.yesterday": "Gestern",
  "ai_done": "KI fertig ({in} rein / {out} raus{cost}) · gesamt {total}",
  "done_moved": "Fertig: {n} Mails verarbeitet.",
  "done_moved_one": "Fertig: 1 Mail verarbeitet.",
  "note.ai_progress": "KI prüft… {done}/{total} Mails",
  "ai.disclaimer":
    "Die KI-Prüfung sendet Mail-METADATEN an den konfigurierten "
    + "KI-Anbieter (z. B. Anthropic, OpenAI, Microsoft Foundry oder ein "
    + "lokales Modell): Absendernamen "
    + "und -adressen, Anzahl, Größen, Daten, Lesestatus, Kategorien, "
    + "Betreffzeilen, Schutz-Markierungen und ob du einem Absender je "
    + "geantwortet hast. Mail-Inhalte und Anhänge werden NIE gesendet. "
    + "Die KI-Sortierung von „Sonstige“ sendet je Absender Name und "
    + "Adresse, Anzahl, ob ein Abmeldelink angeboten wird und bis zu drei "
    + "aktuelle Betreffzeilen – dazu deine eigenen Sortier-Anweisungen aus "
    + "den Einstellungen. Wenn du einen Filter in Worten beschreibst, "
    + "gehen nur dein Satz, die Filter-Syntax und die Namen deiner Kategorien "
    + "an die KI – keine Maildaten.",
  "ai.data_note":
    "An den KI-Anbieter gesendet: Absendernamen/-adressen, Anzahl, "
    + "Größen, Daten, Lesestatus, Kategorien, Betreffzeilen, "
    + "Schutz-Markierungen und ob du einem Absender je geantwortet "
    + "hast - niemals Mail-Inhalte oder Anhänge.",
  "replied": "geantwortet",
  "replied.tip":
    "Du hast diesem Absender schon geschrieben (aus deinem "
    + "Gesendet-Ordner ermittelt)",
  "new_sender.tip":
    "Kürzlich erstmals gesehen - nur ein Hinweis, es wurde automatisch "
    + "nichts unternommen",
  "still.badge": "Schreibt weiter",
  "still.title": "Schreibt nach dem Abbestellen weiter",
  "still.text": "{n} Mails, seit du am {date} abbestellt hast",
  "still.text_one": "1 Mail, seit du am {date} abbestellt hast",
  "still.text_many": "{n} Mails von {senders} Absendern, seit du abbestellt hast (erste am {date})",
  "overview.storage": "Speicher",
  "overview.summary": "in {mails} von {n} Absendern",
  "overview.summary_one": "in {mails} von 1 Absender",
  "overview.can_go": "Bis zu {size} können weg",
  "overview.everyone_else": "Alle anderen",
  "overview.show_all": "Alle {n} anzeigen",
  "overview.biggest": "Größte Absender",
  "overview.balance": "Postfach-Bilanz",
  "overview.trend_less": "{size} weniger als {when}",
  "overview.trend_more": "{size} mehr als {when}",
  "overview.trend_same": "Gleich groß wie {when}",
  "overview.trend_month": "vor einem Monat",
  "overview.trend_days": "vor {n} Tagen",
  "overview.trend_days_one": "vor 1 Tag",
  "overview.last_7_days": "Letzte 7 Tage",
  "overview.days_ago_range": "vor {from}-{to} Tagen",
  "overview.balance_tip": "{range}: {arrived} angekommen{gone} · {cleaned} aufgeräumt",
  "overview.balance_tip_arrived": "{range}: {arrived} angekommen{gone}",
  "overview.balance_from": "vor {n} Wochen",
  "overview.balance_title": "Letzte {n} Wochen",
  "overview.balance_this_week": "diese Woche",
  "overview.balance_arrived": "angekommen",
  "overview.balance_cleaned": "aufgeräumt",
  "overview.balance_note":
    "Hellere Balken sind Schätzungen aus den Mails, die noch in deinem Postfach liegen. Was du vor Beginn der wöchentlichen Zählung aufgeräumt hast, fehlt.",
  "overview.balance_est": "ca. {n}",
  "overview.balance_gone": " (davon {n} nicht mehr in deinem Postfach)",
  "overview.load_failed": "Diese Zahlen konnten nicht geladen werden.",
  "overview.week_title": "Letzte Woche",
  "overview.week_range": "Zeitraum",
  "overview.week_tab": "Letzte Woche",
  "overview.since_tab": "Seit letztem Besuch",
  "overview.since_date": "Seit {date}",
  "overview.when_week": "in den letzten 7 Tagen",
  "overview.when_since": "seit deinem letzten Besuch",
  "overview.week_empty": "Nichts Neues {when}.",
  "overview.row_mails": "{n} neue Mails",
  "overview.row_mails_one": "1 neue Mail",
  "overview.from_senders": "von {n} Absendern",
  "overview.from_senders_one": "von 1 Absender",
  "overview.row_new_senders": "{n} neue Absender",
  "overview.row_new_senders_one": "1 neuer Absender",
  "overview.first_seen": "zum ersten Mal gesehen {when}",
  "overview.row_still": "{n} schreiben weiter",
  "overview.row_still_one": "1 schreibt weiter",
  "overview.row_still_sub": "obwohl du abbestellt hast",
  "overview.row_junk": "{n} im Spam",
  "overview.row_junk_sub": "warten auf einen Blick",
  "overview.row_verdicts": "{n} neue KI-Urteile",
  "overview.row_verdicts_one": "1 neues KI-Urteil",
  "overview.verdicts_safe": "{n} sicher löschbar",
  "overview.verdicts_none_safe": "keins sicher löschbar",
  "overview.next": "Nächste Schritte",
  "overview.next_hint": "jeder Schritt zeigt dir zuerst, was passiert",
  "overview.review_n": "{n} ansehen",
  "overview.check_step": "Bei „Ansehen“ einschließen: {title}",
  "overview.kinds": "Was dein Postfach füllt",
  "overview.kinds_sub": "Mails der letzten {n} Tage nach Art",
  "overview.kinds_empty": "Keine Mails in den letzten {n} Tagen.",
  "overview.kind.newsletter": "Newsletter",
  "overview.kind.automated": "Benachrichtigungen",
  "overview.kind.other": "Sonstiges",
  "cat.shipping": "Versand",
  "cat.finance": "Finanzen",
  "cat.shopping": "Shopping",
  "cat.social": "Soziale Netze",
  "cat.travel": "Reisen",
  "cat.dev_cloud": "Entwicklung & Cloud",
  "overview.percent": "{n} %",
  "qw.card_meta": "{mails} Mails · {size}",
  "qw.protected_skipped": "{n} geschützte übersprungen",
  "qw.review": "Ansehen",
  "qw.clean_up": "Aufräumen…",
  "qw.not_now": "Nicht jetzt",
  "qw.less": "Weniger anzeigen",
  "qw.old_newsletters": "Alte Newsletter, die du nie öffnest",
  "qw.old_newsletters_hint":
    "Massenversender, meist ungelesen, seit über 6 Monaten still",
  "qw.quiet_low": "Ruhige Absender, mit denen du kaum interagierst",
  "qw.quiet_low_hint": "seit über einem Jahr nichts Neues, geringe Interaktion",
  "qw.unsubscribed": "Mails von Absendern, die du abbestellt hast",
  "qw.unsubscribed_hint": "bereits abbestellt - der Rest kann weg",
  "qw.big_attachments": "Große Anhänge, älter als zwei Jahre",
  "qw.big_attachments_hint": "Absender mit über 10 MB Anhängen",
  "qw.ai_safe": "Laut KI sicher löschbar",
  "qw.ai_safe_hint": "von deiner KI-Prüfung als sicher löschbar bewertet",
  "confirm.trash_protected":
    "Die Gruppe „{label}“ ist geschützt. Mails trotzdem in den "
    + "Papierkorb verschieben?",
  "toast.all_protected":
    "Alle ausgewählten Gruppen sind geschützt - nichts wurde gelöscht.",
  "pin.group_on": "Alle Mails dieser Gruppe schützen",
  "pin.group_off": "Schutz aller Mails aufheben",
  "pin.group_skipped":
    "{n} Mails ohne Message-ID konnten nicht geschützt werden.",
  "pin.group_skipped_one":
    "1 Mail ohne Message-ID konnte nicht geschützt werden.",
  "confirm.unpin_group":
    "Den Schutz aller {n} geschützten Mails dieser Gruppe aufheben?",
  "confirm.unpin_group_one":
    "Den Schutz der 1 geschützten Mail dieser Gruppe aufheben?",
  "Sort: engagement": "Sortierung: Interaktion",
  "Eng.": "Interaktion",
  "eng.col_tip":
    "Interaktion: wie viel du von diesem Absender wirklich liest und "
    + "beantwortest",
  "eng.popover_title": "Interaktions-Wert {score}/100 · {tier}",
  "eng.tip": "Interaktion {score}/100 ({tier}): {parts}",
  "eng.low": "niedrig",
  "eng.medium": "mittel",
  "eng.high": "hoch",
  "eng.tag_low": "Geringe Interaktion",
  "eng.tag_medium": "Mittlere Interaktion",
  "eng.tag_high": "Hohe Interaktion",
  "eng.read": "{n}% gelesen",
  "eng.replied": "geantwortet",
  "eng.never_replied": "nie geantwortet",
  "eng.bulk": "Newsletter/Massenmail",
  "eng.last": "letzte Mail {year}",
  "qb.eng_low": "kaum Interaktion",
  "qb.eng_medium": "teils Interaktion",
  "qb.eng_high": "oft Interaktion",
  "bar.all_pinned": "alles geschützt - nichts zu verschieben",
  "toast.all_pinned":
    "Alle ausgewählten Mails sind geschützt - nichts wurde geändert.",
  "pin.protect_tip":
    "Diese Mail schützen - keine Sammelaktion, Regel oder KI-Auswahl "
    + "verschiebt sie",
  "pin.unprotect_tip": "Schutz dieser Mail aufheben",
  "pin.badge_tip": "{n} Mails vor Sammelaktionen geschützt",
  "pin.badge_tip_one": "1 Mail vor Sammelaktionen geschützt",
  "pin.n_protected": "{n} Mails geschützt",
  "pin.n_protected_one": "1 Mail geschützt",
  "pin.error": "Schutz der Mail konnte nicht geändert werden",
  "pin.no_message_id":
    "Diese Mail hat keine Message-ID und ließe sich nach einem erneuten "
    + "Scan nicht wiedererkennen - sie kann nicht geschützt werden.",
  "pin.refused":
    "Die Auswahl enthält geschützte Mails - bestätige sie einzeln oder "
    + "hebe zuerst ihren Schutz auf.",
  "rule.pinned_skipped": "{n} geschützte Mails übersprungen",
  "rule.pinned_skipped_one": "1 geschützte Mail übersprungen",
  "qb.has_pinned": "mit geschützten Mails",
  "qb.has_tracker": "die Öffnen oder Klicks verfolgen",
  "tracker.menu": "Tracker",
  "tools.group_cleanup": "Aufräumen",
  "tools.group_insights": "Einblicke",
  "tab.check": "Prüfen",
  "tab.src.old_newsletters": "Alte Newsletter",
  "tab.src.quiet_low": "Stille Absender",
  "tab.src.unsubscribed": "Abgemeldet",
  "tab.src.big_attachments": "Große Anhänge",
  "tab.src.ai_safe": "KI-sicher",
  "tab.ready": "Bereit zum Aufräumen",
  "tab.ready_none": "Gerade gibt es nichts vorzuschlagen.",
  "tab.ready_scan": "Scanne dein Postfach, um zu sehen, was sich aufräumen lässt.",
  "tab.in_mails": "in {n} Mails",
  "tab.triage_waiting": "{n} Absender warten",
  "tab.triage_waiting_one": "1 Absender wartet",
  "tab.start": "Start",
  "tab.dup_sub": "Kopien finden",
  "tab.running": "Läuft…",
  "tab.dup_sets": "{n} Duplikat-Gruppen",
  "tab.dup_sets_one": "1 Duplikat-Gruppe",
  "tab.dup_compare": "{n} zum Vergleichen",
  "tab.dup_kept": "Nichts zu entfernen · {n} behalten",
  "tab.dup_none": "Keine Kopien gefunden",
  "tab.dup_none_value": "0",
  "tab.att_find": "Große Anhänge finden",
  "tab.att_sub": "in Anhängen",
  "tab.ai_sub": "Mails als sicher bewertet",
  "tab.junk_sub": "warten auf dich",
  "tab.trash_sub": "Mails",
  "tab.rules_last": "zuletzt vor {ago}",
  "tab.rules_none": "noch nie gelaufen",
  "tab.per_month": "{n} im Monat",
  "tab.open_details": "Tippen für Details",
  "tab.space_share": "Die {n} größten Absender = {pct} %",
  "tab.space_share_one": "Größter Absender = {pct} %",
  "tab.trackers_ring": "{pct} % der geprüften Mails enthalten ein Tracking-Pixel",
  "tab.trackers_of": "der geprüften Mails melden das Öffnen",
  "tab.trackers_senders": "{n} Absender tracken dich",
  "tab.trackers_senders_one": "1 Absender trackt dich",
  "tab.trackers_sub": "Sieh, wer dein Öffnen verfolgt",
  "tab.space_scan": "Scanne dein Postfach, um die größten Absender zu sehen.",
  "tab.space_empty": "Noch nichts zu zeigen.",
  "tab.year_stories": "{year} in {n} Geschichten",
  "tab.year_top": "größter Absender {name}",
  "tab.year_title": "{year} in Geschichten",
  "tab.retry": "Erneut versuchen",
  "tab.recent": "Letzte Aktivität",
  "col.status_tags": "Status & Tags",
  "tracker.title": "Tracker",
  "tracker.sub": "Wer deine Öffnungen und Klicks verfolgt",
  "tracker.ring_title": "der geprüften Mails tragen ein Tracking-Pixel",
  "tracker.pixel_short": "Pixel",
  "tracker.click_short": "Klick-Tracking",
  "tracker.safe_line":
    "Mails in Inboxrake zu lesen ist sicher - Bilder aus dem Netz werden nie geladen, Pixel feuern also nie.",
  "tracker.hosts_hint": "Tracker-Dienste",
  "tracker.show_all": "Alle in Absender anzeigen",
  "tracker.explainer":
    "Ein Tracking-Pixel verrät dem Absender, wann und wo du die Mail "
    + "geöffnet hast. Inboxrake lädt niemals Bilder aus dem Netz nach.",
  "tracker.headline":
    "{pct} % der geprüften Mails enthalten ein Tracking-Pixel",
  "tracker.headline_none":
    "In den geprüften Mails wurden keine Tracking-Pixel gefunden",
  "tracker.checked": "{n} von {total} Mails geprüft",
  "tracker.with_pixel": "mit Tracking-Pixel",
  "tracker.with_click": "mit Klick-Tracking",
  "tracker.senders": "Absender mit Tracking",
  "tracker.top_senders": "Absender mit dem meisten Tracking",
  "tracker.top_hosts": "Wer beobachtet dich",
  "tracker.sender_meta": "{n} von {of} Mails mit Tracking",
  "tracker.sender_meta_one": "1 von {of} Mails mit Tracking",
  "tracker.n_senders": "{n} Absender",
  "tracker.n_senders_one": "1 Absender",
  "tracker.tag_pixel": "Öffnungen",
  "tracker.tag_click": "Klicks",
  "tracker.pick": "Mails von {name} anzeigen",
  "tracker.nothing_found":
    "In den {n} geprüften Mails wurde kein Tracking gefunden.",
  "tracker.scan_first": "Scanne zuerst dein Postfach",
  "tracker.none_title": "Noch kein Mail-Textindex",
  "tracker.none_hint":
    "Tracking wird beim Aufbau des lokalen Textindex erkannt. Es wird "
    + "nichts zusätzlich abgerufen.",
  "tracker.enable_local":
    "Stelle die Mailtext-Suche in den Einstellungen auf \u201elokaler "
    + "Index\u201c und baue dort den Index auf - das Tracking wird dabei "
    + "erkannt.",
  "tracker.build": "Textindex aufbauen",
  "tracker.unchecked_title": "Noch nicht geprüft",
  "tracker.unchecked_hint":
    "Diese Mails wurden indexiert, bevor es die Tracker-Erkennung gab. "
    + "Prüfe sie, um den Bericht zu sehen.",
  "tracker.check_older": "Ältere Mails prüfen",
  "tracker.checking": "Mails werden geprüft\u2026",
  "tracker.confirm_note":
    "Sucht außerdem im HTML jeder Mail nach Tracking-Pixeln und "
    + "Klick-Tracking-Links. Es wird nichts nachgeladen oder irgendwohin "
    + "gesendet.",
  "tracker.opens": "Verfolgt Öffnungen",
  "tracker.clicks": "Verfolgt Klicks",
  "tracker.both": "Verfolgt Öffnungen und Klicks",
  "tracker.pop_pixel":
    "{n} von {of} geprüften Mails enthalten ein Tracking-Pixel",
  "tracker.pop_click":
    "{n} von {of} geprüften Mails enthalten Klick-Tracking-Links",
  "tracker.pop_hosts": "Hosts: {hosts}",
  "tracker.pop_hint":
    "Lokal beim Aufbau des Textindex gefunden. Es wurde nichts nachgeladen.",
  "confirm.block_trash_existing":
    "Auch die {n} vorhandenen Mails jetzt in den Papierkorb verschieben?",
  "confirm.block_trash_existing_one":
    "Auch die 1 vorhandene Mail jetzt in den Papierkorb verschieben?",
  "toast.blocked": "„{label}“ blockiert.",
  "block.tip":
    "Diesen Absender/diese Domain blockieren: legt eine dauerhafte Regel "
    + "an, die künftige Mails automatisch in den Papierkorb verschiebt",
  "Block": "Blockieren",
  "Blocked": "Blockiert",
  "toast.unblocked": "„{label}“ entblockt.",
  "unblock.tip":
    "Entblocken: löscht die von Blockieren angelegte dauerhafte Regel",
  "Unblock": "Entblocken",
  "protect.tip":
    "Diesen Absender schützen - Massenlöschungen und KI-Vorschläge "
    + "überspringen ihn",
  "unprotect.tip": "Geschützt - klicken, um den Schutz aufzuheben",
  "protected": "geschützt",
  "Protected senders": "Geschützte Absender",
  "protected.help":
    "Werden von Massenlöschungen, Voreinstellungen und Regeln nie "
    + "gelöscht; die KI stuft sie nie als sicher löschbar ein.",
  "protected.add": "Adresse oder Domain hinzufügen…",
  "protected.add_ph": "name@example.com oder @example.com",
  "protected.everyone": "Alle bei",
  "protected.remove": "{entry} entfernen",
  "protected.err_invalid":
    "„{entry}“ ist weder eine Adresse (name@example.com) noch eine Domain "
    + "(@example.com).",
  "protected.err_dup": "Bereits geschützt: {entry}",
  "settings.add": "Hinzufügen",

  "Scan": "Scannen",
  "Sender": "Absender",
  "Domain": "Domain",
  "Subject": "Betreff",
  "Thread": "Konversation",
  "AI review": "KI-Prüfung",
  "Select…": "Auswählen…",
  "AI-safe groups": "KI: sicher löschbar",
  "Older than 6 months": "Älter als 6 Monate",
  "Older than 1 year": "Älter als 1 Jahr",
  "Older than 2 years": "Älter als 2 Jahre",
  "All / none": "Alle / keine",
  "Clear selection": "Auswahl aufheben",
  "Sort: mails": "Sortierung: Mails",
  "Sort: date": "Sortierung: Datum",
  "Sort: size": "Sortierung: Größe",
  "Sort: last activity": "Sortierung: Aktivität",
  "Sort: unread %": "Sortierung: Ungelesen %",
  "Sort: name": "Sortierung: Name",
  "Trash": "Papierkorb",
  "Trash selected": "Auswahl löschen",
  "Empty Trash": "Papierkorb leeren",
  "Undo": "Rückgängig",
  "Settings": "Einstellungen",
  "Search all mails": "Alle Mails durchsuchen",
  "Search": "Suchen",
  "Select all": "Alle auswählen",
  "AI select deletable": "KI: Löschbares markieren",
  "Unsubscribe": "Abbestellen",
  "Archive": "Archivieren",
  "Move to folder…": "In Ordner verschieben…",
  "Mark read": "Als gelesen markieren",
  "Move to Trash": "In den Papierkorb",
  "Move": "Verschieben",
  "Mark as read": "Als gelesen markieren",
  "Restore": "Wiederherstellen",
  "Action…": "Aktion…",
  "mails": "Mails",
  "groups": "Gruppen",
  "matches": "Treffer",
  "Mails": "Mails",
  "Size": "Größe",
  "Last": "Zuletzt",
  "AI": "KI",
  "unread": "ungelesen",
  "(filtered)": "(gefiltert)",
  "(no subject)": "(kein Betreff)",
  "No scan yet - hit “Scan”.": "Noch kein Scan - auf „Scannen“ klicken.",
  "Scanning…": "Scanne…",
  "Inbox": "Posteingang",
  "Moving…": "Verschiebe…",
  "Restoring…": "Stelle wieder her…",
  "trash.already_empty": "Der Papierkorb ist leer.",
  "Emptying Trash…": "Leere Papierkorb…",
  "loading…": "lade…",
  "cancel": "abbrechen",
  "back to list": "zurück zur Liste",
  "dismiss": "ausblenden",
  "Date": "Datum",
  "Language": "Sprache",
  "Appearance": "Darstellung",
  "Theme": "Design",
  "ai.rate": "KI: Mails bewerten",
  "sel.ai_safe": "KI: sicher löschbar",
  "sel.ai_review": "KI: prüfen",
  "sel.unsub_pending": "Noch nicht abbestellt",
  "endpoint.label": "Endpunkt / Basis-URL",
  "key.optional": "(optional bei lokalen Modellen)",
  "note.ai_resume":
    "bereits bewertete Mails sind gespeichert; erneut klicken zum Fortsetzen",
  "filter.all": "Alle Bewertungen",
  "v.delete_safe": "sicher löschbar",
  "v.review": "prüfen",
  "v.keep": "behalten",
  "v.unrated": "unbewertet",
  "v.set_by_you": "{verdict} · von dir gesetzt",
  "v.held_by_you": "Begrenzt: enthält einen Absender, den du zurückgestellt hast",
  "labels.edit": "Einstufung ändern",
  "labels.title": "Einstufung ändern",
  "labels.loading": "Lädt …",
  "labels.load_failed": "Die Einstufung konnte nicht geladen werden.",
  "labels.verdict": "Einstufung",
  "labels.verdict_aria": "Einstufung dieses Absenders",
  "labels.opt_safe": "Sicher löschbar",
  "labels.opt_review": "Prüfen",
  "labels.opt_keep": "Behalten",
  "labels.ai_said": "Die KI sagte",
  "labels.wins": "deine Wahl gilt vor der KI und bleibt bei neuen Scans erhalten.",
  "labels.ai_none": "Von der KI nicht bewertet.",
  "labels.auto": "Automatisch.",
  "labels.protected": "Geschützte Absender sind nie sicher löschbar.",
  "labels.categories": "Kategorien",
  "labels.none": "Keine Kategorien",
  "labels.add": "Hinzufügen",
  "labels.add_aria": "Kategorie hinzufügen",
  "labels.add_placeholder": "Neue Kategorie",
  "labels.add_confirm": "Kategorie hinzufügen",
  "labels.remove": "{name} entfernen",
  "labels.suggestions": "Vorschläge:",
  "labels.suggest_add": "{name} hinzufügen",
  "labels.smart": "Smart-Gruppe",
  "labels.filed_under": "Eingeordnet unter",
  "labels.reset": "Auf automatisch zurücksetzen",
  "labels.done": "Fertig",
  "labels.saved": "Einstufung gespeichert.",
  "labels.err.bad_request": "Die Anfrage wurde nicht verstanden.",
  "labels.err.bad_key": "Das ist keine Absenderadresse.",
  "labels.err.bad_verdict": "Diese Einstufung gibt es nicht.",
  "labels.err.bad_tags": "Eine Kategorie ist leer oder zu lang, oder es sind zu viele (höchstens 20 mit je 40 Zeichen).",
  "labels.err.full": "Die Liste der eingestuften Absender ist voll.",
  "labels.err.unscanned": "Scanne dieses Konto zuerst.",
  "labels.err.scan_running": "Ein Scan läuft - versuche es gleich noch einmal.",
  "labels.err.unknown_sender": "Dieser Absender ist nicht im letzten Scan.",
  "ratings.aria": "KI-Bewertungen pro Mail: {parts}",
  "ratings.popover_title": "KI-Bewertungen pro Mail",
  "ratings.popover_hint":
    "Anzahl der Mails dieser Gruppe je Bewertung. Gruppe öffnen für Details.",
  "page.first": "Erste Seite",
  "page.prev": "Vorherige Seite",
  "page.next": "Nächste Seite",
  "page.last": "Letzte Seite",
  "page.of": "Seite {p} / {n}",
  "per page": "pro Seite",
  "All": "Alle",
  "Save": "Speichern",
  "Saved.": "Gespeichert.",
  "AI verdict cache cleared.": "KI-Bewertungscache geleert.",
  "Account profile": "Kontoprofil",
  "New": "Neu",
  "Host": "Host",
  "IMAP port": "IMAP-Port",
  "SMTP port": "SMTP-Port",
  "User": "Benutzer",
  "Password": "Passwort",
  "(unchanged)": "(unverändert)",
  "required": "erforderlich",
  "optional": "optional",
  "Folders to scan": "Zu scannende Ordner",
  "Load folders": "Ordner laden",
  "Excluded by rule:": "Durch Regel ausgeschlossen:",
  "Provider": "Anbieter",
  "Model": "Modell",
  "API key": "API-Schlüssel",
  "(no key - AI features hidden)": "(kein Schlüssel - KI ausgeblendet)",
  "runs": "Läufe",
  "AI spend": "KI-Kosten",
  "Mail server (IMAP)": "Mailserver (IMAP)",
  "AI review (optional)": "KI-Prüfung (optional)",
  "AI is reviewing this group…": "Die KI prüft diese Gruppe…",
  "Unsubscribing…": "Bestelle ab…",
  "Opened the sender's unsubscribe page - confirm it there.":
    "Abbestellseite des Absenders geöffnet - dort bestätigen.",
  "Unsubscribed": "Abbestellt",
  "Marked as unsubscribed.": "Als abbestellt markiert.",
  "Showing the newest 500 matches.": "Die neuesten 500 Treffer.",
  "Name for the new account profile:": "Name für das neue Kontoprofil:",
  "Export current grouping as CSV":
    "Aktuelle Gruppierung als CSV exportieren",
  "total": "gesamt",
  "Rules": "Regeln",
  "notice.rule_report":
    "Regel „{name}“ (Bericht): {groups} Gruppen · {mails} Mails wären "
    + "betroffen.",
  "notice.rule_executed":
    "Regel „{name}“ ausgeführt: {acted} Mails eingereiht ({groups} Gruppen).",
  "rules.help":
    "Eine Regel führt einen gespeicherten Filter mit einer Aktion aus - "
    + "höchstens 500 Mails pro Lauf, geschützte Absender werden übersprungen, "
    + "alles lässt sich aus dem Papierkorb rückgängig machen.",
  "rules.how": "So funktionieren Regeln",
  "rules.sub": "{n} Regeln · neue Regeln berichten nur, bis du sie auf Aktiv stellst",
  "rules.sub_one": "1 Regel · neue Regeln berichten nur, bis du sie auf Aktiv stellst",
  "rules.empty": "Noch keine Regeln - unten eine anlegen.",
  "rule.never_ran": "noch nie gelaufen",
  "rule.last_run": "Letzter Lauf {date}",
  "rule.run_failed": "fehlgeschlagen",
  "rule.run_done": "abgeschlossen: {mails} in {groups}",
  "rule.run_would": "Bericht: {mails} in {groups} wären betroffen",
  "rule.run_matched": "{n} Treffer",
  "rule.capped": "{n} Mails über dem Limit pro Lauf",
  "rule.capped_one": "1 Mail über dem Limit pro Lauf",
  "rule.protected_skipped": "{n} geschützte übersprungen",
  "rule.run_now": "Jetzt ausführen",
  "rule.enable_execute": "Ausführen aktivieren",
  "rule.back_to_report": "Zurück zu Bericht",
  "rule.need_report": "Zuerst mindestens einen Bericht ausführen",
  "rule.confirm_execute": "Regel „{name}“ jetzt im AUSFÜHREN-Modus starten?",
  "rule.confirm_delete": "Regel „{name}“ löschen?",
  "rule.edit_title": "Regel bearbeiten",
  "rule.new_title": "Neue Regel",
  "rule.name": "Regelname",
  "rule.create": "Regel anlegen (nur Bericht)",
  "rule.see_report": "Letzter Bericht",
  "rule.report_title": "Letzter Bericht",
  "rule.report_senders": "Wichtigste Absender",
  "rule.f_mode": "Modus",
  "rule.seg_report": "Nur Bericht",
  "rule.seg_active": "Aktiv",
  "rule.sent_mail":
    "Wenn Gruppen nach {grouping} zu {filter} passen, dann {action}{retention}\u00a0· {schedule}",
  "rule.sent_purge":
    "Wenn Gruppen nach {grouping} im {scope} zu {filter} passen, dann {action}{retention}\u00a0· {schedule}",
  "rule.row_when": "Gruppen nach",
  "rule.mid_in": "im",
  "rule.row_grouped": "Gruppiert nach",
  "rule.row_in": "im",
  "rule.row_matches": "passen zu",
  "rule.grp_which": "Welche Mails",
  "rule.grp_what": "Was passiert",
  "rule.ed_older": "wenn älter als {n} Tage",
  "rule.s_all_senders": "allen Absendern",
  "rule.act_trash": "in den Papierkorb verschieben",
  "rule.act_archive": "archivieren",
  "rule.act_move": "in {folder} verschieben",
  "rule.act_mark_read": "als gelesen markieren",
  "rule.act_purge": "endgültig löschen",
  "rule.ret_keep": "außer den neuesten {n}",
  "rule.ret_older": "wenn älter als {n} Tage",
  "rule.ret_older_one": "wenn älter als 1 Tag",
  "rule.ret_pre": ", ",
  "rule.scope_junk": "Spam-Ordner",
  "rule.scope_trash": "Papierkorb",
  "rule.act_move_pick": "in Ordner verschieben",
  "rule.apply_none": "alle Mails",
  "rule.apply_keep": "neueste N behalten, Rest bearbeiten",
  "rule.apply_older": "nur Mails älter als N Tage",
  "rule.s_then": "dann",
  "rule.s_apply": "anwenden auf",
  "rule.s_run": "läuft",
  "rule.s_everything": "allem",
  "rule.more": "Mehr: {name}",
  "rule.new_btn": "Neue Regel",
  "rule.preview": "Vorschau",
  "rule.pv_groups": "Gruppen",
  "rule.pv_groups_one": "Gruppe",
  "rule.pv_mails": "Mails",
  "rule.pv_mails_one": "Mail",
  "rule.pv_skipped": "geschützt übersprungen",
  "rule.pv_more": "+{n} weitere",
  "rule.start_report": "Startet im Berichtsmodus",
  "rule.start_report_sub":
    "Zeigt nur, was passieren würde; stelle auf Aktiv, nachdem du einen Bericht geprüft hast.",
  "rule.match_unknown": "Für Live-Trefferzahlen zuerst scannen",
  "action.trash": "In den Papierkorb",
  "action.archive": "Archivieren",
  "action.move": "In Ordner verschieben",
  "action.mark_read": "Als gelesen markieren",
  "sched.manual": "manuell",
  "sched.daily": "täglich",
  "sched.weekly": "wöchentlich",
  "mode.report": "Bericht",
  "mode.execute": "Ausführen",
  "retention.none": "Alle Mails",
  "retention.keep_latest": "Neueste N behalten, Rest bearbeiten",
  "retention.older_than_days": "Nur Mails älter als N Tage",
  "retention.n_placeholder": "N",
  "retention.help":
    "Beschränkt diese Aktion auf Mails jenseits eines Aufbewahrungsfensters "
    + "statt auf jede Mail der ausgewählten Gruppen.",
  "retention.tag_keep_latest": "neueste {n} behalten",
  "retention.tag_older_than_days": "älter als {n}T",
  "filter.placeholder": "Suchen oder filtern…",
  "filter.menu": "Filter",
  "filter.quick": "Schnellfilter",
  "filter.saved": "Gespeicherte Filter",
  "filter.save_current": "Aktuellen Filter speichern…",
  "filter.describe": "Filter beschreiben (KI)…",
  "filter.build": "Filter bauen…",
  "filter.own": "Eigene",
  "filter.inactive": "Inaktiv seit",
  "filter.inactive_token": "Inaktiv seit {label}",
  "filter.inactive_note": "So lange kam keine Mail vom Absender.",
  "filter.new": "Neue Absender",
  "filter.still": "Schreibt weiter",
  "filter.reset": "Zurücksetzen",
  "filter.done": "Fertig",
  "filter.row_menu": "Mehr zu „{name}“",
  "filter.edit_token": "Filtertext bearbeiten: {name}",
  "select.matches": "Alle {n} Treffer auswählen",
  "select.matches_one": "Den 1 Treffer auswählen",
  "select.matches_all": "Alle {n} Treffer ausgewählt",
  "select.matches_all_one": "Der 1 Treffer ist ausgewählt",
  "select.matches_protected": "{n} geschützte bleiben unausgewählt",
  "select.matches_protected_one": "1 geschützte bleibt unausgewählt",
  "select.matches_clear": "Aufheben",
  "filter.remove": "Filter „{name}“ entfernen",
  "saved_filter.save_tip": "Aktuellen Filter als Vorlage speichern",
  "saved_filter.name_prompt": "Name für diese Vorlage",
  "saved_filter.edit_tip": "Filter dieser Vorlage bearbeiten",
  "saved_filter.editing": '„{name}“ wird bearbeitet',
  "saved_filter.confirm_delete": 'Vorlage "{name}" löschen?',
  "Clear filter": "Filter leeren",
  "Edit": "Bearbeiten",
  "Delete": "Löschen",
  "Attachments": "Anhänge",
  "notice.atts_cancelled": "Anhang-Analyse abgebrochen.",
  "notice.unsub_cancelled": "Abbestellen abgebrochen.",
  "atts.hint":
    "Finde die Mails, die deinen Speicher belegen. Die Analyse liest "
    + "nur die Mail-Struktur (keine Inhalte werden geladen).",
  "atts.summary": "{n} Mails mit Anhängen · {size} gesamt",
  "atts.summary_one": "1 Mail mit Anhängen · {size} gesamt",
  "atts.analyze": "Anhänge analysieren",
  "atts.reanalyze": "Neu analysieren",
  "atts.intro":
    "Analyse starten, um Mails nach Anhanggröße zu listen. Danach "
    + "funktioniert auch der Filter att:>10m auf Gruppen. Einzelne Anhänge "
    + "lassen sich per IMAP nicht entfernen - Löschen entfernt die ganze "
    + "Mail (rückgängig machbar).",
  "atts.none": "Keine Anhänge gefunden",
  "atts.running": "Analysiere Anhänge…",
  "atts.kind.pdf": "PDF",
  "atts.kind.images": "Bilder",
  "atts.kind.video": "Video",
  "atts.kind.audio": "Audio",
  "atts.kind.archives": "Archive",
  "atts.kind.documents": "Dokumente",
  "atts.kind.other": "Sonstige",
  "atts.by_kind": "in Anhängen, nach Dateiart",
  "atts.kind_filter": "Dateiart",
  "atts.repeats_title": "Dieselbe Datei, nochmal geschickt",
  "atts.repeats_sub":
    "{n} Dateien kommen in mehr als einer Mail vor · {size} Wiederholungen",
  "atts.repeats_sub_one":
    "1 Datei kommt in mehr als einer Mail vor · {size} Wiederholungen",
  "atts.repeats_show": "Zeigen",
  "atts.repeats_all": "Alle zeigen",
  "atts.in_mails": "in {n} Mails",
  "atts.older": "Älter als",
  "atts.age_any": "jedes Alter",
  "atts.age_n": "{n} Jahre",
  "atts.age_n_one": "1 Jahr",
  "atts.view": "Ansicht",
  "atts.view_grid": "Kacheln",
  "atts.view_list": "Liste",
  "atts.select_file": "{name} auswählen",
  "atts.sel": "{n} Mails · {size}",
  "atts.sel_one": "1 Mail · {size}",
  "atts.sel_note": "Die ganze Mail kommt in den Papierkorb, nicht nur die Datei.",
  "atts.open": "Öffnen",
  "atts.open_one": "Öffnen geht nur mit genau einer ausgewählten Mail.",
  "atts.capped": "Gezeigt werden die {n} Mails mit den meisten Anhangdaten; kleinere stehen nicht in der Liste.",
  "atts.more": "{n} weitere zeigen",
  "atts.no_match": "Keine passenden Dateien",
  "atts.no_match_hint": "Probier eine andere Dateiart oder ein anderes Alter.",
  "unsub.running": "Bestelle ab…",
  "unsub.done":
    "Abbestellen fertig: {done} erledigt, {links} brauchen Bestätigung, "
    + "{failed} fehlgeschlagen.",
  "unsub.open_link": "Abbestellseite öffnen",
  "unsub.demo_hint": "In deiner eigenen Installation öffnet das die Abbestellseite des Absenders.",
  "unsub.pill_link": "Auf Seite bestätigen",
  "unsub.badge_link": "Bestätigen ↗",
  "unsub.mark_done": "Als erledigt markieren",
  "unsub.retry": "Erneut versuchen",
  "unsub.badge_pending": "{n}/{of} abbestellt",
  "unsub.badge_failed": "Abbestellen fehlgeschlagen",
  "toast.unsub_started": "Bestelle bei {n} Absendern ab…",
  "toast.unsub_started_one": "Bestelle bei 1 Absender ab…",
  "toast.unsub_skipped":
    "({n} bereits erledigt, geschützt oder über dem Limit pro Lauf.)",
  "toast.unsub_skipped_one":
    "(1 bereits erledigt, geschützt oder über dem Limit pro Lauf.)",
  "toast.unsub_nothing":
    "Nichts abzubestellen - alle Absender sind bereits erledigt oder "
    + "geschützt.",
  "unsub.sheet_title": "Abbestellen",
  "unsub.sheet_sub": "{n} Absender · so funktioniert jeder:",
  "unsub.sheet_sub_one": "1 Absender · so funktioniert es:",
  "unsub.via_one_click": "Ein Klick",
  "unsub.via_one_click_note": "sofort erledigt",
  "unsub.via_mailto": "Sendet eine Mail",
  "unsub.via_mailto_note": "von deiner Adresse, über deinen Mailserver",
  "unsub.via_http": "Webseite",
  "unsub.via_http_note": "du bestätigst auf deren Seite",
  "unsub.via_none": "Kein nutzbarer Link",
  "unsub.via_none_note": "dieser Absender lässt sich hier nicht abbestellen",
  "unsub.also_trash": "Auch ihre {n} Mails in den Papierkorb verschieben",
  "unsub.also_trash_one": "Auch ihre 1 Mail in den Papierkorb verschieben",
  "unsub.also_trash_sub": "{size} · du kannst es rückgängig machen",
  "unsub.also_trash_sub_pinned":
    "{size} · {n} angeheftete bleiben · du kannst es rückgängig machen",
  "unsub.trash_note":
    "Der Button unten erledigt beides: Er bestellt ab und verschiebt dann "
    + "die Mails der Absender, die erledigt sind, in den Papierkorb. "
    + "Geschützte Absender und angeheftete Mails bleiben, ebenso die Mails "
    + "eines Absenders, bei dem du noch auf dessen Webseite bestätigen musst "
    + "oder das Abbestellen fehlschlägt.",
  "unsub.trash_none":
    "Es wurden keine Mails in den Papierkorb verschoben: Noch keiner dieser "
    + "Absender ist erledigt.",
  "unsub.still_note":
    "Schreibt einer davon weiter, markiert Inboxrake ihn als "
    + "\u201eSchreibt weiter\u201c und bietet an, ihn zu blockieren.",
  "unsub.skipped":
    "{n} Absender bleiben außen vor: bereits erledigt, geschützt oder über "
    + "dem Limit pro Lauf.",
  "unsub.skipped_one":
    "1 Absender bleibt außen vor: bereits erledigt, geschützt oder über dem "
    + "Limit pro Lauf.",
  "unsub.skipped_no_header":
    "{n} Gruppen ohne Abbestell-Link bleiben außen vor.",
  "unsub.skipped_no_header_one":
    "1 Gruppe ohne Abbestell-Link bleibt außen vor.",
  "unsub.btn": "{n} Absender abbestellen",
  "unsub.btn_one": "1 Absender abbestellen",
  "unsub.btn_trash": "Abbestellen und in den Papierkorb verschieben",
  "unsub.hide": "Ausblenden",
  "unsub.done_btn": "Fertig",
  "unsub.load_failed": "Die Absender konnten nicht geprüft werden: {msg}",
  "unsub.results_gone": "Das Ergebnis dieses Laufs ist nicht mehr verfügbar.",
  "unsub.res_done": "{n} erledigt",
  "unsub.res_need": "bei {n} musst du ran",
  "unsub.res_need_one": "bei 1 musst du ran",
  "unsub.res_failed": "{n} fehlgeschlagen",
  "unsub.res_none": "Nichts abbestellt",
  "unsub.out_done": "Abbestellt",
  "unsub.out_mail": "Abmelde-Mail gesendet",
  "unsub.out_page": "Auf deren Seite bestätigen",
  "unsub.out_failed": "Fehlgeschlagen",
  "unsub.out_marked": "Als erledigt markiert",
  "unsub.open_page": "Seite öffnen",
  "unsub.res_note":
    "Wenn du auf deren Seite bestätigt hast, tippe auf „Als erledigt "
    + "markieren“. Die Aktivität hält das Ergebnis fest.",
  "unsub.trashed":
    "{n} Mails dieser Absender in den Papierkorb verschoben - du kannst es "
    + "rückgängig machen.",
  "unsub.trashed_one":
    "1 Mail dieser Absender in den Papierkorb verschoben - du kannst es "
    + "rückgängig machen.",
  "unsub.trash_failed":
    "Die Mails dieser Absender wurden nicht in den Papierkorb verschoben.",
  "unsub.trash_skipped":
    "Das Abbestellen läuft im Hintergrund weiter. Die Mails dieser Absender "
    + "wurden nicht in den Papierkorb verschoben.",
  "Starting…": "Starte…",
  "Duplicates": "Duplikate",
  "dups.sub": "Dieselbe Mail mehrfach",
  "dups.from_scan": "vom Scan vor {ago}",
  "dups.hero_label": "Identische Kopien entfernen",
  "dups.can_go": "können weg",
  "dups.hero_copies": "{n} identische Kopien",
  "dups.hero_copies_one": "1 identische Kopie",
  "dups.hero_hint":
    "Identisch = gleiche Message-ID und gleiche Größe. Inboxrake behält von jeder Gruppe die neueste Kopie und verschiebt den Rest in den Papierkorb - du kannst es rückgängig machen.",
  "dups.hero_none": "Nichts, das sich mit einem Tipp entfernen lässt",
  "dups.locked_left":
    "{n} Gruppen mit geschützten Absendern oder angehefteten Mails bleiben unangetastet.",
  "dups.locked_left_one":
    "1 Gruppe mit geschütztem Absender oder angehefteter Mail bleibt unangetastet.",
  "dups.capped":
    "Die {n} größten Gruppen werden gezeigt - der Rest erscheint, sobald du diese entfernt hast.",
  "dups.gone": "Nichts mehr zu entfernen - die Liste wurde aktualisiert.",
  "dups.remove_n": "{n} Kopien entfernen",
  "dups.remove_n_one": "1 Kopie entfernen",
  "dups.review_each": "Einzeln prüfen",
  "dups.review_done": "Fertig",
  "dups.seg_label": "Art des Duplikats",
  "dups.seg_identical": "Identisch",
  "dups.seg_versions": "Versionen",
  "dups.seg_possible": "Mögliche",
  "dups.sorted": "Nach Platz sortiert",
  "dups.versions_hint":
    "Dieselbe Mail, aber die Kopien sind unterschiedlich groß (z. B. eine ohne Anhänge) - oder Mails ohne brauchbare Message-ID mit gleichem Absender, Betreff und gleicher Größe. Vergleiche sie; nichts ist vorausgewählt.",
  "dups.possible_hint":
    "Gleicher Absender und Betreff, innerhalb von Minuten gesendet, aber unterschiedliche Message-IDs - sie können sich im Inhalt unterscheiden. Vergleiche sie, bevor du entscheidest; hier wird nichts für dich vorausgewählt.",
  "dups.keep_newest": "Alle außer der neuesten auswählen",
  "dups.wasted": "{size} frei",
  "dups.keep_tag": "Behalten",
  "dups.remove_tag": "Entfernen",
  "dups.largest": "größte",
  "dups.locked_pinned": "angeheftet",
  "dups.locked_protected": "geschützter Absender",
  "dups.compare": "Vergleichen",
  "dups.compare_named": "Vergleichen: {subject}",
  "dups.keep_all": "Alle behalten",
  "dups.keep_all_named": "Alle behalten: {subject}",
  "dups.kept_toast": "Ausgeblendet - du behältst jede Kopie dieser Gruppe.",
  "dups.show_hidden": "Ausgeblendete zeigen ({n})",
  "dups.all_kept": "Nichts mehr zu prüfen",
  "dups.all_kept_hint": "Du hast beschlossen, {n} Gruppen so zu lassen.",
  "dups.all_kept_hint_one": "Du hast beschlossen, 1 Gruppe so zu lassen.",
  "dups.poss_meta": "{n} Mails innerhalb von {gap}",
  "dups.each": "je {size}",
  "dups.n_mails": "{n} Mails",
  "dups.span_s": "{n} s",
  "dups.span_min": "{n} Min.",
  "dups.cmp_title": "Vergleichen",
  "dups.cmp_mail": "Mail {x}",
  "dups.cmp_keep": "behalten",
  "dups.cmp_pair_aria": "Zu vergleichende Mails",
  "dups.cmp_received": "Empfangen",
  "dups.cmp_size": "Größe",
  "dups.cmp_folder": "Ordner",
  "dups.cmp_read": "Gelesen",
  "dups.cmp_yes": "ja",
  "dups.cmp_no": "nein",
  "dups.cmp_id": "Message-ID",
  "dups.cmp_differs": "abweichend",
  "dups.cmp_open": "Öffnen",
  "dups.cmp_open_aria": "Mail {x} öffnen",
  "dups.cmp_note": "Unterschiede sind markiert.",
  "dups.cmp_note_same":
    "Unterschiede sind markiert. Gleiche Größe, {gap} Abstand - höchstwahrscheinlich doppelt gesendet.",
  "dups.cmp_note_diff":
    "Unterschiede sind markiert. Verschiedene Größen, {gap} Abstand - vergleiche, bevor du entscheidest.",
  "dups.cmp_actions": "Was mit dieser Gruppe geschehen soll",
  "dups.cmp_keep_newest": "Neueste behalten, {n} in den Papierkorb",
  "dups.cmp_different": "Die Mails sind verschieden - alle behalten",
  "dups.cmp_footnote": "„Alle behalten“ blendet diese Gruppe aus der Liste aus.",
  "dups.cmp_locked_pinned":
    "Eine Kopie ist eine angeheftete Mail, deshalb lässt sich diese Gruppe nicht in den Papierkorb verschieben.",
  "dups.cmp_locked_protected":
    "Der Absender ist geschützt, deshalb lässt sich diese Gruppe nicht in den Papierkorb verschieben.",
  "dups.none": "Keine Duplikate gefunden",
  "Statistics": "Statistik",
  "stats.period": "Zeitraum",
  "stats.p30": "30 Tage",
  "stats.p12": "12 Monate",
  "stats.pall": "Gesamt",
  "stats.in30": "letzte 30 Tage",
  "stats.in12": "letzte 12 Monate",
  "stats.received": "empfangen",
  "stats.per_mail": "{size} pro Mail",
  "stats.unread_of": "{n} von {total}",
  "stats.trash_label": "in den Papierkorb",
  "stats.this_month": "diesen Monat",
  "stats.archived_n": "{n} archiviert",
  "stats.by_mails_all": "nach Mails · gesamt",
  "stats.by_size_all": "nach Größe · gesamt",
  "stats.show_all": "Alle {n} anzeigen",
  "stats.show_less": "Weniger anzeigen",
  "stats.year_sofar": "bisher",
  "stats.year_from": "ab {date}",
  "stats.cat_note": "Eine Mail kann mehr als eine Kategorie haben.",
  "stats.ai_hint": "Absender-Gruppen",
  "stats.cleanup_hint": "was Inboxrake getan hat",
  "stats.col_domain": "Domain",
  "stats.col_mails": "Mails",
  "stats.col_size": "Größe",
  "stats.col_groups": "Gruppen",
  "stats.col_scan": "Scan",
  "stats.col_month": "Monat",
  "stats.col_trash": "Papierkorb",
  "stats.col_archived": "Archiviert",
  "stats.col_moved": "Verschoben",
  "stats.col_read": "Gelesen markiert",
  "stats.col_deleted": "Gelöscht",
  "stats.m_trash": "{n} in den Papierkorb",
  "stats.m_archived": "{n} archiviert",
  "stats.m_moved": "{n} verschoben",
  "stats.m_read": "{n} gelesen markiert",
  "stats.m_purged": "{n} gelöscht",
  "stats.per_day": "Mails pro Tag (letzte 30)",
  "stats.per_month_all": "Mails pro Monat",
  "stats.other": "Sonstige",
  "stats.none": "Noch nichts vorhanden",
  "stats.freed_pill": "{size} frei",
  "stats.month_tip": "{month} · {mails} · {size}",
  "stats.tagged": "Kategorie-Tags",
  "stats.engagement": "Interaktion",
  "stats.per_year": "Mails pro Jahr",
  "stats.per_month": "Mails pro Monat",
  "stats.total_size": "Gesamtgröße",
  "stats.senders": "Absender",
  "stats.avg_size": "Ø Mailgröße",
  "stats.unread": "ungelesen",
  "stats.replied_senders": "Absender mit Antwort (von {total})",
  "stats.oldest": "Älteste Mail",
  "stats.categories": "Nach Kategorie",
  "stats.top_senders": "Top-Absender",
  "stats.ai": "KI-Bewertungen",
  "stats.rated_mails": "{n} Mails einzeln bewertet ({safe} sicher löschbar)",
  "stats.rated_mails_one": "1 Mail einzeln bewertet ({safe} sicher löschbar)",
  "stats.top_domains": "Top-Domains",
  "stats.cleanup": "Aufgeräumt pro Monat",
  "stats.scans": "Letzte Scans",
  "sieve.button": "Sieve-Filter",
  "sieve.intro":
    "Künftige Mails dieses Absenders automatisch in Proton behandeln:",
  "sieve.fileinto": "In Ordner verschieben",
  "sieve.discard": "Bei Empfang löschen",
  "sieve.markread": "Als gelesen markieren",
  "sieve.copied":
    "Sieve-Filter kopiert - in Protons Filter-Einstellungen einfügen.",
  "sieve.open_proton": "Proton-Filtereinstellungen ↗",
  "Copy": "Kopieren",
  "notice.trash_restored":
    "{n} Mails aus dem Papierkorb nach {dest} wiederhergestellt.",
  "notice.trash_restored_one":
    "1 Mail aus dem Papierkorb nach {dest} wiederhergestellt.",
  "notice.trash_restored_rescan":
    "{n} Mails aus dem Papierkorb nach {dest} wiederhergestellt - zum Anzeigen neu scannen.",
  "notice.trash_restored_rescan_one":
    "1 Mail aus dem Papierkorb nach {dest} wiederhergestellt - zum Anzeigen neu scannen.",
  "Junk": "Spam",
  "fp.delete_permanently": "Endgültig löschen…",
  "fp.older": "Ältere löschen…",
  "fp.older_title": "Alte Mails endgültig löschen",
  "fp.older_label": "Vor mehr als so vielen Tagen empfangen",
  "fp.older_invalid": "Bitte eine ganze Zahl von Tagen von 1 bis 36500 eingeben.",
  "fp.older_btn": "Mails zählen",
  "fp.empty_junk": "Spam leeren ({n})",
  "fp.ambiguous":
    "Mehr als ein Ordner kommt als dein Ordner \u201e{role}\u201c in Frage: "
    + "{folders} - w\u00e4hle einen aus. Bis dahin kannst du Mails "
    + "verschieben, aber nicht endg\u00fcltig l\u00f6schen.",
  "fp.ambiguous_both":
    "Mehr als ein Ordner kommt als dein Ordner \u201e{role}\u201c ({folders}) "
    + "und als dein Ordner \u201e{role2}\u201c ({folders2}) in Frage - w\u00e4hle "
    + "jeweils einen aus. Bis dahin kannst du Mails verschieben, aber nicht "
    + "endg\u00fcltig l\u00f6schen.",
  "fp.ambiguous_choose": "Ordner w\u00e4hlen",
  "fp.ambiguous_hint": "W\u00e4hle zuerst deinen Ordner, um endg\u00fcltig zu l\u00f6schen.",
  "fp.empty_trash": "Papierkorb leeren ({n})",
  "fp.size_in_mails": "in {n} Mails",
  "fp.size_in_mails_one": "in 1 Mail",
  "fp.auto_title": "Automatisch leeren",
  "fp.auto_sub": "Mails älter als {n} Tage, einmal am Tag",
  "fp.auto_sub_one": "Mails älter als 1 Tag, einmal am Tag",
  "fp.auto_report_only":
    "Noch nicht aktiv - Inboxrake meldet nur, was gelöscht würde.",
  "fp.auto_days": "Älter als",
  "fp.auto_apply": "Übernehmen",
  "fp.auto_next": "Nächster Lauf: {n} Mails · {size}",
  "fp.auto_next_one": "Nächster Lauf: 1 Mail · {size}",
  "fp.auto_next_none": "Nächster Lauf: noch nichts zu löschen",
  "fp.auto_last": "Letzter Lauf: {n} Mails gelöscht",
  "fp.auto_last_one": "Letzter Lauf: 1 Mail gelöscht",
  "fp.auto_last_none": "Letzter Lauf: nichts zu löschen",
  "fp.auto_confirm_title": "Papierkorb automatisch leeren?",
  "fp.auto_confirm_body":
    "Einmal am Tag werden Mails endgültig auf dem Server gelöscht, die vor "
    + "mehr als {n} Tagen eingegangen sind und außerdem seit mindestens {n} "
    + "Tagen im Papierkorb liegen - höchstens {cap} pro Lauf. Geschützte "
    + "Absender und geschützte Mails bleiben unangetastet. Das lässt sich "
    + "nicht rückgängig machen.",
  "fp.auto_confirm_body_one":
    "Einmal am Tag werden Mails endgültig auf dem Server gelöscht, die vor "
    + "mehr als 1 Tag eingegangen sind und außerdem seit mindestens 1 Tag "
    + "im Papierkorb liegen - höchstens {cap} pro Lauf. Geschützte "
    + "Absender und geschützte Mails bleiben unangetastet. Das lässt sich "
    + "nicht rückgängig machen.",
  "fp.auto_now": "Jetzt würden {n} Mails · {size} gelöscht",
  "fp.auto_now_one": "Jetzt würde 1 Mail · {size} gelöscht",
  "fp.auto_now_none": "Jetzt gibt es nichts zu löschen",
  "fp.auto_confirm_btn": "Einschalten",
  "fp.auto_on": "Der Papierkorb wird jetzt automatisch geleert",
  "fp.auto_hint": "Mails zählen, sobald sie {n} Tage im Papierkorb liegen.",
  "fp.auto_hint_one": "Mails zählen, sobald sie 1 Tag im Papierkorb liegen.",
  "fp.auto_off_kept":
    "Automatisches Leeren ist aus - die Regel bleibt unter Regeln, nur Bericht",
  "fp.block_keep": "Im Spam lassen",
  "fp.block_trash": "Auch die {n} Mails im Spam jetzt in den Papierkorb verschieben?",
  "fp.block_trash_one": "Auch die 1 Mail im Spam jetzt in den Papierkorb verschieben?",
  "fp.auto_off": "Automatisches Leeren ist aus",
  "fp.auto_rule_name": "Papierkorb automatisch leeren",
  "fp.purge_title": "Endgültig aus „{folder}“ löschen?",
  "fp.purge_title_empty": "„{folder}“ endgültig leeren?",
  "fp.purge_body_junk":
    "Diese Mails werden zuerst in den Papierkorb verschoben und dort auf "
    + "dem Server gelöscht. Das lässt sich nicht rückgängig machen.",
  "fp.purge_body_trash":
    "Diese Mails werden auf dem Server gelöscht. Das lässt sich nicht "
    + "rückgängig machen.",
  "fp.purge_scope_older": "Mails, die vor mehr als {n} Tagen empfangen wurden.",
  "fp.purge_scope_older_one": "Mails, die vor mehr als 1 Tag empfangen wurden.",
  "fp.purge_b_delete": "{n} Mails werden endgültig gelöscht",
  "fp.purge_b_delete_one": "1 Mail wird endgültig gelöscht",
  "fp.purge_b_protected": "{n} Mails geschützter Absender werden übersprungen",
  "fp.purge_b_protected_one": "1 Mail eines geschützten Absenders wird übersprungen",
  "fp.purge_b_pinned": "{n} geschützte Mails werden übersprungen",
  "fp.purge_b_pinned_one": "1 geschützte Mail wird übersprungen",
  "fp.purge_btn": "Endgültig löschen ({n})",
  "fp.purge_none": "Nichts zu löschen.",
  "fp.purge_none_skipped":
    "Nichts zu löschen. {skipped}. Zum Löschen zuerst den Schutz aufheben.",
  "fp.purge_nothing_left":
    "Es war nichts mehr zu löschen - die Mails sind schon weg.",
  "fp.purged": "{n} Mails endgültig gelöscht",
  "fp.purged_one": "1 Mail endgültig gelöscht",
  "fp.purged_skipped": "{n} Mails endgültig gelöscht ({k} übersprungen)",
  "fp.purged_skipped_one": "1 Mail endgültig gelöscht ({k} übersprungen)",
  "fp.purge_unverified":
    "{n} Mails in den Papierkorb verschoben, aber ihre endgültige Löschung "
    + "ließ sich nicht sicher überprüfen. Es wurde nichts endgültig "
    + "gelöscht - sie liegen noch im Papierkorb. Das Verschieben lässt sich "
    + "rückgängig machen.",
  "fp.purge_unverified_one":
    "1 Mail in den Papierkorb verschoben, aber ihre endgültige Löschung "
    + "ließ sich nicht sicher überprüfen. Es wurde nichts endgültig "
    + "gelöscht - sie liegt noch im Papierkorb. Das Verschieben lässt sich "
    + "rückgängig machen.",
  "audit.act.purge": "Endgültig gelöscht",
  "stats.freed_month":
    "diesen Monat endgültig gelöscht: {n} Mails · {size} frei",
  "stats.freed_month_one":
    "diesen Monat endgültig gelöscht: 1 Mail · {size} frei",
  "fp.grouping": "Gruppieren nach",
  "fp.by_sender": "Nach Absender",
  "fp.mails": "Mails",
  "fp.not_junk": "Kein Spam",
  "fp.block": "Blockieren",
  "fp.blocked": "Blockiert",
  "fp.row_action": "{action}: {who}",
  "fp.restore": "Wiederherstellen",
  "fp.restored_inbox": "In den Posteingang zurückgelegt",
  "fp.known_title": "{n} Absender, die du kennst",
  "fp.known_title_one": "1 Absender, den du kennst",
  "fp.known_sub": "Du hast ihnen schon geantwortet - wahrscheinlich kein Spam",
  "fp.known_show": "Anzeigen",
  "fp.known_all": "Alle anzeigen",
  "fp.known_tag": "bekannt",
  "fp.first_seen": "erstmals {date}",
  "fp.replied_before": "du hast geantwortet",
  "fp.junk_sub": "{n} Mails · von deinem Mailserver geprüft",
  "fp.junk_sub_one": "1 Mail · von deinem Mailserver geprüft",
  "fp.not_junk_note":
    "„Kein Spam“ legt die Mail zurück in den Posteingang. Dein Mailserver "
    + "lernt daraus ebenfalls, sofern er das unterstützt.",
  "fp.action": "Aktion…",
  "fp.to_trash": "In den Papierkorb verschieben",
  "fp.not_junk_done": "{n} Mails in den Posteingang verschoben",
  "fp.not_junk_done_one": "1 Mail in den Posteingang verschoben",
  "fp.protect_sender": "{n} Absender schützen",
  "fp.protect_sender_one": "Absender schützen",
  "fp.junk_empty": "Spam-Ordner ist leer",
  "fp.junk_empty_hint":
    "Mails, die dein Anbieter als Spam einstuft, erscheinen hier - so lassen sich Fehlalarme retten.",
  "fp.protected_refused":
    "Einige dieser Mails stammen von geschützten Absendern oder sind angeheftet. Trotzdem in den Papierkorb verschieben?",
  "fp.confirm_protected_title": "Geschützte Mails in den Papierkorb verschieben?",
  "fp.confirm_protected_btn": "Trotzdem verschieben",
  "notice.junk_rescued": "{n} Mails aus dem Spam-Ordner in den Posteingang verschoben.",
  "notice.junk_rescued_one": "1 Mail aus dem Spam-Ordner in den Posteingang verschoben.",
  "notice.junk_rescued_rescan":
    "{n} Mails aus dem Spam-Ordner in den Posteingang verschoben - zum Anzeigen neu scannen.",
  "notice.junk_rescued_rescan_one":
    "1 Mail aus dem Spam-Ordner in den Posteingang verschoben - zum Anzeigen neu scannen.",
  "trash.restore_to": "Wiederherstellen nach…",
  "trash.restored": "{n} Mails wiederhergestellt - zum Anzeigen neu scannen.",
  "trash.restored_one": "1 Mail wiederhergestellt - zum Anzeigen neu scannen.",
  "trash.restored_refreshing":
    "{n} Mails wiederhergestellt - die Ansichten aktualisieren sich automatisch.",
  "trash.restored_refreshing_one":
    "1 Mail wiederhergestellt - die Ansichten aktualisieren sich automatisch.",
  "trash.newest_shown": "neueste {n} angezeigt",
  "trash.empty": "Der Papierkorb ist leer",
  "notice.ai_budget":
    "KI-Prüfung nach {done}/{total} Gruppen gestoppt - Monatsbudget "
    + "erreicht (in den Einstellungen erhöhen).",
  "budget.label": "Monatliches KI-Budget ($, 0 = unbegrenzt)",
  "budget.none": "kein Limit",
  "budget.month": "diesen Monat ausgegeben: {spent}",
  "Custom categories": "Eigene Kategorien",
  "categories.help":
    "Ein Name einer eingebauten Kategorie (shipping, finance, shopping, "
    + "social, travel, dev/cloud) ersetzt deren Stichwörter; schalte sie "
    + "aus, um sie zu deaktivieren. Neue Namen ergänzen Kategorien. Eine "
    + "Kategorie, die du anlegst oder änderst, bestimmt auch die Zeilen im "
    + "Tab Smart. Gilt sofort im Tab Absender und Smart, in den anderen "
    + "Tabs ab dem nächsten Scan.",
  "categories.add": "Kategorie hinzufügen…",
  "categories.add_ph": "Name der Kategorie, z. B. insurance",
  "categories.none": "Noch keine eigenen Kategorien.",
  "categories.builtin": "Eingebaut",
  "categories.enabled": "{name} aktiv",
  "categories.off": "Ausgeschaltet – diese eingebaute Kategorie trifft auf nichts zu.",
  "categories.replaced": "Deine Stichwörter ersetzen die eingebauten.",
  "categories.no_kw": "Noch keine Stichwörter – diese Kategorie trifft auf nichts zu.",
  "categories.kw_ph": "Stichwort",
  "categories.kw_add_to": "Stichwort zu {name} hinzufügen",
  "categories.kw_remove": "Stichwort {kw} aus {name} entfernen",
  "categories.rename": "{name} umbenennen",
  "categories.delete": "{name} löschen",
  "categories.restore": "Eingebaute Stichwörter von {name} wiederherstellen",
  "categories.err_empty": "Gib einen Namen ein.",
  "categories.err_colon": "Ein Name darf keinen Doppelpunkt enthalten.",
  "categories.err_dup": "Es gibt schon eine Kategorie „{name}“.",
  "new_sender.window_label": "„Neu“-Fenster für Absender (Tage)",
  "new_sender.window_help":
    "Wie viele Tage ein Absender als „Neu“ markiert bleibt (is:new, das "
    + "Neu-Abzeichen), nachdem er erstmals in einem Scan gesehen wurde.",
  "Export": "Exportieren",
  "Import…": "Importieren…",
  "export.tip":
    "Einstellungen, Regeln, KI-Bewertungen, Antwort-Cache und die "
    + "eingeordneten Absender herunterladen – die Datei listet "
    + "Absenderadressen (Passwörter und API-Schlüssel nie enthalten)",
  "backup.title": "Sichern & Wiederherstellen",
  "backup.help":
    "Der Export lädt Einstellungen, Regeln, KI-Bewertungen, den "
    + "Antwort-Cache und die eingeordneten Absender als Datei herunter; der "
    + "Import spielt eine solche Datei wieder ein. Die Datei listet "
    + "Absenderadressen – halte sie privat. Passwörter und API-Schlüssel sind "
    + "nie Teil eines Backups.",
  "backup.export": "Einstellungen exportieren",
  "backup.import": "Einstellungen importieren",
  "import.title": "Dieses Backup importieren",
  "import.settings": "Einstellungen werden überschrieben.",
  "import.rules": "Regeln werden ersetzt (wieder im Bericht-Modus).",
  "import.merged": "Bewertungen, Antwortdaten und eingeordnete Absender werden zusammengeführt.",
  "import.secrets": "Passwörter und API-Schlüssel werden nie importiert. Bei geändertem Server oder Konto werden gespeicherte Zugangsdaten entfernt; verbinde das Konto danach erneut.",
  "import.confirm": "Backup importieren",
  "import.skipped": " Nicht importiert: {names}.",
  "import.done": "Importiert: {rules} Regeln, {verdicts} Bewertungen, {knowledge} eingeordnete Absender.",
  "view.all_mails": "Alle Mails",
  "mails.sort_date": "Datum",
  "mails.sort_size": "Größe",
  "mails.sort_sender": "Absender",
  "mails.filter": "Mails filtern…",
  "mails.filter_tip":
    "Einfache Wörter treffen Absender oder Betreff. Außerdem: "
    + "from:adresse domain:example.com folder:name age:>1y size:>1m "
    + "att:>1m is:unread is:read has:pinned",
  "mails.count": "{n} von {total} Mails",
  "mails.select_loaded": "Geladene auswählen ({n})",
  "mails.ignored":
    "Für einzelne Mails nicht angewendet: {list} (diese Filter gelten nur "
    + "für Gruppen).",
  "mails.load_more": "{n} weitere laden",
  "mails.none": "Keine Mails passen zu diesem Filter.",
  "thread.title": "Konversation",
  "thread.read": "Konversation lesen",
  "thread.you": "Du",
  "thread.n_mails": "{n} Mails",
  "thread.n_mails_one": "1 Mail",
  "thread.expand_all": "Alle aufklappen",
  "thread.collapse_all": "Alle zuklappen",
  "thread.show_quoted": "Zitierten Text anzeigen",
  "thread.hide_quoted": "Zitierten Text ausblenden",
  "thread.replied_n": "du hast {n}-mal geantwortet",
  "thread.replied_n_one": "du hast einmal geantwortet",
  "thread.from_sent": "aus Gesendet",
  "reader.back": "Zurück",
  "reader.to_me": "an mich",
  "reader.to_me_more": "an mich und {n} weitere",
  "reader.to_me_more_one": "an mich und eine weitere Person",
  "reader.to": "an {who}",
  "reader.to_more": "an {who} und {n} weitere",
  "reader.to_more_one": "an {who} und eine weitere Person",
  "reader.prev": "Vorherige Mail",
  "reader.next": "Nächste Mail",
  "reader.pin": "Anheften",
  "reader.unpin": "Lösen",
  "reader.move_label": "Diese Mail in einen Ordner verschieben",
  "reader.conversation_n": "Konversation · {n}",
  "reader.copied": "Adresse kopiert",
  "reader.copy_failed": "Adresse konnte nicht kopiert werden",
  "reader.mail": "Mail",
  "reader.target": "Diese Mail",
  "reader.load_failed": "Die Konversation ließ sich nicht laden - Papierkorb, Anheften und Verschieben sind aus.",
  "reader.pick_single": "Öffne genau eine Mail, um sie zu bearbeiten.",
  "reader.sent_locked": "Deine eigene gesendete Mail kann hier nicht geändert werden.",
  "reader.unsub_in_mail": "In dieser Mail: {method}",
  "reader.open_sender": "Absender öffnen",
  "reader.copy_address": "Adresse kopieren",
  "reader.show_headers": "Kopfzeilen zeigen",
  "reader.hide_headers": "Kopfzeilen ausblenden",
  "reader.headers": "Rohe Kopfzeilen",
  "reader.pixel": "Tracking-Pixel - nicht geladen",
  "reader.click": "Klick-Tracking",
  "reader.no_trackers": "Kein Tracking gefunden",
  "reader.more_atts": "+{n} weitere",
  "reader.quoted_lines": "{n} Zeilen",
  "reader.quoted_lines_one": "1 Zeile",
  "reader.unsub_title": "Abmelde-Link gefunden",
  "reader.unsub_one_click": "ein Klick - sofort erledigt, nachdem du bestätigt hast",
  "reader.unsub_mailto": "sendet eine Mail von deiner Adresse",
  "reader.unsub_http": "Webseite - du bestätigst auf der Seite des Absenders",
  "thread.note.sent_unavailable":
    "Deine eigenen Antworten konnten nicht aus dem Ordner „Gesendet“ geladen "
    + "werden - es werden nur die empfangenen Mails angezeigt.",
  "no.matches": "Keine Gruppen passen zu diesem Filter",
  "err.generic": "Fehler: {msg}",
  "err.ai": "KI-Fehler: {msg}",
  "err.unsub": "Abbestell-Fehler: {msg}",
  "err.undo": "Fehler beim Rückgängigmachen: {msg}",
  "err.connection": "Verbindungsfehler: {msg}",
  "toast.restored": "{n} Mails wiederhergestellt ({label})",
  "toast.restored_one": "1 Mail wiederhergestellt ({label})",
  "toast.restored_partial": "{restored} von {of} Mails wiederhergestellt ({label})",
  "toast.restored_rescan": "{restored} von {of} Mails wiederhergestellt ({label}) - zum Anzeigen neu scannen",
  "toast.moved_trash": "{n} Mails in den Papierkorb verschoben",
  "toast.moved_trash_one": "1 Mail in den Papierkorb verschoben",
  "status.filter_none": "0 von {n} Gruppen passen",
  "status.filter_none_one": "0 von 1 Gruppe passt",
  "status.no_mails": "In den gescannten Ordnern wurden keine Mails gefunden.",
  "welcome.title": "Willkommen bei Inboxrake",
  "welcome.sub":
    "Räume jahrelang angesammelte Mails in Minuten auf – auf deinem "
    + "eigenen Server.",
  "welcome.p1.title": "Sieh, wer deinen Posteingang füllt",
  "welcome.p1.text":
    "Mails werden nach Absender und Firma gruppiert, sodass du auf einen "
    + "Blick siehst, wer dir am meisten schickt.",
  "welcome.p2.title": "Aufräumen ohne Angst",
  "welcome.p2.text":
    "Mails landen im Papierkorb, werden nie sofort gelöscht, und du kannst "
    + "alles rückgängig machen.",
  "welcome.p3.title": "Deine Post bleibt bei dir",
  "welcome.p3.text":
    "Inboxrake verbindet sich per IMAP und speichert nichts anderswo. KI "
    + "ist optional.",
  "welcome.start": "Los geht's",
  "wizard.title": "Postfach einrichten",
  "wizard.later": "Später einrichten",
  "wizard.cancel": "Abbrechen",
  "wizard.back": "Zurück",
  "wizard.next": "Weiter",
  "wizard.skip": "Überspringen",
  "wizard.steps": "Einrichtungsschritte",
  "wizard.s_provider": "Anbieter wählen",
  "wizard.s_signin": "Anmelden",
  "wizard.s_protect": "Passwort",
  "wizard.s_scan": "Erster Scan",
  "wizard.provider_title": "Wo liegt deine Post?",
  "wizard.provider_help":
    "Wähle deinen Anbieter. Weitere Postfächer kannst du später "
    + "hinzufügen.",
  "wizard.imap_other": "Anderer IMAP-Server",
  "wizard.imap_other_hint": "Host und Port selbst eintragen",
  "wizard.stays_here": "Anmeldedaten bleiben auf diesem Server.",
  "wizard.custom_help":
    "Jeder Mailserver, der IMAP spricht – trage unten Host, Port und "
    + "Sicherheit ein.",
  "wizard.working": "Einen Moment…",
  "wizard.scan_title_done": "Scan abgeschlossen",
  "preset.custom": "Eigener Server (beliebiges IMAP)",
  "wizard.email": "E-Mail-Adresse",
  "wizard.new_name": "Neues Konto",
  "wizard.pw_bridge": "Bridge-Passwort",
  "wizard.pw_app": "App-Passwort",
  "wizard.pw_plain": "Passwort",
  "wizard.advanced": "Erweiterte Verbindungseinstellungen",
  "wizard.proton_cert":
    "Proton Bridge nutzt ein selbst signiertes Zertifikat: exportiere es "
    + "aus der Bridge (cert export), stelle es in diesem Container bereit "
    + "und trage den Pfad unter den erweiterten Einstellungen ein "
    + "(meist /certs/bridge-cert.pem).",
  "wizard.test": "Verbindung testen",
  "wizard.test_cancel": "Test abbrechen",
  "wizard.testing": "Verbindung wird getestet…",
  "wizard.test_ok": "Verbunden – {n} Ordner gefunden.",
  "wizard.oauth_needed":
    "Verbinde zuerst dein Konto und teste dann die Verbindung.",
  "wizard.folders_choose": "Ordner auswählen… (optional)",
  "wizard.folders_help":
    "Die angehakten Ordner werden gescannt. Papierkorb, Spam, Gesendet "
    + "und Entwürfe werden standardmäßig ausgelassen.",
  "wizard.protect_title": "Diese Seite mit einem Passwort schützen",
  "wizard.protect_help":
    "Wer diese Seite öffnen kann, kann deine Mails lesen und löschen. "
    + "Lege jetzt ein Passwort fest (empfohlen); du kannst es später in "
    + "den Einstellungen ändern oder entfernen.",
  "wizard.pw_new": "Neues Passwort",
  "wizard.pw_repeat": "Passwort wiederholen",
  "wizard.pw_short": "Nimm mindestens 8 Zeichen.",
  "wizard.pw_mismatch": "Die beiden Passwörter unterscheiden sich.",
  "wizard.pw_set": "Passwort setzen",
  "wizard.scan_title": "Dein Postfach wird gelesen",
  "wizard.scan_headers":
    "Gelesen werden nur die Kopfzeilen: wer was wann geschickt hat und wie "
    + "groß es ist. Es wird nichts verändert.",
  "wizard.scan_of": "{done} von {total}",
  "wizard.ai_note":
    "KI-Helfer sind optional – du kannst sie in den Einstellungen "
    + "einrichten.",
  "wizard.scan_close":
    "Du kannst das schließen; der Scan läuft weiter.",
  "wizard.ck_connected": "Mit {name} verbunden",
  "wizard.ck_folders": "{n} Ordner gefunden",
  "wizard.ck_folders_one": "1 Ordner gefunden",
  "wizard.ck_folders_ready": "Ordner bereit",
  "wizard.ck_grouping": "Absender werden gruppiert…",
  "wizard.ck_grouped": "Absender gruppiert",
  "wizard.scan_done": "Fertig – dein Postfach ist bereit.",
  "wizard.scan_failed": "Der Scan hat nicht geklappt",
  "wizard.scan_again": "Nochmal versuchen",
  "wizard.scan_bg": "Im Hintergrund weitermachen",
  "wizard.finish": "Mein Postfach anzeigen",
  "wizard.setup_text":
    "Verbinde dein Mailkonto in wenigen Schritten: Anbieter, Anmeldung "
    + "und ein erster Scan.",
  "wizard.setup_btn": "Postfach einrichten",
  "onboard.ready": "Bereit für den ersten Scan",
  "onboard.unverified": "Richte {account} fertig ein",
  "onboard.unverified_text":
    "Die Verbindung zu diesem Konto hat bisher nicht geklappt. Prüfe die "
    + "Anmeldung und teste sie erneut, bevor du den ersten Scan startest.",
  "onboard.unverified_btn": "Einrichtung fortsetzen",
  "onboard.step_scan":
    "Auf Scannen klicken - gelöscht wird nur nach Bestätigung, und "
    + "Löschungen landen zuerst im Papierkorb.",
  "onboard.scanning": "Dein Postfach wird gelesen",
  "onboard.scanning_text":
    "Der erste Scan liest nur Kopfzeilen - das kann ein paar Minuten "
    + "dauern. Du kannst die Seite offen lassen; die Übersicht füllt sich, "
    + "sobald er fertig ist.",
  "onboard.test": "Verbindung testen",
  "onboard.testing": "Teste Verbindung…",
  "onboard.test_ok": "Verbunden - {n} Ordner sichtbar. Bereit zum Scannen!",
  "onboard.test_fail": "Verbindung fehlgeschlagen",
  "notify.title": "Desktop-Benachrichtigungen",
  "notify.sub": "Wenn ein Scan oder Aufräumen fertig ist, während der Tab im Hintergrund ist",
  "notify.denied": "Benachrichtigungen wurden vom Browser blockiert.",
  "notify.delete_done": "Fertig: {n} Mails verarbeitet.",
  "notify.delete_done_one": "Fertig: 1 Mail verarbeitet.",
  "notify.ai_done": "KI-Prüfung abgeschlossen.",
  "notify.atts_done": "Anhang-Analyse abgeschlossen.",
  "notify.unsub_done": "Massenabbestellen abgeschlossen.",
  "preset.label": "Anbieter-Preset (füllt die Felder unten vor)",
  "preset.row": "Anbieter",
  "preset.row_sub": "Füllt die Felder unten vor",
  "preset.hint.proton":
    "Proton braucht die Mail Bridge (Bezahltarife): IMAP-Modus auf SSL "
    + "stellen, Zertifikat exportieren und als CA-Datei eintragen - "
    + "siehe inboxrake.com/docs/providers/.",
  "preset.hint.apppw":
    "App-spezifisches Passwort verwenden, nicht das normale "
    + "Konto-Passwort - anlegen in den Sicherheitseinstellungen des "
    + "Anbieters (Links im README).",
  "preset.hint.imap_toggle":
    "IMAP muss zuerst in den Mail-Einstellungen des Anbieters aktiviert "
    + "werden; bei Zwei-Faktor-Authentifizierung App-Passwort verwenden.",
  "preset.hint.gmail":
    "App-Passwort oder OAuth - unten auswählen.",
  "signin.label": "Anmeldeart",
  "signin.password": "App-Passwort",
  "signin.oauth": "OAuth",
  "signin.gmail_apppw_help":
    "App-Passwort anlegen unter myaccount.google.com/apppasswords "
    + "(die Bestätigung in zwei Schritten muss aktiv sein) - nicht dein "
    + "normales Google-Passwort.",
  "preset.hint.oauth_outlook_device":
    "Outlook verbindet hier nur per OAuth (unten) - keine Einrichtung "
    + "nötig, siehe Installationsanleitung.",
  "preset.hint.oauth_outlook_byo":
    "Outlook verbindet hier nur per OAuth (unten) - eigenen "
    + "OAuth-Client in Entra ID registrieren, siehe "
    + "Installationsanleitung.",
  "imap.security": "IMAP-Verschlüsselung",
  "smtp.host": "SMTP-Host",
  "smtp.help":
    "SMTP wird nur zum Senden von Abbestell-Mails genutzt; der SMTP-Host "
    + "ist standardmäßig der IMAP-Host.",
  "smtp.host_placeholder": "leer = IMAP-Host",
  "smtp.security": "SMTP-Verschlüsselung",
  "sec.auto": "automatisch",
  "cafile.label": "Eigene CA-Datei (optional, z.\u202fB. das Bridge-Zertifikat)",
  "oauth.title": "{provider}-Konto per OAuth verbinden",
  "oauth.client_id": "Client-ID",
  "oauth.client_secret": "Client-Secret",
  "oauth.google_help":
    "Client-ID und Client-Secret deines Google-OAuth-Clients unten "
    + "eintragen, dann auf Verbinden klicken (Einrichtung siehe "
    + "Installationsanleitung). Ein Client im Testmodus stellt ein "
    + "Refresh-Token aus, das nach 7 Tagen abl\u00e4uft - f\u00fcr "
    + "unbegrenzte G\u00fcltigkeit bei Google die Verifizierung beantragen.",
  "oauth.ms_device_help":
    "Keine App-Registrierung n\u00f6tig: unten klicken, dann den "
    + "angezeigten Code auf microsoft.com/devicelogin auf einem "
    + "beliebigen Ger\u00e4t eingeben.",
  "oauth.ms_byo_help":
    "Client-ID deiner Entra-ID-App unten eintragen, dann auf Verbinden "
    + "klicken (Einrichtung siehe Installationsanleitung) - ein "
    + "\u00f6ffentlicher Client ben\u00f6tigt kein Secret.",
  "oauth.connect": "Konto verbinden",
  "oauth.connect_device": "Mit Ger\u00e4tecode verbinden",
  "oauth.connected": "Verbunden",
  "oauth.disconnect": "Trennen",
  "oauth.disconnect_title": "Dieses Konto von OAuth trennen",
  "oauth.disconnect_body": "Eine erneute Verbindung ist jederzeit möglich.",
  "oauth.device_instructions":
    "Den folgenden Link auf einem beliebigen Ger\u00e4t \u00f6ffnen und diesen "
    + "Code eingeben:",
  "folder.role_excluded":
    "Spezialordner (per Rolle erkannt) - wird nie mitgescannt",
  "folder.view_excluded":
    "Virtuelle Ansicht auf Mails, die woanders liegen - wird nie "
    + "mitgescannt, damit nichts doppelt z\u00e4hlt",
  "folder.lookalike_excluded":
    "Sieht aus wie ein zweiter Spezialordner (die Rolle hat schon ein "
    + "anderer Ordner) - wird nie mitgescannt, seine Mails werden nicht "
    + "zum Aufr\u00e4umen angeboten",
  "folder.view": "Ansicht",
  "role.trash": "Papierkorb",
  "role.junk": "Spam",
  "role.sent": "Gesendet",
  "role.drafts": "Entw\u00fcrfe",
  "role.archive": "Archiv",
  "role.all": "Alle Nachrichten",
  "folders.scan": "Zu scannende Ordner",
  "folders.special": "Spezialordner",
  "folders.special_hint":
    "Nicht Teil des Aufr\u00e4um-Scans. Der pro Rolle angezeigte Ordner ist der, "
    + "in den Inboxrake Mails verschiebt - und der, den dauerhafte Aktionen "
    + "verwenden.",
  "folders.none": "Keine Ordner gefunden.",
  "folder.src.flag": "Server-Markierung",
  "folder.src.name": "nach Name",
  "folder.src.override": "von dir gew\u00e4hlt",
  "folder.view_row": "Ansichten anderer Ordner - werden nie gescannt",
  "folder.archive_scanned":
    "Das Archiv wird weiterhin gescannt - oben in der Liste abschaltbar.",
  "folder.ambiguous":
    "Mehr als ein Ordner kommt als dein Ordner \u201e{role}\u201c in Frage. "
    + "Bis du w\u00e4hlst, verwendet Inboxrake \u201e{pick}\u201c f\u00fcr "
    + "Verschiebungen dorthin und l\u00f6scht nicht endg\u00fcltig und leert ihn "
    + "nicht.",
  "folder.choose": "Noch nicht best\u00e4tigt - ausw\u00e4hlen\u2026",
  "folder.choose_label": "Welcher Ordner ist dein Ordner \u201e{role}\u201c?",
  "folder.confirmed":
    "Du hast diesen Ordner gew\u00e4hlt. Dauerhafte Aktionen f\u00fcr "
    + "\u201e{role}\u201c (etwa Papierkorb leeren) verwenden genau ihn.",
  "folder.choice_note":
    "Der Ordner, den du hier w\u00e4hlst, wird f\u00fcr dauerhafte Aktionen "
    + "verwendet.",
  "folder.auto": "Automatische Wahl verwenden",
  "folder.choice_saved":
    "Ordner \u201e{role}\u201c ist jetzt \u201e{name}\u201c.",
  "folder.choice_reset":
    "Ordner \u201e{role}\u201c wird wieder automatisch gew\u00e4hlt.",
  "folder.lookalike_tag": "sieht auch aus wie \u201e{role}\u201c",
  "folder.move_contents": "Inhalt nach \u201e{role}\u201c verschieben",
  "folder.move_needs_choice":
    "W\u00e4hle zuerst oben den Ordner \u201e{role}\u201c.",
  "folder.move_title": "{n} Mails nach \u201e{role}\u201c verschieben?",
  "folder.move_title_one": "1 Mail nach \u201e{role}\u201c verschieben?",
  "folder.move_body":
    "Die Mails in \u201e{folder}\u201c werden nach \u201e{target}\u201c "
    + "verschoben - nicht gel\u00f6scht. Du kannst das gleich danach "
    + "r\u00fcckg\u00e4ngig machen.",
  "folder.move_confirm": "{n} Mails verschieben",
  "folder.move_confirm_one": "1 Mail verschieben",
  "folder.move_empty":
    "\u201e{folder}\u201c ist leer - nichts zu verschieben.",
  "folder.moved": "{n} Mails nach \u201e{role}\u201c verschoben.",
  "folder.moved_one": "1 Mail nach \u201e{role}\u201c verschoben.",
  "folder.err.not_candidate":
    "Dieser Ordner kann f\u00fcr diese Rolle nicht gew\u00e4hlt werden.",
  "folder.err.ambiguous":
    "W\u00e4hle zuerst den richtigen Ordner f\u00fcr diese Rolle, dann "
    + "versuche es erneut.",
  "folder.err.not_lookalike":
    "Dieser Ordner sieht nicht mehr wie ein zweiter Spezialordner aus - "
    + "Liste neu laden.",
  "folder.err.move_unsafe":
    "Dieser Server kann weder verschieben noch einzelne Mails sicher "
    + "entfernen, deshalb wird das Verschieben abgelehnt - nichts wurde "
    + "ge\u00e4ndert.",
  "folder.undone": "{n} Mails zur\u00fcck verschoben.",
  "folder.undone_one": "1 Mail zur\u00fcck verschoben.",
  "audit.act.move_contents": "Ordnerinhalt verschoben",
  "account.label": "Zu bearbeitendes Konto",
  "account.add": "Konto hinzufügen",
  "account.hint":
    "Jedes Konto wird getrennt gescannt und aufgeräumt - Ansichten "
    + "vermischen sich nie. Bei mehreren Konten oben im Kopf umschalten.",
  "account.rename_title": "Konto umbenennen",
  "account.rename_confirm": "Umbenennen",
  "account.err_empty": "Bitte einen Namen eingeben.",
  "account.err_dup": 'Ein Konto namens "{name}" gibt es schon.',
  "account.remove_title": "Konto entfernen",
  "account.remove_help":
    "Entfernt dieses Konto aus Inboxrake. Mails auf dem Server bleiben "
    + "unangetastet.",
  "account.delete": 'Konto "{name}" löschen…',
  "account.delete_title": 'Konto "{name}" löschen',
  "account.delete_data":
    "Inboxrake löscht die Anmeldedaten und Verbindungseinstellungen, "
    + "Scan-Ergebnisse, den lokalen Suchindex, gespeicherte Filter, Pins, "
    + "Abbestell-Einträge, bekannte Absender sowie Digest- und "
    + "Auto-Scan-Einstellungen.",
  "account.delete_rules":
    "Seine Mail-Regeln behalten den Kontonamen, laufen aber nicht mehr; "
    + "seine Lösch-Regeln für Spam und Papierkorb werden gelöscht.",
  "account.delete_mails": "Mails auf dem Server bleiben unangetastet.",
  "account.delete_confirm": "Konto löschen",
  "menu.accounts": "Konten",
  "menu.done": "Fertig",
  "menu.signin_failed": "Anmeldung fehlgeschlagen - beheben",
  "menu.signin_missing": "Nicht angemeldet - einrichten",
  "menu.mails_size": "{n} Mails · {size}",
  "menu.mails_size_one": "1 Mail · {size}",
  "update.available": "Eine neue Version von Inboxrake ist verfügbar.",
  "update.reload": "Neu laden",
  "menu.version": "v{version} (Build {id})",
  "scan.age": "gescannt vor {ago}",
  "scan.progress": "Scanne… {done} von {total} Mails",
  "scan.progress_folder": "Scanne {folder}… {done} von {total}",
  "pull.hint": "Zum Scannen ziehen",
  "pull.release": "Loslassen zum Scannen",
  "login.section": "Anmeldung (optional)",
  "login.help":
    "Schützt die API mit einem Login. \"Keine\" vertraut dem Netzwerk "
    + "bzw. einer Reverse-Proxy-Anmeldung (wie bisher). Passwort = ein "
    + "gemeinsames Passwort. SSO/OIDC = Anmeldung über einen "
    + "OpenID-Connect-Anbieter (Pocket ID, Authentik, Keycloak, …); die "
    + "App dort vorher mit der Callback-URL <origin>/api/oidc/callback "
    + "registrieren.",
  "login.mode": "Anmeldemethode",
  "login.mode_none": "Keine (Reverse Proxy / vertrautes Netz)",
  "login.mode_password": "Passwort",
  "login.mode_oidc": "SSO (OpenID Connect)",
  "login.password_label": "Anmelde-Passwort",
  "login.oidc_issuer": "Issuer-URL",
  "login.oidc_client": "Client-ID",
  "login.oidc_secret": "Client-Secret",
  "login.oidc_redirect": "Redirect-Basis-URL (optional)",
  "login.oidc_redirect_ph": "automatisch: aus den Request-Headern",
  "login.oidc_allowed": "Erlaubte Nutzer (eine E-Mail/Subject pro Zeile)",
  "login.oidc_allowed_help":
    "Leere Liste = jedes Konto, das der Identity Provider anmeldet, darf "
    + "die App nutzen. Mit Einträgen kommen nur diese E-Mails/Subjects "
    + "hinein.",
  "login.oidc_open_warn":
    "Die Liste erlaubter Nutzer ist leer: Jeder mit einem Konto bei deinem "
    + "Identity Provider kann sich anmelden und bekommt einen eigenen "
    + "Arbeitsbereich.",
  "login.oidc_noadmin_warn":
    "Es ist kein Admin gesetzt: Erlaube zur Einrichtung genau eine Identität "
    + "oder setze den Administrator, bevor du SSO aktivierst.",
  "login.err.email_unverified":
    "Dein SSO-Konto hat keine bestätigte E-Mail-Adresse.",
  "login.err.sso_rejected":
    "Dein Identity Provider hat die Anmeldung abgelehnt. Versuch es noch "
    + "einmal oder prüfe seine Einstellungen.",
  "login.err.sso_not_allowed":
    "Dieses Konto darf sich hier nicht anmelden. Bitte die Person, die "
    + "diesen Server betreibt, es hinzuzufügen.",
  "login.err.sso_no_admin":
    "SSO ist nicht fertig eingerichtet: Es ist noch kein Administrator "
    + "festgelegt. Frag die Person, die diesen Server betreibt.",
  "login.err.sso_expired":
    "Die Anmeldung hat zu lange gedauert oder wurde unterbrochen. Versuch "
    + "es noch einmal.",
  "login.err.generic": "Anmeldung fehlgeschlagen. Versuch es noch einmal.",
  "login.sign_out_all": "Alle Sitzungen abmelden…",
  "login.sign_out_all_help":
    "Das passiert automatisch, wenn du Passwort, Anmeldemethode, erlaubte "
    + "Nutzer oder Admin änderst.",
  "login.signed_out_all": "Alle anderen Sitzungen wurden abgemeldet.",
  "confirm.sign_out_all": "Alle Sitzungen abmelden",
  "confirm.sign_out_all_body":
    "Jeder Browser und jedes Gerät, das angemeldet ist, muss sich neu "
    + "anmelden. Dieser Browser bleibt angemeldet.",
  "confirm.sign_out_all_confirm": "Alle abmelden",
  "ferr.login_throttled":
    "Zu viele Versuche. Warte {n} Minuten und melde dich dann erneut an.",
  "ferr.login_throttled_one":
    "Zu viele Versuche. Warte 1 Minute und melde dich dann erneut an.",
  "ferr.login_wrong_password": "Falsches Passwort. Versuch es noch einmal.",
  "ferr.login_password_off": "Die Anmeldung mit Passwort ist nicht eingeschaltet.",
  "ferr.login_sso_off": "Die Anmeldung per SSO ist nicht eingeschaltet.",
  "login.title": "Bei Inboxrake anmelden",
  "login.submit": "Anmelden",
  "login.sso": "Weiter mit SSO",
  "login.show_password": "Passwort anzeigen",
  "login.forgot": "Zugang verloren?",
  "login.forgot_link": "So setzt du das Passwort zurück",
  "login.trouble": "Probleme bei der Anmeldung?",
  "login.logout": "Abmelden",
  "login.admin_tip": "Admin - verwaltet die Server-Einstellungen",
  "menu.profile": "Profil & Einstellungen",
  "settings.search": "Einstellungen suchen",
  "settings.group.accounts": "Konten",
  "settings.group.app": "App",
  "settings.group.automation": "Automatik",
  "settings.group.ai": "KI",
  "settings.group.server": "Server",
  "settings.sec.account": "Konto",
  "settings.sec.general": "Allgemein",
  "settings.sec.notifications": "Benachrichtigungen",
  "settings.sec.protected": "Geschützte Absender",
  "settings.sec.categories": "Kategorien",
  "settings.sec.filed": "Eingeordnete Absender",
  "settings.sec.digest": "Aktivitätsbericht",
  "settings.sec.autoscan": "Automatischer Scan",
  "settings.sec.ai": "KI-Prüfung",
  "settings.sec.signin": "Anmeldung & Nutzer",
  "settings.sec.backup": "Sicherung",
  "settings.status.ok": "Angemeldet",
  "settings.status.check": "Anmeldung prüfen",
  "settings.status.nocreds": "Nicht angemeldet",
  "settings.no_match": "Keine Einstellung passt zu \u201e{q}\u201c.",
  "settings.connection": "Verbindung",
  "settings.advanced": "Erweitert",
  "settings.applies_to": "Konto",
  "settings.for_account": "Für das Konto \u201e{name}\u201c",
  "settings.senders": "Absender",
  "settings.new_badge": "\u201eNeu\u201c-Markierung bleibt",
  "decimal.invalid": "Gib in den Preis- und Budgetfeldern eine Zahl ein (zum Beispiel 0,5).",
  "numfmt.label": "Zahlenformat",
  "numfmt.help": "Wie Zahlen geschrieben werden. Automatisch folgt der Sprache.",
  "numfmt.auto": "Automatisch",
  "settings.n_days": "{n} Tage",
  "settings.n_days_one": "{n} Tag",
  "settings.n_senders": "{n} Absender",
  "settings.n_senders_one": "{n} Absender",
  "settings.n_min": "{n} Min.",
  "settings.every_h": "{n} Std.",
  "settings.every_min": "{n} Min.",
  "settings.search_with": "Suchen mit",
  "settings.send": "Senden",
  "settings.not_set_up": "Nicht eingerichtet",
  "settings.unsaved": "Ungespeicherte Änderungen",
  "settings.chg.connection": "Verbindung",
  "settings.chg.password": "Passwort geändert",
  "settings.chg.folders": "Ordner",
  "settings.changed": "{what} geändert",
  "settings.changes": "{n} Änderungen",
  "settings.revert": "Zurücksetzen",
  "settings.leave_title": "Änderungen speichern?",
  "settings.discard": "Verwerfen",
  "stepper.decrease": "Verringern",
  "stepper.increase": "Erhöhen",
  "appearance.system": "System",
  "appearance.light": "Hell",
  "appearance.dark": "Dunkel",
  "login.oidc_admin": "Admin-Identität (E-Mail oder Subject)",
  "login.oidc_admin_ph": "Identität setzen oder genau einen Benutzer für die Einrichtung erlauben",
  "login.tenancy_note":
    "Mit SSO bekommt jeder Nutzer einen EIGENEN Arbeitsbereich (Konten, "
    + "Scans, Einstellungen). Der Admin behält diesen hier.",
  "shared.section": "Gemeinsamer KI-Schlüssel (alle Nutzer)",
  "shared.help":
    "Optional einen serverseitigen KI-Schlüssel teilen: Nutzer ohne "
    + "eigenen Schlüssel verwenden ihn automatisch, begrenzt pro Nutzer "
    + "und Monat durch das Standard-Budget unten (Nutzer dürfen ihr "
    + "Limit senken, nie erhöhen).",
  "shared.enabled": "Diesen Schlüssel mit allen Nutzern teilen",
  "shared.budget": "Standard-Monatsbudget pro Nutzer ($)",
  "ai.shared_key_ph": "nutzt den gemeinsamen Server-Schlüssel",
  "usage.section": "Nutzerstatistik",
  "usage.help":
    "Nutzung pro Arbeitsbereich - nur Zahlen, KI-Kosten und "
    + "Speicherplatz. Inboxrake zeigt dir nie Maildaten, Kontonamen "
    + "oder Absender anderer Nutzer.",
  "usage.user": "Nutzer / Arbeitsbereich",
  "usage.mails": "Mails (letzter Scan)",
  "usage.cleaned": "Aufgeräumt (Monat)",
  "usage.ai_month": "KI-Kosten (Monat)",
  "usage.last_scan": "Letzter Scan",
  "usage.disk": "Speicher",
  "usage.shared": "geteilter Schlüssel",
  "sort.menu_state": "{key}, {dir}",
  "sort.menu": "Sortieren",
  "sort.by": "Sortieren nach",
  "sort.order": "Reihenfolge",
  "sort.ascending": "Aufsteigend",
  "sort.descending": "Absteigend",
  "view.group_by": "Gruppieren nach",
  "filter.inactive_6m": "6+ Monaten",
  "filter.inactive_1y": "1+ Jahr",
  "filter.inactive_2y": "2+ Jahren",
  "qb.tip": "Filter zusammenklicken statt Syntax merken",
  "qb.title": "Filter erstellen",
  "qb.hint": "jede hinzugefügte Bedingung muss AUCH zutreffen (UND)",
  "qb.add": "Hinzufügen",
  "qb.clear": "Leeren",
  "qb.done": "Fertig",
  "qb.tag": "Kategorie",
  "qb.ai": "KI-Urteil",
  "qb.ai_safe": "sicher löschbar",
  "qb.ai_review": "prüfen",
  "qb.ai_keep": "behalten",
  "qb.age": "Älter als",
  "qb.months": "Monate",
  "qb.years": "Jahre",
  "qb.unread": "Ungelesen ≥",
  "qb.att": "Anhänge ≥",
  "qb.flags": "Nur Gruppen…",
  "qb.is_unsub": "mit Abmeldelink",
  "qb.is_unsubscribed": "vollständig abbestellt",
  "qb.is_not_unsubscribed": "noch nicht abbestellt",
  "qb.is_noreply": "nie geantwortet",
  "qb.is_replied": "geantwortet",
  "qb.is_protected": "geschützt",
  "qb.is_new": "neue Absender",
  "qb.is_still_mailing": "schreibt nach dem Abbestellen weiter",
  "ai.shared_note":
    "Kein eigener Schlüssel - KI läuft über den gemeinsamen "
    + "Server-Schlüssel (dein Monatslimit: {cap}).",
  "account.rename": "Umbenennen…",
  "account.scan_now": "Jetzt scannen",
  "account.scan_save_first": "Erst speichern - Jetzt scannen nutzt die gespeicherten Einstellungen.",
  "account.scan_started": "Scan gestartet.",
  "account.scan_running": "Scannt…",
  "account.scan_failed": "letzter Scan fehlgeschlagen",
  "account.never_scanned": "noch nicht gescannt",
  "account.change": "Ändern…",
  "account.smtp_row": "Sendeserver (Abmelde-Mails)",
  "account.same_as_imap": "Wie IMAP",
  "folders.discover_row": "Ordner erkennen",
  "account.rename_prompt": 'Neuer Name für Konto "{name}":',
  "account.renamed": 'Konto umbenannt in "{name}".',
  "folders.title": "Zu scannende Ordner - Konto \u201e{name}\u201c",
  "folders.discover": "Erkennen",
  "folders.discover_tip":
    "Ordnerliste dieses Kontos neu vom Server laden (nutzt die "
    + "GESPEICHERTEN Zugangsdaten - neue erst speichern)",
  "folders.err_hint":
    "- die Ordner-Erkennung braucht gespeicherte, funktionierende "
    + "Zugangsdaten für dieses Konto; erst speichern, dann Erkennen.",
  "digest.title": "Aktivitäts-Übersicht per E-Mail",
  "digest.schedule": "Zeitplan",
  "digest.off": "Aus",
  "digest.recipient": "Empfänger",
  "digest.recipient_placeholder": "eigene Adresse dieses Kontos",
  "digest.time": "Uhrzeit (24h, lokale Zeit des Servers)",
  "digest.lang_unset":
    "Noch nicht gespeichert - die Mails gehen auf Englisch raus, bis du "
    + "speicherst.",
  "digest.err.bad_url":
    "Der Link muss eine Webadresse wie https://inboxrake.example sein - "
    + "mit http:// oder https:// am Anfang und ohne ? oder #.",
  "digest.lang": "Sprache der Mail",
  "digest.url": "Link zu Inboxrake",
  "digest.url_help":
    "Die Adresse deiner Inboxrake-Installation (https://...). Damit öffnen "
    + "die Knöpfe in der Mail die richtige Seite; ohne sie entfallen sie.",
  "digest.help":
    "Deine Woche wie in der Übersicht - angekommene und aufgeräumte "
    + "Mails, was dich braucht und was Inboxrake seit der letzten Mail "
    + "getan hat (endgültig gelöscht, Regeln, Abmeldungen). Entfällt "
    + "komplett, wenn nichts passiert ist.",
  "digest.send_test": "Test-Übersicht senden",
  "digest.test_sent": "Gesendet!",
  "digest.test_sent_demo":
    "Vorschau mit Beispieldaten gesendet (es gibt noch nichts echtes zu "
    + "berichten) - zählt nicht als echte Übersicht.",
  "auto_scan.title": "Automatisches Scannen",
  "auto_scan.enabled": "Aktiviert",
  "auto_scan.on": "An",
  "auto_scan.every": "Alle",
  "auto_scan.unit_minutes": "Minuten",
  "auto_scan.unit_hours": "Stunden",
  "search.placeholder_body": "Betreff, Absender und Mailtext suchen",
  "search.placeholder":
    "Betreff oder Absender",
  "search.empty_title":
    "Postfach durchsuchen",
  "search.empty_hint":
    "Findet gescannte Mails nach Betreff oder Absender, schon beim Tippen.",
  "search.scope": "Suchen in",
  "search.scope_meta": "Betreff & Absender",
  "search.scope_body": "Auch Mailtext",
  "search.body_off": "Die Suche im Mailtext ist für dieses Konto ausgeschaltet (Einstellungen).",
  "search.time": "Zeitraum",
  "search.time_any": "Jederzeit",
  "search.time_30d": "Letzte 30 Tage",
  "search.time_year": "Dieses Jahr",
  "search.time_old": "Älter als ein Jahr",
  "search.folder": "Ordner",
  "search.folder_all": "Alle Ordner",
  "search.senders": "Absender",
  "search.mails": "Mails",
  "search.sender_stats": "{n} Mails · {size}",
  "search.sender_stats_one": "1 Mail · {size}",
  "search.select_all": "Alle {n} auswählen",
  "search.select_none": "Auswahl aufheben",
  "search.recent": "Zuletzt gesucht",
  "search.recent_clear": "Leeren",
  "search.try": "Ausprobieren",
  "search.try_att": "Mails mit großen Anhängen",
  "search.try_unread": "Seit über einem Jahr ungelesen",
  "search.try_replied": "Von Leuten, denen du geantwortet hast",
  "search.try_old": "Älter als 5 Jahre",
  "search.try_att_prefix": "über 1 MB",
  "search.try_senders": "{n} Absender",
  "search.try_senders_one": "1 Absender",
  "search.try_mails": "{n} Mails",
  "search.try_mails_one": "1 Mail",
  "search.try_note": "„Ausprobieren“ öffnet Absender mit dem passenden Filter - ein Tipp, dort editierbar.",
  "search.more_hint": "Nicht das Gesuchte?",
  "search.more_action": "Auch im Mailtext suchen",
  "search.more_server": "fragt den Mail-Server, dauert ein paar Sekunden.",
  "search.more_local": "nutzt den lokalen Wortindex.",
  "search.none":
    "Keine Treffer",
  "search.none_hint":
    "Versuch eine andere Schreibweise oder einen kürzeren Suchbegriff.",
  "trash.no_match":
    "Keine passenden Mails",
  "trash.empty_hint":
    "Gelöschte Mails bleiben hier, bis du den Papierkorb leerst.",
  "atts.not_analyzed":
    "Noch nicht analysiert",
  "atts.none_hint":
    "Nach dem Scannen neuer Mails „Neu analysieren“ verwenden.",
  "dups.none_hint":
    "Keine identischen Kopien, keine verschiedenen Versionen einer Mail und keine möglichen Doppelsendungen (gleicher Absender und Betreff innerhalb von Minuten).",
  "audit.empty_hint":
    "Aktionen wie Mails in den Papierkorb verschieben, Regelläufe und Rückgängig erscheinen hier.",
  "search.body_hint":
    "Die Suche im Mailtext fragt deinen Mailserver und kann einen "
    + "Moment dauern.",
  "search.note.partial":
    "Nicht alle Ordner wurden rechtzeitig durchsucht - die Treffer sind "
    + "evtl. unvollständig.",
  "search.note.folder_failed":
    "„{folder}“ konnte nicht durchsucht werden - übersprungen.",
  "search.note.stale_folder":
    "„{folder}“ hat sich seit dem letzten Scan geändert - zum Einbeziehen "
    + "neu scannen.",
  "search.note.charset_fallback":
    "Dieser Server unterstützt keine UTF-8-Suche - Umlaute und andere "
    + "Sonderzeichen werden evtl. nicht gefunden.",
  "body_search.title": "Mailtext-Suche",
  "body_search.label": "Im Mailtext suchen",
  "body_search.server": "Mailserver fragen",
  "body_search.local": "Lokaler Wortindex",
  "body_search.local_help":
    "Gedacht für große Postfächer und langsame Anbieter: baut einmal einen "
    + "lokalen Index auf und sucht danach sofort. Er speichert KEINEN lesbaren Mailtext, nur "
    + "geschlüsselte Hashes der Wörter jeder Mail (der Schlüssel stammt aus "
    + "INBOXRAKE_SECRET_KEY). Die Suche findet ganze Wörter (Groß-/Kleinschreibung "
    + "und Akzente egal, mehrere Wörter müssen alle vorkommen), keine "
    + "Wortteile. Scans halten den Index aktuell; Ausschalten löscht ihn.",
  "index.need_key":
    "Der lokale Index braucht INBOXRAKE_SECRET_KEY auf dem Server.",
  "index.save_first":
    "Erst die Einstellungen speichern, dann hier den Index aufbauen.",
  "index.none": "Noch kein Index aufgebaut.",
  "index.key_changed":
    "Der Index wurde mit einem anderen geheimen Schlüssel gebaut und ist "
    + "unbrauchbar - neu aufbauen.",
  "index.building": "Indexiere…",
  "index.status": "{docs} Mails indexiert, zuletzt aktualisiert {ts}.",
  "index.disk": "Belegter Speicherplatz: {size}",
  "index.build": "Index aufbauen",
  "index.update": "Jetzt aktualisieren",
  "index.rebuild": "Neu aufbauen",
  "index.delete": "Index löschen",
  "index.confirm_read":
    "Liest den Text von {n} gescannten Mails dieses Kontos von deinem "
    + "Mailserver (je die ersten ~256 KB) und speichert lokal nur "
    + "geschlüsselte Wort-Hashes - keinen lesbaren Text.",
  "index.confirm_disk":
    "Belegt etwa {size} Speicherplatz (bis zu {max} bei textlastigen "
    + "Mails); auf dem Datenträger sind {free} frei.",
  "index.confirm_time": "Das kann dauern.",
  "index.estimate":
    "Geschätzter Speicherplatz: etwa {size} für {n} Mails (bis zu {max} bei "
    + "textlastigen Mails); {free} frei auf dem Datenträger.",
  "index.confirm_tight":
    "Achtung: das passt möglicherweise nicht auf den Datenträger.",
  "index.delete_title": "Den lokalen Index löschen",
  "index.delete_body":
    "Der Wortindex des Kontos \"{name}\" wird entfernt. Du kannst ihn jederzeit "
    + "neu aufbauen.",
  "notice.index_cancelled":
    "Indexierung abgebrochen - bereits Indexiertes bleibt erhalten.",
  "search.body_hint_local":
    "Durchsucht den lokalen Wortindex: nur ganze Wörter, alle müssen vorkommen.",
  "search.note.index_missing":
    "Der lokale Index wurde noch nicht aufgebaut - in den Einstellungen "
    + "aufbauen. Es werden nur Treffer in Betreff und Absender angezeigt.",
  "search.note.index_key":
    "Der lokale Index wurde mit einem anderen geheimen Schlüssel gebaut - in "
    + "den Einstellungen neu aufbauen. Es werden nur Treffer in Betreff und "
    + "Absender angezeigt.",
  "search.note.index_behind":
    "{n} neuere Mails sind noch nicht im Index - die Treffer sind evtl. "
    + "unvollständig.",
  "body_search.disabled": "Aus (nur Betreff und Absender)",
  "body_search.help":
    "Die Mailtext-Suche läuft bei jeder Anfrage auf deinem Mailserver - "
    + "Inboxrake speichert nichts. Bei entfernten Anbietern kann sie "
    + "langsam sein; Proton Bridge antwortet lokal. Ausschalten, um nur "
    + "nach Betreff und Absender zu suchen.",
  "auto_scan.align": "Startminute (0-59)",
  "auto_scan.help":
    "Scannt dieses Konto in festen Abständen neu, unabhängig von "
    + "Regel-Zeitplänen - hält die „Neu“-Markierung und die "
    + "Aktivitäts-Übersicht aktuell, ohne dass die App geöffnet sein muss. "
    + "Die „Startminute“ richtet den Takt an einer festen Uhrzeit aus "
    + "(z. B. alle 3 Stunden zur Minute 10 -> 00:10, 03:10, 06:10, ...) "
    + "statt ab dem Speicherzeitpunkt zu driften. Wird automatisch "
    + "übersprungen, solange das Konto mit etwas anderem beschäftigt ist, "
    + "und beim nächsten Takt einfach erneut versucht.",
  "Audit Log": "Prüfprotokoll",
  "Previous": "Zurück",
  "Next": "Weiter",
  "user": "Nutzer",
  "audit.empty": "Noch nichts aufgezeichnet",
  "audit.export": "Prüfprotokoll als CSV exportieren",
  "audit.by": "von {actor}",
  "audit.by_rule": "von Regel „{name}“",
  "audit.page": "{from}–{to} von {total}",
  "audit.entries":
    "{n} Einträge · alles, was Inboxrake getan hat, neueste zuerst",
  "audit.entries_one":
    "1 Eintrag · alles, was Inboxrake getan hat, neueste zuerst",
  "audit.rule": "Regel „{name}“",
  "audit.by_you": "von dir",
  "audit.rule_gone": "von einer gelöschten Regel",
  "audit.why": "Warum?",
  // One headline per recorded action (activity.ts entryText)
  "audit.h.trash": "{n} Mails in den Papierkorb verschoben",
  "audit.h.trash_one": "1 Mail in den Papierkorb verschoben",
  "audit.h.trash_junk": "{n} Mails aus Spam in den Papierkorb verschoben",
  "audit.h.trash_junk_one": "1 Mail aus Spam in den Papierkorb verschoben",
  "audit.h.archive": "{n} Mails archiviert",
  "audit.h.archive_one": "1 Mail archiviert",
  "audit.h.move": "{n} Mails verschoben",
  "audit.h.move_one": "1 Mail verschoben",
  "audit.h.move_junk": "{n} Mails aus Spam in den Posteingang verschoben",
  "audit.h.move_junk_one": "1 Mail aus Spam in den Posteingang verschoben",
  "audit.h.move_contents": "{n} Mails von {from} nach {to} verschoben",
  "audit.h.move_contents_one": "1 Mail von {from} nach {to} verschoben",
  "audit.h.mark_read": "{n} Mails als gelesen markiert",
  "audit.h.mark_read_one": "1 Mail als gelesen markiert",
  "audit.h.empty_trash": "Papierkorb geleert: {n} Mails endgültig gelöscht",
  "audit.h.empty_trash_one": "Papierkorb geleert: 1 Mail endgültig gelöscht",
  "audit.h.purge": "{n} Mails endgültig gelöscht",
  "audit.h.purge_one": "1 Mail endgültig gelöscht",
  "audit.h.rule_execute": "Regel „{name}“ ausgeführt · {n} Mails",
  "audit.h.rule_execute_one": "Regel „{name}“ ausgeführt · 1 Mail",
  "audit.h.rule_execute_none": "Regel „{name}“ ausgeführt",
  "audit.h.rule_report": "Regel-Bericht: {n} Mails passen",
  "audit.h.rule_report_one": "Regel-Bericht: 1 Mail passt",
  "audit.h.rule_report_none": "Regel-Bericht: nichts passt",
  "audit.h.unsubscribe": "Von {sender} abbestellt",
  "audit.h.unsubscribe_link": "Abmelde-Link für {sender} gefunden",
  "audit.h.unsubscribe_failed": "Abbestellen von {sender} fehlgeschlagen",
  "audit.h.undo": "Rückgängig: {n} Mails wiederhergestellt",
  "audit.h.undo_one": "Rückgängig: 1 Mail wiederhergestellt",
  "audit.h.digest_sent": "Aktivitätsbericht an {to} gesendet",
  "audit.act.digest_sent": "Aktivitätsbericht gesendet",
  "audit.act.trash": "In den Papierkorb verschoben",
  "audit.act.archive": "Archiviert",
  "audit.act.move": "Verschoben",
  "audit.act.mark_read": "Als gelesen markiert",
  "audit.act.rule_report": "Regel-Bericht",
  "audit.act.rule_execute": "Regel ausgeführt",
  "audit.act.unsubscribe": "Abbestellt",
  "audit.act.undo": "Rückgängig gemacht",
  "audit.act.empty_trash": "Papierkorb geleert",
  "audit.outcome.ok": "Erledigt",
  "audit.outcome.error": "Fehlgeschlagen",
  "audit.outcome.cancelled": "Abgebrochen",
  "audit.outcome.partial": "Teilweise",
  "audit.outcome.done": "Erledigt",
  "audit.outcome.link": "Klick nötig",
  "audit.outcome.failed": "Fehlgeschlagen",
  "Close": "Schließen",
  "Remove": "Entfernen",
  "View details": "Details anzeigen",
  "menu.more": "Mehr",
  "swipe.read": "Gelesen",
  "swipe.unprotect": "Schutz aus",
  "swipe.protected": "{label} ist geschützt",
  "swipe.unprotected": "{label} ist nicht mehr geschützt",
  "swipe.open": "Details öffnen",
  "menu.account_switch": "Konto: {name}",
  "nav.label": "Hauptnavigation",
  "nav.back_to": "Zurück zu {page}",
  "nav.overview": "Übersicht",
  "nav.senders": "Absender",
  "nav.all_mail": "Alle Mails",
  "nav.activity": "Aktivität",
  "activity.month": "Diesen Monat",
  "activity.cleaned": "Mails aufgeräumt",
  "activity.cleaned_one": "Mail aufgeräumt",
  "activity.at_least": "mindestens {n}",
  "activity.month_empty": "Diesen Monat wurde noch nichts aufgeräumt.",
  "activity.week": "Woche {n}",
  "activity.at_least_n": "{n}+",
  "activity.by_rules": "Durch Regeln",
  "activity.by_you": "Durch dich",
  "activity.unsubscribed": "Abbestellt",
  "activity.undo_all": "Alle {n} zeigen",
  "activity.undo_fewer": "Weniger zeigen",
  "activity.undo": "Rückgängig-Verlauf",
  "activity.undone": "rückgängig gemacht",
  "activity.undone_n": "{n} rückgängig gemacht",
  "export.csv": "CSV exportieren",
  "export.csv_tip": "Aktuelle Gruppierung als CSV exportieren",
  "bar.selected": "{n} Gruppen · {mails} Mails",
  "bar.selected_one": "1 Gruppe · {mails} Mails",
  "bar.clear": "Abwählen",
  "bar.export": "CSV-Export",
  "bar.label": "Aktionen für die Auswahl",
  "bar.limit_to": "Beschränken auf:",
  "bar.move": "Verschieben",
  "bar.limit_open": "Beschränken auf…",
  "bar.limit_hint": "Nur ein Teil jeder Gruppe",
  "bar.limit_done": "Fertig",
  "bar.limit_remove": "Beschränkung entfernen",
  "bar.token_keep_latest": "Neueste {n} behalten",
  "bar.token_older": "Älter als {n} Tage",
  "bar.token_older_one": "Älter als 1 Tag",
  "Cancel": "Abbrechen",
  "detail.n_selected": "{n} ausgewählt",
  "detail.region": "Details: {label}",
  "detail.mails": "Mails",
  "detail.size": "Größe",
  "detail.opened": "Geöffnet",
  "detail.since": "seit {date}",
  "detail.block": "Blockieren",
  "folder.title": "{n} Mails verschieben",
  "folder.title_one": "1 Mail verschieben",
  "folder.restore_title": "{n} Mails wiederherstellen",
  "folder.restore_title_one": "1 Mail wiederherstellen",
  "folder.restore_btn": "Wiederherstellen",
  "folder.find": "Ordner suchen",
  "folder.suggested": "Vorschläge",
  "folder.all": "Alle Ordner",
  "folder.archive_hint": "hier archivierst du",
  "folder.used_ago": "vor {ago} benutzt",
  "folder.used": "schon benutzt",
  "folder.none": "Kein Ordner passt.",
  "folder.always": "Neue Mails von {label} immer hierher",
  "folder.always_sub": "legt eine Regel an - sie startet als Vorschau",
  "folder.rule_name": "{label} nach {dest} verschieben",
  "folder.rule_made": "Regel für {label} angelegt - sie startet als Vorschau.",
  "folder.rule_failed": "Die Mails wurden verschoben, die Regel konnte aber nicht angelegt werden: {msg}",
  "folder.open_rules": "Regeln",
  "detail.move": "Verschieben",
  "detail.trash_all": "{n} Mails in den Papierkorb verschieben",
  "detail.trash_all_one": "1 Mail in den Papierkorb verschieben",
  "Dismiss": "Schließen",
  "Refresh": "Aktualisieren",
  "OK": "OK",
  "row.last": "zuletzt",
  "select.enter": "Auswählen",
  "select.done": "Fertig",
  "Select {label}": "{label} auswählen",
  "Select mail": "Mail auswählen",
  "ai.consent_title": "Mail-Metadaten an den KI-Anbieter senden?",
  "Continue": "Fortfahren",
  "btn.mail_protect": "Mail schützen",
  "btn.mail_protected": "Mail geschützt",
  "btn.protect": "Schützen",
  "btn.protected": "Geschützt",
  "confirm.btn_n": "{verb} ({n})",
  "confirm.act_pinned_mail":
    "Die geschützte Mail „{subject}“ ist von Sammelaktionen ausgenommen - "
    + "dies hebt ihren Schutz ausdrücklich auf.",
  "confirm.empty_trash_body":
    "{n} Mails im Papierkorb werden endgültig gelöscht. Das lässt sich "
    + "nicht rückgängig machen.",
  "confirm.empty_trash_body_one":
    "Die 1 Mail im Papierkorb wird endgültig gelöscht. Das lässt sich nicht "
    + "rückgängig machen.",
  "confirm.empty_trash_btn": "Endgültig löschen ({n})",
  "confirm.b_mails_from": "{n} Mails von {names}",
  "confirm.b_mails_from_one": "1 Mail von {names}",
  "confirm.names_more": "{names} und {k} weiteren",
  "confirm.b_undo": "Das lässt sich normalerweise über die Ergebnismeldung rückgängig machen. Kann der Server die verschobenen Kopien nicht sicher erkennen, stelle sie manuell im Zielordner wieder her.",
  "confirm.btn_anyway": "Trotzdem: {verb}",
  "select.named": "{subject} auswählen",
  "bar.groups": "{n} Gruppen",
  "bar.groups_one": "1 Gruppe",
  "bar.selected_one_mail": "1 Gruppe · 1 Mail",
  "n.mails": "{n} Mails",
  "n.mails_one": "1 Mail",
  "n.senders": "{n} Absender",
  "n.senders_one": "1 Absender",
  "n.newsletters": "{n} Newsletter",
  "n.newsletters_one": "1 Newsletter",
  "n.groups": "{n} Gruppen",
  "n.groups_one": "1 Gruppe",
  "status.groups_of": "{n} von {total} Gruppen",
  "status.groups_of_one": "{n} von {total} Gruppe",
  "filter.syntax_hint":
    "Kombinierbar: tag:shipping ai:safe age:>1y unread:>80 is:unsub Text",
  "tenant.row_tip":
    "{id} - {accounts} Konten, {scans} Scans, {rules} Regeln, {verdicts} KI-Bewertungen",
  "confirm.b_subject": "„{subject}“",
  "confirm.b_selected": "{n} ausgewählte Mails",
  "confirm.b_selected_one": "1 ausgewählte Mail",
  "confirm.b_protected_groups_skipped": "{n} geschützte Gruppen übersprungen",
  "confirm.b_protected_groups_skipped_one": "1 geschützte Gruppe übersprungen",
  "confirm.b_pinned_kept": "{n} geschützte Mails bleiben unberührt",
  "confirm.b_pinned_kept_one": "1 geschützte Mail bleibt unberührt",
  "confirm.b_pinned_skipped": "{n} geschützte Mails übersprungen",
  "confirm.b_pinned_skipped_one": "1 geschützte Mail übersprungen",
  "confirm.restore_btn": "Wiederherstellen",
  "confirm.empty_trash_title": "Papierkorb leeren?",
  "confirm.unpin_btn": "Schutz aufheben",
  "confirm.block_title": "„{label}“ blockieren?",
  "confirm.block_body":
    "Dies legt eine dauerhafte Regel an, die künftige Mails täglich "
    + "automatisch in den Papierkorb verschiebt - umkehrbar durch Löschen "
    + "der Regel in Regeln.",
  "confirm.block_only": "Nur blockieren",
  "confirm.unblock_title": "„{label}“ entblocken?",
  "confirm.unblock_body":
    "Dies löscht die dauerhafte Regel - künftige Mails werden nicht mehr "
    + "automatisch in den Papierkorb verschoben.",
  "saved_filter.name_label": "Name",
  "saved_filter.name_required": "Bitte einen Namen eingeben.",
  "saved_filter.confirm_btn": "Löschen",
  "rule.enable_title": "Regel „{name}“ auf AUSFÜHREN umschalten?",
  "rule.enable_body":
    "Geplante Läufe verarbeiten dann passende Mails (max. 500 pro Lauf, "
    + "geschützte Absender übersprungen, Undo verfügbar).",
  "trash_all.tip": "Alle {n} Mails dieser Gruppe in den Papierkorb verschieben",
  "trash_all.tip_one": "Die 1 Mail dieser Gruppe in den Papierkorb verschieben",
  "trash_this.btn": "Diese Mail in den Papierkorb",
  "block.btn": "Absender blockieren",
  "rule.f_grouping": "Gruppierung",
  "rule.f_filter": "Filter",
  "rule.f_action": "Aktion",
  "rule.f_schedule": "Zeitplan",
  "rule.f_apply": "Anwenden auf",
  "rule.f_retention_n": "Anzahl",
  "rule.f_dest": "Ordner",
  "rule.f_name": "Name",
  "rule.f_scope": "Gilt für",
  "rule.scope_mail": "Posteingang & Ordner",
  "action.purge": "Endgültig löschen",
  "rule.purge_warning":
    "Löscht Mails auf dem Server, endgültig - das lässt sich nicht "
    + "rückgängig machen. Geschützte Absender und geschützte Mails werden "
    + "nie angefasst. Eine neue Regel meldet nur, was sie löschen würde, "
    + "bis sie auf Ausführen umgeschaltet wird.",
  "rule.purge_filter_help":
    "Trifft die Absender in diesem Ordner: Freitext, from:, age: (neueste "
    + "Mail des Absenders) und unread:. Ein leerer Filter bedeutet ALLE "
    + "Absender. Hier nicht verfügbar: tag:, ai:, eng:, att:, is:, has: und domain:. "
    + "Eine Mail wird erst gelöscht, wenn sie mehr als N Tage in diesem "
    + "Ordner liegt (ab dem Zeitpunkt, an dem Inboxrake sie dort zum ersten "
    + "Mal gesehen hat) und außerdem vor mehr als N Tagen empfangen wurde. "
    + "Im Berichtsmodus ausführen, um die Vorschau zu sehen.",
  "rule.purge_age_label": "Mehr als so viele Tage in Papierkorb/Spam",
  "rule.purge_age_tag": "in Papierkorb/Spam > {n}T",
  "rule.purge_edit_reset":
    "Wird Ordner, Filter oder Alter geändert, wechselt die Regel zurück in "
    + "den Berichtsmodus - so läuft nur, was zuvor geprüft wurde.",
  "rule.edit_reset":
    "Wird Filter, Aktion, Ziel, Aufbewahrung oder Konto geändert, wechselt "
    + "die Regel zurück in den Berichtsmodus - so läuft nur, was zuvor "
    + "geprüft wurde.",
  "rule.run_report_btn": "Bericht erstellen",
  "rule.purge_run_report":
    "Bericht: {n} Mails würden endgültig gelöscht · Absender: {groups}",
  "rule.purge_run_report_one":
    "Bericht: 1 Mail würde endgültig gelöscht · Absender: {groups}",
  "rule.purge_run_exec":
    "ausgeführt: {n} Mails endgültig gelöscht ({matched} gefunden)",
  "rule.purge_run_exec_one":
    "ausgeführt: 1 Mail endgültig gelöscht ({matched} gefunden)",
  "rule.purge_unverified":
    "{n} Mails in den Papierkorb verschoben, aber nicht gelöscht (nicht "
    + "überprüfbar)",
  "rule.purge_unverified_one":
    "1 Mail in den Papierkorb verschoben, aber nicht gelöscht (nicht "
    + "überprüfbar)",
  "rule.purge_run_body":
    "Das löscht passende Mails endgültig auf dem Server, bis zu {cap} Mails "
    + "pro Lauf. Geschützte Absender und geschützte Mails werden nie "
    + "angefasst. Das lässt sich nicht rückgängig machen. Danach kann die "
    + "Regel zurück in den Berichtsmodus geschaltet werden.",
  "rule.purge_run_body_one":
    "Das löscht passende Mails endgültig auf dem Server, bis zu {cap} Mail "
    + "pro Lauf. Geschützte Absender und geschützte Mails werden nie "
    + "angefasst. Das lässt sich nicht rückgängig machen. Danach kann die "
    + "Regel zurück in den Berichtsmodus geschaltet werden.",
  "rule.purge_enable_body":
    "Ab jetzt löscht diese Regel Mails endgültig auf dem Server, bis zu {cap} "
    + "Mails pro Lauf (auch nach Zeitplan). Geschützte Absender und "
    + "geschützte Mails werden nie angefasst. Der Wechsel zurück in den "
    + "Berichtsmodus ist jederzeit möglich.",
  "rule.purge_enable_body_one":
    "Ab jetzt löscht diese Regel Mails endgültig auf dem Server, bis zu {cap} "
    + "Mail pro Lauf (auch nach Zeitplan). Geschützte Absender und "
    + "geschützte Mails werden nie angefasst. Der Wechsel zurück in den "
    + "Berichtsmodus ist jederzeit möglich.",
  "rule.purge_confirm_btn": "Endgültig löschen (bis zu {cap})",
  "rule.purge_all_senders":
    "Der Filter ist leer: Die Regel gilt für ALLE Absender im Ordner {folder}.",
  "rule.purge_all_short": "alle Absender",
  "rule.reset_edited":
    "Zurück im Berichtsmodus: Was die Regel bearbeitet, wurde geändert "
    + "(Ordner, Filter, Aktion, Ziel oder Alter). Vor dem Umschalten auf "
    + "Ausführen erneut einen Bericht erstellen.",
  "rule.reset_account":
    "Zurück im Berichtsmodus: Das Konto wurde umbenannt, oder Server oder "
    + "Login haben sich geändert. Vor dem Umschalten auf Ausführen erneut "
    + "einen Bericht erstellen.",
  "rule.reset_folder":
    "Zurück im Berichtsmodus: Der Spam-/Papierkorb-Ordner hat sich seit dem "
    + "letzten Bericht geändert. Es wurde nichts gelöscht. Erneut einen "
    + "Bericht erstellen.",
  "qb.age_sender": "Neueste Mail des Absenders älter als",

  "ai.review_body":
    "Schon bewertet: {rated} von {total}. Beim Neubewerten gehen sie erneut "
    + "an die KI, ihre Bewertungen werden ersetzt und es werden erneut "
    + "Tokens (und Budget) verbraucht.",
  "ai.review_new": "Nur neue prüfen ({n})",
  "ai.review_rerate": "Alle neu bewerten ({n})",

  // Smart-Gruppierung (Tab "Smart": große Absender behalten eine Zeile, der
  // lange Schwanz kleiner Absender wird nach Firma / Inhalt gebündelt).
  "Smart": "Smart",
  "smart.kind.protected": "Geschützte Absender",
  "smart.kind.replied": "Leute, denen du schreibst",
  "smart.kind.orders": "Bestellungen & Lieferungen",
  "smart.kind.appointments": "Termine & Buchungen",
  "smart.kind.jobs": "Bewerbungen",
  "smart.kind.support": "Support & Anfragen",
  "smart.kind.accounts": "Konten & Sicherheit",
  "smart.kind.newsletter": "Newsletter",
  "smart.kind.individuals": "Privatpersonen",
  "smart.kind.other": "Sonstige Absender",
  "smart.cat": "Kategorie: {name}",
  "smart.why.company":
    "Mehrere Absender von {domain}, als eine Firma gebündelt, weil sie zusammen mindestens {min} Mails haben.",
  "smart.why.protected":
    "Absender mit weniger als {min} Mails, die du geschützt hast.",
  "smart.why.replied":
    "Absender mit weniger als {min} Mails, denen du geschrieben hast.",
  "smart.why.orders":
    "Absender mit weniger als {min} Mails, meist zu Bestellungen, Versand "
    + "und Rechnungen.",
  "smart.why.appointments":
    "Absender mit weniger als {min} Mails, meist zu Terminen, "
    + "Reservierungen und Buchungen.",
  "smart.why.jobs":
    "Absender mit weniger als {min} Mails, meist zu Bewerbungen.",
  "smart.why.support":
    "Absender mit weniger als {min} Mails, meist Supportfälle und "
    + "Anfragen.",
  "smart.why.accounts":
    "Absender mit weniger als {min} Mails, meist Anmeldungen und "
    + "Sicherheitscodes.",
  "smart.why.category":
    "Absender mit weniger als {min} Mails in der Kategorie \u201e{name}\u201c.",
  "smart.why.newsletter":
    "Absender mit weniger als {min} Mails, die einen Abmeldelink anbieten "
    + "oder Werbung schicken.",
  "smart.why.individuals":
    "Absender mit weniger als {min} Mails, die von einer privaten Adresse "
    + "schreiben (Gmail, Outlook, GMX, \u2026).",
  "smart.why.other":
    "Absender mit weniger als {min} Mails, deren Mails unklar sind oder von "
    + "mehreren Dingen handeln.",
  "smart.purposes": "Worum es in den Mails geht: {list}",
  "smart.purpose.orders": "Bestellungen",
  "smart.purpose.appointments": "Termine",
  "smart.purpose.jobs": "Bewerbungen",
  "smart.purpose.support": "Support",
  "smart.purpose.accounts": "Konten",
  "smart.purpose.newsletter": "Newsletter",
  "smart.purpose.unclassified": "Nicht zugeordnet",
  "smart.protected_moved":
    "{label} ist jetzt geschützt \u2013 die Mails liegen unter "
    + "\u201eGeschützte Absender\u201c.",
  // Smart-Absenderliste (was in einer gebündelten Zeile steckt, und warum).
  "smart.about.orders": "Bestellungen und Lieferungen",
  "smart.about.appointments": "Termine und Buchungen",
  "smart.about.jobs": "Bewerbungen",
  "smart.about.support": "Support und Anfragen",
  "smart.about.accounts": "Konten und Sicherheit",
  "smart.about.newsletter": "Newsletter und Werbung",
  "smart.about.individuals": "private Korrespondenz",
  "smart.about.other": "nichts Bestimmtes",
  "aisort.btn": "Mit KI sortieren",
  "aisort.title": "Die Absender in „Sonstige“ mit KI sortieren?",
  "aisort.nothing": "Nichts mehr zu sortieren: die KI hat jeden Absender in „Sonstige“ gesehen.",
  "aisort.b_units":
    "{n} Absender, die die Regeln nicht einordnen konnten (die Absender einer Firma werden zusammen gefragt)",
  "aisort.b_units_one":
    "1 Absender, den die Regeln nicht einordnen konnten",
  "aisort.b_cost": "Etwa {tin} Tokens rein, {tout} raus – ungefähr {cost}",
  "aisort.b_instructions": "Deine eigenen Anweisungen aus den Einstellungen sind dabei",
  "aisort.b_only":
    "Sie wählt nur eine der festen Arten. Es wird keine Mail verschoben oder "
    + "gelöscht, und du kannst die Sortierung wieder entfernen.",
  "aisort.go": "{n} Absender sortieren",
  "aisort.sorted_n": "{n} Absender wurden von der KI sortiert.",
  "aisort.checked_n": "Die KI hat {n} Absender angesehen und in „Sonstige“ gelassen.",
  "aisort.cleared_none": "KI-Sortierung entfernt.",
  "aisort.clear": "KI-Sortierung entfernen",
  "aisort.cleared": "KI-Sortierung entfernt: {n} Absender sind wieder dort, wo die Regeln sie hingelegt haben.",
  "aisort.clear_confirm":
    "Die KI-Sortierung von {n} Absendern entfernen? Behaltene Antworten bleiben eingeordnet.",
  "aisort.started": "KI-Sortierung gestartet.",
  "notice.ai_sort_done": "KI-Sortierung fertig: {placed} von {total} Absendern eingeordnet.",
  "notice.ai_sort_cancelled": "KI-Sortierung nach {done} von {total} Absendern abgebrochen; was sortiert ist, bleibt.",
  "notice.ai_sort_budget": "Monatsbudget der KI nach {done} von {total} Absendern erreicht; was sortiert ist, bleibt.",
  "ai.sort_instructions": "Deine Anweisungen für die KI-Sortierung (optional)",
  "ai.sort_instructions_help":
    "Wird den festen Anweisungen hinzugefügt, wenn die KI die Absender in "
    + "„Sonstige“ sortiert, z. B. „Mails von meinem Vermieter sind Support, "
    + "nicht Privatpersonen.“ Die KI wählt weiterhin nur eine der festen "
    + "Arten. Wird zusammen mit den Absenderdaten an deinen KI-Anbieter "
    + "gesendet; bis zu {max} Zeichen.",
  "smart.reason.own": "Hat genug Mails für eine eigene Zeile.",
  "smart.reason.protected": "Du hast diesen Absender geschützt.",
  "smart.reason.replied": "Du hast diesem Absender geschrieben.",
  "smart.reason.company":
    "Gehört zu {co}: zusammen haben die Absender genug Mails für eine Zeile.",
  "smart.reason.purpose": "{n} von {of} Mails handeln von {what}.",
  "smart.reason.weak":
    "Nur {n} von {of} Mails handeln von {what} \u2013 zu wenig für eine Aussage.",
  "smart.reason.competing": "Seine Mails handeln von mehreren Dingen gleichzeitig.",
  "smart.reason.category": "In deiner Kategorie \u201e{name}\u201c.",
  "smart.reason.category_conflict": "Passt zu mehreren deiner Kategorien.",
  "smart.reason.newsletter": "Bietet einen Abmeldelink an oder schickt Werbung.",
  "smart.reason.individual": "Schreibt von einer privaten Adresse.",
  "smart.reason.ai": "Von der KI einsortiert als {what}.",
  "smart.reason.ai_other": "Von der KI geprüft: aus den Betreffs nicht klar.",
  "smart.reason.ai_other_sure": "Von der KI geprüft: gehört zu den sonstigen Absendern.",
  "smart.reason.notification":
    "Automatische Benachrichtigungen aus einem Forum oder Entwickler-Tool.",
  "smart.reason.rule": "Du hast diesen Absender unter {what} einsortiert.",
  "smart.reason.rule_co": "Du hast seine Firma unter {what} einsortiert.",
  "smart.reason.kept_ai": "Unter {what} einsortiert durch eine behaltene KI-Antwort.",
  "smart.reason.none": "In seinen Mails steht nichts, worum es geht.",
  "smart.reason.with_company":
    "Zusammen mit den anderen Absendern von {co} eingeordnet.",
  "senders.tab": "Absender ({n})",
  "senders.mails_tab": "Mails ({n})",
  "senders.view": "Was angezeigt wird",
  "senders.search": "Absender suchen\u2026",
  "senders.sort": "Absender sortieren",
  "senders.sort_count": "Meiste Mails",
  "senders.sort_last": "Neueste",
  "senders.sort_size": "Größte",
  "senders.sort_label": "Name",
  "senders.none": "Keine Absender gefunden.",
  "senders.select_shown": "Alle {n} angezeigten auswählen",
  "senders.selected": "{n} von {total} Absendern ausgewählt ({mails} Mails)",
  "senders.protect": "Schützen",
  "senders.back": "Zurück zu den Absendern",
  "senders.protected_toast":
    "{n} Absender geschützt \u2013 ihre Mails liegen unter \u201eGeschützte Absender\u201c.",
  "confirm.b_protected_senders_skipped": "{n} geschützte Absender übersprungen",
  "smart.title": "Smart-Gruppierung",
  "smart.min_label": "Eigene Zeile ab N Mails",
  "smart.min_help":
    "Im Tab Smart behält ein Absender mit mindestens so vielen Mails eine "
    + "eigene Zeile; kleinere Absender werden nach Firma und nach dem "
    + "Inhalt ihrer Mails gebündelt. 2\u201350, Standard 10. Gilt sofort, "
    + "kein neuer Scan nötig.",
  // Private Absender-Kenntnisse: Absender in Smart einordnen, KI-Antworten behalten.
  "know.file_action": "In Smart einordnen als…",
  "know.file_help": "Es wird keine Mail verschoben.",
  "know.blocked.company":
    "Firmenzeilen werden nach ihrer Struktur eingeordnet, hier wirkt Einordnen nicht.",
  "know.blocked.protected":
    "Geschützte Absender bleiben in ihrem eigenen Bereich, hier wirkt Einordnen nicht.",
  "know.blocked.replied":
    "Menschen, denen du schreibst, bleiben in ihrem eigenen Bereich, hier wirkt Einordnen nicht.",
  "know.scope_title": "Nur die markierten Absender einordnen oder ganze Firmen?",
  "know.scope_body":
    "Einige der markierten Absender gehören zu einer Firmengruppe. Ordnest du "
    + "nur die markierten ein, verlassen sie die Gruppe; ordnest du die Firma "
    + "ein, wird alles von dieser Firma eingeordnet, auch Absender, die später "
    + "schreiben. Es wird in beiden Fällen keine Mail verschoben.",
  "know.scope_sender": "Nur die markierten Absender",
  "know.scope_company": "Die ganze Firma ({n} Absender)",
  "know.scope_company_one": "Die ganze Firma (1 Absender)",
  "know.filed": "{n} Absender in {kind} einsortiert.",
  "know.filed_one": "1 Absender in {kind} einsortiert.",
  "know.undone": "Einordnung rückgängig gemacht.",
  "know.kind_category": "Kategorie „{name}“",
  "know.keep_btn": "Diese Antworten behalten ({n} Absender)",
  "know.keep_btn_one": "Diese Antworten behalten (1 Absender)",
  "know.keep_title": "Die KI-Antworten für {n} Absender behalten?",
  "know.keep_title_one": "Die KI-Antwort für 1 Absender behalten?",
  "know.keep_b_rules":
    "Sie werden deine eigenen Regeln für diese Absender und bleiben, bis du "
    + "sie entfernst.",
  "know.keep_b_clearer":
    "Eindeutigere Hinweise in ihren Mails setzen sich weiterhin gegen eine "
    + "behaltene Antwort durch.",
  "know.keep_b_only":
    "„KI-Sortierung entfernen“ rührt behaltene Antworten nicht an. "
    + "Es wird keine Mail verschoben.",
  "know.keep_go": "Für {n} Absender behalten",
  "know.keep_go_one": "Für 1 Absender behalten",
  "know.kept": "KI-Antworten für {n} Absender behalten.",
  "know.kept_one": "KI-Antwort für 1 Absender behalten.",
  "know.kept_skipped":
    "{n} Absender blieben, wie sie sind: sie haben eine eigene Einordnung von dir, oder ihre Adresse lässt sich nicht einordnen.",
  "know.kept_skipped_one":
    "1 Absender blieb, wie er ist: er hat eine eigene Einordnung von dir, oder seine Adresse lässt sich nicht einordnen.",
  "know.kept_none": "Gerade gilt keine KI-Antwort.",
  "know.box_title": "So ordnet Inboxrake diesen Absender ein",
  "know.box_now": "Gerade in „{row}“.",
  "know.box_select": "Diesen Absender einordnen unter",
  "know.box_auto": "Automatisch",
  "know.src_user": "Von dir eingeordnet",
  "know.src_ai": "Behaltene KI-Antwort",
  "know.box_company": "Deine Regel für seine Firma entscheidet.",
  "know.reset": "Auf automatisch zurücksetzen",
  "know.reset_company": "Seine Firma auf automatisch zurücksetzen",
  "know.reset_done": "Wieder automatisch.",
  "know.no_effect": "Deine Einordnung wirkt gerade nicht: {why}",
  "know.no_effect_ai": "Die behaltene KI-Antwort wirkt gerade nicht: {why}",
  "know.reason.own_row": "dieser Absender hat genug Mails für eine eigene Zeile.",
  "know.reason.company_row": "seine Firma hat eine eigene Zeile.",
  "know.reason.protected": "dieser Absender ist geschützt.",
  "know.reason.replied": "du hast diesem Absender geschrieben.",
  "know.reason.rules_confident": "die Regeln sind sich jetzt sicher.",
  "know.reason.decided_by_rules":
    "die Regeln haben es schon entschieden (Newsletter, private Adresse oder Benachrichtigung).",
  "know.reason.shadowed": "eine genauere Regel von dir entscheidet.",
  "know.reason.freemail":
    "eine KI-Antwort gibt einer privaten Adresse nie einen Zweck.",
  "know.reason.in_company_group":
    "er gehört zu einer Firmengruppe, die eine behaltene Antwort nie aufteilt.",
  "know.reason.not_applied": "sie wird hier nicht angewendet.",
  "know.reason.inactive_category": "ihre Kategorie gibt es nicht mehr.",
  "know.reason.invalid_key": "sie nennt keine Firma und keine Adresse mehr.",
  "know.reason.invalid_kind": "ihre Art ist nicht bekannt.",
  "know.err.bad_request": "Die Anfrage wurde nicht verstanden.",
  "know.err.bad_key": "Das ist keine Absenderadresse und keine Firma.",
  "know.err.bad_kind": "Diese Art ist nicht verfügbar (vielleicht gibt es die Kategorie nicht mehr).",
  "know.err.bad_note": "Die Notiz ist zu lang (höchstens 200 Zeichen).",
  "know.err.full": "Die Liste der eingeordneten Absender ist voll.",
  "know.err.ai_running": "Ein KI-Lauf ist aktiv – versuche es nach dem Ende noch einmal.",
  "know.err.unscanned": "Scanne zuerst jedes Konto.",
  // Einstellungen > Absender: was Inboxrake über deine Absender weiß.
  "know.table_help":
    "Wo du Absender und Firmen in Smart eingeordnet hast, und die "
    + "KI-Antworten, die du behalten hast. Das bleibt auf diesem Server und "
    + "wird nie an eine KI geschickt. Änderungen hier gelten sofort – es gibt "
    + "nichts zu speichern.",
  "know.empty_title": "Noch nichts eingeordnet",
  "know.empty_hint":
    "Ordne einen Absender in Smart ein (markieren, dann „In Smart einordnen "
    + "als…“) oder behalte eine KI-Antwort, dann steht er hier. Das bleibt "
    + "auf diesem Server.",
  "know.seg_label": "Anzeigen",
  "know.seg_all": "Alle {n}",
  "know.seg_user": "Von dir {n}",
  "know.seg_ai": "KI {n}",
  "know.seg_unused": "Ungenutzt {n}",
  "know.more_menu": "Weitere Aktionen",
  "know.row_menu": "Aktionen für {name}",
  "know.change_group": "Gruppe ändern…",
  "know.forget": "Vergessen",
  "know.select_mode": "Auswählen…",
  "know.sort.status": "Auffälliges zuerst",
  "know.sort.key": "Absender oder Firma",
  "know.sort.kind": "Eingeordnet unter",
  "know.sort.src": "Quelle",
  "know.sort.senders": "Absender",
  "know.sort.ts": "Neueste",
  "know.menu_list": "Liste",
  "know.search": "Eingeordnete Absender suchen…",
  "know.none": "Keine Einträge gefunden.",
  "know.company": "Firma",
  "know.kind_label": "Eingeordnet unter",
  "know.note_label": "Notiz",
  "know.note_placeholder": "Optionale Notiz (höchstens 200 Zeichen)",
  "know.saved": "Gespeichert.",
  "know.select": "{name} auswählen",
  "know.select_all": "Alle angezeigten auswählen",
  "know.selected": "{n} ausgewählt",
  "know.delete_sel": "Auswahl löschen ({n})",
  "know.delete_title": "{n} Einträge löschen?",
  "know.delete_title_one": "1 Eintrag löschen?",
  "know.delete_body":
    "Die Absender sind danach wieder dort, wo die Regeln sie hingelegt "
    + "haben. Du kannst das gleich danach rückgängig machen.",
  "know.delete_go": "{n} Einträge löschen",
  "know.delete_go_one": "1 Eintrag löschen",
  "know.deleted": "{n} Einträge entfernt.",
  "know.deleted_one": "Eintrag entfernt.",
  "know.status.active": "Wirkt",
  "know.status.no_effect": "Ohne Wirkung: {why}",
  "know.status.inactive": "Inaktiv: {why}",
  "know.status.inert": "Unbrauchbar: {why}",
  "know.status.unused": "Kein Absender in deinen Postfächern passt",
  "know.status.unknown": "Noch nicht jedes Postfach ist gescannt",
  "know.unused_btn": "Unbenutzte entfernen ({n})",
  "know.unused_blocked":
    "Scanne zuerst jedes Konto ({n} noch nicht gescannt): bis dahin kann "
    + "kein Eintrag als unbenutzt gelten.",
  "know.unused_title": "{n} unbenutzte Einträge entfernen?",
  "know.unused_title_one": "1 unbenutzten Eintrag entfernen?",
  "know.unused_body":
    "Kein Absender in einem deiner Postfächer passt zu ihnen. Einträge von "
    + "Absendern, die nur eine eigene Zeile oder eine Firmenzeile haben, sind "
    + "nicht unbenutzt und bleiben. Das lässt sich nicht rückgängig machen.",
  "know.unused_go": "{n} Einträge entfernen",
  "know.unused_go_one": "1 Eintrag entfernen",
  "know.unused_done": "{n} unbenutzte Einträge entfernt.",
  "know.unused_done_one": "1 unbenutzter Eintrag entfernt.",
  "know.keep_all": "Alle KI-Antworten behalten",
  "know.forget_btn": "Behaltene KI-Antworten vergessen ({n} Absender)",
  "know.forget_btn_one": "Behaltene KI-Antworten vergessen (1 Absender)",
  "know.forget_btn_unused": "Behaltene KI-Antworten vergessen ({n} Antworten)",
  "know.forget_btn_unused_one": "Behaltene KI-Antworten vergessen (1 Antwort)",
  "know.forget_title": "Die behaltenen KI-Antworten für {n} Absender vergessen?",
  "know.forget_title_one": "Die behaltene KI-Antwort für 1 Absender vergessen?",
  "know.forget_title_unused": "{n} behaltene KI-Antworten vergessen, die gerade keinen Absender einordnen?",
  "know.forget_title_unused_one": "1 behaltene KI-Antwort vergessen, die gerade keinen Absender einordnet?",
  "know.forget_b_back": "Die Absender sind wieder dort, wo die Regeln sie hingelegt haben.",
  "know.forget_b_own": "Was du selbst eingeordnet hast, bleibt.",
  "know.forget_go": "Für {n} Absender vergessen",
  "know.forget_go_one": "Für 1 Absender vergessen",
  "know.forget_go_unused": "{n} Antworten vergessen",
  "know.forget_go_unused_one": "1 Antwort vergessen",
  "know.forgot": "Behaltene KI-Antworten für {n} Absender vergessen.",
  "know.forgot_one": "Behaltene KI-Antwort für 1 Absender vergessen.",
  "know.forgot_unused": "{n} behaltene KI-Antworten vergessen.",
  "know.forgot_unused_one": "1 behaltene KI-Antwort vergessen.",
  "know.download": "Herunterladen",
  "know.upload": "Hochladen…",
  "know.upload_bad": "In dieser Datei stehen keine eingeordneten Absender.",
  "know.upload_title": "Diese Datei mit deinen eingeordneten Absendern zusammenführen?",
  "know.upload_b_n": "Die Datei enthält {n} Einträge.",
  "know.upload_b_n_one": "Die Datei enthält 1 Eintrag.",
  "know.upload_b_merge":
    "Deine bestehenden Einträge bleiben; gibt es denselben Absender oder "
    + "dieselbe Firma in beiden, gewinnt der neuere.",
  "know.upload_go": "Zusammenführen",
  "know.uploaded": "Zusammengeführt: {n} Einträge hinzugefügt oder aktualisiert.",
  "know.uploaded_one": "Zusammengeführt: 1 Eintrag hinzugefügt oder aktualisiert.",
  "know.more": "Mehr anzeigen (noch {n})",
  "know.load_error": "Die eingeordneten Absender konnten nicht geladen werden: {msg}",
  "know.forget_b_gone":
    "Eine vergessene Antwort ist endgültig weg – sortiere erneut mit KI, um neue zu bekommen. Das lässt sich nicht rückgängig machen.",
  "know.keep_b_account":
    "Die Antworten des Kontos, das du gerade ansiehst, werden behalten; andere Konten behalten ihre, bis du sie dort behältst.",
  "know.upload_b_rest":
    "Alles andere in einem vollständigen Backup wird hier ignoriert (der Import unter Einstellungen > Sicherung stellt das wieder her).",
  "know.download_tip":
    "Diese Liste als Datei herunterladen. Sie listet Absenderadressen und Notizen – halte sie privat.",
  // -- Fehler der Ordner-Funktionen (Backend-Codes, siehe api.ts ERROR_CODES)
  "ferr.role_archive": "Archiv",
  "ferr.busy_action":
    "Es läuft noch eine andere Aktion – versuche es erneut, sobald "
    + "sie fertig ist.",
  "ferr.busy_purge":
    "Es läuft bereits ein endgültiges Löschen – versuche "
    + "es erneut, sobald es fertig ist.",
  "ferr.busy_scan":
    "Ein Scan läuft – versuche es erneut, sobald er fertig ist.",
  "ferr.busy_rule":
    "Eine andere Regel läuft – versuche es erneut, sobald sie "
    + "fertig ist.",
  "ferr.count_required":
    "Der Ordner wurde noch nicht gezählt – lade ihn neu und "
    + "bestätige erneut.",
  "ferr.data_not_writable":
    "Inboxrake kann nicht in seinen Datenordner schreiben. Gib auf dem "
    + "Host der Benutzer-ID 1000 den Ordner, der unter /data eingebunden ist "
    + "(chown -R 1000:1000 <Ordner>), oder starte den Container mit --user, "
    + "und starte ihn dann neu.",
  "ferr.role_missing":
    "Auf dem Server wurde kein Ordner für „{folder}“ gefunden.",
  "ferr.inbox_missing": "Auf dem Server wurde kein Posteingang gefunden.",
  "ferr.junk_needs_trash":
    "Auf dem Server wurde kein Papierkorb gefunden – Spam wird "
    + "endgültig über den Papierkorb gelöscht.",
  "ferr.role_unconfirmed":
    "Für „{folder}“ kommen mehrere Ordner infrage – wähle zuerst in "
    + "den Einstellungen den richtigen.",
  "ferr.junk_is_trash": "Spam und Papierkorb sind derselbe Ordner.",
  "ferr.folder_changed":
    "Der Ordner „{folder}“ hat sich auf dem Server geändert – lade die "
    + "Liste neu und versuche es erneut.",
  "ferr.folder_changed_rescan":
    "Der Ordner „{folder}“ hat sich auf dem Server geändert – scanne "
    + "neu und versuche es erneut.",
  "ferr.partial_unsafe":
    "Dieser Server kann einzelne Mails eines Ordners nicht sicher löschen, "
    + "deshalb wurde nichts gelöscht.",
  "ferr.partial_unsafe_changed":
    "Dieser Server kann einzelne Mails eines Ordners nicht sicher löschen, "
    + "und der Ordner hat sich seit dem Zählen geändert – lade "
    + "ihn neu und versuche es erneut. Es wurde nichts gelöscht.",
  "ferr.cannot_open":
    "Der Ordner „{folder}“ konnte auf dem Server nicht geöffnet werden.",
  "ferr.cannot_list": "Die Mailliste des Ordners konnte nicht gelesen werden.",
  "ferr.mailto_unsafe":
    "Die Abmelde-Adresse in dieser Mail ist keine einzelne einfache "
    + "Adresse (oder ihr Text enthält Zeilenumbrüche), deshalb wurde keine "
    + "Mail gesendet.",
  "ferr.move_foreign_deleted":
    "Abgebrochen: Ein anderes Mailprogramm hat Mails in „{folder}“ zum "
    + "Löschen markiert, und dieser Server kann nicht nur unsere entfernen - "
    + "deshalb wurde dort nichts weiter gelöscht. Kopien der eben "
    + "verschobenen Mails können schon im Zielordner liegen, und ein neuer "
    + "Versuch würde eine weitere Kopie anlegen, solange diese Markierungen "
    + "bleiben. Lösche zuerst die markierten Mails im anderen Mailprogramm "
    + "endgültig (Ordner komprimieren / „Gelöschte entfernen“) und versuche "
    + "es dann erneut.",
  "ferr.unsub_blocked":
    "Der Abbestell-Link zeigt auf eine private oder interne Netzwerkadresse und wurde deshalb nicht aufgerufen.",
  "ferr.unsub_http":
    "Die Abbestellseite des Absenders hat mit Fehler {status} geantwortet.",
  "ferr.unsub_tls":
    "Die sichere Verbindung zur Abbestellseite des Absenders konnte nicht geprüft werden (Zertifikats- oder TLS-Problem).",
  "ferr.unsub_unreachable":
    "Die Abbestellseite des Absenders ist nicht erreichbar.",
  "ferr.unsub_timeout":
    "Die Abbestellseite des Absenders hat nicht rechtzeitig geantwortet.",
  "ferr.unsub_bad_url":
    "Der Abbestell-Link in dieser Mail ist keine gültige Webadresse.",
  "ferr.unsub_no_method":
    "Diese Mail enthält keinen brauchbaren Abbestell-Link und keine Abbestell-Adresse.",
  "ferr.unsub_mail_failed":
    "Die Abbestell-Mail konnte nicht gesendet werden - prüfe die Versand-Einstellungen (SMTP) des Kontos.",
  "ferr.unsub_pooled":
    "Eine zusammengefasste Zeile hat keinen einzelnen Absender zum Abbestellen - öffne einen ihrer Absender.",
  "ferr.unsub_unknown_group":
    "Diese Gruppe gibt es nicht mehr - scanne neu und versuche es erneut.",
  "ferr.unsub_failed":
    "Das Abbestellen ist unerwartet fehlgeschlagen. Details stehen im Server-Log.",
  "ferr.not_in_demo": "In der Demo nicht verfügbar.",
  "ferr.cannot_flag":
    "Der Server hat das Markieren der Mails zum Löschen nicht "
    + "akzeptiert.",
  "ferr.cannot_expunge":
    "Der Server hat die markierten Mails nicht entfernt.",
  "ferr.cannot_move": "Der Server hat das Verschieben abgelehnt.",
  "ferr.cannot_remove_copies":
    "Der Server hat die kopierten Mails nicht aus Spam entfernt.",
  "ferr.cannot_read_moved":
    "Die verschobenen Mails im Papierkorb konnten nicht gelesen werden.",
  "ferr.uv_unreadable":
    "Der Zustand des Ordners „{folder}“ konnte nicht gelesen werden – es "
    + "wird nichts gelöscht.",
  "ferr.no_known_selected":
    "Keine der ausgewählten Mails ist noch im Ordner – lade ihn neu.",
  "ferr.unknown_target": "Der Zielordner „{folder}“ existiert nicht.",
  "ferr.target_is_trash": "Das Ziel ist der Papierkorb selbst.",
  "ferr.nothing_to_undo":
    "Es gibt nichts mehr rückgängig zu machen.",
  "ferr.deleted_then_failed":
    "{cause} ({n} Mails wurden vor dem Fehler endgültig gelöscht)",
  "ferr.deleted_then_failed_one":
    "{cause} (1 Mail wurde vor dem Fehler endgültig gelöscht)",
  "ferr.stranded_then_failed":
    "{cause} ({n} Mails wurden in den Papierkorb verschoben und nicht "
    + "gelöscht)",
  "ferr.stranded_then_failed_one":
    "{cause} (1 Mail wurde in den Papierkorb verschoben und nicht "
    + "gelöscht)",
  "ferr.moved_then_failed":
    "{cause} ({n} Mails wurden vor dem Fehler verschoben)",
  "ferr.moved_then_failed_one":
    "{cause} (1 Mail wurde vor dem Fehler verschoben)",
  "ferr.rule_report_first":
    "Führe diese Regel zuerst im Berichtsmodus aus.",
  "ferr.rule_folder_changed":
    "Der Spam- oder Papierkorb-Ordner hat sich seit dem letzten Bericht "
    + "geändert – die Regel ist wieder im Berichtsmodus, es wurde "
    + "nichts gelöscht.",
  "ferr.rule_purge_grouping":
    "Spam- und Papierkorb-Regeln gelten für Absender.",
  "ferr.rule_purge_keep_latest":
    "„Neueste N behalten“ gibt es für Spam- und "
    + "Papierkorb-Regeln nicht.",
  "ferr.rule_purge_needs_age":
    "Eine Spam- oder Papierkorb-Regel braucht ein Alter (Mails älter "
    + "als N Tage).",
  "ferr.rule_purge_filter":
    "Dieser Filter ist für Spam- und Papierkorb-Regeln nicht "
    + "verfügbar: {names}",
  "ferr.rule_purge_filter_domain":
    "Dieser Filter ist für Spam- und Papierkorb-Regeln nicht "
    + "verfügbar: {names} (er trifft nie auf Absender – nutze "
    + "stattdessen Freitext wie den Domainnamen).",
  "ferr.rule_filter_invalid":
    "Dieser Filter enthält Teile, die Inboxrake nicht versteht: {names}",
  "ferr.rule_filter_window":
    "Ein Zeitfenster ({names}) funktioniert nur zusammen mit is:new, "
    + "is:still-mailing oder ai:... – allein würde es alles treffen.",
  "ferr.rule_filter_window_run":
    "Der Filter hat ein Zeitfenster ({names}) ohne is:new, is:still-mailing "
    + "oder ai:... – bearbeite die Regel. Ausführungsläufe werden bis dahin "
    + "übersprungen.",
  "ferr.rule_filter_invalid_run":
    "Der Filter enthält Teile, die Inboxrake nicht versteht: {names} – "
    + "bearbeite die Regel. Ausführungsläufe werden bis dahin "
    + "übersprungen.",
  "rule.filter_invalid":
    "Der Filter enthält Teile, die Inboxrake nicht versteht: {names}. "
    + "Ausführungsläufe werden übersprungen, bis du die Regel bearbeitest.",
  "ferr.rule_filter_too_long":
    "Dieser Filter ist zu lang (mehr als {max} Zeichen).",
  "ferr.request_too_large":
    "Die Anfrage ist zu groß, als dass der Server sie annehmen könnte.",
  "ferr.block_key_invalid":
    "Dieser Absender bzw. diese Domain lässt sich nicht blockieren: Es ist "
    + "keine einfache Adresse oder kein einfacher Domainname.",
  "ferr.no_account":
    "Es ist noch kein Mail-Konto eingerichtet – trage zuerst in den "
    + "Einstellungen die Zugangsdaten ein.",
  "ferr.cafile_missing":
    "Die Zertifikatsdatei {path} existiert nicht – leere in den "
    + "Einstellungen das CA-Feld (normale Anbieter brauchen keins) oder "
    + "binde die Datei dort ein.",
  "ferr.auth_failed":
    "Der Server hat die Anmeldung abgelehnt – prüfe E-Mail-Adresse und Passwort (viele Anbieter verlangen ein App-Passwort).",
  "ferr.host_unreachable":
    "{host} ist nicht erreichbar – prüfe Hostnamen, Port und deine Netzwerkverbindung.",
  "ferr.tls_failed":
    "Die sichere Verbindung ist fehlgeschlagen – prüfe Sicherheitsoption, Port und Zertifikat.",
  "ferr.host_not_found":
    "{host} wurde nicht gefunden – prüfe den Hostnamen auf Tippfehler.",
  "ferr.conn_refused":
    "{host} hat die Verbindung abgelehnt – prüfe den Port (IMAP ist meist 993 mit SSL/TLS oder 143 mit STARTTLS) und ob der Server läuft.",
  "ferr.conn_timeout":
    "{host} hat nicht rechtzeitig geantwortet – prüfe Hostnamen, Port und dein Netzwerk bzw. die Firewall.",
  "ferr.tls_mismatch":
    "{host} hat geantwortet, aber nicht mit der gewählten sicheren Verbindung – probiere STARTTLS auf Port 143 oder SSL/TLS auf Port 993.",
  "ferr.not_imap":
    "{host} hat geantwortet, aber nicht wie ein IMAP-Server – prüfe den Port (IMAP nutzt 993 oder 143).",
  "ferr.cert_failed":
    "Dem Zertifikat von {host} wird nicht vertraut – bei einem selbstsignierten Zertifikat (z. B. Proton Bridge) trage dessen CA-Datei im Zertifikatsfeld der Anmeldeeinstellungen ein.",
  "ferr.connect_failed":
    "Verbindung zum Server nicht möglich – prüfe die Einstellungen und versuche es erneut.",
  "ferr.scan_failed":
    "Der Scan ist unerwartet fehlgeschlagen – versuche es erneut; wenn es "
    + "weiter scheitert, sieh im Server-Log nach.",
  "ferr.oauth_reconnect":
    "Der Mail-Anbieter akzeptiert die gespeicherte Anmeldung nicht mehr – verbinde das Konto in den Einstellungen neu.",
  "ferr.idp_unavailable":
    "Der Anmeldedienst ist nicht erreichbar. Versuch es gleich noch einmal.",
  "ferr.internal_error":
    "Auf dem Server ist etwas schiefgegangen – versuche es erneut; wenn es "
    + "weiter passiert, sieh im Server-Log nach.",
  "undo.from_junk": "{n} Mails aus Spam",
  "undo.from_junk_one": "1 Mail aus Spam",
  "undo.from_trash": "{n} Mails aus dem Papierkorb",
  "undo.from_trash_one": "1 Mail aus dem Papierkorb",
  // Klartext -> Filter (components/AiFilterPanel.tsx)
  "aif.button": "Filter beschreiben",
  "aif.title": "Filter beschreiben",
  "aif.sub": "Deine KI schreibt den Filter - du prüfst ihn vorher",
  "aif.label": "Beschreib, wonach du suchst",
  "aif.placeholder":
    "z. B. Shop-Newsletter, die ich seit einem Jahr nicht geöffnet habe",
  "aif.disclosure":
    "Nur dieser Satz und die Filter-Syntax gehen an deinen KI-Anbieter - "
    + "keine Maildaten.",
  "aif.hint": "Mit Strg+Enter (\u2318+Enter am Mac) absenden.",
  "aif.chars": "{n} / {max}",
  "aif.send": "Senden",
  "aif.thinking": "Filter wird geschrieben…",
  "aif.query_label": "Filter (editierbar)",
  "aif.preview_label": "Trifft aktuell zu auf",
  "aif.groups": "{n} Gruppen",
  "aif.groups_one": "1 Gruppe",
  "aif.mails": "{n} Mails",
  "aif.mails_one": "1 Mail",
  "aif.incl_protected": "davon {n} geschützt",
  "aif.no_match": "Dieser Filter trifft auf nichts zu.",
  "aif.no_scan": "Scanne dein Postfach, um zu sehen, wie viel zutrifft.",
  "aif.unsupported": "Nicht ausdrückbar: {items}",
  "aif.cost": "KI-Kosten: {cost}",
  "aif.apply": "Anwenden",
  "aif.save_preset": "Als Vorlage speichern",
  "aif.save_rule": "Als Regel speichern…",
  "aif.back": "Zurück",
  "aif.nothing_selected": "Anwenden filtert nur die Liste - es wird nichts "
    + "ausgewählt oder geändert.",
  "aif.preset_saved": "Vorlage gespeichert.",
  "aif.err.not_configured": "Richte zuerst in den Einstellungen einen KI-Anbieter ein.",
  "aif.err.text_empty": "Beschreib zuerst, wonach du suchst.",
  "aif.err.text_too_long": "Bitte höchstens 300 Zeichen.",
  "aif.err.budget":
    "Das monatliche KI-Budget ist aufgebraucht - erhöhe es in den "
    + "Einstellungen, um fortzufahren.",
  "space.title": "Speicherkarte",
  "space.total": "{size} in {mails} Mails",
  "space.total_one": "{size} in {mails} Mail",
  "space.empty": "Noch nichts zu zeigen - starte zuerst einen Scan.",
  "space.color_by": "Einfärben nach",
  "space.by_engagement": "Interaktion",
  "space.by_age": "Alter der letzten Mail",
  "space.by_ai": "KI-Urteil",
  "space.select": "Auswählen",
  "space.crumbs": "Pfad der Speicherkarte",
  "space.all": "Alle Mails",
  "space.map": "Postfach nach Größe",
  "space.legend": "Farblegende",
  "space.eng_low": "Geringe Interaktion",
  "space.eng_mid": "Mittlere Interaktion",
  "space.eng_high": "Hohe Interaktion",
  "space.age_old": "Letzte Mail vor über 2 Jahren",
  "space.age_mid": "Vor 6-24 Monaten",
  "space.age_new": "In den letzten 6 Monaten",
  "space.ai_safe": "Unbedenklich löschbar",
  "space.ai_review": "Prüfen",
  "space.ai_keep": "Behalten",
  "space.ai_none": "Noch nicht bewertet",
  "space.other": "Sonstige ({n})",
  "space.tile": "{name}, {size}, {mails} Mails",
  "space.tile_one": "{name}, {size}, {mails} Mail",
  "space.tile_protected": "{n} geschützte Absender",
  "space.tile_protected_one": "1 geschützter Absender",
  "space.tile_selected": "ausgewählt",
  "space.tick": "{name} auswählen",
  "space.top": "Die größten hier",
  "space.protected_note": "Geschützte Absender lassen sich hier nicht auswählen.",
  "space.sub_tiles": "nach Absender-Domain",
  "space.sub_rings": "innerer Ring = Domains, äußerer Ring = ihre Absender",
  "space.summary": "Platz nach Farbe",
  "space.where_all": "deines Platzes",
  "space.where_in": "des Platzes in {name}",
  "space.head_engagement": "{where} sind Mails, mit denen du dich kaum beschäftigst",
  "space.head_age": "{where} sind Mails ohne neue Nachricht seit über 2 Jahren",
  "space.head_ai": "{where} sind Mails, die die KI als unbedenklich löschbar einstuft",
  "space.ring_engagement": "{p} % geringe Interaktion",
  "space.ring_age": "{p} % seit über 2 Jahren still",
  "space.ring_ai": "{p} % unbedenklich löschbar",
  "space.view": "Ansicht",
  "space.view_tiles": "Kacheln",
  "space.view_rings": "Ringe",
  "space.hint_touch": "Tippen für Details · doppelt tippen zum Hineinzoomen",
  "space.hint_mouse": "Klicken für Details · Doppelklick zum Hineinzoomen",
  "space.select_hint": "Tippe Kacheln oder Zeilen an, um Absender auszuwählen",
  "space.rings_label": "Postfach nach Größe als Ringe: innen die Domains, außen ihre Absender. Die Liste daneben enthält dieselben Zahlen.",
  "space.ring_all": "{mails} Mails",
  "space.ring_all_one": "{mails} Mail",
  "space.ring_item": "{share} · {mails} Mails",
  "space.ring_item_one": "{share} · {mails} Mail",
  "space.zoom_in": "Hineinzoomen",
  "space.details": "Details zu {name}",
  "space.n_senders": "{n} Absender",
  "space.n_senders_one": "1 Absender",
  "space.n_mails": "{n} Mails",
  "space.n_mails_one": "1 Mail",
  "space.d_size": "Größe",
  "space.d_of_mailbox": "{p} deines Postfachs",
  "space.d_opened": "Interaktion",
  "space.d_eng_low": "Gering",
  "space.d_eng_medium": "Mittel",
  "space.d_eng_high": "Hoch",
  "space.d_last": "Letzte Mail",
  "space.d_fresh": "neue Mail diesen Monat",
  "space.d_idle": "seit {n} Monaten nichts Neues",
  "space.d_idle_one": "seit 1 Monat nichts Neues",
  "space.d_ai": "KI sagt",
  "space.d_ai_cover": "{done} von {n} Mails",
  "space.d_ai_cover_one": "{done} von 1 Mail",
  "space.d_mails": "Mails",
  "space.show_senders": "In Absendern zeigen",
  "space.show_all": "Alle {n} zeigen",
  "space.show_less": "Weniger zeigen",
  "space.review": "In Absendern prüfen",
  "space.selected": "{n} Absender - {size} ausgewählt",
  "space.selected_one": "1 Absender - {size} ausgewählt",
  "space.filter_cleared": "Filter zurückgesetzt, damit deine Auswahl sichtbar ist.",
  "triage.menu": "Triage",
  "triage.menu_sub": "Gruppen durchwischen, am Ende anwenden",
  "triage.title": "Triage",
  "triage.progress": "Karte {n} von {total}",
  "triage.summary_title": "Deine Entscheidungen",
  "triage.trash": "Papierkorb",
  "triage.keep": "Behalten",
  "triage.unsub": "Abbestellen",
  "triage.protect": "Schützen",
  "triage.undo": "Letzte Entscheidung rückgängig",
  "triage.undo_short": "Zurück",
  "triage.done": "Fertig",
  "triage.mails": "Mails",
  "triage.size": "Größe",
  "triage.protected_label": "Geschützt",
  "triage.protected_kept": "Geschützt - bleibt erhalten",
  "triage.hint":
    "Nach links wischen = Papierkorb, nach rechts = behalten, nach oben = abbestellen. Die Schaltflächen und die Pfeiltasten funktionieren auch.",
  "triage.hint_wide":
    "Ziehe die Karte nach links oder rechts oder nutze die Pfeiltasten. Nichts ändert sich, bis du am Ende deine Entscheidungen anwendest.",
  "triage.next": "Als Nächstes",
  "triage.next_row": "{n} Mails · {size}",
  "triage.next_row_one": "1 Mail · {size}",
  "triage.next_more": "+ {n} weitere",
  "triage.n_trashed": "{n} im Papierkorb",
  "triage.n_kept": "{n} behalten",
  "triage.n_unsub": "{n} abbestellt",
  "triage.n_protected": "{n} geschützt",
  "triage.nothing_yet": "Noch nichts entschieden",
  "triage.s_trash": "{n} Gruppen in den Papierkorb · {size}",
  "triage.s_trash_one": "1 Gruppe in den Papierkorb · {size}",
  "triage.s_unsub": "{n} abbestellen",
  "triage.s_protect": "{n} schützen",
  "triage.s_trash_mails":
    "{mails} Mails aus {n} Gruppen in den Papierkorb verschieben (bis zu {size})",
  "triage.s_trash_mails_one":
    "{mails} Mails aus 1 Gruppe in den Papierkorb verschieben (bis zu {size})",
  "triage.s_unsub_long": "{n} Absender abbestellen",
  "triage.s_unsub_long_one": "1 Absender abbestellen",
  "triage.s_protect_long": "{n} Einträge zur Schutzliste hinzufügen",
  "triage.s_protect_long_one": "1 Eintrag zur Schutzliste hinzufügen",
  "triage.kept_note": "{n} bleiben unverändert.",
  "triage.unseen_note": "{n} Karten noch nicht angesehen.",
  "triage.nothing_to_apply":
    "Nichts anzuwenden - jede Gruppe bleibt, wie sie ist.",
  "triage.back": "Zurück zu den Karten",
  "triage.apply_decisions": "{n} Entscheidungen anwenden",
  "triage.apply_decisions_one": "1 Entscheidung anwenden",
  "triage.latest": "Letzte Mails",
  "triage.apply": "Anwenden",
  "triage.discard_title": "{n} Entscheidungen verwerfen?",
  "triage.discard_title_one": "1 Entscheidung verwerfen?",
  "triage.discard_body": "In deinem Postfach wurde nichts verändert.",
  "triage.discard": "Verwerfen",
  "triage.confirm_title": "Triage-Entscheidungen anwenden?",
  "triage.c_trash":
    "{mails} Mails aus {n} Gruppen in den Papierkorb verschieben",
  "triage.c_trash_one": "{mails} Mails aus 1 Gruppe in den Papierkorb verschieben",
  "triage.c_unsub": "{n} Absender abbestellen",
  "triage.c_unsub_one": "1 Absender abbestellen",
  "triage.c_protect": "{n} Einträge zur Schutzliste hinzufügen",
  "triage.c_protect_one": "1 Eintrag zur Schutzliste hinzufügen",
  "triage.c_undo": "Das Verschieben in den Papierkorb lässt sich anschließend rückgängig machen",
  "triage.apply_btn": "Anwenden",
  // Your year in mail (story cards)
  "wrapped.menu": "Dein Jahr in Mails",
  "wrapped.title_year": "Dein Jahr in Mails {year}",
  "wrapped.progress": "Fortschritt der Story",
  "wrapped.back": "Vorherige Karte",
  "wrapped.next": "Nächste Karte",
  "wrapped.so_far": "bisher",
  "wrapped.year": "Jahr",
  "wrapped.based_on": "Basiert auf den Mails, die jetzt in deinem Postfach liegen - inzwischen gelöschte Mails zählen nicht als empfangen.",
  "wrapped.based_on_short": "Basiert auf den Mails, die jetzt im Postfach liegen",
  "wrapped.empty": "Keine Mails aus {year} in deinem Postfach.",
  "wrapped.intro.lead": "Du hast erhalten",
  "wrapped.intro.unit": "Mails in {year}",
  "wrapped.intro.unit_one": "Mail in {year}",
  "wrapped.intro.unit_partial": "Mails bisher in {year}",
  "wrapped.intro.unit_partial_one": "Mail bisher in {year}",
  "wrapped.senders.lead": "Gesendet von",
  "wrapped.senders.unit": "verschiedenen Absendern",
  "wrapped.senders.unit_one": "Absender",
  "wrapped.senders.sub": "Du hast {pct} % davon gelesen. {new} dieser Absender haben dir dieses Jahr zum ersten Mal geschrieben.",
  "wrapped.loudest.lead": "Dein lautester Absender",
  "wrapped.loudest.top": "Lauteste Absender",
  "wrapped.loudest.rate": "{mails} · eine alle {days} Tage",
  "wrapped.loudest.rate_day": "{mails} · etwa {per} pro Tag",
  "wrapped.month.lead": "Der Monat, der dich begraben hat",
  "wrapped.month.unit": "{n} Mails landeten bei dir",
  "wrapped.month.unit_one": "1 Mail landete bei dir",
  "wrapped.month.peak": "{month}: {n} - dein stärkster Monat",
  "wrapped.month.chart": "Mails pro Monat",
  "wrapped.rhythm.lead": "Dein geschäftigster Tag",
  "wrapped.rhythm.unit": "{n} Mails kamen an diesem Wochentag",
  "wrapped.rhythm.unit_one": "1 Mail kam an diesem Wochentag",
  "wrapped.rhythm.hour": "Geschäftigste Stunde: {hour} Uhr ({n} Mails)",
  "wrapped.rhythm.hour_one": "Geschäftigste Stunde: {hour} Uhr (1 Mail)",
  "wrapped.rhythm.chart_days": "Mails pro Wochentag",
  "wrapped.rhythm.chart_hours": "Mails pro Uhrzeit",
  "wrapped.ghosts.lead": "Geister-Absender",
  "wrapped.ghosts.unit": "Absender haben dir mindestens 10 Mails geschickt, und du hast keine einzige geöffnet",
  "wrapped.ghosts.unit_one": "Absender hat dir mindestens 10 Mails geschickt, und du hast keine einzige geöffnet",
  "wrapped.biggest.lead": "Deine größte Mail",
  "wrapped.biggest.unit": "von {sender}",
  "wrapped.cleanup.lead": "Das hast du aufgeräumt",
  "wrapped.cleanup.unit": "Mails aus dem Weg geräumt oder gelöscht",
  "wrapped.cleanup.unit_one": "Mail aus dem Weg geräumt oder gelöscht",
  "wrapped.cleanup.trashed": "{n} in den Papierkorb verschoben",
  "wrapped.cleanup.trashed_one": "1 in den Papierkorb verschoben",
  "wrapped.cleanup.archived": "{n} archiviert",
  "wrapped.cleanup.archived_one": "1 archiviert",
  "wrapped.cleanup.purged": "{n} endgültig gelöscht ({size} freigegeben)",
  "wrapped.cleanup.unsubs": "{n} Abmeldungen",
  "wrapped.cleanup.unsubs_one": "1 Abmeldung",
  "wrapped.cleanup.rules": "Deine Regeln liefen {n} Mal und haben Mails bearbeitet",
  "wrapped.cleanup.rules_one": "Deine Regeln liefen einmal und haben Mails bearbeitet",
  "wrapped.cleanup.top_rule": "Regel „{name}“ hat die meisten Mails bearbeitet ({n})",
  "wrapped.cleanup.top_rule_gone": "Eine gelöschte Regel hat die meisten Mails bearbeitet ({n})",
  "wrapped.cleanup.tile_trashed": "im Papierkorb",
  "wrapped.cleanup.tile_archived": "archiviert",
  "wrapped.cleanup.tile_unsubs": "abgemeldet",
  "wrapped.cleanup.tile_rules": "Regeln liefen",
  "wrapped.summary.lead": "Dein Jahr auf einen Blick",
  "wrapped.stat.senders": "Absender",
  "wrapped.stat.read": "gelesen",
  "wrapped.stat.new": "neue Absender",
  "wrapped.stat.ghosts": "Geister-Absender",
  "wrapped.stat.cleaned": "aufgeräumt",
  "wrapped.stat.unsubscribed": "abgemeldet",
  "wrapped.show_names": "Namen zeigen",
  "wrapped.save": "Bild speichern",
  "wrapped.names_hidden": "Absendernamen sind im Bild verborgen.",
  "wrapped.names_shown": "Absendernamen sind im Bild sichtbar.",
  "wrapped.local_only": "Es wird auf diesem Gerät erstellt; nichts wird hochgeladen.",
  "wrapped.footer": "Inboxrake",
  "demo.boot.title": "Die Demo startet",
  "demo.boot.download": "Demo-Engine wird heruntergeladen",
  "demo.boot.mb": "{done} von {total} MB",
  "demo.boot.python": "Python wird gestartet",
  "demo.boot.libraries": "Bibliotheken werden geladen",
  "demo.boot.seed": "Demo-Postfächer werden gefüllt",
  "demo.boot.done": "Erledigt",
  "demo.boot.privacy":
    "Alles läuft in deinem Browser. Kein Postfach, kein Konto, nichts wird "
    + "irgendwohin gesendet.",
  "demo.boot.hint":
    "Auf dem Handy kann der erste Start bis zu einer Minute dauern.",
  "demo.boot.try": "Währenddessen zum Ausprobieren",
  "demo.boot.try1": "Öffne einen Absender und sieh dir seine Mails an",
  "demo.boot.try2": "Verschiebe sie in den Papierkorb - und mach es dann rückgängig",
  "demo.boot.try3": "Entferne doppelte Kopien mit einem Tipp",
  "demo.fail.title": "Die Demo konnte nicht starten.",
  "demo.fail.unsupported":
    "Dieser Browser kann die Demo nicht ausführen (sie braucht WebAssembly "
    + "und Module-Web-Worker). Ein aktueller Chrome, Firefox, Safari oder "
    + "Edge schafft das.",
  "demo.fail.stalled":
    "Ein Schritt dauert viel länger als normal, deshalb haben wir nicht "
    + "weiter gewartet. Prüfe deine Verbindung und versuche es erneut.",
  "demo.fail.error": "Beim Starten der Demo ist etwas schiefgelaufen.",
  "demo.retry": "Erneut versuchen",
  "demo.bar.pill": "DEMO",
  "demo.bar.text": "Erfundene Postfächer - deine Änderungen bleiben in diesem Tab.",
  "demo.bar.text_short": "Nur in diesem Tab",
  "demo.bar.try": "Zum Ausprobieren",
  "demo.bar.reset": "Zurücksetzen",
  "demo.bar.install": "Selbst installieren",
  "demo.tip.title": "Drei Dinge zum Ausprobieren",
  "demo.tip.1": "Öffne **ACME Store** unter Absender",
  "demo.tip.2": "**Verschiebe seine Mails in den Papierkorb**",
  "demo.tip.3": "Tippe auf **Rückgängig** - sie sind wieder da",
  "demo.tip.show": "Zeig's mir",
  "demo.tip.got": "Verstanden",
  "demo.reset": "Demo zurücksetzen",
  "demo.reset.title": "Demo zurücksetzen?",
  "demo.reset.body":
    "Deine Änderungen werden verworfen und die Demo-Postfächer werden neu "
    + "gefüllt.",
};
