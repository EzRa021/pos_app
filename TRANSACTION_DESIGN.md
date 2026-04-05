# Transaction Pages — Design Reference

> **Scope**: `TransactionsPanel.jsx` + `TransactionDetailPanel.jsx`
> **Last redesigned**: 2025
> **Color system**: Quantum POS design tokens (see `src/index.css`)

---

## Design Philosophy

The transaction pages follow a **refined dark-zinc utilitarian** aesthetic:
- **Dense but breathable** — maximum information density without feeling cramped
- **Semantic color coding** — every accent color carries a consistent meaning
- **Progressive disclosure** — high-level stats first, details on drill-down
- **Smooth but subtle** — transitions at 150–200 ms, no animation for animation's sake

---

## Color Token Reference

| Token | Hex (dark) | Usage |
|---|---|---|
| `bg-background` | `#09090b` | Page/window background |
| `bg-card` | `#111113` | Panel, sidebar, modal surfaces |
| `bg-muted` | `#27272a` | Inactive tabs, disabled states, skeleton |
| `bg-primary` | `#3b82f6` | Active items, primary CTA, focus rings |
| `bg-success` | `#16a34a` | Positive outcomes, completed status |
| `bg-destructive` | `#ef4444` | Void, delete, cancel, error |
| `bg-warning` | `#f59e0b` | Refunds, pending, low-stock |
| `text-foreground` | `#fafafa` | All primary text |
| `text-muted-foreground` | `#a1a1aa` | Labels, hints, secondary info |
| `border-border` | `#27272a` | All borders and dividers |

### Opacity modifiers

Use Tailwind opacity modifiers for decorative surfaces:

```
bg-primary/10   → very light tint for icon backgrounds
bg-primary/20   → border for colored cards
bg-warning/8    → subtle warning banner fill
bg-destructive/5 → destructive action row hover base
```

---

## TransactionsPanel — Layout

```
┌─────────────────────────────────────────────────────────────┐
│  PageHeader — "Transactions" + description                  │
├─────────────────────────────────────────────────────────────┤
│  max-w-6xl  px-6 py-6                                       │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ StatCard │ │ StatCard │ │ StatCard │ │ StatCard │      │
│  │ (primary)│ │ (success)│ │(warning) │ │ (muted)  │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Section header: icon + title + record count badge  │   │
│  │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │   │
│  │  FilterBar (search | payment select | date range)   │   │
│  │  TabBar (All | Completed | Voided | Refunded)        │   │
│  │  DataTable (rows with hover → navigate to detail)   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Legend row (status icon + label pairs)                     │
└─────────────────────────────────────────────────────────────┘
```

---

## StatCard Component

```jsx
<StatCard
  label="Today's Revenue"      // UPPERCASE label (10px, tracking-wider)
  value={formatCurrency(x)}   // 2xl bold tabular-nums
  sub="12 sales today"        // 11px muted helper
  accent="success"            // default | primary | success | warning | destructive | muted
  icon={TrendingUp}
/>
```

### Accent variants

| `accent` | Border | Background | Value color | Icon bg |
|---|---|---|---|---|
| `default` | `border-border/60` | `bg-card` | `text-foreground` | `bg-muted/40` |
| `primary` | `border-primary/20` | `bg-primary/[0.04]` | `text-primary` | `bg-primary/12` |
| `success` | `border-success/20` | `bg-success/[0.04]` | `text-success` | `bg-success/12` |
| `warning` | `border-warning/20` | `bg-warning/[0.04]` | `text-warning` | `bg-warning/12` |
| `destructive` | `border-destructive/20` | `bg-destructive/[0.04]` | `text-destructive` | `bg-destructive/12` |
| `muted` | `border-border/60` | `bg-muted/20` | `text-muted-foreground` | `bg-muted/40` |

Cards use `hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200` for a subtle lift on hover.

---

## TabBar Component

```jsx
<TabBar
  active={status}           // "" | "completed" | "voided" | "refunded"
  onChange={(v) => ...}
  counts={tabCounts}        // { "": 100, completed: 80, voided: 10, refunded: 10 }
/>
```

- Container: `bg-muted/40 p-1 rounded-lg border border-border/50`
- Active tab: `bg-card text-foreground shadow-sm border border-border/60`
- Inactive tab: `text-muted-foreground hover:text-foreground hover:bg-card/50`
- Count pill: active → `bg-primary/15 text-primary`, inactive → `bg-muted/60 text-muted-foreground`

---

## PaymentBadge Component

Small uppercase pill for payment methods in table cells:

```jsx
// Styles map key:
cash         → "bg-muted/60 text-muted-foreground border-border/60"
card         → "bg-primary/10 text-primary border-primary/20"
transfer     → "bg-primary/10 text-primary border-primary/20"
mobile_money → "bg-success/10 text-success border-success/20"
credit       → "bg-warning/10 text-warning border-warning/20"
wallet       → "bg-primary/10 text-primary border-primary/20"
split        → "bg-violet-500/10 text-violet-400 border-violet-500/20"
```

---

## DataTable Column Pattern

```js
{
  key: "reference_no",
  header: "Reference",
  sortable: true,
  render: (row) => (
    <span className="font-mono text-[12px] font-bold text-primary tracking-wide">
      {formatRef(row.reference_no)}
    </span>
  ),
},
```

Arrow column at end: `ArrowUpRight` with `group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-150`

---

## TransactionDetailPanel — Layout

```
┌─────────────────────────────────────────────────────────────┐
│  PageHeader (back chevron | ref no | status badges          │
│             | Copy Ref + Print Receipt buttons)             │
├─────────────────────────────────────────────────────────────┤
│  max-w-5xl  px-6 py-6                                       │
│                                                             │
│  ┌─────────────────────────────────┐  ┌───────────────┐   │
│  │  Transaction Details (2/3)       │  │  Summary      │   │
│  │  ┌────────────┬───────────────┐  │  │  (financial)  │   │
│  │  │ Ref, Date  │ Customer,     │  │  │               │   │
│  │  │ Time,      │ Payment,      │  │  ├───────────────┤   │
│  │  │ Cashier    │ Status, Notes │  │  │  Customer     │   │
│  │  └────────────┴───────────────┘  │  │  (if present) │   │
│  ├─────────────────────────────────┤  │               │   │
│  │  Items (2/3)                     │  ├───────────────┤   │
│  │  ┌─────────────────────────────┐ │  │  Actions      │   │
│  │  │  Product | Qty | Price | VAT│ │  │  (buttons)    │   │
│  │  │  | Total  (table rows)      │ │  │               │   │
│  │  └─────────────────────────────┘ │  └───────────────┘   │
│  └─────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Section Component

```jsx
<Section title="Transaction Details" icon={Receipt} badge={<span>3 lines</span>}>
  {/* content */}
</Section>
```

- Outer: `rounded-xl border border-border bg-card overflow-hidden`
- Header: `bg-muted/10 border-b border-border px-5 py-3.5`
- Icon: wrapped in `h-6 w-6 rounded-md bg-muted/60` container
- Title: `text-[11px] font-bold uppercase tracking-wider text-muted-foreground`
- Body: `p-5`

---

## InfoRow Component

Used in the two-column transaction detail grid:

```jsx
<InfoRow
  label="Reference No."
  icon={Hash}
  value={<span className="font-mono text-primary font-bold">{ref}</span>}
  last    // omits the bottom border on the final row
/>
```

- Layout: `flex items-start justify-between gap-4 py-2.5`
- Separator: `border-b border-border/40` (removed on `last`)
- Label icon: `h-3 w-3 text-muted-foreground/50`

---

## SummaryLine Component

Right-aligned financial summary rows:

```jsx
<SummaryLine label="Subtotal (ex-VAT)" value={formatCurrency(x)} />
<SummaryLine label="VAT (7.5%)"        value={formatCurrency(y)} />
<SummaryLine label="Total" value={formatCurrency(z)} large separator />
<SummaryLine label="Cash" value={formatCurrency(a)} accent="primary" />
<SummaryLine label="Change" value={formatCurrency(b)} accent="success" />
```

| Prop | Effect |
|---|---|
| `large` | `text-base font-bold text-foreground` value, `font-semibold` label |
| `separator` | Renders `border-t border-border/60` before the row |
| `accent="success"` | Value in `text-success` |
| `accent="destructive"` | Value in `text-destructive` |
| `accent="primary"` | Value in `text-primary` |

---

## ActionButton Component

Clickable rows in the Actions card on the right sidebar:

```jsx
<ActionButton
  onClick={() => setVoidOpen(true)}
  icon={Ban}
  label="Void Transaction"
  description="Same-day only · Restores all stock"
  variant="destructive"   // default | destructive | warning | primary
/>
```

### Variant styles

| Variant | Border | BG base | BG hover | Label color | Icon container |
|---|---|---|---|---|---|
| `default` | `border-border/40` | `bg-muted/10` | `bg-muted/30` | `text-foreground` | `border-border/60 bg-muted/40` |
| `destructive` | `border-destructive/20` | `bg-destructive/5` | `bg-destructive/10` | `text-destructive` | `border-destructive/20 bg-destructive/10` |
| `warning` | `border-warning/20` | `bg-warning/5` | `bg-warning/10` | `text-warning` | `border-warning/20 bg-warning/10` |
| `primary` | `border-primary/20` | `bg-primary/5` | `bg-primary/10` | `text-primary` | `border-primary/20 bg-primary/10` |

The ChevronRight icon animates on hover: `group-hover:translate-x-0.5`

---

## Items Table

Full-width `<table>` inside the Items section. Each row:

```
Product cell: icon (Package in muted box) + name (font-semibold) + SKU (font-mono 10px)
Qty cell:     font-mono tabular-nums text-foreground
Unit Price:   font-mono tabular-nums text-muted-foreground
VAT:          font-mono tabular-nums text-muted-foreground/70
Total:        font-mono tabular-nums font-bold text-foreground
```

Row hover: `hover:bg-muted/20 transition-colors duration-100`

---

## Modal Pattern

All three modals (Void, Full Refund, Partial Refund) share the same structure:

```
┌────────────────────────────────────────┐
│  [3px gradient accent bar at top]      │  ← destructive or warning gradient
├────────────────────────────────────────┤
│  px-6 pt-5 pb-6 space-y-4             │
│                                        │
│  Header: icon circle + title + ref     │
│  Warning banner (AlertTriangle)        │
│  Form fields (textarea + Input)        │
│  Footer: Cancel | Confirm buttons      │
└────────────────────────────────────────┘
```

- Outer: `max-w-md border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/50`
- Accent bar: `h-[3px] bg-gradient-to-r from-{color}/80 via-{color} to-{color}/80`
- Icon circle: `h-10 w-10 rounded-xl border border-{color}/20 bg-{color}/8`
- Warning banner: `border border-warning/20 bg-warning/6 rounded-lg px-3.5 py-3`

### Void modal two-step flow

1. **Step 1** — Reason textarea (required) + Notes input (optional) → Continue
2. **Step 2** — 4-digit PIN entry (`text-center text-2xl tracking-[0.6em] font-mono h-12`) → Void Transaction

---

## Transitions & Motion

All interactive elements follow the same timing:

| Interaction | Duration | Easing |
|---|---|---|
| Button/row hover color | `150ms` | default |
| StatCard lift on hover | `200ms` | default |
| Arrow nudge on row hover | `150ms` | default |
| Chevron nudge on action hover | `150ms` | default |

No entrance animations are used (panels render instantly). Modals use the default Dialog component animation from shadcn.

---

## Utility Classes Cheatsheet

```css
/* Section card */
rounded-xl border border-border bg-card overflow-hidden

/* Section header */
bg-muted/10 border-b border-border px-5 py-3.5

/* Section header title */
text-[11px] font-bold uppercase tracking-wider text-muted-foreground

/* Stat value */
text-2xl font-bold tabular-nums leading-none tracking-tight

/* Stat label */
text-[10px] font-semibold uppercase tracking-wider text-muted-foreground

/* Mono value */
font-mono tabular-nums

/* Table header cell */
text-[10px] font-semibold uppercase tracking-wider text-muted-foreground

/* Primary reference text */
font-mono text-primary font-bold tracking-wide

/* Muted italic placeholder */
italic text-muted-foreground/60

/* Count pill */
text-[10px] font-semibold bg-muted/60 text-muted-foreground rounded-full px-2 py-0.5 tabular-nums
```

---

## File Structure

```
src/features/transactions/
├── TransactionsPanel.jsx       ← List page (stats + filter + table)
├── TransactionDetailPanel.jsx  ← Detail page (info + items + sidebar)
└── useTransactions.js          ← Data hooks (unchanged)
```

---

## Reuse Guidelines

When applying this design pattern to other list+detail page pairs:

1. **Stat cards** at the top of list pages — grid of 4, 2 cols on mobile
2. **Section wrapper** with icon in muted box + uppercase title
3. **InfoRow** for two-column key/value grids in detail views
4. **SummaryLine** for any right-aligned financial summary
5. **ActionButton** for any sidebar action panel — use correct semantic variant
6. **3px gradient accent bar** at top of modals, color matches action type
7. Always use `transition-all duration-150` on interactive elements
8. Always use `tabular-nums` class on any numeric/currency value
