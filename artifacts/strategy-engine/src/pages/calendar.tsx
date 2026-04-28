import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetClient,
  useGetCalendar,
  useGenerateCalendar,
  useUpdatePost,
  getGetClientQueryKey,
  getGetCalendarQueryKey,
  type Planner,
  type Sow,
  type UpdatePostInputStatus,
  ApiError,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, RefreshCw, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CalendarGrid } from "@/components/calendar-grid";
import { CalendarBoard } from "@/components/calendar-board";
import { PostDetailSheet } from "@/components/post-detail-sheet";
import { GenerateMonthDialog } from "@/components/generate-month-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { RuntimeModeBanner } from "@/components/runtime-mode-banner";
import { CalendarKpiCards } from "@/components/calendar-kpi-cards";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  allSectionsApproved,
  CANONICAL_SECTION_LABELS,
  getPendingApprovalSections,
  getWeekLabelFromDate,
  isSowComplete,
  type CanonicalSectionKey,
} from "@/lib/strategy-workflow";
import { confirmPreflightLimit, estimateBytes, estimateTokens } from "@/lib/request-preflight";

type CalendarDiagnostics = {
  strategySource?: string | null;
  strategyUpdatedAt?: string | null;
  plannerSource?: string | null;
  plannerCreatedAt?: string | null;
  needsRegeneration?: boolean;
  reason?: string | null;
};

export default function Calendar() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: clientData,
    isLoading: clientLoading,
    isError: clientError,
    error: clientErrorDetail,
    refetch: refetchClient,
  } = useGetClient(id, {
    query: { enabled: !!id, queryKey: getGetClientQueryKey(id) },
  });
  const { data: calendarData, isLoading: calendarLoading } = useGetCalendar(id, {
    query: { enabled: !!id, queryKey: getGetCalendarQueryKey(id) },
  });

  const generate = useGenerateCalendar({
    mutation: {
      retry: 1,
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: ["runtime-health-mode"] });
        toast({ title: "Calendar generated" });
        setDialogOpen(false);
      },
      onError: (err) => {
        const data = err instanceof ApiError ? (err.data as { code?: string; error?: string } | null) : null;
        const noProvider =
          data?.code === "NO_USABLE_AI_PROVIDER" ||
          (typeof (err as Error)?.message === "string" && (err as Error).message.includes("NO_USABLE_AI_PROVIDER"));
        toast({
          title: noProvider ? "No AI provider configured" : "Could not finish calendar generation",
          description: noProvider
            ? (data?.error ??
              "Configure a working AI provider in AI settings, add server API keys, or turn off “Use real AI” for demo mode.")
            : "Please retry. If this repeats, check API/runtime logs.",
          variant: "destructive",
        });
      },
    },
  });

  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<string | null>(null);
  const [pillarFilter, setPillarFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [weekFilter, setWeekFilter] = useState<string | null>(null);
  const [view, setView] = useState<"planner" | "calendar" | "board">(() => getInitialView());
  const [schedulePrompt, setSchedulePrompt] = useState<{ postId: string; date: string } | null>(null);
  const [isTouchLike, setIsTouchLike] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const touchMatch = window.matchMedia("(pointer: coarse)");
    const updateTouchMode = () => setIsTouchLike(touchMatch.matches);
    updateTouchMode();
    touchMatch.addEventListener("change", updateTouchMode);
    return () => touchMatch.removeEventListener("change", updateTouchMode);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [view]);

  const updatePost = useUpdatePost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey(id) });
      },
      onError: (err) =>
        toast({
          title: "Could not update post",
          description: String(err),
          variant: "destructive",
        }),
    },
  });

  const planner = calendarData?.planner ?? null;
  const plannerMeta = (planner?.metadata as
    | {
        calendarSource?: string;
        generationMode?: string;
        providerAttempted?: boolean;
      }
    | null
    | undefined) ?? null;
  const plannerSource = String(plannerMeta?.calendarSource ?? "");
  const providerAttempted = Boolean(plannerMeta?.providerAttempted);
  const isImportedDeterministic =
    plannerSource === "chatgpt_import" || plannerMeta?.generationMode === "imported_deterministic";
  const calendarDiagnostics =
    ((calendarData as unknown as { diagnostics?: CalendarDiagnostics } | null)?.diagnostics ?? null);
  const calendarIsTemplate = plannerSource === "fallback";
  const needsRegeneration = Boolean(calendarDiagnostics?.needsRegeneration);
  const showTemplateUi = calendarIsTemplate && providerAttempted && !needsRegeneration && !isImportedDeterministic;
  const allPosts = calendarData?.posts ?? [];
  const filteredPosts = allPosts.filter((p) => {
    if (platformFilter && p.platform !== platformFilter) return false;
    if (pillarFilter && p.pillar !== pillarFilter) return false;
    if (statusFilter && p.status !== statusFilter) return false;
    if (weekFilter && getWeekLabelFromDate(p.date) !== weekFilter) return false;
    return true;
  });
  const sow = (clientData?.client.sow ?? null) as Sow | null;
  const totalSowPosts = sow
    ? Object.values(sow.monthlyPosts as Record<string, number>).reduce(
        (a, b) => a + (Number(b) || 0),
        0,
      )
    : 0;

  const pillars = useMemo(
    () =>
      (planner?.pillars ?? []).map((p) => ({
        name: String(p.name ?? ""),
        color: String(p.color ?? "#9CA3AF"),
        description: p.description ? String(p.description) : "",
      })),
    [planner],
  );
  const openPost = allPosts.find((p) => p.id === openPostId) ?? null;
  const openPillar = openPost ? pillars.find((p) => p.name === openPost.pillar) : null;
  const pillarCounts = countByKey(allPosts, (p) => p.pillar);
  const statusCounts = countByKey(allPosts, (p) => p.status);

  function moveBoardPost(postId: string, toStatus: string) {
    const post = allPosts.find((p) => p.id === postId);
    if (!post) return;
    if (toStatus === "scheduled" && !post.date) {
      const today = new Date().toISOString().slice(0, 10);
      setSchedulePrompt({ postId, date: today });
      return;
    }
    updatePost.mutate({ postId, data: { status: toStatus as UpdatePostInputStatus } });
  }

  function confirmScheduledMove() {
    if (!schedulePrompt) return;
    updatePost.mutate({
      postId: schedulePrompt.postId,
      data: { status: "scheduled" as UpdatePostInputStatus, date: schedulePrompt.date },
    });
    setSchedulePrompt(null);
  }

  const noStrategy = clientData && !clientData.strategy;
  const strategyStructured = clientData?.strategy?.structuredStrategy as Record<string, unknown> | undefined;
  const strategyMeta = strategyStructured?.__meta as
    | {
        strategySource?: string;
        sectionApprovals?: Record<string, boolean>;
        aiFailure?: { message?: string };
      }
    | undefined;
  const isStrategyTemplate = strategyMeta?.strategySource === "fallback";
  const strategyApprovals = strategyMeta?.sectionApprovals;
  const pendingSections = getPendingApprovalSections(strategyApprovals as Record<CanonicalSectionKey, boolean>);
  const missingSectionApprovals = !allSectionsApproved(
    strategyApprovals as Record<CanonicalSectionKey, boolean>,
  );
  const noSow = clientData && !isSowComplete(sow as unknown as Record<string, unknown>);
  const isGenerating = generate.isPending;

  function confirmCalendarPreflight(input: {
    month: string;
    startDate: string;
    goal: string;
    notes: string;
  }): boolean {
    const payload = {
      month: input.month,
      startDate: input.startDate,
      goal: input.goal,
      notes: input.notes,
    };
    const estimatedPromptTokens = estimateTokens({
      payload,
      sow: compactSowForPreflight(clientData?.client?.sow ?? null),
      structuredStrategy: compactStrategyForPreflight(clientData?.strategy?.structuredStrategy ?? null),
      oneLineDescription: clientData?.client?.oneLineDescription ?? "",
    });
    return confirmPreflightLimit({
      context: "Calendar generation preflight",
      estimatedTokens: estimatedPromptTokens,
      estimatedBytes: estimateBytes(payload),
      tokenThreshold: 1900,
      byteThreshold: 48 * 1024,
    });
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border/50 bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <Link
              href={`/clients/${id}`}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="font-serif text-xl tracking-tight text-foreground truncate">
                {clientData?.client.name ?? "..."}
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {planner?.month ? `${planner.month} · Content Calendar` : "Content Calendar"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap w-full lg:w-auto">
            <div className="inline-flex rounded-md border border-border p-0.5 mr-0 sm:mr-2" role="group" aria-label="Calendar view switcher">
              <Button
                type="button"
                size="sm"
                variant={view === "planner" ? "default" : "ghost"}
                onClick={() => setView("planner")}
                className="h-7 px-3"
                data-testid="calendar-view-toggle-planner"
                aria-pressed={view === "planner"}
              >
                Content Planner
              </Button>
              <Button
                type="button"
                size="sm"
                variant={view === "calendar" ? "default" : "ghost"}
                onClick={() => setView("calendar")}
                className="h-7 px-3"
                data-testid="calendar-view-toggle-calendar"
                aria-pressed={view === "calendar"}
              >
                Calendar
              </Button>
              <Button
                type="button"
                size="sm"
                variant={view === "board" ? "default" : "ghost"}
                onClick={() => setView("board")}
                className="h-7 px-3"
                data-testid="calendar-view-toggle-board"
                aria-pressed={view === "board"}
              >
                Board
              </Button>
            </div>
            <Link href={`/clients/${id}`}>
              <Button variant="ghost" size="sm" className="gap-2 w-full sm:w-auto">
                <FileText className="size-4" /> Strategy
              </Button>
            </Link>
            <Link href={`/clients/${id}#sow`}>
              <Button variant="ghost" size="sm" className="gap-2 w-full sm:w-auto">
                <Settings2 className="size-4" /> SOW
              </Button>
            </Link>
            {planner && sow && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 w-full sm:w-auto"
                disabled={isGenerating || missingSectionApprovals}
                onClick={() => setDialogOpen(true)}
                data-testid="new-month-button"
              >
                <RefreshCw className={`size-4 ${isGenerating ? "animate-spin" : ""}`} />
                New month
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <RuntimeModeBanner suppressAiDiagnostics={isImportedDeterministic} />
        {clientError ? (
          <EmptyState
            title="Could not load client data"
            body={String(clientErrorDetail ?? "Please retry loading this client.")}
            cta={<Button onClick={() => void refetchClient()}>Retry</Button>}
          />
        ) : noStrategy ? (
          <EmptyState
            title="Strategy first"
            body="Generate the brand strategy before building the content calendar — the planner needs the pillars, audience, and goals to do its work."
            cta={
              <Link href={`/clients/${id}`}>
                <Button>Open strategy</Button>
              </Link>
            }
          />
        ) : isStrategyTemplate ? (
          <EmptyState
            title="Strategy is not ready for a production calendar"
            body={`The saved strategy is a safety template (the model could not return valid output, or real AI is off). Next step: open Strategy, fix SOW/inputs and provider if needed, then use Generate strategy. ${strategyMeta?.aiFailure?.message ? `Details: ${strategyMeta.aiFailure.message}` : ""}`.trim()}
            cta={
              <Link href={`/clients/${id}`}>
                <Button>Go to strategy & regenerate</Button>
              </Link>
            }
          />
        ) : noSow ? (
          <EmptyState
            title="Complete and approve SOW first"
            body="Content creation is blocked until SOW is fully completed and approved. Fill all required SOW sections and approve it before generating the content calendar."
            cta={
              <Link href={`/clients/${id}#sow`}>
                <Button>Complete SOW</Button>
              </Link>
            }
          />
        ) : missingSectionApprovals ? (
          <EmptyState
            title="Strategy approvals required"
            body={`The calendar is built on top of a locked-in strategy. Open Strategy and mark every section as approved (or edit a section and save) before “Plan the month” or “New month” is available. Still waiting on: ${pendingSections
              .map((key) => CANONICAL_SECTION_LABELS[key])
              .join(", ")}.`}
            cta={
              <Link href={`/clients/${id}`}>
                <Button>Review strategy approvals</Button>
              </Link>
            }
          />
        ) : isGenerating || (calendarLoading && !planner) || (clientLoading && !clientData) ? (
          <GeneratingState />
        ) : !planner ? (
          <EmptyState
            title="Plan the month"
            body={`We'll generate ${totalSowPosts} posts (per your SOW) across ${
              sow?.platforms.join(", ") ?? "your platforms"
            }, each with strategic intent, expected outcome, priority, and format-specific execution.`}
            cta={<Button size="lg" onClick={() => setDialogOpen(true)} data-testid="plan-month-button">Plan the month</Button>}
          />
        ) : (
          <div className="space-y-8">
            {needsRegeneration && (
              <Alert className="border-blue-300 bg-blue-50/90 text-blue-950" data-testid="calendar-import-regenerate-banner">
                <AlertTitle>Imported strategy detected</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    The current calendar is from an older run ({calendarDiagnostics?.plannerSource ?? "unknown"}).
                    Click <strong>Plan the month</strong> or <strong>New month</strong> to regenerate from your imported ChatGPT strategy.
                  </p>
                  {calendarDiagnostics?.reason ? (
                    <p className="text-xs font-mono opacity-80">diagnostic: {calendarDiagnostics.reason}</p>
                  ) : null}
                </AlertDescription>
              </Alert>
            )}
            {showTemplateUi && (
              <Alert
                className="border-amber-400 bg-amber-50/90 text-amber-950"
                data-testid="calendar-template-not-production-banner"
              >
                <AlertTitle>Not a production calendar</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    This month was generated as a <strong>dev / template fallback</strong> because the AI call did not
                    return usable JSON, credits/limits blocked the request, or real AI is off. Do not treat these posts
                    as client deliverables.
                  </p>
                  <p className="text-sm">
                    <strong>Next step:</strong> from Strategy, confirm a real model run, use{" "}
                    <strong>Plan the month</strong> again (or adjust goal/notes to reduce prompt size), or turn on
                    real AI in server settings.
                  </p>
                </AlertDescription>
              </Alert>
            )}
            {planner && !needsRegeneration && !isImportedDeterministic && (
              <CalendarGenerationBanner
                planner={planner}
                calendarIsTemplate={calendarIsTemplate}
                providerAttempted={providerAttempted}
              />
            )}
            <div
              className={
                showTemplateUi
                  ? "rounded-xl border-2 border-dashed border-amber-300/80 bg-muted/20 p-3 sm:p-4 space-y-6"
                  : "space-y-6"
              }
            >
              {showTemplateUi && (
                <p
                  className="text-center text-xs font-semibold uppercase tracking-wider text-amber-900"
                  data-testid="calendar-dev-preview-label"
                >
                  Dev / QA preview only — template output
                </p>
              )}
              <SharedFilters
                platformOptions={sow?.platforms ?? []}
                pillarOptions={Object.keys(pillarCounts)}
                platformFilter={platformFilter}
                pillarFilter={pillarFilter}
                statusFilter={statusFilter}
                weekFilter={weekFilter}
                onPlatformChange={setPlatformFilter}
                onPillarChange={setPillarFilter}
                onStatusChange={setStatusFilter}
                onWeekChange={setWeekFilter}
                onReset={() => {
                  setPlatformFilter(null);
                  setPillarFilter(null);
                  setStatusFilter(null);
                  setWeekFilter(null);
                }}
                platformCounts={countByPlatform(allPosts)}
                pillarCounts={pillarCounts}
                statusCounts={statusCounts}
              />
              {view === "calendar" ? (
                <CalendarGrid
                  posts={filteredPosts.map((p) => ({
                    id: p.id,
                    date: p.date,
                    pillar: p.pillar,
                    format: p.format,
                    hook: p.hook,
                    status: p.status,
                    platform: p.platform,
                    priority: (p.priority ?? "medium") as string,
                  }))}
                  pillars={pillars}
                  clientId={id ?? ""}
                  onSelectPost={setOpenPostId}
                />
              ) : view === "board" ? (
                <CalendarBoard
                  posts={filteredPosts.map((p) => ({
                    id: p.id,
                    hook: p.hook,
                    platform: p.platform,
                    date: p.date,
                    status: p.status,
                    priority: p.priority,
                  }))}
                  onSelectPost={setOpenPostId}
                  onMovePost={moveBoardPost}
                  dragEnabled={!isTouchLike}
                />
              ) : (
                <PlannerSummary planner={planner} />
              )}
            </div>
          </div>
        )}
      </main>

      <PostDetailSheet
        open={!!openPostId}
        onOpenChange={(o) => !o && setOpenPostId(null)}
        post={openPost as never}
        clientId={id ?? ""}
        pillarColor={openPillar?.color ?? "#9CA3AF"}
        pillarDescription={openPillar?.description}
      />

      <GenerateMonthDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        totalPosts={totalSowPosts}
        isPending={isGenerating}
        onConfirm={(input) => {
          if (!id) return;
          if (!confirmCalendarPreflight(input)) return;
          generate.mutate({
            clientId: id,
            data: {
              month: input.month,
              startDate: input.startDate,
              goal: input.goal,
              notes: input.notes,
            },
          });
        }}
      />
      <Dialog
        open={!!schedulePrompt}
        onOpenChange={(open) => {
          if (!open) setSchedulePrompt(null);
        }}
      >
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle>Pick a scheduled date</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Scheduled posts require a date. Choose one to complete the move.
            </p>
            <Input
              type="date"
              value={schedulePrompt?.date ?? ""}
              onChange={(e) =>
                setSchedulePrompt((prev) => (prev ? { ...prev, date: e.target.value } : prev))
              }
              data-testid="schedule-date-required-input"
              aria-label="Scheduled date"
            />
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setSchedulePrompt(null)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button
              onClick={confirmScheduledMove}
              disabled={!schedulePrompt?.date || updatePost.isPending}
              data-testid="schedule-date-required-confirm"
              className="w-full sm:w-auto"
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function compactSowForPreflight(sow: unknown): Record<string, unknown> | null {
  if (!sow || typeof sow !== "object") return null;
  const input = sow as Record<string, unknown>;
  const deliverables = Array.isArray(input.deliverables)
    ? input.deliverables
        .map((value) => String(value).trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  return {
    understandingOfRequirements: String(input.understandingOfRequirements ?? "").slice(0, 1200),
    strategyLaunchPlanning: String(input.strategyLaunchPlanning ?? "").slice(0, 1200),
    contentCreation: String(input.contentCreation ?? "").slice(0, 1200),
    scopeOfWork: String(input.scopeOfWork ?? "").slice(0, 900),
    deliverables,
    platforms: Array.isArray(input.platforms) ? input.platforms.slice(0, 6) : [],
    monthlyPosts: input.monthlyPosts ?? {},
    contentMix: input.contentMix ?? {},
  };
}

function compactStrategyForPreflight(structured: unknown): Record<string, unknown> | null {
  if (!structured || typeof structured !== "object") return null;
  const input = structured as Record<string, unknown>;
  return {
    market_narrative: input.market_narrative ?? null,
    audience: input.audience ?? null,
    platform_strategy: input.platform_strategy ?? null,
    content_strategy: input.content_strategy ?? null,
    kpis: input.kpis ?? null,
    phases: Array.isArray(input.phases) ? input.phases.slice(0, 3) : [],
  };
}

function countByPlatform(posts: Array<{ platform: string }>): Record<string, number> {
  const m: Record<string, number> = {};
  for (const p of posts) m[p.platform] = (m[p.platform] ?? 0) + 1;
  return m;
}

function getInitialView(): "planner" | "calendar" | "board" {
  if (typeof window === "undefined") return "planner";
  const value = new URLSearchParams(window.location.search).get("view");
  if (value === "calendar" || value === "board" || value === "planner") return value;
  return "planner";
}

function countByKey<T>(items: T[], getKey: (item: T) => string | null | undefined) {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function PlatformFilter({
  platforms,
  active,
  onChange,
  counts,
}: {
  platforms: string[];
  active: string | null;
  onChange: (p: string | null) => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-xs uppercase tracking-wider text-muted-foreground mr-1">
        Filter:
      </span>
      <FilterChip label="All" count={Object.values(counts).reduce((a, b) => a + b, 0)} active={active === null} onClick={() => onChange(null)} />
      {platforms.map((p) => (
        <FilterChip
          key={p}
          label={p}
          count={counts[p] ?? 0}
          active={active === p}
          onClick={() => onChange(p)}
        />
      ))}
    </div>
  );
}

function SharedFilters({
  platformOptions,
  pillarOptions,
  platformFilter,
  pillarFilter,
  statusFilter,
  weekFilter,
  onPlatformChange,
  onPillarChange,
  onStatusChange,
  onWeekChange,
  onReset,
  platformCounts,
  pillarCounts,
  statusCounts,
}: {
  platformOptions: string[];
  pillarOptions: string[];
  platformFilter: string | null;
  pillarFilter: string | null;
  statusFilter: string | null;
  weekFilter: string | null;
  onPlatformChange: (p: string | null) => void;
  onPillarChange: (p: string | null) => void;
  onStatusChange: (s: string | null) => void;
  onWeekChange: (week: string | null) => void;
  onReset: () => void;
  platformCounts: Record<string, number>;
  pillarCounts: Record<string, number>;
  statusCounts: Record<string, number>;
}) {
  const statusOptions: string[] = [
    "draft",
    "pending_approval",
    "needs_changes",
    "approved",
    "scheduled",
    "published" as UpdatePostInputStatus,
  ];
  const weekOptions = ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"];
  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Filters</span>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onReset}>
          Reset
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 min-w-0">
        <PlatformFilter
          platforms={platformOptions}
          active={platformFilter}
          onChange={onPlatformChange}
          counts={platformCounts}
        />
        <PillarsFilter
          pillars={pillarOptions}
          active={pillarFilter}
          onChange={onPillarChange}
          counts={pillarCounts}
        />
        <StatusFilter
          statuses={statusOptions}
          active={statusFilter}
          onChange={onStatusChange}
          counts={statusCounts}
        />
        <WeekFilter active={weekFilter} onChange={onWeekChange} options={weekOptions} />
      </div>
    </div>
  );
}

function WeekFilter({
  active,
  onChange,
  options,
}: {
  active: string | null;
  onChange: (week: string | null) => void;
  options: string[];
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <FilterChip
        label="All weeks"
        count={0}
        active={active === null}
        onClick={() => onChange(null)}
      />
      {options.map((week) => (
        <FilterChip
          key={week}
          label={week}
          count={0}
          active={active === week}
          onClick={() => onChange(week)}
        />
      ))}
    </div>
  );
}

function PillarsFilter({
  pillars,
  active,
  onChange,
  counts,
}: {
  pillars: string[];
  active: string | null;
  onChange: (p: string | null) => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <FilterChip
        label="All pillars"
        count={Object.values(counts).reduce((a, b) => a + b, 0)}
        active={active === null}
        onClick={() => onChange(null)}
      />
      {pillars.map((p) => (
        <FilterChip
          key={p}
          label={prettify(p)}
          count={counts[p] ?? 0}
          active={active === p}
          onClick={() => onChange(p)}
        />
      ))}
    </div>
  );
}

function StatusFilter({
  statuses,
  active,
  onChange,
  counts,
}: {
  statuses: string[];
  active: string | null;
  onChange: (s: string | null) => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <FilterChip
        label="All statuses"
        count={Object.values(counts).reduce((a, b) => a + b, 0)}
        active={active === null}
        onClick={() => onChange(null)}
      />
      {statuses.map((s) => (
        <FilterChip
          key={s}
          label={prettify(s)}
          count={counts[s] ?? 0}
          active={active === s}
          onClick={() => onChange(s)}
        />
      ))}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1 rounded-full border text-xs transition-colors flex items-center gap-1.5 ${
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-card border-border text-muted-foreground hover:border-foreground/40"
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
    >
      <span>{label}</span>
      <span className={active ? "opacity-70" : "opacity-60"}>· {count}</span>
    </button>
  );
}

function CalendarGenerationBanner({
  planner,
  calendarIsTemplate,
  providerAttempted,
}: {
  planner: Planner;
  /** When true, the page already shows the amber “not production” banner — keep this block technical only. */
  calendarIsTemplate?: boolean;
  providerAttempted?: boolean;
}) {
  const meta = ((planner as Planner & { metadata?: Record<string, unknown> | null }).metadata ?? null) as {
    calendarSource?: string;
    calendarAiFailure?: { code?: string; message?: string; detail?: string };
  } | null;
  const isFallback = meta?.calendarSource === "fallback";
  const failure = meta?.calendarAiFailure;
  if ((!isFallback && !failure?.message) || !providerAttempted) return null;
  return (
    <Alert className="border-sky-200 bg-sky-50/80 text-sky-950" data-testid="calendar-fallback-technical-banner">
      <AlertTitle>{calendarIsTemplate ? "Provider / request detail" : "Calendar: template or backup plan"}</AlertTitle>
      <AlertDescription className="space-y-1.5">
        {!calendarIsTemplate && (
          <p>
            This month’s calendar may be a <strong>safe template</strong> when the model returned empty or invalid
            JSON, or when real AI is disabled.
          </p>
        )}
        {failure?.message && <p className="text-xs opacity-90 font-mono">{failure.message}</p>}
        <p className="text-xs text-muted-foreground">
          Large monthly prompts can exceed provider limits or max output — try a roomier model, raise max tokens, or
          shorten goal/notes.
        </p>
      </AlertDescription>
    </Alert>
  );
}

function PlannerSummary({ planner }: { planner: Planner }) {
  const distribution = (planner.distribution ?? {}) as Record<string, number>;
  const formats = (planner.formats ?? {}) as Record<string, number>;
  const platformSplit = (planner.platformSplit ?? {}) as Record<string, number>;
  const weeklyFlow = (planner.weeklyFlow ?? {}) as Record<string, string>;
  const hookStyles = (planner.hookStyles ?? []) as string[];
  const kpis = (planner.kpis ?? {}) as Record<string, string>;
  const goal = planner.goal;

  return (
    <div className="space-y-4">
      {goal && (
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
            Monthly goal
          </p>
          <p className="font-serif text-lg leading-snug">{goal}</p>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <CalendarKpiCards
          platformSplit={platformSplit}
          distribution={distribution}
          formats={formats}
        />
        <SummaryCard label="Weekly flow">
          {Object.entries(weeklyFlow).map(([k, v]) => (
            <Row key={k} label={prettify(k)} value={weeklyFlowDisplayValue(k, v)} />
          ))}
        </SummaryCard>
        {Object.keys(kpis).length > 0 && (
          <SummaryCard label="KPIs">
            {Object.entries(kpis).map(([k, v]) => (
              <Row key={k} label={prettify(k)} value={v} />
            ))}
          </SummaryCard>
        )}
        <SummaryCard label="Hook styles">
          <div className="flex flex-wrap gap-1.5 pt-1">
            {hookStyles.map((h) => (
              <span
                key={h}
                className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground"
              >
                {h}
              </span>
            ))}
          </div>
        </SummaryCard>
      </div>
    </div>
  );
}

function SummaryCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wider text-foreground font-bold mb-3">
        {label}
      </p>
      <div className="space-y-2 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-muted/25 px-2.5 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-foreground font-semibold leading-snug">{label}</span>
      <span className="text-foreground/85 font-medium leading-snug text-left sm:text-right">{value}</span>
    </div>
  );
}

function prettify(s: string) {
  const spaced = s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : s;
}

/** Avoids "Week 1" + value "Week 1: …" duplicate semantics in the planner summary. */
function weeklyFlowDisplayValue(weekKey: string, raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  const m = weekKey.match(/(\d+)/);
  const n = m?.[1];
  if (n) {
    const stripped = v.replace(new RegExp(`^\\s*Week\\s*${n}\\s*[:.,)\\-–—]*\\s*`, "i"), "").trim();
    if (stripped) return stripped;
  }
  const generic = v.replace(/^\s*Week\s+\d+\s*[:.,)\-–—]*\s*/i, "").trim();
  return generic || v;
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: React.ReactNode;
}) {
  return (
    <div className="border border-dashed border-border rounded-xl bg-card/40 py-24 px-6 flex flex-col items-center text-center">
      <h2 className="font-serif text-2xl tracking-tight mb-3">{title}</h2>
      <p className="text-muted-foreground max-w-md leading-relaxed mb-6">{body}</p>
      {cta}
    </div>
  );
}

function GeneratingState() {
  const [phase, setPhase] = useState(0);
  const phases = [
    "Fetching website + Instagram context…",
    "Generating planner scaffold…",
    "Generating week 1/4…",
    "Generating week 2/4…",
    "Generating week 3/4…",
    "Generating week 4/4…",
  ];
  useEffect(() => {
    const id = setInterval(() => {
      setPhase((p) => (p + 1) % phases.length);
    }, 3000);
    return () => clearInterval(id);
  }, [phases.length]);
  return (
    <div className="space-y-6">
      <p className="text-sm font-medium text-foreground" data-testid="calendar-generating-timer">
        Usually takes 2–3 minutes
      </p>
      <p className="text-sm text-muted-foreground">{phases[phase]}</p>
      <p className="text-xs text-muted-foreground/90">
        If the connection briefly retries, generation continues automatically.
      </p>
      <div className="rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-4 w-28 mb-3" />
        <Skeleton className="h-7 w-80 mb-2" />
        <Skeleton className="h-4 w-[32rem]" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <Skeleton className="h-3 w-20 mb-3" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <Skeleton className="h-5 w-36" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
