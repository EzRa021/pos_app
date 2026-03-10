// ============================================================================
// DATA BACKUP & EXPORT
// ============================================================================

use tauri::State;
use std::path::Path;
use crate::{
    error::{AppError, AppResult},
    models::backup::{BackupFile, BackupResult, CreateBackupDto, RestoreBackupDto, AutoBackupScheduleDto},
    state::AppState,
};
use super::auth::guard_permission;

// ── create_backup ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_backup(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateBackupDto,
) -> AppResult<BackupResult> {
    guard_permission(&state, &token, "stores.manage").await?;

    if let Some(parent) = Path::new(&payload.output_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::File(format!("Cannot create backup directory: {e}")))?;
    }

    let output = std::process::Command::new("pg_dump")
        .arg("--no-password")
        .arg("--format=plain")
        .arg("--file")
        .arg(&payload.output_path)
        .arg(&payload.database_url)
        .output()
        .map_err(|e| AppError::File(format!("pg_dump not found or failed to launch: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::File(format!("pg_dump failed: {stderr}")));
    }

    let size = std::fs::metadata(&payload.output_path).map(|m| m.len()).unwrap_or(0);
    Ok(BackupResult {
        success: true,
        path: payload.output_path.clone(),
        size_bytes: size,
        message: format!("Backup created successfully ({} bytes)", size),
    })
}

// ── restore_from_backup ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn restore_from_backup(
    state:   State<'_, AppState>,
    token:   String,
    payload: RestoreBackupDto,
) -> AppResult<serde_json::Value> {
    guard_permission(&state, &token, "stores.manage").await?;

    if !Path::new(&payload.backup_path).exists() {
        return Err(AppError::File(format!("Backup file not found: {}", payload.backup_path)));
    }

    let output = std::process::Command::new("psql")
        .arg("--no-password")
        .arg("--file")
        .arg(&payload.backup_path)
        .arg(&payload.database_url)
        .output()
        .map_err(|e| AppError::File(format!("psql not found or failed to launch: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::File(format!("psql restore failed: {stderr}")));
    }

    Ok(serde_json::json!({
        "success": true,
        "message": format!("Database restored from {}", payload.backup_path)
    }))
}

// ── list_backups ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_backups(
    state:     State<'_, AppState>,
    token:     String,
    directory: String,
) -> AppResult<Vec<BackupFile>> {
    guard_permission(&state, &token, "stores.manage").await?;

    let dir_path = Path::new(&directory);
    if !dir_path.exists() { return Ok(Vec::new()); }

    let mut files = Vec::new();
    let entries = std::fs::read_dir(dir_path)
        .map_err(|e| AppError::File(format!("Cannot read backup directory: {e}")))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let ext  = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "sql" && ext != "dump" { continue; }
        let meta = match entry.metadata() { Ok(m) => m, Err(_) => continue };
        let created_at = meta.modified().ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                let secs = d.as_secs() as i64;
                chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        files.push(BackupFile {
            filename:   entry.file_name().to_string_lossy().to_string(),
            path:       path.to_string_lossy().to_string(),
            size_bytes: meta.len(),
            created_at,
        });
    }
    files.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(files)
}

// ── schedule_auto_backup ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn schedule_auto_backup(
    state:   State<'_, AppState>,
    token:   String,
    payload: AutoBackupScheduleDto,
) -> AppResult<serde_json::Value> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool = state.pool().await?;

    let schedule_json = serde_json::json!({
        "backup_directory": payload.backup_directory,
        "frequency":        payload.frequency,
        "time_of_day":      payload.time_of_day,
        "database_url":     payload.database_url,
        "retain_last_n":    payload.retain_last_n.unwrap_or(7),
    });

    sqlx::query!(
        r#"INSERT INTO audit_logs (store_id, user_id, action, resource, description, new_value, severity)
           VALUES ($1, NULL, 'backup_schedule_updated', 'backup', 'Auto-backup schedule configured', $2, 'info')"#,
        payload.store_id,
        schedule_json,
    )
    .execute(&pool)
    .await?;

    Ok(serde_json::json!({
        "success":  true,
        "message":  "Auto-backup schedule saved",
        "schedule": schedule_json,
    }))
}

// ── export_inventory_csv ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn export_inventory_csv(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<serde_json::Value>> {
    guard_permission(&state, &token, "inventory.read").await?;
    let pool = state.pool().await?;

    let rows = sqlx::query!(
        r#"SELECT
               i.sku, i.barcode, i.item_name,
               c.category_name, d.department_name,
               i.cost_price, i.selling_price,
               COALESCE(istock.quantity,           0) AS quantity,
               COALESCE(istock.available_quantity, 0) AS available_quantity,
               COALESCE(istock.reserved_quantity,  0) AS reserved_quantity,
               ist.min_stock_level, ist.max_stock_level, ist.track_stock,
               COALESCE(istock.quantity * i.cost_price, 0) AS inventory_value,
               istock.last_count_date
           FROM items i
           LEFT JOIN categories  c     ON c.id = i.category_id
           LEFT JOIN departments d     ON d.id = i.department_id
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           LEFT JOIN item_stock istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           WHERE i.store_id = $1
           ORDER BY i.item_name"#,
        store_id
    )
    .fetch_all(&pool)
    .await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "sku":             r.sku, "barcode":        r.barcode,
        "item_name":       r.item_name, "category": r.category_name,
        "department":      r.department_name,
        "cost_price":      r.cost_price, "selling_price": r.selling_price,
        "quantity":        r.quantity, "available":    r.available_quantity,
        "reserved":        r.reserved_quantity,
        "min_stock_level": r.min_stock_level, "max_stock_level": r.max_stock_level,
        "track_stock":     r.track_stock, "inventory_value": r.inventory_value,
        "last_count_date": r.last_count_date,
    })).collect();

    Ok(result)
}
