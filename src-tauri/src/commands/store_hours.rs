// ============================================================================
// STORE HOURS COMMANDS
// ============================================================================

use tauri::State;
use chrono::NaiveTime;
use crate::{
    error::{AppError, AppResult},
    models::store_hours::{StoreHour, BulkUpsertStoreHoursDto},
    state::AppState,
};
use super::auth::guard_permission;

fn parse_time(s: Option<&str>) -> AppResult<Option<NaiveTime>> {
    match s {
        None => Ok(None),
        Some(t) => NaiveTime::parse_from_str(t, "%H:%M")
            .map(Some)
            .map_err(|_| AppError::Validation(format!("Invalid time format '{t}' — expected HH:MM"))),
    }
}

// ── ensure defaults ───────────────────────────────────────────────────────────

async fn ensure_defaults(pool: &sqlx::PgPool, store_id: i32) -> AppResult<()> {
    let defaults: &[(i16, bool, Option<&str>, Option<&str>)] = &[
        (0, false, None,        None),
        (1, true,  Some("08:00"), Some("18:00")),
        (2, true,  Some("08:00"), Some("18:00")),
        (3, true,  Some("08:00"), Some("18:00")),
        (4, true,  Some("08:00"), Some("18:00")),
        (5, true,  Some("08:00"), Some("18:00")),
        (6, true,  Some("09:00"), Some("16:00")),
    ];
    for (dow, is_open, open, close) in defaults {
        let open_time  = parse_time(*open)?;
        let close_time = parse_time(*close)?;
        sqlx::query!(
            r#"INSERT INTO store_hours (store_id, day_of_week, is_open, open_time, close_time)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (store_id, day_of_week) DO NOTHING"#,
            store_id,
            *dow,
            is_open,
            open_time,
            close_time,
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

// ── get ───────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_store_hours(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<StoreHour>> {
    guard_permission(&state, &token, "stores.read").await?;
    let pool = state.pool().await?;
    ensure_defaults(&pool, store_id).await?;

    let rows = sqlx::query!(
        r#"SELECT id, store_id, day_of_week, is_open,
                  to_char(open_time,  'HH24:MI') AS open_time,
                  to_char(close_time, 'HH24:MI') AS close_time
           FROM   store_hours
           WHERE  store_id = $1
           ORDER  BY day_of_week"#,
        store_id,
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows.into_iter().map(|r| StoreHour {
        id:          r.id,
        store_id:    r.store_id,
        day_of_week: r.day_of_week,
        is_open:     r.is_open,
        open_time:   r.open_time,
        close_time:  r.close_time,
    }).collect())
}

// ── bulk upsert ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn upsert_store_hours(
    state:   State<'_, AppState>,
    token:   String,
    payload: BulkUpsertStoreHoursDto,
) -> AppResult<Vec<StoreHour>> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool = state.pool().await?;

    for h in &payload.hours {
        let open_time  = parse_time(h.open_time.as_deref())?;
        let close_time = parse_time(h.close_time.as_deref())?;
        sqlx::query!(
            r#"INSERT INTO store_hours (store_id, day_of_week, is_open, open_time, close_time)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (store_id, day_of_week) DO UPDATE SET
                   is_open    = EXCLUDED.is_open,
                   open_time  = EXCLUDED.open_time,
                   close_time = EXCLUDED.close_time"#,
            payload.store_id,
            h.day_of_week,
            h.is_open,
            open_time,
            close_time,
        )
        .execute(&pool)
        .await?;
    }

    // Return updated list
    let rows = sqlx::query!(
        r#"SELECT id, store_id, day_of_week, is_open,
                  to_char(open_time,  'HH24:MI') AS open_time,
                  to_char(close_time, 'HH24:MI') AS close_time
           FROM   store_hours WHERE store_id = $1 ORDER BY day_of_week"#,
        payload.store_id,
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows.into_iter().map(|r| StoreHour {
        id:          r.id,
        store_id:    r.store_id,
        day_of_week: r.day_of_week,
        is_open:     r.is_open,
        open_time:   r.open_time,
        close_time:  r.close_time,
    }).collect())
}
