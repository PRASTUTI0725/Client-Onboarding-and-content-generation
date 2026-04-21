export type TemplateType =
  | "performance_marketing"
  | "brand_building"
  | "personal_brand"
  | "d2c_growth";

export interface TemplateConfig {
  name: string;
  toneGuidance: string;
  emphasis: string;
  kpiFocus: string;
  contentStyle: string;
}

export const TEMPLATES: Record<TemplateType, TemplateConfig> = {
  performance_marketing: {
    name: "Performance Marketing",
    toneGuidance:
      "Direct, metrics-driven, and accountable. Speak in terms of CAC, LTV, ROAS, conversion paths.",
    emphasis:
      "Optimize for measurable customer acquisition. Channel economics, funnel design, creative testing velocity, and incremental measurement.",
    kpiFocus:
      "ROAS, CAC, LTV:CAC ratio, conversion rate, cost per lead, payback period, channel-level attribution.",
    contentStyle:
      "High-velocity creative testing across paid social and search. Hook-led short-form video, strong on-page proof, retargeting sequences.",
  },
  brand_building: {
    name: "Brand Building",
    toneGuidance:
      "Considered, editorial, narrative-led. Speak in terms of category, meaning, and long-term equity.",
    emphasis:
      "Build distinctive brand assets and category meaning. Positioning, narrative arc, owned channels, and earned attention compound over time.",
    kpiFocus:
      "Aided/unaided awareness, branded search lift, share of voice, sentiment, organic traffic growth, repeat engagement.",
    contentStyle:
      "Editorial long-form, signature visual identity, founder/POV-led storytelling, community-building rituals, considered launches.",
  },
  personal_brand: {
    name: "Personal Brand",
    toneGuidance:
      "Personal, candid, point-of-view-driven. Speak as the founder/creator in first person where natural.",
    emphasis:
      "Build trust and authority around a single human. Voice, point of view, consistency of presence, and the audience's parasocial relationship are the core assets.",
    kpiFocus:
      "Follower growth on primary platform, save/share ratio, DM/inbound lead volume, newsletter subs, podcast listens, talk/booking inquiries.",
    contentStyle:
      "Consistent talking-head or carousel cadence, behind-the-scenes, opinionated takes, weekly newsletter, repurposed long-form into short-form.",
  },
  d2c_growth: {
    name: "D2C Growth",
    toneGuidance:
      "Operator-minded, product-aware, channel-savvy. Speak in terms of AOV, cohort behavior, and merchandising.",
    emphasis:
      "Drive efficient first-purchase acquisition and engineered repeat. Product-market-channel fit, creator-led demand, owned-channel retention, and merchandising rhythm.",
    kpiFocus:
      "ROAS, blended CAC, AOV, repeat rate, 60/90-day LTV, contribution margin, list growth, email/SMS revenue share.",
    contentStyle:
      "UGC and creator-led short-form, founder narrative, product-in-use content, hero/launch moments, lifecycle email/SMS flows.",
  },
};

export function selectTemplate(
  enriched: Record<string, unknown>,
  override?: string | null,
): TemplateType {
  if (override && override !== "auto" && override in TEMPLATES) {
    return override as TemplateType;
  }
  const businessModel = String(enriched["business_model"] ?? "").toLowerCase();
  const positioning = String(enriched["positioning"] ?? "").toLowerCase();
  const brandTone = String(enriched["brand_tone"] ?? "").toLowerCase();

  if (
    positioning.includes("personal brand") ||
    brandTone.includes("founder-led") ||
    businessModel.includes("creator") ||
    businessModel.includes("personal")
  ) {
    return "personal_brand";
  }
  if (businessModel.includes("d2c") || businessModel.includes("dtc") || businessModel.includes("ecommerce")) {
    return "d2c_growth";
  }
  if (businessModel.includes("performance") || businessModel.includes("lead-gen")) {
    return "performance_marketing";
  }
  return "brand_building";
}
