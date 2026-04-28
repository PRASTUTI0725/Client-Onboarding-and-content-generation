import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetClient,
  useGenerateStrategy,
  useUpdateStrategy,
  useDeleteClient,
  getGetClientQueryKey,
  getGetCalendarQueryKey,
  getListClientsQueryKey,
  customFetch,
  ApiError,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  Check,
  Globe,
  Instagram,
  CalendarDays,
  Trash2,
  Pencil,
  FileDown,
  Copy,
} from "lucide-react";
import { GeneratingStrategy } from "@/components/generating-strategy";
import { SowForm } from "@/components/sow-form";
import { BusinessDnaPanel } from "@/components/business-dna-panel";
import { RuntimeModeBanner } from "@/components/runtime-mode-banner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  allSectionsApproved,
  CANONICAL_SECTION_LABELS,
  CANONICAL_STRATEGY_SECTIONS,
  getPendingApprovalSections,
  getSowIncompleteReasons,
  isSowComplete,
  type CanonicalSectionKey,
  type SectionApprovals,
  type SowLike,
} from "@/lib/strategy-workflow";
import { confirmPreflightLimit, estimateBytes, estimateTokens } from "@/lib/request-preflight";

type TemplateChoice =
  | "auto"
  | "brand_building"
  | "performance_marketing"
  | "personal_brand"
  | "d2c_growth";

export default function Workspace() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isGeneratingStrategy, setIsGeneratingStrategy] = useState(false);
  const [isPreparingPrompt, setIsPreparingPrompt] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  const [promptDiagnostics, setPromptDiagnostics] = useState<{
    estimatedPromptTokens?: number;
    promptChars?: number;
    missingOptional?: string[];
  } | null>(null);
  const [showPasteScaffold, setShowPasteScaffold] = useState(false);
  const [pastedChatGptOutput, setPastedChatGptOutput] = useState("");
  const [futureSharedLink, setFutureSharedLink] = useState("");
  const [isImportingChatGpt, setIsImportingChatGpt] = useState(false);
  const [chatGptImportOk, setChatGptImportOk] = useState(false);
  const [chatGptImportMessage, setChatGptImportMessage] = useState<string | null>(null);
  const [isBootstrappingStrategy, setIsBootstrappingStrategy] = useState(false);
  const bootstrapAttemptRef = useRef<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useGetClient(id, {
    query: {
      enabled: !!id,
      queryKey: getGetClientQueryKey(id),
      staleTime: 0,
      refetchOnMount: true,
      refetchOnWindowFocus: true,
      refetchInterval: (query) => {
        if (isGeneratingStrategy) return 2000;
        return shouldPollForBusinessDna(query.state.data) ? 3000 : false;
      },
    },
  });
  const onboardingData = data?.onboarding;

  const [igNotesDraft, setIgNotesDraft] = useState("");
  const [igNotesSaving, setIgNotesSaving] = useState(false);
  const [template, setTemplate] = useState<TemplateChoice>("auto");
  const [editingSection, setEditingSection] =
    useState<CanonicalSectionKey | null>(null);
  const [draftSectionValue, setDraftSectionValue] = useState("");
  const [activeSection, setActiveSection] =
    useState<CanonicalSectionKey>("marketNarrative");
  const [regeneratingSection, setRegeneratingSection] = useState<CanonicalSectionKey | null>(null);

  const generate = useGenerateStrategy({
    mutation: {
      retry: 1,
      onMutate: () => {
        setIsGeneratingStrategy(true);
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: ["runtime-health-mode"] });
        toast({ title: "Strategy ready" });
      },
      onError: (err) => {
        const data = err instanceof ApiError ? (err.data as { code?: string; error?: string } | null) : null;
        const noProvider =
          data?.code === "NO_USABLE_AI_PROVIDER" ||
          (typeof err?.message === "string" && err.message.includes("NO_USABLE_AI_PROVIDER"));
        toast({
          title: noProvider ? "No AI provider configured" : "Could not finish generation",
          description: noProvider
            ? (data?.error ??
              "No usable AI provider is configured. Pick a provider with a valid key in AI settings, set server keys, or turn off “Use real AI” for demo mode.")
            : "Please retry. If this keeps happening, check API/runtime logs.",
          variant: "destructive",
        });
      },
      onSettled: () => {
        setIsGeneratingStrategy(false);
      },
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

  const del = useDeleteClient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        toast({ title: "Client deleted" });
        navigate("/");
      },
      onError: (err) =>
        toast({
          title: "Delete failed",
          description: String(err),
          variant: "destructive",
        }),
    },
  });

  const parsedSections = useMemo(() => {
    if (!data?.strategy) return null;
    return toStrategySections(
      data.strategy.structuredStrategy as Record<string, unknown>,
      data.strategy.strategyDocument,
      data.client.name,
    );
  }, [data?.strategy, data?.client.name]);

  const [sections, setSections] = useState<StrategySections | null>(null);
  const sectionRefs = useRef<Record<CanonicalSectionKey, HTMLElement | null>>(
    Object.fromEntries(
      CANONICAL_STRATEGY_SECTIONS.map((item) => [item.key, null]),
    ) as Record<CanonicalSectionKey, HTMLElement | null>,
  );

  useEffect(() => {
    if (parsedSections) setSections(parsedSections);
  }, [parsedSections]);

  useEffect(() => {
    if (!data?.strategy || !sections) return;
    const refs = Object.entries(sectionRefs.current) as Array<
      [CanonicalSectionKey, HTMLElement | null]
    >;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const found = refs.find(([, ref]) => ref === visible.target);
        if (found) setActiveSection(found[0]);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0.15, 0.5, 0.8] },
    );
    for (const [, ref] of refs) {
      if (ref) observer.observe(ref);
    }
    return () => observer.disconnect();
  }, [data?.strategy, sections]);

  useEffect(() => {
    const r = onboardingData?.rawInput as { instagramSummaryNotes?: string } | undefined;
    setIgNotesDraft(typeof r?.instagramSummaryNotes === "string" ? r.instagramSummaryNotes : "");
  }, [onboardingData?.rawInput]);

  useEffect(() => {
    if (isLoading || !data || !id) return;
    const scrollSow = () => {
      if (window.location.hash !== "#sow") return;
      const el = document.getElementById("sow");
      if (el) {
        requestAnimationFrame(() => {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    };
    scrollSow();
    window.addEventListener("hashchange", scrollSow);
    return () => window.removeEventListener("hashchange", scrollSow);
  }, [id, isLoading, data]);

  useEffect(() => {
    setGeneratedPrompt(null);
    setPromptDiagnostics(null);
    setShowPasteScaffold(false);
    setPastedChatGptOutput("");
    setFutureSharedLink("");
    setIsImportingChatGpt(false);
    setChatGptImportOk(false);
    setChatGptImportMessage(null);
    bootstrapAttemptRef.current = null;
  }, [id]);

  const businessDna = useMemo(
    () =>
      ((data?.onboarding?.enrichedData as Record<string, unknown> | null | undefined)?.businessDna as
        | Record<string, unknown>
        | null
        | undefined) ?? null,
    [data?.onboarding?.enrichedData],
  );
  const sowFromClient = ((data?.client?.sow ?? null) as Record<string, unknown> | null) ?? null;
  const sowForWorkspace = useMemo(
    () => buildSowFromBusinessDna(sowFromClient, businessDna),
    [sowFromClient, businessDna],
  );
  const businessDnaReady = !!businessDna && Object.keys(businessDna).length > 0;

  useEffect(() => {
    if (!id || !data || data.strategy || !businessDnaReady || isBootstrappingStrategy) return;
    if (bootstrapAttemptRef.current === id) return;
    bootstrapAttemptRef.current = id;
    setIsBootstrappingStrategy(true);
    void customFetch(`/api/clients/${id}/strategy/bootstrap`, {
      method: "POST",
      body: JSON.stringify({
        templateType: template === "auto" ? "brand_building" : template,
      }),
    })
      .then(async () => {
        await queryClient.invalidateQueries({
          queryKey: getGetClientQueryKey(id),
          exact: true,
        });
      })
      .catch((err) => {
        bootstrapAttemptRef.current = `failed:${id}`;
        toast({
          title: "Could not prepare Jump to Action",
          description: String(err),
          variant: "destructive",
        });
      })
      .finally(() => {
        setIsBootstrappingStrategy(false);
      });
  }, [businessDnaReady, data, id, isBootstrappingStrategy, queryClient, template, toast]);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <header className="border-b border-border/50 bg-background/95 backdrop-blur sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="space-y-2">
              <Skeleton className="h-7 w-60" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
        </header>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
          <div className="rounded-xl border border-border bg-card/40 p-6 space-y-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-6 w-72" />
            <Skeleton className="h-4 w-[30rem]" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-12">
            <div className="space-y-3">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-10/12" />
              <Skeleton className="h-4 w-9/12" />
            </div>
            <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 space-y-3">
            <h2 className="font-serif text-2xl tracking-tight">Could not load client workspace</h2>
            <p className="text-sm text-muted-foreground">
              {String(error ?? "Unknown error while fetching client data.")}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => void refetch()} variant="default">
                Retry
              </Button>
              <Link href="/">
                <Button variant="outline">Back to dashboard</Button>
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
          <div className="rounded-xl border border-border p-6 space-y-3">
            <h2 className="font-serif text-2xl tracking-tight">Client data unavailable</h2>
            <p className="text-sm text-muted-foreground">
              No workspace data was returned for this client yet. Try reloading once.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => void refetch()} variant="default">
                Reload
              </Button>
              <Link href="/">
                <Button variant="outline">Back to dashboard</Button>
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const { client, onboarding, strategy } = data;
  const isGenerating = generate.isPending;

  const strategyMeta = strategy?.structuredStrategy
    ? ((strategy.structuredStrategy as Record<string, unknown>).__meta as
        | { strategySource?: string; aiFailure?: { message?: string } }
        | undefined)
    : undefined;

  type CopyPromptResponse = {
    templateName: "strategy/v1-full";
    prompt: string;
    diagnostics?: {
      estimatedPromptTokens?: number;
      promptChars?: number;
      missingRequired?: string[];
      missingOptional?: string[];
    };
  };

  async function saveInstagramNotes() {
    if (!id) return;
    setIgNotesSaving(true);
    try {
      await customFetch(`/api/clients/${id}/onboarding`, {
        method: "PATCH",
        body: JSON.stringify({ instagramSummaryNotes: igNotesDraft }),
      });
      await queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
      toast({ title: "Instagram positioning saved" });
    } catch (err) {
      toast({
        title: "Could not save",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setIgNotesSaving(false);
    }
  }
  const sow = (client.sow ?? null) as unknown as Record<string, unknown>;
  const sowReady = isSowComplete(sow);
  const sowBlockers = getSowIncompleteReasons((client.sow ?? null) as SowLike);
  const strategyApprovals = strategy
    ? getSectionApprovals(strategy.structuredStrategy as Record<string, unknown>)
    : {};
  const pendingSections = getPendingApprovalSections(strategyApprovals);

  function jumpToSowSection() {
    const section = document.getElementById("sow");
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function regenerate() {
    if (!id) return;
    if (
      strategy &&
      !window.confirm(
        "Regenerating will replace the current strategy draft content. Continue?",
      )
    ) {
      return;
    }
    const estimatedPromptTokens = estimateTokens({
      template,
      onboardingRaw: compactOnboardingForPreflight(data?.onboarding?.rawInput ?? null),
      sow: compactSowForPreflight(data?.client?.sow ?? null),
      oneLineDescription: data?.client?.oneLineDescription ?? "",
    });
    const payload = { templateType: template };
    const proceed = confirmPreflightLimit({
      context: "Strategy generation preflight",
      estimatedTokens: estimatedPromptTokens,
      estimatedBytes: estimateBytes(payload),
      tokenThreshold: 2800,
      byteThreshold: 64 * 1024,
    });
    if (!proceed) return;
    generate.mutate({
      clientId: id,
      data: payload,
    });
  }

  async function generatePromptForGpt() {
    if (!id || isPreparingPrompt || !sowReady) return;
    const estimatedPromptTokens = estimateTokens({
      templateName: "strategy/v1-full",
      onboardingRaw: compactOnboardingForPreflight(data?.onboarding?.rawInput ?? null),
      sow: compactSowForPreflight(data?.client?.sow ?? null),
      oneLineDescription: data?.client?.oneLineDescription ?? "",
      strategySummary:
        ((data?.strategy?.structuredStrategy as Record<string, unknown> | undefined)?.__summary as
          | Record<string, unknown>
          | undefined) ?? null,
    });
    const proceed = confirmPreflightLimit({
      context: "Copy for GPT preflight",
      estimatedTokens: estimatedPromptTokens,
      estimatedBytes: estimateBytes({ clientId: id }),
      tokenThreshold: 2800,
      byteThreshold: 64 * 1024,
    });
    if (!proceed) return;

    setIsPreparingPrompt(true);
    try {
      const response = await customFetch<CopyPromptResponse>(`/api/clients/${id}/strategy/copy-prompt`, {
        method: "POST",
      });
      if (!response?.prompt?.trim()) {
        throw new Error("Prompt response was empty.");
      }
      setGeneratedPrompt(response.prompt);
      setPromptDiagnostics({
        estimatedPromptTokens: response.diagnostics?.estimatedPromptTokens,
        promptChars: response.diagnostics?.promptChars,
        missingOptional: response.diagnostics?.missingOptional,
      });
      toast({ title: "Prompt generated", description: "Click “Copy for GPT” to copy it." });
    } catch (err) {
      if (err instanceof ApiError) {
        const payload = (err.data as { missingRequired?: string[]; error?: string } | null) ?? null;
        if (err.response.status === 422 && Array.isArray(payload?.missingRequired)) {
          toast({
            title: "Missing prompt inputs",
            description: `Required fields: ${payload.missingRequired.join(", ")}`,
            variant: "destructive",
          });
          return;
        }
        toast({
          title: "Could not prepare prompt",
          description: payload?.error ?? err.message,
          variant: "destructive",
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      const clipboardIssue = /clipboard|permission|writeText/i.test(message);
      toast({
        title: clipboardIssue ? "Clipboard copy blocked" : "Could not prepare prompt",
        description: clipboardIssue
          ? "Browser blocked clipboard access. Please allow clipboard permission and try again."
          : message,
        variant: "destructive",
      });
    } finally {
      setIsPreparingPrompt(false);
    }
  }

  async function copyGeneratedPromptForGpt() {
    if (!generatedPrompt?.trim()) return;
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      toast({ title: "Prompt copied for ChatGPT" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const clipboardIssue = /clipboard|permission|writeText/i.test(message);
      toast({
        title: clipboardIssue ? "Clipboard copy blocked" : "Could not copy prompt",
        description: clipboardIssue
          ? "Browser blocked clipboard access. Please allow clipboard permission and try again."
          : message,
        variant: "destructive",
      });
    }
  }

  async function handlePrimaryPromptAction() {
    if (generatedPrompt) {
      await copyGeneratedPromptForGpt();
      return;
    }
    await generatePromptForGpt();
  }

  function regeneratePrompt() {
    setGeneratedPrompt(null);
    setPromptDiagnostics(null);
    toast({ title: "Prompt reset", description: "Generate Prompt to fetch a fresh version." });
  }

  async function importChatGptStrategy() {
    if (!id || isImportingChatGpt) return;
    const raw = pastedChatGptOutput.trim();
    if (!raw) {
      toast({
        title: "Paste ChatGPT JSON first",
        variant: "destructive",
      });
      return;
    }
    try {
      JSON.parse(raw);
    } catch {
      toast({
        title: "Invalid JSON",
        description: "Paste valid JSON from ChatGPT output.",
        variant: "destructive",
      });
      return;
    }
    setIsImportingChatGpt(true);
    setChatGptImportOk(false);
    setChatGptImportMessage(null);
    try {
      const imported = await customFetch<{
        strategySource?: string;
        importSummary?: { sectionCount?: number; pillarPriorities?: number; monthlyGoals?: number };
      }>(`/api/clients/${id}/strategy/import-chatgpt`, {
        method: "POST",
        body: JSON.stringify({
          chatgptJson: raw,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
      await queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey(id) });
      const sectionCount = imported?.importSummary?.sectionCount ?? 12;
      const pillarCount = imported?.importSummary?.pillarPriorities ?? 0;
      const goalsCount = imported?.importSummary?.monthlyGoals ?? 0;
      const msg = `Imported ${sectionCount} sections, ${pillarCount} pillar priorities, ${goalsCount} monthly goals.`;
      setChatGptImportOk(true);
      setChatGptImportMessage(msg);
      toast({
        title: "ChatGPT strategy imported",
        description: msg,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        const payload = (err.data as { error?: string } | null) ?? null;
        setChatGptImportOk(false);
        setChatGptImportMessage(payload?.error ?? err.message);
        toast({
          title: "Import failed",
          description: payload?.error ?? err.message,
          variant: "destructive",
        });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setChatGptImportOk(false);
        setChatGptImportMessage(message);
        toast({
          title: "Import failed",
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      setIsImportingChatGpt(false);
    }
  }

  function getCurrentApprovals(): SectionApprovals {
    if (!strategy) return {};
    return getSectionApprovals(strategy.structuredStrategy as Record<string, unknown>);
  }

  function approveSection(sectionKey: CanonicalSectionKey) {
    if (!id || !strategy) return;
    const nextApprovals = { ...getCurrentApprovals(), [sectionKey]: true };
    const isFullyApproved = allSectionsApproved(nextApprovals);
    update.mutate(
      {
        clientId: id,
        data: {
          structuredStrategy: {
            ...(strategy.structuredStrategy as Record<string, unknown>),
            __meta: {
              ...(((strategy.structuredStrategy as Record<string, unknown>).__meta as Record<
                string,
                unknown
              > | undefined) ?? {}),
              sectionApprovals: nextApprovals,
            },
          },
          status: isFullyApproved ? "approved" : "draft",
        },
      },
      { onSuccess: () => toast({ title: `${CANONICAL_SECTION_LABELS[sectionKey]} approved` }) },
    );
  }

  function approveAllSections() {
    if (!id || !strategy) return;
    const nextApprovals = Object.fromEntries(
      CANONICAL_STRATEGY_SECTIONS.map((section) => [section.key, true]),
    ) as SectionApprovals;
    update.mutate(
      {
        clientId: id,
        data: {
          structuredStrategy: {
            ...(strategy.structuredStrategy as Record<string, unknown>),
            __meta: {
              ...(((strategy.structuredStrategy as Record<string, unknown>).__meta as Record<
                string,
                unknown
              > | undefined) ?? {}),
              sectionApprovals: nextApprovals,
            },
          },
          status: "approved",
        },
      },
      { onSuccess: () => toast({ title: "All strategy sections approved" }) },
    );
  }

  async function regenerateSection(sectionKey: CanonicalSectionKey) {
    if (!id || !strategy) return;
    const approvals = getCurrentApprovals();
    if (approvals[sectionKey]) {
      const ok = window.confirm(
        `${CANONICAL_SECTION_LABELS[sectionKey]} is approved. Regenerating will unapprove and replace this section. Continue?`,
      );
      if (!ok) return;
    }
    try {
      setRegeneratingSection(sectionKey);
      await customFetch(`/api/clients/${id}/strategy/sections/${sectionKey}/regenerate`, {
        method: "POST",
      });
      await queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
      toast({ title: `${CANONICAL_SECTION_LABELS[sectionKey]} regenerated` });
    } catch (err) {
      toast({
        title: "Section regeneration failed",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setRegeneratingSection(null);
    }
  }

  async function exportStrategyPdf() {
    const pdfSections =
      strategy && sections
        ? buildPdfSections(sections, strategy.structuredStrategy as Record<string, unknown>)
        : buildJumpToActionPdfSections(client.name, businessDna, sowForWorkspace);
    if (pdfSections.length === 0) return;
    const safeName = client.name.replace(/[^\w\u00C0-\u024f\d-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "strategy";
    try {
      const blob = buildStrategyPdfBlob(client.name, pdfSections);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}-jump-to-action.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({
        title: "PDF ready",
        description: "Business DNA and SOW export is ready.",
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: String(err),
        variant: "destructive",
      });
    }
  }

  function sectionValueToDraft(key: CanonicalSectionKey, value: string) {
    return key ? String(value) : "";
  }

  function startSectionEdit(key: CanonicalSectionKey) {
    if (!sections) return;
    setEditingSection(key);
    setDraftSectionValue(sectionValueToDraft(key, sections[key]));
  }

  function cancelSectionEdit() {
    setEditingSection(null);
    setDraftSectionValue("");
  }

  function saveSectionEdit() {
    if (!sections || !editingSection || !id || !strategy) return;
    const next: StrategySections = { ...sections };
    next[editingSection] = draftSectionValue.trim();
    setSections(next);
    const currentStructured = strategy.structuredStrategy as Record<string, unknown>;
    const sectionApprovals = getSectionApprovals(currentStructured);
    sectionApprovals[editingSection] = false;
    update.mutate(
      {
        clientId: id,
        data: {
          strategyDocument: buildStrategyDocument(client.name, next),
          structuredStrategy: buildStructuredStrategy(next, currentStructured, sectionApprovals),
          status: "draft",
        },
      },
      {
        onSuccess: () => {
          toast({ title: `${CANONICAL_SECTION_LABELS[editingSection]} updated` });
          cancelSectionEdit();
        },
      },
    );
  }

  function deleteClient() {
    if (!id) return;
    const ok = window.confirm(
      "Delete this client and all generated strategy/calendar data? This action cannot be undone.",
    );
    if (!ok) return;
    del.mutate({ clientId: id });
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Sticky header */}
      <header className="no-print border-b border-border/50 bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
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

          {!strategy && (
            <div className="flex items-center gap-2 flex-nowrap w-full sm:w-auto justify-end min-w-0">
              <Button
                onClick={() => void handlePrimaryPromptAction()}
                disabled={isPreparingPrompt || !sowReady}
                size="sm"
                className="shrink-0"
                data-testid="header-generate-prompt-button"
              >
                <Copy className="size-4" /> {isPreparingPrompt ? "Preparing prompt..." : generatedPrompt ? "Copy for GPT" : "Generate Prompt"}
              </Button>
              {generatedPrompt && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={regeneratePrompt}
                  className="shrink-0"
                  data-testid="header-regenerate-prompt-button"
                >
                  Regenerate Prompt
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowPasteScaffold((v) => !v);
                  if (!showPasteScaffold) {
                    setChatGptImportOk(false);
                    setChatGptImportMessage(null);
                  }
                }}
                className="shrink-0"
                data-testid="header-paste-chatgpt-result-button"
              >
                Paste ChatGPT Result
              </Button>
              {!sowReady && (
                <a href="#sow" className="text-xs text-amber-800 font-medium whitespace-nowrap hover:underline shrink-0">
                  Complete SOW first →
                </a>
              )}
            </div>
          )}

          {strategy && (
            <div className="flex items-center gap-2 flex-nowrap overflow-x-auto max-w-[100vw] sm:max-w-none min-w-0 pb-1 w-full lg:w-auto [scrollbar-width:thin]">
              {strategyMeta?.strategySource === "fallback" ? (
                <p className="text-xs text-amber-900 font-medium max-w-[14rem] leading-snug shrink-0">
                  Strategy is a template — regenerate before calendar
                </p>
              ) : (
                <Link href={`/clients/${id}/calendar`}>
                  <Button variant="default" size="sm" className="gap-2 shrink-0" data-testid="open-calendar-button">
                    <CalendarDays className="size-4" /> Calendar
                  </Button>
                </Link>
              )}
              {strategy.status !== "approved" && (
                <Button variant="outline" size="sm" onClick={approveAllSections} className="gap-2 shrink-0" data-testid="approve-strategy-button">
                  <CheckCircle2 className="size-4" /> Approve strategy
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handlePrimaryPromptAction()}
                disabled={!sowReady || isPreparingPrompt}
                className="gap-2 shrink-0"
                data-testid="strategy-primary-prompt-button"
              >
                <Copy className="size-4" /> {isPreparingPrompt ? "Preparing prompt..." : generatedPrompt ? "Copy for GPT" : "Generate Prompt"}
              </Button>
              {generatedPrompt && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={regeneratePrompt}
                  className="gap-2 shrink-0"
                  data-testid="strategy-regenerate-prompt-button"
                >
                  Regenerate Prompt
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowPasteScaffold((v) => !v);
                  if (!showPasteScaffold) {
                    setChatGptImportOk(false);
                    setChatGptImportMessage(null);
                  }
                }}
                className="gap-2 shrink-0"
                data-testid="strategy-paste-chatgpt-result-button"
              >
                Paste ChatGPT Result
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void exportStrategyPdf()}
                className="gap-2 shrink-0"
                data-testid="download-pdf-button"
              >
                <FileDown className="size-4" /> Export PDF (Jump to Action)
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={deleteClient}
              disabled={del.isPending}
              className="gap-2 text-red-700 border-red-200 hover:bg-red-50"
              data-testid="delete-client-button"
            >
              <Trash2 className="size-4" /> {del.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <RuntimeModeBanner />
        {showPasteScaffold && (
          <section className="mb-6 rounded-xl border border-border bg-card/60 p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-serif text-lg tracking-tight">Paste ChatGPT Result</h3>
                <p className="text-sm text-muted-foreground">
                  Paste your ChatGPT strategy JSON below and import it directly.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowPasteScaffold(false)}
              >
                Close
              </Button>
            </div>
            <Textarea
              value={pastedChatGptOutput}
              onChange={(e) => setPastedChatGptOutput(e.target.value)}
              rows={8}
              placeholder="Paste ChatGPT JSON/result here..."
            />
            {chatGptImportMessage && (
              <p
                className={`text-xs ${chatGptImportOk ? "text-emerald-700" : "text-destructive"}`}
                data-testid="chatgpt-import-message"
              >
                {chatGptImportMessage}
              </p>
            )}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Shared link (coming soon)</Label>
              <Input
                value={futureSharedLink}
                onChange={(e) => setFutureSharedLink(e.target.value)}
                placeholder="https://chatgpt.com/share/..."
                disabled
              />
            </div>
            <div className="flex gap-2 items-center">
              <Button type="button" onClick={() => void importChatGptStrategy()} disabled={isImportingChatGpt}>
                {isImportingChatGpt ? "Importing..." : "Import Strategy JSON"}
              </Button>
              {chatGptImportOk && (
                <span className="inline-flex items-center gap-1 text-emerald-700 text-sm" data-testid="chatgpt-import-tick">
                  <Check className="size-4" /> Imported
                </span>
              )}
            </div>
          </section>
        )}
        {generatedPrompt && (
          <Alert className="mb-6 border-emerald-200 bg-emerald-50/80 text-emerald-950">
            <AlertTitle>Prompt ready</AlertTitle>
            <AlertDescription>
              Your personalized prompt is generated for this page session. Click “Copy for GPT” to reuse without another backend call.
              {promptDiagnostics?.estimatedPromptTokens ? ` Estimated tokens: ${promptDiagnostics.estimatedPromptTokens}.` : ""}
            </AlertDescription>
          </Alert>
        )}
        {strategy && strategyMeta?.strategySource === "fallback" && (
          <Alert className="mb-6 border-sky-200 bg-sky-50/80 text-sky-950">
            <AlertTitle>Strategy used a template</AlertTitle>
            <AlertDescription>
              The model did not return usable output (or real AI is off). Review or regenerate sections as needed.
              {strategyMeta?.aiFailure?.message ? ` ${strategyMeta.aiFailure.message}` : null}
            </AlertDescription>
          </Alert>
        )}
        {onboarding && (
          <div className="mb-8 rounded-xl border border-border bg-card/50 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Instagram positioning (optional)
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              Add bio, tone, or positioning notes manually if Instagram details are unavailable.
            </p>
            <Textarea
              value={igNotesDraft}
              onChange={(e) => setIgNotesDraft(e.target.value)}
              rows={3}
              placeholder="e.g. Product-led D2C, hooks on sustainability, new launch in April…"
              className="text-sm"
            />
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={saveInstagramNotes}
                disabled={igNotesSaving}
                data-testid="save-instagram-notes"
              >
                {igNotesSaving ? "Saving…" : "Save notes"}
              </Button>
            </div>
          </div>
        )}
        {isGenerating && !strategy ? (
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

              <section
                id="sow"
                className="border border-border rounded-xl bg-card/40 p-6 shadow-sm scroll-mt-28"
              >
                <h2 className="font-serif text-2xl font-bold tracking-tight mb-1">SOW details</h2>
                <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
                  Match <strong>content mix</strong> to <strong>monthly post total</strong>, then <strong>approve &amp; save</strong> to unlock
                  strategy.
                </p>
                <SowForm clientId={id ?? ""} initial={sowForWorkspace as never} showSowPdfUpload={false} />
              </section>

              {onboarding && (
                <BusinessDnaPanel
                  enrichedData={(onboarding.enrichedData as Record<string, unknown> | null | undefined) ?? null}
                  rawInput={onboarding.rawInput as Record<string, unknown> | null | undefined}
                  instagramSummaryNotesDraft={igNotesDraft}
                />
              )}
            </section>

            <aside className="space-y-4 lg:sticky lg:top-28 self-start">
              <div className="border border-border rounded-xl bg-card p-6 shadow-sm">
                <h3 className="font-serif text-lg font-semibold mb-2">Founder strategy flow</h3>
                <p className="text-sm text-muted-foreground mb-4">Pick a strategy type, generate the ChatGPT prompt, then paste the JSON result back here.</p>
                <div className="space-y-3 mb-5">
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Strategy type
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
                  type="button"
                  variant="default"
                  onClick={() => void handlePrimaryPromptAction()}
                  className="w-full gap-2"
                  disabled={isPreparingPrompt || !sowReady}
                  data-testid="strategy-primary-prompt-button-empty"
                >
                  <Copy className="size-4" /> {isPreparingPrompt ? "Preparing prompt..." : generatedPrompt ? "Copy for GPT" : "Generate Prompt"}
                </Button>
                {generatedPrompt && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={regeneratePrompt}
                    className="w-full mt-2"
                    data-testid="regenerate-prompt-button-empty"
                  >
                    Regenerate Prompt
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowPasteScaffold((v) => !v);
                    if (!showPasteScaffold) {
                      setChatGptImportOk(false);
                      setChatGptImportMessage(null);
                    }
                  }}
                  className="w-full mt-2"
                  data-testid="paste-chatgpt-result-button-empty"
                >
                  Paste ChatGPT Result
                </Button>
                {!sowReady && (
                  <div className="mt-3 space-y-2 rounded-md border border-amber-200/60 bg-amber-50/50 p-3">
                    <p className="text-xs font-semibold text-amber-900">SOW checklist</p>
                    <a href="#sow" className="text-xs text-primary font-medium hover:underline block">
                      Go to SOW details →
                    </a>
                    <ul className="text-xs text-amber-900/90 list-disc pl-4 space-y-0.5">
                      {sowBlockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {sowReady && <p className="mt-3 text-xs text-emerald-800 font-medium">SOW complete — you can generate the prompt.</p>}
              </div>
            </aside>
          </div>
        ) : (
          /* Reading mode */
          <div className="space-y-12">
            <section
              id="sow"
              className="border border-border rounded-xl bg-card/40 p-6 shadow-sm scroll-mt-28"
            >
              <h2 className="font-serif text-2xl font-bold tracking-tight mb-1">SOW details</h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
                Calendar and execution pull from this plan: platforms, post totals, content mix, and tone.
              </p>
              <SowForm clientId={id ?? ""} initial={sowForWorkspace as never} showSowPdfUpload={false} />
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-12">
              <article className="strategy-doc space-y-5">
                {sections &&
                  CANONICAL_STRATEGY_SECTIONS.map(({ key }) => {
                      const isEditing = editingSection === key;
                      const value = sections[key];
                      const isApproved = Boolean(strategyApprovals[key]);
                      const isRegenerating = regeneratingSection === key;
                      return (
                        <section
                          key={key}
                          ref={(el) => {
                            sectionRefs.current[key] = el;
                          }}
                          id={`section-${key}`}
                          className="scroll-mt-28 rounded-xl border border-border bg-card p-5 shadow-sm space-y-3"
                        >
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div>
                              <h3 className="font-serif text-xl tracking-tight">
                                {CANONICAL_SECTION_LABELS[key]}
                              </h3>
                              <p className="text-xs text-muted-foreground mt-1">
                                {SECTION_HINTS[key]}
                              </p>
                            </div>
                            {!isEditing && (
                              <div className="flex items-center gap-2">
                                <Button
                                  variant={isApproved ? "secondary" : "outline"}
                                  size="sm"
                                  onClick={() => approveSection(key)}
                                >
                                  {isApproved ? "Approved" : "Approve"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-2"
                                  onClick={() => regenerateSection(key)}
                                  disabled={isRegenerating}
                                >
                                  <RefreshCw
                                    className={`size-4 ${isRegenerating ? "animate-spin" : ""}`}
                                  />{" "}
                                  Regenerate
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-2"
                                  onClick={() => startSectionEdit(key)}
                                  data-testid={`edit-section-${key}`}
                                >
                                  <Pencil className="size-4" /> Edit
                                </Button>
                              </div>
                            )}
                          </div>

                          {isEditing ? (
                            <div className="space-y-3">
                              <Textarea
                                value={draftSectionValue}
                                onChange={(e) => setDraftSectionValue(e.target.value)}
                                className="min-h-24"
                              />
                              <div className="flex items-center gap-2 flex-wrap">
                                <Button
                                  size="sm"
                                  onClick={saveSectionEdit}
                                  disabled={update.isPending}
                                  data-testid={`save-section-${key}`}
                                >
                                  {update.isPending ? "Saving..." : "Save"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={cancelSectionEdit}
                                  data-testid={`cancel-section-${key}`}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {isRegenerating ? (
                                <>
                                  <Skeleton className="h-4 w-full" />
                                  <Skeleton className="h-4 w-10/12" />
                                  <Skeleton className="h-4 w-9/12" />
                                </>
                              ) : (
                                <StrategyBody text={String(value)} />
                              )}
                            </div>
                          )}
                        </section>
                      );
                    })}
              </article>
              <aside className="no-print self-start lg:sticky lg:top-28 space-y-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Jump to section
                </p>
                <div className="border border-border rounded-xl bg-card/40 p-2 shadow-sm">
                  <div className="space-y-1">
                    {CANONICAL_STRATEGY_SECTIONS.map(({ key }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() =>
                            document
                              .getElementById(`section-${key}`)
                              ?.scrollIntoView({ behavior: "smooth", block: "start" })
                          }
                          className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                            activeSection === key
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                          }`}
                          data-testid={`strategy-nav-${key}`}
                        >
                          {CANONICAL_SECTION_LABELS[key]}
                        </button>
                      ))}
                  </div>
                </div>
                {pendingSections.length > 0 && (
                  <p className="text-xs text-amber-700">
                    Approve all strategy sections before generating the content calendar.
                  </p>
                )}
              </aside>
            </div>

            {onboarding && (
              <BusinessDnaPanel
                enrichedData={(onboarding.enrichedData as Record<string, unknown> | null | undefined) ?? null}
                rawInput={onboarding.rawInput as Record<string, unknown> | null | undefined}
                instagramSummaryNotesDraft={igNotesDraft}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function compactOnboardingForPreflight(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  return {
    name: String(input.name ?? ""),
    websiteUrl: String(input.websiteUrl ?? ""),
    instagramHandle: String(input.instagramHandle ?? ""),
    oneLineDescription: String(input.oneLineDescription ?? "").slice(0, 300),
    instagramSummaryNotes: String(input.instagramSummaryNotes ?? "").slice(0, 400),
  };
}

function shouldPollForBusinessDna(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const onboarding = (data as { onboarding?: unknown }).onboarding;
  if (!onboarding || typeof onboarding !== "object") return false;
  const enrichedData = (onboarding as { enrichedData?: unknown }).enrichedData;
  if (!enrichedData || typeof enrichedData !== "object") return false;
  const businessDna = (enrichedData as { businessDna?: unknown }).businessDna;
  if (businessDna && typeof businessDna === "object" && !Array.isArray(businessDna) && Object.keys(businessDna).length > 0) {
    return false;
  }
  const provenance = (enrichedData as { __provenance?: unknown }).__provenance;
  if (!provenance || typeof provenance !== "object") return false;
  const record = provenance as { dnaBackgroundStatus?: unknown; dnaBackgroundQueuedAt?: unknown };
  if (record.dnaBackgroundStatus !== "pending") return false;
  const queuedAt = typeof record.dnaBackgroundQueuedAt === "string" ? Date.parse(record.dnaBackgroundQueuedAt) : NaN;
  if (Number.isFinite(queuedAt) && Date.now() - queuedAt > 180_000) return false;
  return true;
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
    industry: String(input.industry ?? "").slice(0, 200),
    targetAudience: String(input.targetAudience ?? "").slice(0, 350),
    understandingOfRequirements: String(input.understandingOfRequirements ?? "").slice(0, 1200),
    strategyLaunchPlanning: String(input.strategyLaunchPlanning ?? "").slice(0, 1200),
    contentCreation: String(input.contentCreation ?? "").slice(0, 1200),
    scopeOfWork: String(input.scopeOfWork ?? "").slice(0, 900),
    deliverables,
    platforms: Array.isArray(input.platforms) ? input.platforms.slice(0, 6) : [],
    monthlyPosts: input.monthlyPosts ?? {},
  };
}

type StrategySections = Record<CanonicalSectionKey, string>;

type DisplayBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; items: string[] };

const PDF_SECTION_ORDER = [
  { label: "Market Narrative", keys: ["marketNarrative"] as const },
  { label: "Problem", keys: ["problemGapSolution"] as const, pick: ["problem"] },
  { label: "Gap", keys: ["problemGapSolution"] as const, pick: ["gap"] },
  { label: "Solution", keys: ["problemGapSolution"] as const, pick: ["solution"] },
  { label: "Brand Foundation", keys: ["brandFoundation"] as const },
  { label: "Brand Philosophy", keys: ["brandPhilosophy"] as const },
  { label: "Audience", keys: ["audience"] as const },
  { label: "Emotional Drivers", keys: ["emotionalDrivers"] as const },
  { label: "Platform Strategy", keys: ["platformStrategy"] as const },
  { label: "Content Strategy", keys: ["contentStrategy"] as const },
  { label: "KPIs", keys: ["kpis"] as const },
  { label: "Tracking Plan", keys: ["trackingPlan"] as const },
  { label: "Execution Phases", keys: ["executionPhases"] as const },
  { label: "Asset Requirements", keys: ["assetRequirements"] as const },
];

const SECTION_HINTS: Record<CanonicalSectionKey, string> = {
  marketNarrative: "Market context and narrative framing.",
  problemGapSolution: "Core problem, current gap, and strategic solution.",
  brandFoundation: "Foundational brand anchors and non-negotiables.",
  brandPhilosophy: "Belief system and brand operating philosophy.",
  audience: "Primary audience and segment priorities.",
  emotionalDrivers: "Emotions and triggers that create action.",
  platformStrategy: "Platform role, objective, and motion.",
  contentStrategy: "Pillars, formats, and message system.",
  kpis: "Outcome metrics and KPI definitions.",
  trackingPlan: "How performance is tracked and reviewed.",
  executionPhases: "Execution sequence and phased rollout.",
  assetRequirements: "Assets required for successful execution.",
};

function markdownSectionMap(doc: string): Record<string, string> {
  const out: Record<string, string> = {};
  const rx = /^##\s+(.+?)\n([\s\S]*?)(?=^##\s+|\s*$)/gm;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(doc))) {
    out[match[1]!.toLowerCase().trim()] = match[2]!.trim();
  }
  return out;
}

function formatStrategyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatStrategyValue).filter(Boolean).join("\n");
  if (typeof value === "object") return formatStrategyObject(value as Record<string, unknown>);
  return "";
}

function formatStrategyObject(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, entry]) => {
      const text = formatStrategyValue(entry).trim();
      if (!text) return "";
      return `${prettifyKey(key)}\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function prettifyKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function cleanStrategyText(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\uFE0F/g, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => stripInlineMarkdown(line.replace(/^#{1,6}\s*/, "").trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function strategyDisplayBlocks(text: string): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (bullets.length > 0) {
      blocks.push({ kind: "bullet", items: bullets });
      bullets = [];
    }
  };
  for (const rawLine of text.split(/\n+/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushBullets();
      continue;
    }
    const heading = rawLine.match(/^\s*#{1,6}\s+(.+)$/);
    if (heading) {
      flushBullets();
      blocks.push({ kind: "heading", text: stripInlineMarkdown(heading[1]!) });
      continue;
    }
    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      bullets.push(stripInlineMarkdown(bullet[1]!));
      continue;
    }
    flushBullets();
    const cleaned = stripInlineMarkdown(trimmed);
    if (/^[A-Z][A-Za-z\s/&]+:$/.test(cleaned) && cleaned.length <= 48) {
      blocks.push({ kind: "heading", text: cleaned.replace(/:$/, "") });
    } else {
      blocks.push({ kind: "paragraph", text: cleaned });
    }
  }
  flushBullets();
  return blocks;
}

function toStrategySections(
  structured: Record<string, unknown>,
  strategyDocument: string,
  clientName: string,
): StrategySections {
  const sectionMap = markdownSectionMap(strategyDocument);
  const canonical = (structured.canonicalSections ?? {}) as Partial<StrategySections>;
  const toText = (value: unknown, fallback = "") => {
    if (typeof value === "string") return cleanStrategyText(value);
    if (Array.isArray(value)) return cleanStrategyText(value.map(formatStrategyValue).join("\n"));
    if (value && typeof value === "object") return cleanStrategyText(formatStrategyObject(value as Record<string, unknown>));
    return cleanStrategyText(fallback);
  };
  return {
    marketNarrative:
      canonical.marketNarrative ??
      toText(
        structured.market_narrative,
        sectionMap["market narrative"] ??
          `${clientName} has a focused strategy designed for consistent growth.`,
      ),
    problemGapSolution:
      canonical.problemGapSolution ??
      toText(structured.problem_gap_solution, sectionMap["problem • gap • solution"] ?? ""),
    brandFoundation:
      canonical.brandFoundation ??
      toText(structured.brand_foundation, sectionMap["brand foundation"] ?? ""),
    brandPhilosophy:
      canonical.brandPhilosophy ??
      toText(structured.brand_philosophy, sectionMap["brand philosophy"] ?? ""),
    audience: canonical.audience ?? toText(structured.audience, sectionMap["audience"] ?? ""),
    emotionalDrivers:
      canonical.emotionalDrivers ??
      toText(structured.emotional_drivers, sectionMap["emotional drivers"] ?? ""),
    platformStrategy:
      canonical.platformStrategy ??
      toText(structured.platform_strategy, sectionMap["platform strategy"] ?? ""),
    contentStrategy:
      canonical.contentStrategy ??
      toText(structured.content_strategy, sectionMap["content strategy"] ?? ""),
    kpis: canonical.kpis ?? toText(structured.kpis, sectionMap["kpis"] ?? ""),
    trackingPlan:
      canonical.trackingPlan ?? toText(structured.tracking_plan, sectionMap["tracking plan"] ?? ""),
    executionPhases:
      canonical.executionPhases ?? toText(structured.phases, sectionMap["execution phases"] ?? ""),
    assetRequirements:
      canonical.assetRequirements ??
      toText(structured.asset_requirements, sectionMap["asset requirements"] ?? ""),
  };
}

function StrategyBody({ text }: { text: string }) {
  const blocks = strategyDisplayBlocks(text);
  if (blocks.length === 0) {
    return <p className="text-sm text-muted-foreground italic">Add manual context to improve this section</p>;
  }
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <h4 key={index} className="text-sm font-bold tracking-tight text-foreground pt-1">
              {block.text}
            </h4>
          );
        }
        if (block.kind === "bullet") {
          return (
            <ul key={index} className="list-disc pl-5 space-y-1 text-sm leading-relaxed text-foreground/90">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="text-sm leading-relaxed text-foreground/90">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

function buildStructuredStrategy(
  sections: StrategySections,
  base: Record<string, unknown>,
  sectionApprovals: SectionApprovals,
): Record<string, unknown> {
  return {
    ...base,
    canonicalSections: sections,
    __meta: {
      ...((base.__meta as Record<string, unknown> | undefined) ?? {}),
      sectionApprovals,
    },
  };
}

function buildStrategyDocument(name: string, sections: StrategySections): string {
  return `# ${name} Strategy

${CANONICAL_STRATEGY_SECTIONS.map(
  (section) =>
    `## ${CANONICAL_SECTION_LABELS[section.key]}\n${sections[section.key] || "Not available from current inputs"}`,
).join("\n\n")}
`;
}

function pickStructuredText(
  structured: Record<string, unknown> | undefined,
  section: (typeof PDF_SECTION_ORDER)[number],
): string {
  if (!structured) return "";
  const sourceKey = section.keys[0];
  const apiKeyBySection: Record<string, string> = {
    marketNarrative: "market_narrative",
    problemGapSolution: "problem_gap_solution",
    brandFoundation: "brand_foundation",
    brandPhilosophy: "brand_philosophy",
    audience: "audience",
    emotionalDrivers: "emotional_drivers",
    platformStrategy: "platform_strategy",
    contentStrategy: "content_strategy",
    kpis: "kpis",
    trackingPlan: "tracking_plan",
    executionPhases: "phases",
    assetRequirements: "asset_requirements",
  };
  const source = structured[apiKeyBySection[sourceKey] ?? sourceKey];
  if (!section.pick || !source || typeof source !== "object" || Array.isArray(source)) return "";
  const record = source as Record<string, unknown>;
  return section.pick.map((key) => formatStrategyValue(record[key])).filter(Boolean).join("\n\n");
}

function buildPdfSections(
  sections: StrategySections,
  structured?: Record<string, unknown>,
): Array<{ label: string; body: string }> {
  return PDF_SECTION_ORDER.map((section) => {
    const splitBody = pickStructuredText(structured, section);
    const body = splitBody || section.keys.map((key) => sections[key]).filter(Boolean).join("\n\n");
    return { label: section.label, body: cleanStrategyText(body) };
  }).filter((section) => section.body.trim().length > 0);
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function joinLines(lines: Array<string | null | undefined>): string {
  return lines.map((line) => String(line ?? "").trim()).filter(Boolean).join("\n");
}

function fillIfEmpty(existing: unknown, next: string): string {
  const current = String(existing ?? "").trim();
  return current || next.trim();
}

function buildSowFromBusinessDna(
  currentSow: Record<string, unknown> | null | undefined,
  businessDna: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const sow = { ...((currentSow ?? {}) as Record<string, unknown>) };
  const dna = businessDna ?? null;
  if (!dna) return sow;

  const positioning = asObject(dna.positioning);
  const audience = asObject(dna.targetAudience);
  const contentStrategy = asObject(dna.contentStrategy);
  const offers = asObject(dna.offers);
  const platformSignals = asObject(dna.platformSignals);
  const websiteSignals = asObject(platformSignals?.website);
  const instagramSignals = asObject(platformSignals?.instagram);

  const targetAudienceText = joinLines([
    stringList(audience?.segments).join(", "),
    stringList(audience?.demographics).join(", "),
  ]);
  const strategyText = joinLines([
    stringList(contentStrategy?.contentPillars).join(", "),
    stringList(contentStrategy?.themes).join(", "),
  ]);
  const contentDeliverablesText = joinLines([
    stringList(offers?.primaryOffers).join("\n"),
    websiteSignals ? `Website signals: ${joinLines([stringList(websiteSignals.messagingPatterns).join(", "), stringList(websiteSignals.conversionElements).join(", ")])}` : "",
    instagramSignals ? `Instagram signals: ${joinLines([stringList(instagramSignals.bioSignals).join(", "), stringList(instagramSignals.contentPatterns).join(", ")])}` : "",
  ]);

  sow.industry = fillIfEmpty(sow.industry, String(positioning?.category ?? ""));
  sow.targetAudience = fillIfEmpty(sow.targetAudience, targetAudienceText);
  sow.understandingOfRequirements = fillIfEmpty(
    sow.understandingOfRequirements,
    String(positioning?.valueProposition ?? ""),
  );
  sow.strategyLaunchPlanning = fillIfEmpty(sow.strategyLaunchPlanning, strategyText);
  sow.contentCreation = fillIfEmpty(sow.contentCreation, contentDeliverablesText);

  if ((!Array.isArray(sow.deliverables) || sow.deliverables.length === 0) && stringList(offers?.primaryOffers).length > 0) {
    sow.deliverables = stringList(offers?.primaryOffers);
  }

  return sow;
}

function buildJumpToActionPdfSections(
  clientName: string,
  businessDna: Record<string, unknown> | null | undefined,
  sow: Record<string, unknown> | null | undefined,
): Array<{ label: string; body: string }> {
  const sections: Array<{ label: string; body: string }> = [];
  const dna = businessDna ?? null;
  const mergedSow = sow ?? {};

  if (dna) {
    const positioning = asObject(dna.positioning);
    const audience = asObject(dna.targetAudience);
    const contentStrategy = asObject(dna.contentStrategy);
    const offers = asObject(dna.offers);
    const visualIdentity = asObject(dna.visualIdentity);
    const platformSignals = asObject(dna.platformSignals);
    const websiteSignals = asObject(platformSignals?.website);
    const instagramSignals = asObject(platformSignals?.instagram);
    sections.push({
      label: "Business DNA",
      body: cleanStrategyText(
        joinLines([
          `Client: ${clientName}`,
          "",
          "Purpose",
          String(dna.purpose ?? ""),
          "",
          "Positioning",
          joinLines([
            positioning?.category ? `- Category: ${String(positioning.category)}` : "",
            positioning?.valueProposition ? `- Value proposition: ${String(positioning.valueProposition)}` : "",
            stringList(positioning?.differentiators).length
              ? `- Differentiators: ${stringList(positioning?.differentiators).join(", ")}`
              : "",
          ]),
          "",
          "Audience",
          joinLines([
            stringList(audience?.segments).length ? `- Segments: ${stringList(audience?.segments).join(", ")}` : "",
            stringList(audience?.demographics).length
              ? `- Demographics: ${stringList(audience?.demographics).join(", ")}`
              : "",
            stringList(audience?.psychographics).length
              ? `- Psychographics: ${stringList(audience?.psychographics).join(", ")}`
              : "",
          ]),
          "",
          "Content Strategy",
          joinLines([
            stringList(contentStrategy?.contentPillars).length
              ? `- Pillars: ${stringList(contentStrategy?.contentPillars).join(", ")}`
              : "",
            stringList(contentStrategy?.themes).length
              ? `- Themes: ${stringList(contentStrategy?.themes).join(", ")}`
              : "",
          ]),
          "",
          "Offers",
          stringList(offers?.primaryOffers).length
            ? stringList(offers?.primaryOffers).map((item) => `- ${item}`).join("\n")
            : "",
          "",
          "Platform Signals",
          joinLines([
            stringList(websiteSignals?.messagingPatterns).length
              ? `- Website: ${stringList(websiteSignals?.messagingPatterns).join(", ")}`
              : "",
            stringList(instagramSignals?.bioSignals).length
              ? `- Instagram: ${stringList(instagramSignals?.bioSignals).join(", ")}`
              : "",
          ]),
          "",
          "Visual Identity",
          Array.isArray(visualIdentity?.colors)
            ? visualIdentity.colors
                .map((color) => asObject(color))
                .filter(Boolean)
                .map((color) => `- ${String(color?.name ?? "Color")}: ${String(color?.hex ?? "").trim()}`)
                .join("\n")
            : "",
        ]),
      ),
    });
  }

  sections.push({
    label: "SOW Details",
    body: cleanStrategyText(
      joinLines([
        "Client industry",
        String(mergedSow.industry ?? ""),
        "",
        "Target audience",
        String(mergedSow.targetAudience ?? ""),
        "",
        "Goals and requirements",
        String(mergedSow.understandingOfRequirements ?? ""),
        "",
        "Strategy and launch plan",
        String(mergedSow.strategyLaunchPlanning ?? ""),
        "",
        "Content deliverables",
        String(mergedSow.contentCreation ?? ""),
        "",
        "Deliverables summary",
        Array.isArray(mergedSow.deliverables) && mergedSow.deliverables.length > 0
          ? mergedSow.deliverables.map((item) => `- ${String(item)}`).join("\n")
          : "",
      ]),
    ),
  });

  return sections.filter((section) => section.body.trim().length > 0);
}

function escapePdfText(text: string): string {
  return cleanStrategyText(text)
    .replace(/[\\()]/g, "\\$&")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function wrapText(text: string, maxChars: number): string[] {
  const words = escapePdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildPdfContentLines(clientName: string, sections: Array<{ label: string; body: string }>) {
  const lines: Array<{ text: string; size: number; leading: number; bold?: boolean; indent?: number }> = [
    { text: "Jump to Action", size: 20, leading: 26, bold: true },
    { text: clientName, size: 11, leading: 20 },
  ];
  for (const section of sections) {
    lines.push({ text: section.label, size: 13, leading: 22, bold: true });
    for (const block of strategyDisplayBlocks(section.body)) {
      if (block.kind === "heading") {
        lines.push({ text: block.text, size: 11, leading: 16, bold: true });
      } else if (block.kind === "bullet") {
        for (const item of block.items) {
          for (const [index, line] of wrapText(item, 82).entries()) {
            lines.push({ text: `${index === 0 ? "- " : "  "}${line}`, size: 10, leading: 14, indent: 12 });
          }
        }
      } else {
        for (const line of wrapText(block.text, 88)) {
          lines.push({ text: line, size: 10, leading: 14 });
        }
      }
    }
  }
  return lines;
}

function buildStrategyPdfBlob(clientName: string, sections: Array<{ label: string; body: string }>): Blob {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const pageKids: number[] = [];
  const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const allLines = buildPdfContentLines(clientName, sections);
  const marginX = 58;
  const topY = 734;
  const bottomY = 58;
  let y = topY;
  let stream = "BT\n";
  const pagesId = add("");
  const finishPage = () => {
    stream += "ET";
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageKids.push(pageId);
    y = topY;
    stream = "BT\n";
  };
  for (const line of allLines) {
    if (y - line.leading < bottomY) finishPage();
    const x = marginX + (line.indent ?? 0);
    stream += `/F${line.bold ? "2" : "1"} ${line.size} Tf ${x} ${y} Td (${escapePdfText(line.text)}) Tj -${x} -${y} Td\n`;
    y -= line.leading;
  }
  finishPage();
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageKids.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageKids.length} >>`;
  let pdfText = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(pdfText.length);
    pdfText += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdfText.length;
  pdfText += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdfText += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdfText += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdfText], { type: "application/pdf" });
}

function getSectionApprovals(structured: Record<string, unknown>): SectionApprovals {
  return ((structured.__meta ?? {}) as { sectionApprovals?: SectionApprovals }).sectionApprovals ?? {};
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
