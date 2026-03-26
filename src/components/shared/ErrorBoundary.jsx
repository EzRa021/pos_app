// ============================================================================
// components/shared/ErrorBoundary.jsx
// ============================================================================
// React class component error boundary. Catches JS errors thrown during
// render, in lifecycle methods, or in constructors of child components.
//
// Does NOT catch:
//   • Errors in event handlers (use try/catch or toast.error there)
//   • Errors in async code (use .catch())
//   • Errors in the error boundary itself
//
// Placement strategy:
//   main.jsx   — outermost boundary (catches complete app crashes)
//   AppShell   — inner boundary (keeps TitleBar alive on page-level crashes)
//
// On a POS terminal this is critical — a single bad render in the analytics
// page must never take down the cashier's POS screen.
// ============================================================================

import { Component } from "react";
import { RefreshCw, AlertTriangle, Home } from "lucide-react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log to console — in production this would go to an error monitoring service
    console.error("[ErrorBoundary] Uncaught render error:", error, errorInfo);
  }

  handleReload() {
    window.location.reload();
  }

  handleReset() {
    this.setState({ hasError: false, error: null, errorInfo: null });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Allow a custom fallback to be passed as a prop
    if (this.props.fallback) {
      return this.props.fallback;
    }

    const errorMessage = this.state.error?.message ?? "An unexpected error occurred.";
    const isPageLevel  = this.props.pageLevel === true;

    // ── Full-screen fallback (outermost boundary) ─────────────────────────
    if (!isPageLevel) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-8 bg-background text-center px-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl border-2 border-destructive/30 bg-destructive/10">
            <AlertTriangle className="h-9 w-9 text-destructive" />
          </div>

          <div className="space-y-2 max-w-md">
            <h1 className="text-lg font-bold text-foreground">Something went wrong</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Quantum POS encountered an unexpected error and cannot continue.
              Your sales data is safe — no transaction was interrupted.
            </p>
            {errorMessage && (
              <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] text-muted-foreground break-all">
                {errorMessage}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={this.handleReset.bind(this)}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </button>
            <button
              onClick={this.handleReload.bind(this)}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Reload App
            </button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Quantum POS © {new Date().getFullYear()}
          </p>
        </div>
      );
    }

    // ── Page-level fallback (inner boundary inside AppShell) ─────────────
    // Sidebar and TitleBar remain functional — only the page content crashes.
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center px-6 py-16">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10">
          <AlertTriangle className="h-7 w-7 text-destructive" />
        </div>

        <div className="space-y-1.5 max-w-sm">
          <p className="text-sm font-bold text-foreground">This page crashed</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            An error occurred while rendering this page.
            Your data is safe — navigate to another page or try again.
          </p>
          {errorMessage && (
            <p className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-[10px] text-muted-foreground break-all">
              {errorMessage}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={this.handleReset.bind(this)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/50 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try Again
          </button>
          <button
            onClick={() => { this.handleReset(); window.location.assign("/pos"); }}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Home className="h-3.5 w-3.5" />
            Go to POS
          </button>
        </div>
      </div>
    );
  }
}
