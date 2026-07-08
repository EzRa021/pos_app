// ============================================================================
// LIB.RS — Zera Tauri Application Entry Point
// ============================================================================
// Auto-migration flow:
//   1. App starts → reads saved DB config from tauri-plugin-store.
//   2. If config found → create_pool() → migrations run against local Postgres.
//   3. Any new .sql file in /migrations/ is applied; already-applied ones skip.
//   4. If no saved config → setup wizard shown; db_connect saves config + migrates.
//   5. On next launch → step 1 auto-connects again.
//
// Supabase / cloud flow:
//   6. Supabase credentials found (embedded or user-configured) → connect.
//   7. create_cloud_pool_with_migrations() ALWAYS runs — for both embedded
//      builds and manually-configured credentials. The 79 migrations are baked
//      into the binary via include_dir! and are 100% idempotent (IF NOT EXISTS,
//      ON CONFLICT DO NOTHING, etc.), so re-running on an already-migrated DB
//      is instant and safe. The _app_migrations table skips already-applied files.
//   8. Result: the Supabase schema is ALWAYS in sync with the binary — no manual
//      steps, no "run migrations" button, no schema drift between instances.
// ============================================================================

mod commands;
mod database;
mod error;
mod http_server;
mod models;
mod state;
mod utils;

use database::pool::{create_cloud_pool_with_migrations, create_pool};
use state::AppState;
use state::{DbConfig, SupabaseConfig};
use std::sync::atomic::Ordering;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const DB_CFG_KEY: &str = "db_config";
const SUPABASE_CFG_KEY: &str = "supabase_config";

/// Supabase credentials embedded in the binary at COMPILE TIME via env vars
/// (never hardcoded in source, never committed to git). These are used
/// automatically at startup — no user configuration required.
///
/// Set locally via `src-tauri/.env` (already gitignored) for `pnpm tauri dev`,
/// and via GitHub Actions repository secrets for release builds:
///   SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_ANON_KEY
pub(crate) const EMBEDDED_SUPABASE_DB_URL: Option<&str> = option_env!("SUPABASE_DB_URL");
pub(crate) const EMBEDDED_SUPABASE_URL: Option<&str> = option_env!("SUPABASE_URL");
pub(crate) const EMBEDDED_SUPABASE_ANON_KEY: Option<&str> = option_env!("SUPABASE_ANON_KEY");

// ── get_api_port ──────────────────────────────────────────────────────────────
#[tauri::command]
fn get_api_port(state: tauri::State<'_, AppState>) -> u16 {
    state.api_port.load(Ordering::Relaxed)
}

// ── open_devtools ─────────────────────────────────────────────────────────────
// Lets the running app open its own WebView devtools without a rebuild —
// useful for diagnosing fetch/network errors (firewall, proxy, CORS) that
// only show up in the browser console, not in Rust's tracing logs.
// Requires the `devtools` Cargo feature (enabled above) to work in release
// builds; it's on by default in debug builds regardless.
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── Structured logging ────────────────────────────────────────────────────
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "zera_lib=info,tauri=warn".into()),
        )
        .init();

    // ── JWT secret ────────────────────────────────────────────────────────────
    let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(b"zera-default-secret-change-in-production");
        format!("{:x}", h.finalize())
    });

    tauri::Builder::default()
        // ── Plugins ───────────────────────────────────────────────────────────
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // ── Setup: state, auto-connect, HTTP server ───────────────────────────
        .setup(|app| {
            let app_state = AppState::new(jwt_secret);

            // ── AUTO-CONNECT ──────────────────────────────────────────────────
            let auto_state = app_state.clone();
            let app_handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                // ── Local DB ──────────────────────────────────────────────────
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
                            config.host,
                            config.port,
                            config.database
                        );
                        match create_pool(&config).await {
                            Ok(pool) => {
                                let mut guard = auto_state.db.lock().await;
                                *guard = Some(pool);
                                tracing::info!(
                                    "Auto-connected to {}:{}/{} and local migrations applied.",
                                    config.host,
                                    config.port,
                                    config.database
                                );
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "Auto-connect failed ({}). The setup wizard will appear.",
                                    e
                                );
                            }
                        }
                    }
                }

                // ── Supabase cloud DB ─────────────────────────────────────────
                // Priority: embedded build-time credentials > user-configured settings.json.
                // Migrations always run — create_cloud_pool_with_migrations is unconditional
                // so the cloud schema tracks the binary on every launch automatically.
                let is_embedded = EMBEDDED_SUPABASE_DB_URL.is_some();
                let supa_cfg: Option<SupabaseConfig> =
                    if let Some(db_url) = EMBEDDED_SUPABASE_DB_URL {
                        Some(SupabaseConfig {
                            url:      EMBEDDED_SUPABASE_URL.unwrap_or_default().to_string(),
                            anon_key: EMBEDDED_SUPABASE_ANON_KEY.unwrap_or_default().to_string(),
                            db_url:   db_url.to_string(),
                        })
                    } else {
                        app_handle
                            .store(STORE_FILE)
                            .ok()
                            .and_then(|store| store.get(SUPABASE_CFG_KEY))
                            .and_then(|val| serde_json::from_value(val).ok())
                    };

                if let Some(supa) = supa_cfg {
                    if !supa.db_url.is_empty() {
                        // ── Always auto-migrate the cloud schema ──────────────
                        // All 79 migrations are idempotent. Running them against
                        // an already up-to-date DB costs only one SELECT per
                        // migration (the _app_migrations hash check). Schema drift
                        // between the binary and Supabase is now impossible.
                        tracing::info!(
                            "Connecting to Supabase and auto-migrating schema \
                             ({} migrations embedded)…",
                            "79"
                        );
                        let cloud_pool_result =
                            create_cloud_pool_with_migrations(&supa.db_url).await;

                        match cloud_pool_result {
                            Ok(cloud_pool) => {
                                *auto_state.cloud_db.lock().await = Some(cloud_pool);
                                *auto_state.supabase_config.write().await = Some(supa);
                                tracing::info!(
                                    "Supabase connected and schema is up to date."
                                );

                                // Auto-enable background sync on first successful connect.
                                // INSERT ... ON CONFLICT DO NOTHING — never overrides a
                                // user who explicitly disabled sync.
                                if let Ok(pool) = auto_state.pool().await {
                                    database::sync::auto_enable_sync_if_needed(&pool).await;
                                }
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "Supabase connect/migrate failed ({}). \
                                     Sync will retry when online.",
                                    e
                                );
                                *auto_state.supabase_config.write().await = Some(supa);
                            }
                        }
                    }
                }

                let _ = is_embedded; // suppress unused warning if no other use
            });

            // ── HTTP API server ───────────────────────────────────────────────
            let http_state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                http_server::start(http_state, 4000).await;
            });

            // ── Startup maintenance: reset stuck rows, FK-failed rows, backfill ─
            let backfill_state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                if let Ok(pool) = backfill_state.pool().await {
                    if let Err(e) = database::sync::reset_syncing_rows(&pool).await {
                        tracing::warn!("Syncing-row reset error (non-fatal): {e}");
                    }
                    if let Err(e) = database::sync::reset_fk_failed_rows(&pool).await {
                        tracing::warn!("FK-failed row reset error (non-fatal): {e}");
                    }
                    match database::sync::backfill_sync_queue(&pool).await {
                        Ok(n) if n > 0 => {
                            tracing::info!("Startup backfill: queued {n} rows for cloud sync")
                        }
                        Ok(_) => tracing::debug!("Startup backfill: nothing new to queue"),
                        Err(e) => tracing::warn!("Startup backfill failed: {e}"),
                    }
                }
            });

            // ── Cloud sync: push worker (local → Supabase) ───────────────────
            let sync_worker_state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                database::sync::run_sync_loop(sync_worker_state).await;
            });

            // ── Cloud sync: pull worker (Supabase → local) ───────────────────
            let pull_worker_state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                database::sync::run_pull_loop(pull_worker_state).await;
            });

            // ── Session cleanup (hourly) ──────────────────────────────────────
            let cleanup_state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
                    let now = chrono::Utc::now();
                    cleanup_state
                        .sessions
                        .write()
                        .await
                        .retain(|_, s| s.expires_at > now);
                    tracing::debug!("Session cleanup: pruned expired sessions.");
                }
            });

            // Store AppHandle in AppState for use by HTTP-dispatched commands
            {
                let handle_state = app_state.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    handle_state.set_app_handle(handle).await;
                });
            }

            app.manage(app_state);
            tracing::info!("Zera started.");
            Ok(())
        })
        // ── Command registry ──────────────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            get_api_port,
            open_devtools,
            commands::app::db_connect,
            commands::app::db_create_database,
            commands::app::db_database_exists,
            commands::app::db_disconnect,
            commands::app::db_status,
            commands::app::app_version,
            commands::app::app_name,
            commands::app::get_local_ip,
            commands::app::find_available_port,
            commands::auth::login,
            commands::auth::logout,
            commands::auth::verify_session,
            commands::auth::refresh_token,
            commands::auth::change_password,
            commands::auth::request_password_reset,
            commands::auth::reset_password,
            commands::users::get_users,
            commands::users::get_user,
            commands::users::get_user_activity,
            commands::users::search_users,
            commands::users::create_user,
            commands::users::update_user,
            commands::users::delete_user,
            commands::users::activate_user,
            commands::users::deactivate_user,
            commands::users::reset_user_password,
            commands::users::upload_user_avatar,
            commands::users::remove_user_avatar,
            commands::users::get_roles,
            commands::users::get_permissions,
            commands::users::get_role_permissions,
            commands::users::set_role_permissions,
            commands::stores::get_stores,
            commands::stores::get_store,
            commands::stores::get_my_store,
            commands::stores::create_store,
            commands::stores::update_store,
            commands::stores::get_store_users,
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
            commands::inventory::get_inventory,
            commands::inventory::get_inventory_item,
            commands::inventory::get_low_stock,
            commands::inventory::restock_item,
            commands::inventory::adjust_inventory,
            commands::inventory::get_movement_history,
            commands::inventory::get_inventory_summary,
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
            commands::inventory::get_stock_counts,
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
            commands::returns::create_return,
            commands::returns::get_returns,
            commands::returns::get_return,
            commands::returns::get_transaction_returns,
            commands::returns::get_return_stats,
            commands::returns::void_return,
            commands::returns::search_returns,
            commands::returns::get_transaction_returned_quantities,
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
            commands::customers::get_customer_summary,
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
            commands::payments::get_payments,
            commands::payments::get_payment_summary,
            commands::shifts::open_shift,
            commands::shifts::close_shift,
            commands::shifts::cancel_shift,
            commands::shifts::get_active_shift,
            commands::shifts::get_shifts,
            commands::shifts::get_shift,
            commands::shifts::get_shift_detail_stats,
            commands::shifts::add_cash_movement,
            commands::shifts::get_cash_movements,
            commands::shifts::get_shift_summary,
            commands::cash_movements::log_drawer_event,
            commands::credit_sales::get_credit_sales,
            commands::credit_sales::get_credit_sale,
            commands::credit_sales::record_credit_payment,
            commands::credit_sales::get_credit_payments,
            commands::credit_sales::cancel_credit_sale,
            commands::credit_sales::get_outstanding_balances,
            commands::credit_sales::get_overdue_sales,
            commands::credit_sales::update_credit_limit,
            commands::credit_sales::get_credit_summary,
            commands::expenses::get_expenses,
            commands::expenses::get_expense,
            commands::expenses::create_expense,
            commands::expenses::update_expense,
            commands::expenses::approve_expense,
            commands::expenses::reject_expense,
            commands::expenses::delete_expense,
            commands::expenses::get_expense_summary,
            commands::expenses::get_expense_breakdown,
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
            commands::receipts::get_receipt,
            commands::receipts::generate_receipt_html,
            commands::receipts::get_receipt_settings,
            commands::receipts::update_receipt_settings,
            commands::tax::get_tax_categories,
            commands::tax::create_tax_category,
            commands::tax::update_tax_category,
            commands::tax::delete_tax_category,
            commands::price_management::get_price_lists,
            commands::price_management::create_price_list,
            commands::price_management::update_price_list,
            commands::price_management::delete_price_list,
            commands::price_management::add_price_list_item,
            commands::price_management::remove_price_list_item,
            commands::price_management::get_price_list_items,
            commands::price_management::request_price_change,
            commands::price_management::approve_price_change,
            commands::price_management::reject_price_change,
            commands::price_management::get_price_changes,
            commands::price_management::get_price_change_stats,
            commands::price_management::get_price_history,
            commands::excel::import_items,
            commands::excel::import_customers,
            commands::excel::import_stock_count,
            commands::excel::export_items,
            commands::excel::export_items_filtered,
            commands::excel::export_customers,
            commands::excel::export_expenses,
            commands::excel::export_transactions,
            commands::audit::get_audit_logs,
            commands::audit::get_audit_log_entry,
            commands::audit::log_action,
            commands::reorder_alerts::check_reorder_alerts,
            commands::reorder_alerts::get_reorder_alerts,
            commands::reorder_alerts::acknowledge_reorder_alert,
            commands::reorder_alerts::link_po_to_alert,
            commands::stock_transfers::create_transfer,
            commands::stock_transfers::send_transfer,
            commands::stock_transfers::receive_transfer,
            commands::stock_transfers::cancel_transfer,
            commands::stock_transfers::get_transfers,
            commands::stock_transfers::get_transfer,
            commands::stock_transfers::approve_transfer,
            commands::eod::generate_eod_report,
            commands::eod::lock_eod_report,
            commands::eod::get_eod_report,
            commands::eod::get_eod_history,
            commands::eod::get_eod_breakdown,
            commands::store_settings::get_store_settings,
            commands::store_settings::update_store_settings,
            commands::pos_favourites::get_pos_favourites,
            commands::pos_favourites::add_pos_favourite,
            commands::pos_favourites::remove_pos_favourite,
            commands::loyalty::get_loyalty_settings,
            commands::loyalty::update_loyalty_settings,
            commands::loyalty::earn_points,
            commands::loyalty::redeem_points,
            commands::loyalty::adjust_points,
            commands::loyalty::get_loyalty_history,
            commands::loyalty::get_loyalty_balance,
            commands::loyalty::expire_old_points,
            commands::notifications::create_notification,
            commands::notifications::get_notifications,
            commands::notifications::mark_notification_read,
            commands::notifications::mark_all_notifications_read,
            commands::notifications::get_unread_count,
            commands::supplier_payments::record_supplier_payment,
            commands::supplier_payments::get_supplier_payments,
            commands::supplier_payments::get_supplier_balance,
            commands::supplier_payments::get_all_supplier_payables,
            commands::backup::create_backup,
            commands::backup::restore_from_backup,
            commands::backup::list_backups,
            commands::backup::schedule_auto_backup,
            commands::backup::export_inventory_csv,
            commands::bulk_operations::bulk_price_update,
            commands::bulk_operations::bulk_stock_adjustment,
            commands::bulk_operations::bulk_activate_items,
            commands::bulk_operations::bulk_deactivate_items,
            commands::bulk_operations::bulk_apply_discount,
            commands::bulk_operations::bulk_item_import,
            commands::bulk_operations::bulk_print_labels,
            commands::price_scheduling::get_item_price_history,
            commands::price_scheduling::schedule_price_change,
            commands::price_scheduling::cancel_scheduled_price_change,
            commands::price_scheduling::get_pending_price_changes,
            commands::price_scheduling::apply_scheduled_prices,
            commands::customer_wallet::deposit_to_wallet,
            commands::customer_wallet::get_wallet_balance,
            commands::customer_wallet::get_wallet_history,
            commands::customer_wallet::adjust_wallet,
            commands::labels::generate_item_labels,
            commands::labels::auto_generate_barcode,
            commands::labels::print_price_tags,
            commands::labels::get_label_template,
            commands::labels::save_label_template,
            commands::security::set_pos_pin,
            commands::security::verify_pos_pin,
            commands::security::lock_pos_screen,
            commands::security::get_active_sessions,
            commands::security::revoke_session,
            commands::fx_rates::get_exchange_rate,
            commands::fx_rates::set_exchange_rate,
            commands::fx_rates::get_exchange_rate_history,
            commands::fx_rates::convert_amount,
            commands::printer::list_printers,
            commands::printer::get_default_printer,
            commands::printer::print_receipt_escpos,
            commands::printer::print_labels_escpos,
            commands::printer::print_test_page,
            commands::cloud_sync::save_supabase_config,
            commands::cloud_sync::clear_supabase_config,
            commands::cloud_sync::get_supabase_config,
            commands::cloud_sync::get_sync_status,
            commands::cloud_sync::set_cloud_sync_enabled,
            commands::cloud_sync::trigger_backfill_sync,
            commands::cloud_sync::retry_failed_sync,
            commands::cloud_sync::get_failed_sync_rows,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zera");
}
