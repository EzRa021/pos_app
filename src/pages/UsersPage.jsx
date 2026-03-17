// pages/UsersPage.jsx — thin composer
import { UsersPanel } from "@/features/users/UsersPanel";

export default function UsersPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <UsersPanel />
    </div>
  );
}
