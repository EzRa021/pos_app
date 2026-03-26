# Analytics Upgrade Plan — Quantum POS
> Business Intelligence Redesign: From Raw Numbers to AI-Powered Insights

---

## 1. Current State Assessment

### What Exists (and Works)

The backend is **near-complete**: 24 analytics commands covering sales, profitability,
inventory velocity, cashier performance, returns, discounts, customer behaviour, VAT
reporting, and period comparisons. All commands are registered in the HTTP dispatcher and
all React Query hooks exist on the frontend.

The frontend is an 11-tab `AnalyticsPage` with Recharts charts and DataTable components.
It is functional but it **only presents raw numbers**. There are no explanations, no
severity signals, no recommended actions, and no navigation to the underlying records.

### What is Broken Right Now (Must Fix First)

These are silent bugs — the page renders but the data is wrong or missing:

| Tab | Problem | Root Cause |
|-----|---------|------------|
| Discounts | "Most Discounted Items" table is always empty | Frontend reads `data?.by_item` — field does not exist in backend response |
| Returns | All 4 KPI cards show zero | Frontend reads `data?.summary` — backend returns no such wrapper |
| Customers | Total/Active/Lapsed KPI cards show zero | Backend returns a flat array; frontend expects aggregated counts |
| Tax | "VAT by Tax Category" table is always empty | Frontend reads `data?.vat_by_category` — backend returns period series only |
| Comparison | Table sometimes shows wrong data | Frontend treats `data` as an array; it should read `data?.metrics` |

These 5 fixes are prerequisites — they must be completed before any redesign work begins.

---

## 2. Guiding Principle: The Business Advisor Model

Every screen in the redesigned analytics module should answer three questions
automatically:

1. **What is happening?** — The number or chart.
2. **Is this good or bad?** — Context through comparison, thresholds, and colour.
3. **What should I do about it?** — An actionable recommendation or next step.

The UI should read like a smart business advisor writing a morning briefing, not like a
spreadsheet export. Users should be able to open analytics and immediately understand
whether the business is healthy, what deserves attention, and where to dig deeper.

---

## 3. Architecture Changes

### 3.1 Page Structure: From Tabs to a Navigable BI System

The current single-page tab layout limits depth. Replace it with a **two-level
navigation** model:

```
/analytics                        ← Landing: Business Health dashboard
/analytics/sales                  ← Sales deep-dive
/analytics/inventory              ← Inventory health
/analytics/products/:itemId       ← Single-product performance page
/analytics/customers              ← Customer intelligence
/analytics/customers/:customerId  ← Single-customer behaviour page
/analytics/cashiers               ← Team performance
/analytics/cashiers/:userId       ← Single-cashier performance page
/analytics/profitability          ← P&L and margin analysis
/analytics/reports/tax            ← Tax / VAT report (printable)
/analytics/reports/eod            ← Already exists — link it here
```

The `/analytics` landing page replaces the tab bar. Each section is a dedicated page
with its own URL, scroll position, and breadcrumb. This allows deep-linking, browser
history, and "open in new tab" for managers reviewing reports.

### 3.2 New Frontend Module: `src/features/analytics/insights/`

All human-readable insight text is computed on the **frontend** from the data already
returned by the backend. No new backend AI service is needed. The insight engine is a
set of pure functions that take data and return `Insight[]` objects:

```js
// Insight shape
{
  id:       "top_item_streak",
  level:    "info" | "success" | "warning" | "critical",
  title:    "Product X leads sales this month",
  body:     "Rice (5kg) has been sold 312 times this month — 18% more than last month.
             It is the #1 item by both volume and revenue for two consecutive months.",
  action:   { label: "View item", href: "/items/uuid-here" },
  data:     { item_id, qty, trend_pct },
}
```

Rules are grouped by domain (sales, inventory, customers, etc.) and evaluated every time
the relevant query resolves. Insights are surfaced in two places:

1. **Landing page insight feed** — a prioritised card list ordered by `level` (critical
   first), showing the 6–10 most important insights across all domains.
2. **Section headers** — each analytics section shows 1–3 domain-specific insights at
   the top, before any chart.

### 3.3 New Backend Command: `get_business_health_summary`

A single endpoint that returns the data the landing page needs without making 8 separate
requests. It aggregates across modules:

```
Returns:
  today_revenue          today's completed transaction total
  today_transactions     count
  today_vs_yesterday     growth % (today vs same time yesterday)
  week_revenue           rolling 7-day total
  week_vs_last_week      growth % (this week vs last week)
  month_revenue          rolling 30-day total
  month_vs_last_month    growth % (this month vs last month)
  gross_profit_margin    (net_sales - cogs) / net_sales * 100 for current month
  low_stock_count        items below reorder_point
  out_of_stock_count     items with stock = 0 that are active
  open_credit_total      sum of outstanding_balance across all active customers
  overdue_credit_count   credit sales past due_date with status != 'paid'
  pending_expenses_count approved_status = 'pending'
  pending_po_count       purchase_orders with status in ('pending','approved')
  top_item_this_month    item_name + qty_sold
  top_cashier_this_month cashier_name + total_sales
```

This replaces the orphaned `getDashboardSummary` reference in the frontend commands file
that currently has no backend implementation.

### 3.4 Extend Four Broken Backend Responses

Each of the 5 broken frontend cases requires a small, surgical backend change:

**Discounts** — Add a `by_item` array to `DiscountAnalytics`:
```
SELECT i.item_name, SUM(ti.discount) as total_discount, COUNT(*) as tx_count
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
JOIN items i ON i.id = ti.item_id
WHERE ti.discount > 0 AND t.store_id = $1 AND t.status = 'completed'
GROUP BY i.id, i.item_name
ORDER BY total_discount DESC
LIMIT 20
```

**Returns** — Add a `summary` struct to `ReturnAnalysisReport` with four pre-computed
aggregates extracted from existing query results (no new query needed — derive from
`by_item` totals in Rust code).

**Customers** — Change `get_customer_analytics` to return a wrapper:
```rust
pub struct CustomerAnalyticsReport {
    pub total_customers:     i64,
    pub active_customers:    i64,  // purchased in last 90 days
    pub lapsed_customers:    i64,  // 90–365 days since last purchase
    pub avg_lifetime_value:  f64,
    pub items:               Vec<CustomerAnalytics>,
}
```

**Tax** — Add a `vat_by_category` field to the tax report response by running an
additional GROUP BY on `tax_categories.name`.

**Comparison** — Frontend fix only: change `Array.isArray(data)` check to read
`data?.metrics`.

---

## 4. Landing Page: Business Health Dashboard

The `/analytics` landing page is the first thing managers see every morning. It has three zones:

### Zone A — Pulse Strip (top, always visible)

Five live metrics in a horizontal bar, always rendered even while data loads:

```
Today's Revenue  |  Transactions  |  Gross Margin %  |  Low Stock Alerts  |  Open Credit
₦485,200         |  127           |  34.2%           |  8 items ⚠         |  ₦92,000
vs yesterday ↑12%  vs yesterday ↑5%   vs last month ↓2%   3 critical          6 customers
```

Each metric shows the trend direction and percentage against the comparison period.
Click on any metric to navigate to its full analytics section.

### Zone B — AI Insight Feed (main content, left 65%)

A prioritised feed of generated insights, newest first within each severity level.
Critical insights (red) always appear first. Maximum 10 cards shown, with a "View all"
link.

Each insight card structure:
- **Severity strip** (3px top border: red/amber/blue/green)
- **Icon** matching the domain (Package, Users, TrendingDown, etc.)
- **Title** — one bold sentence: "You may run out of Rice (5kg) in 2 days"
- **Body** — 2–3 sentences of plain English explanation with specific numbers
- **Action button** — deep link to the relevant page/item/customer
- **Time** — "Updated 4 min ago" (shows when the underlying query was last fetched)

### Zone C — Quick Charts (right 35%)

Three small sparkline charts stacked vertically:
- Revenue last 30 days (area chart, minimal)
- Top 5 items this month (small horizontal bar)
- Payment method split today (donut)

### Insight Categories and Rules

The insight engine evaluates these rules on every data refresh:

**Sales Insights**
- Growth alert (positive): Revenue this week is >10% above last week → success
- Growth alert (negative): Revenue this week is >10% below last week → warning
- Best day: Identifies the peak revenue day this month
- Streak detection: Same item is #1 for 2+ consecutive months
- Slow period: Revenue today is >30% below same weekday last month → warning

**Inventory Insights**
- Out-of-stock critical: Any active tracked item with stock = 0 → critical
- Low stock critical: Items with `days_of_stock_remaining` ≤ 3 → critical
- Low stock warning: Items with `days_of_stock_remaining` ≤ 7 → warning
- Dead stock: Items with positive stock and zero sales > 60 days → warning
- Overstocked: Items with > 180 days of stock remaining AND stock_value > threshold

**Product Insights**
- Top performer: Specific item that is #1 by revenue with month-over-month trend
- Low margin alert: Any item with margin_percent < 5% that was sold recently → warning
- Price consistency: Item sold at significantly different prices in same period
- Reorder recommendation: Combines `days_of_stock_remaining` with typical lead time

**Customer Insights**
- Lapsed customers: Count of customers with last purchase > 60 days → info
- Credit risk: Any customer with outstanding_balance > credit_limit (if applicable)
- Overdue credit: Credit sales past due_date that remain unpaid → warning/critical
- Top customer retention: Best customer this month vs last month comparison

**Operational Insights**
- High void rate: Any cashier with void_count / transaction_count > 3% → warning
- High discount rate: Total discounts / gross_sales > 15% → warning
- High return rate: return_value / gross_sales > 5% → warning
- Pending approvals: Expenses awaiting approval > 3 → info
- Open shift: A shift has been open > 14 hours without a close → warning

---

## 5. Sales Analytics Page (`/analytics/sales`)

### Header Section
- Date range picker (presets: Today, Yesterday, This Week, Last Week, This Month, Last
  Month, This Year, Custom)
- Period granularity toggle: Day / Week / Month
- Export button (CSV of all data in the current view)

### Section 1 — Revenue Overview (4 KPI cards + area chart)
Cards: Gross Sales, Net Sales, Avg Transaction Value, Total Transactions
Each card shows: current value + change % vs previous equivalent period + sparkline

Area chart: Revenue by period (dual series: gross vs net)

**Insight block** above the chart: 1–2 auto-generated insights, e.g.:
> "Sales are up 18% this week compared to last week, driven primarily by a 34% increase
> in Thursday evening transactions between 18:00 and 20:00. This is consistent with
> last month's peak-hour pattern."

### Section 2 — Payment Method Breakdown
Horizontal stacked bar by day/week, showing Cash / Card / Transfer / Wallet / Credit
split. Below: payment method summary table with totals and % share.

**Insight**: Which method is growing fastest, which is declining.

### Section 3 — Peak Hours Heatmap
7 columns (Mon–Sun) × 24 rows (00:00–23:00), each cell coloured by revenue intensity.
Darker = more revenue. Hover shows exact revenue + transaction count.
Below: plain English summary, e.g.
> "Your busiest period is Friday 17:00–19:00 (₦48,200 avg) followed by Saturday
> 12:00–14:00. Staffing these windows fully maximises throughput."

### Section 4 — Comparison Strip
Current vs previous period side-by-side for: Revenue, Transactions, Avg Basket,
Discounts, Tax. Each row shows: current value, previous value, change amount, change %.
Colour: green (positive growth), red (decline), grey (no change).

---

## 6. Product Performance Page (`/analytics/products`)

### Section 1 — Top Performers (filterable by time range + category)
Large horizontal bar chart: top 20 items by revenue, bars coloured by category.
Click any bar → navigates to `/analytics/products/:itemId`.

Table below chart: item_name, category, qty_sold, revenue, avg_price, margin %.
Sortable by all columns.

**Insight block**: "3 items account for 42% of your total revenue this month. Your top
performer, Rice (5kg), has been #1 for 3 consecutive months."

### Section 2 — Profitability Ladder
Items sorted by gross_profit descending. Three coloured zones:
- Green zone (top 25%): High-margin, high-revenue stars
- Amber zone (middle 50%): Core catalogue
- Red zone (bottom 25%): Low-margin or loss-making items

Each item shows: cost price, selling price, margin %, total profit contribution.

**Insight**: "You have 8 items currently selling below a 10% margin. Together they
generated ₦12,400 in revenue but only ₦840 in gross profit. Consider repricing."

### Section 3 — Stock Velocity (Sorted by urgency)
Items grouped into urgency bands with coloured section dividers:
- 🔴 Critical (≤3 days): Needs immediate reorder
- 🟠 Low (4–7 days): Order this week
- 🟡 Adequate (8–60 days): Healthy
- 🔵 Overstocked (>60 days): Review pricing / promotions

For each item in the critical/low bands: item_name, current stock (with unit),
avg_daily_sales, estimated days remaining, a "Create PO" quick-action button.

**Insight**: "2 items will likely run out in the next 3 days based on current sales rate.
Reorder Rice (5kg) and Vegetable Oil (1L) today."

### Section 4 — Dead Stock
Items with positive stock and zero sales in the last 30 days.
Each row: item_name, days_since_last_sale, current_stock, stock_value at cost.
Total dead stock value shown as a warning KPI at the top.

**Insight**: "You have ₦84,200 worth of stock that has not sold in 30+ days. Consider
running a promotion or returning to supplier to free up capital."

### Single-Product Page (`/analytics/products/:itemId`)

A dedicated drill-down page for one item. Reached by clicking any item in the analytics
tables or the items list page.

Sections:
1. **Header KPIs**: Revenue (this month), Qty Sold (this month), Margin %, Current Stock
2. **Revenue trend chart**: 90-day daily revenue for this item
3. **Month-over-month comparison**: Last 6 months side by side
4. **Customer breakdown**: Which customers buy this item most
5. **Return rate**: Returns for this specific item (count + % of sales)
6. **Stock history**: Stock adjustments and sales impact over 30 days
7. **Insight**: "This is your most consistent product. It has sold every single day this
   month with zero stockouts. Current stock of 240 units gives you ~12 days of supply
   based on average daily sales."

---

## 7. Inventory Analytics Page (`/analytics/inventory`)

### Section 1 — Inventory Health Summary (4 KPI cards)
- Total Stock Value (at cost)
- Low Stock Items count (below reorder point)
- Out of Stock Items count
- Dead Stock Value

**Insight strip**: "Your total inventory is valued at ₦2.4M. You have 3 items completely
out of stock that were sold last week — these represent missed revenue of approximately
₦18,000 per day."

### Section 2 — Category Breakdown
Horizontal bar: stock value by category. Helps identify where capital is concentrated.
Below: table with category, item count, total stock value, low stock count.

### Section 3 — Inventory Turnover by Item
Table: item_name, current_stock, avg_monthly_sales, turnover_ratio (sales / avg_stock).
High turnover = good (selling fast). Low turnover = potential overstock.
Coloured by turnover ratio: green (>4/month), amber (1–4), red (<1).

### Section 4 — Reorder Recommendations
Action-oriented section showing items that need attention, with:
- Item name and current stock
- Reorder point (from item settings)
- Suggested order quantity (based on avg_daily_sales × typical lead time)
- Supplier name (if linked)
- "Create PO" button that pre-fills a purchase order

---

## 8. Customer Analytics Page (`/analytics/customers`)

### Section 1 — Customer Base Overview (4 KPI cards)
- Total Active Customers
- Customers Who Purchased This Month
- Lapsed Customers (no purchase in 60+ days)
- Average Lifetime Value

**Insight**: "23 customers who purchased last month have not returned this month. These
customers contributed an average of ₦8,400 each last month. A targeted follow-up or
loyalty promotion could recover significant revenue."

### Section 2 — Top Customers (by revenue)
Table: rank, customer_name, phone, total_spent (this period), visit_count, avg_basket,
last_purchase_date, days_since_purchase.

Days-since column coloured: green (<14), amber (15–60), red (>60).
Click customer name → navigates to `/analytics/customers/:customerId`.

### Section 3 — Purchase Frequency Distribution
Bar chart: how many customers bought 1×, 2–3×, 4–10×, 10×+ in the period.
Shows the health of customer engagement. A well-performing store has a large
"repeat buyer" segment.

### Section 4 — Credit Risk Panel

Shown only to users with the `credit_sales.view` permission.

Table: customer_name, outstanding_balance, oldest_unpaid_date, days_overdue.
Coloured by risk: green (within terms), amber (15–30 days late), red (>30 days late).
Total outstanding balance shown as a prominent KPI.

**Insight**: "You have ₦145,000 in outstanding credit from 6 customers. 2 customers
(₦84,000 combined) are more than 30 days overdue. Collecting these balances is your
highest-priority cash flow action this week."

### Single-Customer Page (`/analytics/customers/:customerId`)

Drill-down page for one customer. Linked from the analytics table and from the customer
detail page sidebar.

Sections:
1. **Header**: Customer name, total lifetime spend, visit count, avg basket, loyalty points
2. **Purchase timeline**: Chart showing monthly spend over last 12 months
3. **Top items bought**: Bar chart of their favourite products
4. **Payment method history**: Which methods they use
5. **Credit history** (if applicable): Outstanding balance, payment dates, on-time rate
6. **Insight**: "Chioma Obi is your highest-value customer this month with ₦42,000 in
   purchases. She visits approximately twice a week and mainly buys from the Food and
   Beverages category. Her last visit was 3 days ago."

---

## 9. Team Performance Page (`/analytics/cashiers`)

### Section 1 — Team KPIs (4 cards)
- Total Sales by Team
- Transactions Processed
- Avg Basket Value (team average)
- Combined Void Rate %

### Section 2 — Cashier Leaderboard
Card grid (one card per cashier, sorted by total_sales):
Each card: cashier avatar, name, total_sales, tx_count, avg_basket, void_rate %.
Colour border: success (top performer), default (mid), warning (high void rate).

**Insight**: "Amaka leads the team with ₦380,000 in sales this month (22% of total).
Her average basket of ₦4,200 is the highest on the team. Tunde has a void rate of 4.2%,
which is above the recommended 2% threshold — this may need investigation."

### Section 3 — Peak Hour Coverage
The heatmap from the current page, with an overlay showing which cashier was active
during each hour (based on shift records). Helps align staffing to demand.

### Section 4 — Discount Behaviour
Table: cashier_name, total_discounts_given, avg_discount_per_transaction, discount_rate %.
High discounters highlighted in amber/red.

**Insight**: "Discounts totalled ₦28,400 this month (3.2% of gross sales). Emmanuel
accounts for 61% of all discounts given. Consider reviewing discount authorisation
policies."

### Single-Cashier Page (`/analytics/cashiers/:userId`)

Drill-down for one cashier. Linked from the team table.

Sections:
1. Header KPIs: Sales, Transactions, Avg Basket, Voids, Discounts Given
2. Sales trend chart: Daily sales over last 30 days
3. Peak hours chart: Their personal busiest times
4. Item performance: Top 10 items they sold
5. Shift history table: Last 10 shifts with duration, sales, cash difference
6. Insight summary

---

## 10. Profitability Page (`/analytics/profitability`)

### Section 1 — P&L Waterfall (visual)
A vertical waterfall chart showing the progression:
```
Gross Sales       ₦1,200,000  ████████████████████
- Discounts          -₦48,000  ██
= Net Sales       ₦1,152,000  ███████████████████
- Cost of Goods     -₦720,000  ████████████
= Gross Profit      ₦432,000  ███████
- Expenses           -₦85,000  ██
= Net Profit        ₦347,000  █████
```
Each bar coloured: additions = green, subtractions = red, totals = blue.

### Section 2 — Margin Analysis by Category
Scatter plot: X-axis = revenue, Y-axis = margin %. Bubble size = qty_sold.
Quadrants labelled:
- High revenue, high margin → Star products (top right)
- High revenue, low margin → Volume drivers (bottom right)
- Low revenue, high margin → Niche winners (top left)
- Low revenue, low margin → Review/discontinue (bottom left)

### Section 3 — Expense Breakdown
Donut chart: expenses by category. Table: category, amount, % of net profit.
Month-over-month change for each category.

**Insight**: "Your gross margin is 37.5%, which is within the healthy range for retail.
However, operating expenses grew 22% this month versus last month, compressing net margin
from 32.1% to 30.1%. The largest increase was in the 'Logistics' expense category."

---

## 11. Reports Section

### Tax / VAT Report (`/analytics/reports/tax`)

Designed to be printed and handed to an accountant or filed with FIRS.

- Month selector (not date range — VAT is filed monthly)
- Summary KPIs: Total VAT, Gross Sales, Net Sales (ex-VAT), Transaction Count
- Table 1: VAT collected by tax category (category name, rate %, taxable sales, VAT)
- Table 2: Monthly series for the last 12 months
- "Export CSV" button and "Print" button

This requires the backend fix described in section 3.4 (add `vat_by_category`).

---

## 12. Insight Engine — Full Rule Catalogue

The insight engine (`src/features/analytics/insights/`) is organised into files by domain:

```
insights/
  index.js          ← aggregates all insights, deduplicates, sorts by level
  sales.js          ← revenue trends, growth, peak periods
  inventory.js      ← stockouts, low stock, dead stock, overstock
  products.js       ← top performers, margin alerts, streak detection
  customers.js      ← lapsed, credit risk, overdue, retention
  operations.js     ← void rates, discount abuse, shift alerts
  profitability.js  ← margin compression, expense growth
```

### Insight Level Definitions

| Level | Colour | Meaning | Example |
|-------|--------|---------|---------|
| `critical` | Red | Needs action today | Out of stock, overdue credit >30d |
| `warning` | Amber | Needs attention this week | Low stock ≤7d, void rate >3% |
| `info` | Blue | FYI, no urgency | Revenue up 5%, lapsed customer count |
| `success` | Green | Celebrate a win | Revenue up 18%, top cashier milestone |

### Key Insight Rules

**Inventory: Out of Stock**
```
Trigger: any item where item_stock.available_quantity <= 0 AND item_settings.track_stock = true
          AND item_settings.is_active = true
Level: critical
Title: "{item_name} is out of stock"
Body:  "This item had {qty_sold_last_7d} units sold in the last 7 days and is now
        completely out of stock. Every day without stock costs approximately
        {daily_revenue_lost} in lost revenue."
Action: "Create Purchase Order"  →  /purchase-orders/create?item_id=...
```

**Inventory: Days of Stock Remaining**
```
Trigger: days_of_stock_remaining <= 3  (from get_stock_velocity)
Level: critical
Title: "{item_name} will run out in ~{days} days"
Body:  "Based on average daily sales of {avg_daily_sales} units, your current stock
        of {current_stock} units will last approximately {days} more days."
Action: "Reorder now"  →  /purchase-orders/create?item_id=...
```

**Sales: Weekly Growth**
```
Trigger: week_vs_last_week from get_business_health_summary
If >10%:
  Level: success
  Title: "Sales are up {pct}% this week"
  Body:  "Your revenue this week is {current_week} compared to {last_week} last week
          — a {change_amount} increase. This is your strongest week in 4 weeks."

If < -10%:
  Level: warning
  Title: "Sales are down {pct}% this week"
  Body:  "Revenue this week is {change_amount} below last week's figure. This is the
          second consecutive week of decline. Your busiest period was {peak_day} —
          consider a promotional push on slower days."
```

**Products: Consecutive Month Leader**
```
Trigger: same item is #1 by revenue for 2+ consecutive months
Level: success
Title: "{item_name} leads sales for the {n}th consecutive month"
Body:  "{item_name} was sold {qty} times this month, generating {revenue} in revenue.
        It has been your best-selling product for {n} months running."
Action: "View item performance"  →  /analytics/products/:itemId
```

**Customers: Overdue Credit**
```
Trigger: any credit_sale with due_date < NOW() and status != 'paid'
         AND (NOW() - due_date) > 30 days
Level: critical (if >30d), warning (if 7–30d)
Title: "{n} customers have overdue credit payments"
Body:  "₦{total_overdue} is outstanding from {n} customers who are more than
        {min_days_overdue} days past their due date. The longest-running debt is
        {max_days_overdue} days old (₦{amount} from {customer_name})."
Action: "Review credit sales"  →  /credit-sales
```

**Operations: High Void Rate**
```
Trigger: cashier where void_count / transaction_count > 0.03
Level: warning
Title: "{cashier_name}'s void rate is {rate}% this month"
Body:  "{cashier_name} has voided {void_count} transactions this month,
        representing {void_amount} in reversed sales. A rate above 2% may indicate
        training issues, technical problems, or requires investigation."
Action: "View cashier performance"  →  /analytics/cashiers/:userId
```

**Profitability: Margin Compression**
```
Trigger: gross_margin_percent this month < gross_margin_percent last month - 2
Level: warning
Title: "Gross margin dropped {drop_pct}% this month"
Body:  "Your gross margin fell from {prev_margin}% last month to {curr_margin}% this
        month. The main driver appears to be higher COGS on {top_cogs_category}.
        Check whether supplier prices have increased for your key items."
Action: "View profitability"  →  /analytics/profitability
```

---

## 13. Backend New Command: `get_business_health_summary`

**Location**: `src-tauri/src/commands/analytics.rs`

This single command powers the landing page pulse strip. It runs 4–5 targeted
sub-queries wrapped in a CTE to avoid N+1 calls. All calculations happen server-side.

```sql
-- Suggested CTE structure
WITH
today_sales AS (
  SELECT COALESCE(SUM(total_amount), 0) as revenue,
         COUNT(*) as transactions
  FROM transactions
  WHERE store_id = $1 AND status = 'completed'
    AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE
),
yesterday_sales AS (
  SELECT COALESCE(SUM(total_amount), 0) as revenue
  FROM transactions
  WHERE store_id = $1 AND status = 'completed'
    AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE - INTERVAL '1 day'
),
week_sales AS (
  SELECT COALESCE(SUM(total_amount), 0) as revenue
  FROM transactions
  WHERE store_id = $1 AND status = 'completed'
    AND created_at >= DATE_TRUNC('week', NOW())
),
last_week_sales AS (
  SELECT COALESCE(SUM(total_amount), 0) as revenue
  FROM transactions
  WHERE store_id = $1 AND status = 'completed'
    AND created_at >= DATE_TRUNC('week', NOW()) - INTERVAL '1 week'
    AND created_at <  DATE_TRUNC('week', NOW())
),
pl_this_month AS (
  SELECT
    COALESCE(SUM(t.total_amount), 0) as net_sales,
    COALESCE(SUM(ti.quantity * i.cost_price), 0) as cogs
  FROM transactions t
  JOIN transaction_items ti ON ti.transaction_id = t.id
  JOIN items i ON i.id = ti.item_id
  WHERE t.store_id = $1 AND t.status = 'completed'
    AND t.created_at >= DATE_TRUNC('month', NOW())
),
stock_alerts AS (
  SELECT
    COUNT(*) FILTER (WHERE is.available_quantity <= 0) as out_of_stock,
    COUNT(*) FILTER (WHERE is.available_quantity > 0
                       AND is.available_quantity <= COALESCE(ist.reorder_point, 5)) as low_stock
  FROM item_stock is
  JOIN item_settings ist ON ist.item_id = is.item_id
  WHERE is.store_id = $1 AND ist.is_active = TRUE AND ist.track_stock = TRUE
),
credit_summary AS (
  SELECT
    COALESCE(SUM(c.outstanding_balance), 0) as total_outstanding,
    COUNT(*) FILTER (
      WHERE cs.due_date IS NOT NULL AND cs.due_date < NOW() AND cs.status != 'paid'
    ) as overdue_count
  FROM customers c
  LEFT JOIN credit_sales cs ON cs.customer_id = c.id AND cs.store_id = $1
  WHERE c.store_id = $1 AND c.is_active = TRUE
)
SELECT
  t.revenue  as today_revenue,
  t.transactions as today_transactions,
  y.revenue  as yesterday_revenue,
  w.revenue  as week_revenue,
  lw.revenue as last_week_revenue,
  pl.net_sales - pl.cogs as gross_profit,
  CASE WHEN pl.net_sales > 0
    THEN ROUND(((pl.net_sales - pl.cogs) / pl.net_sales * 100)::numeric, 1)
    ELSE 0 END as gross_margin_percent,
  sa.out_of_stock,
  sa.low_stock,
  cr.total_outstanding,
  cr.overdue_count
FROM today_sales t, yesterday_sales y, week_sales w,
     last_week_sales lw, pl_this_month pl, stock_alerts sa, credit_summary cr
```

The Rust handler computes growth percentages from the raw values before serialising.

---

## 14. Backend Fix Queries

### 14.1 Fix: Discount Analytics — Add `by_item`

Add to the existing `get_discount_analytics` response:

```sql
SELECT
  i.id::text as item_id,
  i.item_name,
  SUM(CASE WHEN ti.unit_price > 0
        THEN ti.discount / ti.unit_price * 100 ELSE 0 END) as discount_pct_sum,
  SUM(ti.discount * ti.quantity) as total_discount,
  COUNT(*) as tx_count,
  SUM(ti.quantity) as qty_sold
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
JOIN items i ON i.id = ti.item_id
WHERE t.store_id = $1 AND t.status = 'completed'
  AND ti.discount > 0
  AND ($2::timestamptz IS NULL OR t.created_at >= $2)
  AND ($3::timestamptz IS NULL OR t.created_at <= $3)
GROUP BY i.id, i.item_name
ORDER BY total_discount DESC
LIMIT 20
```

### 14.2 Fix: Return Analysis — Derive `summary` from existing data

No new query needed. After fetching `by_item` and `by_cashier`, compute in Rust:

```rust
let total_return_value: Decimal = by_item.iter().map(|r| r.return_value).sum();
let return_count: i64 = by_cashier.iter().map(|r| r.total_return_count).sum();
// return_rate comes from existing overall_return_rate query
let summary = ReturnSummary {
    total_return_value,
    return_count,
    return_rate: overall_rate, // already computed
    items_returned: by_item.iter().map(|r| r.total_returned).sum(),
};
```

### 14.3 Fix: Customer Analytics — Wrap in report struct

Change the return type from `Vec<CustomerAnalytics>` to `CustomerAnalyticsReport`.
Compute aggregates from the already-fetched list:

```rust
let lapsed_days = filters.lapsed_days.unwrap_or(60);
let active_count = items.iter()
    .filter(|c| c.days_since_last_purchase
                  .map_or(false, |d| d <= lapsed_days))
    .count() as i64;
let avg_ltv = if items.is_empty() { 0.0 } else {
    items.iter().map(|c| c.total_spent).sum::<f64>() / items.len() as f64
};
```

### 14.4 Fix: Tax Report — Add `vat_by_category`

Add a second query to the tax report command:

```sql
SELECT
  tc.name as category_name,
  tc.rate as rate,
  SUM(t.total_amount - t.tax_amount) as taxable_sales,
  SUM(t.tax_amount) as vat_amount
FROM transactions t
JOIN items i ON i.id = ANY(
    SELECT item_id FROM transaction_items WHERE transaction_id = t.id
)
JOIN tax_categories tc ON tc.id = i.tax_category_id
WHERE t.store_id = $1 AND t.status = 'completed'
  AND ($2::timestamptz IS NULL OR t.created_at >= $2)
  AND ($3::timestamptz IS NULL OR t.created_at <= $3)
GROUP BY tc.id, tc.name, tc.rate
ORDER BY vat_amount DESC
```

---

## 15. Navigation Integration

Analytics must be reachable from every relevant module, not just the sidebar.

### Cross-Module Deep Links (add these)

| Location | Link to Add |
|----------|------------|
| Item detail page (`/items/:id`) | "View Sales Analytics" → `/analytics/products/:id` |
| Items table row action | Analytics icon → `/analytics/products/:id` |
| Customer detail page | "Purchase Analytics" → `/analytics/customers/:id` |
| Customer table row | Analytics icon → `/analytics/customers/:id` |
| Cashier/User detail | "Performance" → `/analytics/cashiers/:userId` |
| Shift close summary | "View Analytics" → `/analytics/sales` (pre-filtered to that shift date) |
| NotificationBell low-stock alert | Click → `/analytics/inventory` |
| Sidebar reorder alert badge | Click → `/analytics/inventory` |

### Insight Card Deep Links (existing data, new navigation)

Every insight card's `action` button navigates to the specific record. This makes the
landing page a single entry point from which users can reach any relevant screen in one
click.

---

## 16. Performance & Data Quality

### New Database Indexes to Add (new migration)

```sql
-- analytics.rs heavily filters on these combinations
CREATE INDEX IF NOT EXISTS idx_transactions_store_status_created
    ON transactions(store_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaction_items_tx_item
    ON transaction_items(transaction_id, item_id);

CREATE INDEX IF NOT EXISTS idx_items_store_active
    ON items(store_id, id) WHERE cost_price > 0;

CREATE INDEX IF NOT EXISTS idx_item_stock_store
    ON item_stock(store_id, item_id);

CREATE INDEX IF NOT EXISTS idx_returns_store_status
    ON returns(store_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shifts_store_cashier
    ON shifts(store_id, opened_by, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_sales_due_status
    ON credit_sales(store_id, due_date, status);
```

These indexes cover the JOIN conditions in the top 6 most expensive analytics queries
(`get_profit_analysis`, `get_cashier_performance`, `get_stock_velocity`,
`get_return_analysis`, `get_customer_analytics`, `get_comparison_report`).

### Frontend Query Stale Times (tune these)

| Hook | Current staleTime | Recommended |
|------|------------------|-------------|
| `useSalesSummary` | 2 min | 2 min ✓ |
| `useBusinessHealth` (new) | — | 60 sec (landing page pulse) |
| `useStockVelocity` | 2 min | 5 min (stock changes infrequently) |
| `useDeadStock` | 2 min | 30 min (changes very slowly) |
| `useCashierPerformance` | 2 min | 5 min |
| `usePeakHoursAnalysis` | 2 min | 60 min (historical, rarely changes) |
| `useTaxReport` | 2 min | 10 min |
| `useComparisonReport` | 2 min | 5 min |

---

## 17. Implementation Order

Work in this sequence. Each phase is independently shippable.

### Phase 1 — Fix Existing Bugs (1–2 days)
1. Fix `ComparisonTab`: read `data?.metrics` instead of treating `data` as array
2. Fix `ReturnAnalysisReport`: derive summary in Rust from existing by_item/by_cashier data
3. Fix `CustomerAnalytics`: add wrapper struct in Rust, compute aggregates server-side
4. Fix `DiscountAnalytics`: add `by_item` sub-query to existing command
5. Fix `TaxReport`: add `vat_by_category` sub-query to existing command

All five fixes are localised changes. No schema migrations needed. Test each tab renders
correctly after each fix.

### Phase 2 — Insight Engine (2–3 days)
1. Create `src/features/analytics/insights/` module with rule functions
2. Implement rules for: out-of-stock, low stock, overdue credit, weekly growth, void rate
3. Build the `InsightCard` component (severity strip, icon, title, body, action button)
4. Build the `InsightFeed` component (list of InsightCard, sorted by level)
5. Wire insight feed into the existing `AnalyticsPage` Overview tab header

### Phase 3 — Landing Page Redesign (2–3 days)
1. Add `get_business_health_summary` backend command + model + HTTP registration
2. Add `useBusinessHealth` hook in `useAnalytics.js`
3. Build the new `/analytics` landing page with Pulse Strip + InsightFeed + Quick Charts
4. Update router to make `/analytics` the landing and existing page `/analytics/detail`
   (or restructure with nested routes)

### Phase 4 — Product + Customer Drill-Down Pages (3–4 days)
1. Build `/analytics/products/:itemId` single-product page
2. Build `/analytics/customers/:customerId` single-customer page
3. Add deep-link buttons to item detail, customer detail, and analytics tables
4. Build `/analytics/cashiers/:userId` single-cashier page

### Phase 5 — Dedicated Section Pages (3–4 days)
1. Refactor each analytics tab into its own page component with route
2. Add the Peak Hours heatmap to the Sales page
3. Build the Inventory page with reorder recommendations and "Create PO" quick-actions
4. Build the Profitability waterfall chart section
5. Build the printable Tax report page

### Phase 6 — Polish & Performance (1–2 days)
1. Add the new database indexes (new migration file)
2. Tune stale times per the table in section 16
3. Add loading skeleton states to insight cards
4. Add export (CSV) buttons to all main tables
5. Verify all deep links work correctly from every origin page

---

## 18. Files to Create / Modify

### New Files

```
src/features/analytics/insights/index.js
src/features/analytics/insights/sales.js
src/features/analytics/insights/inventory.js
src/features/analytics/insights/products.js
src/features/analytics/insights/customers.js
src/features/analytics/insights/operations.js
src/features/analytics/insights/profitability.js
src/features/analytics/InsightCard.jsx
src/features/analytics/InsightFeed.jsx
src/pages/analytics/AnalyticsLanding.jsx        ← new landing page
src/pages/analytics/SalesPage.jsx
src/pages/analytics/ProductsPage.jsx
src/pages/analytics/ProductDetailPage.jsx        ← /analytics/products/:itemId
src/pages/analytics/InventoryPage.jsx
src/pages/analytics/CustomersAnalyticsPage.jsx
src/pages/analytics/CustomerDetailAnalyticsPage.jsx
src/pages/analytics/CashiersPage.jsx
src/pages/analytics/CashierDetailPage.jsx
src/pages/analytics/ProfitabilityPage.jsx
src/pages/analytics/TaxReportPage.jsx
src-tauri/migrations/0061_analytics_indexes.sql  ← new indexes
```

### Modified Files

```
src-tauri/src/commands/analytics.rs       ← fix 4 commands + add get_business_health_summary
src-tauri/src/models/analytics.rs         ← add new wrapper structs
src-tauri/src/http_server.rs              ← register get_business_health_summary
src-tauri/src/lib.rs                      ← register in generate_handler![]
src/commands/analytics.js                 ← add getBusinessHealthSummary()
src/features/analytics/useAnalytics.js    ← add useBusinessHealth hook
src/pages/AnalyticsPage.jsx               ← fix 5 tab bugs, then refactor into sub-pages
src/router.jsx                            ← add new analytics sub-routes
src/components/app-sidebar.jsx            ← update analytics link to /analytics (landing)
```

---

## Summary

The current analytics module has excellent backend coverage (24 commands, all data
needed is available) but the presentation layer has five silent bugs and no insight
generation. The upgrade path is:

1. **Fix the bugs first** — 5 surgical fixes, no schema changes needed.
2. **Add the insight engine** — pure frontend logic, no new backend required.
3. **Add the landing page** — one new backend command + new React page.
4. **Build drill-down pages** — dedicated pages per product/customer/cashier.
5. **Refactor section pages** — move tabs into proper routed pages.
6. **Add indexes** — one migration file, significant query speed improvement.

The result is a system that does not just show data but explains it: it tells the
business owner what is happening, why it matters, and what to do next — behaving like a
smart analyst reviewing the numbers every time the page loads.
