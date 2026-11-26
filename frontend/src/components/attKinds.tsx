import { File, FileArchive, FileText, Film, Image as ImageIcon, Music }
  from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../i18n";
import type { AttKind } from "../types";

/** Look of each kind of file: icon + the token pair of its tile and its bar
 *  segment (colour is never the only signal - every use also prints the
 *  kind's name or extension). */
export const KIND: Record<AttKind, { icon: ReactNode; tile: string; fill: string }> = {
  pdf: { icon: <FileText size={18} aria-hidden />,
    tile: "bg-keep-bg text-keep-fg", fill: "bg-keep-fg" },
  images: { icon: <ImageIcon size={18} aria-hidden />,
    tile: "bg-info-bg text-info-fg", fill: "bg-info-fg" },
  video: { icon: <Film size={18} aria-hidden />,
    tile: "bg-attach-bg text-attach-fg", fill: "bg-attach-fg" },
  audio: { icon: <Music size={18} aria-hidden />,
    tile: "bg-safe-bg text-safe-fg", fill: "bg-safe-fg" },
  archives: { icon: <FileArchive size={18} aria-hidden />,
    tile: "bg-review-bg text-review-fg", fill: "bg-review-fg" },
  documents: { icon: <FileText size={18} aria-hidden />,
    tile: "bg-new-bg text-new-fg", fill: "bg-new-fg" },
  other: { icon: <File size={18} aria-hidden />,
    tile: "bg-chip text-muted", fill: "bg-faint" },
};
export const kindName = (k: AttKind) => t(`atts.kind.${k}`);


/** The kind of a file from its name's extension - the same table as the
 *  backend's `att_kind` (the attachment analysis), for a file the reader
 *  knows by name only. */
const EXTS: Record<Exclude<AttKind, "other">, string[]> = {
  pdf: ["pdf"],
  images: ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tif",
    "tiff", "svg", "raw", "cr2", "nef", "arw", "dng"],
  video: ["mov", "mp4", "m4v", "avi", "mkv", "webm", "wmv", "mpg", "mpeg",
    "3gp"],
  audio: ["mp3", "m4a", "wav", "flac", "ogg", "aac", "wma", "aiff"],
  archives: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"],
  documents: ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
    "txt", "rtf", "csv", "pages", "numbers", "key", "md", "epub"],
};

export const extOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).trim().toLowerCase() : "";
};

export const kindOfName = (name: string): AttKind => {
  const ext = extOf(name);
  const hit = (Object.keys(EXTS) as (keyof typeof EXTS)[])
    .find((k) => EXTS[k].includes(ext));
  return hit ?? "other";
};
