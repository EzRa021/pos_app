// ============================================================================
// features/pos/CustomerSearchBar.jsx — Customer selection dialog
// ============================================================================
// Opened when the cashier clicks the "Walk-in" badge in the cart summary.
// Searches customers by name / phone and attaches one to the cart so
// credit sales can be processed.
// ============================================================================

import { useState, useEffect, useRef } from "react";
import { Search, X, User, Phone, CreditCard, CheckCircle2 } from "lucide-react";

import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input }  from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import { useCustomerSearch } from "./usePos";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export function CustomerSearchBar({ open, onOpenChange, activeCustomer, onSelect, onClear }) {
  const [search, setSearch]     = useState("");
  const [debSearch, setDeb]     = useState("");
  const inputRef                = useRef(null);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDeb(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Refocus on open
  useEffect(() => {
    if (open) {
      setSearch("");
      setDeb("");
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  const { customers, isLoading } = useCustomerSearch(debSearch);

  function handleSelect(c) {
    onSelect(c);
    onOpenChange(false);
  }

  function handleClear() {
    onClear();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-card border-border gap-0">
        {/* Colour bar */}
        <div className="h-[3px] w-full bg-primary" />

        <DialogHeader className="px-5 pt-4 pb-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold leading-tight">Select Customer</DialogTitle>
              <DialogDescription className="text-[11px] mt-0.5">
                Search by name or phone number
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 pt-4 pb-2 space-y-3">
          {/* Search input */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Name, phone number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-[12px] bg-background/60"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Active customer strip */}
          {activeCustomer && (
            <div className="flex items-center justify-between rounded-lg border border-primary/25 bg-primary/8 px-3 py-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-[11px] font-semibold text-primary">
                  {activeCustomer.first_name ?? activeCustomer.name} {activeCustomer.last_name ?? ""}
                </span>
              </div>
              <button
                onClick={handleClear}
                className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
              >
                Remove
              </button>
            </div>
          )}
        </div>

        {/* Results list */}
        <div className="mx-5 mb-5 rounded-lg border border-border overflow-hidden">
          {/* Walk-in option always at top */}
          <button
            onClick={handleClear}
            className={cn(
              "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
              "border-b border-border/40 hover:bg-muted/30",
              !activeCustomer && "bg-muted/20"
            )}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/30">
              <User className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-[12px] font-semibold text-foreground">Walk-in Customer</p>
              <p className="text-[10px] text-muted-foreground">No account — cash / card sales only</p>
            </div>
            {!activeCustomer && (
              <CheckCircle2 className="ml-auto h-4 w-4 text-primary shrink-0" />
            )}
          </button>

          {/* Search results */}
          {debSearch.length >= 1 && (
            <>
              {isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : customers.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-[11px] text-muted-foreground">No customers found</p>
                </div>
              ) : (
                <div className="max-h-56 overflow-auto divide-y divide-border/40">
                  {customers.map((c) => {
                    const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.name || "—";
                    const isSelected = activeCustomer?.id === c.id;
                    const creditPct = c.credit_limit > 0
                      ? Math.round(((c.credit_limit - (c.outstanding_balance ?? 0)) / c.credit_limit) * 100)
                      : null;

                    return (
                      <button
                        key={c.id}
                        onClick={() => handleSelect(c)}
                        className={cn(
                          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30",
                          isSelected && "bg-primary/8"
                        )}
                      >
                        {/* Avatar */}
                        <div className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold uppercase",
                          isSelected
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-muted/30 text-muted-foreground"
                        )}>
                          {name.slice(0, 2)}
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-foreground truncate">{name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {c.phone && (
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Phone className="h-2.5 w-2.5" />
                                {c.phone}
                              </span>
                            )}
                            {c.credit_enabled && creditPct !== null && (
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <CreditCard className="h-2.5 w-2.5" />
                                {formatCurrency(c.credit_limit - (c.outstanding_balance ?? 0))} credit
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Credit badge */}
                        {c.credit_enabled && (
                          <Badge variant="outline" className="shrink-0 text-[9px] h-5 border-primary/30 text-primary">
                            Credit
                          </Badge>
                        )}

                        {isSelected && (
                          <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {debSearch.length === 0 && !isLoading && (
            <div className="py-4 text-center">
              <p className="text-[11px] text-muted-foreground">Type to search customers</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
