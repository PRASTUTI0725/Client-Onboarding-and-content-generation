import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateSow,
  getGetClientQueryKey,
  type Sow,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { localApiFetch } from "@/lib/local-api";
import { Plus, X, Save, Upload, FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { confirmPreflightLimit, estimateBytes, estimateTokens } from "@/lib/request-preflight";
import {
  buildInstagramValidationErrors,
  countParsedItems,
  looksLikeOptionalPlaceholder,
  parseMultilineItems,
} from "@/lib/instagram-intake";
import { ResearchBriefImportBlock } from "@/components/research-brief-import-block";
import type { ExistingClientValues, ResearchBriefApplyPayload, ResearchBriefImportMeta, ImportedResearchBrief } from "@workspace/research-brief";

const PLATFORM_OPTIONS = ["Instagram", "LinkedIn", "Pinterest", "X", "YouTube"];
const PILLAR_PRESETS = ["education", "thought_leadership", "social_proof", "behind_the_scenes", "promotion", "community"];

type SowParseMetaClient = {
  mode?: string;
  warnings?: string[];
  parseConfidence?: number;
  usedFallbackSplit?: boolean;
  sectionMap?: Record<string, { sourceLabel?: string; confidence?: number }>;
};

type NormalizedSowSections = Record<string, string>;

type StructuredInstagramInput = {
  handle: string;
  bio: string;
  offerSummary: string;
  recentCaptionSnippets: string[];
  recurringTopics: string[];
  additionalInstagramNotes?: string;
  ctaPatterns?: string[];
  proofSignals?: string[];
  followerCount?: string;
  category?: string;
  visualStyleNotes?: string;
};

function hasStructuredInstagramContent(value: StructuredInstagramInput | null | undefined): boolean {
  if (!value) return false;
  const hasBio = value.bio.trim().length > 0;
  const hasSupportingContent =
    value.offerSummary.trim().length > 0 ||
    value.recentCaptionSnippets.length > 0 ||
    value.recurringTopics.length > 0;
  return hasBio && hasSupportingContent;
}

function listToLines(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => String(item ?? "").trim()).filter(Boolean).join("\n");
}

function buildLegacyScopeFields(strategyLaunch: string, contentCreation: string): string {
  return [strategyLaunch, contentCreation].map((s) => s.trim()).filter(Boolean).join("\n\n");
}

type TextareaRest = Omit<ComponentProps<typeof Textarea>, "ref">;
function AutoGrowNarrativeTextarea({ className, value, onChange, ...rest }: TextareaRest) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <Textarea
      ref={ref}
      value={value}
      onChange={onChange}
      rows={1}
      className={cn(
        "min-h-44 min-w-0 w-full max-h-[min(70vh,42rem)] text-base leading-relaxed max-w-none overflow-y-auto resize-y",
        className,
      )}
      {...rest}
    />
  );
}

export type SowFormProps = {
  clientId: string;
  initial: Sow | null | undefined;
  onSaved?: () => void;
  /** Only for create / first-time flows. Hide on client detail so founders review extracted text, not re-upload. */
  showSowPdfUpload?: boolean;
  clientBasics?: {
    name?: string;
    website?: string;
    instagramHandle?: string;
    oneLineDescription?: string;
  };
};

export function SowForm({ clientId, initial, onSaved, showSowPdfUpload = false, clientBasics }: SowFormProps) {
  const initialAny = (initial ?? null) as unknown as Record<string, unknown> | null;
  const initialInstagram = ((initialAny?.instagram ?? null) as StructuredInstagramInput | null) ?? null;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [optimisticApproval, setOptimisticApproval] = useState<boolean | null>(null);
  const update = useUpdateSow({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
        toast({ title: "SOW approved and saved" });
        onSaved?.();
      },
      onError: (err) => {
        setOptimisticApproval(null);
        toast({ title: "Could not save SOW", description: String(err), variant: "destructive" });
      },
    },
  });

  const [platforms, setPlatforms] = useState<string[]>(initial?.platforms ?? ["Instagram"]);
  const [monthlyPosts, setMonthlyPosts] = useState<Record<string, number>>(
    (initial?.monthlyPosts as Record<string, number>) ?? { Instagram: 16 },
  );
  const [contentMix, setContentMix] = useState<Record<string, number>>(() => {
    const m = (initial?.contentMix as Record<string, number>) ?? {
      education: 6,
      thought_leadership: 5,
      social_proof: 3,
      promotion: 2,
    };
    return m;
  });
  const [deliverables, setDeliverables] = useState<string[]>(initial?.deliverables ?? []);
  const [newDeliverable, setNewDeliverable] = useState("");
  const [toneByPlatform, setToneByPlatform] = useState<Record<string, string>>(
    (initial?.toneByPlatform as Record<string, string>) ?? {},
  );
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfResult, setPdfResult] = useState<null | {
    fileName: string;
    extractedText: string;
    suggestions: Partial<{
      industry: string;
      targetAudience: string;
      normalizedSections: NormalizedSowSections;
      parseWarnings: string[];
      understandingOfRequirements: string;
      scopeOfWork: string;
      strategyLaunchPlanning: string;
      contentCreation: string;
      excludedCommercial: string;
      parseMeta: SowParseMetaClient;
      sowVersion: number;
      platforms: string[];
      monthlyPosts: Record<string, number>;
      contentMix: Record<string, number>;
      deliverables: string[];
      toneByPlatform: Record<string, string>;
    }>;
    detectedFields: string[];
    parseWarnings?: string[];
    warning?: string;
  }>(null);
  const [showExtractedText, setShowExtractedText] = useState(false);
  const [parseFeedback, setParseFeedback] = useState<string>("");
  const [pendingImportedResearchBrief, setPendingImportedResearchBrief] = useState<ImportedResearchBrief | null>(null);
  const [pendingResearchBriefImportMeta, setPendingResearchBriefImportMeta] = useState<ResearchBriefImportMeta | null>(null);
  const [pendingClientBasics, setPendingClientBasics] = useState<ResearchBriefApplyPayload["clientBasics"] | null>(null);
  const [industry, setIndustry] = useState(
    initialAny?.industry != null ? String(initialAny.industry) : "",
  );
  const [targetAudience, setTargetAudience] = useState(
    initialAny?.targetAudience != null ? String(initialAny.targetAudience) : "",
  );
  const [understandingOfRequirements, setUnderstandingOfRequirements] = useState(
    initialAny?.understandingOfRequirements
      ? String(initialAny.understandingOfRequirements)
      : "",
  );
  const [scopeOfWorkText, setScopeOfWorkText] = useState(() => {
    const sl =
      initialAny?.strategyLaunchPlanning != null ? String(initialAny.strategyLaunchPlanning).trim() : "";
    const leg = initialAny?.scopeOfWork != null ? String(initialAny.scopeOfWork).trim() : "";
    return sl || leg;
  });
  const [contentCreationText, setContentCreationText] = useState(
    initialAny?.contentCreation != null ? String(initialAny.contentCreation) : "",
  );
  const [excludedCommercial, setExcludedCommercial] = useState(
    initialAny?.excludedCommercial != null ? String(initialAny.excludedCommercial) : "",
  );
  const [instagramHandle, setInstagramHandle] = useState(initialInstagram?.handle ?? "");
  const [instagramBio, setInstagramBio] = useState(initialInstagram?.bio ?? "");
  const [instagramOfferSummary, setInstagramOfferSummary] = useState(initialInstagram?.offerSummary ?? "");
  const [instagramRecentCaptions, setInstagramRecentCaptions] = useState(
    listToLines(initialInstagram?.recentCaptionSnippets),
  );
  const [instagramRecurringTopics, setInstagramRecurringTopics] = useState(
    listToLines(initialInstagram?.recurringTopics),
  );
  const [instagramCtaPatterns, setInstagramCtaPatterns] = useState(listToLines(initialInstagram?.ctaPatterns));
  const [instagramProofSignals, setInstagramProofSignals] = useState(listToLines(initialInstagram?.proofSignals));
  const [instagramFollowerCount, setInstagramFollowerCount] = useState(initialInstagram?.followerCount ?? "");
  const [instagramCategory, setInstagramCategory] = useState(initialInstagram?.category ?? "");
  const [instagramVisualStyleNotes, setInstagramVisualStyleNotes] = useState(
    initialInstagram?.visualStyleNotes ?? "",
  );
  const [additionalInstagramNotes, setAdditionalInstagramNotes] = useState(
    initialInstagram?.additionalInstagramNotes ?? "",
  );
  const [showAdvancedInstagramDetails, setShowAdvancedInstagramDetails] = useState(
    Boolean(
      (initialInstagram?.ctaPatterns?.length ?? 0) > 0 ||
        (initialInstagram?.proofSignals?.length ?? 0) > 0 ||
        initialInstagram?.followerCount ||
        initialInstagram?.category ||
        initialInstagram?.visualStyleNotes,
    ),
  );
  const initialParseMeta = (initialAny?.parseMeta ?? null) as SowParseMetaClient | null;
  const [parseMetaState, setParseMetaState] = useState<SowParseMetaClient | null>(null);
  const displayParseMeta = parseMetaState ?? initialParseMeta;
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const approvedFromServer = Boolean(
    initialAny?.approval && (initialAny as { approval?: { approved?: boolean } }).approval?.approved,
  );
  const isApproved = optimisticApproval ?? approvedFromServer;
  const savedNormalizedSections = ((initialAny?.normalizedSections as NormalizedSowSections | undefined) ?? {});

  const initialSig = useMemo(
    () =>
      JSON.stringify({
        ind: (initial as unknown as Record<string, unknown> | null)?.industry,
        ta: (initial as unknown as Record<string, unknown> | null)?.targetAudience,
        u: (initial as unknown as Record<string, unknown> | null)?.understandingOfRequirements,
        s: (initial as unknown as Record<string, unknown> | null)?.scopeOfWork,
        sl: (initial as unknown as Record<string, unknown> | null)?.strategyLaunchPlanning,
        cc: (initial as unknown as Record<string, unknown> | null)?.contentCreation,
        ig: (initial as unknown as Record<string, unknown> | null)?.instagram,
      }),
    [initial],
  );
  const prevSig = useRef<string | null>(null);
  useEffect(() => {
    if (!initial || prevSig.current === initialSig) return;
    prevSig.current = initialSig;
    const i = initial as unknown as Record<string, unknown>;
    if (i.industry != null) setIndustry(String(i.industry));
    if (i.targetAudience != null) setTargetAudience(String(i.targetAudience));
    if (i.understandingOfRequirements != null) setUnderstandingOfRequirements(String(i.understandingOfRequirements));
    if (i.strategyLaunchPlanning != null) setScopeOfWorkText(String(i.strategyLaunchPlanning));
    else if (i.scopeOfWork != null) setScopeOfWorkText(String(i.scopeOfWork));
    if (i.contentCreation != null) setContentCreationText(String(i.contentCreation));
    if (i.excludedCommercial != null) setExcludedCommercial(String(i.excludedCommercial));
    const instagram = ((i.instagram ?? null) as StructuredInstagramInput | null) ?? null;
    setInstagramHandle(instagram?.handle ?? "");
    setInstagramBio(instagram?.bio ?? "");
    setInstagramOfferSummary(instagram?.offerSummary ?? "");
    setInstagramRecentCaptions(listToLines(instagram?.recentCaptionSnippets));
    setInstagramRecurringTopics(listToLines(instagram?.recurringTopics));
    setInstagramCtaPatterns(listToLines(instagram?.ctaPatterns));
    setInstagramProofSignals(listToLines(instagram?.proofSignals));
    setInstagramFollowerCount(instagram?.followerCount ?? "");
    setInstagramCategory(instagram?.category ?? "");
    setInstagramVisualStyleNotes(instagram?.visualStyleNotes ?? "");
    setAdditionalInstagramNotes(instagram?.additionalInstagramNotes ?? "");
    setShowAdvancedInstagramDetails(
      Boolean(
        (instagram?.ctaPatterns?.length ?? 0) > 0 ||
          (instagram?.proofSignals?.length ?? 0) > 0 ||
          instagram?.followerCount ||
          instagram?.category ||
          instagram?.visualStyleNotes,
      ),
    );
  }, [initial, initialSig]);

  const parsedInstagramRecentCaptions = useMemo(
    () => parseMultilineItems(instagramRecentCaptions),
    [instagramRecentCaptions],
  );
  const parsedInstagramRecurringTopics = useMemo(
    () => parseMultilineItems(instagramRecurringTopics, { allowCommaFallback: true }),
    [instagramRecurringTopics],
  );
  const parsedInstagramCtaPatterns = useMemo(
    () => parseMultilineItems(instagramCtaPatterns),
    [instagramCtaPatterns],
  );
  const parsedInstagramProofSignals = useMemo(
    () => parseMultilineItems(instagramProofSignals),
    [instagramProofSignals],
  );
  const instagramCaptionCount = countParsedItems(instagramRecentCaptions);
  const instagramTopicCount = countParsedItems(instagramRecurringTopics, { allowCommaFallback: true });
  const optionalInstagramWarnings = [
    looksLikeOptionalPlaceholder(additionalInstagramNotes)
      ? "Additional Instagram Notes looks like example or placeholder text and may be ignored later."
      : "",
    looksLikeOptionalPlaceholder(instagramCtaPatterns, [
      "Link in bio to join\nDM me START for details\nComment YES if you want more",
    ])
      ? "CTA Patterns still matches the example text. Replace it with real client language or leave it empty."
      : "",
    looksLikeOptionalPlaceholder(instagramProofSignals, [
      "Client testimonials in highlights\nBefore and after results\nFeatured in local media",
    ])
      ? "Proof / Trust Signals still matches the example text. Replace it with real proof or leave it empty."
      : "",
    looksLikeOptionalPlaceholder(instagramCategory, ["Fitness Coach / E-commerce / Bakery"])
      ? "Profile Category still looks like the example placeholder. Replace it with the real profile category or leave it blank."
      : "",
    looksLikeOptionalPlaceholder(instagramVisualStyleNotes, [
      "Light, minimal, beige tones; consistent grid layout; high-contrast reels thumbnails.",
    ])
      ? "Visual Style Notes still looks like the example placeholder. Replace it with real notes or leave it empty."
      : "",
  ].filter(Boolean);

  useEffect(() => {
    if (approvedFromServer) setOptimisticApproval(null);
  }, [approvedFromServer]);

  useEffect(() => {
    setMonthlyPosts((prev) => {
      const out: Record<string, number> = {};
      for (const p of platforms) out[p] = prev[p] ?? 12;
      return out;
    });
    setToneByPlatform((prev) => {
      const out: Record<string, string> = {};
      for (const p of platforms) out[p] = prev[p] ?? "";
      return out;
    });
  }, [platforms]);

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const setPillarPercent = (k: string, v: number) => {
    setContentMix((prev) => ({ ...prev, [k]: v }));
  };

  const addPillar = () => {
    const next = PILLAR_PRESETS.find((p) => contentMix[p] === undefined);
    if (next) setContentMix((prev) => ({ ...prev, [next]: 0 }));
  };

  const removePillar = (k: string) => {
    setContentMix((prev) => {
      const out = { ...prev };
      delete out[k];
      return out;
    });
  };

  const addDeliverable = () => {
    if (newDeliverable.trim()) {
      setDeliverables((prev) => [...prev, newDeliverable.trim()]);
      setNewDeliverable("");
    }
  };

  const mixTotal = Object.values(contentMix).reduce((a, b) => a + (Number(b) || 0), 0);
  const totalPosts = Object.values(monthlyPosts).reduce((a, b) => a + (Number(b) || 0), 0);
  const mixDelta = totalPosts - mixTotal;

  useEffect(() => {
    const key = `sow-validation-v1-${clientId}`;
    const state = {
      mixTotal,
      totalPosts,
      aligned: mixTotal === totalPosts && totalPosts > 0,
      savedAt: new Date().toISOString(),
    };
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        /* ignore quota */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [clientId, mixTotal, totalPosts]);

  const hasPdfSuggestions = useMemo(
    () =>
      !!pdfResult &&
      Object.entries(pdfResult.suggestions).some(([key, v]) => {
        if (key === "parseWarnings") return false;
        return Array.isArray(v) ? v.length > 0 : !!v && Object.keys(v as object).length > 0;
      }),
    [pdfResult],
  );

  const save = () => {
    if (platforms.length === 0) {
      toast({ title: "Pick at least one platform", variant: "destructive" });
      return;
    }
    if (totalPosts <= 0) {
      toast({ title: "Set monthly post counts", variant: "destructive" });
      return;
    }
    const zeroPlatform = platforms.find((p) => (monthlyPosts[p] ?? 0) <= 0);
    if (zeroPlatform) {
      toast({
        title: "Set posts for each active platform",
        description: `${zeroPlatform} is on but has 0 monthly posts — set a target (e.g. 12) or turn the platform off.`,
        variant: "destructive",
      });
      return;
    }
    if (mixTotal !== totalPosts) {
      toast({
        title: "Content mix must match monthly posts",
        description: `Pillar post counts should sum to ${totalPosts} (currently ${mixTotal}).`,
        variant: "destructive",
      });
      return;
    }
    if (!understandingOfRequirements.trim() || !scopeOfWorkText.trim()) {
      toast({
        title: "SOW text required",
        description: "Add Goals and requirements plus a Strategy and launch plan at minimum.",
        variant: "destructive",
      });
      return;
    }
    const instagram = {
      handle: instagramHandle.trim(),
      bio: instagramBio.trim(),
      offerSummary: instagramOfferSummary.trim(),
      recentCaptionSnippets: parsedInstagramRecentCaptions,
      recurringTopics: parsedInstagramRecurringTopics,
      ...(additionalInstagramNotes.trim()
        ? { additionalInstagramNotes: additionalInstagramNotes.trim() }
        : {}),
      ...(parsedInstagramCtaPatterns.length > 0 ? { ctaPatterns: parsedInstagramCtaPatterns } : {}),
      ...(parsedInstagramProofSignals.length > 0 ? { proofSignals: parsedInstagramProofSignals } : {}),
      ...(instagramFollowerCount.trim() ? { followerCount: instagramFollowerCount.trim() } : {}),
      ...(instagramCategory.trim() ? { category: instagramCategory.trim() } : {}),
      ...(instagramVisualStyleNotes.trim() ? { visualStyleNotes: instagramVisualStyleNotes.trim() } : {}),
    };
    const hasExistingStructuredInstagram = hasStructuredInstagramContent(initialInstagram);
    const isActivelyFillingInstagramBlock = Boolean(
      instagram.handle ||
        instagram.bio ||
        instagram.offerSummary ||
        instagram.recentCaptionSnippets.length > 0 ||
        instagram.recurringTopics.length > 0,
    );
    const shouldRequireStructuredInstagram = hasExistingStructuredInstagram || isActivelyFillingInstagramBlock;
    const instagramValidationErrors = shouldRequireStructuredInstagram
      ? buildInstagramValidationErrors({
          handle: instagram.handle,
          bio: instagram.bio,
          offerSummary: instagram.offerSummary,
          recentCaptionCount: instagram.recentCaptionSnippets.length,
          recurringTopicCount: instagram.recurringTopics.length,
        })
      : [];
    if (instagramValidationErrors.length > 0) {
      toast({
        title: "Instagram context incomplete",
        description: instagramValidationErrors.join(" "),
        variant: "destructive",
      });
      return;
    }
    const approved = true;
    const preservedPdf = initialAny?.pdfExtraction;
    const pMismatch = initialAny?.pdfMismatch as
      | { detected?: boolean; message?: string; details?: string[]; checks?: { label: string; passed: boolean }[] }
      | undefined;
    const sl = scopeOfWorkText.trim();
    const cc = contentCreationText.trim();
    const scopeCombined = buildLegacyScopeFields(sl, cc) || sl;
    const nextParseMeta: SowParseMetaClient | null = displayParseMeta
      ? { ...displayParseMeta, sectionMap: displayParseMeta.sectionMap }
      : (initialAny?.parseMeta as SowParseMetaClient | null) ?? null;
    const normalizedSections: NormalizedSowSections = {
      ...savedNormalizedSections,
      industry: industry.trim(),
      targetAudience: targetAudience.trim(),
      objectivesAndGoals: understandingOfRequirements.trim(),
      scopeOfWork: scopeCombined,
      strategyLaunchPlanning: sl,
      contentCreationScope: cc,
      monthlyDeliverables: deliverables.join("\n"),
    };
    const preservedPdfSlim =
      preservedPdf && typeof preservedPdf === "object"
        ? Object.fromEntries(
            Object.entries(preservedPdf as Record<string, unknown>).filter(([key]) =>
              [
                "fileName",
                "sectionsExtracted",
                "parseWarnings",
                "compactContextTokens",
                "sourceTokens",
                "tokenReductionPct",
                "sourceTextAvailable",
                "sourceTextCharCount",
                "embeddingModel",
              ].includes(key),
            ),
          )
        : undefined;
    const payload = {
      clientId,
      data: {
        sowVersion: 2,
        industry: industry.trim(),
        targetAudience: targetAudience.trim(),
        normalizedSections,
        understandingOfRequirements,
        strategyLaunchPlanning: sl,
        contentCreation: cc,
        scopeOfWork: scopeCombined,
        ...(nextParseMeta ? { parseMeta: nextParseMeta } : {}),
        approval: {
          approved,
          approvedAt: approved ? new Date().toISOString() : null,
        },
        platforms,
        monthlyPosts,
        contentMix,
        deliverables,
        toneByPlatform,
        ...(shouldRequireStructuredInstagram ? { instagram } : {}),
        ...(pMismatch
          ? {
              pdfMismatch: {
                ...pMismatch,
                acknowledged: true,
              },
            }
          : {}),
        ...(preservedPdfSlim != null ? { pdfExtraction: preservedPdfSlim } : {}),
        ...(pendingResearchBriefImportMeta ? { researchBriefImport: pendingResearchBriefImportMeta } : {}),
        ...(pendingClientBasics ? { clientBasics: pendingClientBasics } : {}),
      },
    } as unknown as Parameters<typeof update.mutate>[0];
    const preflightPayload = {
      clientId,
      data: {
        industry: industry.trim(),
        targetAudience: targetAudience.trim(),
        understandingOfRequirements: understandingOfRequirements.trim().slice(0, 1200),
        strategyLaunchPlanning: sl.slice(0, 1200),
        contentCreation: cc.slice(0, 1200),
        deliverables: deliverables.slice(0, 8),
        ...(shouldRequireStructuredInstagram
          ? {
              instagram: {
                handle: instagram.handle,
                bio: instagram.bio.slice(0, 500),
                offerSummary: instagram.offerSummary.slice(0, 300),
                recentCaptionSnippets: instagram.recentCaptionSnippets.slice(0, 6),
                recurringTopics: instagram.recurringTopics.slice(0, 5),
              },
            }
          : {}),
        platforms,
        monthlyPosts,
        contentMix,
      },
    };
    const proceed = confirmPreflightLimit({
      context: "SOW save preflight",
      estimatedTokens: estimateTokens(preflightPayload),
      estimatedBytes: estimateBytes(payload),
      tokenThreshold: 2500,
      byteThreshold: 80 * 1024,
    });
    if (!proceed) return;
    setOptimisticApproval(true);
    update.mutate(payload);
  };

  async function parsePdf() {
    if (!pdfFile) {
      toast({ title: "Choose a PDF first", variant: "destructive" });
      return;
    }
    try {
      setPdfParsing(true);
      const fd = new FormData();
      fd.append("file", pdfFile);
      const res = await localApiFetch(`/api/clients/${clientId}/sow/pdf-parse`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const payload = (await res.json()) as { error?: string };
          detail = payload.error ?? detail;
        } catch {
          const text = await res.text();
          if (text.trim()) detail = text;
        }
        throw new Error(detail);
      }
      const parsed = (await res.json()) as {
        fileName: string;
        extractedText: string;
        suggestions: Partial<{
          industry: string;
          targetAudience: string;
          parseWarnings: string[];
          understandingOfRequirements: string;
          scopeOfWork: string;
          platforms: string[];
          monthlyPosts: Record<string, number>;
          contentMix: Record<string, number>;
          deliverables: string[];
          toneByPlatform: Record<string, string>;
        }>;
        detectedFields: string[];
        parseWarnings?: string[];
        warning?: string;
      };
      setPdfResult(parsed);
      setShowExtractedText(false);
      setParseFeedback(
        parsed.detectedFields.length > 0
          ? `Parse success: mapped ${parsed.detectedFields.join(", ")}`
          : "Parse completed but no structured fields were confidently detected.",
      );
      toast({
        title: "PDF parsed",
        description:
          parsed.detectedFields.length > 0
            ? `Detected: ${parsed.detectedFields.join(", ")}`
            : "No structured fields detected yet; review extracted text.",
      });
    } catch (err) {
      setParseFeedback(`Parse failed: ${String(err)}`);
      toast({
        title: "PDF parsing failed",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setPdfParsing(false);
    }
  }

  function applyPdfSuggestions() {
    if (!pdfResult) return;
    const s = pdfResult.suggestions;
    if (s.industry) setIndustry(s.industry);
    if (s.targetAudience) setTargetAudience(s.targetAudience);
    if (s.understandingOfRequirements) setUnderstandingOfRequirements(s.understandingOfRequirements);
    if (s.strategyLaunchPlanning) setScopeOfWorkText(s.strategyLaunchPlanning);
    else if (s.scopeOfWork) setScopeOfWorkText(s.scopeOfWork);
    if (s.contentCreation) setContentCreationText(s.contentCreation);
    if (s.excludedCommercial) setExcludedCommercial(s.excludedCommercial);
    if (s.parseMeta) setParseMetaState(s.parseMeta);
    if (s.platforms?.length) {
      setPlatforms(s.platforms);
    }
    if (s.monthlyPosts && Object.keys(s.monthlyPosts).length) {
      setMonthlyPosts((prev) => ({ ...prev, ...s.monthlyPosts }));
    }
    if (s.contentMix && Object.keys(s.contentMix).length) {
      setContentMix((prev) => ({ ...prev, ...s.contentMix }));
    }
    if (s.deliverables?.length) {
      setDeliverables((prev) => Array.from(new Set([...prev, ...s.deliverables!])));
    }
    if (s.toneByPlatform && Object.keys(s.toneByPlatform).length) {
      setToneByPlatform((prev) => ({ ...prev, ...s.toneByPlatform }));
    }
    toast({
      title: "Applied PDF suggestions",
      description: "Auto-filled what could be identified. Review fields before saving.",
    });
  }

  function clearPdfState() {
    setPdfFile(null);
    setPdfResult(null);
    setShowExtractedText(false);
    if (pdfInputRef.current) {
      pdfInputRef.current.value = "";
    }
  }

  const pMismatch = initialAny?.pdfMismatch as
    | {
        detected?: boolean;
        message?: string;
        details?: string[];
        checks?: { label: string; passed: boolean; code?: string }[];
        acknowledged?: boolean;
      }
    | undefined;
  const showPdfMismatch = Boolean(pMismatch?.detected && !pMismatch?.acknowledged);

  const lowConfidence =
    displayParseMeta != null &&
    (displayParseMeta.usedFallbackSplit === true ||
      (displayParseMeta.parseConfidence != null && displayParseMeta.parseConfidence < 0.55));
  const metaWarnings =
    displayParseMeta?.warnings?.length
      ? displayParseMeta.warnings
      : ((initialAny?.pdfExtraction as { parseWarnings?: string[] } | undefined)?.parseWarnings ?? []);

  const sectionHint = (key: keyof NonNullable<SowParseMetaClient["sectionMap"]> | string) => {
    const m = displayParseMeta?.sectionMap;
    if (!m || typeof m !== "object") return undefined;
    const e = m[key] as { sourceLabel?: string } | undefined;
    return e?.sourceLabel;
  };
  const extractedSummarySections =
    (pdfResult?.suggestions.normalizedSections as NormalizedSowSections | undefined) ?? savedNormalizedSections;
  const summaryEntries = Object.entries(extractedSummarySections).filter(([, value]) => String(value ?? "").trim());

  const importExistingValues = useMemo<ExistingClientValues>(
    () => ({
      clientName: clientBasics?.name ?? "",
      website: clientBasics?.website ?? "",
      instagramHandle: clientBasics?.instagramHandle ?? instagramHandle,
      oneLineDescription: clientBasics?.oneLineDescription ?? "",
      industry,
      targetAudience,
      understandingOfRequirements,
      strategyLaunchPlanning: scopeOfWorkText,
      contentCreation: contentCreationText,
      deliverables,
      instagram: {
        handle: instagramHandle,
        bio: instagramBio,
        offerSummary: instagramOfferSummary,
        recentCaptionSnippets: parsedInstagramRecentCaptions,
        recurringTopics: parsedInstagramRecurringTopics,
        ctaPatterns: parsedInstagramCtaPatterns,
        proofSignals: parsedInstagramProofSignals,
        followerCount: instagramFollowerCount,
        category: instagramCategory,
        visualStyleNotes: instagramVisualStyleNotes,
        additionalInstagramNotes,
      },
    }),
    [
      clientBasics,
      industry,
      targetAudience,
      understandingOfRequirements,
      scopeOfWorkText,
      contentCreationText,
      deliverables,
      instagramHandle,
      instagramBio,
      instagramOfferSummary,
      parsedInstagramRecentCaptions,
      parsedInstagramRecurringTopics,
      parsedInstagramCtaPatterns,
      parsedInstagramProofSignals,
      instagramFollowerCount,
      instagramCategory,
      instagramVisualStyleNotes,
      additionalInstagramNotes,
    ],
  );

  async function handleResearchBriefImport(payload: ResearchBriefApplyPayload) {
    if (payload.clientBasics) {
      setPendingClientBasics((prev) => ({ ...prev, ...payload.clientBasics }));
    }
    if (payload.clientBasics?.instagramHandle) {
      setInstagramHandle(payload.clientBasics.instagramHandle);
    }
    if (payload.sow?.industry) setIndustry(payload.sow.industry);
    if (payload.sow?.targetAudience) setTargetAudience(payload.sow.targetAudience);
    if (payload.sow?.understandingOfRequirements) setUnderstandingOfRequirements(payload.sow.understandingOfRequirements);
    if (payload.sow?.strategyLaunchPlanning) setScopeOfWorkText(payload.sow.strategyLaunchPlanning);
    if (payload.sow?.contentCreation) setContentCreationText(payload.sow.contentCreation);
    if (payload.sow?.deliverables?.length) {
      setDeliverables((prev) => Array.from(new Set([...prev, ...payload.sow!.deliverables!])));
    }
    if (payload.instagram?.handle) setInstagramHandle(payload.instagram.handle);
    if (payload.instagram?.bio) setInstagramBio(payload.instagram.bio);
    if (payload.instagram?.offerSummary) setInstagramOfferSummary(payload.instagram.offerSummary);
    if (payload.instagram?.recentCaptionSnippets?.length) {
      setInstagramRecentCaptions(payload.instagram.recentCaptionSnippets.join("\n"));
    }
    if (payload.instagram?.recurringTopics?.length) {
      setInstagramRecurringTopics(payload.instagram.recurringTopics.join("\n"));
    }
    if (payload.instagram?.ctaPatterns?.length) {
      setInstagramCtaPatterns(payload.instagram.ctaPatterns.join("\n"));
      setShowAdvancedInstagramDetails(true);
    }
    if (payload.instagram?.proofSignals?.length) {
      setInstagramProofSignals(payload.instagram.proofSignals.join("\n"));
      setShowAdvancedInstagramDetails(true);
    }
    if (payload.instagram?.followerCount) {
      setInstagramFollowerCount(payload.instagram.followerCount);
      setShowAdvancedInstagramDetails(true);
    }
    if (payload.instagram?.category) {
      setInstagramCategory(payload.instagram.category);
      setShowAdvancedInstagramDetails(true);
    }
    if (payload.instagram?.visualStyleNotes) {
      setInstagramVisualStyleNotes(payload.instagram.visualStyleNotes);
      setShowAdvancedInstagramDetails(true);
    }
    if (payload.instagram?.additionalInstagramNotes) {
      setAdditionalInstagramNotes(payload.instagram.additionalInstagramNotes);
    }

    setPendingImportedResearchBrief(payload.importedResearchBrief);
    setPendingResearchBriefImportMeta(payload.researchBriefImportMeta);

    try {
      const res = await localApiFetch(`/api/clients/${clientId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importedResearchBrief: payload.importedResearchBrief }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `HTTP ${res.status}`);
      }
      queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
    } catch (err) {
      toast({
        title: "Imported to form; save pending",
        description: `Research notes could not persist yet: ${String(err)}`,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-8" data-sow-version="2">
      {lowConfidence && (
        <Alert
          variant="default"
          className="border-amber-300 bg-amber-50/90 text-amber-950"
          data-testid="sow-low-confidence-banner"
        >
          <AlertTitle>Review suggested — parse confidence is low</AlertTitle>
          <AlertDescription className="space-y-1 text-sm">
            {displayParseMeta?.usedFallbackSplit && (
              <p>Headings may have been missing; we used a length-based split. Edit sections to match the PDF.</p>
            )}
            {displayParseMeta?.parseConfidence != null && (
              <p>Confidence: {Math.round((displayParseMeta.parseConfidence as number) * 100)}%</p>
            )}
            {metaWarnings.length > 0 && (
              <ul className="list-disc pl-4 space-y-0.5">
                {metaWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}
      {showPdfMismatch && (
        <Alert
          variant="default"
          className="border-amber-400 bg-amber-50/90 text-amber-950"
          data-testid="sow-pdf-mismatch-banner"
        >
          <AlertTitle>Uploaded PDF may not match this client</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{pMismatch?.message}</p>
            {pMismatch?.checks && pMismatch.checks.length > 0 && (
              <ul className="list-disc pl-4 text-sm space-y-0.5">
                {pMismatch.checks.map((c) => (
                  <li key={c.code ?? c.label} className={c.passed ? "text-emerald-800" : "text-amber-900"}>
                    {c.label}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm">
              Save the SOW to acknowledge you’ve reviewed this, or re-upload a PDF that clearly references this
              brand. We don’t auto-treat a mismatched file as the same client.
            </p>
          </AlertDescription>
        </Alert>
      )}
      {showSowPdfUpload && (
        <SowBlock
          title="SOW PDF upload (extract)"
          kicker="Use during first-time setup. On the client workspace we keep only your reviewed text—no re-upload required."
        >
          <div className="space-y-3 rounded-lg border border-dashed border-border/80 bg-muted/20 p-4">
            <div className="flex items-start sm:items-center gap-3 flex-wrap">
              <Input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                className="w-full sm:max-w-sm"
                data-testid="sow-pdf-input"
              />
              <span className="text-xs text-muted-foreground" data-testid="sow-pdf-selected-label">
                {pdfFile ? pdfFile.name : "No file selected"}
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={parsePdf}
                disabled={!pdfFile || pdfParsing}
                className="gap-2"
                data-testid="parse-sow-pdf-button"
              >
                <Upload className="size-4" />
                {pdfParsing ? "Extracting…" : "Extract + suggest"}
              </Button>
              {(pdfFile || pdfResult) && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={clearPdfState}
                  className="gap-1.5"
                  data-testid="cancel-sow-pdf-button"
                >
                  <X className="size-4" />
                  Cancel
                </Button>
              )}
              {pdfResult && (
                <Badge variant="secondary" className="gap-1.5">
                  <FileText className="size-3.5" />
                  {pdfResult.fileName}
                </Badge>
              )}
            </div>
            {pdfResult && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {pdfResult.warning ?? "Auto-filled what could be identified. Review before saving."}
                </p>
                {summaryEntries.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {summaryEntries.map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-border/80 bg-background/70 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {formatSummaryLabel(key)}
                        </p>
                        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={applyPdfSuggestions}
                    disabled={!hasPdfSuggestions}
                    data-testid="apply-sow-pdf-suggestions-button"
                  >
                    Apply suggestions
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowExtractedText((v) => !v)}
                    data-testid="toggle-sow-pdf-text-button"
                  >
                    {showExtractedText ? "Hide source text" : "View source text"}
                  </Button>
                </div>
                {showExtractedText && (
                  <Textarea
                    readOnly
                    value={pdfResult.extractedText || "No text extracted from PDF."}
                    className="min-h-52 w-full text-sm leading-relaxed"
                  />
                )}
              </div>
            )}
            {parseFeedback && (
              <p
                className={`text-sm ${parseFeedback.startsWith("Parse failed") ? "text-destructive" : "text-emerald-700"}`}
                data-testid="sow-pdf-parse-feedback"
              >
                {parseFeedback}
              </p>
            )}
          </div>
        </SowBlock>
      )}

      {pdfParsing && showSowPdfUpload && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      <SowBlock
        title="Import Research Brief"
        kicker="Paste or upload a standardized Markdown brief (.md / .txt). Review the preview before fields are filled — nothing overwrites existing values without confirmation."
      >
        <ResearchBriefImportBlock existing={importExistingValues} onConfirmImport={handleResearchBriefImport} />
      </SowBlock>

      <SowBlock
        title="Client industry"
        kicker="Paste the category, product type, and market context for this client."
      >
        <Textarea
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          placeholder="e.g. Premium skincare, D2C home decor, B2B SaaS for HR teams"
          className="min-h-24 w-full text-base leading-relaxed"
          data-testid="sow-industry-input"
        />
      </SowBlock>

      <SowBlock
        title="Target audience"
        kicker="Paste who the client wants to reach, what they care about, and any audience segments that matter."
      >
        <Textarea
          value={targetAudience}
          onChange={(e) => setTargetAudience(e.target.value)}
          placeholder="e.g. Founders at 5-50 person startups who need better hiring systems"
          className="min-h-28 w-full text-base leading-relaxed"
          data-testid="sow-target-audience-input"
        />
      </SowBlock>

      <SowBlock
        title="Goals and requirements"
        kicker="Paste the goals, what success looks like, and any important constraints or requirements."
        sourceHint={sectionHint("understandingOfRequirements")}
      >
        <AutoGrowNarrativeTextarea
          value={understandingOfRequirements}
          onChange={(e) => setUnderstandingOfRequirements(e.target.value)}
          placeholder="Paste the core goals, expectations, constraints, and what the client wants this work to achieve."
          data-testid="sow-understanding-input"
        />
      </SowBlock>

      <SowBlock
        title="Strategy and launch plan"
        kicker="Paste the rollout plan, launch timing, monthly priorities, and what is included in scope."
        sourceHint={sectionHint("strategyLaunchPlanning")}
      >
        <AutoGrowNarrativeTextarea
          value={scopeOfWorkText}
          onChange={(e) => setScopeOfWorkText(e.target.value)}
          placeholder="Paste the launch plan, campaign timing, monthly structure, and execution scope."
          data-testid="sow-scope-input"
        />
      </SowBlock>

      <SowBlock
        title="Content deliverables"
        kicker="Paste the content scope: reels, carousels, pins, videos, stories, reporting, and recurring outputs."
        sourceHint={sectionHint("contentCreation")}
      >
        <p className="text-sm text-muted-foreground -mt-1 mb-2">Full SOW notes</p>
        <AutoGrowNarrativeTextarea
          value={contentCreationText}
          onChange={(e) => setContentCreationText(e.target.value)}
          placeholder="Paste the original deliverables wording here if you want to keep the full SOW language."
          data-testid="sow-content-creation-narrative"
          className="mb-4"
        />
        <p className="text-sm font-medium text-foreground mb-1">Deliverables summary</p>
        <p className="text-xs text-muted-foreground mb-2">Short list of recurring outputs like weekly reels, monthly carousel, Pinterest pins</p>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {deliverables.map((d, i) => (
              <Badge key={i} variant="secondary" className="gap-1.5 font-normal text-sm py-1.5 px-3">
                {d}
                <button
                  type="button"
                  onClick={() => setDeliverables((prev) => prev.filter((_, j) => j !== i))}
                  className="hover:text-foreground"
                  aria-label={`Remove deliverable ${d}`}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Textarea
              value={newDeliverable}
              onChange={(e) => setNewDeliverable(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  addDeliverable();
                }
              }}
              placeholder="e.g. 1× monthly product education reel, 2× story sets / week"
              className="min-h-11 text-base resize-y"
            />
            <Button variant="outline" size="sm" onClick={addDeliverable} className="w-full sm:w-auto self-start" type="button">
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      </SowBlock>

      <SowBlock
        title="Instagram Context"
        kicker="Fill this carefully. This is the main source of truth about the client’s Instagram presence for v1 generation."
      >
        <div className="space-y-5">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Instagram Handle</p>
            <p className="text-xs text-muted-foreground">Enter the exact Instagram handle with or without @.</p>
            <Input
              value={instagramHandle}
              onChange={(e) => setInstagramHandle(e.target.value)}
              placeholder="@yourbrand"
              className="text-base h-11"
              data-testid="sow-instagram-handle-input"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Profile Bio</p>
            <p className="text-xs text-muted-foreground">Paste the full bio exactly as shown, including CTA or link language.</p>
            <Textarea
              value={instagramBio}
              onChange={(e) => setInstagramBio(e.target.value)}
              placeholder="Paste the full bio text exactly as it appears on the profile."
              className="min-h-24 text-base"
              data-testid="sow-instagram-bio-input"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">What They Sell / Offer</p>
            <p className="text-xs text-muted-foreground">In 1-3 sentences, describe the main service, product, or transformation promoted on Instagram.</p>
            <Textarea
              value={instagramOfferSummary}
              onChange={(e) => setInstagramOfferSummary(e.target.value)}
              placeholder="In 1-3 sentences, what does this business offer on Instagram?"
              className="min-h-24 text-base"
              data-testid="sow-instagram-offer-input"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Recent Post Captions or Post Themes</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">One idea per line</p>
              <p className="text-xs font-medium text-muted-foreground">{instagramCaptionCount} / 4 minimum</p>
            </div>
            <Textarea
              value={instagramRecentCaptions}
              onChange={(e) => setInstagramRecentCaptions(e.target.value)}
              placeholder={'New workshop this weekend - sign up link in bio\nBehind the scenes of our shoot for brand X\nTop 3 mistakes people make when starting yoga at home'}
              className="min-h-32 text-base"
              data-testid="sow-instagram-captions-input"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Recurring Content Topics</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">One topic per line</p>
              <p className="text-xs font-medium text-muted-foreground">{instagramTopicCount} / 3 minimum</p>
            </div>
            <Textarea
              value={instagramRecurringTopics}
              onChange={(e) => setInstagramRecurringTopics(e.target.value)}
              placeholder={'home workouts\nmeal prep ideas\nclient transformations'}
              className="min-h-28 text-base"
              data-testid="sow-instagram-topics-input"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Additional Instagram Notes</p>
            <p className="text-xs text-muted-foreground">Optional. Add anything else useful for strategy, including CTA ideas, proof signals, or private Instagram insights.</p>
            <Textarea
              value={additionalInstagramNotes}
              onChange={(e) => setAdditionalInstagramNotes(e.target.value)}
              placeholder="Optional: paste private Instagram insights, CTA notes, audience observations, proof cues, or anything helpful that does not fit the required fields."
              className="min-h-24 text-base"
              data-testid="sow-instagram-additional-notes-input"
            />
          </div>
          {optionalInstagramWarnings.length > 0 ? (
            <Alert className="border-amber-300 bg-amber-50/80 text-amber-950">
              <AlertTitle>Optional Instagram notes may still contain placeholder text</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-5">
                  {optionalInstagramWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Advanced Instagram details</p>
                <p className="text-xs text-muted-foreground">
                  Optional. Use this only if you have extra proof, CTA, category, or visual notes.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowAdvancedInstagramDetails((prev) => !prev)}
                data-testid="toggle-instagram-advanced-details"
              >
                {showAdvancedInstagramDetails ? "Hide advanced details" : "Show advanced details"}
              </Button>
            </div>
            {showAdvancedInstagramDetails ? (
              <div className="mt-4 space-y-5">
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-foreground">CTA Patterns</p>
                  <p className="text-xs text-muted-foreground">Optional. Add repeated calls to action, one per line.</p>
                  <Textarea
                    value={instagramCtaPatterns}
                    onChange={(e) => setInstagramCtaPatterns(e.target.value)}
                    placeholder={"Link in bio to join\nDM me START for details\nComment YES if you want more"}
                    className="min-h-24 text-base"
                    data-testid="sow-instagram-cta-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-foreground">Proof / Trust Signals</p>
                  <p className="text-xs text-muted-foreground">Optional. Add visible testimonials, results, media logos, or proof cues, one per line.</p>
                  <Textarea
                    value={instagramProofSignals}
                    onChange={(e) => setInstagramProofSignals(e.target.value)}
                    placeholder={"Client testimonials in highlights\nBefore and after results\nFeatured in local media"}
                    className="min-h-24 text-base"
                    data-testid="sow-instagram-proof-input"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-foreground">Follower Count</p>
                    <p className="text-xs text-muted-foreground">Optional. Enter it as shown, like 12.4K or 123K.</p>
                    <Input
                      value={instagramFollowerCount}
                      onChange={(e) => setInstagramFollowerCount(e.target.value)}
                      placeholder="12.4K"
                      className="text-base h-11"
                      data-testid="sow-instagram-followers-input"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-foreground">Profile Category</p>
                    <p className="text-xs text-muted-foreground">Optional. Enter the profile category shown under the name.</p>
                    <Input
                      value={instagramCategory}
                      onChange={(e) => setInstagramCategory(e.target.value)}
                      placeholder="Fitness Coach / E-commerce / Bakery"
                      className="text-base h-11"
                      data-testid="sow-instagram-category-input"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-foreground">Visual Style Notes</p>
                  <p className="text-xs text-muted-foreground">Optional. Describe the overall vibe, colors, layout, or thumbnail style.</p>
                  <Textarea
                    value={instagramVisualStyleNotes}
                    onChange={(e) => setInstagramVisualStyleNotes(e.target.value)}
                    placeholder="Light, minimal, beige tones; consistent grid layout; high-contrast reels thumbnails."
                    className="min-h-24 text-base"
                    data-testid="sow-instagram-visual-input"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </SowBlock>

      <SowBlock
        title="Platform management"
        kicker="Which channels you run, how many posts per month, and how the brand should sound on each."
      >
        <div
          className="rounded-md border border-border/80 bg-muted/25 p-3 sm:p-3.5 space-y-2.5"
          data-testid="sow-validation-status-strip"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SOW status</p>
          <ul className="space-y-1.5 text-sm text-foreground">
            {platforms.length === 0 && (
              <li className="text-amber-800 dark:text-amber-200">Select at least one platform to continue.</li>
            )}
            {platforms.map((p) => {
              const n = monthlyPosts[p] ?? 0;
              const ok = n > 0;
              return (
                <li key={p} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="inline-flex w-4 shrink-0" aria-hidden>
                    {ok ? <span className="text-emerald-600">✓</span> : <span className="text-destructive">✗</span>}
                  </span>
                  {ok ? (
                    <span>
                      <span className="font-medium">{p}:</span> {n} posts / month
                    </span>
                  ) : (
                    <span>
                      <span className="font-medium">{p}:</span> 0 posts / month — set a monthly target (e.g. 12) or turn this platform off
                    </span>
                  )}
                </li>
              );
            })}
            <li className="flex flex-wrap items-baseline gap-x-2 pt-1 border-t border-border/60">
              <span className="inline-flex w-4 shrink-0" aria-hidden>
                {totalPosts > 0 && mixTotal === totalPosts ? (
                  <span className="text-emerald-600">✓</span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-200">!</span>
                )}
              </span>
              <span>
                <span className="font-medium">Content pillars (global):</span> {mixTotal} / {totalPosts} monthly posts
                {totalPosts > 0 && mixTotal !== totalPosts && (
                  <span className="text-muted-foreground">
                    {mixDelta > 0
                      ? ` — add ${mixDelta} to pillars`
                      : ` — remove ${-mixDelta} from pillars`}
                  </span>
                )}
                {totalPosts === 0 && <span className="text-muted-foreground"> — set platform monthly totals first</span>}
              </span>
            </li>
          </ul>
        </div>
        <div className="space-y-6">
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Active platforms</p>
            <div className="flex flex-wrap gap-2">
              {PLATFORM_OPTIONS.map((p) => {
                const active = platforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
                      active
                        ? "bg-foreground text-background border-foreground"
                        : "bg-card border-border text-muted-foreground hover:border-foreground/30"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Monthly post volume</p>
            <p className="text-xs text-muted-foreground mb-2">Per platform, per month. Current total: {totalPosts} posts.</p>
            <div className="space-y-3">
              {platforms.map((p) => (
                <div key={p} className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium w-full sm:w-36">{p}</span>
                  <Input
                    type="number"
                    min={0}
                    value={monthlyPosts[p] ?? 0}
                    onChange={(e) => setMonthlyPosts((prev) => ({ ...prev, [p]: Number(e.target.value) || 0 }))}
                    className="w-full sm:w-28 text-base"
                  />
                  <span className="text-sm text-muted-foreground">posts / month</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Tone by platform</p>
            <div className="space-y-4">
              {platforms.map((p) => (
                <div key={p} className="space-y-1.5">
                  <span className="text-sm font-semibold text-foreground">{p}</span>
                  <Input
                    value={toneByPlatform[p] ?? ""}
                    onChange={(e) => setToneByPlatform((prev) => ({ ...prev, [p]: e.target.value }))}
                    placeholder={`How should ${p} sound?`}
                    className="text-base h-11"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </SowBlock>

      <SowBlock
        title="Content buckets"
        kicker={`Pillar post counts (your “buckets”). The SOW status strip above must show ${totalPosts} monthly posts and matching pillar total.`}
      >
        {totalPosts > 0 && mixTotal !== totalPosts && (
          <Alert
            variant="default"
            className="border-amber-300 bg-amber-50/90 text-black dark:bg-amber-100/90 dark:text-black"
            data-testid="sow-content-mix-mismatch"
          >
            <AlertTitle className="text-black">Content mix does not match monthly posts</AlertTitle>
            <AlertDescription className="text-black">
              {mixDelta > 0
                ? `Content mix totals ${mixTotal}/${totalPosts} posts — add ${mixDelta} more to match your monthly total.`
                : `Content mix totals ${mixTotal}/${totalPosts} posts — remove ${-mixDelta} from your pillar counts to match your monthly total.`}
            </AlertDescription>
          </Alert>
        )}
        <div className="space-y-3">
          {Object.entries(contentMix).map(([k, v]) => (
            <div key={k} className="flex flex-wrap items-center gap-2 sm:gap-3">
              <Input
                value={displayBucketLabel(k)}
                onChange={(e) => {
                  const newKey = e.target.value
                    .toLowerCase()
                    .replace(/\s+/g, "_")
                    .replace(/[^a-z0-9_]/g, "");
                  setContentMix((prev) => {
                    const out: Record<string, number> = {};
                    for (const [oldK, val] of Object.entries(prev)) {
                      out[oldK === k ? newKey : oldK] = val;
                    }
                    return out;
                  });
                }}
                className="w-full sm:flex-1 min-h-10 text-sm font-medium"
                aria-label="Content bucket"
              />
              <Input
                type="number"
                min={0}
                value={v}
                onChange={(e) => setPillarPercent(k, Number(e.target.value) || 0)}
                className="w-full sm:w-24 text-base"
              />
              <span className="text-sm text-muted-foreground w-10 hidden sm:inline">posts</span>
              <button
                type="button"
                onClick={() => removePillar(k)}
                className="text-muted-foreground hover:text-foreground p-1"
                aria-label={`Remove pillar ${k}`}
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addPillar} className="gap-1.5 mt-1">
            <Plus className="size-3.5" /> Add pillar
          </Button>
        </div>
      </SowBlock>

      <SowBlock title="Approval" kicker="Confirm this SOW is accurate so strategy and calendar can run against it.">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-border bg-muted/15 p-4">
          <div>
            {update.isPending && optimisticApproval ? (
              <Badge data-testid="sow-approval-status" className="bg-sky-600 hover:bg-sky-600 text-white border-0 text-sm">Saving approval...</Badge>
            ) : isApproved ? (
              <Badge data-testid="sow-approval-status" className="bg-emerald-600 hover:bg-emerald-600 text-white border-0 text-sm">Approved and saved</Badge>
            ) : (
              <Badge data-testid="sow-approval-status" variant="outline" className="text-amber-800 border-amber-300 bg-amber-50 text-sm">
                Not approved — save below when ready
              </Badge>
            )}
            <p className="text-sm text-muted-foreground mt-2">
              Saving always marks the SOW as approved for the purposes of strategy generation.
            </p>
          </div>
          <Button
            onClick={save}
            disabled={update.isPending}
            className="gap-2 w-full sm:w-auto shrink-0"
            data-testid="sow-approve-and-save"
            type="button"
          >
            <Save className="size-4" />
            {update.isPending ? "Saving…" : isApproved ? "Update & save SOW" : "Approve & save SOW"}
          </Button>
        </div>
      </SowBlock>
    </div>
  );
}

function displayBucketLabel(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

function formatSummaryLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function SowBlock({
  title,
  kicker,
  sourceHint,
  children,
}: {
  title: string;
  kicker?: string;
  /** Mapped-from-PDF line from parseMeta.sectionMap */
  sourceHint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card/30 p-5 sm:p-6 space-y-3 shadow-sm min-w-0 overflow-hidden">
      <h3 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">{title}</h3>
      {kicker && <p className="text-sm text-muted-foreground leading-relaxed -mt-1 mb-1">{kicker}</p>}
      {sourceHint ? (
        <p className="text-xs text-muted-foreground/90 font-medium" data-testid="sow-source-hint">
          Mapped from: {sourceHint}
        </p>
      ) : null}
      {children}
    </div>
  );
}
