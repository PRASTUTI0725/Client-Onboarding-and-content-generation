import type { NormalizedPostDetail } from "@/lib/post-detail";

interface Props {
  detail: NormalizedPostDetail;
}

export function ExecutionDetail({ detail }: Props) {
  if (detail.formatKind === "reel" && detail.reelExecution) {
    return (
      <div className="space-y-4" data-testid="post-detail-reel-execution">
        <DetailCard label="Hook line" accent>
          <p className="text-sm leading-relaxed text-foreground/90">{detail.reelExecution.hookLine}</p>
        </DetailCard>
        <DetailCard label="Flow">
          <div className="flex flex-wrap gap-2">
            {detail.reelExecution.flow.map((step, index) => (
              <span
                key={`${step}-${index}`}
                className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                {step}
              </span>
            ))}
          </div>
        </DetailCard>
        <DetailCard label="Script">
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">
            {detail.reelExecution.script}
          </p>
        </DetailCard>
        <div className="grid gap-3 md:grid-cols-2">
          <DetailCard label="Visual direction">
            <p className="text-sm leading-relaxed text-foreground/85">
              {detail.reelExecution.visualDirection}
            </p>
          </DetailCard>
          <DetailCard label="Editing style">
            <p className="text-sm leading-relaxed text-foreground/85">
              {detail.reelExecution.editingStyle}
            </p>
          </DetailCard>
        </div>
      </div>
    );
  }

  if (detail.formatKind === "carousel" && detail.carouselExecution) {
    return (
      <div className="space-y-3" data-testid="post-detail-carousel-execution">
        {detail.carouselExecution.map((slide) => (
          <div
            key={slide.slide}
            className="rounded-xl border border-border bg-card p-3.5 shadow-sm"
          >
            <div className="mb-1.5 flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Slide {slide.slide}</span>
              <span>{slide.type}</span>
            </div>
            <p className="text-sm leading-relaxed text-foreground/85">{slide.text}</p>
          </div>
        ))}
      </div>
    );
  }

  if (detail.formatKind === "story" && detail.storyExecution) {
    return (
      <div className="space-y-3" data-testid="post-detail-story-execution">
        {detail.storyExecution.map((frame) => (
          <div
            key={frame.frame}
            className="rounded-xl border border-border bg-card p-3.5 shadow-sm"
          >
            <div className="mb-1.5 flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Frame {frame.frame}</span>
              <span>{frame.type}</span>
            </div>
            <p className="text-sm leading-relaxed text-foreground/85">{frame.text}</p>
            {frame.interaction && (
              <p className="mt-2 text-xs font-medium text-foreground/70">
                Interaction: {frame.interaction}
              </p>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (detail.formatKind === "static" && detail.staticExecution) {
    return (
      <div className="grid gap-3 md:grid-cols-2" data-testid="post-detail-static-execution">
        <DetailCard label={detail.isPinterestPin ? "Pin headline" : "Headline"} accent>
          <p className="text-sm leading-relaxed text-foreground/90">
            {detail.staticExecution.headline}
          </p>
        </DetailCard>
        <DetailCard label={detail.isPinterestPin ? "Pin visual direction" : "Visual direction"}>
          <p className="text-sm leading-relaxed text-foreground/85">
            {detail.staticExecution.visualDirection}
          </p>
        </DetailCard>
        <div className="md:col-span-2">
          <DetailCard label={detail.isPinterestPin ? "Pin description" : "Posting caption"}>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">
              {detail.staticExecution.caption}
            </p>
          </DetailCard>
        </div>
      </div>
    );
  }

  return (
    <DetailCard label="Execution plan">
      <p className="text-sm leading-relaxed text-foreground/85">
        Use the post overview, caption, and conversion path below as the operating brief for this format.
      </p>
    </DetailCard>
  );
}

function DetailCard({
  label,
  children,
  accent,
}: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3.5 shadow-sm ${
        accent ? "border-foreground/15 bg-foreground/[0.035]" : "border-border bg-card"
      }`}
    >
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}
