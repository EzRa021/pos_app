# Frontend Reference

## Layout

```
src/
  pages/           # Route components (~50) — thin, delegate to features
  features/        # Domain UI + React Query hooks
  components/
    ui/            # shadcn primitives
    shared/        # PageHeader, DataTable, EmptyState, Spinner
    layout/        # AppShell, TitleBar, AppSidebar
  stores/          # Zustand global state
  hooks/           # Cross-cutting hooks
  commands/        # rpc() wrappers per domain
  lib/
    apiClient.js   # Axios + rpc() — THE API entry point
    queryClient.js
    format.js      # Money, dates
    supabase.js    # Realtime only
```

## rpc() usage

```js
import { rpc } from "@/lib/apiClient";

// In React Query hook:
queryFn: () => rpc("list_items", { store_id: storeId, filters }),
mutationFn: (dto) => rpc("create_item", dto),
```

Token attached automatically via Axios defaults after login.

## React Query conventions

- Hooks live in `src/features/<domain>/use*.js`
- Query keys: `[domain]` or `[domain, storeId, filters]`
- `enabled: isApiReady()` on all queries
- Invalidate related keys after mutations (see `lib/invalidations.js`)

## Styling (dark theme default)

| Token | Use |
|-------|-----|
| `bg-background` | Page |
| `bg-card` | Panels |
| `bg-primary` | Active, primary buttons |
| `bg-success` | Charge/Pay button ONLY |
| `bg-destructive` | Delete, void |
| `bg-warning` | Pending, low stock |
| `text-muted-foreground` | Labels only |

Labels: `text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`  
Cards: `rounded-xl border border-border bg-card`  
Inputs/buttons: `h-9`

Pre-auth screens: force `document.documentElement.classList.add("dark")`.

## Routes

Defined in `src/router.jsx`. Protected routes wrapped in `ProtectedRoute`.  
POS lock state handled via `useAuthStore.isPosLocked`.

## Sync UI

- `SyncStatusBadge` — header pending/failed indicator
- `CloudSyncPanel` — settings: credentials, enable toggle, failed rows
- `useSyncStatus` — 15s poll of sync_queue stats

Realtime should eventually move to app level (not just settings panel).

## Testing

```bash
pnpm test    # Vitest
pnpm lint    # ESLint
```
