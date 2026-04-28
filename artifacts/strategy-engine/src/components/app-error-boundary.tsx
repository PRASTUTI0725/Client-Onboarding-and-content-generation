import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || "Unknown error" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App boundary caught an error", { error, info });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-[100dvh] flex items-center justify-center px-4">
        <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 space-y-3 text-center">
          <h1 className="font-serif text-2xl tracking-tight">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            {this.state.message || "The app hit an unexpected error."}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button onClick={() => window.location.reload()}>Reload app</Button>
            <Button variant="outline" onClick={() => this.setState({ hasError: false, message: "" })}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
