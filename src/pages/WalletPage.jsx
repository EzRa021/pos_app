// ============================================================================
// pages/WalletPage.jsx — Customer Wallet Management
// ============================================================================
// Shows all customers with their prepaid wallet balances.
// Supports quick-deposit directly from this page and links through to the
// full customer detail page for history and adjustment.
// ============================================================================

import { useState, useMemo } from "react";
import { useQuery }          from "@tanstack/react-query";
import { useNavigate }       from "react-router-dom";
import {
  Wallet, Plus, Search, ArrowUpRight, Loader2,
  Users, TrendingUp, DollarSign, SlidersHorizontal,
} from "lucide-react";
import { toast }         from "sonner";

import { PageHeader }    from "@/components/shared/PageHeader";
import { EmptyState }    from "@/components/shared/EmptyState";
import { DataTable }     from "@/components/shared/DataTable";
import { Button }        from "@/components/ui/button";
import { Input }         from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn }            from "@/lib/utils";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useBranchStore }  from "@/stores/branch.store";
import { useWalletActions } from "@/features/wallet/useWallet";
import { getCustomers }     from "@/commands/customers";

// ── Quick Deposit Dialog ──────────────────────────────────────────────────────

function QuickDepositDialog({ open, onOpenChange, customer }) {
  const [amount,    setAmount]    = useState("");
  const [reference, setReference] = useState("");
  const [notes,     setNotes]     = useState("");

  const storeId    = useBranchStore((s) => s.activeStore?.id);
  const customerId = customer?.id;
  const { deposit } = useWalletActions(customerId);

  async function handleSave() {
    const amt = parseFloat(amount);
    if (!(amt > 0)) { toast.error("Enter a valid amount."); return; }
    try {
      await deposit.mutateAsync({
        amount:    amt,
        store_id:  storeId,
        reference: reference.trim() || undefined,
        notes:     notes.trim()     || undefined,
      });
      toast.success(`${formatCurrency(amt)} deposited to ${customer?.first_name}'s wallet.`);
      setAmount(""); setReference(""); setNotes("");
      onOpenChange(false);
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Deposit failed. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-success" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-success/25 bg-success/10">
              <Plus className="h-5 w-5 text-success" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Deposit to Wallet</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {customer ? `${customer.first_name} ${customer.last_name}` : ""}
              </DialogDescription>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current Balance</p>
            <p className="text-sm font-bold text-foreground tabular-nums">
              {formatCurrency(parseFloat(customer?.wallet_balance ?? 0))}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Amount <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₦</span>
              <Input
                type="number" min="0" step="100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                placeholder="0.00"
                className="pl-7 h-9 text-sm"
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reference</label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Receipt or payment reference"
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              className="h-9 text-sm"
            />
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={deposit.isPending || !amount || parseFloat(amount) <= 0}
            className="bg-success hover:bg-success/90 text-white gap-1.5"
          >
            {deposit.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
              : <><Plus className="h-3.5 w-3.5" />Deposit</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, accent = "default" }) {
  const ring = {
    default: "border-border/60 bg-card",
    success: "border-success/25 bg-success/5",
    primary: "border-primary/25 bg-primary/5",
    warning: "border-warning/25 bg-warning/5",
  }[accent];
  const val = {
    default: "text-foreground",
    success: "text-success",
    primary: "text-primary",
    warning: "text-warning",
  }[accent];
  return (
    <div className={cn("rounded-xl border px-5 py-4", ring)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn("h-4 w-4 opacity-30", val)} />}
      </div>
      <p className={cn("text-2xl font-bold tabular-nums", val)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WalletPage() {
  const navigate = useNavigate();
  const storeId  = useBranchStore((s) => s.activeStore?.id);

  const [search,        setSearch]        = useState("");
  const [depositTarget, setDepositTarget] = useState(null); // customer to deposit to
  const [showAll,       setShowAll]       = useState(false); // show all or wallet-only

  // Load customers — uses the existing customers RPC, no new backend needed
  const { data: raw, isLoading } = useQuery({
    queryKey:  ["wallet-customers", storeId, search, showAll],
    queryFn:   () => getCustomers({
      store_id:   storeId,
      search:     search || undefined,
      is_active:  true,
      page:       1,
      limit:      200,
    }),
    enabled:   !!storeId,
    staleTime: 30_000,
  });

  const allCustomers = useMemo(() => {
    const list = Array.isArray(raw) ? raw : (raw?.data ?? []);
    if (showAll) return list;
    // Default: only show customers who have a wallet balance > 0 or have used the wallet
    return list.filter((c) => parseFloat(c.wallet_balance ?? 0) > 0);
  }, [raw, showAll]);

  // Summary stats
  const stats = useMemo(() => {
    const all = Array.isArray(raw) ? raw : (raw?.data ?? []);
    const totalBalance    = all.reduce((s, c) => s + parseFloat(c.wallet_balance ?? 0), 0);
    const activeWallets   = all.filter((c) => parseFloat(c.wallet_balance ?? 0) > 0).length;
    const totalCustomers  = all.length;
    return { totalBalance, activeWallets, totalCustomers };
  }, [raw]);

  const columns = useMemo(() => [
    {
      key:    "name",
      header: "Customer",
      render: (row) => {
        const name = [row.first_name, row.last_name].filter(Boolean).join(" ");
        const initials = name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
        return (
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-[10px] font-bold text-primary">
              {initials}
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">{name}</p>
              {row.phone && <p className="text-[10px] text-muted-foreground">{row.phone}</p>}
            </div>
          </div>
        );
      },
    },
    {
      key:    "wallet_balance",
      header: "Wallet Balance",
      align:  "right",
      sortable: true,
      render: (row) => {
        const bal = parseFloat(row.wallet_balance ?? 0);
        return (
          <span className={cn(
            "text-sm font-bold tabular-nums font-mono",
            bal > 0 ? "text-success" : "text-muted-foreground",
          )}>
            {formatCurrency(bal)}
          </span>
        );
      },
    },
    {
      key:    "outstanding_balance",
      header: "Outstanding",
      align:  "right",
      render: (row) => {
        const amt = parseFloat(row.outstanding_balance ?? 0);
        return (
          <span className={cn(
            "text-xs tabular-nums font-mono",
            amt > 0 ? "text-warning font-semibold" : "text-muted-foreground",
          )}>
            {amt > 0 ? formatCurrency(amt) : "—"}
          </span>
        );
      },
    },
    {
      key:    "loyalty_points",
      header: "Loyalty Pts",
      align:  "right",
      render: (row) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {(row.loyalty_points ?? 0).toLocaleString()}
        </span>
      ),
    },
    {
      key:    "actions",
      header: "",
      align:  "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-[11px] border-success/40 text-success hover:bg-success/10 hover:border-success"
            onClick={(e) => { e.stopPropagation(); setDepositTarget(row); }}
          >
            <Plus className="h-3 w-3" />
            Deposit
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={(e) => { e.stopPropagation(); navigate(`/customers/${row.id}`); }}
            title="View customer"
          >
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      ),
    },
  ], [navigate]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Customer Wallets"
        description="Manage prepaid wallet balances. Customers use their wallet balance to pay at checkout."
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label="Total Wallet Funds"
              value={formatCurrency(stats.totalBalance)}
              sub="across all customers"
              icon={Wallet}
              accent="success"
            />
            <StatCard
              label="Active Wallets"
              value={stats.activeWallets.toLocaleString()}
              sub="customers with balance > 0"
              icon={TrendingUp}
              accent="primary"
            />
            <StatCard
              label="Total Customers"
              value={stats.totalCustomers.toLocaleString()}
              sub="active customers"
              icon={Users}
            />
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search customers…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
            <Button
              variant={showAll ? "default" : "outline"}
              size="sm"
              onClick={() => setShowAll((v) => !v)}
              className="gap-1.5 h-8 text-xs"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {showAll ? "Showing All" : "Wallets Only"}
            </Button>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <DataTable
              columns={columns}
              data={allCustomers}
              isLoading={isLoading}
              onRowClick={(row) => navigate(`/customers/${row.id}`)}
              emptyState={
                <EmptyState
                  icon={Wallet}
                  title={showAll ? "No customers found" : "No customers with wallet balance"}
                  description={
                    showAll
                      ? "No active customers match your search."
                      : "Toggle \"Showing All\" to see all customers and make a deposit."
                  }
                />
              }
            />
          </div>

        </div>
      </div>

      {/* Quick deposit dialog */}
      <QuickDepositDialog
        open={!!depositTarget}
        onOpenChange={(open) => !open && setDepositTarget(null)}
        customer={depositTarget}
      />
    </div>
  );
}
