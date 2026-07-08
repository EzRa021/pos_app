use std::fs;

fn main() {
    // ── Load src-tauri/.env (gitignored) and forward its vars into the build ──
    // This lets `option_env!("SUPABASE_DB_URL")` etc. in lib.rs resolve locally
    // during `pnpm tauri dev` / `cargo build`, without ever hardcoding secrets
    // in source. In CI (GitHub Actions), these same var names are instead
    // provided directly as workflow env vars from repository secrets — no
    // .env file needed there since the file simply won't exist on the runner.
    if let Ok(contents) = fs::read_to_string(".env") {
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim().trim_matches('"');
                println!("cargo:rustc-env={key}={value}");
            }
        }
    }
    // Re-run this build script if .env changes, so edits take effect.
    println!("cargo:rerun-if-changed=.env");

    tauri_build::build()
}
