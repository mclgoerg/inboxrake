import { Landmark } from "lucide-react";
import type { ReactNode } from "react";
import type { DocKind } from "../types";
import { KEEP_SAFE_LOOK } from "./KeepSafeConfirm";
import type { TagTone } from "./ui";

/** Icon and tile colour of each kind of document: the three Keep-safe classes
 *  look as they do in Settings, tax & official has its own. */
export const DOC_LOOK: Record<DocKind, { icon: ReactNode; tone: TagTone }> = {
  invoices: KEEP_SAFE_LOOK.invoices,
  contracts: KEEP_SAFE_LOOK.contracts,
  bookings: KEEP_SAFE_LOOK.bookings,
  tax: { icon: <Landmark size={16} />, tone: "new" },
};
