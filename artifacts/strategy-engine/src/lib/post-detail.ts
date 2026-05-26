export interface PostDetailSource {
  format: string;
  platform: string;
  pillar: string;
  angle: string;
  objective: string;
  hook: string;
  cta: string;
  caption?: string | null;
  hashtags?: string[] | null;
  strategicIntent?: string | null;
  expectedMetric?: string | null;
  expectedReason?: string | null;
  execution?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface NormalizedPostDetail {
  formatKind: "reel" | "carousel" | "story" | "static" | "other";
  isSkeletonPlan: boolean;
  isPinterestPin: boolean;
  theme: string;
  overview: Array<{ label: string; value: string }>;
  decision: {
    whyThisExists: string;
    successLooksLike: string;
    cta: string;
  };
  caption: {
    structure: string[];
    text: string;
  };
  hashtags: {
    niche: string[];
    problem: string[];
    broad: string[];
  };
  conversionPath: {
    entryPoint: string;
    nextStep: string;
    finalGoal: string;
  };
  repurposePlan: string[];
  timeline: Array<{ label: string; value: string }>;
  dependencies: string[];
  feedback: {
    type: string;
    comment: string;
  };
  reelExecution?: {
    hookLine: string;
    flow: string[];
    script: string;
    visualDirection: string;
    editingStyle: string;
  };
  carouselExecution?: Array<{ slide: number; type: string; text: string }>;
  storyExecution?: Array<{ frame: number; type: string; interaction?: string; text: string }>;
  staticExecution?: {
    headline: string;
    visualDirection: string;
    caption: string;
  };
}

type AnyRecord = Record<string, unknown>;

export function normalizePostDetail(post: PostDetailSource): NormalizedPostDetail {
  const execution = asRecord(post.execution);
  const formatKind = detectFormatKind(post.format);
  const isSkeletonPlan = readString(execution.planning_stage) === "monthly_skeleton";
  const isPinterestPin = post.platform.toLowerCase().includes("pinterest");
  const theme = readTheme(post);
  const caption = normalizeCaption(post, execution);
  const hashtags = normalizeHashtags(post, execution);
  const timeline = normalizeTimeline(execution);

  return {
    formatKind,
    isSkeletonPlan,
    isPinterestPin,
    theme,
    overview: [
      { label: "Format style", value: readString(execution.format_style) ?? post.format },
      {
        label: "Production effort",
        value: readString(execution.production_effort) ?? inferProductionEffort(formatKind),
      },
      { label: primaryMetricLabel(formatKind), value: readString(execution.duration) ?? inferDuration(formatKind) },
      { label: "Shoot type", value: readString(execution.shoot_type) ?? inferShootType(formatKind) },
      { label: "Theme", value: theme },
    ],
    decision: {
      whyThisExists:
        post.strategicIntent?.trim() ||
        post.objective ||
        "Create a clear next step for the audience and move them toward action.",
      successLooksLike: describeSuccess(post),
      cta: post.cta,
    },
    caption,
    hashtags,
    conversionPath: normalizeConversionPath(post, execution),
    repurposePlan: normalizeRepurposePlan(post.platform, post.format, formatKind, execution),
    timeline,
    dependencies: normalizeDependencies(formatKind, execution),
    feedback: normalizeFeedback(formatKind, execution),
    reelExecution: formatKind === "reel" ? normalizeReelExecution(post, execution) : undefined,
    carouselExecution:
      formatKind === "carousel" ? normalizeCarouselExecution(post, execution) : undefined,
    storyExecution: formatKind === "story" ? normalizeStoryExecution(post, execution) : undefined,
    staticExecution:
      formatKind === "static" ? normalizeStaticExecution(post, execution, caption.text) : undefined,
  };
}

function detectFormatKind(format: string): NormalizedPostDetail["formatKind"] {
  const lower = format.toLowerCase();
  if (lower.includes("carousel")) return "carousel";
  if (lower.includes("story")) return "story";
  if (lower.includes("static")) return "static";
  if (lower.includes("reel") || lower.includes("short") || lower.includes("video")) return "reel";
  return "other";
}

function normalizeCaption(post: PostDetailSource, execution: AnyRecord) {
  const captionRecord = asRecord(execution.caption);
  if (readString(execution.planning_stage) === "monthly_skeleton") {
    return {
      structure: ["hook", "topic", "objective", "cta"],
      text: [
        `Hook: ${post.hook || "Not set yet"}`,
        `Topic: ${post.angle || "Not set yet"}`,
        `Objective: ${post.objective || "Not set yet"}`,
        `CTA direction: ${post.cta || "Not set yet"}`,
      ].join("\n\n"),
    };
  }
  const text =
    readString(captionRecord.text) ??
    readString(post.caption) ??
    [post.hook, post.objective, post.cta].filter(Boolean).join("\n\n");
  const structure = readStringArray(captionRecord.structure);
  return {
    structure: structure.length > 0 ? structure : ["hook", "context", "value", "cta"],
    text,
  };
}

function readTheme(post: PostDetailSource): string {
  const metadata = asRecord(post.metadata);
  return (
    readString(metadata.theme) ??
    readString(post.angle) ??
    readString(post.objective) ??
    "Theme unavailable"
  );
}

function normalizeHashtags(post: PostDetailSource, execution: AnyRecord) {
  if (readString(execution.planning_stage) === "monthly_skeleton") {
    return {
      niche: [],
      problem: [],
      broad: [],
    };
  }
  const groups = asRecord(execution.hashtags);
  const niche = readStringArray(groups.niche);
  const problem = readStringArray(groups.problem);
  const broad = readStringArray(groups.broad);
  if (niche.length || problem.length || broad.length) {
    return {
      niche: fillTags(niche, defaultNicheTags(post), 5, 7),
      problem: fillTags(problem, defaultProblemTags(post), 3, 5),
      broad: fillTags(broad, defaultBroadTags(post), 2, 3),
    };
  }

  const flat = dedupeHashtags(post.hashtags ?? []);
  return {
    niche: fillTags(flat.slice(0, 7), defaultNicheTags(post), 5, 7),
    problem: fillTags(flat.slice(7, 12), defaultProblemTags(post), 3, 5),
    broad: fillTags(flat.slice(12, 15), defaultBroadTags(post), 2, 3),
  };
}

function normalizeConversionPath(post: PostDetailSource, execution: AnyRecord) {
  const conversion = asRecord(execution.conversion_path);
  return {
    entryPoint:
      readString(conversion.entry_point) ??
      `${post.hook} This post earns attention by making the pain or opportunity instantly recognizable.`,
    nextStep:
      readString(conversion.next_step) ??
      `Move interested viewers toward ${trimSentence(post.cta).toLowerCase()}.`,
    finalGoal:
      readString(conversion.final_goal) ??
      trimSentence(post.objective || post.expectedMetric || "qualified audience action"),
  };
}

function normalizeRepurposePlan(
  platform: string,
  format: string,
  formatKind: NormalizedPostDetail["formatKind"],
  execution: AnyRecord,
): string[] {
  const plan = readStringArray(execution.repurpose_plan);
  if (plan.length > 0) return plan;
  const explicitTargets = readStringArray(execution.repurpose_targets);
  const activePlatforms = resolveActivePlatforms(platform, execution);
  if (explicitTargets.length > 0) {
    return explicitTargets
      .filter((target) => activePlatforms.includes(normalizePlatformName(target.split("-")[0] ?? "")))
      .map((target) => `Repurpose this ${format} for ${target}.`);
  }
  const platformPlan = defaultRepurposeTargets(platform, format, activePlatforms);
  if (platformPlan.length > 0) return platformPlan;
  if (formatKind === "reel") {
    return [
      "Break the hook and proof beat into a 3-frame story sequence.",
      "Turn the spoken points into a save-friendly carousel.",
      "Cut the proof section into an organic warm-audience story or reel variation.",
    ];
  }
  if (formatKind === "carousel") {
    return [
      "Turn each slide headline into a talking-point reel outline.",
      "Use the strongest two slides as story frames with a response sticker.",
      "Reuse problem/solution slides in an organic follow-up post.",
    ];
  }
  if (formatKind === "story") {
    return [
      "Promote the best-performing frame into a static feed post.",
      "Expand the proof frame into a short founder reel.",
      "Use sticker responses to shape a follow-up conversion post.",
    ];
  }
  return [
    "Turn the headline into a short story hook with a direct response sticker.",
    "Expand the caption into a short talking-head reel.",
    "Reuse the visual in an organic warm-audience reminder post.",
  ];
}

function defaultRepurposeTargets(platform: string, format: string, activePlatforms: string[]): string[] {
  const normalizedPlatform = platform.trim().toLowerCase();
  const normalizedFormat = format.trim();
  if (normalizedPlatform.includes("instagram")) {
    const out = [
      "Turn the hook into a 3-frame Instagram story sequence with a reply CTA.",
      normalizedFormat.toLowerCase().includes("reel")
        ? "Adapt the main takeaway into an Instagram carousel with save-friendly text slides."
        : "Expand the core idea into an Instagram reel with product or ritual visuals.",
    ];
    if (activePlatforms.includes("Pinterest")) {
      out.push(
        normalizedFormat.toLowerCase().includes("reel")
          ? "Adapt the strongest beat into a Pinterest video pin with a save-worthy headline."
          : "Rework the core idea into a Pinterest static pin with a vertical save-friendly layout.",
      );
    }
    return out.slice(0, 3);
  }
  if (normalizedPlatform.includes("pinterest")) {
    const out = ["Create a second saveable Pinterest variation with a new visual angle."];
    if (activePlatforms.includes("Instagram")) {
      out.push(
        normalizedFormat.toLowerCase().includes("video")
          ? "Adapt this video pin into an Instagram reel with the same ritual or product takeaway."
          : "Turn this pin into an Instagram carousel or static post with the same core theme.",
      );
      out.push("Use the main pin idea as an Instagram story set with a reply CTA.");
    }
    return out.slice(0, 3);
  }
  if (normalizedPlatform === "x" || normalizedPlatform.includes("twitter")) {
    return [
      "Expand the strongest point into a short follow-up thread or image post.",
      "Reuse the hook in another X-native variation aimed at replies or bookmarks.",
    ];
  }
  if (normalizedPlatform.includes("linkedin")) {
    return ["Adapt the same idea into a shorter LinkedIn follow-up post with a sharper takeaway."];
  }
  if (normalizedPlatform.includes("youtube")) {
    return ["Cut the strongest moment into a shorter teaser or recap variation on YouTube."];
  }
  return [];
}

function normalizeTimeline(execution: AnyRecord) {
  const timeline = asRecord(execution.timeline);
  return [
    {
      label: "Internal deadline",
      value: readString(timeline.internal_deadline) ?? "48 hours before publish date",
    },
    {
      label: "Suggested posting time",
      value: readString(timeline.posting_time) ?? "7:30 PM local time",
    },
  ];
}

function normalizeDependencies(
  formatKind: NormalizedPostDetail["formatKind"],
  execution: AnyRecord,
) {
  const deps = readStringArray(execution.dependencies);
  if (deps.length > 0) return deps;
  const common = ["Hook approval", "Caption sign-off", "Design review"];
  if (formatKind === "reel") return [...common, "Raw footage or b-roll", "Subtitle/export pass"];
  if (formatKind === "carousel") return [...common, "Slide copy lock", "Design asset pack"];
  if (formatKind === "story") return [...common, "Sticker choice", "Story export"];
  return [...common, "Hero visual", "On-image text approval"];
}

function normalizeFeedback(
  formatKind: NormalizedPostDetail["formatKind"],
  execution: AnyRecord,
) {
  const feedback = asRecord(execution.feedback_structure);
  return {
    type: readString(feedback.type) ?? defaultFeedbackType(formatKind),
    comment:
      readString(feedback.comment) ??
      "Review the opening line first, then confirm the execution feels easy to produce and the CTA is specific enough to drive action.",
  };
}

function normalizeReelExecution(post: PostDetailSource, execution: AnyRecord) {
  const reel = asRecord(execution.reel_execution);
  const isPinterestVideoPin =
    post.platform.toLowerCase().includes("pinterest") &&
    post.format.toLowerCase().includes("video pin");
  return {
    hookLine: readString(reel.hook_line) ?? readString(execution.hook_2s) ?? post.hook,
    flow: readStringArray(reel.flow).length > 0
      ? readStringArray(reel.flow)
      : isPinterestVideoPin
        ? ["hook", "ritual idea", "product detail", "save or click"]
        : ["problem", "insight", "breakdown", "proof", "cta"],
    script:
      readString(reel.script) ??
      [
        post.hook,
        readString(execution.pattern_interrupt),
        ...readStringArray(execution.beats),
        post.cta,
      ]
        .filter(Boolean)
        .join(" "),
    visualDirection:
      readString(reel.visual_direction) ??
      readString(execution.visual_direction) ??
      (isPinterestVideoPin
        ? "Use a vertical pin-safe visual flow: quick hook text, calming ritual visual, product detail close-up, then a save or click CTA."
        : "Open on the founder/product in use, move into detail shots that prove the claim, and finish on a direct CTA frame."),
    editingStyle:
      readString(reel.editing_style) ??
      [
        "Use tight cuts, bold subtitles, and one visual change every 1-2 seconds.",
        readString(execution.audio),
      ]
        .filter(Boolean)
        .join(" "),
  };
}

function normalizeCarouselExecution(post: PostDetailSource, execution: AnyRecord) {
  const carousel = asRecord(execution.carousel_execution);
  const modern = Array.isArray(carousel.slides) ? carousel.slides : [];
  const legacy = Array.isArray(execution.slides) ? execution.slides : [];
  const source = modern.length > 0 ? modern : legacy;
  const slides = source
    .map((slide, index) => normalizeCarouselSlide(slide, index))
    .filter(
      (slide): slide is { slide: number; type: string; text: string } => Boolean(slide),
    );

  if (slides.length >= 6) return slides.slice(0, 6);

  return [
    { slide: 1, type: "hook", text: post.hook },
    {
      slide: 2,
      type: "problem",
      text: "Name the exact friction, hesitation, or belief that keeps the audience stuck.",
    },
    {
      slide: 3,
      type: "insight",
      text: post.strategicIntent || "Introduce the insight that reframes the problem.",
    },
    {
      slide: 4,
      type: "example",
      text: post.expectedReason || "Show one practical example or proof point.",
    },
    {
      slide: 5,
      type: "solution",
      text: "Spell out the move, offer, or process that solves the problem clearly.",
    },
    { slide: 6, type: "cta", text: post.cta },
  ];
}

function normalizeStoryExecution(post: PostDetailSource, execution: AnyRecord) {
  const story = asRecord(execution.story_execution);
  const modern = Array.isArray(story.frames) ? story.frames : [];
  const legacy = Array.isArray(execution.frames) ? execution.frames : [];
  const source = modern.length > 0 ? modern : legacy;
  const frames = source
    .map((frame, index) => normalizeStoryFrame(frame, index))
    .filter(
      (frame): frame is { frame: number; type: string; interaction?: string; text: string } =>
        Boolean(frame),
    );
  if (frames.length >= 3) return frames.slice(0, 6);

  return [
    { frame: 1, type: "hook", interaction: "poll", text: post.hook },
    {
      frame: 2,
      type: "value",
      text: post.strategicIntent || "Give the audience one fast, useful insight.",
    },
    {
      frame: 3,
      type: "proof",
      text: post.expectedReason || "Add one proof point or credibility signal.",
    },
    { frame: 4, type: "cta", interaction: "question", text: post.cta },
  ];
}

function normalizeStaticExecution(
  post: PostDetailSource,
  execution: AnyRecord,
  caption: string,
) {
  const staticExecution = asRecord(execution.static_execution);
  const isPinterestStaticPin =
    post.platform.toLowerCase().includes("pinterest") &&
    post.format.toLowerCase().includes("pin");
  return {
    headline:
      readString(staticExecution.headline) ??
      readString(execution.headline) ??
      post.hook,
    visualDirection:
      readString(staticExecution.visual_direction) ??
      readString(execution.visual_idea) ??
      (isPinterestStaticPin
        ? "Design a vertical 2:3 pin with a clear headline, premium ritual visual, and save-friendly text hierarchy."
        : "Use one premium focal visual with clear hierarchy so the promise lands instantly."),
    caption: readString(staticExecution.caption) ?? caption,
  };
}

function normalizeCarouselSlide(slide: unknown, index: number) {
  const record = asRecord(slide);
  const text =
    readString(record.text) ??
    [readString(record.headline), readString(record.body)].filter(Boolean).join(" — ");
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

function describeSuccess(post: PostDetailSource): string {
  if (post.expectedMetric?.trim()) {
    return post.expectedReason?.trim()
      ? `${post.expectedMetric}: ${post.expectedReason}`
      : post.expectedMetric;
  }
  return "A clear audience response that signals the post moved attention toward intent.";
}

function inferProductionEffort(formatKind: NormalizedPostDetail["formatKind"]): string {
  if (formatKind === "story" || formatKind === "static") return "low";
  return "medium";
}

function inferDuration(formatKind: NormalizedPostDetail["formatKind"]): string {
  if (formatKind === "reel") return "30-45 seconds";
  if (formatKind === "carousel") return "6 slides";
  if (formatKind === "story") return "4 frames";
  return "Single post";
}

function primaryMetricLabel(formatKind: NormalizedPostDetail["formatKind"]): string {
  if (formatKind === "carousel") return "Slide count";
  if (formatKind === "story") return "Frame count";
  if (formatKind === "static") return "Asset type";
  return "Duration";
}

function inferShootType(formatKind: NormalizedPostDetail["formatKind"]): string {
  if (formatKind === "reel") return "Founder-led talking head with supporting b-roll";
  if (formatKind === "carousel") return "Design-led narrative with proof and text slides";
  if (formatKind === "story") return "Mobile-first story capture with response stickers";
  return "Single hero visual with clean art direction";
}

function defaultFeedbackType(formatKind: NormalizedPostDetail["formatKind"]): string {
  if (formatKind === "reel") return "hook / caption / edit / strategy";
  if (formatKind === "carousel") return "hook / design / caption / strategy";
  if (formatKind === "story") return "hook / sticker / caption / strategy";
  return "headline / caption / design / strategy";
}

function inferCarouselType(index: number): string {
  return ["hook", "problem", "insight", "example", "solution", "cta"][index] ?? "value";
}

function inferStoryType(index: number): string {
  return ["hook", "value", "proof", "cta"][index] ?? "value";
}

function defaultNicheTags(post: PostDetailSource): string[] {
  return dedupeHashtags([
    toHashtag(post.pillar),
    toHashtag(`${post.platform} content`),
    "#brandstrategy",
    "#contentdirection",
    "#creativeexecution",
    "#foundermarketing",
    "#socialcontentplan",
  ]).slice(0, 7);
}

function defaultProblemTags(post: PostDetailSource): string[] {
  return dedupeHashtags([
    toHashtag(post.objective),
    "#contentplanning",
    "#conversioncontent",
    "#brandconfusion",
    "#lowengagement",
  ]).slice(0, 5);
}

function defaultBroadTags(post: PostDetailSource): string[] {
  return dedupeHashtags(["#marketing", "#socialmedia", toHashtag(post.platform)]).slice(0, 3);
}

function fillTags(current: string[], fallback: string[], min: number, max: number) {
  return dedupeHashtags([...current, ...fallback]).slice(0, Math.max(min, Math.min(max, current.length || max)));
}

function dedupeHashtags(tags: string[]) {
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

function resolveActivePlatforms(platform: string, execution: AnyRecord): string[] {
  const active = readStringArray(execution.active_platforms)
    .map((value) => normalizePlatformName(value))
    .filter(Boolean);
  if (active.length === 0) return [normalizePlatformName(platform)];
  if (!active.includes(normalizePlatformName(platform))) active.unshift(normalizePlatformName(platform));
  return Array.from(new Set(active));
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
