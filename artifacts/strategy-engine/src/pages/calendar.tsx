import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetClient,
  useGetCalendar,
  useGenerateCalendar,
  getGetClientQueryKey,
  getGetCalendarQueryKey,
  type Planner,
  type Sow,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, RefreshCw, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CalendarGrid } from "@/components/calendar-grid";
import { PostDetailSheet } from "@/components/post-detail-sheet";
import { GenerateMonthDialog } from "@/components/generate-month-dialog";

export default function Calendar() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: clientData } = useGetClient(id, {
    query: { enabled: !!id, queryKey: getGetClientQueryKey(id) },
  });
  const { data: calendarData, isLoading: calendarLoading } = useGetCalendar(id, {
    query: { enabled: !!id, queryKey: getGetCalendarQueryKey(id) },
  });

  const generate = useGenerateCalendar({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
        toast({ title: "Calendar generated" });
        setDialogOpen(false);
      },
      onError: (err) =>
        toast({
          title: "Calendar generation failed",
          description: String(err),
          variant: "destructive",
        }),
    },
  });

  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<string | null>(null);

  const planner = calendarData?.planner ?? null;
  const allPosts = calendarData?.posts ?? [];
  const posts = platformFilter
    ? allPosts.filter((p) => p.platform === platformFilter)
    : allPosts;
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

  const noStrategy = clientData && !clientData.strategy;
  const noSow = clientData && !sow;
  const isGenerating = generate.isPending;

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border/50 bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
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
          <div className="flex items-center gap-2">
            <Link href={`/clients/${id}`}>
              <Button variant="ghost" size="sm" className="gap-2">
                <FileText className="size-4" /> Strategy
              </Button>
            </Link>
            <Link href={`/clients/${id}#sow`}>
              <Button variant="ghost" size="sm" className="gap-2">
                <Settings2 className="size-4" /> SOW
              </Button>
            </Link>
            {planner && sow && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={isGenerating}
                onClick={() => setDialogOpen(true)}
              >
                <RefreshCw className={`size-4 ${isGenerating ? "animate-spin" : ""}`} />
                New month
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        {noStrategy ? (
          <EmptyState
            title="Strategy first"
            body="Generate the brand strategy before building the content calendar — the planner needs the pillars, audience, and goals to do its work."
            cta={
              <Link href={`/clients/${id}`}>
                <Button>Open strategy</Button>
              </Link>
            }
          />
        ) : noSow ? (
          <EmptyState
            title="Set the SOW"
            body="The Statement of Work tells us how many posts per platform, the content mix, and the tone for each channel. The calendar respects it as the source of truth."
            cta={
              <Link href={`/clients/${id}#sow`}>
                <Button>Configure SOW</Button>
              </Link>
            }
          />
        ) : isGenerating || (calendarLoading && !planner) ? (
          <GeneratingState />
        ) : !planner ? (
          <EmptyState
            title="Plan the month"
            body={`We'll generate ${totalSowPosts} posts (per your SOW) across ${
              sow?.platforms.join(", ") ?? "your platforms"
            }, each with strategic intent, expected outcome, priority, and format-specific execution.`}
            cta={<Button size="lg" onClick={() => setDialogOpen(true)}>Plan the month</Button>}
          />
        ) : (
          <div className="space-y-8">
            <PlannerSummary planner={planner} />
            {sow && sow.platforms.length > 1 && (
              <PlatformFilter
                platforms={sow.platforms}
                active={platformFilter}
                onChange={setPlatformFilter}
                counts={countByPlatform(allPosts)}
              />
            )}
            <CalendarGrid
              posts={posts.map((p) => ({
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
        onConfirm={(input) =>
          id &&
          generate.mutate({
            clientId: id,
            data: {
              month: input.month,
              startDate: input.startDate,
              goal: input.goal,
              notes: input.notes,
            },
          })
        }
      />
    </div>
  );
}

function countByPlatform(posts: Array<{ platform: string }>): Record<string, number> {
  const m: Record<string, number> = {};
  for (const p of posts) m[p.platform] = (m[p.platform] ?? 0) + 1;
  return m;
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
      className={`px-3 py-1 rounded-full border text-xs transition-colors flex items-center gap-1.5 ${
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-card border-border text-muted-foreground hover:border-foreground/40"
      }`}
    >
      <span>{label}</span>
      <span className={active ? "opacity-70" : "opacity-60"}>· {count}</span>
    </button>
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
        {Object.keys(platformSplit).length > 0 && (
          <SummaryCard label="Platform split">
            {Object.entries(platformSplit).map(([k, v]) => (
              <Row key={k} label={k} value={`${v} posts`} />
            ))}
          </SummaryCard>
        )}
        <SummaryCard label="Pillar mix">
          {Object.entries(distribution).map(([k, v]) => (
            <Row key={k} label={prettify(k)} value={`${v}%`} />
          ))}
        </SummaryCard>
        <SummaryCard label="Format mix">
          {Object.entries(formats).map(([k, v]) => (
            <Row key={k} label={prettify(k)} value={`${v}%`} />
          ))}
        </SummaryCard>
        <SummaryCard label="Weekly flow">
          {Object.entries(weeklyFlow).map(([k, v]) => (
            <Row key={k} label={prettify(k)} value={v} />
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
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-3">
        {label}
      </p>
      <div className="space-y-1.5 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground truncate">{label}</span>
      <span className="text-foreground font-medium text-right">{value}</span>
    </div>
  );
}

function prettify(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="relative size-12 mb-6">
        <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
      </div>
      <h3 className="font-serif text-xl mb-2">Building your month</h3>
      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
        Designing the planner layer, picking angles per pillar, and writing every post end-to-end.
        This usually takes 30–90 seconds.
      </p>
    </div>
  );
}
