// ============================================================================
// SyncStatusBadge — business name + sync status indicator for the title bar
// ============================================================================
// Shows the business name when configured, or a "No Business" gray badge
// when onboarding hasn't been completed yet.
//
// Uses the shared useBusinessInfo hook — no duplicate network calls since
// React Query deduplicates requests with the same query key.
// ============================================================================

import { useBusinessInfo } from '@/hooks/useBusinessInfo';
import { cn }              from '@/lib/utils';

function Badge({ color, label }) {
  const ring = {
    green: 'bg-green-950  text-green-400  border border-green-800',
    gray:  'bg-zinc-800   text-zinc-400   border border-zinc-700',
  }[color];

  const dot = {
    green: 'bg-green-400 animate-pulse',
    gray:  'bg-zinc-500',
  }[color];

  return (
    <div className={cn('hidden sm:flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full', ring)}>
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dot)} />
      <span className="truncate max-w-[120px]">{label}</span>
    </div>
  );
}

// SyncStatusBadge reads from the shared useBusinessInfo cache.
// No separate polling here — useBusinessInfo owns the refetch strategy.
export function SyncStatusBadge() {
  const { business, name, isLoading } = useBusinessInfo();

  // Don't render during initial load — avoids a flash of "No Business"
  // on every app start while the query is in flight.
  if (isLoading) return null;

  if (!business) {
    return <Badge color="gray" label="No Business" />;
  }

  return <Badge color="green" label={name} />;
}
