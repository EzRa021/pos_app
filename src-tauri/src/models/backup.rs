// ============================================================================
// BACKUP & EXPORT MODELS
// ============================================================================

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct BackupFile {
    pub filename:   String,
    pub path:       String,
    pub size_bytes: u64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct BackupResult {
    pub success:    bool,
    pub path:       String,
    pub size_bytes: u64,
    pub message:    String,
}

#[derive(Debug, Deserialize)]
pub struct CreateBackupDto {
    pub output_path:  String,
    pub database_url: String,
}

#[derive(Debug, Deserialize)]
pub struct RestoreBackupDto {
    pub backup_path:  String,
    pub database_url: String,
}

#[derive(Debug, Deserialize)]
pub struct AutoBackupScheduleDto {
    pub store_id:         i32,
    pub backup_directory: String,
    pub frequency:        String,
    pub time_of_day:      String,
    pub database_url:     String,
    pub retain_last_n:    Option<i32>,
}
