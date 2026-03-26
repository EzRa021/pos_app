// ============================================================================
// LIB.RS — Quantum POS Tauri Application Entry Point
// ============================================================================
// Auto-migration flow:
//   1. App starts → reads saved DB config from tauri-plugin-store.
//   2. If config found → create_pool() → sqlx::migrate!() runs automatically.
//   3. Any new .sql file in /migrations/ is applied; already-applied ones skip.
//   4. If no saved config → setup wizard shown; db_connect saves config + migrates.
//   5. On next launch → step 1 auto-connects again.
// ============================================================================

mod error;
mod state;
mod database;
mod models;
mod utils;
mod commands;
mod http_server;

use std::sync::atomic::Ordering;
use state::AppState;
use tauri::Manager;
use tauri_plugin_store::StoreExt;
use database::pool::create_pool;
use state::DbConfig;

const STORE_FILE: &str = "settings.json";
const DB_CFG_KEY: &str = "db_config";

// ── get_api_port ──────────────────────────────────────────────────────────────
#[tauri::command]
fn get_api_port(state: tauri::State<'_, AppState>) -> u16 {
    state.api_port.load(Ordering::Relaxed)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── Structured logging ────────────────────────────────────────────────────
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pos_app_lib=info,tauri=warn".into()),
        )
        .init();

    // ── JWT secret ────────────────────────────────────────────────────────────
    let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(b"quantum-pos-default-secret-change-in-production");
        format!("{:x}", h.finalize())
    });

    tauri::Builder::default()
        // ── Plugins ───────────────────────────────────────────────────────────
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // ── Setup: state, auto-connect, HTTP server ───────────────────────────
        .setup(|app| {
            let app_state = AppState::new(jwt_secret);

            // ── AUTO-CONNECT ──────────────────────────────────────────────────
            // Try to load the previously saved DB config and connect + migrate
            // before the frontend finishes loading. If it fails we log a warning
            // and the frontend will show the setup wizard instead.
            let auto_state  = app_state.clone();
            let app_handle  = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                // Read persisted config from the store
                let cfg: Option<DbConfig> = app_handle
                    .store(STORE_FILE)
                    .ok()
                    .and_then(|store| store.get(DB_CFG_KEY))
                    .and_then(|val| serde_json::from_value(val).ok());

                match cfg {
                    None => {
                        tracing::info!(
                            "No saved database config found — waiting for setup wizard."
                        );
                    }
                    Some(config) => {
                        tracing::info!(
                            "Found saved config for {}:{}/{} — auto-connecting…",
                            config.host, config.port, config.database
                        );
                        match create_pool(&config).await {
                            Ok(pool) => {
                                let mut guard = auto_state.db.lock().await;
                                *guard = Some(pool);
                                tracing::info!(
                                    "Auto-connected to {}:{}/{} and migrations applied.",
                                    config.host, config.port, config.database
                                );
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "Auto-connect failed ({}). \
                                     The setup wizard will appear.", e
                                );
                            }
                        }
                    }
                }
            });

            // ── HTTP API server ───────────────────────────────────────────────
            let http_state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                http_server::start(http_state, 4000).await;
            });

            // ── Session cleanup (hourly) ──────────────────────────────────────
            let cleanup_state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
                    let now = chrono::Utc::now();
                    cleanup_state.sessions.write().await
                        .retain(|_, s| s.expires_at > now);
                    tracing::debug!("Session cleanup: pruned expired sessions.");
                }
            });

            app.manage(app_state);
            tracing::info!("Quantum POS started.");
            Ok(())
        })
        // ── Command registry ──────────────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            // ── HTTP API port ─────────────────────────────────────────────────
            get_api_port,

            // ── App / Database ────────────────────────────────────────────────
            commands::app::db_connect,
            commands::app::db_disconnect,
            commands::app::db_status,
            commands::app::app_version,
            commands::app::app_name,
            commands::app::get_local_ip,
            commands::app::find_available_port,

            // ── Authentication ────────────────────────────────────────────────
            commands::auth::login,
            commands::auth::logout,
            commands::auth::verify_session,
            commands::auth::refresh_token,
            commands::auth::change_password,
            commands::auth::request_password_reset,
            commands::auth::reset_password,

            // ── Users & Roles ─────────────────────────────────────────────────
            commands::users::get_users,
            commands::users::get_user,
            commands::users::search_users,
            commands::users::create_user,
            commands::users::update_user,
            commands::users::delete_user,
            commands::users::activate_user,
            commands::users::deactivate_user,
            commands::users::reset_user_password,
            commands::users::get_roles,
            commands::users::get_permissions,
            commands::users::get_role_permissions,
            commands::users::set_role_permissions,

            // ── Stores ────────────────────────────────────────────────────────
            commands::stores::get_stores,
            commands::stores::get_store,
            commands::stores::get_my_store,
            commands::stores::create_store,
            commands::stores::update_store,
            commands::stores::get_store_users,

            // ── Departments ───────────────────────────────────────────────────
            commands::departments::get_departments,
            commands::departments::get_department,
            commands::departments::create_department,
            commands::departments::update_department,
            commands::departments::delete_department,
            commands::departments::hard_delete_department,
            commands::departments::search_departments,
            commands::departments::get_departments_by_store,
            commands::departments::get_global_departments,
            commands::departments::get_department_by_code,
            commands::departments::get_department_categories,
            commands::departments::activate_department,
            commands::departments::deactivate_department,
            commands::departments::count_departments,

            // ── Categories ────────────────────────────────────────────────────
            commands::categories::get_categories,
            commands::categories::get_category,
            commands::categories::create_category,
            commands::categories::update_category,
            commands::categories::delete_category,
            commands::categories::hard_delete_category,
            commands::categories::search_categories,
            commands::categories::get_category_by_code,
            commands::categories::get_pos_categories,
            commands::categories::get_subcategories,
            commands::categories::get_category_items,
            commands::categories::activate_category,
            commands::categories::deactivate_category,
            commands::categories::assign_category_department,
            commands::categories::count_categories,

            // ── Items / Products ──────────────────────────────────────────────
            commands::items::get_items,
            commands::items::get_item,
            commands::items::get_item_by_barcode,
            commands::items::get_item_by_sku,
            commands::items::search_items,
            commands::items::create_item,
            commands::items::update_item,
            commands::items::delete_item,
            commands::items::activate_item,
            commands::items::deactivate_item,
            commands::items::adjust_stock,
            commands::items::get_item_history,
            commands::items::remove_item_image,
            commands::items::count_items,

            // ── Inventory & Stock ─────────────────────────────────────────────
            commands::inventory::get_inventory,
            commands::inventory::get_inventory_item,
            commands::inventory::get_low_stock,
            commands::inventory::restock_item,
            commands::inventory::adjust_inventory,
            commands::inventory::get_movement_history,
            commands::inventory::get_inventory_summary,
            // Stock count pipeline
            commands::inventory::start_count_session,
            commands::inventory::record_count,
            commands::inventory::complete_count_session,
            commands::inventory::get_variance_report,
            commands::inventory::apply_variances_standalone,
            commands::inventory::get_count_session,
            commands::inventory::get_count_sessions,
            commands::inventory::get_stock_count_stats,
            commands::inventory::get_session_count_items,
            commands::inventory::cancel_count_session,
            commands::inventory::get_inventory_for_count,
            // Legacy aliases (keep until frontend migrates)
            commands::inventory::get_stock_counts,

            // ── Transactions (POS Sales) ──────────────────────────────────────
            commands::transactions::create_transaction,
            commands::transactions::get_transactions,
            commands::transactions::get_transaction,
            commands::transactions::get_transaction_stats,
            commands::transactions::void_transaction,
            commands::transactions::partial_refund,
            commands::transactions::full_refund,
            commands::transactions::hold_transaction,
            commands::transactions::get_held_transactions,
            commands::transactions::delete_held_transaction,

            // ── Returns & Refunds ─────────────────────────────────────────────
            commands::returns::create_return,
            commands::returns::get_returns,
            commands::returns::get_return,
            commands::returns::get_transaction_returns,
            commands::returns::get_return_stats,
            commands::returns::void_return,
            commands::returns::search_returns,
            commands::returns::get_transaction_returned_quantities,

            // ── Customers ─────────────────────────────────────────────────────
            commands::customers::get_customers,
            commands::customers::get_customer,
            commands::customers::search_customers,
            commands::customers::create_customer,
            commands::customers::update_customer,
            commands::customers::delete_customer,
            commands::customers::activate_customer,
            commands::customers::deactivate_customer,
            commands::customers::get_customer_stats,
            commands::customers::get_customer_transactions,

            // ── Suppliers ─────────────────────────────────────────────────────
            commands::suppliers::get_suppliers,
            commands::suppliers::get_supplier,
            commands::suppliers::search_suppliers,
            commands::suppliers::create_supplier,
            commands::suppliers::update_supplier,
            commands::suppliers::delete_supplier,
            commands::suppliers::activate_supplier,
            commands::suppliers::deactivate_supplier,
            commands::suppliers::get_supplier_stats,
            commands::suppliers::get_supplier_spend_timeline,

            // ── Purchase Orders ───────────────────────────────────────────────
            commands::purchase_orders::get_purchase_orders,
            commands::purchase_orders::get_purchase_order,
            commands::purchase_orders::get_po_stats,
            commands::purchase_orders::create_purchase_order,
            commands::purchase_orders::receive_purchase_order,
            commands::purchase_orders::cancel_purchase_order,
            commands::purchase_orders::submit_purchase_order,
            commands::purchase_orders::approve_purchase_order,
            commands::purchase_orders::reject_purchase_order,
            commands::purchase_orders::delete_purchase_order,

            // ── Payments ──────────────────────────────────────────────────────
            commands::payments::get_payments,
            commands::payments::get_payment_summary,

            // ── Shifts ────────────────────────────────────────────────────────
            commands::shifts::open_shift,
            commands::shifts::close_shift,
            commands::shifts::cancel_shift,
            commands::shifts::get_active_shift,
            commands::shifts::get_shifts,
            commands::shifts::get_shift,
            commands::shifts::get_shift_detail_stats,

            // ── Cash Movements ────────────────────────────────────────────────
            commands::shifts::add_cash_movement,
            commands::shifts::get_cash_movements,
            commands::shifts::get_shift_summary,
            commands::cash_movements::log_drawer_event,

            // ── Credit Sales ──────────────────────────────────────────────────
            commands::credit_sales::get_credit_sales,
            commands::credit_sales::get_credit_sale,
            commands::credit_sales::record_credit_payment,
            commands::credit_sales::get_credit_payments,
            commands::credit_sales::cancel_credit_sale,
            commands::credit_sales::get_outstanding_balances,
            commands::credit_sales::get_overdue_sales,
            commands::credit_sales::update_credit_limit,
            commands::credit_sales::get_credit_summary,

            // ── Expenses ──────────────────────────────────────────────────────
            commands::expenses::get_expenses,
            commands::expenses::get_expense,
            commands::expenses::create_expense,
            commands::expenses::update_expense,
            commands::expenses::approve_expense,
            commands::expenses::reject_expense,
            commands::expenses::delete_expense,
            commands::expenses::get_expense_summary,
            commands::expenses::get_expense_breakdown,

            // ── Analytics / Reports ───────────────────────────────────────────
            commands::analytics::get_sales_summary,
            commands::analytics::get_revenue_by_period,
            commands::analytics::get_top_items,
            commands::analytics::get_top_categories,
            commands::analytics::get_payment_method_summary,
            commands::analytics::get_daily_summary,
            commands::analytics::get_department_analytics,
            commands::analytics::get_category_analytics,
            commands::analytics::get_item_analytics,
            commands::analytics::get_slow_moving_items,
            commands::analytics::get_dead_stock,
            commands::analytics::get_profit_analysis,
            commands::analytics::get_cashier_performance,
            commands::analytics::get_profit_loss_summary,
            commands::analytics::get_stock_velocity,
            commands::analytics::get_peak_hours,
            commands::analytics::get_customer_analytics,
            commands::analytics::get_return_analysis,
            commands::analytics::get_comparison_report,
            commands::analytics::get_discount_analytics,
            commands::analytics::get_payment_trends,
            commands::analytics::get_supplier_analytics,
            commands::analytics::get_tax_report,
            commands::analytics::get_low_margin_items,
            commands::analytics::get_business_health_summary,

            // ── Receipts ──────────────────────────────────────────────────────
            commands::receipts::get_receipt,
            commands::receipts::generate_receipt_html,
            commands::receipts::get_receipt_settings,
            commands::receipts::update_receipt_settings,

            // ── Tax Categories ────────────────────────────────────────────────
            commands::tax::get_tax_categories,
            commands::tax::create_tax_category,
            commands::tax::update_tax_category,
            commands::tax::delete_tax_category,

            // ── Price Management ──────────────────────────────────────────────
            commands::price_management::get_price_lists,
            commands::price_management::create_price_list,
            commands::price_management::update_price_list,
            commands::price_management::delete_price_list,
            commands::price_management::add_price_list_item,
            commands::price_management::get_price_list_items,
            commands::price_management::request_price_change,
            commands::price_management::approve_price_change,
            commands::price_management::reject_price_change,
            commands::price_management::get_price_changes,
            commands::price_management::get_price_history,

            // ── Excel Import / Export ─────────────────────────────────────────
            commands::excel::import_items,
            commands::excel::import_customers,
            commands::excel::import_stock_count,
            commands::excel::export_items,
            commands::excel::export_items_filtered,
            commands::excel::export_customers,
            commands::excel::export_expenses,
            commands::excel::export_transactions,

            // ── Audit Log ─────────────────────────────────────────────────────
            commands::audit::get_audit_logs,
            commands::audit::get_audit_log_entry,
            commands::audit::log_action,

            // ── Reorder Alerts ────────────────────────────────────────────────
            commands::reorder_alerts::check_reorder_alerts,
            commands::reorder_alerts::get_reorder_alerts,
            commands::reorder_alerts::acknowledge_reorder_alert,
            commands::reorder_alerts::link_po_to_alert,

            // ── Stock Transfers ───────────────────────────────────────────────
            commands::stock_transfers::create_transfer,
            commands::stock_transfers::send_transfer,
            commands::stock_transfers::receive_transfer,
            commands::stock_transfers::cancel_transfer,
            commands::stock_transfers::get_transfers,
            commands::stock_transfers::get_transfer,

            // ── End-of-Day Reports ────────────────────────────────────────────
            commands::eod::generate_eod_report,
            commands::eod::lock_eod_report,
            commands::eod::get_eod_report,
            commands::eod::get_eod_history,
            commands::eod::get_eod_breakdown,

            // ── Store Settings ────────────────────────────────────────────────
            commands::store_settings::get_store_settings,
            commands::store_settings::update_store_settings,

            // ── Loyalty Points ────────────────────────────────────────────────
            commands::loyalty::get_loyalty_settings,
            commands::loyalty::update_loyalty_settings,
            commands::loyalty::earn_points,
            commands::loyalty::redeem_points,
            commands::loyalty::adjust_points,
            commands::loyalty::get_loyalty_history,
            commands::loyalty::get_loyalty_balance,
            commands::loyalty::expire_old_points,

            // ── Notifications ─────────────────────────────────────────────────
            commands::notifications::create_notification,
            commands::notifications::get_notifications,
            commands::notifications::mark_notification_read,
            commands::notifications::mark_all_notifications_read,
            commands::notifications::get_unread_count,

            // ── Supplier Payments ─────────────────────────────────────────────
            commands::supplier_payments::record_supplier_payment,
            commands::supplier_payments::get_supplier_payments,
            commands::supplier_payments::get_supplier_balance,
            commands::supplier_payments::get_all_supplier_payables,

            // ── Data Backup & Export ───────────────────────────────────────
            commands::backup::create_backup,
            commands::backup::restore_from_backup,
            commands::backup::list_backups,
            commands::backup::schedule_auto_backup,
            commands::backup::export_inventory_csv,

            // ── Bulk Operations ─────────────────────────────────────────────
            commands::bulk_operations::bulk_price_update,
            commands::bulk_operations::bulk_stock_adjustment,
            commands::bulk_operations::bulk_activate_items,
            commands::bulk_operations::bulk_deactivate_items,
            commands::bulk_operations::bulk_apply_discount,
            commands::bulk_operations::bulk_item_import,
            commands::bulk_operations::bulk_print_labels,

            // ── Price Scheduling ───────────────────────────────────────────
            commands::price_scheduling::get_item_price_history,
            commands::price_scheduling::schedule_price_change,
            commands::price_scheduling::cancel_scheduled_price_change,
            commands::price_scheduling::get_pending_price_changes,
            commands::price_scheduling::apply_scheduled_prices,

            // ── Customer Wallet ────────────────────────────────────────────
            commands::customer_wallet::deposit_to_wallet,
            commands::customer_wallet::get_wallet_balance,
            commands::customer_wallet::get_wallet_history,
            commands::customer_wallet::adjust_wallet,

            // ── Barcode & Label Printing ──────────────────────────────────
            commands::labels::generate_item_labels,
            commands::labels::auto_generate_barcode,
            commands::labels::print_price_tags,
            commands::labels::get_label_template,
            commands::labels::save_label_template,

            // ── POS Security & Session Management ────────────────────────
            commands::security::set_pos_pin,
            commands::security::verify_pos_pin,
            commands::security::lock_pos_screen,
            commands::security::get_active_sessions,
            commands::security::revoke_session,

            // ── FX Rates ─────────────────────────────────────────────────
            commands::fx_rates::get_exchange_rate,
            commands::fx_rates::set_exchange_rate,
            commands::fx_rates::get_exchange_rate_history,
            commands::fx_rates::convert_amount,

            // ── Native ESC/POS Printing ──────────────────────────────────
            commands::printer::list_printers,
            commands::printer::get_default_printer,
            commands::printer::print_receipt_escpos,
            commands::printer::print_labels_escpos,
            commands::printer::print_test_page,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quantum POS");
}
