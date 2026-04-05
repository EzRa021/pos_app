// ============================================================================
// hooks/useCurrencySetup.js
// ============================================================================
// Reads the active store's currency from store_settings (per-store) and
// pushes it into format.js's module-level config so that formatCurrency()
// uses the correct currency everywhere — without any per-call changes.
//
// Falls back to the business-level currency from get_business_info if the
// store settings don't have one configured yet.
//
// Call this hook ONCE, inside AppShell (after login, before any page renders).
// It re-runs automatically when the active store changes.
// ============================================================================

import { useEffect }         from "react";
import { useQuery }          from "@tanstack/react-query";
import { useBranchStore }    from "@/stores/branch.store";
import { getStoreSettings }  from "@/commands/store_settings";
import { useBusinessInfo }   from "@/hooks/useBusinessInfo";
import { setCurrencyConfig } from "@/lib/format";

export function useCurrencySetup() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const { currency: bizCurrency } = useBusinessInfo();

  const { data: settings } = useQuery({
    queryKey: ["store-settings", storeId],
    queryFn:  () => getStoreSettings(storeId),
    enabled:  !!storeId,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    // Prefer per-store currency; fall back to business-level.
    const currency = settings?.currency || bizCurrency || "NGN";
    const locale   = settings?.locale   || undefined;
    setCurrencyConfig({ currency, locale });
  }, [settings?.currency, settings?.locale, bizCurrency]);
}
