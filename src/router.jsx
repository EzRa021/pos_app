import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { AppShell }       from "@/components/layout/AppShell";
import ReturnsPage             from "@/pages/ReturnsPage";
import ReturnDetailPage        from "@/pages/ReturnDetailPage";
import PosPage                 from "@/pages/PosPage";
import TransactionsPage        from "@/pages/TransactionsPage";
import TransactionDetailPage   from "@/pages/TransactionDetailPage";
import ShiftsPage         from "@/pages/ShiftsPage";
import ShiftDetailPage    from "@/pages/ShiftDetailPage";
import CustomersPage      from "@/pages/CustomersPage";
import CustomerDetailPage from "@/pages/CustomerDetailPage";
import CreditSalesPage      from "@/pages/CreditSalesPage";
import WalletPage           from "@/pages/WalletPage";
import SuppliersPage             from "@/pages/SuppliersPage";
import SupplierDetailPage        from "@/pages/SupplierDetailPage";
import SupplierPaymentsPage      from "@/pages/SupplierPaymentsPage";
import PurchaseOrdersPage        from "@/pages/PurchaseOrdersPage";
import PurchaseOrderDetailPage   from "@/pages/PurchaseOrderDetailPage";
import CreatePurchaseOrderPage   from "@/pages/CreatePurchaseOrderPage";
import ExpensesPage              from "@/pages/ExpensesPage";
import DepartmentsPage    from "@/pages/DepartmentsPage";
import CategoriesPage     from "@/pages/CategoriesPage";
import ItemsPage          from "@/pages/ItemsPage";
import ItemDetailPage     from "@/pages/ItemDetailPage";
import InventoryPage      from "@/pages/InventoryPage";
import InventoryItemPage  from "@/pages/InventoryItemPage";
import StockCountsPage    from "@/pages/StockCountsPage";
import StockCountSessionPage from "@/pages/StockCountSessionPage";
import VarianceReportPage from "@/pages/VarianceReportPage";
import SettingsPage       from "@/pages/SettingsPage";
import StoreCreationPage  from "@/pages/StoreCreationPage";

// ── New pages ─────────────────────────────────────────────────────────────────
import AnalyticsPage              from "@/pages/AnalyticsPage";
import AnalyticsDashboardPage     from "@/pages/AnalyticsDashboardPage";
import SalesAnalyticsPage         from "@/pages/SalesAnalyticsPage";
import ProductsAnalyticsPage      from "@/pages/ProductsAnalyticsPage";
import InventoryAnalyticsPage     from "@/pages/InventoryAnalyticsPage";
import CustomersAnalyticsPage     from "@/pages/CustomersAnalyticsPage";
import ProfitabilityPage          from "@/pages/ProfitabilityPage";
import CashiersAnalyticsPage      from "@/pages/CashiersAnalyticsPage";
import EodPage                 from "@/pages/EodPage";
import StockTransfersPage      from "@/pages/StockTransfersPage";
import StockTransferDetailPage from "@/pages/StockTransferDetailPage";
import NotificationsPage       from "@/pages/NotificationsPage";
import AuditPage               from "@/pages/AuditPage";
import UsersPage               from "@/pages/UsersPage";
import PriceManagementPage     from "@/pages/PriceManagementPage";
import NotFoundPage            from "@/pages/NotFoundPage";

import { ShieldOff } from "lucide-react";
import { useAuthStore }   from "@/stores/auth.store";
import { useBranchStore } from "@/stores/branch.store";

// ── ProtectedRoute ────────────────────────────────────────────────────────────
function ProtectedRoute() {
  const user                = useAuthStore(s => s.user);
  const isInitialized       = useAuthStore(s => s.isInitialized);
  const isBranchInitialized = useBranchStore(s => s.isBranchInitialized);
  const needsPicker         = useBranchStore(s => s.needsPicker);
  const needsStoreCreation  = useBranchStore(s => s.needsStoreCreation);

  if (!isInitialized)                      return null;
  if (!user)                               return null;
  if (!isBranchInitialized || needsPicker) return null;

  // First-time user: no stores exist — force creation before anything else.
  if (needsStoreCreation && window.location.pathname !== '/store/new') {
    return <Navigate to="/store/new" replace />;
  }

  return <Outlet />;
}

// ── RequireRole ───────────────────────────────────────────────────────────────
function RequireRole({ roles }) {
  const roleSlug = useAuthStore(s => s.user?.role_slug);
  if (roles.includes(roleSlug ?? "")) return <Outlet />;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center py-20 px-4">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-destructive/25 bg-destructive/10">
        <ShieldOff className="h-9 w-9 text-destructive/70" />
      </div>
      <div className="space-y-1.5 max-w-xs">
        <p className="text-lg font-bold text-foreground">Access denied</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your role (<span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded border border-border/60">{roleSlug ?? "unknown"}</span>) does not have permission to view this page.
        </p>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <ProtectedRoute />,
    children: [
      // ── Full-page routes (no AppShell) ────────────────────────────────────
      {
        element: <RequireRole roles={["super_admin", "admin", "gm"]} />,
        children: [
          { path: "store/new", element: <StoreCreationPage /> },
        ],
      },

      // ── App shell routes ──────────────────────────────────────────────────
      {
        path: "/",
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/analytics" replace /> },

          // ── Point of Sale ─────────────────────────────────────────────────
          { path: "pos",          element: <PosPage /> },
          { path: "transactions",    element: <TransactionsPage /> },
          { path: "transactions/:id", element: <TransactionDetailPage /> },
          { path: "returns",         element: <ReturnsPage /> },
          { path: "returns/:id",    element: <ReturnDetailPage /> },
          { path: "shifts",       element: <ShiftsPage /> },
          { path: "shifts/:id",    element: <ShiftDetailPage /> },

          // ── Catalog ───────────────────────────────────────────────────────
          { path: "products",        element: <ItemsPage /> },
          { path: "products/:id",    element: <ItemDetailPage /> },
          { path: "departments",     element: <DepartmentsPage /> },
          { path: "categories",      element: <CategoriesPage /> },

          // ── Inventory ─────────────────────────────────────────────────────
          { path: "inventory",             element: <InventoryPage /> },
          { path: "inventory/:itemId",     element: <InventoryItemPage /> },
          { path: "stock-counts",          element: <StockCountsPage /> },
          { path: "stock-counts/:id",      element: <StockCountSessionPage /> },
          { path: "stock-counts/:id/report", element: <VarianceReportPage /> },
          { path: "stock-transfers",       element: <StockTransfersPage /> },
          { path: "stock-transfers/:id",   element: <StockTransferDetailPage /> },

          // ── Suppliers / POs ───────────────────────────────────────────────
          { path: "suppliers",           element: <SuppliersPage /> },
          { path: "suppliers/:id",       element: <SupplierDetailPage /> },
          { path: "supplier-payments",   element: <SupplierPaymentsPage /> },
          { path: "purchase-orders",          element: <PurchaseOrdersPage /> },
          { path: "purchase-orders/new",      element: <CreatePurchaseOrderPage /> },
          { path: "purchase-orders/:id",      element: <PurchaseOrderDetailPage /> },

          // ── Customers ─────────────────────────────────────────────────────
          { path: "customers",     element: <CustomersPage /> },
          { path: "customers/:id", element: <CustomerDetailPage /> },
          { path: "credit-sales",  element: <CreditSalesPage /> },
          { path: "wallet",         element: <WalletPage /> },

          // ── Finance / Reporting ───────────────────────────────────────────
          { path: "expenses",         element: <ExpensesPage /> },
          { path: "analytics",                  element: <AnalyticsDashboardPage /> },
          { path: "analytics/reports",          element: <AnalyticsPage /> },
          { path: "analytics/sales",            element: <SalesAnalyticsPage /> },
          { path: "analytics/products",         element: <ProductsAnalyticsPage /> },
          { path: "analytics/inventory",        element: <InventoryAnalyticsPage /> },
          { path: "analytics/profitability",    element: <ProfitabilityPage /> },
          { path: "analytics/cashiers",         element: <CashiersAnalyticsPage /> },
          { path: "analytics/customers",        element: <CustomersAnalyticsPage /> },
          { path: "eod",              element: <EodPage /> },
          { path: "price-management", element: <PriceManagementPage /> },

          // ── Operations ────────────────────────────────────────────────────
          { path: "notifications",    element: <NotificationsPage /> },

          // ── Admin (super_admin + admin only) ──────────────────────────
          {
            element: <RequireRole roles={["super_admin", "admin", "gm"]} />,
            children: [
              { path: "users",      element: <UsersPage /> },
              { path: "audit",      element: <AuditPage /> },
            ],
          },

          // ── Settings (admin + manager) ────────────────────────────────
          {
            element: <RequireRole roles={["super_admin", "admin", "gm", "manager"]} />,
            children: [
              { path: "settings", element: <SettingsPage /> },
            ],
          },

          // ── 404 catch-all ─────────────────────────────────────────────────
          { path: "*",        element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

export default router;
