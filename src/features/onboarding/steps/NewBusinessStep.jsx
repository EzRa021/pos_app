// ============================================================================
// NewBusinessStep — collect business profile and create it
// ============================================================================

import { useState } from 'react';
import { Loader2, ChevronLeft, Building2 } from 'lucide-react';
import { Button }    from '@/components/ui/button';
import { Input }     from '@/components/ui/input';
import { rpc }       from '@/lib/apiClient';
import { BUSINESS_TYPES, CURRENCIES, TIMEZONES } from '../constants';

export function NewBusinessStep({ onSuccess, onBack }) {
  const [form, setForm] = useState({
    name:          '',
    business_type: 'retail',
    email:         '',
    phone:         '',
    currency:      'NGN',
    timezone:      'Africa/Lagos',
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }));
    setError('');
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      setError('Business name is required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await rpc('create_business', form);
      onSuccess(result.name, result.id);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Failed to create business. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="text-sm font-bold text-foreground">New Business</h2>
          <p className="text-xs text-muted-foreground">Tell us about your business</p>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Form */}
      <div className="flex flex-col gap-4">
        {/* Business name */}
        <div>
          <label className="block text-xs font-medium text-foreground mb-1.5">
            Business Name <span className="text-destructive">*</span>
          </label>
          <Input
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. Chidi's Superstore"
            autoFocus
          />
        </div>

        {/* Business type */}
        <div>
          <label className="block text-xs font-medium text-foreground mb-1.5">Business Type</label>
          <select
            value={form.business_type}
            onChange={e => set('business_type', e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {BUSINESS_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Currency + Timezone side by side */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Currency</label>
            <select
              value={form.currency}
              onChange={e => set('currency', e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {CURRENCIES.map(c => (
                <option key={c.value} value={c.value}>{c.value}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Timezone</label>
            <select
              value={form.timezone}
              onChange={e => set('timezone', e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {TIMEZONES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-medium text-foreground mb-1.5">
            Email <span className="text-muted-foreground">(optional)</span>
          </label>
          <Input
            type="email"
            value={form.email}
            onChange={e => set('email', e.target.value)}
            placeholder="business@example.com"
          />
        </div>

        {/* Phone */}
        <div>
          <label className="block text-xs font-medium text-foreground mb-1.5">
            Phone <span className="text-muted-foreground">(optional)</span>
          </label>
          <Input
            type="tel"
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
            placeholder="+234 800 000 0000"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full h-10"
      >
        {loading
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating Business…</>
          : <><Building2 className="h-4 w-4" /> Create Business</>
        }
      </Button>
    </div>
  );
}
