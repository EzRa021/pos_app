// ============================================================================
// WelcomeStep — first screen of onboarding
// ============================================================================
// Two choices: create a new business, or link to an existing one by ID.

import { Store, Link } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function WelcomeStep({ onNew, onExisting }) {
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

        {/* Existing business */}
        <button
          onClick={onExisting}
          className="group flex items-start gap-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-primary/5 p-4 text-left transition-all duration-150"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted group-hover:bg-muted/70 transition-colors">
            <Link className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">I have a Business ID</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Already set up on another device? Link this terminal using your Business ID.
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
