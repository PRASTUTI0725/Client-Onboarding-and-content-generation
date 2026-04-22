import type { CSSProperties } from "react";

interface Props {
  format: string;
  pillar: string;
  hook: string;
  status: string;
  pillarColor: string;
  onClick: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}

export function CalendarCard({
  format,
  pillar,
  hook,
  status,
  pillarColor,
  onClick,
  draggable,
  onDragStart,
}: Props) {
  const accent: CSSProperties = { backgroundColor: pillarColor };
  return (
    <button
      type="button"
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      className="group w-full text-left bg-card hover:bg-accent/40 border border-border hover:border-primary/30 rounded-md p-2 cursor-pointer transition-all relative overflow-hidden"
    >
      <div className="absolute left-0 top-0 bottom-0 w-1" style={accent} />
      <div className="pl-1.5 space-y-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
            {format}
          </span>
          <StatusDot status={status} />
        </div>
        <p className="text-[11px] leading-snug text-foreground line-clamp-2 font-medium">
          {hook}
        </p>
        <p
          className="text-[10px] truncate"
          style={{ color: pillarColor }}
          title={pillar}
        >
          {pillar}
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
