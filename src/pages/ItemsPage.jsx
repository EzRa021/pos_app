import { ItemsTable } from "@/features/items/ItemsTable";

export default function ItemsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <ItemsTable />
      </div>
    </div>
  );
}
