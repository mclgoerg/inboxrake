import { setClockShift } from "./clock";

/** Make the UI's "now" the given epoch second; returns the undo. */
export function clockShiftFor(epochSeconds: number): () => void {
  setClockShift(Date.now() - epochSeconds * 1000);
  return () => setClockShift(0);
}
