# Quantum POS — Stock Type (kg vs qty) Audit

> **Scope:** All modules that touch stock quantity — POS, Transactions, Returns, Inventory, Analytics, Purchase Orders, Stock Transfers, and their frontend counterparts.
>
> **What we're auditing:** Everywhere that needs to be *aware of* or *display* `measurement_type` / `unit_type` (weight, volume, length, quantity) but currently either ignores it, hardcodes "units", truncates decimals, or steps by 1 instead of a decimal increment.

---

## 1. Data Model Foundation

`item_settings` already has all the right columns:

| Column | Values | Notes |
|---|---|---|
| `measurement_type` | `quantity`, `weight`, `volume`, `length` | Drives display everywhere |
| `unit_type` | `kg`, `g`, `lb`, `piece`, `litre`, `m`, … | Specific label |
| `unit_value` | decimal | Units per pack/container |
| `requires_weight` | bool | Prompts cashier to weigh |

The problem is that **none of the downstream tables** (`transaction_items`, `return_items`, `purchase_order_items`, `stock_transfer_items`, `item_history`) store `unit_type` or `measurement_type`, so unit context is lost the moment stock moves.

---

## 2. Backend — `commands/transactions.rs`

### 2a. `FetchedItem` struct (inside `create_transaction`)
- `measurement_type`, `unit_type`, and `requires_weight` are **not fetched** from `item_settings` when building `items_map`.
- All four fields are available on the table but simply not selected or stored in the struct.

### 2b. Quantity validation
- `if qty <= Decimal::ZERO` — generic check. There is no minimum-unit enforcement (e.g. a weight item cannot meaningfully be sold in quantities below some precision threshold).
- For weight items the frontend *should* send decimal quantities (e.g. `0.250`). The backend accepts them, but there is no server-side check that a `measurement_type = "quantity"` item is not sold with a fractional qty.

### 2c. `transaction_items` INSERT
- Does **not** write a `unit_type` or `measurement_type` column. The receipt and all history referencing this row will never know whether `quantity = 2` means "2 kg" or "2 pieces".

### 2d. History message in item deduction
```
-- current
'POS Sale'
```
No unit label in the reason string. Should be `"POS Sale — 0.250 kg"` for weight items.

### 2e. `void_transaction` / `partial_refund` / `full_refund`
- Stock restore is purely numeric (`quantity + $1`). Correct mathematically, but the history insert has the same problem: reason strings like `"Void: …"`, `"refund_restore"`, `"full_refund_restore"` contain no unit label.

---

## 3. Backend — `commands/returns.rs`

### 3a. `create_return` — quantity comparison
```rust
let qty_ret = to_dec(item_dto.quantity_returned);
if qty_ret > orig_item.quantity { … }
```
- Uses the quantity from `transaction_items`, which stored the numeric value but not the unit. Mathematically safe, but no unit context.

### 3b. `return_items` INSERT
- Does **not** write `unit_type`. A return for "1.5 kg of rice" is stored as `quantity_returned = 1.5` with no unit label.

### 3c. Restock logic
- `item_stock.quantity + $1` — correct, but history reason is `"Return: {ref_no}"` with no unit info.

---

## 4. Backend — `commands/inventory.rs`

### 4a. `restock_item_inner` — history description
```rust
let description = format!("Restocked {} unit(s) of {item_name}", payload.quantity);
```
`"unit(s)"` is **hardcoded**. For a weight item this should read `"Restocked 5.00 kg of Rice"`.

### 4b. `adjust_inventory_inner` — history description
```rust
let desc = format!("Stock adjustment ({reason}): {sign}{adj} unit(s)");
```
Same — `"unit(s)"` is hardcoded.

### 4c. `deduct_stock_from_sale`
```rust
let desc = format!("Sold {} unit(s) of {item_name}", quantity);
```
Hardcoded `"unit(s)"`.

### 4d. `apply_variances_tx`
```rust
let desc = format!("Stock count adjustment: {direction} of {}", variance.abs());
```
No unit label.

### 4e. Stock count `record_count_inner`
- `counted_quantity` is stored as a plain `Decimal`. There is no `unit_type` column on `stock_count_items`. An auditor counting "2.5 kg" vs "2.5 pieces" will have the same raw number in the DB.

### 4f. `get_inventory_inner` / `get_inventory_item_inner`
- These DO select `measurement_type` and `unit_type` — inventory display is correct here. ✓

---

## 5. Backend — `commands/purchase_orders.rs`

### 5a. `receive_purchase_order` — history insert
```rust
'purchase', qty_recv, format!("PO Receipt: {}", order.po_number), claims.user_id,
```
- Uses the old `(change_type, adjustment, reason, created_by)` column pattern, **not** the `(event_type, event_description, quantity_before, quantity_after, quantity_change, performed_by)` pattern that the rest of the system now uses. This means PO receipts won't show up correctly in `get_movement_history` which queries `event_type`.
- No unit label in the description.

### 5b. `purchase_order_items` table
- `quantity_ordered` and `quantity_received` are plain `Decimal`. There is no `unit_type` column. A PO for "50 kg of flour" is stored identically to "50 pieces of flour."

---

## 6. Backend — `commands/stock_transfers.rs`

### 6a. `send_transfer` — history description
```rust
'TRANSFER_OUT', 'Stock transferred to another branch', …
```
No unit label in the event description.

### 6b. `receive_transfer` — history description
```rust
'TRANSFER_IN', 'Stock received from another branch', …
```
Same.

### 6c. `stock_transfer_items` table
- `qty_requested`, `qty_sent`, `qty_received` are plain `Decimal`. No `unit_type` column.

---

## 7. Backend — `commands/analytics.rs`

### 7a. `get_sales_summary` — `total_items_sold`
```sql
SELECT COALESCE(SUM(ti.quantity), 0)::bigint … AS total_items_sold
```
- Casts to `bigint` (integer), which silently truncates decimal quantities for weight/volume items (e.g. selling 0.25 kg five times = `1`, not `1.25`).
- The label `total_items_sold` implies a count of discrete items, which is wrong for weight/volume items.

### 7b. All `TopItem`, `ItemAnalytics`, `SlowMovingItem`, `DeadStockItem`, `StockVelocityItem` queries
- None of these models include `measurement_type` or `unit_type`. Reports mix weight and quantity items without labelling which is which.

### 7c. `get_revenue_by_period` and other aggregation queries
- `SUM(total_amount)` is fine. But any "units sold" derived stat has the same truncation and unlabelled-unit problem.

---

## 8. Frontend — `pages/PosPage.jsx`

### 8a. `CartItemRow` — quantity stepper
```jsx
<Input type="number" … step="1" />
```
`step="1"` prevents entering decimal quantities for weight/volume items. Should be `step="0.001"` (or dynamically derived from `measurement_type`).

### 8b. `CartItemRow` — `+/-` buttons
```jsx
onClick={() => onSetQty(item.itemId, item.quantity + 1)}
onClick={() => onSetQty(item.itemId, item.quantity - 1)}
```
Hard increments of ±1. A weight item should increment by a configurable step (e.g. 0.1 kg).

### 8c. `handleAddToCart`
```js
quantity: 1,
```
Always starts at 1. For `requires_weight = true` items, the cashier should be prompted to enter the weight before or after adding to cart.

### 8d. `ItemCard` / `ItemRow` — stock badge
```jsx
{isOut ? "Out" : String(stock)}
```
Shows raw number with no unit. A weight item showing `"0.5"` is ambiguous — should be `"0.5 kg"`.

### 8e. No `requires_weight` prompt
- There is no modal or inline input triggered when a weight item is added to cart. `item.requires_weight` and `item.measurement_type` are available in the item data (they are fetched via `getItems`) but never read in `PosPage.jsx`.

---

## 9. Frontend — `features/returns/InitiateReturnModal.jsx`

### 9a. `maxQty` truncation
```js
const maxQty = Math.floor(parseFloat(item.quantity ?? 1));
```
`Math.floor` destroys fractional quantities. If the original transaction sold `2.5 kg`, `maxQty` becomes `2`, and the cashier can only return up to 2 (losing 0.5 kg).

### 9b. Quantity stepper buttons
```jsx
onChange({ quantity: Math.max(1, state.quantity - 1) })
onChange({ quantity: Math.min(maxQty, state.quantity + 1) })
```
Integer ±1 steps. Weight items need decimal steps.

### 9c. Quantity display
```jsx
{maxQty} × {formatCurrency(unitPrice)}
```
Shows a count with no unit label.

### 9d. No `measurement_type` / `unit_type` on `txItems`
- `transaction_items` does not store the unit type, so even if the modal wanted to display "kg" it has no data to do so. Fixing this requires the backend change in §2c first.

---

## 10. Frontend — `features/inventory/RestockDialog.jsx`

### 10a. No unit label on current stock display
```jsx
<span>Current Stock</span>
<span>{formatDecimal(currentQty)}</span>
```
Should read `"Current Stock: 2.50 kg"` for weight items. The `item` prop contains `measurement_type` and `unit_type` — they just aren't used.

### 10b. "New total" preview
```jsx
New total: <strong>{formatDecimal(currentQty + parseFloat(qty))}</strong>
```
No unit suffix.

---

## 11. Frontend — `features/inventory/AdjustInventoryDialog.jsx`

### 11a. No unit label on current stock or new total
Same as RestockDialog — `item.measurement_type` and `item.unit_type` are available on the `item` prop but not read.

### 11b. Placeholder text
```jsx
placeholder="-5 or +10"
```
For weight items this should be `"-0.500 or +1.250"`.

---

## 12. Frontend — `features/inventory/StockCountRunner.jsx`

### 12a. `ItemCountRow` stepper buttons
```jsx
setQty((v) => String(Math.max(0, parseFloat(v || 0) - 1)))
setQty((v) => String(parseFloat(v || 0) + 1))
```
Integer ±1 steps. Weight items need decimal steps.

### 12b. System quantity display
```jsx
System: {formatDecimal(currentQty)}
```
No unit label. Should be `"System: 2.50 kg"`.

### 12c. Variance display
```jsx
{formatDecimal(parseFloat(qty) - currentQty)}
```
No unit label on the variance line.

---

## 13. Frontend — `features/items/AdjustStockDialog.jsx`

### 13a. Hardcoded `"units"` in description
```jsx
description="…Current: {formatDecimal(currentQty)} units"
```
`"units"` is hardcoded. For weight items should use `item.unit_type`.

### 13b. Preview text
```jsx
{formatDecimal(currentQty)} → {formatDecimal(newQty)} units
```
Same — hardcoded `"units"`.

---

## 14. Frontend — `features/items/ItemFormDialog.jsx`

### 14a. Min/max stock level step
```jsx
<Input type="number" min="0" step="1" … />  {/* min_stock_level */}
<Input type="number" min="0" step="1" … />  {/* max_stock_level */}
```
For weight items, thresholds like `0.5 kg` are valid. `step="1"` prevents entering them. Should be `step="0.01"` or dynamically driven by `measurement_type`.

### 14b. This form IS measurement-type aware ✓
The measurement type selector, unit type picker, and `requires_weight` toggle are all correctly implemented here. No other issues.

---

## Summary Table

| Location | Issue | Severity |
|---|---|---|
| `transaction_items` (DB schema) | No `unit_type` column — unit lost after sale | High |
| `return_items` (DB schema) | No `unit_type` column | High |
| `purchase_order_items` (DB schema) | No `unit_type` column | Medium |
| `stock_transfer_items` (DB schema) | No `unit_type` column | Medium |
| `stock_count_items` (DB schema) | No `unit_type` column | Medium |
| `transactions.rs` — `FetchedItem` | `measurement_type` / `unit_type` not fetched | High |
| `transactions.rs` — history strings | Hardcoded `"POS Sale"`, no unit label | Low |
| `returns.rs` — `return_items` INSERT | No unit_type written | Medium |
| `inventory.rs` — restock/adjust/deduct | Hardcoded `"unit(s)"` in history descriptions | Low |
| `inventory.rs` — stock count | No unit_type on count items | Medium |
| `purchase_orders.rs` — receive | Wrong history column pattern + no unit label | Medium |
| `analytics.rs` — `total_items_sold` | Casts `SUM(quantity)` to `bigint`, truncates decimals | High |
| `analytics.rs` — item-level reports | No `measurement_type` / `unit_type` in models | Medium |
| `PosPage.jsx` — CartItemRow qty input | `step="1"` prevents decimal quantities | High |
| `PosPage.jsx` — +/- buttons | Integer steps only | High |
| `PosPage.jsx` — `handleAddToCart` | Always starts at `quantity: 1` | High |
| `PosPage.jsx` — stock badge | No unit suffix on displayed stock | Medium |
| `PosPage.jsx` — no `requires_weight` prompt | Weight items added without weight entry | High |
| `InitiateReturnModal.jsx` — `maxQty` | `Math.floor` truncates decimal quantities | High |
| `InitiateReturnModal.jsx` — stepper | Integer ±1 steps | High |
| `RestockDialog.jsx` — labels | No unit suffix on stock display | Low |
| `AdjustInventoryDialog.jsx` — labels | No unit suffix, wrong placeholder | Low |
| `StockCountRunner.jsx` — stepper | Integer ±1 steps | Medium |
| `StockCountRunner.jsx` — labels | No unit suffix on system/variance qty | Low |
| `AdjustStockDialog.jsx` — labels | Hardcoded `"units"` in description/preview | Low |
| `ItemFormDialog.jsx` — min/max level | `step="1"` on threshold inputs | Low |
