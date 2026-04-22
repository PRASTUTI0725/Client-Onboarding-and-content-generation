import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdatePost,
  getGetCalendarQueryKey,
  type UpdatePostInputStatus,
} from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

interface PostLike {
  id: string;
  date: string;
  platform: string;
  pillar: string;
  angle: string;
  format: string;
  objective: string;
  hook: string;
  cta: string;
  caption?: string | null;
  hashtags?: string[] | null;
  status: string;
  comments?: Array<{ author?: string; text: string; createdAt?: string }>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: PostLike | null;
  clientId: string;
  pillarColor: string;
  pillarDescription?: string;
}

const STATUS_LABELS: Record<UpdatePostInputStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending review",
  approved: "Approved",
  needs_changes: "Needs changes",
  scheduled: "Scheduled",
};

export function PostDetailSheet({
  open,
  onOpenChange,
  post,
  clientId,
  pillarColor,
  pillarDescription,
}: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const update = useUpdatePost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey(clientId) });
      },
      onError: (err) =>
        toast({
          title: "Could not update post",
          description: String(err),
          variant: "destructive",
        }),
    },
  });

  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!open) setComment("");
  }, [open]);

  if (!post) return null;

  const setStatus = (status: UpdatePostInputStatus) =>
    update.mutate({ postId: post.id, data: { status } });

  const submitComment = () => {
    if (!comment.trim()) return;
    update.mutate(
      { postId: post.id, data: { addComment: { text: comment.trim() } } },
      {
        onSuccess: () => {
          setComment("");
          toast({ title: "Comment added" });
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="space-y-3 pb-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <span>{formatDate(post.date)}</span>
            <span className="text-border">·</span>
            <span>{post.platform}</span>
            <span className="text-border">·</span>
            <span>{post.format}</span>
          </div>
          <SheetTitle className="font-serif text-2xl leading-snug tracking-tight">
            {post.hook}
          </SheetTitle>
          <SheetDescription>
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium"
              style={{ color: pillarColor }}
            >
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: pillarColor }}
              />
              {post.pillar}
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 pt-2">
          <Field label="Angle">
            <p className="text-sm leading-relaxed">{post.angle}</p>
          </Field>

          <Field label="Objective">
            <p className="text-sm leading-relaxed text-foreground/80">
              {post.objective}
            </p>
          </Field>

          <Field label="CTA">
            <p className="text-sm font-medium leading-relaxed">{post.cta}</p>
          </Field>

          {post.caption && (
            <Field label="Caption">
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/80">
                {post.caption}
              </p>
            </Field>
          )}

          {post.hashtags && post.hashtags.length > 0 && (
            <Field label="Hashtags">
              <div className="flex flex-wrap gap-1.5">
                {post.hashtags.map((h) => (
                  <Badge key={h} variant="secondary" className="font-normal">
                    {h.startsWith("#") ? h : `#${h}`}
                  </Badge>
                ))}
              </div>
            </Field>
          )}

          <Separator />

          <Field label="Strategy context">
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium" style={{ color: pillarColor }}>
                {post.pillar}
              </p>
              {pillarDescription && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {pillarDescription}
                </p>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                Supports the {post.pillar.toLowerCase()} pillar via the{" "}
                <span className="text-foreground/80">{post.angle}</span> angle.
              </p>
            </div>
          </Field>

          <Separator />

          <Field label="Status">
            <div className="flex flex-wrap gap-2">
              {(Object.entries(STATUS_LABELS) as Array<[UpdatePostInputStatus, string]>).map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={post.status === key ? "default" : "outline"}
                  onClick={() => setStatus(key)}
                  disabled={update.isPending}
                >
                  {label}
                </Button>
              ))}
            </div>
          </Field>

          <Separator />

          <Field label="Comments">
            <div className="space-y-3">
              {(post.comments ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  No comments yet.
                </p>
              )}
              {(post.comments ?? []).map((c, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border bg-card p-3 text-sm space-y-1"
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{c.author ?? "Strategist"}</span>
                    {c.createdAt && (
                      <span>{formatDate(c.createdAt.slice(0, 10))}</span>
                    )}
                  </div>
                  <p className="text-foreground/80 leading-relaxed">{c.text}</p>
                </div>
              ))}
              <div className="space-y-2">
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a note for the team..."
                  rows={2}
                />
                <Button
                  size="sm"
                  onClick={submitComment}
                  disabled={update.isPending || !comment.trim()}
                >
                  Add comment
                </Button>
              </div>
            </div>
          </Field>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </p>
      {children}
    </div>
  );
}

function formatDate(d: string): string {
  const date = new Date(d + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
