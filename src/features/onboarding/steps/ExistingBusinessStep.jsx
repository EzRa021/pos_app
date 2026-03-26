// ============================================================================
// ExistingBusinessStep — link to a business already set up on this machine
// ============================================================================

import { useState } from 'react';
import { Loader2, ChevronLeft, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import { rpc }    from '@/lib/apiClient';

// Basic UUID format check (does not hit the server)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ExistingBusinessStep({ onSuccess, onBack }) {
  const [businessId, setBusinessId] = useState('');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  async function handleLink() {
    const trimmed = businessId.trim();
    if (!trimmed) {
      setError('Please enter your Business ID.');
      return;
    }
    if (!UUID_RE.test(trimmed)) {
      setError('That doesn\'t look like a valid Business ID. It should be a UUID like: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await rpc('link_existing_business', { business_id: trimmed });
      onSuccess(result.name);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Could not link this Business ID. Make sure it was set up on this device.');
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
          <h2 className="text-sm font-bold text-foreground">Link Existing Business</h2>
          <p className="text-xs text-muted-foreground">Enter your Business ID to continue</p>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Info callout */}
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your Business ID is the UUID shown in{' '}
          <span className="text-foreground font-medium">Settings → Business Profile</span>{' '}
          on the original device.
        </p>
      </div>

      {/* Input */}
      <div>
        <label className="block text-xs font-medium text-foreground mb-1.5">
          Business ID
        </label>
        <Input
          value={businessId}
          onChange={e => { setBusinessId(e.target.value); setError(''); }}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          className="font-mono text-xs"
          autoFocus
        />
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Paste the UUID exactly as shown — it's case-insensitive.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Submit */}
      <Button
        onClick={handleLink}
        disabled={loading || !businessId.trim()}
        className="w-full h-10"
      >
        {loading
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Linking…</>
          : <><Link2 className="h-4 w-4" /> Link Business</>
        }
      </Button>
    </div>
  );
}
