// ============================================================================
// HTTP API SERVER — Axum
// ============================================================================
// Runs alongside the Tauri app. Exposes a JSON-RPC style endpoint:
//
//   POST /api/rpc
//   Body:    { "method": "command_name", "params": { ...args } }
//   Auth:    Authorization: Bearer <access_token>  (for protected methods)
//   Returns: JSON result (same shape as invoke()) or { "error": "..." }
//
//   GET /health
//   Returns: { "status": "ok", "version": "x.x.x" }
//
// The server shares AppState with the Tauri command layer (same Arc refs).
// New methods are added to the `dispatch` match as screens are built.
// ============================================================================

use std::sync::atomic::Ordering;
use axum::{
    extract::State as AxumState,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tower_http::cors::CorsLayer;
use axum::http::HeaderValue;

use crate::{
    commands::{
        auth, stores, shifts, cash_movements, departments, categories,
        items, inventory, transactions, returns as ret_cmd, customers, suppliers,
        purchase_orders, payments, credit_sales, expenses, analytics,
        receipts, tax, price_management, audit, users,
        reorder_alerts, stock_transfers, eod, store_settings,
        loyalty, notifications, supplier_payments,
        backup, bulk_operations, price_scheduling,
        customer_wallet, labels, security, fx_rates, excel,
        onboarding, pos_favourites, cloud_sync, payment_methods,
        expense_categories, number_series, store_hours, pos_shortcuts_settings,
    },
    error::AppError,
    models::{
        auth::{LoginRequest, RefreshRequest, ChangePasswordRequest},
        shift::{OpenShiftDto, CloseShiftDto, ShiftFilters, CreateCashMovementDto},
        department::{CreateDepartmentDto, UpdateDepartmentDto},
        category::{CreateCategoryDto, UpdateCategoryDto},
        item::{ItemFilters, CreateItemDto, UpdateItemDto, AdjustStockDto},
        inventory::{InventoryFilters, MovementHistoryFilters, RestockDto, AdjustInventoryDto,
                     StartCountSessionDto, RecordCountDto, CountSessionFilters},
        transaction::{TransactionFilters, CreateTransactionDto, HoldTransactionDto,
                     VoidTransactionDto, PartialRefundDto, FullRefundDto},
        returns::{CreateReturnDto, VoidReturnDto, ReturnFilters},
        customer::{CustomerFilters, CreateCustomerDto, UpdateCustomerDto},
        supplier::{SupplierFilters, CreateSupplierDto, UpdateSupplierDto},
        purchase_order::{PurchaseOrderFilters, CreatePurchaseOrderDto, ReceivePurchaseOrderDto},
        payment::PaymentFilters,
        credit_sale::{CreditSaleFilters, RecordCreditPaymentDto},
        expense::{ExpenseFilters, CreateExpenseDto, UpdateExpenseDto},
        analytics::AnalyticsFilters,
        store::{CreateStoreDto, UpdateStoreDto},
        receipt::{PrintReceiptDto, UpdateReceiptSettingsDto},
        user::{UserFilters, CreateUserDto, UpdateUserDto},
        tax::{CreateTaxCategoryDto, UpdateTaxCategoryDto},
        price::{CreatePriceListDto, AddPriceListItemDto, RequestPriceChangeDto, PriceListFilters},
        audit::AuditFilters,
    },
    models::{
    reorder_alert::ReorderAlertFilters,
    stock_transfer::{CreateTransferDto, SendTransferDto, ReceiveTransferDto, TransferFilters, ExecuteTransferDto},
    eod_report::EodHistoryFilters,
    store_settings::UpdateStoreSettingsDto,
    loyalty::{UpdateLoyaltySettingsDto, EarnPointsDto, RedeemPointsDto, AdjustPointsDto},
    notification::{CreateNotificationDto, NotificationFilters},
    supplier_payment::{RecordSupplierPaymentDto, SupplierPaymentFilters},
    backup::{CreateBackupDto, RestoreBackupDto, AutoBackupScheduleDto},
    bulk_operations::{BulkPriceUpdateDto, BulkStockAdjustmentDto, BulkToggleItemsDto, BulkApplyDiscountDto, BulkItemImportDto},
    price_scheduling::SchedulePriceChangeDto,
    customer_wallet::{DepositDto, AdjustWalletDto},
    label::{GenerateLabelsDto, PrintPriceTagsDto, SaveLabelTemplateDto},
    security::{SetPinDto, VerifyPinDto},
    fx_rates::{SetRateDto, ConvertDto},
    pos_favourites::{AddFavouriteDto, RemoveFavouriteDto},
    },
    state::AppState,
};

// ── Request / Response types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status:  &'static str,
    pub version: &'static str,
}

// ── Start function ────────────────────────────────────────────────────────────

/// Binds the Axum server to `0.0.0.0:preferred_port` (tries next ports on
/// conflict) and stores the actual port in `state.api_port`.
/// This function never returns — run it inside `tokio::spawn`.
pub async fn start(state: AppState, preferred_port: u16) {
    let listener = {
        let mut port = preferred_port;
        loop {
            match tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await {
                Ok(l) => break l,
                Err(_) => {
                    port = port.saturating_add(1);
                    if port == 0 {
                        tracing::error!("No available port found for HTTP API server");
                        return;
                    }
                }
            }
        }
    };

    let actual_port = listener.local_addr().map(|a| a.port()).unwrap_or(preferred_port);
    state.api_port.store(actual_port, Ordering::Relaxed);
    tracing::info!("HTTP API server listening on port {actual_port}");

    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::predicate(|origin: &HeaderValue, _| {
            let s = origin.as_bytes();
            s.starts_with(b"http://localhost")
                || s.starts_with(b"http://127.")
                || s.starts_with(b"http://192.168.")
                || s.starts_with(b"http://10.")
        }))
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/api/rpc", post(rpc_handler))
        .layer(cors)
        .with_state(state);

    if let Err(e) = axum::serve(listener, app).await {
        tracing::error!("HTTP API server error: {e}");
    }
}

// ── /health ───────────────────────────────────────────────────────────────────

async fn health_handler() -> Json<HealthResponse> {
    Json(HealthResponse {
        status:  "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

// ── /api/rpc ──────────────────────────────────────────────────────────────────

async fn rpc_handler(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Json(body): Json<RpcRequest>,
) -> impl IntoResponse {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    let method = body.method.clone();
    match dispatch(&state, &body.method, token, body.params).await {
        Ok(val) => (StatusCode::OK, Json(val)).into_response(),
        Err(e) => {
            let status = match &e {
                AppError::Unauthorized(_) | AppError::SessionExpired => StatusCode::UNAUTHORIZED,
                AppError::Forbidden                                   => StatusCode::FORBIDDEN,
                AppError::NotFound(_)                                 => StatusCode::NOT_FOUND,
                AppError::Validation(_)                               => StatusCode::UNPROCESSABLE_ENTITY,
                AppError::NotConnected                                => StatusCode::SERVICE_UNAVAILABLE,
                _                                                     => StatusCode::INTERNAL_SERVER_ERROR,
            };
            // Log to backend terminal — errors were silently swallowed before
            match &e {
                AppError::Unauthorized(_) | AppError::Forbidden | AppError::SessionExpired
                | AppError::NotFound(_)   | AppError::Validation(_) => {
                    tracing::warn!("[{}] {} — {}", status.as_u16(), method, e);
                }
                _ => {
                    tracing::error!("[{}] {} — {}", status.as_u16(), method, e);
                }
            }
            (status, Json(json!({ "error": e.to_string() }))).into_response()
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Transmute `&AppState` into a `tauri::State<'_, AppState>` so we can reuse
/// Tauri command implementations that take `State<'_, AppState>`.
/// This is safe because AppState is `'static` and all fields are Arc<_>.
#[inline]
fn as_state(s: &AppState) -> tauri::State<'_, AppState> {
    unsafe { std::mem::transmute(s) }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

async fn dispatch(
    state:  &AppState,
    method: &str,
    token:  Option<String>,
    params: Value,
) -> Result<Value, AppError> {
    let require_token = || {
        token.clone().ok_or_else(|| AppError::Unauthorized("Missing Authorization header".into()))
    };

    fn parse<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, AppError> {
        serde_json::from_value(v).map_err(|e| AppError::Validation(e.to_string()))
    }

    fn i32_param(params: &Value, key: &str) -> Result<i32, AppError> {
        params.get(key)
            .and_then(|v| v.as_i64())
            .map(|v| v as i32)
            .ok_or_else(|| AppError::Validation(format!("Missing '{key}' parameter")))
    }

    fn opt_i32(params: &Value, key: &str) -> Option<i32> {
        params.get(key).and_then(|v| v.as_i64()).map(|v| v as i32)
    }

    fn opt_i64(params: &Value, key: &str) -> Option<i64> {
        params.get(key).and_then(|v| v.as_i64())
    }

    fn opt_bool(params: &Value, key: &str) -> Option<bool> {
        params.get(key).and_then(|v| v.as_bool())
    }

    fn opt_str(params: &Value, key: &str) -> Option<String> {
        params.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
    }

    match method {
        // ════════════════════════════════════════════════════════════════════
        // AUTH
        // ════════════════════════════════════════════════════════════════════

        "login" => {
            let payload: LoginRequest = parse(params)?;
            let result = auth::login_inner(state, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "refresh_token" => {
            let payload: RefreshRequest = parse(params)?;
            let result = auth::refresh_token_inner(state, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "logout" => {
            auth::logout_inner(state, require_token()?).await?;
            Ok(Value::Null)
        }

        "change_password" => {
            let payload: ChangePasswordRequest = parse(params)?;
            auth::change_password_inner(state, require_token()?, payload).await?;
            Ok(Value::Null)
        }

        "verify_session" => {
            let result = auth::verify_session(as_state(state), require_token()?).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "request_password_reset" => {
            let username = opt_str(&params, "username")
                .ok_or_else(|| AppError::Validation("Missing 'username'".into()))?;
            let result = auth::request_password_reset(as_state(state), username).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "reset_password" => {
            let tok = opt_str(&params, "token")
                .ok_or_else(|| AppError::Validation("Missing 'token'".into()))?;
            let new_password = opt_str(&params, "new_password")
                .ok_or_else(|| AppError::Validation("Missing 'new_password'".into()))?;
            auth::reset_password(as_state(state), tok, new_password).await?;
            Ok(Value::Null)
        }

        // ════════════════════════════════════════════════════════════════════
        // USERS & ROLES
        // ════════════════════════════════════════════════════════════════════

        "get_users" => {
            let filters: UserFilters = parse(params)?;
            let result = users::get_users(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_user" => {
            let id = i32_param(&params, "id")?;
            let result = users::get_user(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "create_user" => {
            let payload: CreateUserDto = parse(params)?;
            let result = users::create_user(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_user" => {
            let id = i32_param(&params, "id")?;
            let payload: UpdateUserDto = parse(params)?;
            let result = users::update_user(as_state(state), require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "delete_user" => {
            let id = i32_param(&params, "id")?;
            users::delete_user(as_state(state), require_token()?, id).await?;
            Ok(Value::Null)
        }

        "get_roles" => {
            let result = users::get_roles(as_state(state), require_token()?).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "search_users" => {
            let query: String = params.get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let limit = params.get("limit").and_then(|v| v.as_i64());
            let result = users::search_users(as_state(state), require_token()?, query, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "activate_user" => {
            let id = i32_param(&params, "id")?;
            let result = users::activate_user(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "deactivate_user" => {
            let id = i32_param(&params, "id")?;
            let result = users::deactivate_user(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "reset_user_password" => {
            let id = i32_param(&params, "id")?;
            let new_password: String = params.get("new_password")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::Validation("new_password is required".into()))?
                .to_string();
            users::reset_user_password(as_state(state), require_token()?, id, new_password).await?;
            Ok(Value::Null)
        }

        "upload_user_avatar" => {
            let id = i32_param(&params, "id")?;
            let avatar: String = params.get("avatar")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::Validation("avatar is required".into()))?
                .to_string();
            let result = users::upload_user_avatar(as_state(state), require_token()?, id, avatar).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "remove_user_avatar" => {
            let id = i32_param(&params, "id")?;
            let result = users::remove_user_avatar(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_permissions" => {
            let result = users::get_permissions(as_state(state), require_token()?).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_role_permissions" => {
            let role_id = i32_param(&params, "role_id")?;
            let result = users::get_role_permissions(as_state(state), require_token()?, role_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "set_role_permissions" => {
            let role_id = i32_param(&params, "role_id")?;
            let permission_ids: Vec<i32> = params.get("permission_ids")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            users::set_role_permissions(as_state(state), require_token()?, role_id, permission_ids).await?;
            Ok(Value::Null)
        }

        // ════════════════════════════════════════════════════════════════════
        // STORES
        // ════════════════════════════════════════════════════════════════════

        "get_stores" => {
            let is_active = opt_bool(&params, "is_active");
            let result = stores::get_stores_inner(state, require_token()?, is_active).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_store" => {
            let id = i32_param(&params, "id")?;
            let result = stores::get_store_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_my_store" => {
            let result = stores::get_my_store_inner(state, require_token()?).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "create_store" => {
            let payload: CreateStoreDto = parse(params)?;
            let result = stores::create_store(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_store" => {
            let id = i32_param(&params, "id")?;
            let payload: UpdateStoreDto = parse(params)?;
            let result = stores::update_store(as_state(state), require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_store_users" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = stores::get_store_users_inner(state, require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // DEPARTMENTS
        // ════════════════════════════════════════════════════════════════════

        "get_departments" => {
            let store_id = opt_i32(&params, "store_id");
            let result = departments::get_departments_inner(state, require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_department" => {
            let id = i32_param(&params, "id")?;
            let result = departments::get_department_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "create_department" => {
            let payload: CreateDepartmentDto = parse(params)?;
            let result = departments::create_department_inner(state, require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_department" => {
            let id = i32_param(&params, "id")?;
            let payload: UpdateDepartmentDto = parse(params)?;
            let result = departments::update_department_inner(state, require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "delete_department" => {
            let id = i32_param(&params, "id")?;
            departments::delete_department_inner(state, require_token()?, id).await?;
            Ok(Value::Null)
        }

        "hard_delete_department" => {
            let id = i32_param(&params, "id")?;
            departments::hard_delete_department_inner(state, require_token()?, id).await?;
            Ok(Value::Null)
        }

        "search_departments" => {
            let query = opt_str(&params, "query")
                .ok_or_else(|| AppError::Validation("Missing 'query'".into()))?;
            let limit = opt_i64(&params, "limit");
            let result = departments::search_departments_inner(state, require_token()?, query, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_departments_by_store" => {
            let store_id = i32_param(&params, "store_id")?;
            let is_active = opt_bool(&params, "is_active");
            let include_global = opt_bool(&params, "include_global");
            let result = departments::get_departments_by_store_inner(state, require_token()?, store_id, is_active, include_global).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_global_departments" => {
            let is_active = opt_bool(&params, "is_active");
            let result = departments::get_global_departments_inner(state, require_token()?, is_active).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_department_by_code" => {
            let code = opt_str(&params, "code")
                .ok_or_else(|| AppError::Validation("Missing 'code'".into()))?;
            let result = departments::get_department_by_code_inner(state, require_token()?, code).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_department_categories" => {
            let department_id = i32_param(&params, "department_id")?;
            let is_active = opt_bool(&params, "is_active");
            let result = departments::get_department_categories_inner(state, require_token()?, department_id, is_active).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "activate_department" => {
            let id = i32_param(&params, "id")?;
            let result = departments::activate_department_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "deactivate_department" => {
            let id = i32_param(&params, "id")?;
            let result = departments::deactivate_department_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "count_departments" => {
            let store_id = opt_i32(&params, "store_id");
            let is_active = opt_bool(&params, "is_active");
            let result = departments::count_departments_inner(state, require_token()?, store_id, is_active).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // CATEGORIES
        // ════════════════════════════════════════════════════════════════════

        "get_categories" => {
            let store_id = opt_i32(&params, "store_id");
            let department_id = opt_i32(&params, "department_id");
            let result = categories::get_categories_inner(state, require_token()?, store_id, department_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_category" => {
            let id = i32_param(&params, "id")?;
            let result = categories::get_category_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "create_category" => {
            let payload: CreateCategoryDto = parse(params)?;
            let result = categories::create_category_inner(state, require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_category" => {
            let id = i32_param(&params, "id")?;
            let payload: UpdateCategoryDto = parse(params)?;
            let result = categories::update_category_inner(state, require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "delete_category" => {
            let id = i32_param(&params, "id")?;
            categories::delete_category_inner(state, require_token()?, id).await?;
            Ok(Value::Null)
        }

        "hard_delete_category" => {
            let id = i32_param(&params, "id")?;
            categories::hard_delete_category_inner(state, require_token()?, id).await?;
            Ok(Value::Null)
        }

        "search_categories" => {
            let query = opt_str(&params, "query")
                .ok_or_else(|| AppError::Validation("Missing 'query'".into()))?;
            let store_id = opt_i32(&params, "store_id");
            let limit = opt_i64(&params, "limit");
            let result = categories::search_categories_inner(state, require_token()?, query, store_id, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_category_by_code" => {
            let code = opt_str(&params, "code")
                .ok_or_else(|| AppError::Validation("Missing 'code'".into()))?;
            let store_id = opt_i32(&params, "store_id");
            let result = categories::get_category_by_code_inner(state, require_token()?, code, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_pos_categories" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = categories::get_pos_categories_inner(state, require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_subcategories" => {
            let parent_id = i32_param(&params, "parent_id")?;
            let is_active = opt_bool(&params, "is_active");
            let result = categories::get_subcategories_inner(state, require_token()?, parent_id, is_active).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_category_items" => {
            let category_id = i32_param(&params, "category_id")?;
            let is_active = opt_bool(&params, "is_active");
            let result = categories::get_category_items_inner(state, require_token()?, category_id, is_active).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "activate_category" => {
            let id = i32_param(&params, "id")?;
            let result = categories::activate_category_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "deactivate_category" => {
            let id = i32_param(&params, "id")?;
            let result = categories::deactivate_category_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "assign_category_department" => {
            let category_id = i32_param(&params, "category_id")?;
            let department_id = opt_i32(&params, "department_id");
            let result = categories::assign_category_department_inner(state, require_token()?, category_id, department_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "count_categories" => {
            let store_id = opt_i32(&params, "store_id");
            let department_id = opt_i32(&params, "department_id");
            let is_active = opt_bool(&params, "is_active");
            let result = categories::count_categories_inner(state, require_token()?, store_id, department_id, is_active).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // ITEMS
        // ════════════════════════════════════════════════════════════════════

        "get_items" => {
            let filters: ItemFilters = parse(params)?;
            let result = items::get_items(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_item" => {
            let id: uuid::Uuid = parse(params.get("id").cloned().unwrap_or(Value::Null))?;
            let result = items::get_item(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_item_by_barcode" => {
            let barcode = opt_str(&params, "barcode")
                .ok_or_else(|| AppError::Validation("Missing 'barcode'".into()))?;
            let store_id = opt_i32(&params, "store_id");
            let result = items::get_item_by_barcode(as_state(state), require_token()?, barcode, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_item_by_sku" => {
            let sku = opt_str(&params, "sku")
                .ok_or_else(|| AppError::Validation("Missing 'sku'".into()))?;
            let store_id = opt_i32(&params, "store_id");
            let result = items::get_item_by_sku(as_state(state), require_token()?, sku, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "create_item" => {
            let payload: CreateItemDto = parse(params)?;
            let result = items::create_item(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_item" => {
            let id: uuid::Uuid = parse(params.get("id").cloned().unwrap_or(Value::Null))?;
            let payload: UpdateItemDto = parse(params)?;
            let result = items::update_item(as_state(state), require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "delete_item" => {
            let id: uuid::Uuid = parse(params.get("id").cloned().unwrap_or(Value::Null))?;
            items::delete_item(as_state(state), require_token()?, id).await?;
            Ok(Value::Null)
        }

        "adjust_stock" => {
            let payload: AdjustStockDto = parse(params)?;
            let result = items::adjust_stock(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_item_history" => {
            let item_id: uuid::Uuid = parse(params.get("item_id").cloned().unwrap_or(Value::Null))?;
            let page       = opt_i64(&params, "page");
            let limit      = opt_i64(&params, "limit");
            let date_from  = opt_str(&params, "date_from");
            let date_to    = opt_str(&params, "date_to");
            let event_type = opt_str(&params, "event_type");
            let result = items::get_item_history(as_state(state), require_token()?, item_id, page, limit, date_from, date_to, event_type).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "search_items" => {
            let query = opt_str(&params, "query")
                .ok_or_else(|| AppError::Validation("Missing 'query'".into()))?;
            let store_id = opt_i32(&params, "store_id");
            let limit    = opt_i64(&params, "limit");
            let result = items::search_items(as_state(state), require_token()?, query, store_id, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "activate_item" => {
            let id: uuid::Uuid = parse(params.get("id").cloned().unwrap_or(Value::Null))?;
            let result = items::activate_item(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "deactivate_item" => {
            let id: uuid::Uuid = parse(params.get("id").cloned().unwrap_or(Value::Null))?;
            let result = items::deactivate_item(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "remove_item_image" => {
            let id: uuid::Uuid = parse(params.get("id").cloned().unwrap_or(Value::Null))?;
            let result = items::remove_item_image(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "count_items" => {
            let store_id    = opt_i32(&params, "store_id");
            let category_id = opt_i32(&params, "category_id");
            let is_active   = opt_bool(&params, "is_active");
            let result = items::count_items(as_state(state), require_token()?, store_id, category_id, is_active).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // INVENTORY
        // ════════════════════════════════════════════════════════════════════

        "get_inventory" => {
            let filters: InventoryFilters = parse(params)?;
            let result = inventory::get_inventory_inner(state, require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_inventory_item" => {
            let item_id: uuid::Uuid = parse(params.get("item_id").cloned().unwrap_or(Value::Null))?;
            let store_id = i32_param(&params, "store_id")?;
            let result = inventory::get_inventory_item_inner(state, require_token()?, item_id, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_low_stock" => {
            let store_id = opt_i32(&params, "store_id");
            let limit    = opt_i64(&params, "limit");
            let result = inventory::get_low_stock_inner(state, require_token()?, store_id, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "restock_item" => {
            let payload: RestockDto = parse(params)?;
            let result = inventory::restock_item_inner(state, require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "adjust_inventory" => {
            let payload: AdjustInventoryDto = parse(params)?;
            let result = inventory::adjust_inventory_inner(state, require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_movement_history" => {
            let store_id = i32_param(&params, "store_id")?;
            let filters: MovementHistoryFilters = parse(params)?;
            let result = inventory::get_movement_history_inner(state, require_token()?, store_id, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_inventory_summary" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = inventory::get_inventory_summary_inner(state, require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // Stock count pipeline
        "start_count_session" | "start_stock_count" => {
            let store_id = i32_param(&params, "store_id")?;
            let payload  = StartCountSessionDto {
                count_type: opt_str(&params, "count_type"),
                notes:      opt_str(&params, "notes"),
            };
            let result = inventory::start_count_session_inner(state, require_token()?, store_id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "record_count" => {
            let session_id = i32_param(&params, "session_id")?;
            let store_id   = i32_param(&params, "store_id")?;
            let payload: RecordCountDto = parse(params)?;
            let result = inventory::record_count_inner(state, require_token()?, session_id, store_id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "complete_count_session" => {
            let session_id       = i32_param(&params, "session_id")?;
            let store_id         = i32_param(&params, "store_id")?;
            let apply_variances  = opt_bool(&params, "apply_variances").unwrap_or(false);
            let result = inventory::complete_count_session_inner(state, require_token()?, session_id, store_id, apply_variances).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_variance_report" => {
            let session_id = i32_param(&params, "session_id")?;
            let store_id   = i32_param(&params, "store_id")?;
            let result = inventory::get_variance_report_inner(state, require_token()?, session_id, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "apply_variances_standalone" => {
            let session_id = i32_param(&params, "session_id")?;
            let store_id   = i32_param(&params, "store_id")?;
            let result = inventory::apply_variances_standalone_inner(state, require_token()?, session_id, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_count_session" => {
            let session_id = i32_param(&params, "session_id")?;
            let store_id   = i32_param(&params, "store_id")?;
            let result = inventory::get_count_session_inner(state, require_token()?, session_id, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_stock_count_stats" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = inventory::get_stock_count_stats_inner(state, require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_session_count_items" => {
            let session_id = i32_param(&params, "session_id")?;
            let store_id   = i32_param(&params, "store_id")?;
            let result = inventory::get_session_count_items_inner(state, require_token()?, session_id, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "cancel_count_session" => {
            let session_id = i32_param(&params, "session_id")?;
            let store_id   = i32_param(&params, "store_id")?;
            let payload    = inventory::CancelCountSessionDto {
                reason: opt_str(&params, "reason"),
            };
            let result = inventory::cancel_count_session_inner(state, require_token()?, session_id, store_id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_count_sessions" | "get_stock_counts" => {
            let filters = CountSessionFilters {
                page:       opt_i64(&params, "page"),
                limit:      opt_i64(&params, "limit"),
                store_id:   opt_i32(&params, "store_id"),
                status:     opt_str(&params, "status"),
                count_type: opt_str(&params, "count_type"),
                search:     opt_str(&params, "search"),
            };
            let result = inventory::get_count_sessions_inner(state, require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_inventory_for_count" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = inventory::get_inventory_for_count_inner(state, require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // TRANSACTIONS
        // ════════════════════════════════════════════════════════════════════

        "create_transaction" => {
            let payload: CreateTransactionDto = parse(params)?;
            let result = transactions::create_transaction_inner(state, require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_transactions" => {
            let filters: TransactionFilters = parse(params)?;
            let result = transactions::get_transactions_inner(state, require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_transaction" => {
            let id = i32_param(&params, "id")?;
            let result = transactions::get_transaction_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_transaction_stats" => {
            let store_id = opt_i32(&params, "store_id");
            let result = transactions::get_transaction_stats_inner(state, require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "void_transaction" => {
            let id = i32_param(&params, "id")?;
            let payload: VoidTransactionDto = parse(params)?;
            let result = transactions::void_transaction_inner(state, require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "partial_refund" => {
            let id = i32_param(&params, "id")?;
            let payload: PartialRefundDto = parse(params)?;
            let result = transactions::partial_refund_inner(state, require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "full_refund" => {
            let id = i32_param(&params, "id")?;
            let payload: FullRefundDto = parse(params)?;
            let result = transactions::full_refund_inner(state, require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "hold_transaction" => {
            let payload: HoldTransactionDto = parse(params)?;
            let result = transactions::hold_transaction_inner(state, require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_held_transactions" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = transactions::get_held_transactions_inner(state, require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "delete_held_transaction" => {
            let id = i32_param(&params, "id")?;
            transactions::delete_held_transaction_inner(state, require_token()?, id).await?;
            Ok(Value::Null)
        }

        "search_transactions" => {
            let query    = opt_str(&params, "query").unwrap_or_default();
            let store_id = opt_i32(&params, "store_id");
            let limit    = opt_i64(&params, "limit");
            let result = transactions::search_transactions_inner(state, require_token()?, query, store_id, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // RETURNS
        // ════════════════════════════════════════════════════════════════════

        "create_return" => {
            let payload: CreateReturnDto = parse(params)?;
            let result = ret_cmd::create_return(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_returns" => {
            let filters: ReturnFilters = parse(params)?;
            let result = ret_cmd::get_returns(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_return" => {
            let id = i32_param(&params, "id")?;
            let result = ret_cmd::get_return(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_return_stats" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = ret_cmd::get_return_stats(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "void_return" => {
            let id = i32_param(&params, "id")?;
            let payload: VoidReturnDto = parse(params)?;
            let result = ret_cmd::void_return(as_state(state), require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_transaction_returns" => {
            let tx_id = i32_param(&params, "tx_id")?;
            let result = ret_cmd::get_transaction_returns(as_state(state), require_token()?, tx_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_transaction_returned_quantities" => {
            let tx_id = i32_param(&params, "tx_id")?;
            let result = ret_cmd::get_transaction_returned_quantities(as_state(state), require_token()?, tx_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "search_returns" => {
            let query    = opt_str(&params, "query").unwrap_or_default();
            let store_id = opt_i32(&params, "store_id");
            let limit    = opt_i64(&params, "limit");
            let result   = ret_cmd::search_returns(as_state(state), require_token()?, query, store_id, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // CUSTOMERS
        // ════════════════════════════════════════════════════════════════════

        "get_customers" => {
            let filters: CustomerFilters = parse(params)?;
            let result = customers::get_customers(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_customer" => {
            let id = i32_param(&params, "id")?;
            let result = customers::get_customer(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "create_customer" => {
            let payload: CreateCustomerDto = parse(params)?;
            let result = customers::create_customer(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_customer" => {
            let id = i32_param(&params, "id")?;
            let payload: UpdateCustomerDto = parse(params)?;
            let result = customers::update_customer(as_state(state), require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "delete_customer" => {
            let id = i32_param(&params, "id")?;
            customers::delete_customer(as_state(state), require_token()?, id).await?;
            Ok(Value::Null)
        }

        "activate_customer" => {
            let id = i32_param(&params, "id")?;
            let result = customers::activate_customer(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "deactivate_customer" => {
            let id = i32_param(&params, "id")?;
            let result = customers::deactivate_customer(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_customer_stats" => {
            let id = i32_param(&params, "id")?;
            let result = customers::get_customer_stats(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_customer_transactions" => {
            let id        = i32_param(&params, "id")?;
            let page      = params.get("page").and_then(|v| v.as_i64());
            let limit     = params.get("limit").and_then(|v| v.as_i64());
            let date_from = params.get("date_from").and_then(|v| v.as_str()).map(|s| s.to_string());
            let date_to   = params.get("date_to").and_then(|v| v.as_str()).map(|s| s.to_string());
            let result = customers::get_customer_transactions(
                as_state(state), require_token()?, id, page, limit, date_from, date_to
            ).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "search_customers" => {
            let query    = params.get("query").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let store_id = params.get("store_id").and_then(|v| v.as_i64()).map(|v| v as i32);
            let limit    = params.get("limit").and_then(|v| v.as_i64());
            let result = customers::search_customers(as_state(state), require_token()?, query, store_id, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // SUPPLIERS
        // ════════════════════════════════════════════════════════════════════

        "get_suppliers" => {
            let filters: SupplierFilters = parse(params)?;
            let result = suppliers::get_suppliers(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_supplier" => {
            let id = i32_param(&params, "id")?;
            let result = suppliers::get_supplier(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "create_supplier" => {
            let payload: CreateSupplierDto = parse(params)?;
            let result = suppliers::create_supplier(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_supplier" => {
            let id = i32_param(&params, "id")?;
            let payload: UpdateSupplierDto = parse(params)?;
            let result = suppliers::update_supplier(as_state(state), require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "delete_supplier" => {
            let id = i32_param(&params, "id")?;
            suppliers::delete_supplier(as_state(state), require_token()?, id).await?;
            Ok(Value::Null)
        }

        "activate_supplier" => {
            let id = i32_param(&params, "id")?;
            let result = suppliers::activate_supplier(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "deactivate_supplier" => {
            let id = i32_param(&params, "id")?;
            let result = suppliers::deactivate_supplier(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_supplier_stats" => {
            let id = i32_param(&params, "id")?;
            let result = suppliers::get_supplier_stats(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_supplier_spend_timeline" => {
            let id = i32_param(&params, "id")?;
            let result = suppliers::get_supplier_spend_timeline(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "search_suppliers" => {
            let query = params.get("query").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let limit = params.get("limit").and_then(|v| v.as_i64());
            let result = suppliers::search_suppliers(as_state(state), require_token()?, query, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // PURCHASE ORDERS
        // ════════════════════════════════════════════════════════════════════

        "get_purchase_orders" => {
            let filters: PurchaseOrderFilters = parse(params)?;
            let result = purchase_orders::get_purchase_orders_inner(state, require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_po_stats" => {
            let store_id = opt_i32(&params, "store_id");
            let result = purchase_orders::get_po_stats_inner(state, require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_purchase_order" => {
            let id = i32_param(&params, "id")?;
            let result = purchase_orders::get_purchase_order_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "create_purchase_order" => {
            let payload: CreatePurchaseOrderDto = parse(params)?;
            let result = purchase_orders::create_purchase_order_inner(state, require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "receive_purchase_order" => {
            let id = i32_param(&params, "id")?;
            let payload: ReceivePurchaseOrderDto = parse(params)?;
            let result = purchase_orders::receive_purchase_order_inner(state, require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "cancel_purchase_order" => {
            let id = i32_param(&params, "id")?;
            let result = purchase_orders::cancel_purchase_order_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "submit_purchase_order" => {
            let id = i32_param(&params, "id")?;
            let result = purchase_orders::submit_purchase_order_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "approve_purchase_order" => {
            let id = i32_param(&params, "id")?;
            let result = purchase_orders::approve_purchase_order_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "reject_purchase_order" => {
            let id     = i32_param(&params, "id")?;
            let reason = params.get("reason").and_then(|v| v.as_str()).map(|s| s.to_string());
            let result = purchase_orders::reject_purchase_order_inner(state, require_token()?, id, reason).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "delete_purchase_order" => {
            let id = i32_param(&params, "id")?;
            purchase_orders::delete_purchase_order_inner(state, require_token()?, id).await?;
            Ok(serde_json::json!(null))
        }

        "search_purchase_orders" => {
            let query    = opt_str(&params, "query").unwrap_or_default();
            let store_id = opt_i32(&params, "store_id");
            let limit    = opt_i64(&params, "limit");
            let result   = purchase_orders::search_purchase_orders_inner(state, require_token()?, query, store_id, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // PAYMENTS
        // ════════════════════════════════════════════════════════════════════

        "get_payments" => {
            let filters: PaymentFilters = parse(params)?;
            let result = payments::get_payments(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // SHIFTS
        // ════════════════════════════════════════════════════════════════════

        "open_shift" => {
            let payload: OpenShiftDto = parse(params)?;
            let result = shifts::open_shift_inner(state, require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "close_shift" => {
            let id = i32_param(&params, "id")?;
            let payload: CloseShiftDto = parse(params)?;
            let result = shifts::close_shift_inner(state, require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_active_shift" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = shifts::get_active_shift_inner(state, require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_shifts" => {
            let filters: ShiftFilters = parse(params)?;
            let result = shifts::get_shifts_inner(state, require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_shift" => {
            let id = i32_param(&params, "id")?;
            let result = shifts::get_shift_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "suspend_shift" => {
            let id = i32_param(&params, "id")?;
            let payload: crate::models::shift::SuspendShiftDto = parse(params)?;
            let result = shifts::suspend_shift_inner(state, require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "resume_shift" => {
            let id = i32_param(&params, "id")?;
            let result = shifts::resume_shift_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_store_active_shifts" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = shifts::get_store_active_shifts_inner(state, require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "cancel_shift" => {
            let id = i32_param(&params, "id")?;
            let result = shifts::cancel_shift_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "reconcile_shift" => {
            let id    = i32_param(&params, "id")?;
            let notes = opt_str(&params, "notes");
            let result = shifts::reconcile_shift_inner(state, require_token()?, id, notes).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_shift_detail_stats" => {
            let shift_id = i32_param(&params, "shift_id")?;
            let result = shifts::get_shift_detail_stats_inner(state, require_token()?, shift_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // CASH MOVEMENTS
        // ════════════════════════════════════════════════════════════════════

        "add_cash_movement" => {
            let payload: CreateCashMovementDto = parse(params)?;
            let result = shifts::add_cash_movement_inner(state, require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_cash_movements" => {
            let shift_id = i32_param(&params, "shift_id")?;
            let result = shifts::get_cash_movements_inner(state, require_token()?, shift_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_shift_summary" => {
            let shift_id = i32_param(&params, "shift_id")?;
            let result = shifts::get_shift_summary_inner(state, require_token()?, shift_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "log_drawer_event" => {
            let shift_id   = i32_param(&params, "shift_id")?;
            let event_type = opt_str(&params, "event_type")
                .ok_or_else(|| AppError::Validation("Missing 'event_type'".into()))?;
            let notes = opt_str(&params, "notes");
            let result = cash_movements::log_drawer_event(as_state(state), require_token()?, shift_id, event_type, notes).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // CREDIT SALES
        // ════════════════════════════════════════════════════════════════════

        "get_credit_sales" => {
            let filters: CreditSaleFilters = parse(params)?;
            let result = credit_sales::get_credit_sales(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_credit_sale" => {
            let id = i32_param(&params, "id")?;
            let result = credit_sales::get_credit_sale(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "record_credit_payment" => {
            let payload: RecordCreditPaymentDto = parse(params)?;
            let result = credit_sales::record_credit_payment(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_credit_payments" => {
            let credit_sale_id = i32_param(&params, "credit_sale_id")?;
            let result = credit_sales::get_credit_payments(as_state(state), require_token()?, credit_sale_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "cancel_credit_sale" => {
            let id     = i32_param(&params, "id")?;
            let reason = params.get("reason").and_then(|v| v.as_str()).map(|s| s.to_string());
            let result = credit_sales::cancel_credit_sale(as_state(state), require_token()?, id, reason).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_credit_summary" => {
            let store_id = params.get("store_id").and_then(|v| v.as_i64()).map(|v| v as i32);
            let result = credit_sales::get_credit_summary(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_outstanding_balances" => {
            let store_id = params.get("store_id").and_then(|v| v.as_i64()).map(|v| v as i32);
            let result = credit_sales::get_outstanding_balances(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_overdue_sales" => {
            let store_id = params.get("store_id").and_then(|v| v.as_i64()).map(|v| v as i32);
            let result = credit_sales::get_overdue_sales(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // EXPENSES
        // ════════════════════════════════════════════════════════════════════

        "get_expenses" => {
            let filters: ExpenseFilters = parse(params)?;
            let result = expenses::get_expenses(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_expense" => {
            let id = i32_param(&params, "id")?;
            let result = expenses::get_expense(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "create_expense" => {
            let payload: CreateExpenseDto = parse(params)?;
            let result = expenses::create_expense(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "approve_expense" => {
            let id = i32_param(&params, "id")?;
            let result = expenses::approve_expense(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "reject_expense" => {
            let id = i32_param(&params, "id")?;
            let result = expenses::reject_expense(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_expense" => {
            let id = i32_param(&params, "id")?;
            let payload: UpdateExpenseDto = parse(params)?;
            let result = expenses::update_expense(as_state(state), require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "delete_expense" => {
            let id = i32_param(&params, "id")?;
            expenses::delete_expense(as_state(state), require_token()?, id).await?;
            Ok(serde_json::json!(null))
        }

        "get_expense_summary" => {
            let store_id  = i32_param(&params, "store_id")?;
            let date_from = params.get("date_from").and_then(|v| v.as_str()).map(|s| s.to_string());
            let date_to   = params.get("date_to").and_then(|v| v.as_str()).map(|s| s.to_string());
            let result = expenses::get_expense_summary(as_state(state), require_token()?, store_id, date_from, date_to).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_expense_breakdown" => {
            let store_id  = i32_param(&params, "store_id")?;
            let date_from = params.get("date_from").and_then(|v| v.as_str()).map(|s| s.to_string());
            let date_to   = params.get("date_to").and_then(|v| v.as_str()).map(|s| s.to_string());
            let result = expenses::get_expense_breakdown(as_state(state), require_token()?, store_id, date_from, date_to).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // ANALYTICS
        // ════════════════════════════════════════════════════════════════════

        "get_sales_summary" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_sales_summary(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_revenue_by_period" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_revenue_by_period(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_top_items" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_top_items(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_top_categories" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_top_categories(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_payment_method_summary" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_payment_method_summary(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_daily_summary" => {
            let store_id = i32_param(&params, "store_id")?;
            let date = opt_str(&params, "date");
            let result = analytics::get_daily_summary(as_state(state), require_token()?, store_id, date).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_department_analytics" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_department_analytics(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_category_analytics" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_category_analytics(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_item_analytics" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_item_analytics(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_slow_moving_items" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_slow_moving_items(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_dead_stock" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_dead_stock(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_profit_analysis" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_profit_analysis(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_cashier_performance" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_cashier_performance(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_profit_loss_summary" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_profit_loss_summary(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_stock_velocity" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_stock_velocity(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_peak_hours" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_peak_hours(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_customer_analytics" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_customer_analytics(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_return_analysis" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_return_analysis(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_comparison_report" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_comparison_report(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_discount_analytics" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_discount_analytics(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_payment_trends" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_payment_trends(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_supplier_analytics" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_supplier_analytics(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_tax_report" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_tax_report(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_low_margin_items" => {
            let filters: AnalyticsFilters = parse(params)?;
            let result = analytics::get_low_margin_items(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_business_health_summary" => {
            let store_id = opt_i32(&params, "store_id");
            let result = analytics::get_business_health_summary(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // RECEIPTS
        // ════════════════════════════════════════════════════════════════════

        "get_receipt" => {
            let transaction_id = i32_param(&params, "transaction_id")?;
            let result = receipts::get_receipt(as_state(state), require_token()?, transaction_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "generate_receipt_html" => {
            let transaction_id = i32_param(&params, "transaction_id")?;
            let result = receipts::generate_receipt_html(
                as_state(state),
                require_token()?,
                PrintReceiptDto {
                    transaction_id,
                    printer_name:   None,
                    paper_width_mm: None,
                },
            ).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_receipt_settings" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = receipts::get_receipt_settings(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_receipt_settings" => {
            let payload: UpdateReceiptSettingsDto = parse(
                params.get("payload").cloned().unwrap_or(params.clone())
            )?;
            let result = receipts::update_receipt_settings(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // TAX CATEGORIES
        // ════════════════════════════════════════════════════════════════════

        "get_tax_categories" => {
            let result = tax::get_tax_categories(as_state(state), require_token()?).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "create_tax_category" => {
            let payload: CreateTaxCategoryDto = parse(params)?;
            let result = tax::create_tax_category(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_tax_category" => {
            let id = i32_param(&params, "id")?;
            let payload: UpdateTaxCategoryDto = parse(params)?;
            let result = tax::update_tax_category(as_state(state), require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "delete_tax_category" => {
            let id = i32_param(&params, "id")?;
            tax::delete_tax_category(as_state(state), require_token()?, id).await?;
            Ok(Value::Null)
        }

        // ════════════════════════════════════════════════════════════════════
        // PRICE MANAGEMENT
        // ════════════════════════════════════════════════════════════════════

        "get_price_lists" => {
            let filters: PriceListFilters = parse(params)?;
            let result = price_management::get_price_lists(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "create_price_list" => {
            let payload: CreatePriceListDto = parse(params)?;
            let result = price_management::create_price_list(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "add_price_list_item" => {
            let payload: AddPriceListItemDto = parse(params)?;
            let result = price_management::add_price_list_item(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_price_list_items" => {
            let price_list_id = i32_param(&params, "price_list_id")?;
            let result = price_management::get_price_list_items(as_state(state), require_token()?, price_list_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "remove_price_list_item" => {
            let price_list_id = i32_param(&params, "price_list_id")?;
            let item_id_str   = params.get("item_id").and_then(|v| v.as_str()).unwrap_or("");
            let item_id       = uuid::Uuid::parse_str(item_id_str)
                .map_err(|_| AppError::Validation("Invalid item_id UUID".into()))?;
            price_management::remove_price_list_item(as_state(state), require_token()?, price_list_id, item_id).await?;
            Ok(serde_json::json!({ "success": true }))
        }

        "request_price_change" => {
            let payload: RequestPriceChangeDto = parse(params)?;
            let result = price_management::request_price_change(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "approve_price_change" => {
            let id = i32_param(&params, "id")?;
            let result = price_management::approve_price_change(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_price_changes" => {
            let store_id = opt_i32(&params, "store_id");
            let status   = opt_str(&params, "status");
            let page     = opt_i64(&params, "page");
            let limit    = opt_i64(&params, "limit");
            let search   = opt_str(&params, "search");
            let result = price_management::get_price_changes(as_state(state), require_token()?, store_id, status, search, page, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "reject_price_change" => {
            let id = i32_param(&params, "id")?;
            let result = price_management::reject_price_change(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_price_list" => {
            use crate::models::price::UpdatePriceListDto;
            let id: i32  = i32_param(&params, "id")?;
            let payload: UpdatePriceListDto = parse(params)?;
            let result = price_management::update_price_list(as_state(state), require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "delete_price_list" => {
            let id = i32_param(&params, "id")?;
            price_management::delete_price_list(as_state(state), require_token()?, id).await?;
            Ok(serde_json::json!({ "success": true }))
        }

        // ════════════════════════════════════════════════════════════════════
        // AUDIT
        // ════════════════════════════════════════════════════════════════════

        "get_audit_logs" => {
            let filters: AuditFilters = parse(params)?;
            let result = audit::get_audit_logs(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_audit_log_entry" => {
            #[derive(serde::Deserialize)] struct P { id: i32 }
            let p: P = parse(params)?;
            let result = audit::get_audit_log_entry(as_state(state), require_token()?, p.id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "log_action" => {
            let payload: audit::LogActionPayload = parse(params)?;
            audit::log_action(as_state(state), require_token()?, payload).await?;
            Ok(Value::Null)
        }

        // ════════════════════════════════════════════════════════════════════
        // UNKNOWN
        // ════════════════════════════════════════════════════════════════════

        // ════════════════════════════════════════════════════════════════════
        // REORDER ALERTS
        // ════════════════════════════════════════════════════════════════════

        "check_reorder_alerts" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = reorder_alerts::check_reorder_alerts(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_reorder_alerts" => {
            let filters: ReorderAlertFilters = parse(params)?;
            let result = reorder_alerts::get_reorder_alerts(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "acknowledge_reorder_alert" => {
            let id = i32_param(&params, "id")?;
            let result = reorder_alerts::acknowledge_reorder_alert(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "link_po_to_alert" => {
            let id    = i32_param(&params, "id")?;
            let po_id = i32_param(&params, "po_id")?;
            let result = reorder_alerts::link_po_to_alert(as_state(state), require_token()?, id, po_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // STOCK TRANSFERS
        // ════════════════════════════════════════════════════════════════════

        "create_transfer" => {
            let payload: CreateTransferDto = parse(params)?;
            let result = stock_transfers::create_transfer(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "send_transfer" => {
            let id      = i32_param(&params, "id")?;
            let payload: SendTransferDto = parse(params)?;
            let result = stock_transfers::send_transfer(as_state(state), require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "receive_transfer" => {
            let id      = i32_param(&params, "id")?;
            let payload: ReceiveTransferDto = parse(params)?;
            let result = stock_transfers::receive_transfer(as_state(state), require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "cancel_transfer" => {
            let id = i32_param(&params, "id")?;
            let result = stock_transfers::cancel_transfer(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_transfers" => {
            let filters: TransferFilters = parse(params)?;
            let result = stock_transfers::get_transfers(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_transfer" => {
            let id = i32_param(&params, "id")?;
            let result = stock_transfers::get_transfer(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "search_transfers" => {
            let query    = opt_str(&params, "query").unwrap_or_default();
            let store_id = opt_i32(&params, "store_id");
            let limit    = opt_i64(&params, "limit");
            let result   = stock_transfers::search_transfers_inner(state, require_token()?, query, store_id, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "execute_transfer" => {
            let payload: ExecuteTransferDto = parse(params)?;
            let result = stock_transfers::execute_transfer_inner(state, require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "approve_transfer" => {
            let id = i32_param(&params, "id")?;
            let result = stock_transfers::approve_transfer_inner(state, require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // END-OF-DAY REPORTS
        // ════════════════════════════════════════════════════════════════════

        "generate_eod_report" => {
            let store_id = i32_param(&params, "store_id")?;
            let date     = opt_str(&params, "date");
            let result = eod::generate_eod_report(as_state(state), require_token()?, store_id, date).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "lock_eod_report" => {
            let id = i32_param(&params, "id")?;
            let result = eod::lock_eod_report(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_eod_report" => {
            let store_id = i32_param(&params, "store_id")?;
            let date     = params.get("date").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let result = eod::get_eod_report(as_state(state), require_token()?, store_id, date).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_eod_history" => {
            let filters: EodHistoryFilters = parse(params)?;
            let result = eod::get_eod_history(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_eod_breakdown" => {
            let store_id = i32_param(&params, "store_id")?;
            let date     = params.get("date").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let result = eod::get_eod_breakdown(as_state(state), require_token()?, store_id, date).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // STORE SETTINGS
        // ════════════════════════════════════════════════════════════════════

        "get_store_settings" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = store_settings::get_store_settings(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_store_settings" => {
            let payload: UpdateStoreSettingsDto = parse(params)?;
            let result = store_settings::update_store_settings(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // LOYALTY POINTS
        // ════════════════════════════════════════════════════════════════════

        "get_loyalty_settings" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = loyalty::get_loyalty_settings(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_loyalty_settings" => {
            let payload: UpdateLoyaltySettingsDto = parse(params)?;
            let result = loyalty::update_loyalty_settings(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "earn_points" => {
            let payload: EarnPointsDto = parse(params)?;
            let result = loyalty::earn_points(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "redeem_points" => {
            let payload: RedeemPointsDto = parse(params)?;
            let result = loyalty::redeem_points(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "adjust_points" => {
            let payload: AdjustPointsDto = parse(params)?;
            let result = loyalty::adjust_points(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_loyalty_history" => {
            let customer_id = i32_param(&params, "customer_id")?;
            let limit       = opt_i64(&params, "limit");
            let result = loyalty::get_loyalty_history(as_state(state), require_token()?, customer_id, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_loyalty_balance" => {
            let customer_id = i32_param(&params, "customer_id")?;
            let store_id    = i32_param(&params, "store_id")?;
            let result = loyalty::get_loyalty_balance(as_state(state), require_token()?, customer_id, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "expire_old_points" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = loyalty::expire_old_points(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // NOTIFICATIONS
        // ════════════════════════════════════════════════════════════════════

        "create_notification" => {
            let payload: CreateNotificationDto = parse(params)?;
            let result = notifications::create_notification(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_notifications" => {
            let filters: NotificationFilters = parse(params)?;
            let result = notifications::get_notifications(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "mark_notification_read" => {
            let id = i32_param(&params, "id")?;
            let result = notifications::mark_notification_read(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "mark_all_notifications_read" => {
            let store_id = i32_param(&params, "store_id")?;
            let user_id  = opt_i32(&params, "user_id");
            let result = notifications::mark_all_notifications_read(as_state(state), require_token()?, store_id, user_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_unread_count" => {
            let store_id = i32_param(&params, "store_id")?;
            let user_id  = opt_i32(&params, "user_id");
            let result = notifications::get_unread_count(as_state(state), require_token()?, store_id, user_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // SUPPLIER PAYMENTS
        // ════════════════════════════════════════════════════════════════════

        "record_supplier_payment" => {
            let payload: RecordSupplierPaymentDto = parse(params)?;
            let result = supplier_payments::record_supplier_payment(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_supplier_payments" => {
            let filters: SupplierPaymentFilters = parse(params)?;
            let result = supplier_payments::get_supplier_payments(as_state(state), require_token()?, filters).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_supplier_balance" => {
            let supplier_id = i32_param(&params, "supplier_id")?;
            let result = supplier_payments::get_supplier_balance(as_state(state), require_token()?, supplier_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_all_supplier_payables" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = supplier_payments::get_all_supplier_payables(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // DATA BACKUP & EXPORT
        // ════════════════════════════════════════════════════════════════════

        "create_backup" => {
            let payload: CreateBackupDto = parse(params)?;
            let result = backup::create_backup(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "restore_from_backup" => {
            let payload: RestoreBackupDto = parse(params)?;
            let result = backup::restore_from_backup(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "list_backups" => {
            let directory = params.get("directory").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let result = backup::list_backups(as_state(state), require_token()?, directory).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "schedule_auto_backup" => {
            let payload: AutoBackupScheduleDto = parse(params)?;
            let result = backup::schedule_auto_backup(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "export_inventory_csv" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = backup::export_inventory_csv(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // BULK OPERATIONS
        // ════════════════════════════════════════════════════════════════════

        "bulk_price_update" => {
            let payload: BulkPriceUpdateDto = parse(params)?;
            let result = bulk_operations::bulk_price_update(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "bulk_stock_adjustment" => {
            let payload: BulkStockAdjustmentDto = parse(params)?;
            let result = bulk_operations::bulk_stock_adjustment(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "bulk_activate_items" => {
            let payload: BulkToggleItemsDto = parse(params)?;
            let result = bulk_operations::bulk_activate_items(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "bulk_deactivate_items" => {
            let payload: BulkToggleItemsDto = parse(params)?;
            let result = bulk_operations::bulk_deactivate_items(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "bulk_apply_discount" => {
            let payload: BulkApplyDiscountDto = parse(params)?;
            let result = bulk_operations::bulk_apply_discount(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "bulk_item_import" => {
            let payload: BulkItemImportDto = parse(params)?;
            let result = bulk_operations::bulk_item_import(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // PRICE SCHEDULING
        // ════════════════════════════════════════════════════════════════════

        "get_item_price_history" => {
            let item_id  = params.get("item_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let store_id = opt_i32(&params, "store_id");
            let limit    = opt_i64(&params, "limit");
            let result = price_scheduling::get_item_price_history(as_state(state), require_token()?, item_id, store_id, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "schedule_price_change" => {
            let payload: SchedulePriceChangeDto = parse(params)?;
            let result = price_scheduling::schedule_price_change(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "cancel_scheduled_price_change" => {
            let id = i32_param(&params, "id")?;
            let result = price_scheduling::cancel_scheduled_price_change(as_state(state), require_token()?, id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_pending_price_changes" => {
            let store_id        = i32_param(&params, "store_id")?;
            let include_applied = params.get("include_applied").and_then(|v| v.as_bool());
            let result = price_scheduling::get_pending_price_changes(as_state(state), require_token()?, store_id, include_applied).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "apply_scheduled_prices" => {
            let result = price_scheduling::apply_scheduled_prices(as_state(state), require_token()?).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // CUSTOMER WALLET
        // ════════════════════════════════════════════════════════════════════

        "deposit_to_wallet" => {
            let payload: DepositDto = parse(params)?;
            let result = customer_wallet::deposit_to_wallet(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_wallet_balance" => {
            let customer_id = i32_param(&params, "customer_id")?;
            let result = customer_wallet::get_wallet_balance(as_state(state), require_token()?, customer_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_wallet_history" => {
            let customer_id = i32_param(&params, "customer_id")?;
            let limit       = opt_i64(&params, "limit");
            let result = customer_wallet::get_wallet_history(as_state(state), require_token()?, customer_id, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "adjust_wallet" => {
            let payload: AdjustWalletDto = parse(params)?;
            let result = customer_wallet::adjust_wallet(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // BARCODE & LABEL PRINTING
        // ════════════════════════════════════════════════════════════════════

        "generate_item_labels" => {
            let payload: GenerateLabelsDto = parse(params)?;
            let result = labels::generate_item_labels(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "auto_generate_barcode" => {
            let item_id = params.get("item_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let result = labels::auto_generate_barcode(as_state(state), require_token()?, item_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "print_price_tags" => {
            let payload: PrintPriceTagsDto = parse(params)?;
            let result = labels::print_price_tags(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_label_template" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = labels::get_label_template(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "save_label_template" => {
            let payload: SaveLabelTemplateDto = parse(params)?;
            let result = labels::save_label_template(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // POS SECURITY & SESSION MANAGEMENT
        // ════════════════════════════════════════════════════════════════════

        "set_pos_pin" => {
            let payload: SetPinDto = parse(params)?;
            let result = security::set_pos_pin(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "verify_pos_pin" => {
            let payload: VerifyPinDto = parse(params)?;
            let result = security::verify_pos_pin(as_state(state), payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "lock_pos_screen" => {
            let result = security::lock_pos_screen(as_state(state), require_token()?).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_active_sessions" => {
            let store_id = opt_i32(&params, "store_id");
            let result = security::get_active_sessions(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "revoke_session" => {
            let session_id = i32_param(&params, "session_id")?;
            let result = security::revoke_session(as_state(state), require_token()?, session_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // FX RATES
        // ════════════════════════════════════════════════════════════════════

        "get_exchange_rate" => {
            let from_currency = params.get("from_currency").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let to_currency   = params.get("to_currency").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let result = fx_rates::get_exchange_rate(as_state(state), require_token()?, from_currency, to_currency).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "set_exchange_rate" => {
            let payload: SetRateDto = parse(params)?;
            let result = fx_rates::set_exchange_rate(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_exchange_rate_history" => {
            let from_currency = params.get("from_currency").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let to_currency   = params.get("to_currency").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let limit         = opt_i64(&params, "limit");
            let result = fx_rates::get_exchange_rate_history(as_state(state), require_token()?, from_currency, to_currency, limit).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "convert_amount" => {
            let payload: ConvertDto = parse(params)?;
            let result = fx_rates::convert_amount(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // EXCEL IMPORT / EXPORT
        // ════════════════════════════════════════════════════════════════════

        "export_items" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = excel::export_items(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "export_items_filtered" => {
            let store_id      = i32_param(&params, "store_id")?;
            let department_id = opt_i32(&params, "department_id");
            let category_id   = opt_i32(&params, "category_id");
            let is_active     = opt_bool(&params, "is_active");
            let low_stock     = opt_bool(&params, "low_stock");
            let result = excel::export_items_filtered(
                as_state(state), require_token()?,
                store_id, department_id, category_id, is_active, low_stock,
            ).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "import_items" => {
            let store_id = i32_param(&params, "store_id")?;
            let dry_run  = opt_bool(&params, "dry_run");
            let rows: Vec<excel::ImportItemRow> = params
                .get("rows")
                .cloned()
                .ok_or_else(|| AppError::Validation("Missing 'rows' parameter".into()))
                .and_then(|v| serde_json::from_value(v)
                    .map_err(|e| AppError::Validation(e.to_string())))?;
            let result = excel::import_items(as_state(state), require_token()?, store_id, rows, dry_run).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "import_stock_count" => {
            let store_id = i32_param(&params, "store_id")?;
            let dry_run  = opt_bool(&params, "dry_run");
            let rows: Vec<excel::StockCountRow> = params
                .get("rows")
                .cloned()
                .ok_or_else(|| AppError::Validation("Missing 'rows' parameter".into()))
                .and_then(|v| serde_json::from_value(v)
                    .map_err(|e| AppError::Validation(e.to_string())))?;
            let result = excel::import_stock_count(as_state(state), require_token()?, store_id, rows, dry_run).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "import_customers" => {
            let store_id = i32_param(&params, "store_id")?;
            let rows: Vec<excel::ImportCustomerRow> = params
                .get("rows")
                .cloned()
                .ok_or_else(|| AppError::Validation("Missing 'rows' parameter".into()))
                .and_then(|v| serde_json::from_value(v)
                    .map_err(|e| AppError::Validation(e.to_string())))?;
            let result = excel::import_customers(as_state(state), require_token()?, store_id, rows).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "export_customers" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = excel::export_customers(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "export_transactions" => {
            let store_id  = i32_param(&params, "store_id")?;
            let date_from = opt_str(&params, "date_from");
            let date_to   = opt_str(&params, "date_to");
            let result = excel::export_transactions(as_state(state), require_token()?, store_id, date_from, date_to).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "export_expenses" => {
            let store_id  = i32_param(&params, "store_id")?;
            let date_from = opt_str(&params, "date_from");
            let date_to   = opt_str(&params, "date_to");
            let result = excel::export_expenses(as_state(state), require_token()?, store_id, date_from, date_to).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // ONBOARDING  (unauthenticated — run before any user session exists)
        // ════════════════════════════════════════════════════════════════════

        "check_onboarding_status" => {
            let pool = state.pool().await?;
            let result = onboarding::check_onboarding_status(&pool)
                .await
                .map_err(AppError::Internal)?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "create_business" => {
            let payload: onboarding::CreateBusinessPayload = parse(params)?;
            let pool = state.pool().await?;
            let cloud_pool = state.cloud_pool().await;
            let result = onboarding::create_business(&pool, cloud_pool.as_ref(), payload)
                .await
                .map_err(AppError::Internal)?;
            // Cache business_id in AppState so all future handlers can use it.
            // Note: onboarding_complete is NOT set here — that happens in
            // setup_super_admin (Phase 2) so mid-flow restarts resume correctly.
            state.load_business_id(&pool).await;
            Ok(serde_json::to_value(result).unwrap())
        }

        // Phase 2 of onboarding: create the super-admin user account.
        // Unauthenticated — no token required. Gated server-side:
        //   - business_id must already exist in app_config
        //   - super_admin_created must NOT be 'true'
        "setup_super_admin" => {
            let payload: onboarding::SetupSuperAdminPayload = parse(params)?;
            let pool = state.pool().await?;
            let result = onboarding::setup_super_admin(&pool, payload)
                .await
                .map_err(AppError::Internal)?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "link_existing_business" => {
            let business_id = opt_str(&params, "business_id")
                .ok_or_else(|| AppError::Validation("Missing 'business_id'".into()))?;
            let pool = state.pool().await?;
            let result = onboarding::link_existing_business(&pool, &business_id)
                .await
                .map_err(AppError::Internal)?;
            // Cache business_id in AppState so all future handlers can use it
            state.load_business_id(&pool).await;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_business_info" => {
            let pool = state.pool().await?;
            let result = onboarding::get_business_info(&pool)
                .await
                .map_err(AppError::Internal)?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_business_info" => {
            require_token()?; // requires login
            let payload: onboarding::UpdateBusinessPayload = parse(params)?;
            let pool = state.pool().await?;
            let result = onboarding::update_business_info(&pool, payload)
                .await
                .map_err(AppError::Internal)?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "check_business_exists" => {
            let business_id = params.get("business_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| AppError::Validation("Missing 'business_id'".into()))?;
            let cloud_pool = state.cloud_pool().await
                .ok_or_else(|| AppError::Internal(
                    "Cloud sync is not connected. Please check your internet connection \
                     or configure Supabase credentials first.".into()
                ))?;
            let result = onboarding::check_business_exists(&cloud_pool, &business_id)
                .await
                .map_err(AppError::Internal)?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "restore_business_from_cloud" => {
            let business_id = params.get("business_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| AppError::Validation("Missing 'business_id'".into()))?;
            let pool = state.pool().await?;
            let cloud_pool = state.cloud_pool().await
                .ok_or_else(|| AppError::Internal(
                    "Cloud sync is not connected. Please check your internet connection \
                     or configure Supabase credentials first.".into()
                ))?;
            let result = onboarding::restore_business_from_cloud(&pool, &cloud_pool, &business_id)
                .await
                .map_err(AppError::Internal)?;
            // Cache business_id in AppState so all future handlers can use it
            state.load_business_id(&pool).await;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // POS FAVOURITES
        // ════════════════════════════════════════════════════════════════════

        "get_pos_favourites" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = pos_favourites::get_pos_favourites_inner(state, require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "add_pos_favourite" => {
            let payload: AddFavouriteDto = parse(params)?;
            pos_favourites::add_pos_favourite_inner(state, require_token()?, payload).await?;
            Ok(Value::Null)
        }

        "remove_pos_favourite" => {
            let payload: RemoveFavouriteDto = parse(params)?;
            pos_favourites::remove_pos_favourite_inner(state, require_token()?, payload).await?;
            Ok(Value::Null)
        }

        // ════════════════════════════════════════════════════════════════════
        // CLOUD SYNC
        // ════════════════════════════════════════════════════════════════════

        "save_supabase_config" => {
            let payload: cloud_sync::SaveSupabaseConfigPayload = parse(params)?;
            let result = cloud_sync::save_supabase_config(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "clear_supabase_config" => {
            cloud_sync::clear_supabase_config(as_state(state), require_token()?).await?;
            Ok(serde_json::json!({ "success": true }))
        }

        "get_supabase_config" => {
            let result = cloud_sync::get_supabase_config(as_state(state), require_token()?).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "get_sync_status" => {
            let result = cloud_sync::get_sync_status(as_state(state), require_token()?).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "set_cloud_sync_enabled" => {
            let enabled = params
                .get("enabled")
                .and_then(|v| v.as_bool())
                .ok_or_else(|| AppError::Validation("Missing or invalid 'enabled' (boolean)".into()))?;
            cloud_sync::set_cloud_sync_enabled(as_state(state), require_token()?, enabled).await?;
            Ok(serde_json::json!({ "ok": true }))
        }

        "trigger_backfill_sync" => {
            let result = cloud_sync::trigger_backfill_sync(as_state(state), require_token()?).await?;
            Ok(result)
        }

        "retry_failed_sync" => {
            let result = cloud_sync::retry_failed_sync(as_state(state), require_token()?).await?;
            Ok(result)
        }

        // ════════════════════════════════════════════════════════════════════
        // PAYMENT METHOD SETTINGS
        // ════════════════════════════════════════════════════════════════════

        "get_payment_methods" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = payment_methods::get_payment_methods(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "upsert_payment_method" => {
            let payload: crate::models::payment_method_settings::UpsertPaymentMethodDto = parse(params)?;
            let result = payment_methods::upsert_payment_method(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "reorder_payment_methods" => {
            let payload: crate::models::payment_method_settings::ReorderPaymentMethodsDto = parse(params)?;
            payment_methods::reorder_payment_methods(as_state(state), require_token()?, payload).await?;
            Ok(Value::Null)
        }

        // ════════════════════════════════════════════════════════════════════
        // EXPENSE CATEGORIES
        // ════════════════════════════════════════════════════════════════════

        "get_expense_categories" => {
            let store_id = opt_i32(&params, "store_id");
            let result = expense_categories::get_expense_categories(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "create_expense_category" => {
            let payload: crate::models::expense_category::CreateExpenseCategoryDto = parse(params)?;
            let result = expense_categories::create_expense_category(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_expense_category" => {
            let id = i32_param(&params, "id")?;
            let payload: crate::models::expense_category::UpdateExpenseCategoryDto = parse(params)?;
            let result = expense_categories::update_expense_category(as_state(state), require_token()?, id, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "delete_expense_category" => {
            let id = i32_param(&params, "id")?;
            expense_categories::delete_expense_category(as_state(state), require_token()?, id).await?;
            Ok(Value::Null)
        }

        // ════════════════════════════════════════════════════════════════════
        // NUMBER SERIES (INVOICE / RECEIPT NUMBERING)
        // ════════════════════════════════════════════════════════════════════

        "get_number_series" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = number_series::get_number_series(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "update_number_series" => {
            let payload: crate::models::number_series::UpdateNumberSeriesDto = parse(params)?;
            let result = number_series::update_number_series(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // STORE HOURS (OPENING HOURS)
        // ════════════════════════════════════════════════════════════════════

        "get_store_hours" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = store_hours::get_store_hours(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "upsert_store_hours" => {
            let payload: crate::models::store_hours::BulkUpsertStoreHoursDto = parse(params)?;
            let result = store_hours::upsert_store_hours(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ════════════════════════════════════════════════════════════════════
        // POS SHORTCUTS (PINNED ITEMS)
        // ════════════════════════════════════════════════════════════════════

        "get_pos_shortcuts" => {
            let store_id = i32_param(&params, "store_id")?;
            let result = pos_shortcuts_settings::get_pos_shortcuts(as_state(state), require_token()?, store_id).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "add_pos_shortcut" => {
            let payload: crate::models::pos_shortcuts_settings::AddShortcutDto = parse(params)?;
            let result = pos_shortcuts_settings::add_pos_shortcut(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "remove_pos_shortcut" => {
            let payload: crate::models::pos_shortcuts_settings::RemoveShortcutDto = parse(params)?;
            let result = pos_shortcuts_settings::remove_pos_shortcut(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        "reorder_pos_shortcuts" => {
            let payload: crate::models::pos_shortcuts_settings::ReorderShortcutsDto = parse(params)?;
            let result = pos_shortcuts_settings::reorder_pos_shortcuts(as_state(state), require_token()?, payload).await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        _ => Err(AppError::Validation(format!("Unknown RPC method: {method}"))),
    }
}
