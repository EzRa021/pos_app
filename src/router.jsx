import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AppShell }    from "@/components/layout/AppShell";
import LoginPage       from "@/pages/LoginPage";
import StorePicker     from "@/features/auth/StorePicker";
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
import SettingsLayout     from "@/features/settings/SettingsLayout";
import SettingsSection    from "@/features/settings/SettingsSection";
import StoreCreationPage  from "@/pages/StoreCreationPage";
import EodPage                 from "@/pages/EodPage";
import StockTransfersPage      from "@/pages/StockTransfersPage";
import StockTransferDetailPage from "@/pages/StockTransferDetailPage";
import NotificationsPage       from "@/pages/NotificationsPage";
import AuditPage               from "@/pages/AuditPage";
import UsersPage               from "@/pages/UsersPage";
import PriceManagementPage     from "@/pages/PriceManagementPage";
import NotFoundPage            from "@/pages/NotFoundPage";
import AnalyticsDashboardPage  from "@/pages/AnalyticsDashboardPage";
// ── Analytics layout + individual pages ──────────────────────────────────────
import AnalyticsLayout   from "@/features/analytics/AnalyticsLayout";
import OverviewPage      from "@/pages/analytics/OverviewPage";
import SalesPage         from "@/pages/analytics/SalesPage";
import ProductsPage      from "@/pages/analytics/ProductsPage";
import PaymentsPage      from "@/pages/analytics/PaymentsPage";
import CustomersAnalyticsPage from "@/pages/analytics/CustomersPage";
import InventoryAnalyticsPage from "@/pages/analytics/InventoryPage";
import StaffPage         from "@/pages/analytics/StaffPage";
import ProfitabilityPage from "@/pages/analytics/ProfitabilityPage";
import TaxPage           from "@/pages/analytics/TaxPage";

import { ShieldOff } from "lucide-react";
import { useAuthStore }   from "@/stores/auth.store";
import { useBranchStore } from "@/stores/branch.store";

function RouterSplash() {
  return (
    <div className="h-full w-full bg-background flex items-center justify-center">
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
    </div>
  );
}

function PublicOnlyRoute() {
  const user          = useAuthStore(s => s.user);
  const isInitialized = useAuthStore(s => s.isInitialized);
  if (!isInitialized) return <RouterSplash />;
  if (user)           return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function ProtectedRoute() {
  const user                = useAuthStore(s => s.user);
  const isInitialized       = useAuthStore(s => s.isInitialized);
  const isBranchInitialized = useBranchStore(s => s.isBranchInitialized);
  const needsPicker         = useBranchStore(s => s.needsPicker);
  const needsStoreCreation  = useBranchStore(s => s.needsStoreCreation);
  const location             = useLocation();

  if (!isInitialized)       return <RouterSplash />;
  if (!user)                return <Navigate to="/login" replace />;
  if (!isBranchInitialized) return <RouterSplash />;
  if (needsPicker)          return <StorePicker />;

  if (needsStoreCreation && location.pathname !== '/store/new') {
    return <Navigate to="/store/new" replace />;
  }

  return <Outlet />;
}

function AccessDenied({ children }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center py-20 px-4">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-destructive/25 bg-destructive/10">
        <ShieldOff className="h-9 w-9 text-destructive/70" />
      </div>
      <div className="space-y-1.5 max-w-xs">
        <p className="text-lg font-bold text-foreground">Access denied</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

function RequireRole({ roles }) {
  const roleSlug = useAuthStore(s => s.user?.role_slug);
  if (roles.includes(roleSlug ?? "")) return <Outlet />;
  return (
    <AccessDenied>
      Your role (<span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded border border-border/60">{roleSlug ?? "unknown"}</span>) does not have permission to view this page.
    </AccessDenied>
  );
}

// Gate a route by a permission slug. Global roles (is_global) bypass the check,
// mirroring the backend guard_permission() so the UI never offers a screen the
// server would reject at the first mutating call.
function RequirePermission({ permission }) {
  const isGlobal = useAuthStore(s => s.user?.is_global ?? false);
  const perms    = useAuthStore(s => s.user?.permissions);
  const allowed  = isGlobal || (Array.isArray(perms) && perms.includes(permission));
  if (allowed) return <Outlet />;
  return (
    <AccessDenied>
      You don&apos;t have permission to use this feature. Ask an administrator if you need access.
    </AccessDenied>
  );
}

const router = createBrowserRouter([
  // ── Public ──────────────────────────────────────────────────────────────────
  {
    element: <PublicOnlyRoute />,
    children: [
      { path: "/login", element: <LoginPage /> },
    ],
  },

  // ── Protected ───────────────────────────────────────────────────────────────
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <RequireRole roles={["super_admin", "admin", "gm"]} />,
        children: [
          { path: "store/new", element: <StoreCreationPage /> },
        ],
      },

      {
        path: "/",
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },

          // ── Dashboard ────────────────────────────────────────────────────
          { path: "dashboard", element: <AnalyticsDashboardPage /> },

          // ── POS ──────────────────────────────────────────────────────────
          {
            element: <RequirePermission permission="pos.sale" />,
            children: [
              { path: "pos",           element: <PosPage /> },
            ],
          },
          { path: "transactions",      element: <TransactionsPage /> },
          { path: "transactions/:id",  element: <TransactionDetailPage /> },
          { path: "returns",           element: <ReturnsPage /> },
          { path: "returns/:id",       element: <ReturnDetailPage /> },
          { path: "shifts",            element: <ShiftsPage /> },
          { path: "shifts/:id",        element: <ShiftDetailPage /> },

          // ── Catalog ───────────────────────────────────────────────────────
          { path: "products",          element: <ItemsPage /> },
          { path: "products/:id",      element: <ItemDetailPage /> },
          { path: "departments",       element: <DepartmentsPage /> },
          { path: "categories",        element: <CategoriesPage /> },

          // ── Inventory ─────────────────────────────────────────────────────
          { path: "inventory",               element: <InventoryPage /> },
          { path: "inventory/:itemId",       element: <InventoryItemPage /> },
          { path: "stock-counts",            element: <StockCountsPage /> },
          { path: "stock-counts/:id",        element: <StockCountSessionPage /> },
          { path: "stock-counts/:id/report", element: <VarianceReportPage /> },
          { path: "stock-transfers",         element: <StockTransfersPage /> },
          { path: "stock-transfers/:id",     element: <StockTransferDetailPage /> },

          // ── Suppliers / POs ───────────────────────────────────────────────
          { path: "suppliers",           element: <SuppliersPage /> },
          { path: "suppliers/:id",       element: <SupplierDetailPage /> },
          { path: "supplier-payments",   element: <SupplierPaymentsPage /> },
          { path: "purchase-orders",     element: <PurchaseOrdersPage /> },
          { path: "purchase-orders/new", element: <CreatePurchaseOrderPage /> },
          { path: "purchase-orders/:id", element: <PurchaseOrderDetailPage /> },

          // ── Customers ─────────────────────────────────────────────────────
          { path: "customers",     element: <CustomersPage /> },
          { path: "customers/:id", element: <CustomerDetailPage /> },
          { path: "credit-sales",  element: <CreditSalesPage /> },
          { path: "wallet",        element: <WalletPage /> },

          // ── Finance ───────────────────────────────────────────────────────
          { path: "expenses",         element: <ExpensesPage /> },
          { path: "eod",              element: <EodPage /> },
          {
            element: <RequirePermission permission="items.read" />,
            children: [
              { path: "price-management", element: <PriceManagementPage /> },
            ],
          },

          // ── Analytics (AnalyticsLayout gives inner sub-nav + date filter) ──
          // Gated by analytics.read — cashiers/stock_keepers lack it and are shown
          // Access Denied rather than a wall of failing panels. (The /dashboard
          // landing is intentionally NOT gated — it is role-adaptive.)
          {
            path: "analytics",
            element: <RequirePermission permission="analytics.read" />,
            children: [{
              element: <AnalyticsLayout />,
              children: [
              { index: true,               element: <Navigate to="/analytics/overview" replace /> },
              { path: "overview",          element: <OverviewPage /> },
              { path: "sales",             element: <SalesPage /> },
              { path: "products",          element: <ProductsPage /> },
              { path: "payments",          element: <PaymentsPage /> },
              { path: "customers",         element: <CustomersAnalyticsPage /> },
              { path: "inventory",         element: <InventoryAnalyticsPage /> },
              { path: "staff",             element: <StaffPage /> },
              { path: "profitability",     element: <ProfitabilityPage /> },
              { path: "tax",               element: <TaxPage /> },
              { path: "reports",           element: <Navigate to="/analytics/overview" replace /> },
              { path: "cashiers",          element: <Navigate to="/analytics/staff"    replace /> },
              { path: "dashboard",         element: <Navigate to="/analytics/overview" replace /> },
              { path: "*",                 element: <Navigate to="/analytics/overview" replace /> },
              ],
            }],
          },

          // ── Operations ────────────────────────────────────────────────────
          { path: "notifications", element: <NotificationsPage /> },

          // ── Admin only ────────────────────────────────────────────────────
          {
            element: <RequireRole roles={["super_admin", "admin", "gm"]} />,
            children: [
              { path: "users",  element: <UsersPage /> },
              { path: "audit",  element: <AuditPage /> },
            ],
          },

          // ── Settings (SettingsLayout gives grouped sub-nav + search) ───────
          // Sections are URL-addressable so support can direct a user straight
          // to /settings/printer, and back/forward behave normally.
          {
            element: <RequireRole roles={["super_admin", "admin", "gm", "manager"]} />,
            children: [{
              path: "settings",
              element: <SettingsLayout />,
              children: [
                { index: true,        element: <Navigate to="/settings/business" replace /> },
                { path: ":section",   element: <SettingsSection /> },
              ],
            }],
          },

          // ── 404 ───────────────────────────────────────────────────────────
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

export default router;
