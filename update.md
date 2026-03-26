🔴 Priority 1 — Security (Fix First)
1. CSP is completely disabled
File: src-tauri/tauri.conf.json
json// CURRENT — wide open:
"security": { "csp": null }

// ADD:
"security": {
  "csp": "default-src 'self'; connect-src 'self' http://localhost:* http://127.0.0.1:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; script-src 'self'"
}

2. Database password stored in plaintext in localStorage
File: src/screens/setup/SetupWizard.jsx (where CONFIG_KEY is written)
The DB password is saved to localStorage as a plain JSON string. Fix: Use tauri-plugin-store (already installed) from the Rust side to encrypt it, or at minimum strip the password before saving and re-prompt on startup (or use the OS keychain via keytar).

3. CORS allows any origin on the HTTP API
File: src-tauri/src/http_server.rs
rust// CURRENT — anyone on the LAN can call your API:
.allow_origin(Any)

// FIX — restrict to localhost and LAN origins:
.allow_origin(tower_http::cors::AllowOrigin::predicate(|origin, _| {
    let s = origin.as_bytes();
    s.starts_with(b"http://localhost")
    || s.starts_with(b"http://127.")
    || s.starts_with(b"http://192.168.")
    || s.starts_with(b"http://10.")
}))
4. HTTP API has no rate limiting
Add tower_governor or a simple in-memory rate limiter to the Axum router to prevent brute-force attacks from other machines on the LAN, especially on the login and refresh_token endpoints.
5. Session HashMap grows unbounded
File: src-tauri/src/state.rs
The sessions: Arc<RwLock<HashMap<String, SessionData>>> is never pruned. After months of use, expired sessions accumulate. Add a background cleanup task in lib.rs setup:
rust// In setup(), after spawning the HTTP server:
let cleanup_state = app_state.clone();
tauri::async_runtime::spawn(async move {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
        let now = chrono::Utc::now();
        cleanup_state.sessions.write().await
            .retain(|_, s| s.expires_at > now);
    }
});
6. Migration content hash uses DefaultHasher (unstable across Rust versions)
File: src-tauri/src/database/pool.rs
DefaultHasher is explicitly not guaranteed to produce the same output across Rust versions. A Rust upgrade could re-run every migration. Use SHA-256 (already in Cargo.toml as sha2):
rustuse sha2::{Sha256, Digest};
fn compute_hash(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

🟠 Priority 2 — Missing Production Infrastructure
7. No ESLint configuration
eslint is not in devDependencies. A POS app with many contributors needs linting. Add:
json// package.json devDependencies
"eslint": "^9",
"@eslint/js": "^9",
"eslint-plugin-react": "^7",
"eslint-plugin-react-hooks": "^5"
And create eslint.config.js with react-hooks/rules-of-hooks and react-hooks/exhaustive-deps — these catch the class of bugs you've already fixed (stale closures in effects, infinite loops from selector references).
8. No test setup whatsoever
Neither frontend nor backend has tests. For a POS, the minimum viable test suite:
Frontend — Add vitest + @testing-library/react:

Test calcCartTotals (cart math is financial — must be exact)
Test formatCurrency with different locales/currencies
Test usePermission hook logic

Backend — Add cargo test integration tests:

Test split_sql_statements (the migration SQL parser — a bug here corrupts the DB)
Test validate_qty and validate_qty_signed (called on every write)
Test compute_hash stability

9. No React Query Devtools in development
jsx// src/main.jsx — add:
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

// Inside QueryClientProvider:
{import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
```

### 10. No `@tanstack/react-query` version with devtools installed
```
pnpm add -D @tanstack/react-query-devtools
11. Permission check hits the database on every request
File: src-tauri/src/commands/auth.rs → guard_permission
Every single command that requires a permission check runs a DB query. Since role permissions only change when an admin edits them (rare), cache the role_id → Vec<permission_slug> map in AppState:
rust// In state.rs — add:
pub permissions_cache: Arc<RwLock<HashMap<i32, Vec<String>>>>,
Populate it on login/refresh, invalidate when set_role_permissions is called.

🟡 Priority 3 — Code Quality & Reliability
12. unsafe { std::mem::transmute } still exists in purchase_orders.rs
The same pattern you fixed in returns.rs still exists in purchase_orders.rs (and likely transactions.rs, shifts.rs, and others). These inner wrapper functions all use the transmute hack. They should either be converted to use as_state() in http_server.rs (like you did for returns), or eliminated entirely.
13. tauri.conf.json identifier is "com.user.pos-app"
This should be a real reverse-domain identifier like "com.quantumpos.desktop". It affects OS keychain storage, update channels, and app signing.
14. Version is "0.1.0" hardcoded in both package.json and tauri.conf.json
Add a single source of truth using Tauri's package.version field and the app_version command (already implemented). Bump the version before shipping.
15. Default credentials shown in the login UI
jsx// src/App.jsx — REMOVE this in production:
<p className="text-center text-[11px] text-muted-foreground">
  Default: <span className="font-mono">admin</span> / <span className="font-mono">Admin@123</span>
</p>
Gate it behind import.meta.env.DEV at minimum.
16. No environment variable file for frontend
There is no .env or .env.example. The API port is discovered at runtime (good), but any future config (feature flags, build target, etc.) needs a documented env file:
env# .env.example
VITE_APP_NAME=Quantum POS
VITE_APP_ENV=production
17. jsconfig.json has no strict settings
json// Current jsconfig.json likely minimal. Add:
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "checkJs": true,
    "strict": false,
    "noUnusedLocals": false
  }
}
checkJs: true gives VS Code type-checking on .js files using JSDoc annotations — catches many bugs without migrating to TypeScript.
18. No barrel exports (index.js) from feature folders
Every feature is imported by its full path (@/features/inventory/StockCountRunner). Adding index.js barrel files per feature allows cleaner imports and makes refactoring easier:
js// src/features/inventory/index.js
export { StockCountList } from "./StockCountList";
export { StockCountRunner } from "./StockCountRunner";
export { VarianceReportView } from "./VarianceReportView";
export * from "./useInventory";

🟢 Priority 4 — Performance & UX Polish
19. Heavy list components missing React.memo
ItemRow in StockCountRunner re-renders on every parent update. With 500+ items this causes visible lag. Add React.memo with a custom comparator:
jsxconst ItemRow = React.memo(function ItemRow({ item, countedItem, onSelect, isInProgress }) {
  // ...
}, (prev, next) =>
  prev.item.item_id === next.item.item_id &&
  prev.countedItem?.counted_quantity === next.countedItem?.counted_quantity &&
  prev.isInProgress === next.isInProgress
);
20. No offline / network status indicator
The app has no visual indicator when the API becomes unreachable (e.g. server goes down mid-shift). Add a SyncStatusBadge (the file exists in components/shared) that polls /health and shows a warning banner when offline. The file exists — wire it into AppShell.
21. guard_permission DB query on every RPC call
Already mentioned above as a cache issue — worth highlighting separately because it's also a performance issue: every single protected endpoint makes at least 2 DB round trips (guard + query). Caching permissions in AppState brings this to 0 extra DB trips for permission checks.
22. Cart store missing persistence for crash recovery
If the app crashes mid-cart, the entire cart is lost (Zustand state is in-memory). Add sessionStorage persistence for the cart using Zustand's persist middleware with a sessionStorage adapter. This survives accidental WebView reloads but clears on app exit.
23. No keyboard shortcut documentation or help modal
The app has Cmd+K for the command palette. Add an accessible help modal (triggered by ? key) listing all keyboard shortcuts:

Cmd/Ctrl+K — Command palette
F2 — Open new sale (POS)
Esc — Close dialog/modal
Enter — Confirm dialog

24. Audit log exists but has no per-entity navigation
The AuditPage exists but you can't click on a transaction/return/item in the audit log to navigate to that entity. Add hyperlinks from reference_id to the relevant detail page.
25. tauri-plugin-notification is registered but unused
The notification plugin is initialized in lib.rs but no Tauri native notification is ever sent. Either remove it or use it for low-stock alerts (which currently only show in the in-app notification bell).

Summary Table
#CategoryWhat to AddFiles Affected1SecurityCSP policytauri.conf.json2SecurityEncrypt DB passwordSetupWizard.jsx, state.rs3SecurityRestrict CORS originshttp_server.rs4SecurityHTTP rate limitinghttp_server.rs5SecuritySession cleanup joblib.rs6ReliabilitySHA-256 migration hashingdatabase/pool.rs7QualityESLint + react-hooks rulespackage.json, eslint.config.js8Qualityvitest + cargo test suitesnew test files9DXReact Query Devtoolsmain.jsx 10PerformancePermission cache in AppStatestate.rs, auth.rs11SecurityRemove transmute hackspurchase_orders.rs, transactions.rs, etc.12IdentityFix app identifiertauri.conf.json13SecurityRemove default credentialsApp.jsx14Config.env.examplenew file15DXcheckJs: true in jsconfigjsconfig.json16DXBarrel index.js per featureeach src/features/*/index.js17PerformanceReact.memo on heavy list rowsStockCountRunner.jsx, ReturnsPanel.jsx18UXOffline status indicatorAppShell.jsx, SyncStatusBadge.jsx19UXCart crash recovery (persist)cart.store.js20UXKeyboard shortcuts help modalnew KeyboardHelp.jsx21UXAudit log → entity navigationAuditPage.jsx
