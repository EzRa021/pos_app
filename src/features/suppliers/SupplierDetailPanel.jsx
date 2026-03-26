// ============================================================================
// features/suppliers/SupplierDetailPanel.jsx — Supplier detail + analytics
// ============================================================================
import { useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Truck, Phone, Mail, MapPin, Building2, FileText,
  Edit3, Power, PowerOff, AlertTriangle, ChevronLeft,
  Package, ShoppingCart, CheckCircle2, Clock, ArrowUpRight,
  Banknote, Plus, Loader2, TrendingUp, BarChart3, Timer,
  XCircle, Activity,
} from "lucide-react";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";

import {
  useSupplier, useSupplierPurchaseOrders,
  useSupplierPayments, useSupplierSpendTimeline,
} from "./useSuppliers";
import { PageHeader }    from "@/components/shared/PageHeader";
import { StatusBadge }   from "@/components/shared/StatusBadge";
import { Spinner }       from "@/components/shared/Spinner";
import { EmptyState }    from "@/components/shared/EmptyState";
import { DataTable }     from "@/components/shared/DataTable";
import { Button }        from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input }         from "@/components/ui/input";
import { cn }            from "@/lib/utils";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { usePermission } from "@/hooks/usePermission";

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children, className, action }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-2.5 px-5 py-3.5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2.5">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Row({ label, value, mono = false, valueClass }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-xs font-medium text-right break-all", mono && "font-mono tabular-nums", valueClass)}>
        {value ?? "—"}
      </span>
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
    amber:   "border-amber-500/25 bg-amber-500/[0.06]",
  }[accent];
  const val = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    muted:   "text-muted-foreground",
    amber:   "text-amber-400",
  }[accent];
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-4 py-3.5", ring)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ── PO status badge ───────────────────────────────────────────────────────────

const PO_STATUS_STYLES = {
  pending:   "bg-warning/10 text-warning border-warning/20",
  approved:  "bg-primary/10 text-primary border-primary/20",
  received:  "bg-success/10 text-success border-success/20",
  cancelled: "bg-muted/50 text-muted-foreground border-border/60",
  partial:   "bg-primary/10 text-primary border-primary/20",
};

function POStatusBadge({ status }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
      PO_STATUS_STYLES[status] ?? PO_STATUS_STYLES.pending,
    )}>
      {status ?? "—"}
    </span>
  );
}

// ── Analytics section ─────────────────────────────────────────────────────────

function formatMonth(yyyyMM) {
  const [y, m] = yyyyMM.split("-");
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleString("default", { month: "short", year: "2-digit" });
}

// Custom tooltip for the spend bar chart
function SpendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card/95 backdrop-blur-sm px-3 py-2.5 shadow-xl text-[11px]">
      <p className="font-bold text-foreground mb-1">{formatMonth(label)}</p>
      <p className="text-primary font-mono">{formatCurrency(d.total)}</p>
      <p className="text-muted-foreground mt-0.5">{d.order_count} order{d.order_count !== 1 ? "s" : ""}</p>
    </div>
  );
}

function AnalyticsSection({ supplierId, stats }) {
  const { timeline, isLoading } = useSupplierSpendTimeline(supplierId);

  const leadTime = stats?.avg_lead_time_days;
  const leadTimeDisplay = leadTime != null
    ? `${parseFloat(leadTime).toFixed(1)} days`
    : "—";

  const leadTimeAccent =
    leadTime == null ? "muted" :
    parseFloat(leadTime) <= 3  ? "success" :
    parseFloat(leadTime) <= 7  ? "primary" :
    parseFloat(leadTime) <= 14 ? "warning"  : "amber";

  // Color the bars: highlight the highest month
  const maxTotal = Math.max(...timeline.map((r) => parseFloat(r.total)), 0);

  return (
    <Section title="Analytics" icon={Activity}>
      <div className="space-y-5">

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Avg Lead Time"
            value={leadTimeDisplay}
            sub="ordered → received"
            accent={leadTimeAccent}
          />
          <StatCard
            label="Completed POs"
            value={stats?.completed_orders ?? 0}
            sub="received in full"
            accent="success"
          />
          <StatCard
            label="Cancelled POs"
            value={stats?.cancelled_orders ?? 0}
            sub="across all time"
            accent={stats?.cancelled_orders > 0 ? "warning" : "muted"}
          />
        </div>

        {/* PO status breakdown bar */}
        {stats && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              PO breakdown
            </p>
            {(() => {
              const total = stats.total_orders || 1;
              const segments = [
                { label: "Received",  count: stats.completed_orders, color: "bg-success"   },
                { label: "Pending",   count: stats.pending_orders,   color: "bg-primary"   },
                { label: "Cancelled", count: stats.cancelled_orders, color: "bg-warning"   },
              ].filter((s) => s.count > 0);

              return (
                <div className="space-y-2">
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full gap-0.5">
                    {segments.map((s) => (
                      <div
                        key={s.label}
                        className={cn("h-full rounded-full transition-all", s.color)}
                        style={{ width: `${(s.count / total) * 100}%` }}
                        title={`${s.label}: ${s.count}`}
                      />
                    ))}
                    {stats.total_orders === 0 && (
                      <div className="h-full w-full rounded-full bg-muted/40" />
                    )}
                  </div>
                  <div className="flex gap-4">
                    {segments.map((s) => (
                      <div key={s.label} className="flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", s.color)} />
                        <span className="text-[10px] text-muted-foreground">
                          {s.label} <span className="font-semibold text-foreground">{s.count}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Spend over time chart */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Spend over time — last 13 months
          </p>
          {isLoading ? (
            <div className="h-44 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : timeline.length === 0 ? (
            <div className="h-32 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60">
              <BarChart3 className="h-6 w-6 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No purchase orders in the last 13 months</p>
            </div>
          ) : (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={timeline}
                  margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                  barCategoryGap="30%"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="hsl(var(--border))"
                    opacity={0.5}
                  />
                  <XAxis
                    dataKey="month"
                    tickFormatter={formatMonth}
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={(v) =>
                      v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` :
                      v >= 1_000     ? `${(v / 1_000).toFixed(0)}k` : String(v)
                    }
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip content={<SpendTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                  <Bar dataKey="total" radius={[3, 3, 0, 0]}>
                    {timeline.map((entry) => {
                      const isMax = parseFloat(entry.total) === maxTotal && maxTotal > 0;
                      return (
                        <Cell
                          key={entry.month}
                          fill={isMax ? "hsl(var(--primary))" : "hsl(var(--primary)/0.35)"}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

// ── Purchase Orders sub-panel ─────────────────────────────────────────────────

function PurchaseOrderHistory({ supplierId }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const { orders, total, isLoading } = useSupplierPurchaseOrders(supplierId, { page, limit: 10 });

  const columns = useMemo(() => [
    {
      key:    "po_number",
      header: "PO #",
      render: (row) => (
        <span className="font-mono text-xs text-primary font-semibold">{row.po_number}</span>
      ),
    },
    {
      key:    "status",
      header: "Status",
      render: (row) => <POStatusBadge status={row.status} />,
    },
    {
      key:    "total_amount",
      header: "Total",
      align:  "right",
      render: (row) => (
        <span className="text-xs font-mono tabular-nums font-semibold">
          {formatCurrency(parseFloat(row.total_amount))}
        </span>
      ),
    },
    {
      key:    "ordered_at",
      header: "Ordered",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatDate(row.ordered_at)}</span>
      ),
    },
    {
      key:    "received_at",
      header: "Received",
      render: (row) => row.received_at ? (
        <span className="flex items-center gap-1 text-xs text-success">
          <CheckCircle2 className="h-3 w-3 shrink-0" />
          {formatDate(row.received_at)}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3 shrink-0" />
          Pending
        </span>
      ),
    },
    {
      key:    "view",
      header: "",
      align:  "right",
      render: (row) => (
        <Button variant="ghost" size="icon" className="h-7 w-7"
          onClick={(e) => { e.stopPropagation(); navigate(`/purchase-orders/${row.id}`); }}>
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      ),
    },
  ], [navigate]);

  return (
    <DataTable
      columns={columns}
      data={orders}
      isLoading={isLoading}
      onRowClick={(row) => navigate(`/purchase-orders/${row.id}`)}
      pagination={{ page, pageSize: 10, total, onPageChange: setPage }}
      emptyState={
        <EmptyState
          icon={ShoppingCart}
          title="No purchase orders"
          description="Purchase orders from this supplier will appear here."
        />
      }
    />
  );
}

// ── Edit Supplier Dialog ──────────────────────────────────────────────────────

const PAYMENT_TERMS_OPTIONS = ["Net 7", "Net 15", "Net 30", "Net 60", "Net 90", "Cash on Delivery", "Prepaid"];

function EditSupplierDialog({ open, onOpenChange, supplier, onUpdate }) {
  const [form,   setForm]   = useState({});
  const [saving, setSaving] = useState(false);

  const handleOpenChange = (val) => {
    if (val && supplier) {
      setForm({
        supplier_name:  supplier.supplier_name  ?? "",
        contact_name:   supplier.contact_name   ?? "",
        phone:          supplier.phone          ?? "",
        email:          supplier.email          ?? "",
        address:        supplier.address        ?? "",
        city:           supplier.city           ?? "",
        tax_id:         supplier.tax_id         ?? "",
        payment_terms:  supplier.payment_terms  ?? "Net 30",
        credit_limit:   supplier.credit_limit != null ? String(parseFloat(supplier.credit_limit)) : "",
      });
    }
    if (!val) setSaving(false);
    onOpenChange(val);
  };

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.supplier_name.trim()) { toast.error("Supplier name is required."); return; }
    setSaving(true);
    try {
      await onUpdate({
        supplier_name: form.supplier_name.trim(),
        contact_name:  form.contact_name.trim()  || undefined,
        phone:         form.phone.trim()         || undefined,
        email:         form.email.trim()         || undefined,
        address:       form.address.trim()       || undefined,
        city:          form.city.trim()          || undefined,
        tax_id:        form.tax_id.trim()        || undefined,
        payment_terms: form.payment_terms        || undefined,
        credit_limit:  form.credit_limit ? parseFloat(form.credit_limit) : undefined,
      });
      toast.success("Supplier updated.");
      handleOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-primary" />
        <div className="p-6 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <Edit3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Edit Supplier</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {supplier?.supplier_name}
              </DialogDescription>
            </div>
          </div>
          <form id="edit-supplier-form" onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Supplier Name <span className="text-destructive">*</span>
              </label>
              <Input value={form.supplier_name ?? ""} onChange={set("supplier_name")} className="h-8 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Contact Person</label>
                <Input value={form.contact_name ?? ""} onChange={set("contact_name")} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Phone</label>
                <Input value={form.phone ?? ""} onChange={set("phone")} className="h-8 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Email</label>
                <Input value={form.email ?? ""} onChange={set("email")} type="email" className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">City</label>
                <Input value={form.city ?? ""} onChange={set("city")} className="h-8 text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Address</label>
              <Input value={form.address ?? ""} onChange={set("address")} className="h-8 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tax ID / RC</label>
                <Input value={form.tax_id ?? ""} onChange={set("tax_id")} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payment Terms</label>
                <select value={form.payment_terms ?? "Net 30"} onChange={set("payment_terms")}
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                  {PAYMENT_TERMS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Credit Limit (₦)</label>
              <Input value={form.credit_limit ?? ""} onChange={set("credit_limit")} type="number" min="0" step="1000" className="h-8 text-sm" />
            </div>
          </form>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form="edit-supplier-form" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Record Payment Dialog ─────────────────────────────────────────────────────

const PAYMENT_METHOD_OPTIONS = ["bank_transfer", "cash", "cheque", "card", "mobile_money"];
const PAYMENT_METHOD_LABELS  = {
  bank_transfer: "Bank Transfer", cash: "Cash",
  cheque: "Cheque", card: "Card", mobile_money: "Mobile Money",
};

function RecordPaymentDialog({ open, onOpenChange, supplierName, onRecord }) {
  const [amount,  setAmount]  = useState("");
  const [method,  setMethod]  = useState("bank_transfer");
  const [ref,     setRef]     = useState("");
  const [notes,   setNotes]   = useState("");
  const [busy,    setBusy]    = useState(false);

  const reset = () => { setAmount(""); setMethod("bank_transfer"); setRef(""); setNotes(""); };

  const handleSave = async () => {
    const amt = parseFloat(amount);
    if (!(amt > 0)) { toast.error("Enter a valid payment amount."); return; }
    setBusy(true);
    try {
      await onRecord({
        amount:         amt,
        payment_method: method,
        reference:      ref   || undefined,
        notes:          notes || undefined,
      });
      toast.success(`${formatCurrency(amt)} payment recorded.`);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Failed to record payment.");
    } finally {
      setBusy(false);
    }
  };

  const handleOpenChange = (val) => { if (!val) reset(); onOpenChange(val); };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-success" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-success/25 bg-success/10">
              <Banknote className="h-5 w-5 text-success" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Record Payment</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {supplierName}
              </DialogDescription>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Amount (₦) <span className="text-destructive">*</span>
            </label>
            <Input type="number" min="0" step="100" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00" className="h-8 text-sm" autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Payment Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              {PAYMENT_METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Reference / Receipt #</label>
            <Input value={ref} onChange={(e) => setRef(e.target.value)}
              placeholder="Bank teller, cheque number…" className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy}
            className="bg-success hover:bg-success/90 text-white gap-1.5">
            {busy
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
              : <><Banknote className="h-3.5 w-3.5" />Record Payment</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Payments sub-panel ────────────────────────────────────────────────────────

function SupplierPaymentsSection({ supplierId, supplierName, canManage }) {
  const [payOpen, setPayOpen] = useState(false);
  const { balance, payments, isLoading, record } = useSupplierPayments(supplierId);

  const totalPaid    = parseFloat(balance?.total_paid      ?? 0);
  const totalPoValue = parseFloat(balance?.total_po_value  ?? 0);
  const outstanding  = parseFloat(balance?.current_balance ?? 0);

  const columns = useMemo(() => [
    {
      key:    "payment_method",
      header: "Method",
      render: (row) => (
        <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
          {PAYMENT_METHOD_LABELS[row.payment_method] ?? row.payment_method ?? "—"}
        </span>
      ),
    },
    {
      key:    "amount",
      header: "Amount",
      align:  "right",
      render: (row) => (
        <span className="text-xs font-mono tabular-nums font-bold text-success">
          {formatCurrency(parseFloat(row.amount ?? 0))}
        </span>
      ),
    },
    {
      key:    "reference",
      header: "Reference",
      render: (row) => (
        <span className="text-xs font-mono text-muted-foreground">{row.reference ?? "—"}</span>
      ),
    },
    {
      key:    "notes",
      header: "Notes",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{row.notes ?? "—"}</span>
      ),
    },
    {
      key:    "created_at",
      header: "Date",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</span>
      ),
    },
  ], []);

  return (
    <>
      <Section
        title="Payments"
        icon={Banknote}
        action={canManage && (
          <Button size="sm" onClick={() => setPayOpen(true)}
            className="h-7 gap-1 bg-success hover:bg-success/90 text-white text-xs px-2.5">
            <Plus className="h-3 w-3" />Record Payment
          </Button>
        )}
      >
        {/* Balance hero */}
        <div className={cn(
          "rounded-xl border-2 px-5 py-4 mb-4",
          outstanding > 0 ? "border-warning/30 bg-warning/5" : "border-border bg-muted/10",
        )}>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Outstanding</p>
              <p className={cn("text-xl font-bold tabular-nums mt-1",
                outstanding > 0 ? "text-warning" : "text-muted-foreground")}>
                {formatCurrency(outstanding)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Paid</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-success">{formatCurrency(totalPaid)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total PO Value</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-foreground">{formatCurrency(totalPoValue)}</p>
            </div>
          </div>
        </div>

        {/* Payment history */}
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Payment History</p>
        <DataTable
          columns={columns}
          data={payments}
          isLoading={isLoading}
          emptyState={
            <EmptyState
              icon={Banknote}
              title="No payments recorded"
              description="Payments made to this supplier will appear here."
              compact
            />
          }
        />
      </Section>

      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        supplierName={supplierName}
        onRecord={(p) => record.mutateAsync(p)}
      />
    </>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export function SupplierDetailPanel() {
  const { id }       = useParams();
  const navigate     = useNavigate();
  const canManage    = usePermission("suppliers.update");
  const supplierId   = parseInt(id, 10);

  const [editOpen,   setEditOpen]   = useState(false);
  const [toggleOpen, setToggleOpen] = useState(false);

  const { supplier, stats, isLoading, error, update, activate, deactivate } = useSupplier(supplierId);

  if (isLoading) return <Spinner />;
  if (error || !supplier) return (
    <div className="flex flex-1 items-center justify-center gap-3">
      <AlertTriangle className="h-5 w-5 text-destructive" />
      <span className="text-sm text-destructive">{error?.message ?? "Supplier not found."}</span>
    </div>
  );

  const isActivating = !supplier.is_active;
  const creditLimit  = parseFloat(supplier.credit_limit  ?? 0);
  const balance      = parseFloat(supplier.current_balance ?? 0);

  const handleToggle = async () => {
    try {
      if (supplier.is_active) await deactivate.mutateAsync();
      else                    await activate.mutateAsync();
      toast.success(supplier.is_active ? "Supplier deactivated." : "Supplier activated.");
      setToggleOpen(false);
    } catch (err) {
      toast.error(err?.message ?? "Action failed.");
    }
  };

  return (
    <>
      <PageHeader
        title={supplier.supplier_name}
        description={
          <span className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">{supplier.supplier_code}</span>
            <StatusBadge status={supplier.is_active ? "active" : "inactive"} />
          </span>
        }
        action={canManage && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setToggleOpen(true)}>
              {supplier.is_active
                ? <><PowerOff className="h-3.5 w-3.5 mr-1.5 text-warning" />Deactivate</>
                : <><Power    className="h-3.5 w-3.5 mr-1.5 text-success" />Activate</>}
            </Button>
            <Button size="sm" onClick={() => setEditOpen(true)}>
              <Edit3 className="h-3.5 w-3.5 mr-1.5" />Edit
            </Button>
          </div>
        )}
      >
        <Link
          to="/suppliers"
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Back to Suppliers
        </Link>
      </PageHeader>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* KPI cards */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="Total Orders"
              value={stats?.total_orders ?? 0}
              sub="purchase orders placed"
              accent="primary"
            />
            <StatCard
              label="Completed"
              value={stats?.completed_orders ?? 0}
              sub="received in full"
              accent="success"
            />
            <StatCard
              label="Pending"
              value={stats?.pending_orders ?? 0}
              sub="awaiting delivery"
              accent={stats?.pending_orders > 0 ? "warning" : "muted"}
            />
            <StatCard
              label="Total Spent"
              value={formatCurrency(parseFloat(stats?.total_spent ?? 0))}
              sub={stats?.avg_order_value ? `avg ${formatCurrency(parseFloat(stats.avg_order_value))}` : ""}
              accent="default"
            />
          </div>

          <div className="grid grid-cols-3 gap-5">
            {/* Left — Supplier Info + Payment & Credit */}
            <div className="space-y-5">
              <Section title="Supplier Info" icon={Truck}>
                <Row label="Supplier Code" value={supplier.supplier_code} mono />
                {supplier.contact_name && <Row label="Contact" value={supplier.contact_name} />}
                {supplier.phone && (
                  <Row label="Phone" value={
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" />{supplier.phone}
                    </span>
                  } />
                )}
                {supplier.email && (
                  <Row label="Email" value={
                    <span className="flex items-center gap-1 break-all">
                      <Mail className="h-3 w-3 shrink-0" />{supplier.email}
                    </span>
                  } />
                )}
                {supplier.city && (
                  <Row label="City" value={
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" />{supplier.city}
                    </span>
                  } />
                )}
                {supplier.address && <Row label="Address" value={supplier.address} />}
                {supplier.tax_id  && <Row label="Tax ID / RC" value={supplier.tax_id} mono />}
                <Row label="Added" value={formatDate(supplier.created_at)} />
              </Section>

              <Section title="Payment & Credit" icon={FileText}>
                <Row label="Payment Terms" value={
                  <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {supplier.payment_terms ?? "Net 30"}
                  </span>
                } />
                <Row
                  label="Credit Limit"
                  value={formatCurrency(creditLimit)}
                  mono
                  valueClass="text-foreground"
                />
                <Row
                  label="Outstanding Balance"
                  value={formatCurrency(balance)}
                  mono
                  valueClass={balance > 0 ? "text-warning" : "text-muted-foreground"}
                />
                {creditLimit > 0 && (
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Credit used</span>
                      <span>{Math.min(100, Math.round((balance / creditLimit) * 100))}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          balance / creditLimit > 0.8 ? "bg-destructive" :
                          balance / creditLimit > 0.5 ? "bg-warning" : "bg-success",
                        )}
                        style={{ width: `${Math.min(100, (balance / creditLimit) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </Section>
            </div>

            {/* Right col — PO History */}
            <div className="col-span-2">
              <Section
                title="Purchase Order History"
                icon={Package}
                action={
                  <span className="text-[10px] text-muted-foreground">
                    Click a row to view items
                  </span>
                }
              >
                <PurchaseOrderHistory supplierId={supplierId} />
              </Section>
            </div>
          </div>

          {/* Analytics — full width */}
          <AnalyticsSection supplierId={supplierId} stats={stats} />

          {/* Payments — full width */}
          <SupplierPaymentsSection
            supplierId={supplierId}
            supplierName={supplier.supplier_name}
            canManage={canManage}
          />

        </div>
      </div>

      {/* Edit Dialog */}
      <EditSupplierDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        supplier={supplier}
        onUpdate={(p) => update.mutateAsync(p)}
      />

      {/* Toggle Status Dialog */}
      <Dialog open={toggleOpen} onOpenChange={setToggleOpen}>
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
          <div className={cn("h-[3px] w-full", isActivating ? "bg-success" : "bg-warning")} />
          <div className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg border",
                isActivating ? "border-success/25 bg-success/10" : "border-warning/25 bg-warning/10",
              )}>
                {isActivating
                  ? <Power    className="h-4 w-4 text-success" />
                  : <PowerOff className="h-4 w-4 text-warning" />}
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold">
                  {isActivating ? "Activate Supplier?" : "Deactivate Supplier?"}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {supplier.supplier_name}
                </DialogDescription>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {isActivating
                ? "This supplier will be available for new purchase orders."
                : "This supplier will be hidden from purchase orders and searches."}
            </p>
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
            <Button variant="outline" size="sm" onClick={() => setToggleOpen(false)}>Keep</Button>
            <Button
              size="sm"
              className={cn("flex-1 text-white",
                isActivating ? "bg-success hover:bg-success/90" : "bg-warning/90 hover:bg-warning"
              )}
              onClick={handleToggle}
              disabled={activate.isPending || deactivate.isPending}
            >
              {isActivating ? "Activate" : "Deactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
