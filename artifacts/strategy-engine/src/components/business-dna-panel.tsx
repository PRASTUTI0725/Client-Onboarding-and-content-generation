import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  asRecord,
  confidenceToLabel,
  formatList,
  humanizeAttributionItem,
  humanizeFieldSourceToken,
} from "@/lib/dna-display";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Check, Pencil, X } from "lucide-react";

type Props = {
  enrichedData: Record<string, unknown> | null | undefined;
  rawInput?: Record<string, unknown> | null | undefined;
  sow?: Record<string, unknown> | null | undefined;
  instagramSummaryNotesDraft?: string | null | undefined;
  onJumpToStrategy?: (() => void) | undefined;
  editable?: boolean | undefined;
  savingFieldPath?: string | null | undefined;
  onPatchField?: ((path: string, value: unknown) => Promise<void> | void) | undefined;
};

type EditableFieldKind = "text" | "list";

function formatFieldSources(sources: string[] | undefined): string | null {
  if (!sources || sources.length === 0) return null;
  const labels = [...new Set(sources.map((s) => humanizeFieldSourceToken(s)))];
  return labels.join(" · ");
}

function editableValueToString(value: unknown, kind: EditableFieldKind): string {
  if (kind === "list") {
    return Array.isArray(value)
      ? value.map((item) => String(item ?? "").trim()).filter(Boolean).join("\n")
      : "";
  }
  return str(value);
}

function normalizeEditedValue(value: string, kind: EditableFieldKind): string | string[] {
  if (kind === "list") {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value.trim();
}

function field(label: string, value: string, sources?: string[]) {
  const src = formatFieldSources(sources);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        {src && (
          <p className="text-[11px] text-muted-foreground/90" title="Data sources for this field">
            {src}
          </p>
        )}
      </div>
      <p className="text-sm leading-relaxed text-foreground/95 whitespace-pre-wrap break-words">
        {value || <span className="text-muted-foreground italic">Not available from current inputs</span>}
      </p>
    </div>
  );
}

function StatusPill({ ok, label, detail }: { ok: boolean | undefined; label: string; detail?: string }) {
  const tone =
    ok === true
      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
      : ok === false
        ? "bg-amber-100 text-amber-900 border-amber-200"
        : "bg-muted text-muted-foreground border-border";
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${tone}`}
    >
      <span
        className={`size-2.5 rounded-full ${ok === true ? "bg-emerald-500" : ok === false ? "bg-amber-500" : "bg-muted-foreground/50"}`}
        aria-hidden
      />
      {label}
      {detail && <span className="text-xs font-normal opacity-90">— {detail}</span>}
    </div>
  );
}

const CONFIDENCE_COPY: Record<string, { title: string; hint: string }> = {
  overall: {
    title: "Overall source coverage",
    hint: "How much of this profile is grounded in real inputs (site, SOW, social) vs filled in. Not a business score.",
  },
  voice: {
    title: "Brand voice coverage",
    hint: "How well we could see tone and language from your materials—not copy quality or sales impact.",
  },
  audience: {
    title: "Audience coverage",
    hint: "How much audience detail we could source from onboarding and public pages.",
  },
  positioning: {
    title: "Positioning coverage",
    hint: "How much positioning signal we had from your site, SOW, and descriptions.",
  },
  visualIdentity: {
    title: "Look & color coverage",
    hint: "How many concrete visual signals (colors, layout hints) we found on the public site.",
  },
};

function ConfidenceKey({
  k,
  v,
}: {
  k: string;
  v: number | undefined;
}) {
  const { label, pct } = confidenceToLabel(v);
  const n = v != null && !Number.isNaN(Number(v)) ? Math.max(0, Math.min(100, Math.round(Number(v) * 100))) : 0;
  const copy = CONFIDENCE_COPY[k] ?? {
    title: k.replace(/([A-Z])/g, " $1").trim(),
    hint: "Share of this area we could back with your sources (not a performance grade).",
  };
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs gap-2">
        <span className="text-foreground/90 font-medium">{copy.title}</span>
        <span className="font-medium tabular-nums">
          {label} {v != null && !Number.isNaN(Number(v)) ? <span className="text-muted-foreground">({pct})</span> : null}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">{copy.hint}</p>
      {v != null && !Number.isNaN(Number(v)) && <Progress value={n} className="h-2" />}
    </div>
  );
}

function ColorSwatch({ name, hex, note }: { name?: string; hex?: string; note?: string }) {
  if (!hex) return null;
  const showNote = typeof note === "string" && note.trim().length > 0 && !/^#[0-9a-f]+$/i.test(note.trim());
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/50 p-3">
      <div
        className="size-10 shrink-0 rounded-md border border-border shadow-inner"
        style={{ backgroundColor: hex }}
        title={hex}
      />
      <div className="min-w-0 text-sm">
        <p className="font-medium">{name || "Color"}</p>
        <p className="text-xs text-muted-foreground font-mono">{hex}</p>
        {showNote ? <p className="text-xs text-muted-foreground mt-1 leading-snug">{note}</p> : null}
      </div>
    </div>
  );
}

function CardText({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-base font-bold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 px-4 pb-4 space-y-3 text-sm">{children}</CardContent>
    </Card>
  );
}

export function BusinessDnaPanel({
  enrichedData,
  rawInput,
  sow,
  instagramSummaryNotesDraft,
  onJumpToStrategy,
  editable = false,
  savingFieldPath = null,
  onPatchField,
}: Props) {
  const [editingPath, setEditingPath] = React.useState<string | null>(null);
  const [draftValue, setDraftValue] = React.useState("");
  const explicitInstagramSummaryNotes =
    typeof instagramSummaryNotesDraft === "string" && instagramSummaryNotesDraft.trim().length > 0
      ? instagramSummaryNotesDraft.trim()
      : typeof rawInput?.instagramSummaryNotes === "string" && rawInput.instagramSummaryNotes.trim().length > 0
        ? rawInput.instagramSummaryNotes.trim()
        : "";
  const hasSavedContext = Boolean(
    typeof rawInput?.websiteUrl === "string" && rawInput.websiteUrl.trim().length > 0 ||
    typeof rawInput?.instagramHandle === "string" && rawInput.instagramHandle.trim().length > 0 ||
    typeof rawInput?.oneLineDescription === "string" && rawInput.oneLineDescription.trim().length > 0 ||
    explicitInstagramSummaryNotes,
  );
  const approvedSnapshot = asRecord((sow as Record<string, unknown> | null | undefined)?.__approvedContextSnapshot);
  const isApprovalLocked = !approvedSnapshot;

  if (!enrichedData) {
    return (
      <div className="space-y-4 border border-dashed border-border rounded-xl p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enrichment & business DNA</p>
          <h2 className="text-2xl font-bold tracking-tight mt-0.5">Foundation</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {isApprovalLocked
            ? "Approve SOW to generate final Business DNA and Jump-to-Action."
            : hasSavedContext
            ? "Approved context is ready, but final Business DNA has not been generated yet. Use the workspace action to generate it from the approved inputs."
            : "Add website, Instagram, or a business summary to make Business DNA possible after approval."}
        </p>
      </div>
    );
  }
  const provenance = asRecord(enrichedData.__provenance);
  const dnaBackgroundStatus =
    typeof provenance?.dnaBackgroundStatus === "string" ? provenance.dnaBackgroundStatus : "";
  const dnaBackgroundQueuedAt =
    typeof provenance?.dnaBackgroundQueuedAt === "string" ? Date.parse(provenance.dnaBackgroundQueuedAt) : NaN;
  const dnaPendingTimedOut =
    dnaBackgroundStatus === "pending" && Number.isFinite(dnaBackgroundQueuedAt) && Date.now() - dnaBackgroundQueuedAt > 120_000;
  const dna = asRecord(enrichedData.businessDna);
  if (!dna || Object.keys(dna).length === 0) {
    return (
      <div className="space-y-4 border border-dashed border-border rounded-xl p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enrichment & business DNA</p>
          <h2 className="text-2xl font-bold tracking-tight mt-0.5">Foundation</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {isApprovalLocked
            ? "Approve SOW to generate final Business DNA and Jump-to-Action."
            : dnaPendingTimedOut
            ? "Business DNA generation did not finish within the expected time. Retry from the workspace action."
            : dnaBackgroundStatus === "pending"
            ? "Business DNA is generating in the background from the approved website, Instagram, and SOW context. This section will switch to the full profile as soon as it is ready."
            : dnaBackgroundStatus === "failed"
              ? "Business DNA generation failed. Retry from the workspace action."
              : hasSavedContext
                ? "Approved context is available, but Business DNA is still missing. Generate it from the workspace action to unlock the next step."
                : "Add website, Instagram, or a business summary to make Business DNA possible after approval."}
        </p>
      </div>
    );
  }

  const mcp = asRecord(dna?.mcp);
  const w = mcp?.website as { ok?: boolean; error?: string; source?: string } | undefined;
  const ig = mcp?.instagram as { ok?: boolean; error?: string; note?: string; source?: string } | undefined;
  const websiteOk = w?.ok === true;
  const instaOk = ig?.ok === true;
  const pos = asRecord(dna?.positioning);
  const aud = asRecord(dna?.targetAudience);
  const tov = asRecord(dna?.toneOfVoice);
  const lang = asRecord(dna?.languageStyle);
  const off = asRecord(dna?.offers);
  const cs = asRecord(dna?.contentStrategy);
  const vis = asRecord(dna?.visualIdentity);
  const conf = asRecord(dna?.confidenceScores);
  const platformSig = asRecord(dna?.platformSignals);
  const proof = asRecord(dna?.proofAndEvidence);
  const attr = asRecord(dna?.sourceAttribution);
  const fieldSources = (dna as { fieldSources?: Record<string, string[]> } | null | undefined)?.fieldSources;
  const manualEdits =
    asRecord(asRecord(dna?.__meta)?.manualEdits) as Record<string, { editedAt?: string; source?: string }> | null;
  const instagramSummaryNotes = explicitInstagramSummaryNotes;
  const visLegacy = asRecord((dna as Record<string, unknown>)?.visual_identity);
  const psWeb = asRecord(platformSig?.website);
  const psIg = asRecord(platformSig?.instagram);
  const psIgStatus = asRecord(psIg?.status);
  const paletteSource = asRecord(vis?.paletteSource);
  const hasInstagramSignals =
    Boolean(str(psIg?.handle)) ||
    formatList(psIg?.bioSignals) !== "" ||
    formatList(psIg?.contentPatterns) !== "" ||
    formatList(psIg?.engagementSignals) !== "";
  const hasManualInstagramNotes = instagramSummaryNotes.length > 0;
  const instagramHandleAttached = Boolean(str(psIg?.handle)) || Boolean(rawInput?.instagramHandle);
  const instagramSourceReached =
    Boolean(psIgStatus?.sourceReached) || instaOk || Boolean(ig?.source || ig?.note);
  const instagramSignalsExtracted = Boolean(psIgStatus?.signalsExtracted) || hasInstagramSignals;
  const showJumpToStrategyCta = false && typeof onJumpToStrategy === "function";

  async function saveFieldEdit(path: string, kind: EditableFieldKind) {
    if (!onPatchField) return;
    await onPatchField(path, normalizeEditedValue(draftValue, kind));
    setEditingPath(null);
    setDraftValue("");
  }

  function renderEditableField(
    label: string,
    rawValue: unknown,
    sources: string[] | undefined,
    path: string,
    kind: EditableFieldKind,
  ) {
    const displayValue = kind === "list" ? formatList(rawValue) : str(rawValue);
    const src = formatFieldSources(sources);
    const isEditing = editingPath === path;
    const isSaving = savingFieldPath === path;
    const isManual = Boolean(manualEdits?.[path]);
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          {src ? (
            <p className="text-[11px] text-muted-foreground/90" title="Data sources for this field">
              {src}
            </p>
          ) : null}
          {isManual ? <Badge variant="outline" className="text-[10px]">Manually edited</Badge> : null}
          {editable && onPatchField ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => {
                setEditingPath(path);
                setDraftValue(editableValueToString(rawValue, kind));
              }}
              disabled={Boolean(editingPath && editingPath !== path) || Boolean(savingFieldPath)}
              aria-label={`Edit ${label}`}
            >
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
        </div>
        {isEditing ? (
          <div className="space-y-2">
            <Textarea
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              rows={kind === "list" ? 5 : 3}
              className="text-sm"
            />
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={() => void saveFieldEdit(path, kind)} disabled={isSaving}>
                <Check className="size-4 mr-1" />
                {isSaving ? "Saving..." : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingPath(null);
                  setDraftValue("");
                }}
                disabled={isSaving}
              >
                <X className="size-4 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-foreground/95 whitespace-pre-wrap break-words">
            {displayValue || <span className="text-muted-foreground italic">Not available from current inputs</span>}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enrichment & business DNA</p>
          <h2 className="text-2xl font-bold tracking-tight mt-0.5">Foundation</h2>
        </div>
      </div>

      <p className="text-sm text-muted-foreground -mt-2">
        Percentages show how much each area is tied to your website, SOW, and public social text—not sales potential
        or copy quality.
      </p>

      <div className={`rounded-xl border p-4 text-sm ${isApprovalLocked ? "border-amber-300 bg-amber-50 text-amber-950" : "border-border/70 bg-muted/30 text-foreground"}`}>
        {isApprovalLocked
          ? "Approve SOW to generate Business DNA and Jump-to-Action. Any existing DNA shown here should be treated as draft preview only."
          : "This Business DNA is tied to the approved SOW snapshot for this client."}
      </div>

      {showJumpToStrategyCta ? (
        <div className="-mt-1">
          <Button type="button" className="gap-2" onClick={onJumpToStrategy}>
            [JUMP TO ACTION ↓]
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-border/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Source signals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Website</p>
              <StatusPill
                ok={websiteOk}
                label={websiteOk ? "Connected" : w?.error ? "Issue" : "Unknown"}
                detail={w?.ok ? "Public pages analyzed" : String(w?.error ?? "")}
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Instagram</p>
              <StatusPill
                ok={instagramSignalsExtracted}
                label={
                  instagramSignalsExtracted
                    ? "Signals extracted"
                    : instagramSourceReached
                      ? "Source reached"
                      : instagramHandleAttached
                        ? "Handle attached"
                        : hasManualInstagramNotes
                          ? "Manual context available"
                          : "No usable Instagram signals"
                }
                detail={
                  instagramSignalsExtracted
                    ? "Usable Instagram bio or content signals are included below."
                    : instagramSourceReached
                      ? "Instagram responded, but usable parsed signals were too thin or blocked."
                      : instagramHandleAttached
                        ? "Only the handle is attached so far. This is not the same as extracted Instagram signals."
                        : "Instagram details were not returned in this run. Add manual context to continue."
                }
              />
              {!instagramSignalsExtracted && (
                <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
                  Paste the profile bio, voice, or brand notes under <strong>Instagram positioning</strong>.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Source coverage (not a performance grade)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {conf && Object.keys(conf).length > 0 ? (
              Object.entries(conf).map(([k, v]) => (
                <ConfidenceKey key={k} k={k} v={typeof v === "number" ? v : Number.isFinite(Number(v)) ? Number(v) : undefined} />
              ))
            ) : (
              <p className="text-sm text-muted-foreground italic">No confidence scores returned.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {instagramSummaryNotes ? (
          <CardText title="Instagram positioning (optional)">
            {field("Notes", instagramSummaryNotes, ["onboarding"])}
          </CardText>
        ) : null}
        <CardText title="Purpose">
          {renderEditableField("Statement", dna?.purpose, fieldSources?.purpose, "purpose", "text")}
        </CardText>
        <CardText title="Mission">
          {renderEditableField("Statement", dna?.mission, fieldSources?.mission, "mission", "text")}
        </CardText>
        <CardText title="Vision">
          {renderEditableField("Statement", dna?.vision, fieldSources?.vision, "vision", "text")}
        </CardText>
        <CardText title="Core values">
          {field("Values", formatList(dna?.coreValues), fieldSources?.coreValues)}
        </CardText>
        <CardText title="Brand archetype">
          {field("Archetype", str(dna?.brandArchetype), fieldSources?.brandArchetype)}
        </CardText>
        <CardText title="Personality traits">
          {renderEditableField("Traits", dna?.personalityTraits, fieldSources?.personalityTraits, "personalityTraits", "list")}
        </CardText>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CardText title="Tone of voice">
          <div className="space-y-2">
            {renderEditableField("Style", tov?.style, fieldSources?.toneOfVoice, "toneOfVoice.style", "list")}
            {renderEditableField("Do's", tov && (tov as { dos?: unknown }).dos, fieldSources?.toneOfVoice, "toneOfVoice.dos", "list")}
            {renderEditableField("Don'ts", tov && (tov as { donts?: unknown }).donts, fieldSources?.toneOfVoice, "toneOfVoice.donts", "list")}
            {renderEditableField("Sample phrases", tov?.samplePhrases, fieldSources?.toneOfVoice, "toneOfVoice.samplePhrases", "list")}
          </div>
        </CardText>
        <CardText title="Target audience">
          {renderEditableField("Segments", aud?.segments, fieldSources?.targetAudience, "targetAudience.segments", "list")}
          {renderEditableField("Demographics", aud?.demographics, fieldSources?.targetAudience, "targetAudience.demographics", "list")}
          {renderEditableField("Psychographics", aud?.psychographics, fieldSources?.targetAudience, "targetAudience.psychographics", "list")}
          {renderEditableField("Geographies", aud?.geographies, fieldSources?.targetAudience, "targetAudience.geographies", "list")}
          {renderEditableField("Pains", aud?.pains, fieldSources?.targetAudience, "targetAudience.pains", "list")}
          {renderEditableField("Desires", aud?.desires, fieldSources?.targetAudience, "targetAudience.desires", "list")}
          {renderEditableField("Objections", aud?.objections, fieldSources?.targetAudience, "targetAudience.objections", "list")}
        </CardText>
        <CardText title="Positioning">
          {renderEditableField("Category", pos?.category, fieldSources?.positioning, "positioning.category", "text")}
          {renderEditableField("Value proposition", pos?.valueProposition, fieldSources?.positioning, "positioning.valueProposition", "text")}
          {renderEditableField("Differentiators", pos?.differentiators, fieldSources?.positioning, "positioning.differentiators", "list")}
          {renderEditableField("Competitor references", pos?.competitorReferences, fieldSources?.positioning, "positioning.competitorReferences", "list")}
          {renderEditableField("Market angle", pos?.marketAngle, fieldSources?.positioning, "positioning.marketAngle", "text")}
          {renderEditableField("Reasons to believe", pos?.reasonToBelieve, fieldSources?.positioning, "positioning.reasonToBelieve", "list")}
        </CardText>
        <CardText title="Offers">
          {renderEditableField("Primary offers", off?.primaryOffers, fieldSources?.offers, "offers.primaryOffers", "list")}
          {renderEditableField("Pricing signals", off?.pricingSignals, fieldSources?.offers, "offers.pricingSignals", "list")}
          {renderEditableField("Transformation promise", off?.transformationPromise, fieldSources?.offers, "offers.transformationPromise", "text")}
          {renderEditableField("Urgency style", off?.urgencyStyle, fieldSources?.offers, "offers.urgencyStyle", "text")}
        </CardText>
        <CardText title="Content strategy">
          {renderEditableField("Pillars", cs?.contentPillars, undefined, "contentStrategy.contentPillars", "list")}
          {renderEditableField("Themes", cs?.themes, undefined, "contentStrategy.themes", "list")}
          {renderEditableField("Hooks that fit", cs?.hooksThatFitBrand, undefined, "contentStrategy.hooksThatFitBrand", "list")}
          {renderEditableField("Topics to avoid", cs?.topicsToAvoid, undefined, "contentStrategy.topicsToAvoid", "list")}
          {renderEditableField("Trust signals to repeat", cs?.trustSignalsToRepeat, undefined, "contentStrategy.trustSignalsToRepeat", "list")}
        </CardText>
        <CardText title="Language style">
          {field("Reading level", str(lang?.readingLevel))}
          {field("Primary patterns", formatList(lang?.primaryLanguagePatterns))}
          {field("Taboo words", formatList(lang?.tabooWords))}
          {field("CTA style", str(lang?.ctaStyle))}
        </CardText>
        <CardText title="Visual identity — layout & type">
          {field("Layout", str(vis?.layoutStyle) || str(visLegacy?.style))}
          {field("Primary type", str(asRecord(vis?.typography)?.primary))}
          {field("Secondary type", str(asRecord(vis?.typography)?.secondary))}
          {field("Type notes", formatList(asRecord(vis?.typography)?.styleNotes))}
          {field("Logo style", str(vis?.logoStyle))}
          {field("Imagery style", formatList(vis?.imageryStyle))}
          {field("Design motifs", formatList(vis?.designMotifs))}
        </CardText>
        {Array.isArray(vis?.colors) && (vis?.colors as { name?: string; hex?: string; meaning?: string }[]).length > 0 && (
          <Card className="border-border/80 md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base font-bold">Visual identity — website color candidates</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                {paletteSource?.detail
                  ? String(paletteSource.detail)
                  : "Extracted website color provenance unavailable."}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(vis?.colors as { name?: string; hex?: string; meaning?: string }[]).map((c, i) => (
                  <ColorSwatch key={i} name={c.name} hex={c.hex} note={c.meaning} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        {(!Array.isArray(vis?.colors) || (vis?.colors as { name?: string; hex?: string; meaning?: string }[]).length === 0) && (
          <CardText title="Visual identity — website color candidates">
            {field(
              "Status",
              paletteSource?.detail
                ? String(paletteSource.detail)
                : "No reliable website color candidates detected from current public signals.",
            )}
          </CardText>
        )}
        <CardText title="Platform signals — website">
          {field("Website signals analyzed", formatList(psWeb?.pagesAnalyzed) || "Homepage copy, search preview text, and key page headings")}
          {field("Messaging patterns", formatList(psWeb?.messagingPatterns))}
          {field("Trust elements", formatList(psWeb?.trustElements))}
          {field("Conversion elements", formatList(psWeb?.conversionElements))}
        </CardText>
        <CardText title="Platform signals — Instagram">
          {field("Handle", str(psIg?.handle))}
          {field("Bio signals", formatList(psIg?.bioSignals))}
          {field("Content patterns", formatList(psIg?.contentPatterns))}
          {field("Visual patterns", formatList(psIg?.visualPatterns))}
          {field("Engagement signals", formatList(psIg?.engagementSignals))}
        </CardText>
        <CardText title="Proof & evidence">
          {field(
            "Testimonials on site",
            proof?.testimonialsPresent === true
              ? "Yes"
              : proof?.testimonialsPresent === false
                ? "No"
                : "Not found from website or Instagram",
          )}
          {field(
            "Case studies on site",
            proof?.caseStudiesPresent === true
              ? "Yes"
              : proof?.caseStudiesPresent === false
                ? "No"
                : "Not found from website or Instagram",
          )}
          {field("Certifications", formatList(proof?.certifications))}
          {field("Clients mentioned", formatList(proof?.clientsMentioned))}
          {field(
            "Metrics claimed",
            (() => {
              const p = proof as { metricsClaimed?: string[]; metricsSummary?: string } | undefined;
              const claimed = Array.isArray(p?.metricsClaimed) ? p!.metricsClaimed! : [];
              if (claimed.length > 0) {
                const parts = [p?.metricsSummary, formatList(claimed)].filter(
                  (x) => x != null && String(x).trim().length > 0,
                ) as string[];
                return parts.join("\n\n");
              }
              return "No clear public metrics on the homepage text we could analyze.";
            })(),
          )}
        </CardText>
        {attr && (
          <CardText title="Where signals came from">
            {field(
              "Onboarding",
              formatList(
                (Array.isArray(attr.fromOnboarding) ? attr.fromOnboarding : []).map((x) =>
                  typeof x === "string" ? humanizeAttributionItem(x) : String(x),
                ) as unknown,
              ),
            )}
            {field(
              "Website",
              formatList(
                (Array.isArray(attr.fromWebsite) ? attr.fromWebsite : []).map((x) =>
                  typeof x === "string" ? humanizeAttributionItem(x) : String(x),
                ) as unknown,
              ),
            )}
            {field(
              "Instagram",
              formatList(
                (Array.isArray(attr.fromInstagram) ? attr.fromInstagram : []).map((x) =>
                  typeof x === "string" ? humanizeAttributionItem(x) : String(x),
                ) as unknown,
              ),
            )}
            {field(
              "SOW",
              formatList(
                (Array.isArray((attr as { fromSow?: unknown }).fromSow) ? (attr as { fromSow: string[] }).fromSow : []).map(
                  (x) => (typeof x === "string" ? humanizeAttributionItem(x) : String(x)),
                ) as unknown,
              ),
            )}
            {field(
              "Synthesized",
              formatList(
                (Array.isArray(attr.inferred) ? attr.inferred : []).map((x) =>
                  typeof x === "string" ? humanizeAttributionItem(x) : String(x),
                ) as unknown,
              ),
            )}
          </CardText>
        )}
      </div>
    </div>
  );
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.join(", ");
  return JSON.stringify(v);
}
