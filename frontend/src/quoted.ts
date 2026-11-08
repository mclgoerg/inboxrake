/* Splits a plain-text mail body into the author's own text and the quoted
 * history below/between it, so the conversation reader can fold the quotes
 * (every reply repeats the whole thread otherwise). Pure and heuristic: when
 * in doubt text stays visible, and a body that would end up with nothing
 * visible is returned whole. */

export interface TextSegment {
  text: string;
  quoted: boolean;
}

const WROTE = /^(on|am|le|el)\s.{3,250}?\b(wrote|schrieb|a écrit|escribió)\b.*:\s*$/i;
const ORIGINAL = /^-{2,}\s*(original message|ursprüngliche nachricht)\s*-{2,}$/i;
// A forwarded mail IS the content the sender passed on: from its marker on,
// nothing folds (only ">" quotes still do).
const FORWARDED = /^(-{2,}\s*(forwarded message|weitergeleitete nachricht)\s*-{2,}|begin forwarded message:?)$/i;
const FROM = /^(from|von):\s/i;
const SENT = /^(sent|gesendet|date|datum):\s/i;
const SUBJECT = /^(subject|betreff):\s/i;

const isQuoteLine = (l: string) => l.trimStart().startsWith(">");

/** Lines i.. that open an attribution ("On <date>, X wrote:"), possibly
 *  wrapped onto two lines; returns how many lines it spans, else 0. */
function attributionLength(lines: string[], i: number): number {
  const l = lines[i].trim();
  if (WROTE.test(l)) return 1;
  if (i + 1 < lines.length && /^(on|am|le|el)\s/i.test(l) && l.length < 250
      && WROTE.test(`${l} ${lines[i + 1].trim()}`)) return 2;
  return 0;
}

/** From the first quote line after `from` (skipping blanks)? */
function quoteFollows(lines: string[], from: number): boolean {
  let k = from;
  while (k < lines.length && !lines[k].trim()) k++;
  return k < lines.length && isQuoteLine(lines[k]);
}

/** Outlook-style header block / "Original Message" / forwarded marker:
 *  everything from here on is quoted (these carry no ">" prefixes). */
function isHardMarker(lines: string[], i: number): boolean {
  const l = lines[i].trim();
  if (ORIGINAL.test(l)) return true;
  const head = /^_{10,}$/.test(l) ? i + 1 : i;
  if (head >= lines.length || !FROM.test(lines[head].trim())) return false;
  const next = lines.slice(head + 1, head + 6).map((x) => x.trim());
  const hasSent = next.some((x) => SENT.test(x));
  // a divider line before "From:" is signal enough without a Subject line
  return hasSent && (next.some((x) => SUBJECT.test(x)) || head > i);
}

/** `forward`: the mail itself is a forward (its subject says Fwd: / WG:), so
 *  header blocks in it are the forwarded content, not a reply's history. */
export function splitQuoted(text: string,
    opts: { forward?: boolean } = {}): TextSegment[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const segs: TextSegment[] = [];
  const push = (ls: string[], quoted: boolean) => {
    if (!ls.length) return;
    const joined = ls.join("\n");
    const last = segs[segs.length - 1];
    if (last && last.quoted === quoted) last.text += "\n" + joined;
    else segs.push({ text: joined, quoted });
  };
  let i = 0;
  let forwarded = !!opts.forward;
  while (i < lines.length) {
    if (FORWARDED.test(lines[i].trim())) forwarded = true;
    if (!forwarded && isHardMarker(lines, i)) {
      push(lines.slice(i), true);
      break;
    }
    const attr = attributionLength(lines, i);
    if ((attr && quoteFollows(lines, i + attr)) || isQuoteLine(lines[i])) {
      let k = i + attr;
      // the quote block: ">" lines, plus blank lines between two of them
      while (k < lines.length) {
        if (isQuoteLine(lines[k])) k++;
        else if (!lines[k].trim() && quoteFollows(lines, k)) k++;
        else break;
      }
      push(lines.slice(i, k), true);
      i = k;
      continue;
    }
    push([lines[i]], false);
    i++;
  }
  const hasOwnText = segs.some((s) => !s.quoted && s.text.trim());
  return hasOwnText ? segs : [{ text: text.replace(/\r\n/g, "\n"),
                                quoted: false }];
}

/** Is this subject a forward ("Fwd: ...", "Fw:", "WG:")? */
export const isForward = (subject: string): boolean =>
  /^\s*(fwd?|wg|tr|rv)\s*:/i.test(subject);
