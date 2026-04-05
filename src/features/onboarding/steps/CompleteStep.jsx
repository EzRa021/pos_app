// ============================================================================
// CompleteStep — final screen shown after business setup
// ============================================================================
// For new businesses: shows the Business ID prominently with a "save this" warning.
// For restored businesses: confirms the link without re-displaying the ID.

import { useState } from 'react';
import { CheckCircle2, ArrowRight, Copy, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CompleteStep({ businessName, businessId, isNewBusiness, onEnter }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!businessId) return;
    navigator.clipboard.writeText(businessId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center py-2">
      {/* Success icon */}
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15 border border-success/30">
        <CheckCircle2 className="h-8 w-8 text-success" />
      </div>

      {/* Message */}
      <div className="flex flex-col gap-1.5 w-full">
        <h2 className="text-base font-bold text-foreground">You're all set!</h2>
        {businessName && (
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{businessName}</span>{' '}
            {isNewBusiness ? 'has been created on this device.' : 'has been restored on this device.'}
          </p>
        )}
      </div>

      {/* Business ID — shown prominently for new businesses */}
      {isNewBusiness && businessId && (
        <div className="w-full rounded-xl border border-warning/30 bg-warning/[0.06] p-4 text-left space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
            <p className="text-[11px] text-warning font-semibold">
              Save your Business ID — you'll need it to link additional terminals.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
            <code className="flex-1 text-[11px] font-mono text-foreground break-all">
              {businessId}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted hover:bg-muted/70 transition-colors"
              title="Copy to clipboard"
            >
              {copied
                ? <Check className="h-3.5 w-3.5 text-success" />
                : <Copy  className="h-3.5 w-3.5 text-muted-foreground" />
              }
            </button>
          </div>

          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Also available later in{' '}
            <span className="text-foreground font-medium">Settings → Business Profile</span>.
          </p>
        </div>
      )}

      {/* Restored — just remind them where to find the ID */}
      {!isNewBusiness && (
        <p className="text-xs text-muted-foreground">
          Your Business ID is in{' '}
          <span className="text-foreground font-medium">Settings → Business Profile</span>{' '}
          if you need it to link more terminals.
        </p>
      )}

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
