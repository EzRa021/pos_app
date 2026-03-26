// ============================================================================
// CompleteStep — final screen shown after business is set up
// ============================================================================

import { CheckCircle2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CompleteStep({ businessName, onEnter }) {
  return (
    <div className="flex flex-col items-center gap-6 text-center py-2">
      {/* Success icon */}
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15 border border-green-500/30">
        <CheckCircle2 className="h-8 w-8 text-green-400" />
      </div>

      {/* Message */}
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-bold text-foreground">You're all set!</h2>
        {businessName && (
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{businessName}</span> has been configured on this device.
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          Your Business ID is saved in{' '}
          <span className="text-foreground font-medium">Settings → Business Profile</span>.
          Keep it safe — you'll need it to link additional terminals.
        </p>
      </div>

      {/* CTA */}
      <Button onClick={onEnter} className="w-full h-10 mt-1">
        <ArrowRight className="h-4 w-4" />
        Enter Quantum POS
      </Button>

      <p className="text-[11px] text-muted-foreground">
        Quantum POS © {new Date().getFullYear()}
      </p>
    </div>
  );
}
