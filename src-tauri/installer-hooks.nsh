; ============================================================================
; installer-hooks.nsh
; ============================================================================
; Wired into src-tauri/tauri.conf.json under bundle.windows.nsis.installerHooks.
; Runs scripts/provision-db.ps1 silently right after files are installed, so
; a non-technical user's first launch never hits a database connection error
; — the fixed "myposdb" database and the app's role already exist by the
; time they double-click the icon.
;
; Safe no-op if Postgres isn't installed yet, or if QPOS_PG_SUPERUSER_PASSWORD
; isn't set for this install — see provision-db.ps1's own fallback logic.
; The app's in-app Setup screens (ServerSetup.jsx) remain the safety net for
; every case this hook doesn't cover.
; ============================================================================

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Provisioning local database role (if PostgreSQL is present)..."
  nsExec::ExecToLog '"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\provision-db.ps1"'
  Pop $0
!macroend
