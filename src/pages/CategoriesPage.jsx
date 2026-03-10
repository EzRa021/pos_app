// ============================================================================
// pages/CategoriesPage.jsx
// ============================================================================
// Thin page composer for the Categories feature.
// All business logic, data fetching, and UI live in CategoriesPanel.
// ============================================================================

import { CategoriesPanel } from "@/features/categories/CategoriesPanel";

export default function CategoriesPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <CategoriesPanel />
    </div>
  );
}
