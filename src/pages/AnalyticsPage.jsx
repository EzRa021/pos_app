// pages/AnalyticsPage.jsx
// Legacy entry point — redirects to the new multi-page analytics system.
import { Navigate } from "react-router-dom";
export default function AnalyticsPage() {
  return <Navigate to="/analytics/overview" replace />;
}
