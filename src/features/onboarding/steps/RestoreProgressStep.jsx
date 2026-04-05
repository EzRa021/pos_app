// ============================================================================
// RestoreProgressStep — pulls business data from Supabase with a progress UI
// ============================================================================
// Calls restore_business_from_cloud on mount. Shows a pulsing animation while
// the backend pulls stores, items, customers, etc. from the cloud.

import { useEffect, useState } from 'react';
import {
  Loader2, CheckCircle2, AlertTriangle, ChevronLeft,
  Building2, Store, Tag, Users, Package, UserCircle, Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { restoreBusinessFromCloud } from '@/commands/onboarding';

const TABLE_ICONS = {
  businesses:   Building2,
  stores:       Store,
  departments:  Tag,
  categories:   Tag,
  tax_categories: Tag,
  items:        Package,
  item_stock:   Package,
  customers:    UserCircle,
  suppliers:    Truck,
  users:        Users,
};

const TABLE_LABELS = {
  businesses:    'Business profile',
  stores:        'Store locations',
  departments:   'Departments',
  categories:    'Categories',
  tax_categories: 'Tax categories',
  items:         'Products',
  item_stock:    'Stock levels',
  customers:     'Customers',
  suppliers:     'Suppliers',
  users:         'Staff accounts',
};

export function RestoreProgressStep({ businessId, businessName, onSuccess, onBack }) {
  const [status,   setStatus]   = useState('running'); // 'running' | 'done' | 'error'
  const [tables,   setTables]   = useState([]);
  const [error,    setError]    = useState('');
  const [restoredName, setRestoredName] = useState(businessName);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const result = await restoreBusinessFromCloud(businessId);
        if (cancelled) return;
        setTables(result.tables ?? []);
        setRestoredName(result.name ?? businessName);
        setStatus('done');
      } catch (e) {
        if (cancelled) return;
        const msg = typeof e === 'string' ? e : (e?.message ?? 'Restore failed. Please try again.');
        setError(msg);
        setStatus('error');
      }
    }

    run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const totalRows = tables.reduce((sum, t) => sum + (t.rows ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        {status === 'error' && (
          <button
            onClick={onBack}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <div>
          <h2 className="text-sm font-bold text-foreground">
            {status === 'running' && 'Restoring from Cloud…'}
            {status === 'done'    && 'Restore Complete'}
            {status === 'error'   && 'Restore Failed'}
          </h2>
          <p className="text-xs text-muted-foreground">
            {status === 'running' && `Pulling data for ${businessName || 'your business'}…`}
            {status === 'done'    && `${totalRows} records restored across ${tables.length} tables.`}
            {status === 'error'   && 'An error occurred during the restore.'}
          </p>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Running state — progress list */}
      {status === 'running' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-center py-4">
            <div className="relative flex h-16 w-16 items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" />
              <div className="absolute inset-2 rounded-full border-2 border-primary/40 animate-ping [animation-delay:150ms]" />
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            This may take a moment depending on data size…
          </p>
        </div>
      )}

      {/* Done state — table summary */}
      {status === 'done' && (
        <>
          <div className="flex items-center justify-center py-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 border border-success/30">
              <CheckCircle2 className="h-7 w-7 text-success" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-muted/20 divide-y divide-border overflow-hidden">
            {tables.map((t) => {
              const Icon = TABLE_ICONS[t.table] ?? Package;
              const label = TABLE_LABELS[t.table] ?? t.table;
              return (
                <div key={t.table} className="flex items-center gap-3 px-4 py-2.5">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-xs text-foreground">{label}</span>
                  <span className="text-xs font-semibold tabular-nums text-success">
                    {t.rows > 0 ? `+${t.rows}` : '—'}
                  </span>
                </div>
              );
            })}
          </div>

          <Button
            className="w-full h-10 bg-success hover:bg-success/90 text-white"
            onClick={() => onSuccess(restoredName, businessId)}
          >
            <CheckCircle2 className="h-4 w-4" />
            Continue
          </Button>
        </>
      )}

      {/* Error state */}
      {status === 'error' && (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive leading-relaxed">{error}</p>
          </div>
          <Button variant="outline" className="w-full h-10" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" />
            Go Back
          </Button>
        </>
      )}
    </div>
  );
}
