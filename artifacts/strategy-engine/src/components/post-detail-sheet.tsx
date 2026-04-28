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
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { normalizePostDetail } from "@/lib/post-detail";
import { ExecutionDetail } from "./execution-detail";

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
  strategicIntent?: string | null;
  expectedMetric?: string | null;
  expectedReason?: string | null;
  priority?: "high" | "medium" | "low" | string | null;
  execution?: Record<string, unknown> | null;
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

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending review",
  approved: "Approved",
  needs_changes: "Needs changes",
  scheduled: "Scheduled",
  published: "Published",
};

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-destructive/10 text-destructive border-destructive/30",
  medium: "bg-primary/10 text-primary border-primary/30",
  low: "bg-muted text-muted-foreground border-border",
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

  const detail = normalizePostDetail(post);
  const priority = (post.priority ?? "medium") as "high" | "medium" | "low";

  const setStatus = (status: UpdatePostInputStatus) =>
    update.mutate({ postId: post.id, data: { status } });

  const setPriority = (nextPriority: "high" | "medium" | "low") =>
    update.mutate({ postId: post.id, data: { priority: nextPriority } });

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
      <SheetContent className="w-full overflow-y-auto px-4 sm:max-w-xl sm:px-6">
        <SheetHeader className="space-y-3 pb-2">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <span>{formatDate(post.date)}</span>
            <span className="text-border">·</span>
            <span>{post.platform}</span>
            <span className="text-border">·</span>
            <span>{post.format}</span>
            <span
              className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] tracking-wider ${
                PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.medium
              }`}
            >
              {priority}
            </span>
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
              {humanizeDisplay(post.pillar)}
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 pt-2">
          <Field label="Post overview">
            <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <OverviewRow label="Angle" value={post.angle} />
                <OverviewRow label="Objective" value={post.objective} />
                <OverviewRow label="Creative type" value={humanizeDisplay(post.format)} />
                {detail.overview.map((item) => (
                  <OverviewRow key={item.label} label={item.label} value={item.value} />
                ))}
              </div>
            </div>
          </Field>

          <Field label="Caption">
            <div className="space-y-3" data-testid="post-detail-caption">
              <div className="flex flex-wrap gap-2">
                {detail.caption.structure.map((step) => (
                  <span
                    key={step}
                    className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    {step}
                  </span>
                ))}
              </div>
              <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
                  {detail.caption.text}
                </p>
              </div>
            </div>
          </Field>

          <Field label="Hashtags">
            <div className="space-y-3" data-testid="post-detail-hashtags">
              <HashtagGroup label="Niche" tags={detail.hashtags.niche} testId="post-detail-hashtags-niche" />
              <HashtagGroup
                label="Problem"
                tags={detail.hashtags.problem}
                testId="post-detail-hashtags-problem"
              />
              <HashtagGroup label="Broad" tags={detail.hashtags.broad} testId="post-detail-hashtags-broad" />
            </div>
          </Field>

          <Separator />

          <Field label="Execution plan">
            <ExecutionDetail detail={detail} />
          </Field>

          <Field label="Conversion path">
            <div className="grid gap-3 md:grid-cols-3" data-testid="post-detail-conversion-path">
              <InfoCard label="Entry point" value={detail.conversionPath.entryPoint} />
              <InfoCard label="Next step" value={detail.conversionPath.nextStep} />
              <InfoCard label="Final goal" value={detail.conversionPath.finalGoal} />
            </div>
          </Field>

          <Field label="Repurpose plan">
            <div
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
              data-testid="post-detail-repurpose-plan"
            >
              <ol className="space-y-2">
                {detail.repurposePlan.map((item, index) => (
                  <li
                    key={`${item}-${index}`}
                    className="flex gap-3 text-sm leading-relaxed text-foreground/85"
                  >
                    <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Field>

          <Field label="Timeline">
            <div className="grid gap-3 sm:grid-cols-2" data-testid="post-detail-timeline">
              {detail.timeline.map((item) => (
                <InfoCard key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
          </Field>

          <Field label="Dependencies">
            <div
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
              data-testid="post-detail-dependencies"
            >
              <div className="flex flex-wrap gap-2">
                {detail.dependencies.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-border bg-muted/35 px-3 py-1.5 text-xs font-medium text-foreground/80"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </Field>

          <Field label="Feedback">
            <div
              className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm"
              data-testid="post-detail-feedback"
            >
              <DecisionRow label="Feedback type" value={detail.feedback.type} strong />
              <DecisionRow label="Reviewer note" value={detail.feedback.comment} />
            </div>
          </Field>

          <Separator />

          <Field label="Strategy context">
            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium" style={{ color: pillarColor }}>
                {humanizeDisplay(post.pillar)}
              </p>
              {pillarDescription && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {pillarDescription}
                </p>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                Supports the {humanizeDisplay(post.pillar).toLowerCase()} pillar via the{" "}
                <span className="text-foreground/80">{post.angle}</span> angle.
              </p>
            </div>
          </Field>

          <Separator />

          <Field label="Priority">
            <div className="flex flex-wrap gap-2">
              {(["high", "medium", "low"] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={priority === value ? "default" : "outline"}
                  onClick={() => setPriority(value)}
                  disabled={update.isPending}
                  className="capitalize"
                  data-testid={`post-priority-${value}`}
                >
                  {value}
                </Button>
              ))}
            </div>
          </Field>

          <Field label="Status">
            <div className="flex flex-wrap gap-2">
              {(Object.entries(STATUS_LABELS) as Array<[UpdatePostInputStatus, string]>).map(
                ([key, label]) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={post.status === key ? "default" : "outline"}
                    onClick={() => setStatus(key)}
                    disabled={update.isPending}
                    data-testid={`post-status-${key}`}
                  >
                    {label}
                  </Button>
                ),
              )}
            </div>
          </Field>

          <Separator />

          <Field label="Comments">
            <div className="space-y-3">
              {(post.comments ?? []).length === 0 && (
                <p className="text-xs italic text-muted-foreground">No comments yet.</p>
              )}
              {(post.comments ?? []).map((entry, index) => (
                <div
                  key={index}
                  className="space-y-1 rounded-md border border-border bg-card p-3 text-sm"
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{entry.author ?? "Strategist"}</span>
                    {entry.createdAt && <span>{formatDate(entry.createdAt.slice(0, 10))}</span>}
                  </div>
                  <p className="leading-relaxed text-foreground/80">{entry.text}</p>
                </div>
              ))}
              <div className="space-y-2">
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a note for the team..."
                  rows={2}
                  data-testid="post-comment-input"
                />
                <Button
                  size="sm"
                  onClick={submitComment}
                  disabled={update.isPending || !comment.trim()}
                  data-testid="post-comment-submit"
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
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/25 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm leading-relaxed text-foreground/85">
        {value?.trim() ? value : "Not available from current inputs"}
      </p>
    </div>
  );
}

function DecisionRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm leading-relaxed ${strong ? "font-medium text-foreground/90" : "text-foreground/85"}`}>
        {value?.trim() ? value : "Not available from current inputs"}
      </p>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
      <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm leading-relaxed text-foreground/85">
        {value?.trim() ? value : "Add manual context to improve this section"}
      </p>
    </div>
  );
}

function HashtagGroup({
  label,
  tags,
  testId,
}: {
  label: string;
  tags: string[];
  testId?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm" data-testid={testId}>
      <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={`${label}-${tag}`}
            className="rounded-full border border-teal-500/20 bg-teal-500/10 px-3 py-1.5 text-xs font-semibold text-teal-700"
          >
            {tag.startsWith("#") ? tag : `#${tag}`}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function humanizeDisplay(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Not available from current inputs";
  const spaced = trimmed.replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
