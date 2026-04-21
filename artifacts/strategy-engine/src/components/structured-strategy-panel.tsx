import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface Props {
  data: Record<string, unknown> | null | undefined;
}

const SECTION_LABELS: Record<string, string> = {
  market_narrative: "Market Narrative",
  problem_gap_solution: "Problem · Gap · Solution",
  brand_foundation: "Brand Foundation",
  brand_philosophy: "Brand Philosophy",
  audience: "Audience",
  emotional_drivers: "Emotional Drivers",
  platform_strategy: "Platform Strategy",
  content_strategy: "Content Strategy",
  kpis: "KPIs",
  tracking_plan: "Tracking Plan",
  phases: "Execution Phases",
  asset_requirements: "Asset Requirements",
};

const ORDER = Object.keys(SECTION_LABELS);

export function StructuredStrategyPanel({ data }: Props) {
  if (!data) return null;
  const keys = ORDER.filter((k) => k in data).concat(
    Object.keys(data).filter((k) => !ORDER.includes(k)),
  );

  return (
    <Accordion type="multiple" className="w-full">
      {keys.map((key) => (
        <AccordionItem key={key} value={key} className="border-border/60">
          <AccordionTrigger className="text-left font-serif text-base hover:no-underline">
            {SECTION_LABELS[key] ?? prettify(key)}
          </AccordionTrigger>
          <AccordionContent>
            <div className="text-sm leading-relaxed text-muted-foreground">
              {renderValue(data[key])}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function prettify(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="italic text-muted-foreground/60">(empty)</span>;
  }
  if (typeof value === "string") {
    return <p className="text-foreground/80 whitespace-pre-wrap">{value}</p>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <p className="text-foreground/80">{String(value)}</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="italic text-muted-foreground/60">(empty)</span>;
    }
    if (value.every((v) => typeof v === "string")) {
      return (
        <ul className="list-disc pl-5 space-y-1.5 text-foreground/80">
          {value.map((v, i) => (
            <li key={i}>{String(v)}</li>
          ))}
        </ul>
      );
    }
    return (
      <div className="space-y-3">
        {value.map((v, i) => (
          <div
            key={i}
            className="rounded-md border border-border/60 bg-card/50 p-3"
          >
            {renderValue(v)}
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (
      <div className="space-y-2">
        {Object.entries(obj).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[140px_1fr] gap-3 items-start">
            <div className="text-xs uppercase tracking-wide text-muted-foreground/70 pt-0.5">
              {prettify(k)}
            </div>
            <div className="text-foreground/80">{renderValue(v)}</div>
          </div>
        ))}
      </div>
    );
  }
  return <p className="text-foreground/80">{JSON.stringify(value)}</p>;
}
