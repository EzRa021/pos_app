// ============================================================================
// SETUP WIZARD — Orchestrates the 3-step startup flow
// ============================================================================

import { useEffect, useState } from "react";
import ModeSelector from "./ModeSelector";
import ServerSetup  from "./ServerSetup";
import ClientSetup  from "./ClientSetup";

export const CONFIG_KEY = "qpos_config";

export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState("mode");

  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("dark");
    html.style.background = "var(--background)";
  }, []);

  function handleModeSelect(mode) { setStep(mode); }

  function handleConnected(info) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...info, setupComplete: true }));
    onComplete(info);
  }

  return (
    <div className="h-screen w-full bg-background flex items-center justify-center overflow-hidden relative">

      {/* Background grid — identical to LoginPage */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      {/* Radial glows */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary/[0.05] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-primary/[0.04] blur-3xl" />

      {/* Centered card */}
      <div className="relative w-full max-w-[480px] mx-4">
        <div className="rounded-2xl border border-border bg-card shadow-2xl shadow-black/60 overflow-hidden">

          {/* Card header accent bar */}
          <div className="px-8 pt-7 pb-0">
            <div className="flex items-center gap-1.5 mb-5">
              <span className="h-[3px] w-6 rounded-full bg-primary" />
              <span className="h-[3px] w-2.5 rounded-full bg-primary/30" />
              <span className="h-[3px] w-1 rounded-full bg-primary/15" />
            </div>
          </div>

          <div className="px-8 pb-8">
            {step === "mode"   && <ModeSelector onSelect={handleModeSelect} />}
            {step === "server" && <ServerSetup  onConnected={handleConnected} onBack={() => setStep("mode")} />}
            {step === "client" && <ClientSetup  onConnected={handleConnected} onBack={() => setStep("mode")} />}
          </div>
        </div>

        <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mt-5">
          © {new Date().getFullYear()} Zera
        </p>
      </div>
    </div>
  );
}
