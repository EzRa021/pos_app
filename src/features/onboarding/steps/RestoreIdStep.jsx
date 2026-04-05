// ============================================================================
// RestoreIdStep — enter a Business ID and verify it exists in the cloud
// ============================================================================
// Calls check_business_exists against Supabase. On success, shows the
// found business name and lets the user confirm before pulling data.

import { useState } from 'react';
import { Loader2, ChevronLeft, CloudDownload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import { checkBusinessExists } from '@/commands/onboarding';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function RestoreIdStep({ onVerified, onBack }) {
  const [businessId, setBusinessId]   = useState('');
  const [loading,    setLoading]      = useState(false);
  const [error,      setError]        = useState('');
  const [found,      setFound]        = useState(null); // { name } when verified

  async function handleCheck() {
    const trimmed = businessId.trim();
    if (!trimmed) {
      setError('Please enter your Business ID.');
      return;
    }
    if (!UUID_RE.test(trimmed)) {
      setError("That doesn't look like a valid Business ID (UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).");
      return;
    }
    setLoading(true);
    setError('');
    setFound(null);
    try {
      const result = await checkBusinessExists(trimmed);
      if (result.exists) {
        setFound({ name: result.name ?? 'Unknown Business' });
      } else {
        setError('No business found with that ID in the cloud. Please double-check and try again.');
      }
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e?.message ?? '');
      if (msg.includes('not connected') || msg.includes('Cloud sync')) {
        setError('Cloud sync is not connected. Make sure Supabase credentials are configured in Settings → Cloud Sync, then try again.');
      } else {
        setError(msg || 'Could not reach the cloud database. Check your internet connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleRestore() {
    if (found) {
      onVerified(found.name, businessId.trim());
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
          <h2 className="text-sm font-bold text-foreground">Restore from Cloud</h2>
          <p className="text-xs text-muted-foreground">Enter your Business ID to pull data</p>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Info callout */}
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your Business ID is shown in{' '}
          <span className="text-foreground font-medium">Settings → Business Profile</span>{' '}
          on any device already linked to your business.
        </p>
      </div>

      {/* Input */}
      <div>
        <label className="block text-xs font-medium text-foreground mb-1.5">
          Business ID
        </label>
        <Input
          value={businessId}
          onChange={e => { setBusinessId(e.target.value); setError(''); setFound(null); }}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          className="font-mono text-xs"
          autoFocus
          onKeyDown={e => e.key === 'Enter' && !found && handleCheck()}
        />
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Paste the UUID exactly as shown — it's case-insensitive.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Found confirmation */}
      {found && (
        <div className="flex items-start gap-3 rounded-xl border border-success/25 bg-success/[0.06] px-4 py-3.5">
          <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-success">Business found!</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="text-foreground font-medium">{found.name}</span> — ready to restore.
              This will pull stores, items, customers, and more onto this device.
            </p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!found ? (
        <Button
          onClick={handleCheck}
          disabled={loading || !businessId.trim()}
          className="w-full h-10"
        >
          {loading
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking…</>
            : <><CloudDownload className="h-4 w-4" /> Check Cloud</>
          }
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 h-10"
            onClick={() => { setFound(null); setBusinessId(''); }}
          >
            Try a different ID
          </Button>
          <Button
            className="flex-1 h-10 bg-success hover:bg-success/90 text-white"
            onClick={handleRestore}
          >
            <CloudDownload className="h-4 w-4" />
            Restore Data
          </Button>
        </div>
      )}
    </div>
  );
}
