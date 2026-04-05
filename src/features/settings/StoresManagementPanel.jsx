// ============================================================================
// features/settings/StoresManagementPanel.jsx
// ============================================================================
// Embedded in SettingsPage → "Stores" tab.
//   • KPI cards (total / active / inactive)
//   • Search + status filter
//   • Stores table with inline edit panel
//   • "New Store" → navigates to /store/new (full-page creation flow)
// ============================================================================

import { useState, useMemo } from "react";
import { useNavigate }       from "react-router-dom";
import {
  Building2, Check, DollarSign, Loader2,
  Mail, MapPin, MoreHorizontal, Pencil, Phone, Plus, Power,
  PowerOff, RefreshCw, Save, Search, Store, X,
} from "lucide-react";

import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogoUpload }      from "@/components/shared/LogoUpload";

import { cn }           from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { CURRENCIES, TIMEZONES } from "@/features/onboarding/constants";
import { useStores }      from "@/features/stores/useStores";
import { useBranchStore } from "@/stores/branch.store";

// ─── helpers ──────────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  store_name: "", address: "", city: "", state: "",
  country: "Nigeria", phone: "", email: "",
  currency: "NGN", timezone: "Africa/Lagos",
  tax_rate: "", receipt_footer: "",
};

function Field({ label, required, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {hint && <p className="text-[10px] text-muted-foreground/60 -mt-0.5">{hint}</p>}
      {children}
    </div>
  );
}

function StatusDot({ isActive }) {
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

function KpiCard({ label, value, accent = "default" }) {
  const styles = {
    default: "border-border/60 bg-muted/20",
    primary: "border-primary/20 bg-primary/5",
    success: "border-success/20 bg-success/5",
    warning: "border-warning/20 bg-warning/5",
  };
  const valStyles = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
  };
  return (
    <div className={cn("rounded-xl border px-4 py-3 space-y-0.5", styles[accent])}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-bold tabular-nums leading-none", valStyles[accent])}>{value}</p>
    </div>
  );
}

// ─── Edit panel (slide-in) ─────────────────────────────────────────────────────
// Only used for editing existing stores. New store creation goes to /store/new.
function EditStorePanel({ store, onClose, onUpdate, isSaving }) {
  const [form, setForm] = useState({
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
    logo_data:      store.logo_data     ?? null,
  });

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: typeof e === "string" ? e : e.target.value }));

  const handleSubmit = (ev) => {
    ev?.preventDefault();
    const payload = {
      store_name:     form.store_name.trim(),
      address:        form.address.trim()        || null,
      city:           form.city.trim()           || null,
      state:          form.state.trim()          || null,
      country:        form.country               || "Nigeria",
      phone:          form.phone.trim()          || null,
      email:          form.email.trim()          || null,
      currency:       form.currency              || "NGN",
      timezone:       form.timezone              || "Africa/Lagos",
      tax_rate:       form.tax_rate !== ""       ? parseFloat(form.tax_rate) : null,
      receipt_footer: form.receipt_footer.trim() || null,
      logo_data:      form.logo_data             || null,
    };
    onUpdate(store.id, payload);
  };

  return (
    <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-border bg-card/80 shrink-0">
        <div>
          <h3 className="text-[13px] font-bold text-foreground">Edit Store</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Editing "{store.store_name}"</p>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto min-h-0">
        <div className="px-4 py-4 space-y-3.5">
          {/* Logo */}
          <LogoUpload
            value={form.logo_data}
            onChange={(v) => setForm((f) => ({ ...f, logo_data: v }))}
            label="Store Logo"
            hint="Shown in the sidebar store-switcher. JPEG, PNG or WebP."
            size="md"
          />

          <Field label="Store Name" required>
            <Input
              value={form.store_name}
              onChange={set("store_name")}
              placeholder="e.g. Ikeja Branch"
              required autoFocus
              className="h-8 text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="City">
              <Input value={form.city} onChange={set("city")} placeholder="Lagos" className="h-8 text-sm" />
            </Field>
            <Field label="State">
              <Input value={form.state} onChange={set("state")} placeholder="Lagos State" className="h-8 text-sm" />
            </Field>
          </div>

          <Field label="Address">
            <Input value={form.address} onChange={set("address")} placeholder="123 Broad Street" className="h-8 text-sm" />
          </Field>

          <Field label="Country">
            <Input value={form.country} onChange={set("country")} className="h-8 text-sm" />
          </Field>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Phone">
              <Input value={form.phone} onChange={set("phone")} placeholder="+234…" className="h-8 text-sm" />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={set("email")} placeholder="store@…" className="h-8 text-sm" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Currency">
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
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
                value={form.tax_rate} onChange={set("tax_rate")}
                placeholder="7.5" className="h-8 text-sm"
              />
            </Field>
          </div>

          <Field label="Timezone">
            <Select value={form.timezone} onValueChange={(v) => setForm((f) => ({ ...f, timezone: v }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Receipt Footer" hint="Optional — printed at bottom of receipts">
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
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-card/50 shrink-0">
        <Button variant="outline" size="sm" onClick={onClose} className="flex-1 h-8">Cancel</Button>
        <Button
          size="sm"
          className="flex-1 h-8 gap-1.5"
          disabled={isSaving || !form.store_name.trim()}
          onClick={handleSubmit}
        >
          {isSaving
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
            : <><Save    className="h-3.5 w-3.5" />Save Changes</>
          }
        </Button>
      </div>
    </div>
  );
}

// ─── Store row ────────────────────────────────────────────────────────────────
function StoreRow({ store, isActiveBranch, onEdit, onActivate, onDeactivate }) {
  const code     = (store.store_name ?? "ST").replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "ST";
  const location = [store.city, store.state].filter(Boolean).join(", ");

  return (
    <tr className="group transition-colors duration-100 hover:bg-muted/10">
      {/* Store */}
      <td className="pl-4 pr-3 py-3">
        <div className="flex items-center gap-2.5">
          {/* Store avatar — logo if available, else initials */}
          <div className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border overflow-hidden",
            isActiveBranch
              ? "border-primary/30 bg-primary/15"
              : "border-border bg-muted/30",
          )}>
            {store.logo_data ? (
              <img src={store.logo_data} alt={store.store_name} className="h-full w-full object-cover" />
            ) : (
              <span className={cn(
                "text-[10px] font-bold",
                isActiveBranch ? "text-primary" : "text-muted-foreground",
              )}>{code}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[12px] font-semibold text-foreground truncate">{store.store_name}</p>
              {isActiveBranch && (
                <span className="shrink-0 rounded-full bg-primary/15 text-primary text-[8px] font-bold px-1.5 py-0.5">
                  ACTIVE
                </span>
              )}
            </div>
            {location && (
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                <MapPin className="h-2 w-2 shrink-0" />{location}
              </p>
            )}
          </div>
        </div>
      </td>

      {/* Contact */}
      <td className="px-3 py-3">
        <div className="space-y-0.5 text-[11px] text-muted-foreground">
          {store.phone && (
            <p className="flex items-center gap-1 truncate"><Phone className="h-2.5 w-2.5 shrink-0 opacity-50" />{store.phone}</p>
          )}
          {store.email && (
            <p className="flex items-center gap-1 truncate"><Mail className="h-2.5 w-2.5 shrink-0 opacity-50" />{store.email}</p>
          )}
          {!store.phone && !store.email && <span className="italic opacity-30 text-[10px]">No contact</span>}
        </div>
      </td>

      {/* Currency */}
      <td className="px-3 py-3">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <DollarSign className="h-2.5 w-2.5 opacity-50" />{store.currency}
        </span>
      </td>

      {/* Status */}
      <td className="px-3 py-3"><StatusDot isActive={store.is_active} /></td>

      {/* Created */}
      <td className="px-3 py-3 text-[10px] text-muted-foreground tabular-nums">
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
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => onEdit(store)} className="gap-2 text-[12px]">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {store.is_active ? (
              <DropdownMenuItem
                onClick={() => onDeactivate(store.id)}
                className="gap-2 text-[12px] text-destructive focus:text-destructive"
              >
                <PowerOff className="h-3.5 w-3.5" /> Deactivate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => onActivate(store.id)}
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

// ─── Main panel ───────────────────────────────────────────────────────────────
export function StoresManagementPanel() {
  const navigate      = useNavigate();
  const activeStoreId = useBranchStore((s) => s.activeStore?.id);

  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editTarget,   setEditTarget]   = useState(null);   // store being edited

  const {
    stores: allStores, isLoading, isFetching, error, refetch,
    update, activate, deactivate,
  } = useStores();

  // ── Filter ──────────────────────────────────────────────────────────────────
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

  const activeCount   = allStores.filter((s) => s.is_active).length;
  const inactiveCount = allStores.length - activeCount;

  const openEdit   = (store) => setEditTarget(store);
  const closePanel = ()      => setEditTarget(null);

  const handleUpdate = async (id, payload) => {
    await update.mutateAsync({ id, ...payload });
    closePanel();
  };

  const editOpen = !!editTarget;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-border bg-card/50">
        {/* KPI row */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <KpiCard label="Total Stores" value={allStores.length} accent="primary" />
          <KpiCard label="Active"        value={activeCount}      accent="success" />
          <KpiCard
            label="Inactive"
            value={inactiveCount}
            accent={inactiveCount > 0 ? "warning" : "default"}
          />
        </div>

        {/* Search + actions */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search stores…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-[12px] bg-background"
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-28 h-8 text-[12px] bg-background">
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
              onClick={() => { setSearch(""); setStatusFilter("all"); }}
              className="h-8 px-2 text-[11px] text-muted-foreground"
            >
              Clear
            </Button>
          )}

          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {isLoading ? "…" : `${filtered.length} store${filtered.length !== 1 ? "s" : ""}`}
          </span>

          <Button
            variant="ghost" size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 gap-1.5 text-[11px] text-muted-foreground"
          >
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          </Button>

          {/* New Store → navigates to full-page creation flow */}
          <Button
            size="sm"
            onClick={() => navigate("/store/new")}
            className="h-8 gap-1.5 text-[12px]"
          >
            <Plus className="h-3.5 w-3.5" /> New Store
          </Button>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className={cn("flex min-h-0", editOpen && "divide-x divide-border")}>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading stores…
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <p className="text-sm font-semibold text-destructive">Failed to load stores</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 text-xs">
                <RefreshCw className="h-3 w-3" /> Retry
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-4 text-center">
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
                <Button
                  size="sm"
                  onClick={() => navigate("/store/new")}
                  className="gap-1.5 text-xs mt-1"
                >
                  <Plus className="h-3.5 w-3.5" /> Create First Store
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/10">
                    {["Store", "Contact", "Currency", "Status", "Created", ""].map((h, i) => (
                      <th
                        key={i}
                        className={cn(
                          "py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                          i === 0 ? "pl-4 pr-3 w-[220px]" : i === 5 ? "px-3 pr-4 w-[40px] text-right" : "px-3",
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {filtered.map((store) => (
                    <StoreRow
                      key={store.id}
                      store={store}
                      isActiveBranch={store.id === activeStoreId}
                      onEdit={openEdit}
                      onActivate={(id) => activate.mutate(id)}
                      onDeactivate={(id) => deactivate.mutate(id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Edit slide-in panel */}
        {editOpen && (
          <div className="w-[340px] shrink-0 bg-card flex flex-col overflow-hidden border-l border-border">
            <EditStorePanel
              store={editTarget}
              onClose={closePanel}
              onUpdate={handleUpdate}
              isSaving={update.isPending}
            />
          </div>
        )}
      </div>
    </div>
  );
}
