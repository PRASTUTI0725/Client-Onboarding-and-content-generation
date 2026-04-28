import { Suspense, lazy, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setDefaultHeaders } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { buildAIHeaders, readAISettings } from "@/lib/ai-settings";
import NotFound from "@/pages/not-found";
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Workspace = lazy(() => import("@/pages/workspace"));
const Calendar = lazy(() => import("@/pages/calendar"));

const queryClient = new QueryClient();

function Router() {
  return (
    <Suspense fallback={<RouteSkeleton />}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/calendar" component={CalendarRedirect} />
        <Route path="/clients/:id" component={Workspace} />
        <Route path="/clients/:id/calendar" component={Calendar} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function CalendarRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/");
  }, [navigate]);
  return null;
}

function App() {
  useEffect(() => {
    const apply = () => {
      const settings = readAISettings();
      const key = import.meta.env.VITE_LOCAL_API_KEY;
      setDefaultHeaders({
        ...buildAIHeaders(settings),
        ...(typeof key === "string" && key
          ? { "x-api-key": key }
          : ({} as Record<string, string>)),
      });
    };
    apply();
    const listener = () => apply();
    window.addEventListener("ai-settings-updated", listener);
    return () => window.removeEventListener("ai-settings-updated", listener);
  }, []);

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

function RouteSkeleton() {
  return (
    <div className="min-h-[100dvh] p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-3">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

export default App;
