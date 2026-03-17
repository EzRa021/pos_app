// components/shared/PinLockScreen.jsx — 4-digit PIN overlay
import { useState, useEffect } from "react";
import { Lock, Delete, Loader2 } from "lucide-react";
import { toast }  from "sonner";
import { cn }     from "@/lib/utils";
import { verifyPosPin } from "@/commands/security";
import { useAuthStore }  from "@/stores/auth.store";

const DIGITS = [[1,2,3],[4,5,6],[7,8,9],[null,0,"del"]];

export function PinLockScreen({ onUnlock }) {
  const userId       = useAuthStore((s) => s.user?.id);
  const [pin,     setPin]     = useState("");
  const [busy,    setBusy]    = useState(false);
  const [shake,   setShake]   = useState(false);

  const handleDigit = (d) => {
    if (d === "del") { setPin((p) => p.slice(0, -1)); return; }
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) verify(next);
  };

  const verify = async (code) => {
    setBusy(true);
    try {
      const result = await verifyPosPin(userId, code);
      if (result?.success) {
        onUnlock?.();
      } else {
        setShake(true);
        setPin("");
        setTimeout(() => setShake(false), 600);
        toast.error("Incorrect PIN. Try again.");
      }
    } catch (e) {
      setShake(true);
      setPin("");
      setTimeout(() => setShake(false), 600);
      toast.error("Incorrect PIN.");
    } finally {
      setBusy(false);
    }
  };

  // Keyboard support
  useEffect(() => {
    const handler = (e) => {
      if (/^\d$/.test(e.key))  handleDigit(parseInt(e.key, 10));
      if (e.key === "Backspace") handleDigit("del");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pin]);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-8 w-72">
        {/* Icon */}
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-border bg-card">
          <Lock className="h-7 w-7 text-muted-foreground" />
        </div>

        {/* Title */}
        <div className="text-center">
          <h2 className="text-lg font-bold text-foreground">POS Locked</h2>
          <p className="text-sm text-muted-foreground mt-1">Enter your 4-digit PIN to continue</p>
        </div>

        {/* PIN dots */}
        <div className={cn("flex items-center gap-4", shake && "animate-shake")}>
          {[0,1,2,3].map((i) => (
            <div key={i} className={cn(
              "h-4 w-4 rounded-full border-2 transition-all duration-150",
              i < pin.length
                ? "border-primary bg-primary scale-110"
                : "border-muted-foreground/30 bg-transparent",
            )} />
          ))}
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {DIGITS.flat().map((d, i) => {
            if (d === null) return <div key={i} />;
            return (
              <button
                key={i}
                onClick={() => handleDigit(d)}
                disabled={busy}
                className={cn(
                  "flex h-14 items-center justify-center rounded-xl border border-border bg-card text-lg font-bold",
                  "transition-all active:scale-95 hover:bg-muted/60 disabled:opacity-50",
                  d === "del" && "text-muted-foreground",
                )}
              >
                {d === "del" ? <Delete className="h-5 w-5" /> : d}
              </button>
            );
          })}
        </div>

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />Verifying…
          </div>
        )}
      </div>
    </div>
  );
}
