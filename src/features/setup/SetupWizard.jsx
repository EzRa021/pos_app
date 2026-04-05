// ============================================================================
// SETUP WIZARD — Orchestrates the 3-step startup flow
// ============================================================================

import { useState } from "react";
import ModeSelector from "./ModeSelector";
import ServerSetup  from "./ServerSetup";
import ClientSetup  from "./ClientSetup";

export const CONFIG_KEY = "qpos_config";

export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState("mode");

  function handleModeSelect(mode) { setStep(mode); }

  function handleConnected(info) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...info, setupComplete: true }));
    onComplete(info);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Card */}
        <div className="rounded-2xl border border-border bg-card shadow-2xl shadow-black/40 p-8">
          {step === "mode" && (
            <ModeSelector onSelect={handleModeSelect} />
          )}
          {step === "server" && (
            <ServerSetup onConnected={handleConnected} onBack={() => setStep("mode")} />
          )}
          {step === "client" && (
            <ClientSetup onConnected={handleConnected} onBack={() => setStep("mode")} />
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-muted-foreground mt-5">
          Quantum POS © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
