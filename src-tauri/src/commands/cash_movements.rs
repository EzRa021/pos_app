// ============================================================================
// CASH MOVEMENT COMMANDS
// ============================================================================
// NOTE: add_cash_movement / get_cash_movements / get_shift_summary have moved
// to commands/shifts.rs (quantum-pos-app aligned versions). Only
// log_drawer_event remains here as a standalone frontend-callable command.
// ============================================================================

use tauri::State;
use crate::{
    error::{AppError, AppResult},
    models::cash_movement::CashDrawerEvent,
    state::AppState,
};
use super::auth::guard;
use super::audit::write_audit_log;

#[tauri::command]
pub async fn log_drawer_event(
    state:      State<'_, AppState>,
    token:      String,
    shift_id:   i32,
    event_type: String,
    notes:      Option<String>,
) -> AppResult<CashDrawerEvent> {
    let claims = guard(&state, &token).await?;
    let pool   = state.pool().await?;

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO cash_drawer_events (shift_id, event_type, notes, created_by)
           VALUES ($1,$2,$3,$4) RETURNING id"#,
        shift_id,
        event_type,
        notes,
        claims.user_id,
    )
    .fetch_one(&pool)
    .await?;

    let event = sqlx::query_as!(
        CashDrawerEvent,
        "SELECT id, shift_id, event_type, notes, created_by, created_at
         FROM   cash_drawer_events WHERE id = $1",
        id
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)?;
    write_audit_log(&pool, claims.user_id, None, "drawer_event", "shift",
        &format!("Drawer event '{}' for shift {shift_id}", event_type), "info").await;
    Ok(event)
}

// get_shift_summary has moved to commands/shifts.rs (quantum-pos-app aligned version).
