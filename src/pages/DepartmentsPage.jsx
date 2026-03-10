// ============================================================================
// pages/DepartmentsPage.jsx
// ============================================================================
// Thin composer for the Departments feature.
// ============================================================================

import { DepartmentsTable } from "@/features/departments/DepartmentsTable";

export default function DepartmentsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-5 space-y-4">
          <DepartmentsTable />
        </div>
      </div>
    </div>
  );
}

