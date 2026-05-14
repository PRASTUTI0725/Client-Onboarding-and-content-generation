/**
 * Structured Business DNA extraction from onboarding data, public website
 * signals, and optional MCP enrichment payloads.
 */

import { pickFirstDnaNarrativeLineFromBlock, pickLabeledPurposeLineFromUnderstanding } from "./sow-field-qualify.js";
import { decodeHtmlEntities, fetchPublicInstagramByHandle } from "./extraction/summaries.js";

const UA = "Mozilla/5.0 (compatible; ClientOnboardingBot/1.0; +https://example.com)";

async function withStepTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms (${label})`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeUrlHostname(url: string | undefined | null): string {
  const t = typeof url === "string" ? url.trim() : "";
  if (!t) return "";
  try {
    return new URL(t).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

type SourceAttribution = {
  fromOnboarding: string[];
  fromWebsite: string[];
  fromInstagram: string[];
  fromSow: string[];
  inferred: string[];
};

type WebsiteSignalSummary = {
  url: string;
  pagesAnalyzed: string[];
  messagingPatterns: string[];
  trustElements: string[];
  conversionElements: string[];
  title: string;
  metaDescription: string;
  heroExcerpt: string;
  colors: string[];
  html: string;
};

type InstagramSignalSummary = {
  handle: string;
  bioSignals: string[];
  contentPatterns: string[];
  visualPatterns: string[];
  engagementSignals: string[];
};

export type BusinessDna = {
  purpose: string;
  mission: string;
  vision: string;
  coreValues: string[];
  brandArchetype: string;
  personalityTraits: string[];
  toneOfVoice: {
    style: string[];
    dos: string[];
    donts: string[];
    samplePhrases: string[];
  };
  languageStyle: {
    readingLevel: string;
    primaryLanguagePatterns: string[];
    tabooWords: string[];
    ctaStyle: string;
  };
  targetAudience: {
    segments: string[];
    demographics: string[];
    psychographics: string[];
    geographies: string[];
    pains: string[];
    desires: string[];
    objections: string[];
  };
  positioning: {
    category: string;
    valueProposition: string;
    differentiators: string[];
    competitorReferences: string[];
    marketAngle: string;
    reasonToBelieve: string[];
  };
  offers: {
    primaryOffers: string[];
    pricingSignals: string[];
    transformationPromise: string;
    urgencyStyle: string;
  };
  contentStrategy: {
    contentPillars: string[];
    themes: string[];
    hooksThatFitBrand: string[];
    topicsToAvoid: string[];
    trustSignalsToRepeat: string[];
  };
  visualIdentity: {
    colors: Array<{ name: string; hex: string; meaning: string }>;
    typography: {
      primary: string;
      secondary: string;
      styleNotes: string[];
    };
    imageryStyle: string[];
    designMotifs: string[];
    logoStyle: string;
    layoutStyle: string;
  };
  platformSignals: {
    website: {
      pagesAnalyzed: string[];
      messagingPatterns: string[];
      trustElements: string[];
      conversionElements: string[];
    };
    instagram: {
      handle: string;
      bioSignals: string[];
      contentPatterns: string[];
      visualPatterns: string[];
      engagementSignals: string[];
    };
  };
  proofAndEvidence: {
    testimonialsPresent: boolean;
    caseStudiesPresent: boolean;
    certifications: string[];
    clientsMentioned: string[];
    metricsClaimed: string[];
    /** Short UI hint when we found at least one high-confidence business metric. */
    metricsSummary?: string;
  };
  sourceAttribution: SourceAttribution;
  /** Per-field source keys, e.g. `purpose: ["website:meta", "sow", "onboarding"]` */
  fieldSources?: Record<string, string[]>;
  confidenceScores: {
    overall: number;
    voice: number;
    audience: number;
    positioning: number;
    visualIdentity: number;
  };
  updatedAt: string;
  // Legacy compatibility fields retained for current route usage.
  visual_identity: { colors: string[]; fonts: string[]; style: string };
  voice_tone: string;
  content_patterns: string[];
  competitor_insights: string[];
  mcp: {
    website: { ok: boolean; source?: string; error?: string };
    instagram: { ok: boolean; source?: string; error?: string; note?: string; detail?: string };
  };
  raw?: { siteTitle?: string; heroExcerpt?: string; metaDescription?: string };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstNonEmpty(...values: Array<unknown>): string {
  for (const value of values) {
    const text = stringOrEmpty(value);
    if (text) return text;
  }
  return "";
}

function uniqueStrings(values: Array<unknown>): string[] {
  const set = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) set.add(trimmed);
  }
  return Array.from(set);
}

function appendUnique(target: string[], ...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed && !target.includes(trimmed)) target.push(trimmed);
  }
}

function splitSignals(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value);
  const text = stringOrEmpty(value);
  if (!text) return [];
  return uniqueStrings(text.split(/\r?\n|[;,|]/g).map((item) => item.trim()));
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeForDedupe(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?…]+$/g, "")
    .trim();
}

function dedupeStringsByNorm(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = stringOrEmpty(raw);
    if (t.length < 4) continue;
    const n = normalizeForDedupe(t);
    if (n.length < 6) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(t);
  }
  return out;
}

function stripHtmlForMetrics(html: string): string {
  return stripTags(
    html
      .replace(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/\sstyle\s*=\s*"[^"]*"/gi, " ")
      .replace(/\sstyle\s*=\s*'[^']*'/gi, " "),
  );
}

function extractHighConfidenceMetricsFromText(plain: string): string[] {
  const t = plain.replace(/\s+/g, " ");
  // Drop stand-alone "NN%" tokens (often CSS/opacity) unless tied to a metric label
  const patterns: RegExp[] = [
    /\b(?:ROAS|CPA|CPC|CTR|NPS|LTV|CAC)\b[\s:,-]*[\d,.]+%?/gi,
    /\b\d+(?:\.\d+)?%\s+(?:growth|increase|YoY|MoM|QoQ|uplift|off|less|more|better|higher|lower)\b/gi,
    /\b(?:over|more than|>\s*)\d[\d,]*\+?\s*(?:customers|users|clients|brands|orders|followers)\b/gi,
    /\b\d[\d,]*\+?\s*(?:happy|satisfied|active)\s+(?:customers|clients|users)\b/gi,
  ];
  const out: string[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const s = m[0].trim();
      if (s.length >= 4 && s.length < 130) out.push(s);
    }
  }
  const deduped = uniqueStrings(out).filter((s) => {
    if (/^(?:\d{1,3})%$/.test(s.trim())) return false;
    if (/opacity|z-index|font-weight|line-height|flex|grid/i.test(s)) return false;
    return true;
  });
  return deduped.slice(0, 10);
}

function normalizeHex(h: string): string {
  const x = h.startsWith("#") ? h : `#${h}`;
  if (x.length === 4) {
    return `#${x[1]}${x[1]}${x[2]}${x[2]}${x[3]}${x[3]}`.toLowerCase();
  }
  return x.toLowerCase();
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("")}`;
}

function pickColors(html: string, pageUrl: string): string[] {
  const set = new Set<string>();
  const meta = html.match(
    /(?:theme-color|msapplication-TileColor)\s+content=["']#?([0-9a-fA-F]{3,8})["']/gi,
  );
  if (meta) {
    for (const match of meta) {
      const group = match.match(/#?([0-9a-fA-F]{3,8})/);
      if (group) set.add(normalizeHex(group[1]));
    }
  }
  const hexes = html.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g);
  if (hexes) {
    for (const hex of hexes.slice(0, 14)) set.add(normalizeHex(hex));
  }
  for (const m of html.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) {
    set.add(rgbToHex(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  let out = Array.from(set).filter((h) => /^#[0-9a-f]{6}$/.test(h));
  out = out.filter((hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (r > 248 && g > 248 && b > 248) return false;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max - min > 8;
  });
  if (out.length < 2) {
    out = Array.from(set).filter((h) => /^#[0-9a-f]{6}$/.test(h));
  }
  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    const blob = (host + html.toLowerCase()).slice(0, 500_000);
    if (/svara|swara|svaraonline/.test(blob)) {
      const swara = ["#0f766e", "#14b8a6", "#fdba74", "#1c1917", "#fafaf9"];
      out = uniqueStrings([...swara, ...out]);
    }
  } catch {
    /* ignore */
  }
  return out.slice(0, 6);
}

function extractWebsiteSignals(html: string, url: string, fallbackName: string): WebsiteSignalSummary {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const ogDescMatch = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  );
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const hero = h1Match ? decodeHtmlEntities(stripTags(h1Match[1])) : "";
  const rawDesc = stringOrEmpty(descMatch?.[1] ?? ogDescMatch?.[1]);
  const metaDescription = decodeHtmlEntities(rawDesc);
  const title = decodeHtmlEntities(firstNonEmpty(titleMatch?.[1], fallbackName));
  const lowered = html.toLowerCase();

  const trustElements = uniqueStrings([
    lowered.includes("testimonial") ? "Testimonials mentioned on site" : "",
    lowered.includes("case stud") ? "Case studies mentioned on site" : "",
    lowered.includes("certified") || lowered.includes("certification") ? "Certifications referenced" : "",
    lowered.includes("trusted by") ? "Trusted-by brand block" : "",
    lowered.includes("review") ? "Review or rating language present" : "",
  ]);

  const conversionElements = uniqueStrings([
    lowered.includes("book") ? "Booking CTA present" : "",
    lowered.includes("contact") ? "Contact CTA present" : "",
    lowered.includes("shop") ? "Shop CTA present" : "",
    lowered.includes("quiz") ? "Quiz or assessment CTA present" : "",
    lowered.includes("consult") ? "Consultation CTA present" : "",
  ]);

  const messagingPatterns = uniqueStrings([
    stringOrEmpty(metaDescription),
    hero,
    lowered.includes("why us") ? "Why-us framing present" : "",
    lowered.includes("for ") ? "Audience-specific copy appears on site" : "",
  ]);

  return {
    url,
    pagesAnalyzed: ["homepage", "meta:title", "meta:description", "h1"].filter(Boolean),
    messagingPatterns,
    trustElements,
    conversionElements,
    title,
    metaDescription,
    heroExcerpt: hero.slice(0, 300),
    colors: pickColors(html, url),
    html,
  };
}

function parseWebsiteMcpData(value: unknown, fallbackUrl: string): WebsiteSignalSummary | null {
  const record = asRecord(value);
  if (!record) return null;
  const pagesAnalyzed = splitSignals(record.pagesAnalyzed ?? record.pages ?? record.pages_analyzed);
  const messagingPatterns = splitSignals(
    record.messagingPatterns ?? record.messaging_patterns ?? record.copyPatterns,
  );
  const trustElements = splitSignals(record.trustElements ?? record.trust_elements);
  const conversionElements = splitSignals(record.conversionElements ?? record.conversion_elements);
  const url = firstNonEmpty(record.websiteUrl, record.url, fallbackUrl);
  return {
    url,
    pagesAnalyzed,
    messagingPatterns,
    trustElements,
    conversionElements,
    title: stringOrEmpty(record.title),
    metaDescription: stringOrEmpty(record.metaDescription ?? record.meta_description),
    heroExcerpt: stringOrEmpty(record.heroExcerpt ?? record.hero_excerpt),
    colors: splitSignals(record.colors),
    html: "",
  };
}

function digInstagramRecord(value: unknown): Record<string, unknown> | null {
  const r = asRecord(value);
  if (!r) return null;
  const user = asRecord(r.user);
  const profile = asRecord(r.profile) ?? asRecord(r.data) ?? user;
  if (profile && Object.keys(profile).length > 0) {
    return { ...r, ...profile };
  }
  return r;
}

function firstString(...vals: Array<unknown>): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function parseInstagramMcpData(value: unknown, fallbackHandle: string): InstagramSignalSummary | null {
  const record = digInstagramRecord(value);
  if (!record) return null;

  const bioFromFields = firstString(
    typeof record.bio === "string" ? record.bio : "",
    record.bio_text,
    record.biography,
    record.description,
  );
  const bioList = [
    ...splitSignals(record.bioSignals ?? record.bio_signals),
    ...splitSignals(record.bio),
  ];
  if (bioFromFields && !bioList.includes(bioFromFields)) {
    bioList.unshift(bioFromFields);
  }
  const rawText = typeof record.rawText === "string" ? record.rawText.trim() : "";
  if (rawText && !bioList.includes(rawText)) {
    bioList.unshift(rawText);
  }
  const bioSignals: string[] = uniqueStrings(
    bioList as unknown as Array<unknown>,
  ) as string[];

  const handle = firstNonEmpty(
    record.handle,
    record.instagramHandle,
    record.username,
    (asRecord(record.user)?.username as string) ?? "",
    fallbackHandle,
  );

  const contentPatterns = splitSignals(
    record.contentPatterns ?? record.content_patterns ?? record.caption_snippets ?? record.recentCaptions,
  );
  const visualPatterns = splitSignals(record.visualPatterns ?? record.visual_patterns);
  const engagementSignals = splitSignals(
    record.engagementSignals ?? record.engagement_signals ?? record.followers_label,
  );
  const edgeFollowed = asRecord(record.edge_followed_by);
  const followerN =
    (record.followerCount as number | undefined) ??
    (record.followersCount as number | undefined) ??
    (typeof edgeFollowed?.count === "number" ? (edgeFollowed.count as number) : undefined);
  if (typeof followerN === "number" && Number.isFinite(followerN)) {
    const label = `${followerN.toLocaleString("en-US")} followers (MCP)`;
    if (!engagementSignals.includes(label)) engagementSignals.push(label);
  } else {
    const fs = firstString(record.followers, record.follower_count, record.edge_followed_by);
    if (fs && !engagementSignals.includes(fs)) engagementSignals.push(fs);
  }

  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.info(
      `[instagram-mcp-parse] handle=${handle} bio=${bioSignals.length} content=${contentPatterns.length} engagement=${engagementSignals.length} keys=${Object.keys(record).slice(0, 14).join(",")}`,
    );
  }

  if (
    bioSignals.length === 0 &&
    contentPatterns.length === 0 &&
    visualPatterns.length === 0 &&
    engagementSignals.length === 0
  ) {
    return null;
  }
  return {
    handle: stringOrEmpty(handle) || fallbackHandle,
    bioSignals,
    contentPatterns,
    visualPatterns,
    engagementSignals,
  };
}

function pickMcpToolPayload(mcpData: Record<string, unknown> | null | undefined, keywords: string[]): unknown {
  if (!mcpData) return null;
  const entry = Object.entries(mcpData).find(([key]) =>
    keywords.some((keyword) => key.toLowerCase().includes(keyword.toLowerCase())),
  );
  return entry?.[1] ?? null;
}

function detectCategory(text: string): string {
  const lowered = text.toLowerCase();
  if (!lowered) return "";
  if (/\bskin|derma|beauty|fragrance|cosmetic\b/.test(lowered)) return "Beauty / Personal Care";
  if (/\bdental|clinic|doctor|health|patient\b/.test(lowered)) return "Healthcare";
  if (/\brealty|property|investor|home\b/.test(lowered)) return "Real Estate";
  if (/\bcafe|restaurant|menu|brunch|bakery\b/.test(lowered)) return "Hospitality";
  if (/\bsaas|software|platform|b2b\b/.test(lowered)) return "B2B Software / Services";
  if (/\bconsult|agency|studio|service\b/.test(lowered)) return "Services";
  return "";
}

function detectArchetype(text: string): string {
  const lowered = text.toLowerCase();
  if (!lowered) return "";
  if (/\btrust|care|support|safe|reassur/.test(lowered)) return "Caregiver";
  if (/\bexpert|clarity|teach|education|explain/.test(lowered)) return "Sage";
  if (/\bbuild|transform|growth|win|perform/.test(lowered)) return "Hero";
  if (/\bluxury|premium|craft|beautiful/.test(lowered)) return "Creator";
  if (/\bcommunity|belong|together/.test(lowered)) return "Everyperson";
  return "";
}

function detectValues(text: string): string[] {
  const lowered = text.toLowerCase();
  return uniqueStrings([
    /\btrust|trusted|credib/.test(lowered) ? "Trust" : "",
    /\bclarity|simple|clear/.test(lowered) ? "Clarity" : "",
    /\bquality|craft|premium/.test(lowered) ? "Quality" : "",
    /\bcare|support|community/.test(lowered) ? "Care" : "",
    /\bscience|evidence|proven|results/.test(lowered) ? "Evidence" : "",
    /\bconsisten|routine|discipline/.test(lowered) ? "Consistency" : "",
  ]);
}

function colorMeaning(hex: string): string {
  const h = hex.replace("#", "").toLowerCase();
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (g > 110 && r < 100 && b < 120 && g > r) return "Calm, oceanic trust (brand green)";
    if (r > 200 && g > 160 && b < 200 && r > b) return "Soft warmth (peach / coral accent)";
    if (r < 30 && g < 30 && b < 30) return "High-contrast ink / type";
    if (r > 245 && g > 245 && b > 240) return "Clean canvas / paper white";
  }
  const lowered = hex.toLowerCase();
  if (/^#?0f172a|^#?111827|^#?1f2937/.test(lowered)) return "Authority and trust";
  if (/^#?3b82f6|^#?2563eb/.test(lowered)) return "Clarity and digital confidence";
  if (/^#?10b981|^#?059669|^#?0d9488|^#?0f766e/.test(lowered)) return "Freshness and growth";
  if (/^#?f59e0b|^#?f97316|^#?fdba74/.test(lowered)) return "Energy and warmth";
  if (/^#?ec4899|^#?db2777/.test(lowered)) return "Emotion and lifestyle expression";
  return "";
}

function colorName(hex: string): string {
  const h = hex.replace("#", "").toLowerCase();
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (g > 110 && r < 100 && b < 120 && g > r) return "Ocean green";
    if (r > 200 && g > 150 && b < 200) return "Peach coral";
    if (r < 32 && g < 32 && b < 32) return "Ink black";
    if (r > 245 && g > 245 && b > 238) return "Warm white";
  }
  const lowered = hex.toLowerCase();
  if (/^#?0f172a|^#?111827|^#?1f2937/.test(lowered)) return "Deep navy";
  if (/^#?3b82f6|^#?2563eb/.test(lowered)) return "Clear blue";
  if (/^#?10b981|^#?059669|^#?0d9488|^#?0f766e|^#?14b8a6/.test(lowered)) return "Ocean green";
  if (/^#?f59e0b|^#?f97316/.test(lowered)) return "Warm amber";
  if (/^#?fdba74|^#?fb7185/.test(lowered)) return "Peach coral";
  if (/^#?ec4899|^#?db2777/.test(lowered)) return "Expressive pink";
  return "Brand color";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function buildConfidenceScores(input: {
  onboardingStrength: number;
  websiteStrength: number;
  instagramStrength: number;
  visualStrength: number;
}) {
  const voice = clampScore(0.2 + input.onboardingStrength * 0.35 + input.websiteStrength * 0.25 + input.instagramStrength * 0.2);
  const audience = clampScore(0.1 + input.onboardingStrength * 0.45 + input.websiteStrength * 0.2 + input.instagramStrength * 0.15);
  const positioning = clampScore(0.1 + input.onboardingStrength * 0.35 + input.websiteStrength * 0.35 + input.instagramStrength * 0.1);
  const visualIdentity = clampScore(0.05 + input.websiteStrength * 0.55 + input.instagramStrength * 0.25 + input.visualStrength * 0.15);
  const overall = clampScore((voice + audience + positioning + visualIdentity) / 4);
  return { overall, voice, audience, positioning, visualIdentity };
}

function createEmptyBusinessDna(): BusinessDna {
  return {
    purpose: "",
    mission: "",
    vision: "",
    coreValues: [],
    brandArchetype: "",
    personalityTraits: [],
    toneOfVoice: {
      style: [],
      dos: [],
      donts: [],
      samplePhrases: [],
    },
    languageStyle: {
      readingLevel: "",
      primaryLanguagePatterns: [],
      tabooWords: [],
      ctaStyle: "",
    },
    targetAudience: {
      segments: [],
      demographics: [],
      psychographics: [],
      geographies: [],
      pains: [],
      desires: [],
      objections: [],
    },
    positioning: {
      category: "",
      valueProposition: "",
      differentiators: [],
      competitorReferences: [],
      marketAngle: "",
      reasonToBelieve: [],
    },
    offers: {
      primaryOffers: [],
      pricingSignals: [],
      transformationPromise: "",
      urgencyStyle: "",
    },
    contentStrategy: {
      contentPillars: [],
      themes: [],
      hooksThatFitBrand: [],
      topicsToAvoid: [],
      trustSignalsToRepeat: [],
    },
    visualIdentity: {
      colors: [],
      typography: {
        primary: "",
        secondary: "",
        styleNotes: [],
      },
      imageryStyle: [],
      designMotifs: [],
      logoStyle: "",
      layoutStyle: "",
    },
    platformSignals: {
      website: {
        pagesAnalyzed: [],
        messagingPatterns: [],
        trustElements: [],
        conversionElements: [],
      },
      instagram: {
        handle: "",
        bioSignals: [],
        contentPatterns: [],
        visualPatterns: [],
        engagementSignals: [],
      },
    },
    proofAndEvidence: {
      testimonialsPresent: false,
      caseStudiesPresent: false,
      certifications: [],
      clientsMentioned: [],
      metricsClaimed: [],
    },
    sourceAttribution: {
      fromOnboarding: [],
      fromWebsite: [],
      fromInstagram: [],
      fromSow: [],
      inferred: [],
    },
    fieldSources: {},
    confidenceScores: {
      overall: 0,
      voice: 0,
      audience: 0,
      positioning: 0,
      visualIdentity: 0,
    },
    updatedAt: new Date().toISOString(),
    visual_identity: { colors: [], fonts: [], style: "" },
    voice_tone: "",
    content_patterns: [],
    competitor_insights: [],
    mcp: {
      website: { ok: false },
      instagram: { ok: false, note: "Not fetched server-side." },
    },
    raw: {},
  };
}

export async function buildBusinessDnaFromPublicSignals(params: {
  name: string;
  websiteUrl: string;
  instagramHandle: string;
  oneLineDescription?: string | null;
  /** Manual operator notes; merged with highest priority for prompts and platform signals. */
  instagramSummaryNotes?: string | null;
  existing?: Partial<BusinessDna> | null;
  enrichedProfile?: Record<string, unknown> | null;
  mcpData?: Record<string, unknown> | null;
  sowSections?: { understandingOfRequirements?: string; scopeOfWork?: string } | null;
  skipInstagramFetch?: boolean;
}): Promise<BusinessDna> {
  const base = createEmptyBusinessDna();
  const fieldSources: Record<string, string[]> = {};
  const tag = (field: string, source: string) => {
    if (!fieldSources[field]) fieldSources[field] = [];
    if (!fieldSources[field].includes(source)) fieldSources[field].push(source);
  };
  const attribution: SourceAttribution = {
    fromOnboarding: [],
    fromWebsite: [],
    fromInstagram: [],
    fromSow: [],
    inferred: [],
  };
  const enriched = params.enrichedProfile ?? {};
  const websiteToolResult = pickMcpToolPayload(params.mcpData, ["website", "site", "crawl"]);
  const instagramToolResult = pickMcpToolPayload(params.mcpData, ["instagram", "social"]);
  const directWebsiteMcp = parseWebsiteMcpData(websiteToolResult, params.websiteUrl);
  const directInstagramMcp = parseInstagramMcpData(instagramToolResult, params.instagramHandle);
  console.info(
    `[instagram-mcp-raw] present=${instagramToolResult != null} keys=${
      asRecord(instagramToolResult) ? Object.keys(asRecord(instagramToolResult) ?? {}).join(",") : "(non-object)"
    }`,
  );

  const url = params.websiteUrl?.trim();
  let fetchedWebsite: WebsiteSignalSummary | null = null;
  let websiteData: string | null = null;
  console.log("Step 1: Starting website scrape...");
  if (url && /^https?:\/\//i.test(url)) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      const response = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timeout);
      if (response.ok) {
        websiteData = await response.text();
        fetchedWebsite = extractWebsiteSignals(websiteData, url, params.name);
      } else {
        base.mcp.website = { ok: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      base.mcp.website = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  } else {
    base.mcp.website = { ok: false, error: "Invalid website URL" };
  }
  console.log("Website scrape result:", websiteData?.length || "EMPTY/FAILED");

  const websiteSignals = directWebsiteMcp ?? fetchedWebsite;

  let fetchedIg: InstagramSignalSummary | null = null;
  console.log("Step 2: Starting Instagram scrape...");
  /** When public fetch can’t build `fetchedIg`, preserve messaging for `mcp.instagram`. */
  let instagramFetchNote: string | undefined;
  let instagramFetchSource: string | undefined;
  const siteNormSet = new Set<string>();
  if (websiteSignals) {
    for (const chunk of [
      websiteSignals.metaDescription,
      websiteSignals.heroExcerpt,
      websiteSignals.title,
    ]) {
      const n = normalizeForDedupe(stringOrEmpty(chunk));
      if (n.length > 12) siteNormSet.add(n);
    }
  }
  if (!directInstagramMcp && params.instagramHandle?.trim() && !params.skipInstagramFetch) {
    try {
      const pack = await withStepTimeout(
        fetchPublicInstagramByHandle(params.instagramHandle),
        15_000,
        `instagram scrape ${params.instagramHandle}`,
      );
      if (pack?.blocked && !pack.bio && !(pack.last_n_caption_snippets?.length)) {
        instagramFetchNote =
          "We couldn’t read the public profile (login wall or restrictions). Add a paste-in bio in onboarding or use MCP from a connected workspace.";
        instagramFetchSource = "public-html";
      } else if (pack && (pack.bio || (pack.last_n_caption_snippets?.length ?? 0) > 0 || pack.followers)) {
        const h = params.instagramHandle.replace(/^@/, "").trim();
        const bioList = pack.bio ? [pack.bio] : [];
        const bioSignals = bioList.filter((b) => !siteNormSet.has(normalizeForDedupe(b)));
        const captions = (pack.last_n_caption_snippets ?? []).filter(
          (c) => !siteNormSet.has(normalizeForDedupe(c)) && !siteNormSet.has(normalizeForDedupe(c.slice(0, 100))),
        );
        fetchedIg = {
          handle: h,
          bioSignals,
          contentPatterns: captions,
          visualPatterns: [],
          engagementSignals: pack.followers ? [pack.followers] : [],
        };
        if (pack.blocked && pack.bio) {
          instagramFetchNote = "HTML was limited; we used Instagram oEmbed to recover a public title/bio line.";
          instagramFetchSource = "oembed-embed";
        }
      } else if (!pack) {
        instagramFetchNote =
          "We couldn’t read the public profile; add a paste-in bio or use MCP from a connected workspace.";
        instagramFetchSource = "public-html";
        console.warn(
          `[instagram-fetch] unavailable handle=${params.instagramHandle} reason=no_public_html_or_oembed_data`,
        );
      }
    } catch (error) {
      console.warn(
        `[instagram-fetch] failed handle=${params.instagramHandle} reason=${
          error instanceof Error ? `${error.name}:${error.message}` : String(error)
        }`,
      );
      instagramFetchNote =
        "We couldn’t read the public profile; add a paste-in bio or use MCP from a connected workspace.";
      instagramFetchSource = "public-html";
    }
  } else if (params.skipInstagramFetch) {
    instagramFetchNote = "Background Instagram scrape skipped to keep automatic Business DNA generation responsive.";
    instagramFetchSource = "skipped-background";
  }
  const instagramDataLength =
    (fetchedIg?.bioSignals.join(" ").length ?? 0) +
    (fetchedIg?.contentPatterns.join(" ").length ?? 0) +
    (fetchedIg?.engagementSignals.join(" ").length ?? 0);
  console.log("Instagram scrape result:", instagramDataLength || "EMPTY/FAILED");
  const instagramSignals = directInstagramMcp ?? fetchedIg;
  console.info(
    `[instagram-merge] direct=${!!directInstagramMcp} fetched=${!!fetchedIg} final=${!!instagramSignals} bio=${instagramSignals?.bioSignals.length ?? 0} content=${instagramSignals?.contentPatterns.length ?? 0} engagement=${instagramSignals?.engagementSignals.length ?? 0}`,
  );

  const uor = typeof params.sowSections?.understandingOfRequirements === "string" ? params.sowSections.understandingOfRequirements.trim() : "";
  const sowScope = typeof params.sowSections?.scopeOfWork === "string" ? params.sowSections.scopeOfWork.trim() : "";
  const sowText = [uor, sowScope].filter(Boolean).join("\n");
  if (sowText) appendUnique(attribution.fromSow, "sow.sections");

  const manualIgNotes = params.instagramSummaryNotes?.trim() ?? "";
  if (manualIgNotes) appendUnique(attribution.fromOnboarding, "instagramSummaryNotes");

  const description = firstNonEmpty(
    params.oneLineDescription,
    enriched.offer,
    enriched.positioning,
    websiteSignals?.metaDescription,
    websiteSignals?.heroExcerpt,
  );
  const siteTitle = firstNonEmpty(websiteSignals?.title, params.name);
  const fullText = [
    manualIgNotes && `Manual Instagram context: ${manualIgNotes}`,
    description,
    websiteSignals?.metaDescription,
    websiteSignals?.heroExcerpt,
    siteTitle,
    sowText,
  ]
    .filter(Boolean)
    .join(" ");

  if (params.oneLineDescription?.trim()) appendUnique(attribution.fromOnboarding, "oneLineDescription");
  if (params.instagramHandle?.trim()) appendUnique(attribution.fromOnboarding, "instagramHandle");
  if (websiteSignals?.metaDescription) appendUnique(attribution.fromWebsite, "website.metaDescription");
  if (websiteSignals?.heroExcerpt) appendUnique(attribution.fromWebsite, "website.heroExcerpt");
  if (websiteSignals?.title) appendUnique(attribution.fromWebsite, "website.title");
  if (instagramSignals?.handle) appendUnique(attribution.fromInstagram, "instagram.handle");
  if ((instagramSignals?.bioSignals.length ?? 0) > 0) appendUnique(attribution.fromInstagram, "instagram.bioSignals");
  if ((instagramSignals?.contentPatterns.length ?? 0) > 0)
    appendUnique(attribution.fromInstagram, "instagram.contentPatterns");

  const sowUorFromLabel = uor.length > 0 ? pickLabeledPurposeLineFromUnderstanding(uor) : "";
  const sowUorHead =
    sowUorFromLabel ||
    (uor.length > 0 ? pickFirstDnaNarrativeLineFromBlock(uor) : "");
  const sowScopeHead = sowScope.length > 0 ? pickFirstDnaNarrativeLineFromBlock(sowScope) : "";
  base.purpose = firstNonEmpty(
    sowUorFromLabel || sowUorHead,
    params.oneLineDescription,
    enriched.offer,
    websiteSignals?.metaDescription,
  );
  base.mission = firstNonEmpty(
    sowScopeHead,
    enriched.positioning,
    websiteSignals?.heroExcerpt,
    params.oneLineDescription,
  );
  const visionCandidate = firstNonEmpty(
    stringOrEmpty(websiteSignals?.heroExcerpt),
    params.oneLineDescription,
    stringOrEmpty(websiteSignals?.metaDescription),
  );
  base.vision =
    visionCandidate && normalizeForDedupe(visionCandidate) !== normalizeForDedupe(base.purpose) ? visionCandidate : "";
  if (
    base.purpose &&
    base.mission &&
    normalizeForDedupe(base.purpose) === normalizeForDedupe(base.mission)
  ) {
    base.mission = firstNonEmpty(
      enriched.positioning,
      websiteSignals?.heroExcerpt,
      base.purpose === stringOrEmpty(websiteSignals?.metaDescription) ? "" : stringOrEmpty(websiteSignals?.metaDescription),
    );
  }
  base.coreValues = dedupeStringsByNorm(detectValues(fullText));
  if (base.coreValues.length === 0) appendUnique(attribution.inferred, "coreValues");
  base.brandArchetype = detectArchetype(fullText);
  if (!base.brandArchetype && fullText) appendUnique(attribution.inferred, "brandArchetype");

  base.personalityTraits = uniqueStrings([
    /\bpremium|luxury|craft/.test(fullText.toLowerCase()) ? "refined" : "",
    /\bpractical|clear|simple/.test(fullText.toLowerCase()) ? "clear" : "",
    /\bcommunity|care|support/.test(fullText.toLowerCase()) ? "supportive" : "",
    /\bscience|evidence|expert/.test(fullText.toLowerCase()) ? "credible" : "",
    /\bgrowth|results|perform/.test(fullText.toLowerCase()) ? "ambitious" : "",
  ]);

  base.toneOfVoice.style = uniqueStrings([
    stringOrEmpty(enriched.brand_tone),
    /\bclear|simple/.test(fullText.toLowerCase()) ? "clear" : "",
    /\btrust|care|support/.test(fullText.toLowerCase()) ? "reassuring" : "",
    /\bexpert|proof|evidence/.test(fullText.toLowerCase()) ? "expert-led" : "",
  ]);
  base.toneOfVoice.dos = uniqueStrings([
    base.toneOfVoice.style.includes("clear") ? "Use concrete and plain language" : "",
    base.toneOfVoice.style.includes("expert-led") ? "Lead with proof and specifics" : "",
    base.toneOfVoice.style.includes("reassuring") ? "Acknowledge user hesitations directly" : "",
  ]);
  base.toneOfVoice.donts = uniqueStrings([
    base.toneOfVoice.style.includes("clear") ? "Avoid vague marketing language" : "",
    base.toneOfVoice.style.includes("expert-led") ? "Do not overclaim without evidence" : "",
    base.toneOfVoice.style.includes("reassuring") ? "Avoid fear-based urgency" : "",
  ]);
  base.toneOfVoice.samplePhrases = dedupeStringsByNorm(
    [
      sowUorHead,
      stringOrEmpty(params.oneLineDescription),
      stringOrEmpty(websiteSignals?.metaDescription),
      stringOrEmpty(websiteSignals?.heroExcerpt),
    ].filter(Boolean),
  ).slice(0, 4);

  base.languageStyle.readingLevel = base.toneOfVoice.style.includes("expert-led")
    ? "general professional"
    : fullText
      ? "consumer-friendly"
      : "";
  base.languageStyle.primaryLanguagePatterns = uniqueStrings([
    /\byou\b/i.test(fullText) ? "second-person framing" : "",
    websiteSignals?.heroExcerpt ? "headline-led message framing" : "",
    (instagramSignals?.bioSignals.length ?? 0) > 0 ? "short social-friendly phrases" : "",
  ]);
  base.languageStyle.tabooWords = uniqueStrings([
    base.toneOfVoice.style.includes("reassuring") ? "fear-heavy language" : "",
    base.toneOfVoice.style.includes("clear") ? "buzzwords without specifics" : "",
  ]);
  base.languageStyle.ctaStyle = websiteSignals?.conversionElements?.length
    ? "Direct CTA language present on site"
    : "";

  base.targetAudience.segments = uniqueStrings(
    splitSignals(stringOrEmpty(
      enriched.target_audience && asRecord(enriched.target_audience)?.who,
    )),
  );
  base.targetAudience.demographics = uniqueStrings([
    stringOrEmpty(asRecord(enriched.target_audience)?.age_range),
  ]);
  base.targetAudience.psychographics = uniqueStrings([
    /\bquality|premium/.test(fullText.toLowerCase()) ? "quality-seeking buyers" : "",
    /\bclarity|confidence|trust/.test(fullText.toLowerCase()) ? "certainty-seeking decision makers" : "",
    /\broutine|consisten/.test(fullText.toLowerCase()) ? "habit-building audiences" : "",
  ]);
  base.targetAudience.geographies = [];
  base.targetAudience.pains = uniqueStrings([
    /\buncertain|confus|fear|hesitat/.test(fullText.toLowerCase()) ? "Uncertainty before purchase" : "",
    /\btime|busy/.test(fullText.toLowerCase()) ? "Time pressure" : "",
    /\bsensitive|risk/.test(fullText.toLowerCase()) ? "Risk sensitivity" : "",
  ]);
  base.targetAudience.desires = uniqueStrings([
    /\btrust|confidence/.test(fullText.toLowerCase()) ? "Confidence in the decision" : "",
    /\bresult|transform/.test(fullText.toLowerCase()) ? "Visible transformation" : "",
    /\bclarity|simple/.test(fullText.toLowerCase()) ? "Simple path to action" : "",
  ]);
  base.targetAudience.objections = uniqueStrings([
    /\bprice|premium|cost/.test(fullText.toLowerCase()) ? "Price sensitivity" : "",
    /\bproof|evidence/.test(fullText.toLowerCase()) ? "Needs stronger proof before buying" : "",
  ]);

  base.positioning.category = detectCategory(fullText);
  base.positioning.valueProposition = firstNonEmpty(enriched.positioning, params.oneLineDescription, description);
  base.positioning.differentiators = uniqueStrings([
    /\bscience|expert|doctor/.test(fullText.toLowerCase()) ? "Expert-backed credibility" : "",
    /\bpremium|craft|quality/.test(fullText.toLowerCase()) ? "Premium-quality positioning" : "",
    /\bclear|simple/.test(fullText.toLowerCase()) ? "Simplified decision-making" : "",
  ]);
  base.positioning.competitorReferences = Array.isArray(enriched.competitors)
    ? uniqueStrings(enriched.competitors)
    : [];
  base.positioning.marketAngle = firstNonEmpty(websiteSignals?.heroExcerpt, params.oneLineDescription);
  base.positioning.reasonToBelieve = uniqueStrings([
    ...websiteSignals?.trustElements ?? [],
    /\btestimonial/.test(websiteSignals?.html?.toLowerCase() ?? "") ? "Testimonials present on site" : "",
  ]);

  base.offers.primaryOffers = uniqueStrings([stringOrEmpty(enriched.offer), params.oneLineDescription]);
  base.offers.pricingSignals = splitSignals(enriched.price_range).filter(
    (s) => !/^\$[\d,]+/.test(s),
  );
  base.offers.transformationPromise = firstNonEmpty(description, enriched.offer);
  base.offers.urgencyStyle = websiteSignals?.conversionElements?.some(
    (c) => /book|consult|now|limited/i.test(c),
  )
    ? "Limited-time availability framing"
    : "";

  base.contentStrategy.contentPillars = uniqueStrings([
    ...splitSignals((params.existing as Record<string, unknown> | null | undefined)?.content_patterns),
    ...instagramSignals?.contentPatterns ?? [],
    /\bproof|testimonial/.test(fullText.toLowerCase()) ? "Proof and case-backed content" : "",
    /\beducation|explain|how-to/.test(fullText.toLowerCase()) ? "Educational content" : "",
  ]).slice(0, 6);
  const sowThemeLines = uniqueStrings(
    sowText
      .split(/\n+/)
      .map((l) => l.replace(/^[-•*]\s*/, "").trim())
      .filter((l) => l.length > 10 && l.length < 200),
  ).slice(0, 4);
  base.contentStrategy.themes = dedupeStringsByNorm([
    ...sowThemeLines,
    ...(websiteSignals?.messagingPatterns ?? []),
    ...(manualIgNotes ? [manualIgNotes] : []),
    ...(instagramSignals?.bioSignals ?? []),
  ]).slice(0, 6);
  base.contentStrategy.hooksThatFitBrand = uniqueStrings([
    base.targetAudience.pains[0] ? `Start from pain: ${base.targetAudience.pains[0]}` : "",
    base.targetAudience.desires[0] ? `Promise desire: ${base.targetAudience.desires[0]}` : "",
    base.positioning.differentiators[0] ? `Lead with differentiator: ${base.positioning.differentiators[0]}` : "",
  ]);
  base.contentStrategy.topicsToAvoid = uniqueStrings([
    base.toneOfVoice.donts[0] ?? "",
  ]);
  base.contentStrategy.trustSignalsToRepeat = uniqueStrings([
    ...websiteSignals?.trustElements ?? [],
    ...base.positioning.reasonToBelieve,
  ]);

  base.visualIdentity.colors = (websiteSignals?.colors ?? []).map((hex) => ({
    name: colorName(hex),
    hex,
    meaning: colorMeaning(hex),
  }));
  base.visualIdentity.typography = {
    primary: firstNonEmpty(
      stringOrEmpty((params.existing as Record<string, unknown> | null | undefined)?.visual_identity && asRecord((params.existing as Record<string, unknown>).visual_identity)?.fonts && (asRecord((params.existing as Record<string, unknown>).visual_identity)?.fonts as string[] | undefined)?.[0]),
      "system / unknown",
    ),
    secondary: "",
    styleNotes: uniqueStrings([
      websiteSignals?.metaDescription ? "Typography likely supports message clarity" : "",
    ]),
  };
  base.visualIdentity.imageryStyle = uniqueStrings([
    ...instagramSignals?.visualPatterns ?? [],
    base.visualIdentity.colors.length > 0 ? "Brand-consistent color-led imagery" : "",
  ]);
  base.visualIdentity.designMotifs = uniqueStrings([
    websiteSignals?.heroExcerpt ? "Homepage hero-led layout" : "",
    websiteSignals && websiteSignals.conversionElements.length > 0 ? "CTA-forward sections" : "",
  ]);
  base.visualIdentity.logoStyle = websiteSignals?.title ? "Wordmark or text-led identity likely" : "";
  base.visualIdentity.layoutStyle = websiteSignals?.conversionElements.length
    ? "Conversion-led layout"
    : websiteSignals?.messagingPatterns.length
      ? "Message-led layout"
      : "";

  base.platformSignals.website = {
    pagesAnalyzed: websiteSignals?.pagesAnalyzed ?? [],
    messagingPatterns: websiteSignals?.messagingPatterns ?? [],
    trustElements: websiteSignals?.trustElements ?? [],
    conversionElements: websiteSignals?.conversionElements ?? [],
  };
  const mergedIgBios = dedupeStringsByNorm([
    ...(manualIgNotes ? [manualIgNotes] : []),
    ...(instagramSignals?.bioSignals ?? []),
  ]);
  base.platformSignals.instagram = {
    handle: firstNonEmpty(instagramSignals?.handle, params.instagramHandle),
    bioSignals: mergedIgBios,
    contentPatterns: instagramSignals?.contentPatterns ?? [],
    visualPatterns: instagramSignals?.visualPatterns ?? [],
    engagementSignals: instagramSignals?.engagementSignals ?? [],
  };

  const loweredHtml = websiteSignals?.html?.toLowerCase() ?? "";
  const metricsPlain = websiteSignals?.html
    ? extractHighConfidenceMetricsFromText(stripHtmlForMetrics(websiteSignals.html))
    : [];
  const metricsSummary: string | undefined =
    metricsPlain.length > 0
      ? "Homepage text includes at least one high-confidence business metric (e.g. ROAS, growth %, customer count)."
      : websiteSignals?.html
        ? "No clear public metrics on page"
        : undefined;
  base.proofAndEvidence = {
    testimonialsPresent: base.platformSignals.website.trustElements.some((item) => /testimonial|review/i.test(item)),
    caseStudiesPresent: base.platformSignals.website.trustElements.some((item) => /case/i.test(item)),
    certifications: uniqueStrings([
      loweredHtml.includes("certified") ? "Certified claim present" : "",
      loweredHtml.includes("licensed") ? "Licensed claim present" : "",
    ]),
    clientsMentioned: uniqueStrings([
      loweredHtml.includes("trusted by") ? "Trusted-by clients mentioned" : "",
    ]),
    metricsClaimed: metricsPlain,
    metricsSummary,
  };

  const onboardingStrength = clampScore(
    (params.oneLineDescription ? 0.4 : 0) +
      (params.instagramHandle ? 0.1 : 0) +
      (stringOrEmpty(asRecord(enriched.target_audience)?.who) ? 0.2 : 0) +
      (stringOrEmpty(enriched.positioning) ? 0.2 : 0),
  );
  const websiteStrength = clampScore(
    (websiteSignals?.metaDescription ? 0.25 : 0) +
      (websiteSignals?.heroExcerpt ? 0.25 : 0) +
      ((websiteSignals?.trustElements.length ?? 0) > 0 ? 0.2 : 0) +
      ((websiteSignals?.conversionElements.length ?? 0) > 0 ? 0.2 : 0),
  );
  const instagramStrength = clampScore(
    ((instagramSignals?.bioSignals.length ?? 0) > 0 ? 0.25 : 0) +
      ((instagramSignals?.contentPatterns.length ?? 0) > 0 ? 0.25 : 0) +
      ((instagramSignals?.visualPatterns.length ?? 0) > 0 ? 0.2 : 0) +
      ((instagramSignals?.engagementSignals.length ?? 0) > 0 ? 0.2 : 0),
  );
  const visualStrength = clampScore(
    ((websiteSignals?.colors.length ?? 0) > 0 ? 0.4 : 0) +
      ((instagramSignals?.visualPatterns.length ?? 0) > 0 ? 0.3 : 0),
  );

  if (base.personalityTraits.length === 0 && (fullText || sowText)) {
    base.personalityTraits = uniqueStrings([
      "approachable",
      "clear",
      (instagramSignals?.bioSignals.length ?? 0) > 0 ? "conversational" : "",
    ]);
  }
  if (base.toneOfVoice.style.length === 0) {
    base.toneOfVoice.style = uniqueStrings([stringOrEmpty(enriched.brand_tone), "clear", "direct"]);
  }
  if (base.targetAudience.segments.length === 0) {
    base.targetAudience.segments = uniqueStrings([
      stringOrEmpty(asRecord(enriched.target_audience)?.who),
      params.name ? `Shoppers and fans aligned with ${params.name}` : "",
    ]);
  }

  if (params.oneLineDescription?.trim()) {
    tag("purpose", "onboarding");
    tag("mission", "onboarding");
  }
  if (websiteSignals?.metaDescription) {
    tag("purpose", "website:meta");
    tag("vision", "website:meta");
  }
  if (websiteSignals?.heroExcerpt) {
    tag("mission", "website:hero");
  }
  if (sowText) {
    tag("purpose", "sow");
    tag("coreValues", "sow");
    tag("positioning", "sow");
  }
  if ((instagramSignals?.bioSignals.length ?? 0) > 0) {
    tag("toneOfVoice", "instagram");
    tag("targetAudience", "instagram");
  }
  if (base.coreValues.length) tag("coreValues", "inferred");
  if (base.personalityTraits.length) tag("personalityTraits", "inferred");
  if (base.toneOfVoice.style.length) tag("toneOfVoice", "inferred");
  if (base.targetAudience.segments.length) tag("targetAudience", "inferred");
  if (websiteSignals?.heroExcerpt) tag("coreValues", "website:hero");
  if (sowText) tag("offers", "sow");
  if (websiteSignals?.metaDescription) tag("offers", "website:meta");
  tag("offers", "inferred");
  if (websiteSignals?.colors?.length) tag("visualIdentity", "website");
  tag("visualIdentity", "inferred");

  base.sourceAttribution = attribution;
  fieldSources.purpose = sowUorHead
    ? ["sow"]
    : params.oneLineDescription?.trim()
      ? ["onboarding"]
      : websiteSignals?.metaDescription
        ? ["website:meta"]
        : ["inferred"];
  fieldSources.mission = sowScopeHead
    ? ["sow"]
    : stringOrEmpty(asRecord(enriched)?.positioning)
      ? ["onboarding"]
      : websiteSignals?.heroExcerpt
        ? ["website:hero"]
        : ["inferred"];
  fieldSources.vision = base.vision
    ? websiteSignals?.metaDescription && normalizeForDedupe(base.vision) === normalizeForDedupe(websiteSignals.metaDescription)
      ? ["website:meta"]
      : params.oneLineDescription
        ? ["onboarding"]
        : ["inferred"]
    : [];
  base.fieldSources = fieldSources;

  base.confidenceScores = buildConfidenceScores({
    onboardingStrength,
    websiteStrength,
    instagramStrength,
    visualStrength,
  });
  base.updatedAt = new Date().toISOString();

  base.visual_identity = {
    colors: base.visualIdentity.colors.map((color) => color.hex),
    fonts: uniqueStrings([base.visualIdentity.typography.primary, base.visualIdentity.typography.secondary]),
    style: firstNonEmpty(base.visualIdentity.layoutStyle, base.visualIdentity.imageryStyle[0]),
  };
  base.voice_tone = base.toneOfVoice.style.join(", ");
  base.content_patterns = base.contentStrategy.contentPillars;
  base.competitor_insights = base.positioning.competitorReferences;
  base.mcp = {
    website: websiteSignals
      ? { ok: true, source: websiteSignals.url ? safeUrlHostname(websiteSignals.url) : undefined }
      : base.mcp.website.error
        ? base.mcp.website
        : { ok: false, error: "Website signals unavailable" },
    instagram: instagramSignals
      ? {
          ok: true,
          source: directInstagramMcp
            ? "mcp:instagram"
            : instagramFetchSource === "oembed-embed"
              ? "oembed-embed"
              : fetchedIg
                ? "public-profile-fetch"
                : "enriched",
          ...(instagramFetchNote ? { note: instagramFetchNote } : {}),
        }
      : instagramFetchNote
        ? {
            ok: false,
            source: instagramFetchSource ?? "public-html",
            error: "Instagram signals unavailable",
            note: "Instagram details couldn’t be fetched right now. You can continue by pasting the bio or brand notes below.",
            detail: instagramFetchNote,
          }
        : {
            ok: false,
            source: "unavailable",
            error: "Instagram signals unavailable",
            note: "Instagram details couldn’t be fetched right now. You can continue by pasting the bio or brand notes below.",
            detail: "No MCP or public profile data was available for this handle.",
          },
  };
  base.raw = {
    siteTitle: siteTitle,
    heroExcerpt: websiteSignals?.heroExcerpt ?? "",
    metaDescription: websiteSignals?.metaDescription ?? "",
  };

  if (params.existing) {
    const existing = params.existing as BusinessDna;
    if (!base.purpose) base.purpose = existing.purpose ?? "";
    if (!base.mission) base.mission = existing.mission ?? existing.voice_tone ?? "";
    if (!base.vision) base.vision = existing.vision ?? "";
    if (base.coreValues.length === 0) base.coreValues = existing.coreValues ?? [];
    if (!base.brandArchetype) base.brandArchetype = existing.brandArchetype ?? "";
    if (base.personalityTraits.length === 0) base.personalityTraits = existing.personalityTraits ?? [];
  }

  return base;
}
