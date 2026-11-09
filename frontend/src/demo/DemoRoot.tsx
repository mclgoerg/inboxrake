import { useState, useSyncExternalStore } from "react";
import App from "../App";
import { DemoBar } from "./DemoBar";
import { DemoBoot } from "./DemoBoot";
import { DemoTip, markSeen, tipSeen } from "./DemoTip";
import type { DemoRuntime } from "./runtime";

/** Boot screen until the backend is up, then the demo bar, the one-time tip
 *  and the real app. Resetting boots a fresh worker, which swaps the app out
 *  for the boot screen again (and so also drops the UI's own state). */
export function DemoRoot({ runtime }: { runtime: DemoRuntime }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getState);
  const [tip, setTip] = useState(() => !tipSeen());
  if (state.phase !== "ready") {
    return <DemoBoot state={state} onRetry={() => runtime.start()} />;
  }
  return (
    <>
      <DemoBar onReset={() => runtime.start()} onTips={() => setTip(true)}
        onAsk={() => { if (tip) { markSeen(); setTip(false); } }} />
      <DemoTip open={tip} onClose={() => setTip(false)} />
      <App />
    </>
  );
}
