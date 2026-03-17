// ============================================================================
// features/customers/CustomerDetailPanel.jsx
// ============================================================================
import { useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  User, Phone, Mail, MapPin, CreditCard, Star, Edit3,
  Power, PowerOff, ArrowUpRight, Receipt, TrendingUp,
  Wallet, AlertTriangle, ChevronLeft, Banknote,
} from "lucide-react";
import { toast } from "sonner";

import { useCustomer, useCustomerTransactions } from "./useCustomers";
import { useCreditSales }        from "@/features/credit_sales/useCreditSales";
import { WalletPanel }           from "@/features/wallet/WalletPanel";
import { WalletHistoryTable }    from "@/features/wallet/WalletHistoryTable";
import { LoyaltyBalanceCard }    from "@/features/loyalty/LoyaltyBalanceCard";
import { LoyaltyHistoryTable }   from "@/features/loyalty/LoyaltyHistoryTable";
import { PageHeader }     from "@/components/shared/PageHeader";
import { StatusBadge }    from "@/components/shared/StatusBadge";
import { Spinner }        from "@/components/shared/Spinner";
import { EmptyState }     from "@/components/shared/EmptyState";
import { DataTable }      from "@/components/shared/DataTable";
import { Button }         from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input }          from "@/components/ui/input";
import { cn }             from "@/lib/utils";
import { formatCurrency, formatDateTime, formatDate } from "@/lib/format";
import { usePermission }  from "@/hooks/usePermission";

// ── Helpers ───────────────────────────────────────────────────────────────────

const PAYMENT_LABELS = {
  cash: "Cash", card: "Card", transfer: "Bank Transfer",
  mobile_money: "Mobile Money", credit: "Credit", split: "Split",
};

const PAYMENT_STYLES = {
  cash:         "bg-muted/50 text-muted-foreground border-border/60",
  card:         "bg-primary/10 text-primary border-primary/20",
  transfer:     "bg-primary/10 text-primary border-primary/20",
  mobile_money: "bg-success/10 text-success border-success/20",
  credit:       "bg-warning/10 text-warning border-warning/20",
  split:        "bg-muted/50 text-muted-foreground border-border/60",
};

const TYPE_STYLES = {
  vip:       "bg-warning/10 text-warning border border-warning/20",
  wholesale: "bg-primary/10 text-primary border border-primary/20",
  regular:   "bg-muted/50 text-muted-foreground border border-border/60",
};

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
      <span className={cn("text-xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ── Edit Customer Dialog (inline lightweight version) ─────────────────────────

const INITIAL_FORM = {
  first_name: "", last_name: "", email: "", phone: "",
  address: "", city: "", customer_type: "regular",
  credit_limit: "", credit_enabled: false,
};

function EditCustomerDialog({ open, onOpenChange, customer, onUpdate }) {
  const [form,   setForm]   = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  const handleOpenChange = (val) => {
    if (val && customer) {
      setForm({
        first_name:     customer.first_name    ?? "",
        last_name:      customer.last_name     ?? "",
        email:          customer.email         ?? "",
        phone:          customer.phone         ?? "",
        address:        customer.address       ?? "",
        city:           customer.city          ?? "",
        customer_type:  customer.customer_type ?? "regular",
        credit_limit:   customer.credit_limit != null ? String(parseFloat(customer.credit_limit)) : "",
        credit_enabled: customer.credit_enabled ?? false,
      });
    }
    if (!val) setSaving(false);
    onOpenChange(val);
  };

  const set      = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));
  const setCheck = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.checked }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) {
      toast.error("First name and last name are required.");
      return;
    }
    setSaving(true);
    try {
      await onUpdate({
        first_name:     form.first_name.trim(),
        last_name:      form.last_name.trim(),
        email:          form.email.trim()   || undefined,
        phone:          form.phone.trim()   || undefined,
        address:        form.address.trim() || undefined,
        city:           form.city.trim()    || undefined,
        customer_type:  form.customer_type || "regular",
        credit_limit:   form.credit_limit !== "" ? parseFloat(form.credit_limit) : undefined,
        credit_enabled: form.credit_enabled,
      });
      toast.success("Customer updated.");
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
              <DialogTitle className="text-base font-semibold">Edit Customer</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {customer?.first_name} {customer?.last_name}
              </DialogDescription>
            </div>
          </div>
          <form id="edit-customer-form" onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  First Name <span className="text-destructive">*</span>
                </label>
                <Input value={form.first_name} onChange={set("first_name")} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Last Name <span className="text-destructive">*</span>
                </label>
                <Input value={form.last_name} onChange={set("last_name")} className="h-8 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Phone</label>
                <Input value={form.phone} onChange={set("phone")} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Email</label>
                <Input value={form.email} onChange={set("email")} type="email" className="h-8 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">City</label>
                <Input value={form.city} onChange={set("city")} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Type</label>
                <select value={form.customer_type} onChange={set("customer_type")}
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="regular">Regular</option>
                  <option value="vip">VIP</option>
                  <option value="wholesale">Wholesale</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Address</label>
              <Input value={form.address} onChange={set("address")} className="h-8 text-sm" />
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Credit Settings</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1.5">
                  <label className="text-[11px] text-muted-foreground">Credit Limit (₦)</label>
                  <Input value={form.credit_limit} onChange={set("credit_limit")} type="number" min="0" step="100" className="h-8 text-sm" />
                </div>
                <label className="flex items-center gap-2 mt-4 cursor-pointer">
                  <input type="checkbox" checked={form.credit_enabled} onChange={setCheck("credit_enabled")}
                    className="h-4 w-4 rounded border-border accent-primary" />
                  <span className="text-xs text-foreground">Enable Credit</span>
                </label>
              </div>
            </div>
          </form>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form="edit-customer-form" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Credit status badge ────────────────────────────────────────────────────────

const CREDIT_STATUS_STYLES = {
  outstanding: "bg-warning/10 text-warning border-warning/20",
  partial:     "bg-primary/10 text-primary border-primary/20",
  paid:        "bg-success/10 text-success border-success/20",
  overdue:     "bg-destructive/10 text-destructive border-destructive/20",
  cancelled:   "bg-muted/50 text-muted-foreground border-border/60",
};

function CreditStatusBadge({ status }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
      CREDIT_STATUS_STYLES[status] ?? CREDIT_STATUS_STYLES.outstanding,
    )}>
      {status ?? "—"}
    </span>
  );
}

// ── Credit sales sub-panel ─────────────────────────────────────────────────────

function CustomerCreditSales({ customerId }) {
  const [page, setPage]   = useState(1);
  const { sales, total, isLoading } = useCreditSales({ customerId, page, limit: 8 });

  const columns = useMemo(() => [
    {
      key:    "reference_no",
      header: "Reference",
      render: (row) => (
        <span className="font-mono text-xs text-primary font-semibold">{row.reference_no ?? "—"}</span>
      ),
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
      key:    "amount_paid",
      header: "Paid",
      align:  "right",
      render: (row) => (
        <span className="text-xs font-mono tabular-nums text-success">
          {formatCurrency(parseFloat(row.amount_paid ?? 0))}
        </span>
      ),
    },
    {
      key:    "outstanding",
      header: "Outstanding",
      align:  "right",
      render: (row) => {
        const amt = parseFloat(row.outstanding ?? 0);
        return (
          <span className={cn(
            "text-xs font-mono tabular-nums font-semibold",
            amt > 0 ? "text-warning" : "text-muted-foreground",
          )}>
            {formatCurrency(amt)}
          </span>
        );
      },
    },
    {
      key:    "status",
      header: "Status",
      render: (row) => <CreditStatusBadge status={row.status} />,
    },
    {
      key:    "created_at",
      header: "Date",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatDate(row.created_at)}</span>
      ),
    },
    {
      key:    "view",
      header: "",
      align:  "right",
      render: (row) => (
        <Link
          to="/credit-sales"
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      ),
    },
  ], []);

  return (
    <DataTable
      columns={columns}
      data={sales}
      isLoading={isLoading}
      pagination={{ page, pageSize: 8, total, onPageChange: setPage }}
      emptyState={
        <EmptyState
          icon={CreditCard}
          title="No credit sales"
          description="Credit sales for this customer will appear here."
        />
      }
    />
  );
}

// ── Transaction history sub-panel ─────────────────────────────────────────────

function TransactionHistory({ customerId }) {
  const navigate    = useNavigate();
  const [page, setPage] = useState(1);
  const { items, total, isLoading } = useCustomerTransactions(customerId, { page, limit: 10 });

  const columns = useMemo(() => [
    {
      key: "reference_no",
      header: "Ref #",
      render: (row) => (
        <span className="font-mono text-xs text-primary">{row.reference_no}</span>
      ),
    },
    {
      key: "payment_method",
      header: "Payment",
      render: (row) => (
        <span className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
          PAYMENT_STYLES[row.payment_method] ?? PAYMENT_STYLES.cash,
        )}>
          {PAYMENT_LABELS[row.payment_method] ?? row.payment_method}
        </span>
      ),
    },
    {
      key: "total_amount",
      header: "Total",
      align: "right",
      render: (row) => (
        <span className="font-mono text-xs font-semibold tabular-nums">
          {formatCurrency(parseFloat(row.total_amount))}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "created_at",
      header: "Date",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</span>
      ),
    },
    {
      key: "view",
      header: "",
      align: "right",
      render: (row) => (
        <Button variant="ghost" size="icon" className="h-7 w-7"
          onClick={(e) => { e.stopPropagation(); navigate(`/transactions/${row.id}`); }}>
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      ),
    },
  ], [navigate]);

  return (
    <DataTable
      columns={columns}
      data={items}
      isLoading={isLoading}
      onRowClick={(row) => navigate(`/transactions/${row.id}`)}
      pagination={{ page, pageSize: 10, total, onPageChange: setPage }}
      emptyState={
        <EmptyState
          icon={Receipt}
          title="No transactions"
          description="This customer has no transactions yet."
        />
      }
    />
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export function CustomerDetailPanel() {
  const { id }     = useParams();
  const navigate   = useNavigate();
  const canManage  = usePermission("customers.update");
  const customerId = parseInt(id, 10);

  const [editOpen,   setEditOpen]   = useState(false);
  const [toggleOpen, setToggleOpen] = useState(false);

  const { customer, stats, isLoading, error, update, activate, deactivate } = useCustomer(customerId);

  if (isLoading) return <Spinner />;
  if (error || !customer) return (
    <div className="flex flex-1 items-center justify-center gap-3">
      <AlertTriangle className="h-5 w-5 text-destructive" />
      <span className="text-sm text-destructive">{error?.message ?? "Customer not found."}</span>
    </div>
  );

  const fullName    = `${customer.first_name} ${customer.last_name}`;
  const customerType = customer.customer_type ?? "regular";
  const isActivating = !customer.is_active;

  const handleUpdate = (p) => update.mutateAsync(p);

  const handleToggle = async () => {
    try {
      if (customer.is_active) await deactivate.mutateAsync();
      else                    await activate.mutateAsync();
      toast.success(customer.is_active ? "Customer deactivated." : "Customer activated.");
      setToggleOpen(false);
    } catch (err) {
      toast.error(err?.message ?? "Action failed.");
    }
  };

  const totalSpent        = stats ? parseFloat(stats.total_spent)         : null;
  const outstanding       = stats ? parseFloat(stats.outstanding_balance)  : parseFloat(customer.outstanding_balance ?? 0);
  const creditLimit       = stats ? parseFloat(stats.credit_limit)         : parseFloat(customer.credit_limit ?? 0);
  const availableCredit   = stats ? parseFloat(stats.available_credit)     : Math.max(0, creditLimit - outstanding);
  const creditEnabled     = stats ? stats.credit_enabled                   : customer.credit_enabled ?? false;
  const totalTransactions = stats?.total_transactions ?? 0;

  return (
    <>
      <PageHeader
        title={fullName}
        description={
          <span className="flex items-center gap-2">
            <span className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              TYPE_STYLES[customerType] ?? TYPE_STYLES.regular,
            )}>
              {customerType === "vip" ? "VIP" : customerType.charAt(0).toUpperCase() + customerType.slice(1)}
            </span>
            <StatusBadge status={customer.is_active ? "active" : "inactive"} />
          </span>
        }
        action={canManage && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setToggleOpen(true)}>
              {customer.is_active
                ? <><PowerOff className="h-3.5 w-3.5 mr-1.5 text-warning" />Deactivate</>
                : <><Power    className="h-3.5 w-3.5 mr-1.5 text-success" />Activate</>}
            </Button>
            <Button size="sm" onClick={() => setEditOpen(true)}>
              <Edit3 className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
          </div>
        )}
      >
        <Link
          to="/customers"
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Back to Customers
        </Link>
      </PageHeader>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* KPI row */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="Total Spent"
              value={totalSpent != null ? formatCurrency(totalSpent) : "—"}
              sub={`${totalTransactions} transactions`}
              accent="primary"
            />
            <StatCard
              label="Outstanding"
              value={formatCurrency(outstanding)}
              sub="credit balance owed"
              accent={outstanding > 0 ? "warning" : "muted"}
            />
            <StatCard
              label="Available Credit"
              value={creditEnabled ? formatCurrency(availableCredit) : "Disabled"}
              sub={creditEnabled ? `Limit: ${formatCurrency(creditLimit)}` : "credit not enabled"}
              accent={creditEnabled ? "success" : "muted"}
            />
            <StatCard
              label="Loyalty Points"
              value={customer.loyalty_points ?? 0}
              sub="reward points earned"
              accent="default"
            />
          </div>

          <div className="grid grid-cols-3 gap-5">
            {/* Left — Contact & Credit Info */}
            <div className="space-y-5">
              <Section title="Contact Info" icon={User}>
                <Row label="First Name" value={customer.first_name} />
                <Row label="Last Name"  value={customer.last_name} />
                {customer.phone && (
                  <Row
                    label="Phone"
                    value={
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />{customer.phone}
                      </span>
                    }
                  />
                )}
                {customer.email && (
                  <Row
                    label="Email"
                    value={
                      <span className="flex items-center gap-1 break-all">
                        <Mail className="h-3 w-3 shrink-0" />{customer.email}
                      </span>
                    }
                  />
                )}
                {customer.city && (
                  <Row
                    label="City"
                    value={
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />{customer.city}
                      </span>
                    }
                  />
                )}
                {customer.address && <Row label="Address" value={customer.address} />}
                <Row label="Customer Since" value={formatDate(customer.created_at)} />
              </Section>

              <Section title="Credit Account" icon={CreditCard}>
                <Row
                  label="Credit Enabled"
                  value={
                    <span className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      creditEnabled
                        ? "bg-success/10 text-success border border-success/20"
                        : "bg-muted/50 text-muted-foreground border border-border/60",
                    )}>
                      {creditEnabled ? "Yes" : "No"}
                    </span>
                  }
                />
                <Row label="Credit Limit"   value={formatCurrency(creditLimit)} mono valueClass="text-foreground" />
                <Row
                  label="Outstanding"
                  value={formatCurrency(outstanding)}
                  mono
                  valueClass={outstanding > 0 ? "text-warning" : "text-muted-foreground"}
                />
                <Row
                  label="Available"
                  value={creditEnabled ? formatCurrency(availableCredit) : "—"}
                  mono
                  valueClass={creditEnabled ? "text-success" : "text-muted-foreground"}
                />
                {outstanding > 0 && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/8 px-2.5 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
                    <p className="text-[11px] text-warning leading-relaxed">
                      This customer has an outstanding balance of <strong>{formatCurrency(outstanding)}</strong>.
                    </p>
                  </div>
                )}
              </Section>
            </div>

            {/* Right — Transaction History */}
            <div className="col-span-2">
              <Section title="Transaction History" icon={Receipt}>
                <TransactionHistory customerId={customerId} />
              </Section>
            </div>
          </div>

          {/* Wallet */}
          <Section title="Wallet" icon={Wallet}
            action={
              <span className="text-[11px] text-muted-foreground">Prepaid balance</span>
            }
          >
            <WalletPanel customerId={customerId} canManage={canManage} />
            <div className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Transaction History</p>
              <WalletHistoryTable customerId={customerId} />
            </div>
          </Section>

          {/* Loyalty Points */}
          <Section title="Loyalty Points" icon={Star}
            action={
              <span className="text-[11px] text-muted-foreground">Points balance</span>
            }
          >
            <LoyaltyBalanceCard customerId={customerId} canManage={canManage} />
            <div className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Points History</p>
              <LoyaltyHistoryTable customerId={customerId} />
            </div>
          </Section>

          {/* Credit Sales — only shown when credit is enabled */}
          {creditEnabled && (
            <Section
              title="Credit Sales"
              icon={CreditCard}
              action={
                <Link
                  to="/credit-sales"
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  View All <ArrowUpRight className="h-3 w-3" />
                </Link>
              }
            >
              <CustomerCreditSales customerId={customerId} />
            </Section>
          )}

        </div>
      </div>

      {/* Edit Dialog */}
      <EditCustomerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={customer}
        onUpdate={handleUpdate}
      />

      {/* Toggle Status Dialog */}
      <Dialog open={toggleOpen} onOpenChange={setToggleOpen}>
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
          <div className={cn("h-[3px] w-full", isActivating ? "bg-success" : "bg-warning")} />
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
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
                  {isActivating ? "Activate Customer?" : "Deactivate Customer?"}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">{fullName}</DialogDescription>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {isActivating
                ? "This customer will be visible in searches and POS lookups."
                : "This customer will be hidden from searches and cannot be added to new sales."}
            </p>
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
            <Button variant="outline" size="sm" onClick={() => setToggleOpen(false)}>Keep</Button>
            <Button
              size="sm"
              className={cn("text-white flex-1",
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
