// ============================================================================
// features/settings/SettingsSection.jsx
// ============================================================================
// Resolves /settings/:section to its panel.
//
// Keeping the registry here (rather than 22 imports in router.jsx) means the
// route table stays a single entry and everything Settings knows about itself
// lives in this folder.
//
// Also re-checks `roles` from settingsNav: hiding a section from the sidebar is
// not access control on its own — a manager typing /settings/cloud-sync must
// still be refused.
// ============================================================================
import { useParams, Navigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

import { useAuthStore } from "@/stores/auth.store";
import {
  getSettingsItem,
  canSeeSettingsItem,
  SETTINGS_ITEMS,
} from "@/features/settings/settingsNav";

import { BusinessProfilePanel }      from "@/features/settings/BusinessProfilePanel";
import { StoresManagementPanel }     from "@/features/settings/StoresManagementPanel";
import { OpeningHoursPanel }         from "@/features/settings/OpeningHoursPanel";
import { TaxSettingsPanel }          from "@/features/settings/TaxSettingsPanel";
import { PaymentMethodsPanel }       from "@/features/settings/PaymentMethodsPanel";
import { ExpenseCategoriesPanel }    from "@/features/settings/ExpenseCategoriesPanel";
import { InvoiceNumberingPanel }     from "@/features/settings/InvoiceNumberingPanel";
import { PosShortcutsPanel }         from "@/features/settings/PosShortcutsPanel";
import { StoreSettingsPanel }        from "@/features/settings/StoreSettingsPanel";
import { ReceiptSettingsPanel }      from "@/features/settings/ReceiptSettingsPanel";
import { LabelSettingsPanel }        from "@/features/labels/LabelSettingsPanel";
import { PrinterSettingsPanel }      from "@/features/settings/PrinterSettingsPanel";
import { LoyaltySettingsPanel }      from "@/features/settings/LoyaltySettingsPanel";
import { LowStockDefaultsPanel }     from "@/features/settings/LowStockDefaultsPanel";
import { NotificationPrefsPanel }    from "@/features/settings/NotificationPrefsPanel";
import { AppearancePanel }           from "@/features/settings/AppearancePanel";
import { SecuritySettingsPanel }     from "@/features/settings/SecuritySettingsPanel";
import { ConnectionSettingsPanel }   from "@/features/settings/ConnectionSettingsPanel";
import { UpdatesPanel }              from "@/features/settings/UpdatesPanel";
import { CloudSyncPanel }            from "@/features/settings/CloudSyncPanel";
import { BackupPanel }               from "@/features/settings/BackupPanel";
import { ImportExportSettingsPanel } from "@/features/settings/ImportExportSettingsPanel";

const PANELS = {
  "business":            BusinessProfilePanel,
  "stores":              StoresManagementPanel,
  "opening-hours":       OpeningHoursPanel,
  "tax":                 TaxSettingsPanel,
  "payment-methods":     PaymentMethodsPanel,
  "expense-categories":  ExpenseCategoriesPanel,
  "numbering":           InvoiceNumberingPanel,
  "pos-shortcuts":       PosShortcutsPanel,
  "business-rules":      StoreSettingsPanel,
  "receipt":             ReceiptSettingsPanel,
  "labels":              LabelSettingsPanel,
  "printer":             PrinterSettingsPanel,
  "loyalty":             LoyaltySettingsPanel,
  "low-stock-defaults":  LowStockDefaultsPanel,
  "notification-prefs":  NotificationPrefsPanel,
  "appearance":          AppearancePanel,
  "security":            SecuritySettingsPanel,
  "connection":          ConnectionSettingsPanel,
  "updates":             UpdatesPanel,
  "cloud-sync":          CloudSyncPanel,
  "backup":              BackupPanel,
  "import-export":       ImportExportSettingsPanel,
};

// Fail loudly in dev if the nav and the registry drift apart.
if (import.meta.env.DEV) {
  const missing = SETTINGS_ITEMS.filter((i) => !PANELS[i.id]).map((i) => i.id);
  if (missing.length) {
    console.error("[settings] nav entries with no panel:", missing.join(", "));
  }
}

export default function SettingsSection() {
  const { section } = useParams();
  const roleSlug    = useAuthStore((s) => s.user?.role_slug);

  const item  = getSettingsItem(section);
  const Panel = PANELS[section];

  // Unknown section → first section, rather than a dead page.
  if (!item || !Panel) return <Navigate to="/settings/business" replace />;

  if (!canSeeSettingsItem(item, roleSlug)) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/30">
          <ShieldAlert className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            {item.label} is restricted
          </p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground leading-relaxed">
            Your role (
            <span className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              {roleSlug ?? "unknown"}
            </span>
            ) can&apos;t change these settings. Ask an administrator.
          </p>
        </div>
      </div>
    );
  }

  return <Panel />;
}
