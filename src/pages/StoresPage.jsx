// ============================================================================
// pages/StoresPage.jsx — Store management list page
// ============================================================================
// Admin / super_admin only.
// Layout:
//   PageHeader + stat cards
//   Search + filter bar
//   Stores table
//   Right-side form panel for create / edit (replaces dialogs)
// ============================================================================

import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Store, Plus, Search, RefreshCw, Loader2,
  MapPin, Phone, Mail, Globe, DollarSign,
  CheckCircle2, XCircle, MoreHorizontal,
  Eye, Pencil, Power, PowerOff, X, Save,
  ChevronLeft, ChevronRight, Building2,
} from "lucide-react";

import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Badge }    from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/shared/PageHeader";
import { cn }         from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { CURRENCIES, TIMEZONES } from "@/features/onboarding/constants";

import { useStores }      from "@/features/stores/useStores";
import { useBranchStore } from "@/stores/branch.store";

// ─── Store form (create / edit) ───────────────────────────────────────────────
const EMPTY_FORM = {
  store_name: "", address: "", city: "", state: "",
  country: "Nigeria", phone: "", email: "",
  currency: "NGN", timezone: "Africa/Lagos",
  tax_rate: "", receipt_footer: "",
};

function StoreFormPanel({ store, onClose, onCreate, onUpdate, isSaving }) {
  const isEdit = !!store;
  const [form, setForm] = useState(() =>
    isEdit
      ? {
          store_name:     store.store_name    ?? "",
          address:        store.address       ?? "",
          city:           store.city          ?? "",
          state:          store.state         ?? "",
          country:        store.country       ?? "Nigeria",
          phone:          store.phone         ?? "",
          email:          store.email         ?? "",
          currency:       store.currency      ?? "NGN",
          timezone:       store.timezone      ?? "Africa/Lagos",
          tax_rate:       store.tax_rate != null ? String(store.tax_rate) : "",
          receipt_footer: store.receipt_footer ?? "",
        }
      : EMPTY_FORM
  );

  const set = (k) => (e) => setForm((f) => ({
    ...f,
    [k]: typeof e === "string" ? e : e.target.value,
  }));

  const handleSubmit = (ev) => {
    ev.preventDefault();
    const payload = {
      store_name:     form.store_name.trim(),
      address:        form.address.trim()       || null,
      city:           form.city.trim()          || null,
      state:          form.state.trim()         || null,
      country:        form.country              || "Nigeria",
      phone:          form.phone.trim()         || null,
      email:          form.email.trim()         || null,
      currency:       form.currency             || "NGN",
      timezone:       form.timezone             || "Africa/Lagos",
      tax_rate:       form.tax_rate !== "" ? parseFloat(form.tax_rate) : null,
      receipt_footer: form.receipt_footer.trim() || null,
    };
    if (isEdit) onUpdate(store.id, payload);
    else        onCreate(payload);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card/80 shrink-0">
        <div>
          <h3 className="text-[13px] font-bold text-foreground">
            {isEdit ? "Edit Store" : "New Store"}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {isEdit ? `Editing "${store.store_name}"` : "Add a new branch or location"}
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Form body */}
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto min-h-0">
        <div className="px-5 py-5 space-y-4">

          <Field label="Store Name" required>
            <Input
              value={form.store_name}
              onChange={set("store_name")}
              placeholder="e.g. Ikeja Branch"
              required
              autoFocus
              className="h-9 text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="City">
              <Input value={form.city} onChange={set("city")} placeholder="Lagos" className="h-9 text-sm" />
            </Field>
            <Field label="State">
              <Input value={form.state} onChange={set("state")} placeholder="Lagos State" className="h-9 text-sm" />
            </Field>
          </div>

          <Field label="Address">
            <Input value={form.address} onChange={set("address")} placeholder="123 Broad Street" className="h-9 text-sm" />
          </Field>

          <Field label="Country">
            <Input value={form.country} onChange={set("country")} placeholder="Nigeria" className="h-9 text-sm" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <Input value={form.phone} onChange={set("phone")} placeholder="+234 800 000 0000" className="h-9 text-sm" />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={set("email")} placeholder="store@example.com" className="h-9 text-sm" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency">
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Tax Rate (%)">
              <Input
                type="number" min="0" max="100" step="0.01"
                value={form.tax_rate}
                onChange={set("tax_rate")}
                placeholder="7.5"
                className="h-9 text-sm"
              />
            </Field>
          </div>

          <Field label="Timezone">
            <Select value={form.timezone} onValueChange={(v) => setForm((f) => ({ ...f, timezone: v }))}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Receipt Footer" hint="Optional text printed at the bottom of receipts.">
            <textarea
              value={form.receipt_footer}
              onChange={set("receipt_footer")}
              placeholder="Thank you for shopping with us!"
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </Field>
        </div>
      </form>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-4 border-t border-border bg-card/50 shrink-0">
        <Button variant="outline" size="sm" onClick={onClose} className="flex-1">
          Cancel
        </Button>
        <Button
          size="sm"
          className="flex-1 gap-1.5"
          disabled={isSaving || !form.store_name.trim()}
          onClick={handleSubmit}
        >
          {isSaving
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
            : <><Save    className="h-3.5 w-3.5" />{isEdit ? "Save Changes" : "Create Store"}</>
          }
        </Button>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Field({ label, required, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {hint && <p className="text-[11px] text-muted-foreground -mt-0.5">{hint}</p>}
      {children}
    </div>
  );
}

function Th({ children, className }) {
  return (
    <th className={cn(
      "px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
      className,
    )}>
      {children}
    </th>
  );
}

function StatusBadge({ isActive }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
      isActive
        ? "bg-success/10 text-success border-success/20"
        : "bg-destructive/10 text-destructive border-destructive/20",
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", isActive ? "bg-success" : "bg-destructive/60")} />
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function StatCard({ label, value, sub, accent = "default" }) {
  const ring = {
    default: "border-border/60 bg-card",
    primary: "border-primary/25 bg-primary/[0.06]",
    success: "border-success/25 bg-success/[0.06]",
    warning: "border-warning/25 bg-warning/[0.06]",
  }[accent];
  const val = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
  }[accent];
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-4 py-3.5", ring)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ─── StoreRow ──────────────────────────────────────────────────────────────────

function StoreRow({ store, isActive: isActiveStore, onView, onEdit, onActivate, onDeactivate }) {
  const code     = (store.store_name ?? "ST").replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "ST";
  const location = [store.city, store.state].filter(Boolean).join(", ");

  return (
    <tr
      onClick={onView}
      className="group cursor-pointer transition-colors duration-100 hover:bg-muted/20"
    >
      {/* Store name + initials */}
      <td className="pl-5 pr-3 py-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-[11px] font-bold",
            isActiveStore
              ? "border-primary/30 bg-primary/15 text-primary"
              : "border-border bg-muted/30 text-muted-foreground",
          )}>
            {code}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold text-foreground truncate">{store.store_name}</p>
              {isActiveStore && (
                <span className="rounded-full bg-primary/15 text-primary text-[9px] font-bold px-1.5 py-px shrink-0">
                  ACTIVE
                </span>
              )}
            </div>
            {location && (
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5 truncate">
                <MapPin className="h-2.5 w-2.5 shrink-0" />
                {location}
              </p>
            )}
          </div>
        </div>
      </td>

      {/* Contact */}
      <td className="px-3 py-3 text-[12px] text-muted-foreground">
        <div className="space-y-0.5">
          {store.phone && (
            <p className="flex items-center gap-1.5 truncate">
              <Phone className="h-3 w-3 shrink-0 opacity-50" />
              {store.phone}
            </p>
          )}
          {store.email && (
            <p className="flex items-center gap-1.5 truncate">
              <Mail className="h-3 w-3 shrink-0 opacity-50" />
              {store.email}
            </p>
          )}
          {!store.phone && !store.email && <span className="italic text-muted-foreground/40">No contact</span>}
        </div>
      </td>

      {/* Currency */}
      <td className="px-3 py-3">
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <DollarSign className="h-3 w-3 shrink-0 opacity-50" />
          {store.currency}
        </span>
      </td>

      {/* Tax rate */}
      <td className="px-3 py-3 text-[12px] text-muted-foreground tabular-nums">
        {store.tax_rate != null ? `${store.tax_rate}%` : "—"}
      </td>

      {/* Status */}
      <td className="px-3 py-3">
        <StatusBadge isActive={store.is_active} />
      </td>

      {/* Created */}
      <td className="px-3 py-3 text-[11px] text-muted-foreground tabular-nums">
        {store.created_at ? formatDateTime(store.created_at) : "—"}
      </td>

      {/* Actions */}
      <td className="px-3 pr-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost" size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onView} className="gap-2 text-[12px]">
              <Eye className="h-3.5 w-3.5" /> View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit} className="gap-2 text-[12px]">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {store.is_active ? (
              <DropdownMenuItem
                onClick={onDeactivate}
                className="gap-2 text-[12px] text-destructive focus:text-destructive"
              >
                <PowerOff className="h-3.5 w-3.5" /> Deactivate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={onActivate}
                className="gap-2 text-[12px] text-success focus:text-success"
              >
                <Power className="h-3.5 w-3.5" /> Activate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export default function StoresPage() {
  const navigate      = useNavigate();
  const activeStoreId = useBranchStore((s) => s.activeStore?.id);

  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page,         setPage]         = useState(1);

  const [panelMode,  setPanelMode]  = useState(null);   // "create" | "edit"
  const [editTarget, setEditTarget] = useState(null);   // store being edited

  const { stores: allStores, isLoading, isFetching, error, refetch,
          create, update, activate, deactivate } = useStores();

  // ── Filter + paginate locally (list is small) ─────────────────────────────
  const filtered = useMemo(() => {
    let list = allStores;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) =>
        s.store_name?.toLowerCase().includes(q) ||
        s.city?.toLowerCase().includes(q)       ||
        s.state?.toLowerCase().includes(q)      ||
        s.email?.toLowerCase().includes(q)
      );
    }
    if (statusFilter === "active")   list = list.filter((s) => s.is_active);
    if (statusFilter === "inactive") list = list.filter((s) => !s.is_active);
    return list;
  }, [allStores, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageStores = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── KPI counts ────────────────────────────────────────────────────────────
  const totalAll    = allStores.length;
  const activeCount = allStores.filter((s) => s.is_active).length;
  const inactiveCount = totalAll - activeCount;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const openCreate = () => { setEditTarget(null); setPanelMode("create"); };
  const openEdit   = (store, e) => { e?.stopPropagation(); setEditTarget(store); setPanelMode("edit"); };
  const closePanel = () => { setPanelMode(null); setEditTarget(null); };

  const handleCreate = async (payload) => {
    await create.mutateAsync(payload);
    closePanel();
  };

  const handleUpdate = async (id, payload) => {
    await update.mutateAsync({ id, ...payload });
    closePanel();
  };

  const panelOpen = !!panelMode;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-border bg-card/50 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <PageHeader
            title="Stores"
            description="Manage your branches, locations and store configuration"
            icon={Store}
          />
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost" size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-8 gap-1.5 text-[11px] text-muted-foreground"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" onClick={openCreate} className="h-8 gap-1.5 text-[12px]">
              <Plus className="h-3.5 w-3.5" /> New Store
            </Button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-3 mt-5">
          <StatCard label="Total Stores" value={totalAll}     sub="All locations"   accent="primary" />
          <StatCard label="Active"        value={activeCount}  sub="Operational now" accent="success" />
          <StatCard
            label="Inactive"
            value={inactiveCount}
            sub="Deactivated stores"
            accent={inactiveCount > 0 ? "warning" : "default"}
          />
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className={cn("flex flex-1 min-h-0 overflow-hidden", panelOpen && "divide-x divide-border")}>

        {/* Main content */}
        <div className="flex-1 overflow-auto min-h-0">
          <div className="mx-auto max-w-6xl px-6 py-5">

            {/* Filter bar */}
            <div className="flex items-center gap-2 mb-4">
              <div className="relative flex-1 max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search stores…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-8 h-8 text-[12px] bg-background"
                />
              </div>

              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="w-32 h-8 text-[12px] bg-background">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stores</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>

              {(search || statusFilter !== "all") && (
                <Button
                  variant="ghost" size="sm"
                  onClick={() => { setSearch(""); setStatusFilter("all"); setPage(1); }}
                  className="h-8 px-2 text-[11px] text-muted-foreground"
                >
                  Clear
                </Button>
              )}

              <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                {isLoading ? "…" : `${filtered.length} store${filtered.length !== 1 ? "s" : ""}`}
              </span>
            </div>

            {/* Table card */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {isLoading ? (
                <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading stores…
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                  <p className="text-sm font-semibold text-destructive">Failed to load stores</p>
                  <p className="text-[11px] text-muted-foreground max-w-xs">
                    {typeof error === "string" ? error : error?.message}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 text-xs">
                    <RefreshCw className="h-3 w-3" /> Retry
                  </Button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/30 border border-border">
                    <Building2 className="h-6 w-6 text-muted-foreground/30" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-muted-foreground">No stores found</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {search || statusFilter !== "all"
                        ? "Try adjusting your filters"
                        : "Create your first store to get started"}
                    </p>
                  </div>
                  {!search && statusFilter === "all" && (
                    <Button size="sm" onClick={openCreate} className="gap-1.5 text-xs mt-1">
                      <Plus className="h-3.5 w-3.5" /> Create First Store
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-border/60 bg-muted/10">
                          <Th className="pl-5 w-[260px]">Store</Th>
                          <Th className="w-[200px]">Contact</Th>
                          <Th className="w-[80px]">Currency</Th>
                          <Th className="w-[80px]">Tax</Th>
                          <Th className="w-[100px]">Status</Th>
                          <Th className="w-[150px]">Created</Th>
                          <Th className="w-[50px] pr-4 text-right">Actions</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {pageStores.map((store) => (
                          <StoreRow
                            key={store.id}
                            store={store}
                            isActive={store.id === activeStoreId}
                            onView={() => navigate(`/stores/${store.id}`)}
                            onEdit={(e) => openEdit(store, e)}
                            onActivate={() => activate.mutate(store.id)}
                            onDeactivate={() => deactivate.mutate(store.id)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-border/40">
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        Page {page} of {totalPages} · {filtered.length} total
                      </span>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" disabled={page === 1}
                          onClick={() => setPage((p) => p - 1)} className="h-7 w-7 p-0">
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </Button>
                        {Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => {
                          const p = i + 1;
                          return (
                            <button key={p} onClick={() => setPage(p)}
                              className={cn(
                                "h-7 w-7 rounded-md text-[11px] font-medium transition-colors",
                                p === page
                                  ? "bg-primary text-primary-foreground"
                                  : "text-muted-foreground hover:bg-muted/50",
                              )}>
                              {p}
                            </button>
                          );
                        })}
                        <Button variant="ghost" size="sm" disabled={page === totalPages}
                          onClick={() => setPage((p) => p + 1)} className="h-7 w-7 p-0">
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Create / Edit panel */}
        {panelOpen && (
          <div className="w-[380px] shrink-0 bg-card flex flex-col overflow-hidden">
            <StoreFormPanel
              store={editTarget}
              onClose={closePanel}
              onCreate={handleCreate}
              onUpdate={handleUpdate}
              isSaving={create.isPending || update.isPending}
            />
          </div>
        )}
      </div>
    </div>
  );
}
