// pages/InventoryAnalyticsPage.jsx — Dedicated Inventory Health page at /analytics/inventory
import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Package, AlertTriangle, ArrowLeft, Archive,
  ShoppingCart, Clock,
} from "lucide-react";

import { PageHeader }  from "@/components/shared/PageHeader";
import { DataTable }   from "@/components/shared/DataTable";
import { EmptyState }  from "@/components/shared/EmptyState";
import { Button }      from "@/components/ui/button";
import { cn }          from "@/lib/utils";
import {
  useStockVelocity, useDeadStock, useSlowMovingItems, useBusinessHealthSummary,
} from "@/features/analytics/useAnalytics";
import { formatCurrency, formatCurrencyCompact, formatDate, formatQuantity } from "@/lib/format";

// ── Helpers ───────────────────────────────────────────────────────────────────

function Section({ title, description, action, children, accentClass }) {
  return (
    <div className={cn("rounded-xl border overflow-hidden", accentClass ?? "border-border bg-card")}>
      <div className="px-5 py-3.5 border-b border-border bg-muted/20 flex items-center justify-between">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
          {description && <p className="text-[11px] text-muted-foreground/70 mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function KPICard({ label, value, sub, accent = "default" }) {
  const ring = {
    default:     "border-border/60 bg-card",
    primary:     "border-primary/25 bg-primary/[0.06]",
    success:     "border-success/25 bg-success/[0.06]",
    warning:     "border-warning/25 bg-warning/[0.06]",
    destructive: "border-destructive/25 bg-destructive/[0.06]",
    muted:       "border-border/60 bg-muted/30",
  }[accent] ?? "border-border/60 bg-card";
  const val = {
    default: "text-foreground", primary: "text-primary",
    success: "text-success",   warning: "text-warning",
    destructive: "text-destructive", muted: "text-muted-foreground",
  }[accent] ?? "text-foreground";

  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-4 py-3.5", ring)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function NarrativeBlock({ children }) {
  return (
    <div className="rounded-xl border border-warning/20 bg-warning/[0.04] overflow-hidden">
      <div className="h-[3px] w-full bg-warning" />
      <div className="flex gap-4 px-5 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-warning/25 bg-warning/10 text-warning">
          <Package className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-foreground mb-1.5">Inventory Health Summary</p>
          <div className="text-[12px] text-muted-foreground leading-relaxed space-y-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

function daysColor(days) {
  if (days == null) return "text-primary";
  if (days <= 0)  return "text-destructive";
  if (days <= 3)  return "text-destructive";
  if (days <= 7)  return "text-warning";
  if (days <= 60) return "text-success";
  return "text-primary";
}

// ── Critical item card ────────────────────────────────────────────────────────
function CriticalItemCard({ item, accent }) {
  const days = item.days_of_stock_remaining;
  const stock = parseFloat(item.current_stock ?? 0);
  const accentStyles = {
    destructive: "border-destructive/25 bg-destructive/[0.04]",
    warning:     "border-warning/25 bg-warning/[0.04]",
  }[accent] ?? "border-border bg-card";
  const textColor = { destructive: "text-destructive", warning: "text-warning" }[accent] ?? "text-foreground";

  return (
    <div className={cn("rounded-xl border px-4 py-3.5 flex items-center gap-4", accentStyles)}>
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-[11px] font-bold uppercase",
        accent === "destructive" ? "border-destructive/25 bg-destructive/10 text-destructive" : "border-warning/25 bg-warning/10 text-warning"
      )}>
        {item.item_name?.slice(0, 2)?.toUpperCase() ?? "??"}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">{item.item_name}</p>
        <p className="text-[11px] text-muted-foreground">
          {formatQuantity(stock)} in stock
          {item.sku ? ` · SKU: ${item.sku}` : ""}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className={cn("text-sm font-bold tabular-nums", textColor)}>
          {days != null ? `${days}d left` : "∞"}
        </p>
        {item.avg_daily_sales > 0 && (
          <p className="text-[10px] text-muted-foreground">{formatQuantity(parseFloat(item.avg_daily_sales ?? 0))} / day</p>
        )}
      </div>
      <Link to="/purchase-orders/new">
        <Button variant="outline" size="xs" className="shrink-0 text-[10px]">
          Create PO
        </Button>
      </Link>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function InventoryAnalyticsPage() {
  const { data: health                        } = useBusinessHealthSummary();
  const { data: velocity, isLoading: lVel     } = useStockVelocity({ limit: 100 });
  const { data: deadStock, isLoading: lDead   } = useDeadStock({ days: 30 });
  const { data: slowItems, isLoading: lSlow   } = useSlowMovingItems({ limit: 30 });

  const velList  = useMemo(() => Array.isArray(velocity)  ? velocity  : [], [velocity]);
  const deadList = useMemo(() => Array.isArray(deadStock) ? deadStock : [], [deadStock]);
  const slowList = useMemo(() => Array.isArray(slowItems) ? slowItems : [], [slowItems]);

  // Segment velocity by urgency
  const { criticalItems, lowStockItems } = useMemo(() => {
    const critical = velList.filter((i) => i.days_of_stock_remaining != null && i.days_of_stock_remaining <= 3);
    const lowStock = velList.filter((i) => i.days_of_stock_remaining != null && i.days_of_stock_remaining > 3 && i.days_of_stock_remaining <= 7);
    return { criticalItems: critical, lowStockItems: lowStock };
  }, [velList]);

  const outOfStock   = parseInt(health?.out_of_stock_count ?? 0, 10);
  const lowStockCnt  = parseInt(health?.low_stock_count    ?? 0, 10);
  const deadStockVal = useMemo(() => deadList.reduce((s, i) => s + parseFloat(i.stock_value_at_cost ?? 0), 0), [deadList]);

  // Most urgent item
  const mostUrgent = useMemo(() => {
    const sorted = [...velList].sort((a, b) => {
      const da = a.days_of_stock_remaining ?? 9999;
      const db = b.days_of_stock_remaining ?? 9999;
      return da - db;
    });
    return sorted[0] ?? null;
  }, [velList]);

  const narrative = useMemo(() => {
    if (!health && velList.length === 0) return null;
    return (
      <>
        {(outOfStock > 0 || criticalItems.length > 0) && (
          <p>
            <strong className="text-destructive">{outOfStock > 0 ? `${outOfStock} item${outOfStock !== 1 ? "s" : ""}` : `${criticalItems.length} item${criticalItems.length !== 1 ? "s" : ""}`}</strong> are
            completely out of stock or critically low (3 days or less remaining) and need immediate attention.
          </p>
        )}
        {lowStockCnt > 0 && (
          <p>
            An additional <strong className="text-warning">{lowStockCnt} item{lowStockCnt !== 1 ? "s" : ""}</strong> are
            running low and will need restocking within the week.
          </p>
        )}
        {deadList.length > 0 && (
          <p>
            <strong className="text-muted-foreground">{deadList.length} item{deadList.length !== 1 ? "s" : ""}</strong> have
            not sold in 30+ days, representing{" "}
            <strong className="text-warning">{formatCurrencyCompact(deadStockVal)}</strong> in
            tied-up capital.
          </p>
        )}
        {mostUrgent && mostUrgent.days_of_stock_remaining != null && (
          <p>
            Your most urgent reorder is{" "}
            <strong className="text-foreground">{mostUrgent.item_name}</strong> with only{" "}
            <strong className="text-destructive">{mostUrgent.days_of_stock_remaining} days</strong> of
            stock remaining at current sales velocity.
          </p>
        )}
      </>
    );
  }, [health, outOfStock, criticalItems, lowStockCnt, deadList, deadStockVal, mostUrgent, velList]);

  const velocityColumns = useMemo(() => [
    { key: "item_name",              header: "Product",        render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
    { key: "current_stock",          header: "In Stock",       align: "right", render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.current_stock ?? 0))}</span> },
    { key: "avg_daily_sales",        header: "Avg Daily Sales",align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatQuantity(parseFloat(r.avg_daily_sales ?? 0))}</span> },
    { key: "days_of_stock_remaining",header: "Days Left",      align: "right", sortable: true, render: (r) => {
      const d = r.days_of_stock_remaining;
      return <span className={cn("text-xs font-bold tabular-nums", daysColor(d))}>{d ?? "∞"}</span>;
    }},
    { key: "stock_value_at_cost",    header: "Stock Value",    align: "right", render: (r) => <span className="text-xs font-mono tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.stock_value_at_cost ?? 0))}</span> },
  ], []);

  const slowColumns = useMemo(() => [
    { key: "item_name",   header: "Product",    render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
    { key: "qty_sold",    header: "Qty Sold",   align: "right", render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.qty_sold ?? 0))}</span> },
    { key: "last_sold_at",header: "Last Sale",  render: (r) => <span className="text-[11px] text-muted-foreground">{r.last_sold_at ? formatDate(r.last_sold_at) : "Never"}</span> },
    { key: "current_stock",header: "Stock",     align: "right", render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.current_stock ?? 0))}</span> },
  ], []);

  const deadColumns = useMemo(() => [
    { key: "item_name",          header: "Product",           render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
    { key: "days_since_last_sale",header: "Days Since Sale",  align: "right", sortable: true, render: (r) => <span className="text-xs font-bold tabular-nums text-destructive">{r.days_since_last_sale ?? "N/A"}</span> },
    { key: "current_stock",      header: "Stock",             align: "right", render: (r) => <span className="text-xs tabular-nums text-warning">{formatQuantity(parseFloat(r.current_stock ?? 0))}</span> },
    { key: "stock_value_at_cost",header: "Value at Cost",     align: "right", render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrency(parseFloat(r.stock_value_at_cost ?? 0))}</span> },
  ], []);

  return (
    <>
      <PageHeader
        title="Inventory Health"
        description="Stock velocity, critical levels, dead stock, and reorder recommendations."
        backHref="/analytics"
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-5 space-y-5">

          {/* Narrative */}
          <NarrativeBlock>
            {lVel
              ? <span className="animate-pulse">Analysing your inventory…</span>
              : (narrative ?? <span className="text-muted-foreground">Inventory data is loading or no issues detected.</span>)
            }
          </NarrativeBlock>

          {/* KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              label="Out of Stock"
              value={outOfStock > 0 ? outOfStock : "None"}
              sub="items need restocking"
              accent={outOfStock > 0 ? "destructive" : "success"}
            />
            <KPICard
              label="Low Stock"
              value={lowStockCnt > 0 ? lowStockCnt : "None"}
              sub="running low (< 7 days)"
              accent={lowStockCnt > 0 ? "warning" : "success"}
            />
            <KPICard
              label="Dead Stock"
              value={deadList.length > 0 ? deadList.length : "None"}
              sub="no sales in 30+ days"
              accent={deadList.length > 0 ? "muted" : "success"}
            />
            <KPICard
              label="Dead Stock Value"
              value={deadList.length > 0 ? formatCurrencyCompact(deadStockVal) : "—"}
              sub="tied-up capital"
              accent={deadStockVal > 0 ? "warning" : "muted"}
            />
          </div>

          {/* Critical Items Band */}
          {criticalItems.length > 0 && (() => {
            // Estimate daily revenue at risk from critical items
            const weeklyAtRisk = criticalItems.reduce((s, item) => {
              const daily = parseFloat(item.avg_daily_sales ?? 0);
              const daysLeft = item.days_of_stock_remaining ?? 0;
              const daysAtRisk = Math.max(0, 7 - daysLeft);
              // Approximate revenue impact using stock value / current stock as unit cost proxy
              const stockQty = parseFloat(item.current_stock ?? 0);
              const stockVal = parseFloat(item.stock_value_at_cost ?? 0);
              const unitRevProxy = stockQty > 0 ? (stockVal / stockQty) * 1.3 : 0; // assume 30% margin
              return s + daily * daysAtRisk * unitRevProxy;
            }, 0);
            return (
              <div className="rounded-xl border border-destructive/30 bg-destructive/4 overflow-hidden">
                <div className="px-5 py-3 border-b border-destructive/20 bg-destructive/[0.06] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-destructive">
                      Immediate Action Required — {criticalItems.length} Item{criticalItems.length !== 1 ? "s" : ""} ≤ 3 Days Stock
                    </h3>
                  </div>
                  {weeklyAtRisk > 0 && (
                    <div className="flex items-center gap-1.5 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-1">
                      <span className="text-[10px] font-semibold text-destructive">Est. weekly revenue at risk:</span>
                      <span className="text-[11px] font-bold text-destructive tabular-nums">{formatCurrencyCompact(weeklyAtRisk)}</span>
                    </div>
                  )}
                </div>
                <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {criticalItems.map((item, i) => (
                    <CriticalItemCard key={i} item={item} accent="destructive" />
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Low Stock Band */}
          {lowStockItems.length > 0 && (
            <div className="rounded-xl border border-warning/30 bg-warning/[0.04] overflow-hidden">
              <div className="px-5 py-3 border-b border-warning/20 bg-warning/[0.06] flex items-center gap-2">
                <Clock className="h-4 w-4 text-warning" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-warning">
                  Low Stock — Reorder Soon — {lowStockItems.length} Item{lowStockItems.length !== 1 ? "s" : ""}
                </h3>
              </div>
              <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
                {lowStockItems.map((item, i) => (
                  <CriticalItemCard key={i} item={item} accent="warning" />
                ))}
              </div>
            </div>
          )}

          {/* Stock Velocity Table */}
          <Section
            title="Stock Velocity"
            description="All items ranked by days of stock remaining (ascending)"
          >
            <DataTable
              columns={velocityColumns}
              data={velList}
              isLoading={lVel}
              emptyState={<EmptyState icon={Package} title="No velocity data" description="No stock velocity data available." compact />}
            />
          </Section>

          {/* Slow Moving Items */}
          <Section
            title="Slow-Moving Items"
            description="Items with very low sales in the selected period"
            action={<ShoppingCart className="h-4 w-4 text-muted-foreground opacity-40" />}
          >
            <DataTable
              columns={slowColumns}
              data={slowList}
              isLoading={lSlow}
              emptyState={<EmptyState icon={Package} title="No slow-moving items" description="All products have reasonable sales velocity." compact />}
            />
          </Section>

          {/* Dead Stock Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-muted/20 flex items-center justify-between">
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Dead Stock (30 days)</h3>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">Items with zero sales in the last 30 days</p>
              </div>
              {deadStockVal > 0 && (
                <div className="flex items-center gap-2">
                  <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-warning tabular-nums">
                    Total: {formatCurrencyCompact(deadStockVal)}
                  </span>
                </div>
              )}
            </div>
            <div className="p-5">
              <DataTable
                columns={deadColumns}
                data={deadList}
                isLoading={lDead}
                emptyState={<EmptyState icon={Package} title="No dead stock" description="All items have had recent sales. Great news!" compact />}
              />
            </div>
          </div>

          {/* Back link */}
          <div className="flex items-center gap-2 pt-2 pb-4">
            <Link to="/analytics"><Button variant="outline" size="sm" className="gap-1.5"><ArrowLeft className="h-3.5 w-3.5" />Business Health</Button></Link>
            <Link to="/inventory"><Button variant="outline" size="sm">Manage Inventory</Button></Link>
          </div>

        </div>
      </div>
    </>
  );
}
