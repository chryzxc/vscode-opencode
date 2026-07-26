import { Component, ErrorInfo, ReactNode } from "react";
import vscode from "../lib/vscode";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    // Keep the host-side error record small enough to survive a failing
    // webview, while retaining the stack needed to diagnose the crash.
    vscode.postMessage({
      type: "webviewError",
      message: error.message.slice(0, 2_000),
      stack: [error.stack, errorInfo.componentStack]
        .filter((value): value is string => typeof value === "string")
        .join("\n")
        .slice(0, 8_000),
    });
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center relative overflow-hidden bg-oc-bg text-oc-text">
          {/* Subtle animated background blob */}
          <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none opacity-20">
            <div className="w-[40vw] h-[40vw] bg-red-500/10 blur-[100px] rounded-full animate-pulse" />
          </div>

          <div className="relative z-10 flex flex-col items-center max-w-lg w-full bg-oc-bg-soft border border-oc-border p-8 rounded-2xl shadow-xl space-y-6">
            <div className="flex items-center justify-center w-16 h-16 rounded-full border border-red-500/20 bg-red-500/10 mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight text-oc-text">Something went wrong</h2>
              <p className="text-sm text-oc-text-soft">
                An unexpected error occurred. We've caught the error to keep things running.
              </p>
            </div>

            <div className="w-full text-sm max-h-[200px] overflow-auto p-4 bg-oc-bg border border-oc-border rounded-xl text-left font-mono text-red-400 shadow-inner">
              <code>{this.state.error?.toString()}</code>
            </div>

            <button 
              className="group relative inline-flex items-center justify-center px-6 py-2.5 text-sm font-medium transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 bg-oc-panel text-oc-text border border-oc-border rounded-full hover:bg-oc-bg-soft focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-oc-accent"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              <span className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 transition-transform group-hover:-rotate-180 duration-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Try Again
              </span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
