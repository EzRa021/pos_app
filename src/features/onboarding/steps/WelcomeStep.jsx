// ============================================================================
// WelcomeStep — first screen of onboarding
// ============================================================================
// Two choices: create a new business, or restore an existing one from cloud.

import { Store, CloudDownload } from 'lucide-react';

export function WelcomeStep({ onNew, onRestore }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Brand */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-md shadow-primary/30">
          <span className="text-2xl font-black text-white">Q</span>
        </div>
        <div className="text-center">
          <h1 className="text-lg font-bold text-foreground tracking-tight">Welcome to Quantum POS</h1>
          <p className="text-xs text-muted-foreground mt-1">Let's get your business set up</p>
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-3">
        <p className="text-xs font-medium text-muted-foreground text-center uppercase tracking-wider">
          Choose an option
        </p>

        {/* New business */}
        <button
          onClick={onNew}
          className="group flex items-start gap-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-primary/5 p-4 text-left transition-all duration-150"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
            <Store className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">New Business</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              First time here? Set up your business profile from scratch.
            </p>
          </div>
        </button>

        {/* Restore from cloud */}
        <button
          onClick={onRestore}
          className="group flex items-start gap-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-primary/5 p-4 text-left transition-all duration-150"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted group-hover:bg-muted/70 transition-colors">
            <CloudDownload className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Restore from Cloud</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Setting up a new terminal? Enter your Business ID to pull data from the cloud.
            </p>
          </div>
        </button>
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        Quantum POS © {new Date().getFullYear()}
      </p>
    </div>
  );
}
