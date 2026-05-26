import { estimateTokens } from "../llm/prompt-budget.js";
import { normalizeCalendarProviderId } from "./provider-budget.js";

/** Full schema system prompt — used for non-Groq providers. */
export const WEEK_POSTS_SYSTEM = `Return STRICT JSON only:
{
  "posts": [
    {
      "date": "YYYY-MM-DD",
      "week": "week_1" | "week_2" | "week_3" | "week_4",
      "platform": "Instagram" | "LinkedIn" | "Pinterest" | "X" | "YouTube",
      "pillar": "<pillar>",
      "topic": "<short topic direction>",
      "format": "carousel" | "reel" | "story" | "static" | "text post" | "thread" | "image post" | "static pin" | "video pin" | "short video" | "long video" | "community post" | "pdf carousel",
      "repurposeTargets": ["<platform> - <format>"],
      "objective": "<short objective>",
      "hook": "<short hook>",
      "cta": "<cta>",
      "strategicAngle": "<short strategic angle>",
      "audienceTension": "<short audience tension>",
      "specificReference": "<specific source-backed reference>",
      "proofMode": "<proof mode>",
      "proofSource": "<proof source>",
      "claimSafetyNote": "<claim safety note>",
      "priority": "high" | "medium" | "low",
      "status": "draft"
    }
  ]
}
Rules:
- Platforms/formats: Instagram=carousel|reel|story|static; Pinterest=static pin|video pin; LinkedIn=text post|carousel|pdf carousel|short video; X=text post|thread|image post; YouTube=short video|long video|community post.
- Skeleton only: no captions, hashtags, or long execution notes.
- Every post needs non-empty topic, objective, hook, cta.
- proofMode/proofSource must follow the brief proof contract.
- No commentary.`;

/** Groq-safe compact system prompt — validator covers field rules. */
export const WEEK_POSTS_SYSTEM_GROQ = `Return STRICT JSON: {"posts":[{"date","week","platform","pillar","topic","format","objective","hook","cta","strategicAngle","audienceTension","specificReference","proofMode","proofSource","claimSafetyNote","priority","status","repurposeTargets?}]}
Skeleton posts only. Match brief requiredBuckets order. No captions/hashtags. Concise fields.`;

export function resolveWeekPostsSystemPrompt(providerId: string): string {
  return normalizeCalendarProviderId(providerId) === "groq"
    ? WEEK_POSTS_SYSTEM_GROQ
    : WEEK_POSTS_SYSTEM;
}

export function buildWeeklyInstructionBlock(providerId: string, targetCount: number): string {
  if (normalizeCalendarProviderId(providerId) === "groq") {
    return [
      `Return exactly ${targetCount} posts.`,
      "- Follow requiredBuckets order (post i uses requiredBuckets[i-1]).",
      "- Use bucketTargets labels and weeklyPlatformTargets.",
      "- Honor proofConstraints; no invented testimonials when disallowed.",
      "- Keep topic/objective/hook/cta non-empty and brief-specific.",
    ].join("\n");
  }
  return [
    `Return exactly ${targetCount} posts in JSON.`,
    "- Use only activePlatforms and weeklyPlatformTargets from the brief.",
    "- Use only canonical bucket labels from bucketTargets and requiredBuckets.",
    "- requiredBuckets is the exact post order: post 1 uses requiredBuckets[0], post 2 uses requiredBuckets[1], etc.",
    "- Keep ideas specific to brand positioning, offer, productAnchors, audience signals, hooksAndCtas.allowedAngles, and strategySummaries.",
    "- Education=explain/how-it-works/benefit education.",
    "- Promotion=soft discovery, ritual-fit, variant discovery, gifting, or shop intent without aggressive sales language.",
    "- Social proof=safe proof only; never invent testimonials when proofConstraints.testimonialStyleAllowed is false.",
    "- Thought leadership=founder/category POV, ingredient insight, process insight, or category framing.",
    "- Avoid generic filler like discover, find, perfect, people love unless the brief clearly supports it.",
    "- Keep monthlyGoal and planningNotes active.",
    "- proofSource should be none or FAQ when proofConstraints.proofAssetsAvailable is false.",
    "- If proofConstraints.healthClaimSafetyMode is wellness_beauty_softened, avoid therapeutic or guaranteed claims.",
    "- Never infer sustainability or environmental positioning unless explicitly supported.",
    "- Honor calendarPlanHash, weeklyFocus, executionPhase, and priorWeekThemes for continuity.",
  ].join("\n");
}

export function estimateWeeklyPromptOverheadTokens(providerId: string, targetCount: number): {
  systemTokens: number;
  instructionTokens: number;
  totalFixedTokens: number;
} {
  const systemPrompt = resolveWeekPostsSystemPrompt(providerId);
  const instructionBlock = buildWeeklyInstructionBlock(providerId, targetCount);
  const systemTokens = estimateTokens(systemPrompt);
  const instructionTokens = estimateTokens(instructionBlock);
  return {
    systemTokens,
    instructionTokens,
    totalFixedTokens: systemTokens + instructionTokens,
  };
}
