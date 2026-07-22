// ============================================================================
// features/settings/SyncLogPanel.jsx — sync event log viewer
// ============================================================================
// Replaces the old 8-row "recent activity" list, which read from sync_queue and
// therefore only ever showed outbound rows — inbound (pull) activity and every
// pull failure were structurally invisible.
//
// Reads sync_event_log (migration 0105) instead: both directions, real error
// text, and per-row outcomes grouped into the cycles the worker actually ran.
// ============================================================================
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpFromLine, ArrowDownToLine, Check, X, MinusCircle, GitMerge,
  ChevronRight, Filter, Loader2, RefreshCw, Inbox,
} from "lucide-react";

import { getSyncLog, getSyncLogTables } from "@/commands/cloud_sync";
import { Button } from "@/components/ui/button";
import { cn }     from "@/lib/utils";

const PAGE_SIZE = 100;

// Outcome → how it reads. Colour is never the only signal: each has an icon
// and a label, so the log stays readable for colour-blind users.
const OUTCOME = {
  ok:       { label: "Applied",  icon: Check,       cls: "text-success",            dot: "bg-success"       },
  failed:   { label: "Failed",   icon: X,           cls: "text-destructive",        dot: "bg-destructive"   },
  skipped:  { label: "Deferred", icon: MinusCircle, cls: "text-warning",            dot: "bg-warning"       },
  conflict: { label: "Conflict", icon: GitMerge,    cls: "text-primary",            dot: "bg-primary"       },
};

// Error codes from classify_error() in database/sync.rs, in plain language.
const ERROR_CODE = {
  fk_violation:  { label: "Missing parent row",  hint: "A referenced record hasn't reached the cloud yet. This usually clears itself on the next cycle." },
  constraint:    { label: "Constraint violation", hint: "The row conflicts with a rule on the cloud table (duplicate key, missing required value)." },
  serialization: { label: "Write conflict",       hint: "Two writers touched the same row at once. Safe to retry." },
  auth:          { label: "Authentication",       hint: "The cloud rejected the credentials. Check the connection settings." },
  network:       { label: "Network",              hint: "Couldn't reach the cloud database. Retries automatically once the connection returns." },
  unknown:       { label: "Unclassified",         hint: "See the raw error text below." },
};

function timeOf(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return ""; }
}

// ── One expandable row ───────────────────────────────────────────────────────
function LogRow({ entry }) {
  const [open, setOpen] = useState(false);
  const meta      = OUTCOME[entry.outcome] ?? OUTCOME.ok;
  const Icon      = meta.icon;
  const DirIcon   = entry.direction === "push" ? ArrowUpFromLine : ArrowDownToLine;
  const codeMeta  = entry.error_code ? (ERROR_CODE[entry.error_code] ?? ERROR_CODE.unknown) : null;
  const expandable = Boolean(entry.error_detail);

  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
          expandable ? "hover:bg-muted/40 cursor-pointer" : "cursor-default",
        )}
      >
        <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.cls)} />
        <DirIcon className="h-3 w-3 shrink-0 text-muted-foreground" />

        <span className="min-w-0 flex-1 truncate text-[11px]">
          <span className="font-semibold text-foreground">{entry.table_name}</span>
          {entry.operation && (
            <span className="text-muted-foreground"> · {entry.operation.toLowerCase()}</span>
          )}
          {entry.row_id && (
            <span className="text-muted-foreground/70"> · {entry.row_id}</span>
          )}
        </span>

        {codeMeta && (
          <span className="shrink-0 rounded-full border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive">
            {codeMeta.label}
          </span>
        )}
        {entry.attempt > 1 && (
          <span className="shrink-0 text-[9px] font-semibold text-warning">
            try {entry.attempt}
          </span>
        )}
        {entry.duration_ms != null && (
          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/70">
            {entry.duration_ms}ms
          </span>
        )}
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {timeOf(entry.created_at)}
        </span>
        {expandable && (
          <ChevronRight className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )} />
        )}
      </button>

      {open && entry.error_detail && (
        <div className="space-y-2 border-t border-border/40 bg-muted/20 px-3 py-2.5">
          {codeMeta && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {codeMeta.hint}
            </p>
          )}
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-background px-2.5 py-2 text-[10px] leading-relaxed text-foreground">
            {entry.error_detail}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Filter pill ──────────────────────────────────────────────────────────────
function Pill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-8 rounded-lg border px-2.5 text-[10px] font-semibold transition-colors",
        active
          ? "border-primary/30 bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function SyncLogPanel() {
  const [direction, setDirection] = useState(null);  // null | push | pull
  const [outcome,   setOutcome]   = useState(null);  // null | ok | failed | skipped | conflict
  const [table,     setTable]     = useState(null);
  const [page,      setPage]      = useState(0);

  const filters = useMemo(() => ({
    ...(direction ? { direction }        : {}),
    ...(outcome   ? { outcome }          : {}),
    ...(table     ? { table_name: table }: {}),
    limit:  PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [direction, outcome, table, page]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["sync-log", filters],
    queryFn:  () => getSyncLog(filters),
    // The log is append-only and the panel is already woken by sync:cycle
    // events, so this only covers the case where nothing is emitting.
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });

  const { data: tables = [] } = useQuery({
    queryKey: ["sync-log-tables"],
    queryFn:  getSyncLogTables,
    staleTime: 60_000,
  });

  const entries = data?.entries ?? [];
  const total   = data?.total   ?? 0;
  const pages   = Math.ceil(total / PAGE_SIZE);

  const resetTo = (fn) => (v) => { fn(v); setPage(0); };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-4 py-2.5">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Sync Activity
        </h2>
        {total > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/70">
            {entries.length} of {total.toLocaleString()}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1.5 px-2 text-[10px]"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching
            ? <Loader2   className="h-3 w-3 animate-spin" />
            : <RefreshCw className="h-3 w-3" />}
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <Filter className="h-3 w-3 shrink-0 text-muted-foreground" />

        <Pill active={!direction} onClick={() => resetTo(setDirection)(null)}>Both</Pill>
        <Pill active={direction === "push"} onClick={() => resetTo(setDirection)("push")}>↑ Push</Pill>
        <Pill active={direction === "pull"} onClick={() => resetTo(setDirection)("pull")}>↓ Pull</Pill>

        <span className="mx-1 h-4 w-px bg-border" />

        <Pill active={!outcome} onClick={() => resetTo(setOutcome)(null)}>All</Pill>
        {Object.entries(OUTCOME).map(([key, m]) => (
          <Pill key={key} active={outcome === key} onClick={() => resetTo(setOutcome)(key)}>
            {m.label}
          </Pill>
        ))}

        {tables.length > 0 && (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            <select
              value={table ?? ""}
              onChange={(e) => resetTo(setTable)(e.target.value || null)}
              aria-label="Filter by table"
              className="h-8 rounded-lg border border-border bg-background px-2 text-[10px] font-semibold text-foreground"
            >
              <option value="">All tables</option>
              {tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </>
        )}
      </div>

      {/* Entries */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <Inbox className="h-6 w-6 text-muted-foreground/30" />
          <p className="text-[12px] font-semibold text-foreground">No sync activity</p>
          <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
            {direction || outcome || table
              ? "Nothing matches these filters. Try widening them."
              : "Activity appears here as soon as the sync worker pushes or pulls a row."}
          </p>
        </div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          {entries.map((e) => <LogRow key={e.id} entry={e} />)}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <Button
            variant="outline" size="sm" className="h-7 text-[10px]"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Newer
          </Button>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            Page {page + 1} of {pages}
          </span>
          <Button
            variant="outline" size="sm" className="h-7 text-[10px]"
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Older
          </Button>
        </div>
      )}
    </div>
  );
}
