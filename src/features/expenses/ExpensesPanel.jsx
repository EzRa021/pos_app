// ============================================================================
// features/expenses/ExpensesPanel.jsx  — Redesigned
// ============================================================================
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Receipt, Plus, Edit3, Trash2, ThumbsUp, ThumbsDown,
  X, Search, AlertTriangle, CheckCircle2, Clock, Ban,
  TrendingDown, Layers, Wallet, BadgePercent,
} from "lucide-react";
import { toast } from "sonner";

import { useExpenses, useExpenseSummary } from "./useExpenses";
import { useBranchStore } from "@/stores/branch.store";
import { PageHeader }        from "@/components/shared/PageHeader";
import { DataTable }         from "@/components/shared/DataTable";
import { EmptyState }        from "@/components/shared/EmptyState";
import { DateRangePicker }   from "@/components/shared/DateRangePicker";
import { Button }            from "@/components/ui/button";
import { Input }             from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn }            from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format";
import { usePermission }       from "@/hooks/usePermission";
import { usePaginationParams } from "@/hooks/usePaginationParams";

// ── Constants ─────────────────────────────────────────────────────────────────

const APPROVAL_TABS = [
  { key: "",         label: "All"      },
  { key: "pending",  label: "Pending"  },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

const EXPENSE_TYPES = [
  "operational", "capital", "salary", "utilities", "rent", "maintenance",
  "marketing", "transport", "supplies", "miscellaneous",
];

const PAYMENT_METHODS = [
  { value: "cash",         label: "Cash"          },
  { value: "card",         label: "Card"          },
  { value: "transfer",     label: "Bank Transfer" },
  { value: "mobile_money", label: "Mobile Money"  },
  { value: "cheque",       label: "Cheque"        },
];

const APPROVAL_STYLES = {
  approved: {
    cls:  "bg-success/10 text-success border-success/20",
    icon: CheckCircle2,
  },
  pending: {
    cls:  "bg-warning/10 text-warning border-warning/20",
    icon: Clock,
  },
  rejected: {
    cls:  "bg-destructive/10 text-destructive border-destructive/20",
    icon: Ban,
  },
};

// Breakdown bar accent colors — cycle through a small palette
const BREAKDOWN_COLORS = [
  "bg-primary",
  "bg-success",
  "bg-warning",
  "bg-destructive",
  "bg-violet-500",
  "bg-cyan-500",
];

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent = "default", icon: Icon }) {
  const styles = {
    default:     { wrap: "border-border/60 bg-card",                    icon: "bg-muted/40 text-muted-foreground",    val: "text-foreground"      },
    primary:     { wrap: "border-primary/20 bg-primary/[0.04]",         icon: "bg-primary/12 text-primary",           val: "text-primary"         },
    success:     { wrap: "border-success/20 bg-success/[0.04]",         icon: "bg-success/12 text-success",           val: "text-success"         },
    warning:     { wrap: "border-warning/20 bg-warning/[0.04]",         icon: "bg-warning/12 text-warning",           val: "text-warning"         },
    muted:       { wrap: "border-border/60 bg-muted/20",                icon: "bg-muted/40 text-muted-foreground",    val: "text-muted-foreground"},
  }[accent];

  return (
    <div className={cn(
      "relative flex flex-col gap-3 rounded-xl border px-4 py-4 overflow-hidden",
      "transition-all duration-200 hover:shadow-md hover:-translate-y-0.5",
      styles.wrap,
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", styles.icon)}>
          {Icon && <Icon className="h-4 w-4" />}
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className={cn("text-2xl font-bold tabular-nums leading-none tracking-tight", styles.val)}>
          {value}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">
          {label}
        </span>
        {sub && <span className="text-[11px] text-muted-foreground mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

// ── Approval Badge ────────────────────────────────────────────────────────────
function ApprovalBadge({ status }) {
  const s = APPROVAL_STYLES[status] ?? APPROVAL_STYLES.pending;
  const Icon = s.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5",
      "text-[10px] font-semibold uppercase tracking-wide",
      s.cls,
    )}>
      <Icon className="h-2.5 w-2.5 shrink-0" />
      {status ?? "pending"}
    </span>
  );
}

// ── Status Tab Bar ────────────────────────────────────────────────────────────
function TabBar({ active, onChange, counts }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-1 border border-border/50">
      {APPROVAL_TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold",
              "transition-all duration-150 select-none",
              isActive
                ? "bg-card text-foreground shadow-sm border border-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-card/50",
            )}
          >
            {tab.label}
            <span className={cn(
              "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1",
              "text-[10px] font-bold tabular-nums transition-colors",
              isActive ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground",
            )}>
              {(counts[tab.key] ?? 0).toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Breakdown Bar ─────────────────────────────────────────────────────────────
function BreakdownBar({ label, amount, total, colorClass }) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground capitalize truncate">{label ?? "Other"}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground tabular-nums">{pct.toFixed(1)}%</span>
          <span className="text-xs font-mono font-bold tabular-nums text-foreground">
            {formatCurrency(amount)}
          </span>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", colorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Expense Form Dialog ───────────────────────────────────────────────────────
const PAYMENT_STATUSES = [
  { value: "paid",    label: "Paid"    },
  { value: "pending", label: "Unpaid / Pending" },
];

const BLANK_FORM = {
  category: "", expense_type: "", description: "", amount: "",
  paid_to: "", payment_method: "cash", payment_status: "paid",
  reference_number: "",
  expense_date: new Date().toISOString().slice(0, 10),
  is_recurring: false, is_deductible: true, notes: "",
};

function ExpenseFormDialog({ open, onOpenChange, editing, onCreate, onUpdate }) {
  const [form,   setForm]   = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  const handleOpenChange = useCallback((val) => {
    if (val) {
      setForm(editing ? {
        category:         editing.category            ?? "",
        expense_type:     editing.expense_type        ?? "",
        description:      editing.description         ?? "",
        amount:           String(parseFloat(editing.amount ?? 0)),
        paid_to:          editing.paid_to             ?? "",
        payment_method:   editing.payment_method      ?? "cash",
        payment_status:   editing.payment_status      ?? "paid",
        reference_number: editing.reference_number    ?? "",
        expense_date:     editing.expense_date
          ? new Date(editing.expense_date).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10),
        is_recurring:     editing.is_recurring  ?? false,
        is_deductible:    editing.is_deductible ?? true,
        notes:            editing.notes         ?? "",
      } : BLANK_FORM);
    }
    if (!val) setSaving(false);
    onOpenChange(val);
  }, [editing, onOpenChange]);

  const set      = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));
  const setCheck = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.checked }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.description.trim()) { toast.error("Description is required."); return; }
    if (!form.category.trim())    { toast.error("Category is required."); return; }
    if (!(parseFloat(form.amount) > 0)) { toast.error("Enter a valid amount."); return; }

    setSaving(true);
    const payload = {
      category:         form.category.trim(),
      expense_type:     form.expense_type       || undefined,
      description:      form.description.trim(),
      amount:           parseFloat(form.amount),
      paid_to:          form.paid_to.trim()     || undefined,
      payment_method:   form.payment_method,
      payment_status:   form.payment_status,
      reference_number: form.reference_number.trim() || undefined,
      expense_date:     form.expense_date       || undefined,
      is_recurring:     form.is_recurring,
      is_deductible:    form.is_deductible,
      notes:            form.notes.trim()       || undefined,
    };

    try {
      if (editing) await onUpdate({ id: editing.id, ...payload });
      else         await onCreate(payload);
      toast.success(editing ? "Expense updated." : "Expense recorded.");
      handleOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="h-[3px] w-full shrink-0 bg-gradient-to-r from-primary/80 via-primary to-primary/80" />
        <div className="p-5 pb-4 overflow-y-auto flex-1">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
              {editing ? <Edit3 className="h-5 w-5 text-primary" /> : <Receipt className="h-5 w-5 text-primary" />}
            </div>
            <div>
              <DialogTitle className="text-[14px] font-bold leading-tight">
                {editing ? "Edit Expense" : "Record Expense"}
              </DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                {editing ? editing.description : "Add a new business expense to the ledger"}
              </DialogDescription>
            </div>
          </div>

          <form id="expense-form" onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground block">
                  Category <span className="text-destructive">*</span>
                </label>
                <Input value={form.category} onChange={set("category")} className="h-8 text-xs" placeholder="e.g. Office Supplies" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground block">Type</label>
                <select
                  value={form.expense_type}
                  onChange={set("expense_type")}
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">— Select type —</option>
                  {EXPENSE_TYPES.map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground block">
                Description <span className="text-destructive">*</span>
              </label>
              <Input value={form.description} onChange={set("description")} className="h-8 text-xs" placeholder="What was this expense for?" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground block">
                  Amount (₦) <span className="text-destructive">*</span>
                </label>
                <Input value={form.amount} onChange={set("amount")} type="number" min="0" step="0.01" className="h-8 text-xs" placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground block">Date</label>
                <Input value={form.expense_date} onChange={set("expense_date")} type="date" className="h-8 text-xs" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground block">Payment Method</label>
                <select
                  value={form.payment_method}
                  onChange={set("payment_method")}
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground block">Payment Status</label>
                <select
                  value={form.payment_status}
                  onChange={set("payment_status")}
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {PAYMENT_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground block">Paid To</label>
              <Input value={form.paid_to} onChange={set("paid_to")} className="h-8 text-xs" placeholder="Vendor / person name" />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground block">Reference / Receipt #</label>
              <Input value={form.reference_number} onChange={set("reference_number")} className="h-8 text-xs" placeholder="e.g. INV-2024-001" />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground block">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                placeholder="Additional details…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/20 px-3.5 py-2.5 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={form.is_deductible} onChange={setCheck("is_deductible")}
                  className="h-3.5 w-3.5 mt-0.5 rounded border-border accent-primary shrink-0" />
                <div>
                  <span className="text-xs font-medium text-foreground">Tax Deductible</span>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    Mark if this expense can be deducted from taxable income (e.g. rent, utilities, salaries). Tracked in the deductible total on the summary.
                  </p>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={form.is_recurring} onChange={setCheck("is_recurring")}
                  className="h-3.5 w-3.5 rounded border-border accent-primary" />
                <span className="text-xs text-foreground">Recurring expense</span>
              </label>
            </div>
          </form>
        </div>

        <DialogFooter className="shrink-0 px-5 py-3.5 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={saving} className="text-xs">
            Cancel
          </Button>
          <Button type="submit" form="expense-form" size="sm" disabled={saving} className="text-xs">
            {saving ? "Saving…" : editing ? "Save Changes" : "Record Expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail Dialog ─────────────────────────────────────────────────────────────
function DetailRow({ label, children }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-border/40 last:border-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-28 shrink-0 mt-0.5">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function ExpenseDetailDialog({ expense, open, onOpenChange, canApprove, canCreate, onApprove, onReject, onEdit }) {
  const [acting, setActing] = useState(null); // "approve" | "reject"
  if (!expense) return null;
  const isPending = (expense.approval_status ?? "pending") === "pending";
  const s = APPROVAL_STYLES[expense.approval_status] ?? APPROVAL_STYLES.pending;

  const doAction = async (type) => {
    setActing(type);
    try {
      if (type === "approve") await onApprove(expense.id);
      else await onReject(expense.id);
      toast.success(type === "approve" ? "Expense approved." : "Expense rejected.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Action failed.");
    } finally { setActing(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col">
        <div className={cn("h-[3px] w-full shrink-0", {
          "bg-success":     expense.approval_status === "approved",
          "bg-warning":     expense.approval_status === "pending" || !expense.approval_status,
          "bg-destructive": expense.approval_status === "rejected",
        })} />
        <div className="p-5 flex-1 overflow-y-auto">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
              <Receipt className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-[14px] font-bold leading-tight truncate">{expense.description}</DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                {formatDate(expense.expense_date)} · {expense.category}
              </DialogDescription>
            </div>
            <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0", s.cls)}>
              <s.icon className="h-2.5 w-2.5" />
              {expense.approval_status ?? "pending"}
            </span>
          </div>

          <div className="divide-y divide-border/40">
            <DetailRow label="Amount">
              <span className="text-sm font-mono font-bold tabular-nums text-foreground">
                {formatCurrency(parseFloat(expense.amount))}
              </span>
            </DetailRow>
            <DetailRow label="Date">
              <span className="text-xs text-foreground">{formatDate(expense.expense_date)}</span>
            </DetailRow>
            <DetailRow label="Category">
              <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {expense.category}
              </span>
            </DetailRow>
            {expense.expense_type && (
              <DetailRow label="Type">
                <span className="text-xs text-foreground capitalize">{expense.expense_type}</span>
              </DetailRow>
            )}
            <DetailRow label="Payment">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center rounded-md border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {expense.payment_method?.replace("_", " ")}
                </span>
                <span className={cn(
                  "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  expense.payment_status === "paid"
                    ? "border-success/20 bg-success/10 text-success"
                    : "border-warning/20 bg-warning/10 text-warning"
                )}>
                  {expense.payment_status === "paid" ? "Paid" : "Unpaid"}
                </span>
              </div>
            </DetailRow>
            {expense.paid_to && (
              <DetailRow label="Paid To">
                <span className="text-xs text-foreground">{expense.paid_to}</span>
              </DetailRow>
            )}
            {expense.reference_number && (
              <DetailRow label="Reference">
                <span className="text-xs font-mono text-foreground">{expense.reference_number}</span>
              </DetailRow>
            )}
            <DetailRow label="Flags">
              <div className="flex items-center gap-2 flex-wrap">
                {expense.is_deductible && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-success/20 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                    <BadgePercent className="h-2.5 w-2.5" /> Tax Deductible
                  </span>
                )}
                {expense.is_recurring && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    Recurring
                  </span>
                )}
                {!expense.is_deductible && !expense.is_recurring && (
                  <span className="text-xs text-muted-foreground/50">None</span>
                )}
              </div>
            </DetailRow>
            {expense.notes && (
              <DetailRow label="Notes">
                <p className="text-xs text-muted-foreground leading-relaxed">{expense.notes}</p>
              </DetailRow>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 px-5 py-3.5 border-t border-border bg-muted/10 gap-2 flex-wrap">
          {canApprove && isPending && (
            <>
              <Button size="sm" onClick={() => doAction("reject")} disabled={!!acting}
                className="text-xs flex-1 bg-destructive hover:bg-destructive/90 text-white">
                {acting === "reject" ? "Rejecting…" : "Reject"}
              </Button>
              <Button size="sm" onClick={() => doAction("approve")} disabled={!!acting}
                className="text-xs flex-1 bg-success hover:bg-success/90 text-white">
                {acting === "approve" ? "Approving…" : "Approve"}
              </Button>
            </>
          )}
          {canCreate && (
            <Button variant="outline" size="sm" className="text-xs" onClick={() => { onOpenChange(false); onEdit(expense); }}>
              <Edit3 className="h-3 w-3 mr-1" /> Edit
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Dialog ─────────────────────────────────────────────────────────────
function DeleteDialog({ open, onOpenChange, expense, onConfirm }) {
  const [busy, setBusy] = useState(false);
  if (!expense) return null;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm(expense.id);
      toast.success("Expense deleted.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Delete failed.");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-gradient-to-r from-destructive/80 via-destructive to-destructive/80" />
        <div className="p-6 space-y-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/8">
              <Trash2 className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <DialogTitle className="text-[14px] font-bold">Delete Expense?</DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground mt-0.5 max-w-[200px] truncate">
                {expense.description}
              </DialogDescription>
            </div>
          </div>
          <div className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/6 px-3.5 py-3">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-[11px] text-destructive leading-relaxed">
              This expense record will be <span className="font-bold">permanently removed</span> and cannot be recovered.
            </p>
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs flex-1">Cancel</Button>
          <Button variant="destructive" size="sm" onClick={handleConfirm} disabled={busy} className="text-xs flex-1">
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export function ExpensesPanel() {
  const canCreate  = usePermission("expenses.create");
  const canApprove = usePermission("expenses.approve");
  const canDelete  = usePermission("expenses.delete");

  const { page, search, setPage, setSearch } = usePaginationParams({ defaultPageSize: 25 });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [approvalTab,  setApprovalTab]  = useState("");
  const [dateFrom,     setDateFrom]     = useState("");
  const [dateTo,       setDateTo]       = useState("");
  const [formOpen,      setFormOpen]     = useState(false);
  const [editing,       setEditing]      = useState(null);
  const [deleteTarget,  setDeleteTarget] = useState(null);
  const [detailTarget,  setDetailTarget] = useState(null);

  const debounceTimer = useRef(null);
  const handleSearchChange = useCallback((e) => {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedSearch(val), 300);
  }, [setSearch]);

  useEffect(() => { setDebouncedSearch(search); }, []); // init once

  const storeId = useBranchStore((s) => s.activeStore?.id);

  const {
    expenses, total, isLoading, isFetching,
    create, update, approve, reject, remove,
  } = useExpenses({
    search:         debouncedSearch || undefined,
    approvalStatus: approvalTab     || undefined,
    dateFrom:       dateFrom        || undefined,
    dateTo:         dateTo          || undefined,
    page,
    limit: 25,
  });

  const { summary, breakdownList } = useExpenseSummary(dateFrom, dateTo);

  const hasFilters = search || approvalTab || dateFrom || dateTo;
  const clearFilters = useCallback(() => {
    setSearch(""); setDebouncedSearch("");
    setApprovalTab(""); setDateFrom(""); setDateTo("");
  }, [setSearch]);

  // Per-status counts
  const { data: pendingData }  = useQuery({ queryKey: ["expenses", storeId, { approvalStatus: "pending",  page: 1, limit: 1 }], queryFn: () => import("@/commands/expenses").then(m => m.getExpenses({ store_id: storeId, approval_status: "pending",  page: 1, limit: 1 })), enabled: !!storeId, staleTime: 60_000 });
  const { data: approvedData } = useQuery({ queryKey: ["expenses", storeId, { approvalStatus: "approved", page: 1, limit: 1 }], queryFn: () => import("@/commands/expenses").then(m => m.getExpenses({ store_id: storeId, approval_status: "approved", page: 1, limit: 1 })), enabled: !!storeId, staleTime: 60_000 });
  const { data: rejectedData } = useQuery({ queryKey: ["expenses", storeId, { approvalStatus: "rejected", page: 1, limit: 1 }], queryFn: () => import("@/commands/expenses").then(m => m.getExpenses({ store_id: storeId, approval_status: "rejected", page: 1, limit: 1 })), enabled: !!storeId, staleTime: 60_000 });

  const counts = useMemo(() => ({
    "":       total,
    pending:  pendingData?.total  ?? 0,
    approved: approvedData?.total ?? 0,
    rejected: rejectedData?.total ?? 0,
  }), [total, pendingData, approvedData, rejectedData]);

  const totalBreakdown = useMemo(() =>
    breakdownList.reduce((s, b) => s + parseFloat(b.total_amount ?? 0), 0),
  [breakdownList]);

  const openCreate = useCallback(() => { setEditing(null); setFormOpen(true); }, []);
  const openEdit   = useCallback((row) => { setEditing(row); setFormOpen(true); }, []);
  const openDetail = useCallback((row) => setDetailTarget(row), []);

  const handleApprove = async (id) => {
    try { await approve.mutateAsync(id); toast.success("Expense approved."); }
    catch (err) { toast.error(err?.message ?? "Failed to approve."); }
  };

  const handleReject = async (id) => {
    try { await reject.mutateAsync(id); toast.success("Expense rejected."); }
    catch (err) { toast.error(err?.message ?? "Failed to reject."); }
  };

  const columns = useMemo(() => [
    {
      key: "expense_date",
      header: "Date",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(row.expense_date)}
        </span>
      ),
    },
    {
      key: "description",
      header: "Description",
      render: (row) => (
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground leading-snug">{row.description}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
              {row.category}
            </span>
            {row.expense_type && (
              <span className="text-[10px] text-muted-foreground/60 capitalize">{row.expense_type}</span>
            )}
            {row.is_deductible && (
              <span title="Tax Deductible" className="flex h-4 w-4 items-center justify-center rounded-full bg-success/15 text-[8px] font-bold text-success shrink-0">D</span>
            )}
            {row.is_recurring && (
              <span title="Recurring" className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[8px] font-bold text-primary shrink-0">R</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "paid_to",
      header: "Paid To",
      render: (row) => row.paid_to
        ? <span className="text-xs text-foreground">{row.paid_to}</span>
        : <span className="text-xs text-muted-foreground/40">—</span>,
    },
    {
      key: "payment_method",
      header: "Method",
      render: (row) => (
        <span className="inline-flex items-center rounded-md border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
          {row.payment_method?.replace("_", " ")}
        </span>
      ),
    },
    {
      key:      "amount",
      header:   "Amount",
      align:    "right",
      sortable: true,
      render: (row) => (
        <span className="text-sm font-mono font-bold tabular-nums text-foreground whitespace-nowrap">
          {formatCurrency(parseFloat(row.amount))}
        </span>
      ),
    },
    {
      key:    "approval_status",
      header: "Status",
      render: (row) => (
        <div className="flex flex-col gap-1">
          <ApprovalBadge status={row.approval_status ?? "pending"} />
          {row.payment_status === "pending" && (
            <span className="inline-flex items-center gap-1 rounded-md border border-warning/20 bg-warning/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning whitespace-nowrap">
              Unpaid
            </span>
          )}
        </div>
      ),
    },
    {
      key:    "actions",
      header: "",
      align:  "right",
      render: (row) => {
        const isPending = (row.approval_status ?? "pending") === "pending";
        return (
          <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
            {canCreate && (
              <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted" title="Edit"
                onClick={() => openEdit(row)}>
                <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
            {canApprove && isPending && (
              <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-success/10" title="Approve"
                onClick={() => handleApprove(row.id)}>
                <ThumbsUp className="h-3.5 w-3.5 text-success" />
              </Button>
            )}
            {canApprove && isPending && (
              <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10" title="Reject"
                onClick={() => handleReject(row.id)}>
                <ThumbsDown className="h-3.5 w-3.5 text-destructive" />
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10" title="Delete"
                onClick={() => setDeleteTarget(row)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive/70 hover:text-destructive" />
              </Button>
            )}
          </div>
        );
      },
    },
  ], [canCreate, canApprove, canDelete, openEdit]);

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Track and manage business expenses with approval workflow."
        action={canCreate && (
          <Button size="sm" onClick={openCreate} className="gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" />
            Record Expense
          </Button>
        )}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">

          {/* ── Stat cards ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Total Approved"
              value={formatCurrency(parseFloat(summary?.total_amount ?? 0))}
              sub={`${summary?.expense_count ?? 0} approved records`}
              accent="primary"
              icon={TrendingDown}
            />
            <StatCard
              label="Paid Out"
              value={formatCurrency(parseFloat(summary?.paid_amount ?? 0))}
              sub="cash disbursed"
              accent="default"
              icon={Wallet}
            />
            <StatCard
              label="Unpaid Expenses"
              value={formatCurrency(parseFloat(summary?.pending_amount ?? 0))}
              sub="payment status: pending"
              accent={parseFloat(summary?.pending_amount ?? 0) > 0 ? "warning" : "muted"}
              icon={Clock}
            />
            <StatCard
              label="Tax Deductible"
              value={formatCurrency(parseFloat(summary?.deductible_amount ?? 0))}
              sub="deductible total"
              accent="success"
              icon={BadgePercent}
            />
          </div>

          {/* ── Breakdown strip ──────────────────────────────────────────── */}
          {breakdownList.length > 0 && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-muted/10">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/60">
                  <Layers className="h-3 w-3 text-muted-foreground" />
                </div>
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Breakdown by Type
                </h2>
                {(dateFrom || dateTo) && (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {dateFrom && dateTo
                      ? `${formatDate(dateFrom)} – ${formatDate(dateTo)}`
                      : dateFrom ? `From ${formatDate(dateFrom)}` : `To ${formatDate(dateTo)}`}
                  </span>
                )}
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-8 gap-y-4">
                  {breakdownList.map((b, idx) => (
                    <BreakdownBar
                      key={b.expense_type ?? "other"}
                      label={b.expense_type ?? "Other"}
                      amount={parseFloat(b.total_amount)}
                      total={totalBreakdown}
                      colorClass={BREAKDOWN_COLORS[idx % BREAKDOWN_COLORS.length]}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Full-width table ─────────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            {/* Section header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/10">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                  <Receipt className="h-3.5 w-3.5 text-primary" />
                </div>
                <h2 className="text-sm font-semibold text-foreground">Expense Records</h2>
                {total > 0 && (
                  <span className="text-[10px] font-semibold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 tabular-nums">
                    {total.toLocaleString()} records
                  </span>
                )}
              </div>
              {isFetching && !isLoading && (
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="text-[10px] text-muted-foreground">Refreshing</span>
                </div>
              )}
            </div>

            {/* Filter bar */}
            <div className="px-5 pt-4 pb-0">
              <div className="flex flex-col gap-3 pb-4 border-b border-border/50">
                {/* Row 1: search + date range picker + clear */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Search */}
                  <div className="relative flex-1 min-w-[180px] max-w-xs">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      value={search}
                      onChange={handleSearchChange}
                      placeholder="Search description, category, paid to…"
                      className="pl-8 h-8 text-xs bg-muted/30 border-border/60 focus:bg-background"
                    />
                    {search && (
                      <button
                        onClick={() => { setSearch(""); setDebouncedSearch(""); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  {/* shadcn calendar date range picker */}
                  <DateRangePicker
                    from={dateFrom}
                    to={dateTo}
                    onFromChange={(v) => { setDateFrom(v); setPage(1); }}
                    onToChange={(v)   => { setDateTo(v);   setPage(1); }}
                    onClear={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
                  />

                  {/* Clear all filters */}
                  {hasFilters && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={clearFilters}
                      className="h-8 gap-1.5 text-muted-foreground hover:text-foreground text-xs"
                    >
                      <X className="h-3 w-3" />
                      Clear all
                    </Button>
                  )}
                </div>

                {/* Row 2: status tabs */}
                <div>
                  <TabBar
                    active={approvalTab}
                    onChange={(v) => { setApprovalTab(v); setPage(1); }}
                    counts={counts}
                  />
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="px-5 pb-5 pt-4">
              <DataTable
                columns={columns}
                data={expenses}
                isLoading={isLoading}
                onRowClick={openDetail}
                pagination={{ page, pageSize: 25, total, onPageChange: setPage }}
                emptyState={
                  <EmptyState
                    icon={Receipt}
                    title={hasFilters ? "No matching expenses" : "No expenses recorded yet"}
                    description={
                      hasFilters
                        ? "Try adjusting your filters or clearing the search."
                        : "Start tracking your business expenses."
                    }
                    action={!hasFilters && canCreate && (
                      <Button size="sm" onClick={openCreate} className="gap-1.5 text-xs">
                        <Plus className="h-3.5 w-3.5" />
                        Record Expense
                      </Button>
                    )}
                    compact
                  />
                }
              />
            </div>
          </div>

          {/* ── Legend ─────────────────────────────────────────────────── */}
          {expenses.length > 0 && (
            <div className="flex flex-wrap items-center gap-5 px-1 text-[11px] text-muted-foreground/70">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-success" />
                <span>Approved</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-warning" />
                <span>Pending</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Ban className="h-3 w-3 text-destructive" />
                <span>Rejected</span>
              </div>
              <div className="flex items-center gap-1.5 ml-1">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success/15 text-[8px] font-bold text-success">D</span>
                <span>Tax Deductible</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[8px] font-bold text-primary">R</span>
                <span>Recurring</span>
              </div>
            </div>
          )}

        </div>
      </div>

      <ExpenseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onCreate={(p) => create.mutateAsync(p)}
        onUpdate={(p) => update.mutateAsync(p)}
      />

      <ExpenseDetailDialog
        expense={detailTarget}
        open={!!detailTarget}
        onOpenChange={(v) => !v && setDetailTarget(null)}
        canApprove={canApprove}
        canCreate={canCreate}
        onApprove={(id) => approve.mutateAsync(id)}
        onReject={(id) => reject.mutateAsync(id)}
        onEdit={(row) => { setDetailTarget(null); openEdit(row); }}
      />

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        expense={deleteTarget}
        onConfirm={(id) => remove.mutateAsync(id)}
      />
    </>
  );
}
