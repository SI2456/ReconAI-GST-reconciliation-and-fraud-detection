import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary caught an error]:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      const title = this.props.fallbackTitle || "Something went wrong in this section";
      const message =
        this.props.fallbackMessage ||
        "An unexpected error occurred while rendering this component. The rest of the application remains available.";

      return (
        <div className="p-6 my-4 mx-auto max-w-2xl bg-card border border-rose-500/30 rounded-2xl shadow-xl text-foreground">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-rose-500/10 text-rose-500 rounded-xl border border-rose-500/20 shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <h3 className="text-base font-bold text-rose-600 dark:text-rose-400">{title}</h3>
                <p className="text-xs text-muted-foreground mt-1">{message}</p>
              </div>

              {this.state.error && (
                <div className="bg-muted/50 border border-border rounded-lg p-3 text-xs font-mono text-rose-500 overflow-x-auto">
                  {this.state.error.toString()}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="flex items-center gap-2 text-xs font-semibold bg-primary text-primary-foreground px-3.5 py-2 rounded-lg hover:opacity-90 transition-opacity shadow-sm"
                >
                  <RotateCcw size={14} />
                  <span>Try Again</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="flex items-center gap-2 text-xs font-medium border border-border bg-background px-3.5 py-2 rounded-lg hover:bg-muted transition-colors"
                >
                  <span>Reload Page</span>
                </button>
                <button
                  type="button"
                  onClick={() => this.setState(prev => ({ showDetails: !prev.showDetails }))}
                  className="text-xs text-muted-foreground hover:text-foreground underline ml-auto"
                >
                  {this.state.showDetails ? "Hide Stack Trace" : "Show Stack Trace"}
                </button>
              </div>

              {this.state.showDetails && this.state.errorInfo && (
                <pre className="mt-3 p-3 bg-slate-950 text-slate-300 rounded-lg text-[10px] font-mono overflow-x-auto max-h-48 whitespace-pre-wrap border border-slate-800">
                  {this.state.errorInfo.componentStack}
                </pre>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
