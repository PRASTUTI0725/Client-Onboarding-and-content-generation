import { useEffect, useState } from "react";

const STAGES = [
  "Reading your site...",
  "Mapping your audience...",
  "Drafting positioning...",
  "Composing the document...",
];

export function GeneratingStrategy() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStage((s) => (s + 1) % STAGES.length);
    }, 3500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="relative size-12 mb-6">
        <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
      </div>
      <h3 className="font-serif text-xl text-foreground mb-2">
        Building your strategy
      </h3>
      <div className="h-6 relative w-full max-w-sm">
        {STAGES.map((s, i) => (
          <p
            key={s}
            className="absolute inset-0 text-sm text-muted-foreground transition-opacity duration-700"
            style={{ opacity: i === stage ? 1 : 0 }}
          >
            {s}
          </p>
        ))}
      </div>
      <p className="text-xs text-muted-foreground/60 mt-8 max-w-xs leading-relaxed">
        This usually takes 15–30 seconds. We're enriching the brand profile and
        composing a full strategy document.
      </p>
    </div>
  );
}
