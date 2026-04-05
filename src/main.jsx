import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "sonner";
import { queryClient } from "@/lib/queryClient";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { useBranchStore } from "@/stores/branch.store";
import "./index.css";
import App from "./App";

// Reads the active store's theme and keeps Sonner in sync.
// Must live inside QueryClientProvider so Zustand subscriptions work correctly.
function ThemedToaster() {
  const theme = useBranchStore((s) => s.activeStore?.theme ?? "dark");
  const sonnerTheme = theme === "light" ? "light" : "dark";

  return (
    <Toaster
      position="bottom-right"
      theme={sonnerTheme}
      richColors
      closeButton
      gap={8}
      toastOptions={{
        style: {
          fontFamily: '"DM Sans", system-ui, sans-serif',
          // Use design-token colours so toasts match both light and dark themes.
          background:   "hsl(var(--card))",
          color:        "hsl(var(--foreground))",
          border:       "1px solid hsl(var(--border))",
          boxShadow:    "0 4px 24px hsl(var(--foreground) / 0.08)",
        },
        className: "themed-toast",
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* Outer boundary — catches crashes in App.jsx itself, splash screens,
        setup wizard, and login. Shows a full-screen crash UI with Reload. */}
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
        <ThemedToaster />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
