// ============================================================================
// features/settings/AppearancePanel.jsx
// ============================================================================
// Per-branch dark / light theme toggle + accent colour picker.
// Both preferences are saved to the `stores` table via update_store and
// applied immediately without a reload.
// ============================================================================

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Moon, Sun, Loader2, CheckCircle2, Palette } from "lucide-react";

import { Button }         from "@/components/ui/button";
import { useBranchStore } from "@/stores/branch.store";
import { updateStore }    from "@/commands/stores";
import { applyTheme, ACCENT_COLORS } from "@/lib/theme";
import { cn }             from "@/lib/utils";
import { toast }          from "sonner";

// ── Mini theme-preview card ───────────────────────────────────────────────────

function ThemeCard({ value, label, icon: Icon, description, isSelected, onClick, accentHex }) {
  const isDark = value === "dark";
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "relative flex flex-col gap-3 rounded-xl border p-4 text-left transition-all duration-150",
        "hover:border-primary/40 active:scale-[0.98]",
        isSelected
          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
          : "border-border bg-card hover:bg-muted/20",
      )}
    >
      {/* Mini UI mockup */}
      <div className={cn(
        "w-full h-20 rounded-lg overflow-hidden border relative",
        isDark ? "bg-[#09090b] border-[#27272a]" : "bg-[#f8f8fa] border-[#e4e4e7]",
      )}>
        {/* Fake sidebar strip */}
        <div className={cn(
          "absolute inset-y-0 left-0 w-10 border-r flex flex-col gap-1 p-1.5",
          isDark ? "bg-[#111113] border-[#27272a]" : "bg-[#f0f0f2] border-[#e4e4e7]",
        )}>
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-1.5 rounded-sm"
              style={{
                backgroundColor: i === 1
                  ? accentHex
                  : isDark ? "#27272a" : "#d4d4d8",
              }}
            />
          ))}
        </div>
        {/* Fake content area */}
        <div className="absolute top-3 left-12 right-3 bottom-3 flex flex-col gap-1.5">
          <div className={cn("h-2 w-2/3 rounded", isDark ? "bg-[#27272a]" : "bg-[#e4e4e7]")} />
          <div className={cn("h-1.5 w-1/2 rounded", isDark ? "bg-[#1a1a1e]" : "bg-[#eeeeef]")} />
          <div
            className="mt-auto self-end h-5 w-14 rounded-md"
            style={{ backgroundColor: "#16a34a" }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg border",
            isSelected ? "border-primary/30 bg-primary/10" : "border-border bg-muted/40",
          )}>
            <Icon className={cn("h-3.5 w-3.5", isSelected ? "text-primary" : "text-muted-foreground")} />
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">{label}</p>
            <p className="text-[11px] text-muted-foreground">{description}</p>
          </div>
        </div>
        {isSelected && (
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
            <CheckCircle2 className="h-3 w-3 text-white" />
          </div>
        )}
      </div>
    </button>
  );
}

// ── Accent colour swatch ──────────────────────────────────────────────────────

function AccentSwatch({ colorKey, config, isSelected, onClick }) {
  return (
    <button
      type="button"
      title={config.label}
      onClick={() => onClick(colorKey)}
      className={cn(
        "group relative flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-all duration-150",
        "hover:border-primary/40 active:scale-[0.97]",
        isSelected
          ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30"
          : "border-border bg-card hover:bg-muted/20",
      )}
    >
      {/* Colour circle */}
      <div
        className="h-8 w-8 rounded-full shadow-md ring-2 ring-black/10 transition-transform duration-150 group-hover:scale-110"
        style={{ backgroundColor: config.hex }}
      />
      {/* Label */}
      <span className={cn(
        "text-[10px] font-semibold leading-none",
        isSelected ? "text-primary" : "text-muted-foreground",
      )}>
        {config.label}
      </span>
      {/* Selected checkmark */}
      {isSelected && (
        <div className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary shadow-sm">
          <CheckCircle2 className="h-2.5 w-2.5 text-white" />
        </div>
      )}
    </button>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function AppearancePanel() {
  const qc             = useQueryClient();
  const activeStore    = useBranchStore((s) => s.activeStore);
  const setActiveStore = useBranchStore((s) => s.setActiveStore);

  const currentTheme  = activeStore?.theme        ?? "dark";
  const currentAccent = activeStore?.accent_color ?? "blue";

  const [selectedTheme,  setSelectedTheme]  = useState(currentTheme);
  const [selectedAccent, setSelectedAccent] = useState(currentAccent);

  // ── Single mutation — saves whatever field(s) are passed ──────────────────
  const mutation = useMutation({
    mutationFn: (payload) => updateStore(activeStore.id, payload),
    onSuccess: (updatedStore) => {
      setActiveStore(updatedStore);
      qc.invalidateQueries({ queryKey: ["store", activeStore.id] });
    },
    onError: (err) => {
      // Revert local selection on failure
      setSelectedTheme(currentTheme);
      setSelectedAccent(currentAccent);
      toast.error(typeof err === "string" ? err : "Failed to save appearance.");
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleThemeSelect(theme) {
    if (theme === currentTheme || mutation.isPending) return;
    setSelectedTheme(theme);
    applyTheme(theme, selectedAccent);
    mutation.mutate({ theme }, {
      onSuccess: () => toast.success(`Switched to ${theme} mode.`),
    });
  }

  function handleAccentSelect(accent) {
    if (accent === currentAccent || mutation.isPending) return;
    setSelectedAccent(accent);
    applyTheme(selectedTheme, accent);
    mutation.mutate({ accent_color: accent }, {
      onSuccess: () => toast.success(`Accent colour changed to ${ACCENT_COLORS[accent]?.label ?? accent}.`),
    });
  }

  const accentHex = ACCENT_COLORS[selectedAccent]?.hex ?? ACCENT_COLORS.blue.hex;

  return (
    <div className="space-y-6">

      {/* ── Theme picker ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-muted/20">
          <Sun className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Interface Theme
          </h3>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Choose how Quantum POS looks for this branch. The setting is saved per branch —
            different branches can use different themes.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <ThemeCard
              value="dark"
              label="Dark"
              icon={Moon}
              description="Default — easy on the eyes"
              isSelected={selectedTheme === "dark"}
              onClick={handleThemeSelect}
              accentHex={accentHex}
            />
            <ThemeCard
              value="light"
              label="Light"
              icon={Sun}
              description="High contrast — bright environments"
              isSelected={selectedTheme === "light"}
              onClick={handleThemeSelect}
              accentHex={accentHex}
            />
          </div>

          {mutation.isPending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving…
            </div>
          )}
        </div>
      </div>

      {/* ── Accent colour picker ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-muted/20">
          <Palette className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Accent Colour
          </h3>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Choose the primary accent colour used for active navigation, buttons, and focus rings.
            Works with both dark and light themes.
          </p>

          <div className="grid grid-cols-3 gap-2">
            {Object.entries(ACCENT_COLORS).map(([key, config]) => (
              <AccentSwatch
                key={key}
                colorKey={key}
                config={config}
                isSelected={selectedAccent === key}
                onClick={handleAccentSelect}
              />
            ))}
          </div>

          {/* Live preview strip */}
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Preview
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="h-7 px-3 rounded-md text-[11px] font-semibold text-white transition-all"
                style={{ backgroundColor: accentHex }}
              >
                Primary button
              </button>
              <span
                className="h-7 px-3 flex items-center rounded-md border text-[11px] font-semibold transition-all"
                style={{ borderColor: accentHex, color: accentHex, backgroundColor: `${accentHex}18` }}
              >
                Active tab
              </span>
              <span
                className="inline-flex items-center gap-1 h-5 px-2 rounded-full border text-[10px] font-bold"
                style={{ borderColor: accentHex, color: accentHex, backgroundColor: `${accentHex}18` }}
              >
                Badge
              </span>
              <div
                className="h-4 w-4 rounded-full ring-2 ring-offset-1"
                style={{ backgroundColor: accentHex, ringColor: accentHex }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Info card ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-muted/20">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            About Themes
          </h3>
        </div>
        <div className="p-5 space-y-2.5">
          {[
            { icon: Moon, label: "Dark mode",  desc: "Default for all branches. Best in low-light retail environments." },
            { icon: Sun,  label: "Light mode", desc: "Recommended for outdoor kiosks or brightly lit environments." },
            { icon: Palette, label: "Accent colours", desc: "Accent colours change active states, buttons, and focus rings. The green charge button is unaffected." },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30 mt-0.5">
                <Icon className="h-3 w-3 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground">{label}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
