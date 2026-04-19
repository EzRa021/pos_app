// ── Core ──────────────────────────────────────────────────────────────────────
// App lifecycle, auth, users, stores
pub mod app;
pub mod auth;
pub mod users;
pub mod stores;

// ── Catalog ───────────────────────────────────────────────────────────────────
// Product master data, stock levels, stock counts
pub mod departments;
pub mod categories;
pub mod items;
pub mod inventory;

// ── Customers ─────────────────────────────────────────────────────────────────
pub mod customers;

// ── Sales ─────────────────────────────────────────────────────────────────────
// Revenue operations: POS, shift management, cash handling, credit
pub mod transactions;
pub mod returns;
pub mod shifts;
pub mod cash_movements;
pub mod credit_sales;

// ── Procurement ───────────────────────────────────────────────────────────────
// Buying side: vendors, purchase orders, incoming payments
pub mod suppliers;
pub mod purchase_orders;
pub mod payments;
pub mod supplier_payments;

// ── Finance ───────────────────────────────────────────────────────────────────
// Money out, reporting, end-of-day
pub mod expenses;
pub mod analytics;
pub mod eod;

// ── Operations ────────────────────────────────────────────────────────────────
// Stock movement, pricing rules, bulk changes
pub mod stock_transfers;
pub mod reorder_alerts;
pub mod bulk_operations;
pub mod price_management;
pub mod price_scheduling;

// ── System ────────────────────────────────────────────────────────────────────
// Platform infrastructure: audit, backup, notifications, integrations
pub mod audit;
pub mod backup;
pub mod notifications;
pub mod security;
pub mod tax;
pub mod store_settings;
pub mod receipts;
pub mod printer;
pub mod labels;
pub mod excel;
pub mod loyalty;
pub mod customer_wallet;
pub mod fx_rates;
pub mod onboarding;
pub mod pos_favourites;
pub mod cloud_sync;
pub mod payment_methods;
pub mod expense_categories;
pub mod number_series;
pub mod store_hours;
pub mod pos_shortcuts_settings;
