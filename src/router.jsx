import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { AppShell }       from "@/components/layout/AppShell";
import PlaceholderPage         from "@/pages/PlaceholderPage";
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
import SuppliersPage             from "@/pages/SuppliersPage";
import SupplierDetailPage        from "@/pages/SupplierDetailPage";
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
import { useAuthStore }   from "@/stores/auth.store";
import { useBranchStore } from "@/stores/branch.store";

// ── ProtectedRoute ────────────────────────────────────────────────────────────
function ProtectedRoute() {
  const user                = useAuthStore(s => s.user);
  const isInitialized       = useAuthStore(s => s.isInitialized);
  const isBranchInitialized = useBranchStore(s => s.isBranchInitialized);
  const needsPicker         = useBranchStore(s => s.needsPicker);

  if (!isInitialized)                    return null;
  if (!user)                             return null;
  if (!isBranchInitialized || needsPicker) return null;

  return <Outlet />;
}

const router = createBrowserRouter([
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: "/",
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/pos" replace /> },

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

          // ── Suppliers / POs ───────────────────────────────────────────────
          { path: "suppliers",       element: <SuppliersPage /> },
          { path: "suppliers/:id",   element: <SupplierDetailPage /> },
          { path: "purchase-orders",          element: <PurchaseOrdersPage /> },
          { path: "purchase-orders/new",      element: <CreatePurchaseOrderPage /> },
          { path: "purchase-orders/:id",      element: <PurchaseOrderDetailPage /> },

          // ── Customers ─────────────────────────────────────────────────────
          { path: "customers",     element: <CustomersPage /> },
          { path: "customers/:id", element: <CustomerDetailPage /> },
          { path: "credit-sales",  element: <CreditSalesPage /> },

          // ── Finance ───────────────────────────────────────────────────────
          { path: "expenses",         element: <ExpensesPage /> },
          { path: "analytics",        element: <PlaceholderPage title="Analytics"         description="Sales summaries, revenue charts, and top-performing items." /> },
          { path: "price-management", element: <PlaceholderPage title="Price Management"  description="Manage price lists and submit price change requests." /> },

          // ── Admin ─────────────────────────────────────────────────────────
          { path: "users",    element: <PlaceholderPage title="Users"    description="Manage staff accounts and roles (admin only)." /> },
          { path: "settings", element: <SettingsPage /> },
        ],
      },
    ],
  },
]);

export default router;
