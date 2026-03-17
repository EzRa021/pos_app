// ============================================================================
// lib/constants.js — App-wide constant values
// ============================================================================
// Pure data — no React, no imports.
// Import anywhere. Never duplicate these values in components.
// ============================================================================

// ── Roles ─────────────────────────────────────────────────────────────────────
export const ROLES = {
  SUPER_ADMIN:  "super_admin",
  ADMIN:        "admin",
  MANAGER:      "manager",
  CASHIER:      "cashier",
  STOCK_KEEPER: "stock_keeper",
};

export const GLOBAL_ROLES  = [ROLES.SUPER_ADMIN, ROLES.ADMIN];
export const POS_ROLES     = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER];
export const CATALOG_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER, ROLES.STOCK_KEEPER];

// ── Payment methods ───────────────────────────────────────────────────────────
export const PAYMENT_METHODS = {
  CASH:         "cash",
  CARD:         "card",
  TRANSFER:     "transfer",
  MOBILE_MONEY: "mobile_money",
  CREDIT:       "credit",
  WALLET:       "wallet",
  LOYALTY:      "loyalty",
  SPLIT:        "split",
};

export const PAYMENT_METHOD_LABELS = {
  [PAYMENT_METHODS.CASH]:         "Cash",
  [PAYMENT_METHODS.CARD]:         "Card",
  [PAYMENT_METHODS.TRANSFER]:     "Bank Transfer",
  [PAYMENT_METHODS.MOBILE_MONEY]: "Mobile Money",
  [PAYMENT_METHODS.CREDIT]:       "Credit",
  [PAYMENT_METHODS.WALLET]:       "Wallet",
  [PAYMENT_METHODS.LOYALTY]:      "Loyalty Points",
  [PAYMENT_METHODS.SPLIT]:        "Split Payment",
};

// ── Transaction statuses ──────────────────────────────────────────────────────
export const TRANSACTION_STATUS = {
  COMPLETED: "completed",
  VOIDED:    "voided",
  HELD:      "held",
  REFUNDED:  "refunded",
};

// ── Shift statuses ────────────────────────────────────────────────────────────
// Must match the status values in the `shifts` table.
// Backend query returns open | active | suspended as "active" shifts.
export const SHIFT_STATUS = {
  OPEN:      "open",       // just opened, no sales yet
  ACTIVE:    "active",    // first sale recorded (transitioned by transactions)
  SUSPENDED: "suspended", // temporarily paused
  CLOSED:    "closed",    // shift ended
};

/** Returns true for any status that means the shift is still in progress */
export function isActiveShiftStatus(status) {
  return (
    status === SHIFT_STATUS.OPEN ||
    status === SHIFT_STATUS.ACTIVE ||
    status === SHIFT_STATUS.SUSPENDED
  );
}

// ── Purchase order statuses ───────────────────────────────────────────────────
export const PO_STATUS = {
  DRAFT:     "draft",
  SENT:      "sent",
  PARTIAL:   "partial",
  RECEIVED:  "received",
  CANCELLED: "cancelled",
};

// ── Expense statuses ──────────────────────────────────────────────────────────
export const EXPENSE_STATUS = {
  PENDING:  "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

// ── Credit sale statuses ──────────────────────────────────────────────────────
export const CREDIT_STATUS = {
  OUTSTANDING: "outstanding",
  PARTIAL:     "partial",
  PAID:        "paid",
};

// ── Price change statuses ─────────────────────────────────────────────────────
export const PRICE_CHANGE_STATUS = {
  PENDING:  "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

// ── Stock count statuses ──────────────────────────────────────────────────────
export const STOCK_COUNT_STATUS = {
  IN_PROGRESS: "in_progress",
  COMPLETED:   "completed",
};

// ── Cash movement types ───────────────────────────────────────────────────────
// Must match the movement_type values in the `cash_movements` table.
// src-tauri/src/models/cash_movement.rs: "deposit" | "withdrawal" | "payout" | "adjustment"
export const CASH_MOVEMENT_TYPES = {
  DEPOSIT:    "deposit",     // cash added to drawer (float top-up, change fund)
  WITHDRAWAL: "withdrawal",  // cash removed from drawer (bank deposit, safe drop)
  PAYOUT:     "payout",      // expense paid from drawer
  ADJUSTMENT: "adjustment",  // reconciliation correction
};

// ── Return reasons ────────────────────────────────────────────────────────────
export const RETURN_REASONS = [
  "Defective product",
  "Wrong item received",
  "Customer changed mind",
  "Overcharged",
  "Duplicate purchase",
  "Other",
];

// ── Pagination ────────────────────────────────────────────────────────────────
export const PAGE_SIZE         = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// ── Tax ───────────────────────────────────────────────────────────────────────
export const DEFAULT_TAX_RATE = 7.5; // VAT %

// ── Low stock threshold ───────────────────────────────────────────────────────
export const LOW_STOCK_THRESHOLD = 10;

// ── Permissions ───────────────────────────────────────────────────────────────
export const PERMISSIONS = {
  TRANSACTIONS_VIEW:   "transactions.view",
  TRANSACTIONS_VOID:   "transactions.void",
  TRANSACTIONS_REFUND: "transactions.refund",
  PRODUCTS_VIEW:       "products.view",
  PRODUCTS_CREATE:     "products.create",
  PRODUCTS_EDIT:       "products.edit",
  PRODUCTS_DELETE:     "products.delete",
  INVENTORY_VIEW:      "inventory.view",
  INVENTORY_ADJUST:    "inventory.adjust",
  USERS_VIEW:          "users.view",
  USERS_CREATE:        "users.create",
  USERS_EDIT:          "users.edit",
  USERS_DELETE:        "users.delete",
  EXPENSES_VIEW:       "expenses.view",
  EXPENSES_CREATE:     "expenses.create",
  EXPENSES_APPROVE:    "expenses.approve",
  PRICES_VIEW:         "prices.view",
  PRICES_REQUEST:      "prices.request",
  PRICES_APPROVE:      "prices.approve",
  ANALYTICS_VIEW:      "analytics.view",
};

// ── Measurement types ──────────────────────────────────────────────────────────
// Must match the measurement_type values stored in item_settings.measurement_type.
// Controls how quantities are entered on POS, restocked, returned, and counted.
export const MEASUREMENT_TYPES = {
  QUANTITY: "quantity", // discrete pieces / packs — integer only
  WEIGHT:   "weight",   // kg / g / lb / oz — decimal, 3 dp
  VOLUME:   "volume",   // litre / ml / cl — decimal, 3 dp
  LENGTH:   "length",   // m / cm / mm — decimal, 3 dp
};

/** Human-readable label for each measurement_type value */
export const MEASUREMENT_TYPE_LABELS = {
  [MEASUREMENT_TYPES.QUANTITY]: "Quantity",
  [MEASUREMENT_TYPES.WEIGHT]:   "Weight",
  [MEASUREMENT_TYPES.VOLUME]:   "Volume",
  [MEASUREMENT_TYPES.LENGTH]:   "Length",
};

/**
 * Canonical default units for each measurement type.
 * Used in filters, analytics column headers, and reports.
 */
export const MEASUREMENT_TYPE_DEFAULT_UNITS = {
  [MEASUREMENT_TYPES.QUANTITY]: "pcs",
  [MEASUREMENT_TYPES.WEIGHT]:   "kg",
  [MEASUREMENT_TYPES.VOLUME]:   "L",
  [MEASUREMENT_TYPES.LENGTH]:   "m",
};

/**
 * All selectable measurement type options for dropdowns/filters.
 * Includes an "all" sentinel for "no filter applied".
 */
export const MEASUREMENT_TYPE_OPTIONS = [
  { value: "all",                       label: "All Types" },
  { value: MEASUREMENT_TYPES.QUANTITY,  label: "Quantity (pieces)" },
  { value: MEASUREMENT_TYPES.WEIGHT,    label: "Weight (kg/g…)" },
  { value: MEASUREMENT_TYPES.VOLUME,    label: "Volume (L/ml…)" },
  { value: MEASUREMENT_TYPES.LENGTH,    label: "Length (m/cm…)" },
];

/** Returns true for any measurement_type that accepts fractional (decimal) quantities */
export function isDecimalMeasurementType(measurementType) {
  return (
    measurementType === MEASUREMENT_TYPES.WEIGHT ||
    measurementType === MEASUREMENT_TYPES.VOLUME ||
    measurementType === MEASUREMENT_TYPES.LENGTH
  );
}
