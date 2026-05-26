type AnyRecord = Record<string, unknown>;

export interface BuildPostDetailInput {
  format: string;
  platform: string;
  activePlatforms?: string[] | null;
  pillar: string;
  objective: string;
  hook: string;
  cta: string;
  strategicIntent?: string | null;
  expectedMetric?: string | null;
  expectedReason?: string | null;
  priority?: string | null;
  caption?: string | null;
  hashtags?: string[] | null;
  execution?: Record<string, unknown> | null;
}

export interface BuildPostDetailResult {
  caption: string | null;
  hashtags: string[] | null;
  execution: Record<string, unknown>;
}

export interface BuildPostDetailOptions {
  includeCopy?: boolean;
}

export function buildPostDetailPayload(
  input: BuildPostDetailInput,
  options: BuildPostDetailOptions = {},
): BuildPostDetailResult {
  const includeCopy = options.includeCopy !== false;
  const execution = asRecord(input.execution);
  const formatKind = detectFormatKind(input.format);
  const caption = includeCopy ? normalizeCaption(input, execution) : null;
  const hashtagGroups = includeCopy ? normalizeHashtagGroups(input, execution) : null;
  const flatHashtags = hashtagGroups
    ? [
        ...hashtagGroups.niche,
        ...hashtagGroups.problem,
        ...hashtagGroups.broad,
      ]
    : null;

  const detail: Record<string, unknown> = {
    format_style: readString(execution.format_style) ?? input.format,
    ...(Array.isArray(input.activePlatforms) && input.activePlatforms.length > 0
      ? { active_platforms: input.activePlatforms }
      : {}),
    production_effort:
      normalizeProductionEffort(readString(execution.production_effort)) ??
      inferProductionEffort(input.priority, formatKind),
    duration: readString(execution.duration) ?? inferDuration(formatKind),
    shoot_type: readString(execution.shoot_type) ?? inferShootType(formatKind),
    caption: {
      structure: ["hook", "context", "value", "cta"],
      ...(caption ? { text: caption } : {}),
    },
    conversion_path: normalizeConversionPath(input, execution),
    repurpose_plan: normalizeRepurposePlan(
      input.platform,
      input.format,
      formatKind,
      execution,
      input.activePlatforms,
    ),
    timeline: normalizeTimeline(execution),
    dependencies: normalizeDependencies(formatKind, execution),
    feedback_structure: normalizeFeedbackStructure(formatKind, execution),
  };
  if (hashtagGroups) {
    detail.hashtags = hashtagGroups;
  }

  if (formatKind === "reel") {
    detail.reel_execution = normalizeReelExecution(input, execution);
  }
  if (formatKind === "carousel") {
    detail.carousel_execution = normalizeCarouselExecution(input, execution);
  }
  if (formatKind === "story") {
    detail.story_execution = normalizeStoryExecution(input, execution);
  }
  if (formatKind === "static") {
    detail.static_execution = normalizeStaticExecution(input, execution, caption ?? "");
  }

  return {
    caption,
    hashtags: flatHashtags,
    execution: detail,
  };
}

type FormatKind = "reel" | "carousel" | "story" | "static" | "other";

function detectFormatKind(format: string): FormatKind {
  const lower = format.toLowerCase();
  if (lower.includes("carousel")) return "carousel";
  if (lower.includes("story")) return "story";
  if (lower.includes("static")) return "static";
  if (lower.includes("reel") || lower.includes("short") || lower.includes("video")) return "reel";
  return "other";
}

function normalizeCaption(input: BuildPostDetailInput, execution: AnyRecord): string {
  const captionRecord = asRecord(execution.caption);
  const fromExecution = readString(captionRecord.text);
  const existing = readString(input.caption);
  if (fromExecution) return fromExecution;
  if (existing) return existing;

  const context = [
    `${input.platform} post built around the ${input.pillar} pillar.`,
    input.objective ? `The job is to ${trimSentence(input.objective)}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const value = trimSentence(
    input.strategicIntent ||
      input.expectedReason ||
      "Make the next step feel obvious and low-friction for the audience.",
  );

  return [
    input.hook,
    context,
    value,
    trimSentence(input.cta),
  ].join("\n\n");
}

function normalizeHashtagGroups(
  input: BuildPostDetailInput,
  execution: AnyRecord,
): { niche: string[]; problem: string[]; broad: string[] } {
  const groups = asRecord(execution.hashtags);
  const fromGroups = {
    niche: sanitizeHashtags(readStringArray(groups.niche), 5, 7),
    problem: sanitizeHashtags(readStringArray(groups.problem), 3, 5),
    broad: sanitizeHashtags(readStringArray(groups.broad), 2, 3),
  };
  if (fromGroups.niche.length && fromGroups.problem.length && fromGroups.broad.length) {
    return fromGroups;
  }

  const fallbackFlat = sanitizeHashtags(input.hashtags ?? [], 10, 15);
  if (fallbackFlat.length > 0) {
    return {
      niche: fillHashtagBucket(fallbackFlat.slice(0, 7), defaultNicheTags(input), 5, 7),
      problem: fillHashtagBucket(fallbackFlat.slice(7, 12), defaultProblemTags(input), 3, 5),
      broad: fillHashtagBucket(fallbackFlat.slice(12, 15), defaultBroadTags(input), 2, 3),
    };
  }

  return {
    niche: defaultNicheTags(input).slice(0, 6),
    problem: defaultProblemTags(input).slice(0, 4),
    broad: defaultBroadTags(input).slice(0, 3),
  };
}

function normalizeConversionPath(input: BuildPostDetailInput, execution: AnyRecord) {
  const conversion = asRecord(execution.conversion_path);
  return {
    entry_point:
      readString(conversion.entry_point) ??
      `${input.hook} This earns attention by naming the exact idea the audience already cares about.`,
    next_step:
      readString(conversion.next_step) ??
      `Use the CTA to move interested viewers toward ${trimSentence(input.cta).toLowerCase()}.`,
    final_goal:
      readString(conversion.final_goal) ??
      trimSentence(
        input.objective || input.expectedMetric || "generate qualified conversations and buying intent",
      ),
  };
}

function normalizeRepurposePlan(
  platform: string,
  format: string,
  formatKind: FormatKind,
  execution: AnyRecord,
  activePlatforms?: string[] | null,
): string[] {
  const plan = readStringArray(execution.repurpose_plan);
  if (plan.length > 0) return plan;
  const explicitTargets = readStringArray(execution.repurpose_targets);
  if (explicitTargets.length > 0) {
    return explicitTargets
      .filter((target) => isAllowedRepurposeTarget(target, platform, activePlatforms, execution))
      .map((target) => `Repurpose this ${format} for ${target}.`);
  }
  const platformPlan = defaultRepurposeTargets(platform, format, activePlatforms, execution);
  if (platformPlan.length > 0) return platformPlan;

  if (formatKind === "reel") {
    return [
      "Turn the hook and strongest proof beat into a 3-frame story set with poll + DM CTA.",
      "Pull the spoken breakdown into a 6-slide carousel for saves and shares.",
      "Cut the proof segment into a short organic story or reel variation for warm followers.",
    ];
  }
  if (formatKind === "carousel") {
    return [
      "Turn each slide headline into a talking-point reel with matching on-screen text.",
      "Use slides 1, 3, and 6 as a story sequence with a question sticker on the middle frame.",
      "Adapt the problem + solution slides into an organic follow-up post for high-intent viewers.",
    ];
  }
  if (formatKind === "story") {
    return [
      "Turn the best-performing frame into a static feed post with the same hook.",
      "Expand the reassurance or FAQ frame into a short reel using product shots or voiceover.",
      "Reuse the poll/question responses to shape a follow-up conversion carousel.",
    ];
  }
  return [
    "Use the headline as the opening frame of a story sequence with a direct response sticker.",
    "Expand the caption into a short talking-head reel with the same promise and CTA.",
    "Reuse the visual and headline in an organic reminder post for warm audiences.",
  ];
}

function defaultRepurposeTargets(
  platform: string,
  format: string,
  activePlatforms?: string[] | null,
  execution?: AnyRecord,
): string[] {
  const normalizedPlatform = platform.trim().toLowerCase();
  const normalizedFormat = format.trim();
  const scopedPlatforms = resolveScopedPlatforms(platform, activePlatforms, execution);
  const peerPlatforms = scopedPlatforms.filter((candidate) => candidate !== platform);

  if (normalizedPlatform.includes("instagram")) {
    const out = [
      "Turn the hook into a 3-frame Instagram story sequence with a reply or DM prompt.",
      format.toLowerCase().includes("reel")
        ? "Adapt the strongest beat into an Instagram carousel with save-friendly text slides."
        : "Expand the core idea into an Instagram reel with quick product or ritual b-roll.",
    ];
    if (peerPlatforms.includes("Pinterest")) {
      out.push(
        normalizedFormat.toLowerCase().includes("reel")
          ? "Adapt the main takeaway into a Pinterest video pin with a save-first headline."
          : "Rework the core idea into a Pinterest static pin with a vertical save-friendly layout.",
      );
    }
    return out.slice(0, 3);
  }
  if (normalizedPlatform.includes("pinterest")) {
    const out = [
      "Turn the pin headline into a second saveable Pinterest variation with a new visual angle.",
    ];
    if (peerPlatforms.includes("Instagram")) {
      out.push(
        normalizedFormat.toLowerCase().includes("video")
          ? "Adapt this video pin into an Instagram reel with the same ritual or product takeaway."
          : "Turn this pin into an Instagram carousel or static post with the same core theme.",
      );
      out.push("Use the strongest pin insight as an Instagram story set with a reply CTA.");
    }
    return out.slice(0, 3);
  }
  if (normalizedPlatform.includes("linkedin")) {
    return ["Adapt this idea into a shorter LinkedIn follow-up post that sharpens the takeaway."];
  }
  if (normalizedPlatform === "x" || normalizedPlatform.includes("twitter")) {
    return ["Extend the strongest point into a short follow-up thread or image post."];
  }
  if (normalizedPlatform.includes("youtube")) {
    return ["Cut the strongest moment into a shorter teaser or recap variation on YouTube."];
  }
  return [];
}

function normalizeTimeline(execution: AnyRecord) {
  const timeline = asRecord(execution.timeline);
  return {
    internal_deadline: readString(timeline.internal_deadline) ?? "48 hours before publish date",
    posting_time: readString(timeline.posting_time) ?? "7:30 PM local time",
  };
}

function normalizeDependencies(formatKind: FormatKind, execution: AnyRecord): string[] {
  const deps = readStringArray(execution.dependencies);
  if (deps.length > 0) return deps;

  const base = ["Final hook approval", "Caption sign-off", "Brand-safe design review"];
  if (formatKind === "reel") return [...base, "Raw footage or b-roll", "Editor subtitle pass"];
  if (formatKind === "carousel") return [...base, "Slide copy lock", "Design layout assets"];
  if (formatKind === "story") return [...base, "Story sticker choice", "Quick-turn creative export"];
  return [...base, "Final product or brand visual", "On-image text approval"];
}

function normalizeFeedbackStructure(formatKind: FormatKind, execution: AnyRecord) {
  const feedback = asRecord(execution.feedback_structure);
  return {
    type: readString(feedback.type) ?? feedbackTypeForFormat(formatKind),
    comment:
      readString(feedback.comment) ??
      "Check that the opening hook is specific, the execution is easy to produce, and the CTA moves the audience toward the next conversion step.",
  };
}

function normalizeReelExecution(input: BuildPostDetailInput, execution: AnyRecord) {
  const reel = asRecord(execution.reel_execution);
  const legacyBeats = readStringArray(execution.beats);
  const flow = readStringArray(reel.flow);
  const isPinterestVideoPin =
    input.platform.trim().toLowerCase().includes("pinterest") || input.format.trim().toLowerCase().includes("video pin");

  return {
    hook_line: readString(reel.hook_line) ?? readString(execution.hook_2s) ?? input.hook,
    flow: flow.length > 0 ? flow : isPinterestVideoPin ? ["hook", "benefit", "ritual", "proof", "cta"] : ["problem", "insight", "breakdown", "proof", "cta"],
    script:
      readString(reel.script) ??
      buildFallbackReelScript(input, legacyBeats, readString(execution.pattern_interrupt)),
    visual_direction:
      readString(reel.visual_direction) ??
      readString(execution.visual_direction) ??
      (isPinterestVideoPin
        ? "Open with the product or ritual setup in a vertical frame, use clean text overlays for 2-3 benefit points, cut to close-ups of the product in use, and end on a save-worthy CTA card."
        : "Open on the product or ritual in use, cut to close-ups that demonstrate the promise, then show one reassurance or proof moment before the CTA frame."),
    editing_style:
      readString(reel.editing_style) ??
      buildEditingStyle(execution),
  };
}

function normalizeCarouselExecution(input: BuildPostDetailInput, execution: AnyRecord) {
  const carousel = asRecord(execution.carousel_execution);
  const modernSlides = Array.isArray(carousel.slides) ? carousel.slides : [];
  const legacySlides = Array.isArray(execution.slides) ? execution.slides : [];
  const source = modernSlides.length > 0 ? modernSlides : legacySlides;
  const normalized = source
    .map((slide, index) => normalizeCarouselSlide(slide, index))
    .filter((slide): slide is { slide: number; type: string; text: string } => Boolean(slide));

  if (normalized.length >= 6) {
    return { slides: normalized.slice(0, 6) };
  }

  return {
    slides: [
      { slide: 1, type: "hook", text: input.hook },
      { slide: 2, type: "problem", text: "Name the exact friction, hesitation, or belief that keeps the audience stuck." },
      { slide: 3, type: "insight", text: trimSentence(input.strategicIntent || "Introduce the smarter angle that reframes the problem.") },
      { slide: 4, type: "example", text: trimSentence(input.expectedReason || "Show one practical example or proof point that makes the insight believable.") },
      { slide: 5, type: "solution", text: `Show the concrete solution, process, or product move that makes the audience say, "This is what I should do next."` },
      { slide: 6, type: "cta", text: trimSentence(input.cta) },
    ],
  };
}

function normalizeStoryExecution(input: BuildPostDetailInput, execution: AnyRecord) {
  const story = asRecord(execution.story_execution);
  const modernFrames = Array.isArray(story.frames) ? story.frames : [];
  const legacyFrames = Array.isArray(execution.frames) ? execution.frames : [];
  const source = modernFrames.length > 0 ? modernFrames : legacyFrames;
  const normalized = source
    .map((frame, index) => normalizeStoryFrame(frame, index))
    .filter(
      (frame): frame is { frame: number; type: string; interaction?: string; text: string } =>
        Boolean(frame),
    );

  if (normalized.length >= 3) {
    return { frames: normalized.slice(0, 6) };
  }

  return {
    frames: [
      { frame: 1, type: "hook", interaction: "poll", text: input.hook },
      {
        frame: 2,
        type: "value",
        text: trimSentence(input.strategicIntent || "Give the audience one useful insight immediately."),
      },
      {
        frame: 3,
        type: "proof",
        text: trimSentence(input.expectedReason || "Add one reassurance line, buyer question, or credibility signal."),
      },
      {
        frame: 4,
        type: "cta",
        interaction: "question",
        text: trimSentence(input.cta),
      },
    ],
  };
}

function normalizeStaticExecution(
  input: BuildPostDetailInput,
  execution: AnyRecord,
  caption: string,
) {
  const staticExecution = asRecord(execution.static_execution);
  return {
    headline:
      readString(staticExecution.headline) ??
      readString(execution.headline) ??
      input.hook,
    visual_direction:
      readString(staticExecution.visual_direction) ??
      readString(execution.visual_idea) ??
      "Create one premium focal visual with ample negative space, a clear subject, and text hierarchy that lands the promise in under two seconds.",
    caption: readString(staticExecution.caption) ?? caption,
  };
}

function buildFallbackReelScript(
  input: BuildPostDetailInput,
  legacyBeats: string[],
  patternInterrupt?: string | null,
): string {
  const beatText =
    legacyBeats.length > 0
      ? legacyBeats.join(" Then ")
      : "Start by naming the problem, move into the insight, show the breakdown in action, then land proof before the CTA.";
  return [
    `${input.hook}`,
    patternInterrupt ? `At the 3-5 second mark, shift with ${patternInterrupt}.` : null,
    beatText,
    `Close with: ${trimSentence(input.cta)}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildEditingStyle(execution: AnyRecord): string {
  const audio = readString(execution.audio);
  const interrupt = readString(execution.pattern_interrupt);
  return [
    "Use tight cuts, large captions, and one visual change every 1-2 seconds to keep pace high.",
    interrupt ? `Make the pattern interrupt obvious: ${interrupt}.` : null,
    audio ? `Audio direction: ${audio}.` : "Audio direction: spoken-first with clean ambient backing.",
  ]
    .filter(Boolean)
    .join(" ");
}

function inferProductionEffort(priority?: string | null, formatKind?: FormatKind): string {
  if (priority === "high") return "high";
  if (formatKind === "story" || formatKind === "static") return "low";
  return "medium";
}

function inferDuration(formatKind: FormatKind): string {
  if (formatKind === "reel") return "30-45 seconds";
  if (formatKind === "story") return "4 frames";
  if (formatKind === "carousel") return "6 slides";
  if (formatKind === "static") return "Single post";
  return "Single post";
}

function inferShootType(formatKind: FormatKind): string {
  if (formatKind === "reel") return "Product-led vertical video with ritual shots, text overlays, and supporting b-roll";
  if (formatKind === "story") return "Fast mobile-first capture with direct response overlays";
  if (formatKind === "carousel") return "Design-led narrative using screenshots, proof, and clean text slides";
  if (formatKind === "static") return "Single strong hero visual with premium art direction";
  return "Lightweight in-house production";
}

function feedbackTypeForFormat(formatKind: FormatKind): string {
  if (formatKind === "reel") return "hook / caption / edit / strategy";
  if (formatKind === "carousel") return "hook / design / caption / strategy";
  if (formatKind === "story") return "hook / sticker / caption / strategy";
  return "headline / caption / design / strategy";
}

function defaultNicheTags(input: BuildPostDetailInput): string[] {
  const pillarTag = toHashtag(input.pillar);
  const platformTag = toHashtag(`${input.platform} content`);
  return dedupeHashtags([
    pillarTag,
    platformTag,
    "#brandstrategy",
    "#contentdirection",
    "#socialcontentplan",
    "#creativeexecution",
    "#foundermarketing",
  ]).slice(0, 7);
}

function defaultProblemTags(input: BuildPostDetailInput): string[] {
  return dedupeHashtags([
    toHashtag(input.objective),
    "#contentplanning",
    "#lowengagement",
    "#brandconfusion",
    "#conversioncontent",
  ]).slice(0, 5);
}

function defaultBroadTags(input: BuildPostDetailInput): string[] {
  return dedupeHashtags([
    "#marketing",
    "#socialmedia",
    toHashtag(input.platform),
  ]).slice(0, 3);
}

function fillHashtagBucket(
  current: string[],
  fallback: string[],
  min: number,
  max: number,
): string[] {
  const merged = dedupeHashtags([...current, ...fallback]);
  return merged.slice(0, Math.max(min, Math.min(max, merged.length)));
}

function normalizeCarouselSlide(slide: unknown, index: number) {
  const record = asRecord(slide);
  const text = readString(record.text) ?? [readString(record.headline), readString(record.body)].filter(Boolean).join(" — ");
  if (!text) return null;
  return {
    slide: readNumber(record.slide) ?? readNumber(record.n) ?? index + 1,
    type: readString(record.type) ?? readString(record.role) ?? inferCarouselType(index),
    text,
  };
}

function normalizeStoryFrame(
  frame: unknown,
  index: number,
): { frame: number; type: string; interaction?: string; text: string } | null {
  const record = asRecord(frame);
  const text = readString(record.text) ?? readString(record.copy);
  if (!text) return null;
  const interaction = readString(record.interaction);
  return {
    frame: readNumber(record.frame) ?? readNumber(record.n) ?? index + 1,
    type: readString(record.type) ?? readString(record.role) ?? inferStoryType(index),
    ...(interaction && interaction !== "none" ? { interaction } : {}),
    text,
  };
}

function inferCarouselType(index: number): string {
  return ["hook", "problem", "insight", "example", "solution", "cta"][index] ?? "value";
}

function inferStoryType(index: number): string {
  return ["hook", "value", "proof", "cta"][index] ?? "value";
}

function normalizeProductionEffort(value?: string | null): "low" | "medium" | "high" | null {
  if (value === "low" || value === "medium" || value === "high") return value;
  return null;
}

function sanitizeHashtags(tags: string[], min: number, max: number): string[] {
  return dedupeHashtags(tags).slice(0, Math.max(min, Math.min(max, tags.length || max)));
}

function dedupeHashtags(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/\s+/g, "")}`)),
    ),
  );
}

function toHashtag(value: string): string {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join("");
  return clean ? `#${clean}` : "#content";
}

function trimSentence(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => readString(item)).filter((item): item is string => Boolean(item))
    : [];
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveScopedPlatforms(
  platform: string,
  activePlatforms?: string[] | null,
  execution?: AnyRecord,
): string[] {
  const source = Array.isArray(activePlatforms) && activePlatforms.length > 0
    ? activePlatforms
    : readStringArray(execution?.active_platforms);
  const normalized = Array.from(
    new Set(source.map((value) => normalizePlatformName(value)).filter(Boolean)),
  );
  if (normalized.length === 0) return [normalizePlatformName(platform)];
  if (!normalized.includes(normalizePlatformName(platform))) {
    normalized.unshift(normalizePlatformName(platform));
  }
  return normalized;
}

function isAllowedRepurposeTarget(
  target: string,
  platform: string,
  activePlatforms?: string[] | null,
  execution?: AnyRecord,
): boolean {
  const scopedPlatforms = resolveScopedPlatforms(platform, activePlatforms, execution);
  const targetPlatform = normalizePlatformName(target.split("-")[0] ?? "");
  return scopedPlatforms.includes(targetPlatform);
}

function normalizePlatformName(value: string): string {
  const raw = value.trim().toLowerCase();
  if (raw === "x" || raw.includes("twitter")) return "X";
  if (raw.includes("linkedin")) return "LinkedIn";
  if (raw.includes("pinterest")) return "Pinterest";
  if (raw.includes("youtube")) return "YouTube";
  if (raw.includes("instagram")) return "Instagram";
  return value.trim();
}
