import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "sonner";
import { queryClient } from "@/lib/queryClient";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import "./index.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* Outer boundary — catches crashes in App.jsx itself, splash screens,
        setup wizard, and login. Shows a full-screen crash UI with Reload. */}
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
        <Toaster
          position="bottom-right"
          theme="dark"
          richColors
          closeButton
          gap={8}
          toastOptions={{
            style: {
              fontFamily: '"DM Sans", system-ui, sans-serif',
            },
          }}
        />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
