// ============================================================================
// pages/StoreDetailPage.jsx — Full store detail page with three tabs
// ============================================================================
// Tabs:
//   Overview   — All store fields with inline edit form + status toggle
//   Team       — Users assigned to this store (from get_store_users)
//   Configuration — Logo, receipt_footer, active toggle, tax rate
// ============================================================================

import { useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Store, MapPin, Phone, Mail, Globe, DollarSign,
  Clock, Calendar, CheckCircle2, XCircle, Power, PowerOff,
  Pencil, Save, X, Loader2, ArrowLeft, RefreshCw,
  Users, Shield, Building2, Upload, Hash,
  ReceiptText, Percent, AlertCircle,
} from "lucide-react";

import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Badge }    from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn }             from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { CURRENCIES, TIMEZONES } from "@/features/onboarding/constants";

import { useStore, useStoreUsers } from "@/features/stores/useStores";
import { useBranchStore } from "@/stores/branch.store";
import { getRoleConfig } from "@/features/users/roleConfig";

// ─── Small reusables ──────────────────────────────────────────────────────────

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

function InfoRow({ icon: Icon, label, children, mono = false }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/30">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <span className="text-[11px] text-muted-foreground w-24 shrink-0">{label}</span>
      <span className={cn(
        "text-[13px] font-medium text-foreground flex-1 truncate",
        mono && "font-mono text-[12px]",
      )}>
        {children ?? <span className="text-muted-foreground/40 italic text-[12px]">Not set</span>}
      </span>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, action }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2.5">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({ store, update, activate, deactivate }) {
  const [editing, setEditing]   = useState(false);
  const [toggling, setToggling] = useState(false);
  const [form, setForm] = useState({});

  const startEdit = () => {
    setForm({
      store_name: store.store_name ?? "",
      address:    store.address    ?? "",
      city:       store.city       ?? "",
      state:      store.state      ?? "",
      country:    store.country    ?? "Nigeria",
      phone:      store.phone      ?? "",
      email:      store.email      ?? "",
      currency:   store.currency   ?? "NGN",
      timezone:   store.timezone   ?? "Africa/Lagos",
      tax_rate:   store.tax_rate != null ? String(store.tax_rate) : "",
    });
    setEditing(true);
  };

  const cancelEdit  = () => setEditing(false);
  const set         = (k) => (e) => setForm((f) => ({
    ...f,
    [k]: typeof e === "string" ? e : e.target.value,
  }));

  const handleSave = async () => {
    await update.mutateAsync({
      id:        store.id,
      store_name: form.store_name.trim(),
      address:    form.address.trim()  || null,
      city:       form.city.trim()     || null,
      state:      form.state.trim()    || null,
      country:    form.country         || "Nigeria",
      phone:      form.phone.trim()    || null,
      email:      form.email.trim()    || null,
      currency:   form.currency        || "NGN",
      timezone:   form.timezone        || "Africa/Lagos",
      tax_rate:   form.tax_rate !== "" ? parseFloat(form.tax_rate) : null,
    });
    setEditing(false);
  };

  const handleToggle = async () => {
    setToggling(true);
    try {
      if (store.is_active) await deactivate.mutateAsync();
      else                  await activate.mutateAsync();
    } finally { setToggling(false); }
  };

  return (
    <div className="space-y-5">
      {/* Identity */}
      <SectionCard
        title="Store Identity"
        icon={Store}
        action={
          !editing ? (
            <Button variant="outline" size="sm" onClick={startEdit} className="gap-1.5 h-7 text-xs">
              <Pencil className="h-3 w-3" /> Edit
            </Button>
          ) : (
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={cancelEdit} className="h-7 text-xs">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={update.isPending || !form.store_name?.trim()}
                className="h-7 gap-1.5 text-xs"
              >
                {update.isPending
                  ? <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
                  : <><Save className="h-3 w-3" />Save</>
                }
              </Button>
            </div>
          )
        }
      >
        {!editing ? (
          <div className="space-y-0">
            <InfoRow icon={Hash}    label="Store ID">{store.id}</InfoRow>
            <InfoRow icon={Store}   label="Name">{store.store_name}</InfoRow>
            <InfoRow icon={MapPin}  label="Address">{store.address}</InfoRow>
            <InfoRow icon={MapPin}  label="City">{store.city}</InfoRow>
            <InfoRow icon={MapPin}  label="State">{store.state}</InfoRow>
            <InfoRow icon={Globe}   label="Country">{store.country}</InfoRow>
            <InfoRow icon={Phone}   label="Phone">{store.phone}</InfoRow>
            <InfoRow icon={Mail}    label="Email">{store.email}</InfoRow>
            <InfoRow icon={DollarSign} label="Currency">{store.currency}</InfoRow>
            <InfoRow icon={Clock}   label="Timezone">{store.timezone}</InfoRow>
            <InfoRow icon={Percent} label="Tax Rate">
              {store.tax_rate != null ? `${store.tax_rate}%` : null}
            </InfoRow>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Store Name" required>
              <Input
                value={form.store_name}
                onChange={set("store_name")}
                required autoFocus
                className="h-9 text-sm"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <Input value={form.city} onChange={set("city")} className="h-9 text-sm" />
              </Field>
              <Field label="State">
                <Input value={form.state} onChange={set("state")} className="h-9 text-sm" />
              </Field>
            </div>
            <Field label="Address">
              <Input value={form.address} onChange={set("address")} className="h-9 text-sm" />
            </Field>
            <Field label="Country">
              <Input value={form.country} onChange={set("country")} className="h-9 text-sm" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <Input value={form.phone} onChange={set("phone")} className="h-9 text-sm" />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={set("email")} className="h-9 text-sm" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Currency">
                <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}
      </SectionCard>

      {/* Timestamps */}
      <SectionCard title="Record Info" icon={Calendar}>
        <div className="space-y-0">
          <InfoRow icon={Calendar} label="Created">
            {store.created_at ? formatDateTime(store.created_at) : null}
          </InfoRow>
          <InfoRow icon={Clock} label="Last Updated">
            {store.updated_at ? formatDateTime(store.updated_at) : null}
          </InfoRow>
        </div>
      </SectionCard>

      {/* Status toggle */}
      <SectionCard title="Store Status" icon={Power}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {store.is_active ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <p className={cn(
                "text-sm font-semibold",
                store.is_active ? "text-success" : "text-destructive",
              )}>
                {store.is_active ? "Store is Active" : "Store is Inactive"}
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {store.is_active
                ? "This store is operational. Staff can log in and process sales."
                : "This store is deactivated. Staff cannot access it until reactivated."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={toggling}
            onClick={handleToggle}
            className={cn(
              "gap-1.5 shrink-0",
              store.is_active
                ? "border-destructive/30 text-destructive hover:bg-destructive/10"
                : "border-success/30 text-success hover:bg-success/10",
            )}
          >
            {toggling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : store.is_active ? (
              <PowerOff className="h-3.5 w-3.5" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )}
            {store.is_active ? "Deactivate Store" : "Activate Store"}
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

// ─── Tab: Team ────────────────────────────────────────────────────────────────

function TeamTab({ storeId }) {
  const { users, isLoading, error, refetch } = useStoreUsers(storeId);

  return (
    <div className="space-y-5">
      <SectionCard
        title="Team Members"
        icon={Users}
        action={
          <Button
            variant="ghost" size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="h-7 gap-1.5 text-[11px] text-muted-foreground"
          >
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
            Refresh
          </Button>
        }
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-sm font-semibold text-destructive">Failed to load team</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 text-xs">
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/30 border border-border">
              <Users className="h-5 w-5 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-semibold text-muted-foreground">No users assigned</p>
            <p className="text-[11px] text-muted-foreground">
              Assign users to this store from the Users management page.
            </p>
          </div>
        ) : (
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border/60 bg-muted/10">
                  <th className="pl-5 pr-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[220px]">
                    User
                  </th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[130px]">
                    Role
                  </th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[160px]">
                    Last Login
                  </th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[90px]">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {users.map((u) => {
                  const rc       = getRoleConfig(u.role_slug);
                  const fullName = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username;
                  const initials = fullName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

                  return (
                    <tr key={u.id} className="hover:bg-muted/10 transition-colors">
                      <td className="pl-5 pr-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold",
                            rc.avatar,
                          )}>
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-foreground truncate">{fullName}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          rc.badge,
                        )}>
                          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", rc.dot)} />
                          {u.role_name}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[11px] text-muted-foreground tabular-nums">
                        {u.last_login
                          ? formatDateTime(u.last_login)
                          : <span className="italic text-muted-foreground/40">Never</span>
                        }
                      </td>
                      <td className="px-3 py-3">
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          u.is_active
                            ? "bg-success/10 text-success border-success/20"
                            : "bg-destructive/10 text-destructive border-destructive/20",
                        )}>
                          <span className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            u.is_active ? "bg-success" : "bg-destructive/60",
                          )} />
                          {u.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {users.length > 0 && (
          <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t border-border/40">
            {users.length} team member{users.length !== 1 ? "s" : ""} assigned to this store.
            Manage users from the <strong>Users</strong> page.
          </p>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Tab: Configuration ───────────────────────────────────────────────────────

function ConfigTab({ store, update }) {
  const [form, setForm] = useState({
    tax_rate:       store.tax_rate != null ? String(store.tax_rate) : "",
    receipt_footer: store.receipt_footer ?? "",
    logo_data:      store.logo_data ?? "",
  });
  const [saved, setSaved]   = useState(false);
  const logoInputRef         = useRef(null);

  const set = (k) => (e) => setForm((f) => ({
    ...f,
    [k]: typeof e === "string" ? e : e.target.value,
  }));

  const handleLogoFile = (file) => {
    if (!file) return;
    if (file.size > 500 * 1024) {
      alert("Logo must be under 500 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => setForm((f) => ({ ...f, logo_data: e.target.result }));
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    await update.mutateAsync({
      id:             store.id,
      tax_rate:       form.tax_rate !== "" ? parseFloat(form.tax_rate) : null,
      receipt_footer: form.receipt_footer.trim() || null,
      logo_data:      form.logo_data || null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-5">
      {/* Tax & receipt */}
      <SectionCard title="Sales Configuration" icon={Percent}>
        <div className="space-y-4">
          <Field
            label="Default Tax Rate (%)"
            hint="Applied to all taxable items in this store."
          >
            <Input
              type="number" min="0" max="100" step="0.01"
              value={form.tax_rate}
              onChange={set("tax_rate")}
              placeholder="e.g. 7.5"
              className="h-9 text-sm"
            />
          </Field>

          <Field
            label="Receipt Footer Text"
            hint="Printed at the bottom of every receipt."
          >
            <textarea
              value={form.receipt_footer}
              onChange={set("receipt_footer")}
              placeholder="Thank you for shopping with us!"
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </Field>
        </div>
      </SectionCard>

      {/* Logo */}
      <SectionCard title="Store Logo" icon={ReceiptText}>
        <div className="space-y-4">
          <p className="text-[11px] text-muted-foreground">
            PNG or JPG, max 500 KB. Displayed on receipts when "Show Logo" is enabled in Receipt Settings.
          </p>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => handleLogoFile(e.target.files?.[0])}
          />
          {form.logo_data ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/10 p-3">
              <img
                src={form.logo_data}
                alt="Store logo"
                className="h-14 w-14 rounded-lg object-contain border border-border bg-white p-1"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground">Logo uploaded</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Click × to clear</p>
              </div>
              <Button
                variant="ghost" size="sm"
                onClick={() => setForm((f) => ({ ...f, logo_data: "" }))}
                className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/10 w-full py-6 hover:border-primary/40 hover:bg-muted/30 transition-colors"
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">Click to upload logo</span>
              <span className="text-[11px] text-muted-foreground">PNG, JPG — max 500 KB</span>
            </button>
          )}
        </div>
      </SectionCard>

      {/* Save bar */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3.5">
        {saved ? (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> Configuration saved
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Changes apply immediately after saving.</p>
        )}
        <Button
          size="sm"
          disabled={update.isPending}
          onClick={handleSave}
          className="gap-1.5 px-5"
        >
          {update.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
            : <><Save className="h-3.5 w-3.5" />Save Configuration</>
          }
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",       label: "Overview",       icon: Store },
  { id: "team",           label: "Team",           icon: Users },
  { id: "configuration",  label: "Configuration",  icon: Percent },
];

export default function StoreDetailPage() {
  const { id }        = useParams();
  const navigate      = useNavigate();
  const storeId       = parseInt(id, 10);
  const activeStoreId = useBranchStore((s) => s.activeStore?.id);

  const [activeTab, setActiveTab] = useState("overview");

  const {
    store, isLoading, error, refetch,
    update, activate, deactivate,
  } = useStore(storeId);

  const code = store
    ? (store.store_name ?? "ST").replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "ST"
    : "ST";

  const isThisActive = store?.id === activeStoreId;

  // ── States ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading store…
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <div>
          <p className="text-sm font-semibold text-destructive">Store not found</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {typeof error === "string" ? error : (error?.message ?? "The store may have been deleted.")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/stores")} className="gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Stores
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-border bg-card/50 shrink-0">
        {/* Breadcrumb */}
        <button
          onClick={() => navigate("/stores")}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-3 w-3" />
          All Stores
        </button>

        {/* Store identity hero */}
        <div className="flex items-start gap-4">
          <div className={cn(
            "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border text-[16px] font-bold",
            isThisActive
              ? "border-primary/30 bg-primary/15 text-primary"
              : "border-border bg-muted/30 text-muted-foreground",
          )}>
            {code}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[18px] font-bold text-foreground">{store.store_name}</h1>
              {isThisActive && (
                <span className="rounded-full bg-primary/15 text-primary text-[10px] font-bold px-2 py-0.5">
                  CURRENT STORE
                </span>
              )}
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                store.is_active
                  ? "bg-success/10 text-success border-success/20"
                  : "bg-destructive/10 text-destructive border-destructive/20",
              )}>
                <span className={cn("h-1.5 w-1.5 rounded-full", store.is_active ? "bg-success" : "bg-destructive/60")} />
                {store.is_active ? "Active" : "Inactive"}
              </span>
            </div>

            <div className="flex items-center gap-4 mt-1.5 flex-wrap">
              {(store.city || store.state) && (
                <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {[store.city, store.state].filter(Boolean).join(", ")}
                </span>
              )}
              {store.currency && (
                <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                  <DollarSign className="h-3 w-3 shrink-0" />
                  {store.currency}
                </span>
              )}
              {store.phone && (
                <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                  <Phone className="h-3 w-3 shrink-0" />
                  {store.phone}
                </span>
              )}
              {store.email && (
                <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                  <Mail className="h-3 w-3 shrink-0" />
                  {store.email}
                </span>
              )}
            </div>
          </div>

          <Button
            variant="ghost" size="sm"
            onClick={() => refetch()}
            className="shrink-0 gap-1.5 text-[11px] text-muted-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-0.5 mt-5 -mb-5 pb-px">
          {TABS.map((tab) => {
            const Icon     = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium rounded-t-lg border-b-2 transition-all",
                  isActive
                    ? "border-primary text-primary bg-primary/5"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto min-h-0">
        <div className="mx-auto max-w-3xl px-6 py-5">
          {activeTab === "overview"      && (
            <OverviewTab store={store} update={update} activate={activate} deactivate={deactivate} />
          )}
          {activeTab === "team"          && <TeamTab storeId={storeId} />}
          {activeTab === "configuration" && <ConfigTab store={store} update={update} />}
        </div>
      </div>
    </div>
  );
}
