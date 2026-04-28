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

type Props = {
  enrichedData: Record<string, unknown> | null | undefined;
  rawInput?: Record<string, unknown> | null | undefined;
  instagramSummaryNotesDraft?: string | null | undefined;
  onJumpToStrategy?: (() => void) | undefined;
};

function formatFieldSources(sources: string[] | undefined): string | null {
  if (!sources || sources.length === 0) return null;
  const labels = [...new Set(sources.map((s) => humanizeFieldSourceToken(s)))];
  return labels.join(" · ");
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
      <p className="text-sm leading-relaxed text-foreground/95 whitespace-pre-wrap">
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
  instagramSummaryNotesDraft,
  onJumpToStrategy,
}: Props) {
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

  if (!enrichedData) {
    return (
      <div className="space-y-4 border border-dashed border-border rounded-xl p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enrichment & business DNA</p>
          <h2 className="text-2xl font-bold tracking-tight mt-0.5">Foundation</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {hasSavedContext
            ? "Business DNA is processing from the saved website, Instagram, and onboarding context. This section will populate automatically when the profile is ready."
            : "Add website, Instagram, or a business summary to let the app build Business DNA automatically."}
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
          {dnaPendingTimedOut
            ? "Failed to generate Business DNA automatically within the expected time."
            : dnaBackgroundStatus === "pending"
            ? "Business DNA is generating in the background from the latest onboarding, website, Instagram, and SOW context. This section will switch to the full profile as soon as it is ready."
            : dnaBackgroundStatus === "failed"
              ? "Background Business DNA generation did not complete."
              : hasSavedContext
                ? "Business DNA has not rendered yet, but the saved onboarding context is available. This section should populate automatically after processing."
                : "Add website, Instagram, or a business summary to let the app build Business DNA automatically."}
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
  const instagramSummaryNotes = explicitInstagramSummaryNotes;
  const visLegacy = asRecord((dna as Record<string, unknown>)?.visual_identity);
  const psWeb = asRecord(platformSig?.website);
  const psIg = asRecord(platformSig?.instagram);
  const hasInstagramSignals =
    Boolean(str(psIg?.handle)) ||
    formatList(psIg?.bioSignals) !== "" ||
    formatList(psIg?.contentPatterns) !== "" ||
    formatList(psIg?.engagementSignals) !== "";
  const hasManualInstagramNotes = instagramSummaryNotes.length > 0;
  const instagramEnrichmentOk = instaOk || hasInstagramSignals;
  const showJumpToStrategyCta = false && typeof onJumpToStrategy === "function";

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
                ok={instagramEnrichmentOk}
                label={
                  instagramEnrichmentOk
                    ? "Data attached"
                    : hasManualInstagramNotes
                      ? "Manual context available"
                      : "Data unavailable"
                }
                detail={
                  instagramEnrichmentOk
                    ? "Profile and content signals are included below."
                    : "Instagram details were not returned in this run. Add manual context to continue."
                }
              />
              {!instagramEnrichmentOk && (
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
          {field("Statement", str(dna?.purpose), fieldSources?.purpose)}
        </CardText>
        <CardText title="Mission">
          {field("Statement", str(dna?.mission), fieldSources?.mission)}
        </CardText>
        <CardText title="Vision">
          {field("Statement", str(dna?.vision), fieldSources?.vision)}
        </CardText>
        <CardText title="Core values">
          {field("Values", formatList(dna?.coreValues), fieldSources?.coreValues)}
        </CardText>
        <CardText title="Brand archetype">
          {field("Archetype", str(dna?.brandArchetype), fieldSources?.brandArchetype)}
        </CardText>
        <CardText title="Personality traits">
          {field("Traits", formatList(dna?.personalityTraits), fieldSources?.personalityTraits)}
        </CardText>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CardText title="Tone of voice">
          <div className="space-y-2">
            {field("Style", formatList(tov?.style), fieldSources?.toneOfVoice)}
            {field("Do’s", formatList(tov && (tov as { dos?: unknown }).dos), fieldSources?.toneOfVoice)}
            {field("Don’ts", formatList(tov && (tov as { donts?: unknown }).donts), fieldSources?.toneOfVoice)}
            {field("Sample phrases", formatList(tov?.samplePhrases), fieldSources?.toneOfVoice)}
          </div>
        </CardText>
        <CardText title="Target audience">
          {field("Segments", formatList(aud?.segments), fieldSources?.targetAudience)}
          {field("Demographics", formatList(aud?.demographics), fieldSources?.targetAudience)}
          {field("Psychographics", formatList(aud?.psychographics), fieldSources?.targetAudience)}
          {field("Geographies", formatList(aud?.geographies), fieldSources?.targetAudience)}
          {field("Pains", formatList(aud?.pains), fieldSources?.targetAudience)}
          {field("Desires", formatList(aud?.desires), fieldSources?.targetAudience)}
          {field("Objections", formatList(aud?.objections), fieldSources?.targetAudience)}
        </CardText>
        <CardText title="Positioning">
          {field("Category", str(pos?.category), fieldSources?.positioning)}
          {field("Value proposition", str(pos?.valueProposition), fieldSources?.positioning)}
          {field("Differentiators", formatList(pos?.differentiators), fieldSources?.positioning)}
          {field("Competitor references", formatList(pos?.competitorReferences), fieldSources?.positioning)}
          {field("Market angle", str(pos?.marketAngle), fieldSources?.positioning)}
          {field("Reasons to believe", formatList(pos?.reasonToBelieve), fieldSources?.positioning)}
        </CardText>
        <CardText title="Offers">
          {field("Primary offers", formatList(off?.primaryOffers), fieldSources?.offers)}
          {field("Pricing signals", formatList(off?.pricingSignals), fieldSources?.offers)}
          {field("Transformation promise", str(off?.transformationPromise), fieldSources?.offers)}
          {field("Urgency style", str(off?.urgencyStyle), fieldSources?.offers)}
        </CardText>
        <CardText title="Content strategy">
          {field("Pillars", formatList(cs?.contentPillars))}
          {field("Themes", formatList(cs?.themes))}
          {field("Hooks that fit", formatList(cs?.hooksThatFitBrand))}
          {field("Topics to avoid", formatList(cs?.topicsToAvoid))}
          {field("Trust signals to repeat", formatList(cs?.trustSignalsToRepeat))}
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
              <CardTitle className="text-base font-bold">Visual identity — palette</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(vis?.colors as { name?: string; hex?: string; meaning?: string }[]).map((c, i) => (
                  <ColorSwatch key={i} name={c.name} hex={c.hex} note={c.meaning} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        <CardText title="Platform signals — website">
          {field("Website signals analyzed", "Homepage copy, search preview text, and key page headings")}
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
