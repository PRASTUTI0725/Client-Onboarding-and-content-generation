import { Badge } from "@/components/ui/badge";

type BoardStatus =
  | "draft"
  | "pending_approval"
  | "needs_changes"
  | "approved"
  | "scheduled"
  | "published";

interface BoardPost {
  id: string;
  hook: string;
  platform: string;
  date: string;
  status: string;
  priority?: string | null;
}

interface Props {
  posts: BoardPost[];
  onSelectPost: (id: string) => void;
  onMovePost: (postId: string, toStatus: BoardStatus) => void;
  dragEnabled?: boolean;
}

const BOARD_COLUMNS: Array<{ key: BoardStatus; label: string }> = [
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Pending approval" },
  { key: "needs_changes", label: "Needs changes" },
  { key: "approved", label: "Approved" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
];

const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-destructive",
  medium: "bg-primary",
  low: "bg-muted-foreground/30",
};

export function CalendarBoard({ posts, onSelectPost, onMovePost, dragEnabled = true }: Props) {
  const byStatus = posts.reduce<Record<string, BoardPost[]>>((acc, post) => {
    const key = post.status ?? "draft";
    acc[key] = acc[key] ?? [];
    acc[key].push(post);
    return acc;
  }, {});

  return (
    <div className="overflow-x-auto pb-2" data-testid="calendar-board-view">
      {!dragEnabled && (
        <p className="mb-2 text-xs text-muted-foreground" data-testid="board-mobile-drag-note">
          Drag and drop is disabled on touch devices for reliability. Open a card to change status.
        </p>
      )}
      {posts.length === 0 && (
        <div className="mb-3 rounded-md border border-dashed border-border bg-card/30 px-3 py-2 text-sm text-muted-foreground">
          No posts match current filters.
        </div>
      )}
      <div className="flex gap-3 sm:gap-4 min-w-[860px] sm:min-w-[980px]">
        {BOARD_COLUMNS.map((column) => (
          <div
            key={column.key}
            className="w-[240px] sm:w-[260px] shrink-0 rounded-xl border border-border bg-card/60"
            onDragOver={dragEnabled ? (e) => e.preventDefault() : undefined}
            onDrop={
              dragEnabled
                ? (e) => {
                    e.preventDefault();
                    const postId = e.dataTransfer.getData("text/post-id");
                    const fromStatus = e.dataTransfer.getData("text/post-status");
                    if (postId && fromStatus !== column.key) onMovePost(postId, column.key);
                  }
                : undefined
            }
            data-testid={`board-column-${column.key}`}
            aria-label={`${column.label} column`}
          >
            <div className="sticky top-0 z-10 rounded-t-xl border-b border-border bg-card px-3 py-2">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  {column.label}
                </p>
                <Badge variant="secondary">{(byStatus[column.key] ?? []).length}</Badge>
              </div>
            </div>

            <div className="p-3 space-y-2 min-h-[280px]">
              {(byStatus[column.key] ?? []).map((post) => (
                <button
                  key={post.id}
                  type="button"
                  draggable={dragEnabled}
                  onDragStart={
                    dragEnabled
                      ? (e) => {
                          e.dataTransfer.setData("text/post-id", post.id);
                          e.dataTransfer.setData("text/post-status", post.status);
                          e.dataTransfer.effectAllowed = "move";
                        }
                      : undefined
                  }
                  onClick={() => onSelectPost(post.id)}
                  className="w-full rounded-md border border-border bg-background p-2 text-left hover:border-primary/30 hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  data-testid={`board-post-${post.id}`}
                  aria-label={`${post.platform} post: ${post.hook}`}
                >
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">
                    {post.platform}
                  </p>
                  <p className="text-sm font-medium leading-snug line-clamp-2 mt-1">{post.hook}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      {post.date ? formatDate(post.date) : "Unscheduled"}
                    </span>
                    {post.priority && (
                      <span
                        className={`inline-block size-1.5 rounded-full ${PRIORITY_STYLE[post.priority] ?? PRIORITY_STYLE.medium}`}
                        title={`Priority: ${post.priority}`}
                      />
                    )}
                  </div>
                </button>
              ))}
              {(byStatus[column.key] ?? []).length === 0 && (
                <p className="rounded-md border border-dashed border-border/70 bg-background/40 px-2 py-3 text-center text-xs text-muted-foreground">
                  No posts in {column.label}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(input: string) {
  const date = new Date(`${input}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
