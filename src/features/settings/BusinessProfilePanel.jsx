// ============================================================================
// BusinessProfilePanel — view and edit the business profile
// ============================================================================
// Shows the Business ID (UUID), name, type, currency, timezone, and contacts.
// The Business ID is the key users need to link additional terminals.
// ============================================================================

import { useState }          from 'react';
import { useQueryClient }    from '@tanstack/react-query';
import { Copy, Check, Pencil, Save, X, Loader2, Building2, AlertCircle } from 'lucide-react';
import { Button }            from '@/components/ui/button';
import { Input }             from '@/components/ui/input';
import { rpc }               from '@/lib/apiClient';
import { useBusinessInfo }   from '@/hooks/useBusinessInfo';
import { BUSINESS_TYPES, CURRENCIES, TIMEZONES } from '@/features/onboarding/constants';
import { cn }                from '@/lib/utils';

// ── Small helper: copy to clipboard with tick feedback ────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className="flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {copied
        ? <><Check className="h-3 w-3 text-green-400" /><span className="text-green-400">Copied!</span></>
        : <><Copy className="h-3 w-3" />Copy</>
      }
    </button>
  );
}

// ── Field row ─────────────────────────────────────────────────────────────────
function InfoRow({ label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border/40 last:border-0">
      <span className="text-xs font-medium text-muted-foreground shrink-0 w-28">{label}</span>
      <span className={cn('text-xs text-foreground text-right truncate', mono && 'font-mono text-[11px]')}>
        {value || <span className="text-muted-foreground/50 italic">Not set</span>}
      </span>
    </div>
  );
}

// ── Select wrapper styled to match the rest of the app ───────────────────────
function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export function BusinessProfilePanel() {
  const queryClient = useQueryClient();
  const { business, isLoading } = useBusinessInfo();

  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [form,    setForm]    = useState({});

  function startEdit() {
    if (!business) return;
    setForm({
      name:          business.name          ?? '',
      business_type: business.business_type ?? 'retail',
      email:         business.email         ?? '',
      phone:         business.phone         ?? '',
      address:       business.address       ?? '',
      currency:      business.currency      ?? 'NGN',
      timezone:      business.timezone      ?? 'Africa/Lagos',
    });
    setError('');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError('');
  }

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleSave() {
    if (!form.name?.trim()) {
      setError('Business name is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await rpc('update_business_info', {
        name:          form.name.trim() || null,
        business_type: form.business_type || null,
        email:         form.email.trim()   || null,
        phone:         form.phone.trim()   || null,
        address:       form.address.trim() || null,
        currency:      form.currency       || null,
        timezone:      form.timezone       || null,
      });
      // Refresh sidebar, badge, and this panel
      await queryClient.invalidateQueries({ queryKey: ['business-info'] });
      setEditing(false);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2 text-xs">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading business profile…
      </div>
    );
  }

  // ── No business configured ────────────────────────────────────────────────
  if (!business) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card py-14 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted/30">
          <Building2 className="h-5 w-5 text-muted-foreground/50" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">No business configured</p>
          <p className="text-xs text-muted-foreground mt-1">
            Complete the onboarding setup to create or link a business.
          </p>
        </div>
      </div>
    );
  }

  const typeLabel = BUSINESS_TYPES.find(t => t.value === business.business_type)?.label
    ?? business.business_type;

  // ── View mode ─────────────────────────────────────────────────────────────
  if (!editing) {
    return (
      <div className="flex flex-col gap-5">
        {/* Business ID card — most important, shown first */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <p className="text-xs font-bold text-primary uppercase tracking-wider">Business ID</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Share this with other terminals to link them to this business.
              </p>
            </div>
            <CopyButton text={business.id} />
          </div>
          <p className="font-mono text-[12px] text-foreground/80 bg-background/50 rounded-md border border-border/50 px-3 py-2 mt-2 break-all select-all">
            {business.id}
          </p>
        </div>

        {/* Profile details */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-foreground uppercase tracking-wider">Profile</p>
            <Button size="sm" variant="outline" onClick={startEdit} className="gap-1.5 h-7 text-xs">
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
          </div>
          <InfoRow label="Business Name"  value={business.name} />
          <InfoRow label="Type"           value={typeLabel} />
          <InfoRow label="Currency"       value={business.currency} />
          <InfoRow label="Timezone"       value={business.timezone} />
          <InfoRow label="Email"          value={business.email} />
          <InfoRow label="Phone"          value={business.phone} />
          <InfoRow label="Address"        value={business.address} />
        </div>
      </div>
    );
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-bold text-foreground uppercase tracking-wider">Edit Profile</p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving} className="gap-1.5 h-7 text-xs">
              <X className="h-3 w-3" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5 h-7 text-xs">
              {saving
                ? <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
                : <><Save className="h-3 w-3" />Save</>
              }
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">
              Business Name <span className="text-destructive">*</span>
            </label>
            <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Chidi's Superstore" />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Business Type</label>
            <Select value={form.business_type} onChange={v => set('business_type', v)} options={BUSINESS_TYPES} />
          </div>

          {/* Currency + Timezone */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Currency</label>
              <Select value={form.currency} onChange={v => set('currency', v)} options={CURRENCIES} />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Timezone</label>
              <Select value={form.timezone} onChange={v => set('timezone', v)} options={TIMEZONES} />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Email</label>
            <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="business@example.com" />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Phone</label>
            <Input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+234 800 000 0000" />
          </div>

          {/* Address */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Address</label>
            <Input value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Main Street, Lagos" />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
