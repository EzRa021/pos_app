// pages/SuppliersPage.jsx
import { useState } from "react";
import { Truck, Banknote } from "lucide-react";
import { SuppliersPanel }        from "@/features/suppliers/SuppliersPanel";
import { SupplierPaymentsPanel } from "@/features/supplier_payments/SupplierPaymentsPanel";
import { PageHeader }            from "@/components/shared/PageHeader";
import { cn }                    from "@/lib/utils";

const TABS = [
  { id: "suppliers", label: "Suppliers",     icon: Truck    },
  { id: "payments",  label: "Payments",      icon: Banknote },
];

export default function SuppliersPage() {
  const [tab, setTab] = useState("suppliers");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Tab bar — sits between the page chrome and the panel content */}
      <div className="flex items-center gap-1 border-b border-border px-6 bg-card/60 shrink-0">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-semibold border-b-2 -mb-px transition-colors",
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Panel content — each panel owns its own PageHeader */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {tab === "suppliers" && <SuppliersPanel />}
        {tab === "payments"  && (
          <div className="flex-1 overflow-auto">
            <div className="mx-auto max-w-5xl px-6 py-5">
              <div className="mb-5">
                <h1 className="text-[15px] font-bold text-foreground">Supplier Payments</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Outstanding balances, payment history, and record payments across all suppliers.
                </p>
              </div>
              <SupplierPaymentsPanel />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
