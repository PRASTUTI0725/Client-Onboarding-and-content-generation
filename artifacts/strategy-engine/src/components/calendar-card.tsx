import type { CSSProperties } from "react";

interface Props {
  format: string;
  pillar: string;
  hook: string;
  status: string;
  pillarColor: string;
  platform?: string;
  priority?: string;
  onClick: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  testId?: string;
}

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-[#B85C38]",
  medium: "bg-[#A38560]",
  low: "bg-muted-foreground/30",
};

export function CalendarCard({
  format,
  pillar,
  hook,
  status,
  pillarColor,
  platform,
  priority,
  onClick,
  draggable,
  onDragStart,
  testId,
}: Props) {
  const accent: CSSProperties = { backgroundColor: pillarColor };
  return (
    <button
      type="button"
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      data-testid={testId}
      className="group w-full text-left bg-card hover:bg-accent/40 border border-border hover:border-primary/30 rounded-md p-2 cursor-pointer transition-all relative overflow-hidden"
    >
      <div className="absolute left-0 top-0 bottom-0 w-1" style={accent} />
      <div className="pl-1.5 space-y-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground truncate">
            {platform ? `${platform} · ${humanize(format)}` : humanize(format)}
          </span>
          <span className="flex items-center gap-1">
            {priority && (
              <span
                className={`inline-block size-1.5 rounded-full ${
                  PRIORITY_DOT[priority] ?? PRIORITY_DOT.medium
                }`}
                title={`Priority: ${priority}`}
              />
            )}
            <StatusDot status={status} />
          </span>
        </div>
        <p className="text-[11px] leading-snug text-foreground line-clamp-2 font-medium">
          {hook}
        </p>
        <p
          className="text-[10px] truncate"
          style={{ color: pillarColor }}
          title={pillar}
        >
          {humanize(pillar)}
        </p>
      </div>
    </button>
  );
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted-foreground/40",
    pending_approval: "bg-amber-500",
    approved: "bg-emerald-500",
    needs_changes: "bg-rose-500",
    scheduled: "bg-sky-500",
  };
  return (
    <span
      className={`inline-block size-1.5 rounded-full ${map[status] ?? "bg-muted-foreground/40"}`}
      title={status.replace(/_/g, " ")}
    />
  );
}

function humanize(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : value;
}
