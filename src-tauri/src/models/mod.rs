// ── Core ──────────────────────────────────────────────────────────────────────
pub mod auth;
pub mod user;
pub mod store;
pub mod pagination;

// ── Catalog ───────────────────────────────────────────────────────────────────
pub mod department;
pub mod category;
pub mod item;
pub mod inventory;
pub mod label;

// ── Customers ─────────────────────────────────────────────────────────────────
pub mod customer;

// ── Sales ─────────────────────────────────────────────────────────────────────
pub mod transaction;
pub mod returns;
pub mod shift;
pub mod cash_movement;
pub mod credit_sale;
pub mod payment;

// ── Procurement ───────────────────────────────────────────────────────────────
pub mod supplier;
pub mod purchase_order;
pub mod supplier_payment;

// ── Finance ───────────────────────────────────────────────────────────────────
pub mod expense;
pub mod analytics;
pub mod eod_report;

// ── Operations ────────────────────────────────────────────────────────────────
pub mod stock_transfer;
pub mod reorder_alert;
pub mod bulk_operations;
pub mod price;
pub mod price_scheduling;

// ── System ────────────────────────────────────────────────────────────────────
pub mod audit;
pub mod receipt;
pub mod store_settings;
pub mod notification;
pub mod security;
pub mod loyalty;
pub mod customer_wallet;
pub mod fx_rates;
pub mod backup;
pub mod tax;
pub mod pos_favourites;
