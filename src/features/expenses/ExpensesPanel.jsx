// ============================================================================
// features/expenses/ExpensesPanel.jsx
// ============================================================================
import { useState, useMemo, useCallback } from "react";
import {
  Receipt, Plus, Edit3, Trash2, ThumbsUp, ThumbsDown,
  Calendar, X, AlertTriangle, CheckCircle2, Clock, Ban,
  DollarSign, TrendingDown, Tag,
} from "lucide-react";
import { toast } from "sonner";

import { useExpenses, useExpenseSummary } from "./useExpenses";
import { PageHeader }    from "@/components/shared/PageHeader";
import { DataTable }     from "@/components/shared/DataTable";
import { EmptyState }    from "@/components/shared/EmptyState";
import { Button }        from "@/components/ui/button";
import { Input }         from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn }            from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format";
import { usePermission } from "@/hooks/usePermission";

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
  approved: { cls: "bg-success/10 text-success border-success/20",             icon: CheckCircle2 },
  pending:  { cls: "bg-warning/10 text-warning border-warning/20",             icon: Clock        },
  rejected: { cls: "bg-destructive/10 text-destructive border-destructive/20", icon: Ban          },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Section({ title, action, children }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function StatCard({ label, value, sub, accent = "default" }) {
  const ring = {
    default: "border-border/60   bg-card",
    primary: "border-primary/25  bg-primary/[0.06]",
    success: "border-success/25  bg-success/[0.06]",
    warning: "border-warning/25  bg-warning/[0.06]",
    muted:   "border-border/60   bg-muted/30",
  }[accent];
  const val = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    muted:   "text-muted-foreground",
  }[accent];
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-4 py-3.5", ring)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function ApprovalBadge({ status }) {
  const s = APPROVAL_STYLES[status] ?? APPROVAL_STYLES.pending;
  const Icon = s.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
      s.cls,
    )}>
      <Icon className="h-2.5 w-2.5" />
      {status ?? "pending"}
    </span>
  );
}

function StatusTabs({ active, onChange, counts }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60">
      {APPROVAL_TABS.map((tab) => (
        <button key={tab.key} onClick={() => onChange(tab.key)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all duration-150",
            active === tab.key
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}>
          {tab.label}
          <span className={cn(
            "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
            active === tab.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}>
            {counts[tab.key] ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Expense Form Dialog ───────────────────────────────────────────────────────

const BLANK_FORM = {
  category: "", expense_type: "", description: "", amount: "",
  paid_to: "", payment_method: "cash", reference_number: "",
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
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-primary" />
        <div className="p-6 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              {editing ? <Edit3 className="h-5 w-5 text-primary" /> : <Receipt className="h-5 w-5 text-primary" />}
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                {editing ? "Edit Expense" : "Record Expense"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {editing ? editing.description : "Add a new business expense"}
              </DialogDescription>
            </div>
          </div>

          <form id="expense-form" onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Category <span className="text-destructive">*</span>
                </label>
                <Input value={form.category} onChange={set("category")} className="h-8 text-sm" placeholder="e.g. Office Supplies" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Type</label>
                <select value={form.expense_type} onChange={set("expense_type")}
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="">— Select type —</option>
                  {EXPENSE_TYPES.map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Description <span className="text-destructive">*</span>
              </label>
              <Input value={form.description} onChange={set("description")} className="h-8 text-sm" placeholder="What was this expense for?" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Amount (₦) <span className="text-destructive">*</span>
                </label>
                <Input value={form.amount} onChange={set("amount")} type="number" min="0" step="0.01" className="h-8 text-sm" placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Date</label>
                <Input value={form.expense_date} onChange={set("expense_date")} type="date" className="h-8 text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payment Method</label>
                <select value={form.payment_method} onChange={set("payment_method")}
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Paid To</label>
                <Input value={form.paid_to} onChange={set("paid_to")} className="h-8 text-sm" placeholder="Vendor / person name" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reference / Receipt #</label>
              <Input value={form.reference_number} onChange={set("reference_number")} className="h-8 text-sm" placeholder="e.g. INV-2024-001" />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                placeholder="Additional details…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            {/* Toggles */}
            <div className="flex items-center gap-6 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_deductible} onChange={setCheck("is_deductible")}
                  className="h-3.5 w-3.5 rounded border-border accent-primary" />
                <span className="text-xs text-foreground">Tax Deductible</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_recurring} onChange={setCheck("is_recurring")}
                  className="h-3.5 w-3.5 rounded border-border accent-primary" />
                <span className="text-xs text-foreground">Recurring</span>
              </label>
            </div>
          </form>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form="expense-form" size="sm" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save Changes" : "Record Expense"}
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-destructive" />
        <div className="p-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
              <Trash2 className="h-4 w-4 text-destructive" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold">Delete Expense?</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">
                {expense.description}
              </DialogDescription>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-[11px] text-destructive leading-relaxed">
              This expense record will be <span className="font-bold">permanently removed</span>.
            </p>
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={handleConfirm} disabled={busy} className="flex-1">
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Breakdown mini chart ──────────────────────────────────────────────────────

function BreakdownBar({ label, amount, total }) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-foreground capitalize">{label ?? "Other"}</span>
        <span className="font-mono text-muted-foreground">{formatCurrency(amount)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[9px] text-muted-foreground text-right">{pct.toFixed(1)}%</div>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export function ExpensesPanel() {
  const canCreate  = usePermission("expenses.create");
  const canApprove = usePermission("expenses.approve");
  const canDelete  = usePermission("expenses.delete");

  const [approvalTab,  setApprovalTab]  = useState("");
  const [dateFrom,     setDateFrom]     = useState("");
  const [dateTo,       setDateTo]       = useState("");
  const [page,         setPage]         = useState(1);
  const [formOpen,     setFormOpen]     = useState(false);
  const [editing,      setEditing]      = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const {
    expenses, total, isLoading, isFetching,
    create, update, approve, reject, remove,
  } = useExpenses({
    approvalStatus: approvalTab || undefined,
    dateFrom:       dateFrom    || undefined,
    dateTo:         dateTo      || undefined,
    page,
    limit: 25,
  });

  const { summary, breakdownList } = useExpenseSummary(dateFrom, dateTo);

  const hasFilters = approvalTab || dateFrom || dateTo;
  const clearFilters = useCallback(() => {
    setApprovalTab(""); setDateFrom(""); setDateTo(""); setPage(1);
  }, []);

  // Counts for tabs (from current page data)
  const counts = useMemo(() => {
    const base = { "": total };
    APPROVAL_TABS.slice(1).forEach((t) => {
      base[t.key] = expenses.filter((e) => (e.approval_status ?? "pending") === t.key).length;
    });
    return base;
  }, [expenses, total]);

  const totalBreakdown = useMemo(() =>
    breakdownList.reduce((s, b) => s + parseFloat(b.total_amount ?? 0), 0),
  [breakdownList]);

  const openCreate = useCallback(() => { setEditing(null); setFormOpen(true); }, []);
  const openEdit   = useCallback((row) => { setEditing(row); setFormOpen(true); }, []);

  const handleApprove = async (id) => {
    try {
      await approve.mutateAsync(id);
      toast.success("Expense approved.");
    } catch (err) {
      toast.error(err?.message ?? "Failed to approve.");
    }
  };

  const handleReject = async (id) => {
    try {
      await reject.mutateAsync(id);
      toast.success("Expense rejected.");
    } catch (err) {
      toast.error(err?.message ?? "Failed to reject.");
    }
  };

  const columns = useMemo(() => [
    {
      key:    "expense_date",
      header: "Date",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatDate(row.expense_date)}</span>
      ),
    },
    {
      key:    "description",
      header: "Description",
      render: (row) => (
        <div>
          <p className="text-xs font-semibold text-foreground truncate max-w-[200px]">{row.description}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground uppercase">
              {row.category}
            </span>
            {row.expense_type && (
              <span className="text-[9px] text-muted-foreground/60">{row.expense_type}</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key:    "paid_to",
      header: "Paid To",
      render: (row) => row.paid_to ? (
        <span className="text-xs text-muted-foreground">{row.paid_to}</span>
      ) : (
        <span className="text-xs text-muted-foreground/30">—</span>
      ),
    },
    {
      key:    "payment_method",
      header: "Method",
      render: (row) => (
        <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase">
          {row.payment_method}
        </span>
      ),
    },
    {
      key:    "amount",
      header: "Amount",
      align:  "right",
      sortable: true,
      render: (row) => (
        <span className="text-sm font-mono font-bold tabular-nums text-foreground">
          {formatCurrency(parseFloat(row.amount))}
        </span>
      ),
    },
    {
      key:    "approval_status",
      header: "Approval",
      render: (row) => <ApprovalBadge status={row.approval_status ?? "pending"} />,
    },
    {
      key:    "flags",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          {row.is_deductible && (
            <span title="Tax Deductible"
              className="flex h-4 w-4 items-center justify-center rounded-full bg-success/15 text-[8px] font-bold text-success">D</span>
          )}
          {row.is_recurring && (
            <span title="Recurring"
              className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[8px] font-bold text-primary">R</span>
          )}
        </div>
      ),
    },
    {
      key:    "actions",
      header: "",
      align:  "right",
      render: (row) => {
        const isPending  = (row.approval_status ?? "pending") === "pending";
        const isApproved = row.approval_status === "approved";
        return (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {/* Edit (only pending) */}
            {canCreate && isPending && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit"
                onClick={() => openEdit(row)}>
                <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
            {/* Approve */}
            {canApprove && isPending && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Approve"
                onClick={() => handleApprove(row.id)}>
                <ThumbsUp className="h-3.5 w-3.5 text-success" />
              </Button>
            )}
            {/* Reject */}
            {canApprove && isPending && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Reject"
                onClick={() => handleReject(row.id)}>
                <ThumbsDown className="h-3.5 w-3.5 text-destructive" />
              </Button>
            )}
            {/* Delete */}
            {canDelete && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete"
                onClick={() => setDeleteTarget(row)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
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
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Record Expense
          </Button>
        )}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-5 space-y-5">

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="Total Expenses"
              value={formatCurrency(parseFloat(summary?.total_amount ?? 0))}
              sub={`${summary?.expense_count ?? 0} approved records`}
              accent="primary"
            />
            <StatCard
              label="Paid Out"
              value={formatCurrency(parseFloat(summary?.paid_amount ?? 0))}
              sub="cash disbursed"
              accent="default"
            />
            <StatCard
              label="Pending Payment"
              value={formatCurrency(parseFloat(summary?.pending_amount ?? 0))}
              sub="not yet paid"
              accent={parseFloat(summary?.pending_amount ?? 0) > 0 ? "warning" : "muted"}
            />
            <StatCard
              label="Deductible"
              value={formatCurrency(parseFloat(summary?.deductible_amount ?? 0))}
              sub="tax-deductible total"
              accent="success"
            />
          </div>

          <div className="grid grid-cols-3 gap-5">
            {/* Main table — 2/3 */}
            <div className="col-span-2">
              <Section
                title="Expense Records"
                action={
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3 text-muted-foreground shrink-0" />
                      <Input type="date" value={dateFrom}
                        onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                        className="h-7 w-32 text-[11px]" />
                      <span className="text-[11px] text-muted-foreground">–</span>
                      <Input type="date" value={dateTo}
                        onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                        className="h-7 w-32 text-[11px]" />
                    </div>
                    {hasFilters && (
                      <button onClick={clearFilters}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                        <X className="h-3 w-3" />Clear
                      </button>
                    )}
                    <StatusTabs active={approvalTab} onChange={(v) => { setApprovalTab(v); setPage(1); }} counts={counts} />
                  </div>
                }
              >
                <DataTable
                  columns={columns}
                  data={expenses}
                  isLoading={isLoading || isFetching}
                  pagination={{ page, pageSize: 25, total, onPageChange: setPage }}
                  emptyState={
                    <EmptyState
                      icon={Receipt}
                      title="No expenses found"
                      description={hasFilters ? "Try clearing the filters." : "Record your first expense to get started."}
                      action={!hasFilters && canCreate && (
                        <Button size="sm" onClick={openCreate}>
                          <Plus className="h-3.5 w-3.5 mr-1.5" />
                          Record Expense
                        </Button>
                      )}
                    />
                  }
                />
              </Section>
            </div>

            {/* Sidebar — 1/3 */}
            <div className="space-y-5">
              {/* Breakdown by type */}
              <Section title="By Type">
                {breakdownList.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No data yet</p>
                ) : (
                  <div className="space-y-4">
                    {breakdownList.map((b) => (
                      <BreakdownBar
                        key={b.expense_type ?? "other"}
                        label={b.expense_type}
                        amount={parseFloat(b.total_amount)}
                        total={totalBreakdown}
                      />
                    ))}
                  </div>
                )}
              </Section>

              {/* Legend */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Legend</p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success/15 text-[8px] font-bold text-success">D</span>
                    Tax Deductible
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[8px] font-bold text-primary">R</span>
                    Recurring
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <ThumbsUp className="h-3 w-3 text-success" />Approve
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <ThumbsDown className="h-3 w-3 text-destructive" />Reject
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Edit3 className="h-3 w-3" />Edit
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Trash2 className="h-3 w-3 text-destructive" />Delete
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <ExpenseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onCreate={(p) => create.mutateAsync(p)}
        onUpdate={(p) => update.mutateAsync(p)}
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
