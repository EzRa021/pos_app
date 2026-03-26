// ============================================================================
// hooks/useCurrencySetup.js
// ============================================================================
// Reads the business currency from the cached business profile and pushes
// it into format.js's module-level config so that formatCurrency() and
// related helpers use the correct currency everywhere in the app — without
// any per-call changes at existing call sites.
//
// Call this hook ONCE, inside AppShell (after login, before any page renders).
// It re-runs automatically when the business profile changes (e.g. after the
// user edits their currency in Settings > Business Profile).
// ============================================================================

import { useEffect }       from "react";
import { useBusinessInfo } from "@/hooks/useBusinessInfo";
import { setCurrencyConfig } from "@/lib/format";

export function useCurrencySetup() {
  const { currency, timezone } = useBusinessInfo();

  useEffect(() => {
    if (currency) {
      setCurrencyConfig({ currency });
    }
  }, [currency, timezone]);
}
