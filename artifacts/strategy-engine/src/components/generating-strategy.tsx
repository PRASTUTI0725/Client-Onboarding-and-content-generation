import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const STAGES = [
  "Fetching website context...",
  "Fetching Instagram context...",
  "Generating core strategy...",
  "Refining detailed sections...",
];

type Props = Record<string, never>;

export function GeneratingStrategy(_: Props) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStage((x) => (x + 1) % STAGES.length);
    }, 3500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-full max-w-[28rem]" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-10">
        <div className="space-y-4">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-10/12" />
          <Skeleton className="h-4 w-9/12" />
          <Skeleton className="h-6 w-1/4 mt-8" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-10/12" />
          <Skeleton className="h-4 w-8/12" />
        </div>
        <div className="space-y-3 rounded-xl border border-border bg-card/40 p-4">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground" data-testid="strategy-generating-timer">
          Usually takes 2–3 minutes
        </p>
        <p className="text-sm text-muted-foreground">
          Building your strategy: {STAGES[stage]}
        </p>
      </div>
    </div>
  );
}
