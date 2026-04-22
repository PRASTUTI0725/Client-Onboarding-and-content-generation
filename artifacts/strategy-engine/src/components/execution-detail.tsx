interface Props {
  format: string;
  execution: Record<string, unknown>;
}

interface Slide {
  n?: number;
  role?: string;
  headline?: string;
  body?: string;
}
interface Frame {
  n?: number;
  role?: string;
  copy?: string;
  interaction?: string;
}

export function ExecutionDetail({ format, execution }: Props) {
  const fmt = format.toLowerCase();

  if (fmt.includes("carousel")) {
    const slides = (execution["slides"] as Slide[] | undefined) ?? [];
    const dir = execution["design_direction"] as string | undefined;
    return (
      <div className="space-y-3">
        <ol className="space-y-2">
          {slides.map((s, i) => (
            <li
              key={i}
              className="rounded-md border border-border bg-card p-3 space-y-1"
            >
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Slide {s.n ?? i + 1}</span>
                {s.role && <span>{s.role}</span>}
              </div>
              {s.headline && (
                <p className="text-sm font-medium leading-snug">{s.headline}</p>
              )}
              {s.body && (
                <p className="text-sm text-foreground/75 leading-relaxed">{s.body}</p>
              )}
            </li>
          ))}
        </ol>
        {dir && <Hint label="Design direction" value={dir} />}
      </div>
    );
  }

  if (fmt.includes("reel") || (fmt.includes("video") && !fmt.includes("long"))) {
    const hook = execution["hook_2s"] as string | undefined;
    const interrupt = execution["pattern_interrupt"] as string | undefined;
    const beats = (execution["beats"] as string[] | undefined) ?? [];
    const ctaOnScreen = execution["cta_on_screen"] as string | undefined;
    const visual = execution["visual_direction"] as string | undefined;
    const audio = execution["audio"] as string | undefined;
    return (
      <div className="space-y-3">
        {hook && <Hint label="First 2 seconds" value={hook} accent />}
        {interrupt && <Hint label="Pattern interrupt" value={interrupt} />}
        {beats.length > 0 && (
          <div className="rounded-md border border-border bg-card p-3 space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Beats
            </p>
            <ol className="space-y-1.5">
              {beats.map((b, i) => (
                <li key={i} className="text-sm leading-relaxed flex gap-2">
                  <span className="text-muted-foreground font-mono text-xs pt-0.5">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-foreground/85">{b}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {ctaOnScreen && <Hint label="On-screen CTA" value={ctaOnScreen} />}
        {visual && <Hint label="Visual direction" value={visual} />}
        {audio && <Hint label="Audio" value={audio} />}
      </div>
    );
  }

  if (fmt.includes("story") || fmt.includes("stories")) {
    const frames = (execution["frames"] as Frame[] | undefined) ?? [];
    return (
      <div className="space-y-2">
        {frames.map((f, i) => (
          <div
            key={i}
            className="rounded-md border border-border bg-card p-3 space-y-1"
          >
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Frame {f.n ?? i + 1}</span>
              {f.role && <span>{f.role}</span>}
            </div>
            {f.copy && <p className="text-sm leading-relaxed">{f.copy}</p>}
            {f.interaction && f.interaction !== "none" && (
              <p className="text-xs text-muted-foreground italic">
                Interaction: {f.interaction}
              </p>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (fmt.includes("static")) {
    const visual = execution["visual_idea"] as string | undefined;
    const headline = execution["headline"] as string | undefined;
    const depth = execution["caption_depth"] as string | undefined;
    return (
      <div className="space-y-2">
        {visual && <Hint label="Visual idea" value={visual} accent />}
        {headline && <Hint label="On-image headline" value={headline} />}
        {depth && <Hint label="What the caption uniquely carries" value={depth} />}
      </div>
    );
  }

  if (fmt.includes("text") || fmt.includes("thread")) {
    const opening = execution["opening_line"] as string | undefined;
    const body = execution["body"] as string | undefined;
    const close = execution["close"] as string | undefined;
    return (
      <div className="space-y-2">
        {opening && <Hint label="Opening line" value={opening} accent />}
        {body && (
          <div className="rounded-md border border-border bg-card p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Body
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">
              {body}
            </p>
          </div>
        )}
        {close && <Hint label="Close" value={close} />}
      </div>
    );
  }

  // Generic fallback: render keys as a definition list.
  return (
    <div className="space-y-2">
      {Object.entries(execution).map(([k, v]) => (
        <Hint key={k} label={prettify(k)} value={typeof v === "string" ? v : JSON.stringify(v)} />
      ))}
    </div>
  );
}

function Hint({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        accent ? "border-foreground/20 bg-foreground/[0.03]" : "border-border bg-card"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </p>
      <p className="text-sm leading-relaxed text-foreground/85">{value}</p>
    </div>
  );
}

function prettify(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
