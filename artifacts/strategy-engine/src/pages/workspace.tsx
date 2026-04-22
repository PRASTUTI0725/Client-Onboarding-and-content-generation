import { useState, useMemo } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { marked } from "marked";
import {
  useGetClient,
  useGenerateStrategy,
  useUpdateStrategy,
  getGetClientQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Pencil, RefreshCw, CheckCircle2, Printer, Globe, Instagram, CalendarDays } from "lucide-react";
import { GeneratingStrategy } from "@/components/generating-strategy";
import { StructuredStrategyPanel } from "@/components/structured-strategy-panel";

type TemplateChoice =
  | "auto"
  | "brand_building"
  | "performance_marketing"
  | "personal_brand"
  | "d2c_growth";

export default function Workspace() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useGetClient(id, {
    query: { enabled: !!id, queryKey: getGetClientQueryKey(id) },
  });

  const [template, setTemplate] = useState<TemplateChoice>("auto");
  const [editing, setEditing] = useState(false);
  const [draftDoc, setDraftDoc] = useState("");
  const [draftStructured, setDraftStructured] = useState("");

  const generate = useGenerateStrategy({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
        toast({ title: "Strategy ready" });
      },
      onError: (err) =>
        toast({
          title: "Generation failed",
          description: String(err),
          variant: "destructive",
        }),
    },
  });

  const update = useUpdateStrategy({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
      },
      onError: (err) =>
        toast({
          title: "Update failed",
          description: String(err),
          variant: "destructive",
        }),
    },
  });

  const docHtml = useMemo(() => {
    const doc = data?.strategy?.strategyDocument ?? "";
    if (!doc) return "";
    return marked.parse(doc, { async: false }) as string;
  }, [data?.strategy?.strategyDocument]);

  if (isLoading || !data) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <div className="max-w-5xl mx-auto px-6 py-12 space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  const { client, onboarding, strategy } = data;
  const isGenerating = generate.isPending;

  function startEdit() {
    if (!strategy) return;
    setDraftDoc(strategy.strategyDocument);
    setDraftStructured(JSON.stringify(strategy.structuredStrategy, null, 2));
    setEditing(true);
  }

  function saveEdit() {
    if (!id) return;
    let parsedStructured: Record<string, unknown> | undefined;
    try {
      parsedStructured = JSON.parse(draftStructured);
    } catch (err) {
      toast({
        title: "Invalid JSON in structured strategy",
        description: String(err),
        variant: "destructive",
      });
      return;
    }
    update.mutate(
      {
        clientId: id,
        data: {
          strategyDocument: draftDoc,
          structuredStrategy: parsedStructured,
        },
      },
      {
        onSuccess: () => {
          setEditing(false);
          toast({ title: "Saved" });
        },
      },
    );
  }

  function approveStrategy() {
    if (!id) return;
    update.mutate(
      { clientId: id, data: { status: "approved" } },
      { onSuccess: () => toast({ title: "Strategy approved" }) },
    );
  }

  function regenerate() {
    if (!id) return;
    generate.mutate({
      clientId: id,
      data: { templateType: template },
    });
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Sticky header */}
      <header className="no-print border-b border-border/50 bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="size-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="font-serif text-xl tracking-tight text-foreground truncate">
                {client.name}
              </h1>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                {strategy && (
                  <>
                    <span>v{strategy.version}</span>
                    <span className="text-border">·</span>
                    <span className="capitalize">
                      {strategy.templateType.replace(/_/g, " ")}
                    </span>
                    <span className="text-border">·</span>
                  </>
                )}
                {strategy?.status === "approved" ? (
                  <Badge variant="secondary" className="bg-green-100 text-green-800 border-transparent hover:bg-green-100">
                    Approved
                  </Badge>
                ) : strategy ? (
                  <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-transparent hover:bg-yellow-100">
                    Draft
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30">
                    Onboarded
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {strategy && !editing && (
            <div className="flex items-center gap-2">
              <Link href={`/clients/${id}/calendar`}>
                <Button variant="default" size="sm" className="gap-2">
                  <CalendarDays className="size-4" /> Calendar
                </Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={startEdit} className="gap-2">
                <Pencil className="size-4" /> Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={regenerate}
                disabled={isGenerating}
                className="gap-2"
              >
                <RefreshCw className={`size-4 ${isGenerating ? "animate-spin" : ""}`} />
                Regenerate
              </Button>
              {strategy.status !== "approved" && (
                <Button variant="outline" size="sm" onClick={approveStrategy} className="gap-2">
                  <CheckCircle2 className="size-4" /> Approve
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
                className="gap-2"
              >
                <Printer className="size-4" /> Print / PDF
              </Button>
            </div>
          )}

          {editing && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={update.isPending}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={update.isPending}>
                {update.isPending ? "Saving..." : "Save changes"}
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {isGenerating ? (
          <GeneratingStrategy />
        ) : !strategy ? (
          /* No strategy yet */
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
            <section className="space-y-8">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  Onboarding profile
                </p>
                <h2 className="font-serif text-3xl tracking-tight text-foreground mb-2">
                  {client.name}
                </h2>
                {client.oneLineDescription && (
                  <p className="text-lg text-muted-foreground leading-relaxed font-serif italic">
                    {client.oneLineDescription}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {client.website && (
                  <InfoRow icon={<Globe className="size-4" />} label="Website" value={client.website} href={client.website} />
                )}
                {client.instagramHandle && (
                  <InfoRow icon={<Instagram className="size-4" />} label="Instagram" value={client.instagramHandle} />
                )}
              </div>

              {onboarding?.enrichedData && (
                <div className="border-t border-border/60 pt-8">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mb-4">
                    Previous enrichment
                  </p>
                  <pre className="bg-card border border-border rounded-md p-4 text-xs overflow-auto max-h-72">
                    {JSON.stringify(onboarding.enrichedData, null, 2)}
                  </pre>
                </div>
              )}
            </section>

            <aside className="space-y-4 lg:sticky lg:top-28 self-start">
              <div className="border border-border rounded-xl bg-card p-6 shadow-sm">
                <h3 className="font-serif text-lg mb-2">Generate strategy</h3>
                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                  Enrich the brand profile and compose a full strategy
                  document.
                </p>
                <div className="space-y-3 mb-5">
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Template
                  </label>
                  <Select
                    value={template}
                    onValueChange={(v) => setTemplate(v as TemplateChoice)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto-select</SelectItem>
                      <SelectItem value="brand_building">Brand Building</SelectItem>
                      <SelectItem value="performance_marketing">Performance Marketing</SelectItem>
                      <SelectItem value="personal_brand">Personal Brand</SelectItem>
                      <SelectItem value="d2c_growth">D2C Growth</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={regenerate}
                  className="w-full"
                  disabled={isGenerating}
                >
                  Generate strategy
                </Button>
              </div>
            </aside>
          </div>
        ) : editing ? (
          /* Edit mode */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
                Strategy document (Markdown)
              </label>
              <Textarea
                value={draftDoc}
                onChange={(e) => setDraftDoc(e.target.value)}
                className="font-mono text-sm min-h-[70vh] leading-relaxed"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
                Structured strategy (JSON)
              </label>
              <Textarea
                value={draftStructured}
                onChange={(e) => setDraftStructured(e.target.value)}
                className="font-mono text-xs min-h-[70vh] leading-relaxed"
              />
            </div>
          </div>
        ) : (
          /* Reading mode */
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-12">
            <article className="strategy-doc">
              <div
                className="prose prose-stone prose-headings:font-serif prose-headings:tracking-tight prose-h1:text-4xl prose-h1:mb-2 prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-h3:text-lg prose-p:leading-relaxed prose-p:text-foreground/85 prose-li:text-foreground/85 max-w-[70ch]"
                dangerouslySetInnerHTML={{ __html: docHtml }}
              />
            </article>
            <aside className="no-print self-start lg:sticky lg:top-28 space-y-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Structured strategy
              </p>
              <div className="border border-border rounded-xl bg-card/40 p-2 shadow-sm">
                <StructuredStrategyPanel
                  data={strategy.structuredStrategy as Record<string, unknown>}
                />
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  const inner = (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-card hover:border-primary/30 transition-colors">
      <div className="text-muted-foreground mt-0.5">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          {label}
        </div>
        <div className="text-sm text-foreground truncate">{value}</div>
      </div>
    </div>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block">
        {inner}
      </a>
    );
  }
  return inner;
}
