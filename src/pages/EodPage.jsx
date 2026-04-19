// pages/EodPage.jsx — End-of-Day Reports
import { useState, useRef, useMemo } from "react";
import {
  FileText, Download, Lock, RefreshCw, Loader2,
  DollarSign, ShoppingCart, RotateCcw, TrendingUp,
  Package, Users, Clock, Award, Tag,
  BarChart3, Star, ChevronDown, ChevronUp,
  AlertTriangle, Percent, ChevronLeft, ChevronRight,
} from "lucide-react";
import { toast }           from "sonner";
import { save }            from "@tauri-apps/plugin-dialog";
import { writeFile }       from "@tauri-apps/plugin-fs";
import { openPath }        from "@tauri-apps/plugin-opener";
import { PageHeader }      from "@/components/shared/PageHeader";
import { DataTable }       from "@/components/shared/DataTable";
import { EmptyState }      from "@/components/shared/EmptyState";
import { StatusBadge }     from "@/components/shared/StatusBadge";
import { Button }          from "@/components/ui/button";
import { Input }           from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn }              from "@/lib/utils";
import { useEodReport, useEodBreakdown, useEodHistory } from "@/features/shifts/useEod";
import { formatCurrency, formatDate }                  from "@/lib/format";
import { PAYMENT_METHOD_LABELS }                       from "@/lib/constants";
import { generateEodPdf }  from "@/lib/eodPdf";
import { useBranchStore }  from "@/stores/branch.store";

// ── Shared atoms ──────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, action, children, className }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
        </div>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function PLRow({ label, value, bold, accent, indent }) {
  return (
    <div className={cn(
      "flex items-center justify-between py-1.5 border-b border-border/30 last:border-0",
      indent && "pl-4",
    )}>
      <span className={cn("text-xs text-muted-foreground", bold && "font-bold text-foreground")}>{label}</span>
      <span className={cn(
        "text-xs font-mono tabular-nums",
        bold                     && "font-bold text-foreground",
        accent === "success"     && "text-success",
        accent === "destructive" && "text-destructive",
        accent === "warning"     && "text-warning",
      )}>{value}</span>
    </div>
  );
}

function KpiCard({ label, value, sub, icon: Icon, accent = "default" }) {
  const ring = {
    default:     "border-border/60 bg-card",
    primary:     "border-primary/25 bg-primary/[0.06]",
    success:     "border-success/25 bg-success/[0.06]",
    warning:     "border-warning/25 bg-warning/[0.06]",
    destructive: "border-destructive/25 bg-destructive/[0.06]",
  }[accent];
  const val = {
    default:     "text-foreground",
    primary:     "text-primary",
    success:     "text-success",
    warning:     "text-warning",
    destructive: "text-destructive",
  }[accent];
  return (
    <div className={cn("rounded-xl border px-4 py-3.5", ring)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn("h-4 w-4 opacity-40", val)} />}
      </div>
      <p className={cn("text-xl font-bold tabular-nums leading-none", val)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function SubTabs({ tabs, active, onChange }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60 w-fit">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all",
            active === t.id
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}>
          {t.icon && <t.icon className="h-3 w-3" />}
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Lock Confirmation Dialog ───────────────────────────────────────────────────

function LockConfirmDialog({ open, onOpenChange, reportDate, onConfirm, isLoading }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !isLoading && onOpenChange(v)}>
      <DialogContent className="max-w-md border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/50">
        <div className="h-[3px] w-full bg-gradient-to-r from-destructive/80 via-destructive to-destructive/80" />
        <div className="px-6 pt-5 pb-6 space-y-4">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/8">
                <Lock className="h-5 w-5 text-destructive" />
              </div>
              <div className="pt-0.5">
                <DialogTitle className="text-[14px] font-bold leading-tight">Lock EOD Report?</DialogTitle>
                <DialogDescription className="text-[11px] mt-1 text-muted-foreground">
                  {formatDate(reportDate + "T00:00:00")}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex items-start gap-2.5 rounded-lg border border-warning/20 bg-warning/6 px-3.5 py-3">
            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
            <p className="text-[11px] text-warning/90 leading-relaxed">
              Locking this report is <span className="font-bold">permanent and irreversible</span>.
              Once locked it cannot be regenerated or edited — only read.
              Make sure all transactions, returns, and expenses for this day are finalised first.
            </p>
          </div>

          <DialogFooter className="flex gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading} className="flex-1 text-xs">
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              disabled={isLoading}
              className="flex-1 text-xs bg-destructive hover:bg-destructive/90 text-white"
            >
              {isLoading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Locking…</>
                : <><Lock className="h-3.5 w-3.5 mr-1" />Lock Report</>}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Summary tab ───────────────────────────────────────────────────────────────

function SummaryTab({ report: r, breakdown, printRef }) {
  const paymentBreakdown = useMemo(() => {
    if (breakdown?.payment_methods?.length) {
      return breakdown.payment_methods.map((pm) => ({
        method: pm.payment_method,
        label:  PAYMENT_METHOD_LABELS[pm.payment_method] ?? pm.payment_method,
        total:  pm.total,
        count:  pm.count,
      }));
    }
    return [
      { method: "cash",     label: PAYMENT_METHOD_LABELS.cash     ?? "Cash",          total: r.cash_collected     ?? 0, count: null },
      { method: "card",     label: PAYMENT_METHOD_LABELS.card     ?? "Card",          total: r.card_collected     ?? 0, count: null },
      { method: "transfer", label: PAYMENT_METHOD_LABELS.transfer ?? "Bank Transfer", total: r.transfer_collected ?? 0, count: null },
      { method: "credit",   label: PAYMENT_METHOD_LABELS.credit   ?? "Credit",        total: r.credit_issued      ?? 0, count: null },
    ].filter((pm) => parseFloat(pm.total) > 0);
  }, [breakdown, r]);

  const cashiers   = breakdown?.cashiers ?? [];
  const hasShift   = r.opening_float != null;
  const netSales   = parseFloat(r.net_sales ?? 0);

  // Pre-compute expected cash for the reconciliation section
  const openingFloat  = parseFloat(r.opening_float ?? 0);
  const cashCollected = parseFloat(r.cash_collected ?? 0);
  const cashIn        = parseFloat(r.cash_in ?? 0);
  const cashOut       = parseFloat(r.cash_out ?? 0);
  const closingCash   = parseFloat(r.closing_cash ?? 0);
  const expectedCash  = openingFloat + cashCollected + cashIn - cashOut;
  const variance      = parseFloat(r.cash_difference ?? 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* P&L Summary */}
        <div className="rounded-xl border border-border bg-card overflow-hidden" ref={printRef}>
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-muted/20">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">P&L Summary</span>
            {r.is_locked && (
              <span className="ml-auto flex items-center gap-1 text-[10px] text-success font-semibold">
                <Lock className="h-3 w-3" />Locked
              </span>
            )}
          </div>
          <div className="p-5">
            <PLRow label="Gross Sales"   value={formatCurrency(parseFloat(r.gross_sales        ?? 0))} bold />
            <PLRow label="Discounts"     value={`-${formatCurrency(parseFloat(r.total_discounts ?? 0))}`} indent accent="destructive" />
            <PLRow label="Returns"       value={`-${formatCurrency(parseFloat(r.refunds_amount  ?? 0))}`} indent accent="destructive" />
            <PLRow label="Net Sales"     value={formatCurrency(parseFloat(r.net_sales           ?? 0))} bold accent="success" />
            <PLRow label="Cost of Goods" value={`-${formatCurrency(parseFloat(r.cost_of_goods_sold ?? 0))}`} indent accent="destructive" />
            <PLRow label="Gross Profit"  value={formatCurrency(parseFloat(r.gross_profit        ?? 0))} bold />
            <PLRow label="Expenses"      value={`-${formatCurrency(parseFloat(r.total_expenses  ?? 0))}`} indent accent="destructive" />
            <PLRow label="Net Profit"    value={formatCurrency(parseFloat(r.net_profit          ?? 0))} bold
              accent={parseFloat(r.net_profit ?? 0) >= 0 ? "success" : "destructive"} />
            <PLRow label="VAT Collected" value={formatCurrency(parseFloat(r.total_tax          ?? 0))} indent />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Payment Methods */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Payment Methods</span>
            </div>
            <div className="p-5">
              {paymentBreakdown.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No payment data</p>
              ) : paymentBreakdown.map((pm) => {
                const pmTotal = parseFloat(pm.total ?? 0);
                const pct     = netSales > 0 ? ((pmTotal / netSales) * 100).toFixed(1) : null;
                return (
                  <div key={pm.method} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                      <p className="text-xs font-semibold">{pm.label}</p>
                      {pm.count != null && (
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {pm.count} txn{pm.count !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {pct && (
                        <span className="text-[10px] text-muted-foreground tabular-nums bg-muted/50 rounded px-1.5 py-0.5">
                          {pct}%
                        </span>
                      )}
                      <span className="text-xs font-mono font-bold tabular-nums">{formatCurrency(pmTotal)}</span>
                    </div>
                  </div>
                );
              })}
              {parseFloat(r.credit_collected ?? 0) > 0 && (
                <div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Credit Collected (debt recovery)</span>
                  <span className="text-xs font-mono font-bold tabular-nums text-success">
                    +{formatCurrency(parseFloat(r.credit_collected))}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Cashier Performance */}
          {cashiers.length > 0 && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Cashier Performance</span>
              </div>
              <div className="p-5">
                {cashiers.map((c, i) => (
                  <div key={c.cashier_name} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold",
                        i === 0
                          ? "bg-warning/15 border border-warning/25 text-warning"
                          : "bg-muted/40 border border-border/40 text-muted-foreground",
                      )}>
                        {i + 1}
                      </div>
                      <div>
                        <p className="text-xs font-semibold">{c.cashier_name}</p>
                        <p className="text-[10px] text-muted-foreground">{c.transaction_count} transaction{c.transaction_count !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-bold tabular-nums">{formatCurrency(parseFloat(c.total_sales ?? 0))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Shift Cash Reconciliation — full formula */}
      {hasShift && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Shift Cash Reconciliation</span>
          </div>
          <div className="p-5">
            <div className="max-w-sm space-y-0">
              <PLRow label="Opening Float"              value={formatCurrency(openingFloat)} bold />
              <PLRow label="+ Cash Sales"               value={`+${formatCurrency(cashCollected)}`} indent accent="success" />
              {cashIn > 0 && (
                <PLRow label="+ Cash In (top-ups)"      value={`+${formatCurrency(cashIn)}`} indent accent="success" />
              )}
              {cashOut > 0 && (
                <PLRow label="− Cash Out (withdrawals)" value={`-${formatCurrency(cashOut)}`} indent accent="destructive" />
              )}
              <PLRow label="Expected in Drawer"         value={formatCurrency(expectedCash)} bold />
              <PLRow label="Actual Cash (counted)"      value={formatCurrency(closingCash)} bold />
              <PLRow
                label="Variance"
                value={`${variance >= 0 ? "+" : ""}${formatCurrency(variance)}`}
                bold
                accent={variance > 0 ? "success" : variance < 0 ? "destructive" : undefined}
              />
            </div>
            {variance !== 0 && (
              <div className={cn(
                "mt-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-3",
                variance < 0
                  ? "border-destructive/20 bg-destructive/6"
                  : "border-warning/20 bg-warning/6",
              )}>
                <AlertTriangle className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", variance < 0 ? "text-destructive" : "text-warning")} />
                <p className={cn("text-[11px] leading-relaxed", variance < 0 ? "text-destructive/90" : "text-warning/90")}>
                  {variance < 0
                    ? `Cash shortage of ${formatCurrency(Math.abs(variance))}. Investigate before closing.`
                    : `Cash surplus of ${formatCurrency(variance)}. Verify shift notes and drawer count.`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Voids & Returns */}
      {(r.voids_count > 0 || r.refunds_count > 0) && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
            <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Voids & Returns</span>
          </div>
          <div className="p-5 grid grid-cols-2 gap-6">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Voided Transactions</p>
              <PLRow label="Count"  value={(r.voids_count   ?? 0).toString()} />
              <PLRow label="Amount" value={formatCurrency(parseFloat(r.voids_amount ?? 0))} accent="warning" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Returns / Refunds</p>
              <PLRow label="Count"  value={(r.refunds_count  ?? 0).toString()} />
              <PLRow label="Amount" value={formatCurrency(parseFloat(r.refunds_amount ?? 0))} accent="warning" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Hierarchy builder ────────────────────────────────────────────────────────

/**
 * Groups top_items into a three-level tree: Department → Category → Item.
 * Uses the categories array to resolve department when the item itself
 * doesn't carry department_name. Falls back to "Uncategorized" at each level.
 */
function buildSalesHierarchy(items, categories) {
  // category_name → department_name reverse-lookup
  const catDeptMap = new Map();
  for (const cat of (categories ?? [])) {
    if (cat.category_name) {
      catDeptMap.set(cat.category_name, cat.department_name ?? null);
    }
  }

  const deptMap = new Map();

  for (const item of items) {
    const deptName =
      item.department_name ??
      catDeptMap.get(item.category_name) ??
      "Uncategorized";
    const catName = item.category_name ?? "Uncategorized";

    if (!deptMap.has(deptName)) {
      deptMap.set(deptName, { name: deptName, categories: new Map(), qty: 0, revenue: 0 });
    }
    const dept = deptMap.get(deptName);

    if (!dept.categories.has(catName)) {
      dept.categories.set(catName, { name: catName, items: [], qty: 0, revenue: 0 });
    }
    const cat = dept.categories.get(catName);

    const qty     = parseFloat(item.qty_sold    ?? 0);
    const revenue = parseFloat(item.gross_sales ?? 0);

    cat.items.push({ ...item, qty, revenue });
    cat.qty     += qty;
    cat.revenue += revenue;
    dept.qty    += qty;
    dept.revenue += revenue;
  }

  return Array.from(deptMap.values())
    .map((dept) => ({
      ...dept,
      categories: Array.from(dept.categories.values()).sort((a, b) => b.revenue - a.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ── Products tab ──────────────────────────────────────────────────────────────

function ProductsTab({ breakdown }) {
  const [openDepts, setOpenDepts] = useState(new Set());
  const [openCats,  setOpenCats]  = useState(new Set());

  const items      = breakdown?.top_items  ?? [];
  const categories = breakdown?.categories ?? [];

  const hierarchy = useMemo(
    () => buildSalesHierarchy(items, categories),
    [items, categories],
  );

  const topItem = items[0];

  if (!breakdown) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />Loading breakdown…
      </div>
    );
  }

  const toggleDept = (name) => {
    setOpenDepts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        // Collapse all child categories when the department collapses
        setOpenCats((cp) => {
          const cn = new Set(cp);
          for (const k of cn) {
            if (k.startsWith(name + "::")) cn.delete(k);
          }
          return cn;
        });
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const toggleCat = (key) => {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const fmtQty = (q) =>
    parseFloat(q ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

  return (
    <div className="space-y-4">
      {/* ── Top seller spotlight ── */}
      {topItem && (
        <div className="rounded-xl border border-warning/30 bg-warning/[0.05] overflow-hidden">
          <div className="px-5 py-3 border-b border-warning/20 flex items-center gap-2">
            <Star className="h-3.5 w-3.5 text-warning" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-warning">Top Seller Today</span>
          </div>
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-warning/30 bg-warning/15">
                <Award className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-sm font-bold">{topItem.item_name}</p>
                <p className="text-[11px] text-muted-foreground">{topItem.sku} · {topItem.category_name}</p>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Units Sold</p>
                <p className="text-lg font-bold tabular-nums text-warning">{fmtQty(topItem.qty_sold)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Revenue</p>
                <p className="text-lg font-bold tabular-nums text-success">{formatCurrency(parseFloat(topItem.gross_sales ?? 0))}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Hierarchy table ── */}
      <Section
        title={`Sales by Department › Category › Item${items.length ? ` (${items.length} items)` : ""}`}
        icon={BarChart3}
      >
        {hierarchy.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No items sold"
            description="No completed transactions for this date."
            compact
          />
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">

            {/* Column header bar */}
            <div className="grid items-center gap-0 bg-muted/40 border-b border-border px-3 py-2"
              style={{ gridTemplateColumns: "1fr 80px 48px 112px" }}>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Name</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Qty Sold</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Unit</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Revenue</span>
            </div>

            {hierarchy.map((dept, di) => {
              const isDeptOpen = openDepts.has(dept.name);
              return (
                <div key={dept.name} className={cn(di > 0 && "border-t border-border")}>

                  {/* ── Department row ── */}
                  <button
                    onClick={() => toggleDept(dept.name)}
                    className="w-full grid items-center gap-0 px-3 py-2.5 bg-muted/60 hover:bg-muted/80 transition-colors text-left"
                    style={{ gridTemplateColumns: "1fr 80px 48px 112px" }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ChevronRight className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                        isDeptOpen && "rotate-90",
                      )} />
                      <BarChart3 className="h-3 w-3 shrink-0 text-primary/70" />
                      <span className="text-xs font-bold text-foreground truncate">{dept.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {dept.categories.length} {dept.categories.length !== 1 ? "categories" : "category"}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold tabular-nums text-foreground text-right">
                      {fmtQty(dept.qty)}
                    </span>
                    <span />{/* unit spacer */}
                    <span className="text-xs font-mono font-bold tabular-nums text-primary text-right">
                      {formatCurrency(dept.revenue)}
                    </span>
                  </button>

                  {/* ── Categories (visible when dept is open) ── */}
                  {isDeptOpen && dept.categories.map((cat) => {
                    const catKey    = `${dept.name}::${cat.name}`;
                    const isCatOpen = openCats.has(catKey);
                    return (
                      <div key={catKey} className="border-t border-border/50">

                        {/* Category row */}
                        <button
                          onClick={() => toggleCat(catKey)}
                          className="w-full grid items-center gap-0 pl-7 pr-3 py-2 bg-card/60 hover:bg-muted/30 transition-colors text-left"
                          style={{ gridTemplateColumns: "1fr 80px 48px 112px" }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <ChevronRight className={cn(
                              "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
                              isCatOpen && "rotate-90",
                            )} />
                            <Tag className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="text-[11px] font-semibold text-foreground/90 truncate">{cat.name}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {cat.items.length} {cat.items.length !== 1 ? "items" : "item"}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono font-semibold tabular-nums text-muted-foreground text-right">
                            {fmtQty(cat.qty)}
                          </span>
                          <span />{/* unit spacer */}
                          <span className="text-[11px] font-mono font-semibold tabular-nums text-foreground text-right">
                            {formatCurrency(cat.revenue)}
                          </span>
                        </button>

                        {/* Item rows (visible when cat is open) */}
                        {isCatOpen && cat.items.map((item, ii) => (
                          <div
                            key={`${item.item_name}-${ii}`}
                            className={cn(
                              "grid items-center gap-0 pl-12 pr-3 py-1.5 border-t border-border/30",
                              ii % 2 === 1 ? "bg-muted/10" : "bg-transparent",
                            )}
                            style={{ gridTemplateColumns: "1fr 80px 48px 112px" }}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="h-1 w-1 rounded-full bg-border/70 shrink-0" />
                              <span className="text-[11px] text-foreground/80 truncate">{item.item_name}</span>
                              {item.sku && (
                                <span className="text-[10px] text-muted-foreground shrink-0 font-mono">{item.sku}</span>
                              )}
                            </div>
                            <span className="text-[11px] font-mono tabular-nums text-muted-foreground text-right">
                              {fmtQty(item.qty_sold)}
                            </span>
                            <span className="text-[10px] text-muted-foreground text-right truncate">
                              {item.measurement_type ?? ""}
                            </span>
                            <span className="text-[11px] font-mono tabular-nums text-foreground text-right">
                              {formatCurrency(item.revenue)}
                            </span>
                          </div>
                        ))}

                        {/* Category subtotal row (shown when expanded) */}
                        {isCatOpen && (
                          <div
                            className="grid items-center gap-0 pl-12 pr-3 py-1.5 border-t border-border/50 bg-muted/25"
                            style={{ gridTemplateColumns: "1fr 80px 48px 112px" }}
                          >
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                              {cat.name} subtotal
                            </span>
                            <span className="text-[11px] font-mono font-bold tabular-nums text-foreground/70 text-right">
                              {fmtQty(cat.qty)}
                            </span>
                            <span />
                            <span className="text-[11px] font-mono font-bold tabular-nums text-foreground text-right">
                              {formatCurrency(cat.revenue)}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Department total footer (shown when expanded) */}
                  {isDeptOpen && (
                    <div
                      className="grid items-center gap-0 px-3 py-2 border-t border-border/60 bg-primary/[0.05]"
                      style={{ gridTemplateColumns: "1fr 80px 48px 112px" }}
                    >
                      <span className="text-[10px] font-bold text-primary/80 uppercase tracking-wider pl-5">
                        {dept.name} total
                      </span>
                      <span className="text-xs font-mono font-bold tabular-nums text-foreground text-right">
                        {fmtQty(dept.qty)}
                      </span>
                      <span />
                      <span className="text-xs font-mono font-bold tabular-nums text-primary text-right">
                        {formatCurrency(dept.revenue)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Timeline tab ──────────────────────────────────────────────────────────────

function TimelineTab({ breakdown }) {
  if (!breakdown) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />Loading breakdown…
      </div>
    );
  }

  const hourly   = breakdown.hourly ?? [];
  const maxSales = hourly.reduce((m, h) => Math.max(m, parseFloat(h.sales)), 0);
  const peakHour = hourly.reduce(
    (best, h) => (parseFloat(h.sales) > parseFloat(best?.sales ?? 0) ? h : best),
    null,
  );

  const fmtHour = (h) =>
    new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });

  return (
    <div className="space-y-4">
      {peakHour && (
        <div className="rounded-xl border border-primary/30 bg-primary/[0.04] overflow-hidden">
          <div className="px-5 py-3 border-b border-primary/20 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Peak Hour</span>
          </div>
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold">{fmtHour(peakHour.hour)}</p>
                <p className="text-[11px] text-muted-foreground">Busiest hour of the day</p>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Transactions</p>
                <p className="text-lg font-bold tabular-nums text-primary">{peakHour.transaction_count}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Sales</p>
                <p className="text-lg font-bold tabular-nums text-success">{formatCurrency(parseFloat(peakHour.sales ?? 0))}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <Section title="Sales by Hour" icon={Clock}>
        {hourly.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">No hourly data for this date.</p>
        ) : (
          <div className="space-y-1.5">
            {hourly.map((h) => {
              const sales  = parseFloat(h.sales ?? 0);
              const pct    = maxSales > 0 ? (sales / maxSales) * 100 : 0;
              const isPeak = peakHour?.hour === h.hour;
              return (
                <div key={h.hour} className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors",
                  isPeak ? "bg-primary/[0.07] border border-primary/20" : "hover:bg-muted/30",
                )}>
                  <span className={cn("text-[11px] font-mono w-16 shrink-0 tabular-nums", isPeak ? "text-primary font-bold" : "text-muted-foreground")}>
                    {fmtHour(h.hour)}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                    <div className={cn("h-full rounded-full", isPeak ? "bg-primary" : "bg-primary/40")}
                      style={{ width: `${pct}%` }} />
                  </div>
                  <span className={cn("text-[11px] font-mono tabular-nums w-10 text-center shrink-0", isPeak ? "text-primary font-bold" : "text-muted-foreground")}>
                    {h.transaction_count}
                  </span>
                  <span className={cn("text-xs font-mono font-bold tabular-nums w-24 text-right shrink-0", isPeak ? "text-success" : "text-foreground")}>
                    {formatCurrency(sales)}
                  </span>
                </div>
              );
            })}
            <div className="flex items-center gap-3 px-3 mt-1 pt-2 border-t border-border/40">
              <span className="text-[10px] font-semibold text-muted-foreground w-16 shrink-0">Total</span>
              <div className="flex-1" />
              <span className="text-[10px] font-semibold text-muted-foreground w-10 text-center shrink-0">
                {hourly.reduce((s, h) => s + h.transaction_count, 0)}
              </span>
              <span className="text-xs font-bold tabular-nums font-mono w-24 text-right shrink-0">
                {formatCurrency(hourly.reduce((s, h) => s + parseFloat(h.sales ?? 0), 0))}
              </span>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Full report view ──────────────────────────────────────────────────────────

const REPORT_TABS = [
  { id: "summary",  label: "Summary",  icon: FileText  },
  { id: "products", label: "Products", icon: Package   },
  { id: "timeline", label: "Timeline", icon: Clock     },
];

function EodReportView({ report, breakdown, breakdownLoading, subTab, onSubTabChange, onLockClick, locking, store }) {
  const printRef    = useRef(null);
  const [exporting, setExporting] = useState(false);

  const r       = report;
  const avgTx   = (r.transactions_count ?? 0) > 0
    ? parseFloat(r.gross_sales) / r.transactions_count
    : 0;

  // Gross profit margin %
  const grossSales   = parseFloat(r.gross_sales ?? 0);
  const grossProfit  = parseFloat(r.gross_profit ?? 0);
  const marginPct    = grossSales > 0 ? (grossProfit / grossSales) * 100 : 0;
  const marginAccent = marginPct >= 25 ? "success" : marginPct >= 12 ? "warning" : "destructive";
  const itemsSold    = parseFloat(r.items_sold ?? 0);

  const handleExportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const pdfBytes  = generateEodPdf(r, breakdown ?? null, store);
      const defaultName = `EOD_${r.report_date ?? "report"}_${(store?.store_name ?? "store").replace(/\s+/g, "_")}.pdf`;
      const filePath  = await save({
        defaultPath: defaultName,
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
      if (!filePath) { setExporting(false); return; }
      await writeFile(filePath, new Uint8Array(pdfBytes));
      toast.success("PDF saved", {
        description: filePath.split(/[\\/]/).pop(),
        action: { label: "Open", onClick: () => openPath(filePath).catch(() => {}) },
        duration: 8000,
      });
    } catch (e) {
      toast.error("Export failed", { description: String(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI row: Gross Sales · Net Sales · Margin % · Transactions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Gross Sales"  value={formatCurrency(grossSales)} icon={DollarSign} accent="primary" />
        <KpiCard label="Net Sales"    value={formatCurrency(parseFloat(r.net_sales ?? 0))} icon={TrendingUp} accent="success" />
        <KpiCard
          label="Gross Margin"
          value={`${marginPct.toFixed(1)}%`}
          sub={`Profit ${formatCurrency(grossProfit)}`}
          icon={Percent}
          accent={marginAccent}
        />
        <KpiCard
          label="Transactions"
          value={(r.transactions_count ?? 0).toLocaleString()}
          sub={`${itemsSold.toLocaleString(undefined, { maximumFractionDigits: 0 })} items · Avg ${formatCurrency(avgTx)}`}
          icon={ShoppingCart}
        />
      </div>

      {/* Sub-tab header */}
      <div className="flex items-center justify-between">
        <SubTabs tabs={REPORT_TABS} active={subTab} onChange={onSubTabChange} />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleExportPdf} disabled={exporting}
            className="gap-1.5 h-8 text-xs border-primary/30 text-primary hover:bg-primary/10">
            {exporting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Exporting…</>
              : <><Download className="h-3.5 w-3.5" />Export PDF</>}
          </Button>
          {!r.is_locked && (
            <Button size="sm" variant="outline" onClick={onLockClick} disabled={locking}
              className="gap-1.5 h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10">
              {locking
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Locking…</>
                : <><Lock className="h-3.5 w-3.5" />Lock Report</>}
            </Button>
          )}
        </div>
      </div>

      {subTab === "summary"  && <SummaryTab  report={r} breakdown={breakdown} printRef={printRef} />}
      {subTab === "products" && <ProductsTab breakdown={breakdownLoading ? null : breakdown} />}
      {subTab === "timeline" && <TimelineTab breakdown={breakdownLoading ? null : breakdown} />}
    </div>
  );
}

// ── History table ─────────────────────────────────────────────────────────────

function EodHistorySection({ onSelect }) {
  const today    = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo,   setDateTo]   = useState(today);

  const { history, isLoading } = useEodHistory({ dateFrom, dateTo, limit: 90 });

  const columns = [
    { key: "report_date",       header: "Date",   sortable: true,
      render: (r) => <span className="text-xs font-semibold">{formatDate(r.report_date)}</span> },
    { key: "transactions_count", header: "Txns",  align: "right",
      render: (r) => <span className="text-xs tabular-nums">{r.transactions_count ?? 0}</span> },
    { key: "gross_sales",       header: "Gross",  align: "right",
      render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrency(parseFloat(r.gross_sales ?? 0))}</span> },
    { key: "net_profit",        header: "Profit", align: "right",
      render: (r) => {
        const p = parseFloat(r.net_profit ?? 0);
        return <span className={cn("text-xs font-mono font-bold tabular-nums", p >= 0 ? "text-success" : "text-destructive")}>{formatCurrency(p)}</span>;
      }},
    { key: "status", header: "Status",
      render: (r) => <StatusBadge status={r.is_locked ? "locked" : "open"} /> },
    { key: "actions", header: "", align: "right",
      render: (r) => (
        <Button variant="ghost" size="sm" className="h-7 text-[11px] text-primary hover:text-primary"
          onClick={() => onSelect(String(r.report_date))}>
          View
        </Button>
      )},
  ];

  return (
    <div className="space-y-4">
      {/* Date range filter */}
      <div className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card">
        <span className="text-xs text-muted-foreground font-semibold shrink-0">Date range</span>
        <Input
          type="date"
          value={dateFrom}
          max={dateTo || today}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-8 text-xs w-36"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="date"
          value={dateTo}
          min={dateFrom}
          max={today}
          onChange={(e) => setDateTo(e.target.value)}
          className="h-8 text-xs w-36"
        />
        {history.length > 0 && (
          <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
            {history.length} report{history.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <DataTable
        columns={columns}
        data={history}
        isLoading={isLoading}
        emptyState={<EmptyState icon={FileText} title="No EOD reports" description="No reports found for this date range." compact />}
      />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function EodPage() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [tab,          setTab]          = useState("report");
  // subTab is lifted here so useEodBreakdown can be made lazy
  const [subTab,       setSubTab]       = useState("summary");
  const [lockOpen,     setLockOpen]     = useState(false);

  const activeStore = useBranchStore((s) => s.activeStore);

  const { report, isLoading, error, generate, lock } = useEodReport(selectedDate);

  // Only fetch breakdown when the user actually opens Products or Timeline tab
  const needsBreakdown = !!report && subTab !== "summary";
  const { breakdown, isLoading: breakdownLoading } = useEodBreakdown(selectedDate, needsBreakdown);

  const handleGenerate = async () => {
    try {
      await generate.mutateAsync(selectedDate);
      toast.success("EOD report generated.");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleLockConfirm = async () => {
    try {
      await lock.mutateAsync(report.id);
      toast.success("Report locked — no further changes allowed.");
      setLockOpen(false);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="End-of-Day Reports"
        description="Generate and review daily P&L summaries, product breakdowns, and hourly trends."
        action={
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={selectedDate}
              max={today}
              onChange={(e) => { setSelectedDate(e.target.value); setSubTab("summary"); }}
              className="h-8 text-sm w-36"
            />
            <Button size="sm" onClick={handleGenerate} disabled={generate.isPending} className="gap-1.5">
              {generate.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Generating…</>
                : <><RefreshCw className="h-3.5 w-3.5" />Generate</>}
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* Page tab toggle */}
          <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60 w-fit">
            {[{ id: "report", label: "Today's Report" }, { id: "history", label: "History" }].map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-md px-4 py-1.5 text-[11px] font-semibold transition-all",
                  tab === t.id
                    ? "bg-card text-foreground shadow-sm border border-border/60"
                    : "text-muted-foreground hover:text-foreground",
                )}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === "report" ? (
            isLoading ? (
              <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />Loading…
              </div>
            ) : error || !report ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <FileText className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm font-semibold text-foreground">No report for {formatDate(selectedDate + "T00:00:00")}</p>
                <p className="text-xs text-muted-foreground">Click "Generate" to create this day's EOD report.</p>
                <Button size="sm" onClick={handleGenerate} disabled={generate.isPending} className="mt-2 gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" />Generate Now
                </Button>
              </div>
            ) : (
              <EodReportView
                report={report}
                breakdown={breakdown}
                breakdownLoading={breakdownLoading}
                subTab={subTab}
                onSubTabChange={setSubTab}
                onLockClick={() => setLockOpen(true)}
                locking={lock.isPending}
                store={activeStore}
              />
            )
          ) : (
            <EodHistorySection onSelect={(d) => { setSelectedDate(d); setTab("report"); setSubTab("summary"); }} />
          )}

        </div>
      </div>

      {/* Lock confirmation dialog */}
      {report && (
        <LockConfirmDialog
          open={lockOpen}
          onOpenChange={setLockOpen}
          reportDate={selectedDate}
          onConfirm={handleLockConfirm}
          isLoading={lock.isPending}
        />
      )}
    </div>
  );
}
