// ============================================================================
// pages/SettingsPage.jsx
// ============================================================================
import { useState } from "react";
import {
  Receipt, Store, Tag, Shield, ChevronRight,
  SlidersHorizontal, Star, Download, KeyRound, Barcode, FileSpreadsheet,
  Building2, Printer,
} from "lucide-react";

import { PageHeader }                    from "@/components/shared/PageHeader";
import { ReceiptSettingsPanel }          from "@/features/settings/ReceiptSettingsPanel";
import { StoreSettingsPanel }            from "@/features/settings/StoreSettingsPanel";
import { LoyaltySettingsPanel }          from "@/features/settings/LoyaltySettingsPanel";
import { SecuritySettingsPanel }         from "@/features/settings/SecuritySettingsPanel";
import { BackupPanel }                   from "@/features/settings/BackupPanel";
import { ImportExportSettingsPanel }     from "@/features/settings/ImportExportSettingsPanel";
import { LabelSettingsPanel }            from "@/features/labels/LabelSettingsPanel";
import { BusinessProfilePanel }         from "@/features/settings/BusinessProfilePanel";
import { PrinterSettingsPanel }         from "@/features/settings/PrinterSettingsPanel";
import { useBranchStore }        from "@/stores/branch.store";
import { cn }                    from "@/lib/utils";

const SETTINGS_TABS = [
  {
    id:          "business",
    label:       "Business Profile",
    icon:        Building2,
    description: "Business name, ID, currency, and contact details",
    available:   true,
  },
  {
    id:          "receipt",
    label:       "Receipt",
    icon:        Receipt,
    description: "Branding, layout, QR code and print options",
    available:   true,
  },
  {
    id:          "labels",
    label:       "Labels",
    icon:        Barcode,
    description: "Barcode label format, content and template",
    available:   true,
  },
  {
    id:          "business-rules",
    label:       "Business Rules",
    icon:        SlidersHorizontal,
    description: "Pricing, void, credit, and discount enforcement",
    available:   true,
  },
  {
    id:          "loyalty",
    label:       "Loyalty",
    icon:        Star,
    description: "Points earn rate and redemption settings",
    available:   true,
  },
  {
    id:          "security",
    label:       "Security",
    icon:        Shield,
    description: "POS PIN lock and active session management",
    available:   true,
  },
  {
    id:          "backup",
    label:       "Backup & Export",
    icon:        Download,
    description: "Database backup, restore, and data export",
    available:   true,
  },
  {
    id:          "import-export",
    label:       "Import / Export",
    icon:        FileSpreadsheet,
    description: "Excel export folder and import settings",
    available:   true,
  },
  {
    id:          "printer",
    label:       "Printer",
    icon:        Printer,
    description: "ESC/POS receipt and label printer selection",
    available:   true,
  },
  {
    id:          "store",
    label:       "Store Info",
    icon:        Store,
    description: "Store name, address and contact details",
    available:   false,
  },
  {
    id:          "tax",
    label:       "Tax",
    icon:        Tag,
    description: "Tax categories and rate configuration",
    available:   false,
  },
];

function SettingsNavItem({ tab, isActive, onClick }) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      onClick={() => tab.available && onClick(tab.id)}
      className={cn(
        "group w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        isActive
          ? "bg-primary/10 text-primary"
          : tab.available
          ? "text-foreground hover:bg-muted/50"
          : "text-muted-foreground/40 cursor-not-allowed",
      )}
    >
      <div className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
        isActive
          ? "border-primary/30 bg-primary/10"
          : tab.available
          ? "border-border bg-muted/30"
          : "border-border/40 bg-transparent",
      )}>
        <Icon className={cn(
          "h-4 w-4",
          isActive ? "text-primary" : tab.available ? "text-muted-foreground" : "text-muted-foreground/30",
        )} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-[13px] font-semibold leading-none",
            isActive ? "text-primary" : tab.available ? "text-foreground" : "text-muted-foreground/40",
          )}>
            {tab.label}
          </span>
          {!tab.available && (
            <span className="rounded-full border border-border/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40">
              Soon
            </span>
          )}
        </div>
        <p className={cn(
          "text-[11px] mt-0.5 leading-tight",
          isActive ? "text-primary/70" : "text-muted-foreground",
          !tab.available && "opacity-40",
        )}>
          {tab.description}
        </p>
      </div>

      {isActive && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-primary/50" />}
    </button>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("business");
  const activeStore = useBranchStore((s) => s.activeStore);

  const renderContent = () => {
    switch (activeTab) {
      case "business":       return <BusinessProfilePanel />;
      case "receipt":        return <ReceiptSettingsPanel />;
      case "labels":         return <LabelSettingsPanel />;
      case "business-rules": return <StoreSettingsPanel />;
      case "loyalty":        return <LoyaltySettingsPanel />;
      case "security":       return <SecuritySettingsPanel />;
      case "backup":         return <BackupPanel />;
      case "import-export":   return <ImportExportSettingsPanel />;
      case "printer":          return <PrinterSettingsPanel />;
      default: {
        const tab  = SETTINGS_TABS.find((t) => t.id === activeTab);
        const Icon = tab?.icon;
        return (
          <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card py-16 text-center">
            {Icon && (
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/30">
                <Icon className="h-6 w-6 text-muted-foreground/50" />
              </div>
            )}
            <div>
              <p className="text-sm font-semibold text-foreground">{tab?.label} settings coming soon</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                This section is under development. Check back in the next update.
              </p>
            </div>
          </div>
        );
      }
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Settings"
        description={`Configure store defaults for ${activeStore?.store_name ?? "your store"}.`}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="flex gap-6 items-start">

            {/* Left sidebar nav */}
            <div className="w-52 shrink-0 rounded-xl border border-border bg-card p-2 space-y-0.5 sticky top-0">
              <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                Configuration
              </p>
              {SETTINGS_TABS.map((tab) => (
                <SettingsNavItem
                  key={tab.id}
                  tab={tab}
                  isActive={activeTab === tab.id}
                  onClick={setActiveTab}
                />
              ))}
            </div>

            {/* Main content */}
            <div className="flex-1 min-w-0">
              {(() => {
                const tab  = SETTINGS_TABS.find((t) => t.id === activeTab);
                const Icon = tab?.icon;
                return (
                  <div className="mb-5 flex items-center gap-3">
                    {Icon && (
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-muted/30">
                        <Icon className="h-4 w-4 text-foreground" />
                      </div>
                    )}
                    <div>
                      <h2 className="text-[15px] font-bold text-foreground">{tab?.label} Settings</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">{tab?.description}</p>
                    </div>
                  </div>
                );
              })()}
              {renderContent()}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
