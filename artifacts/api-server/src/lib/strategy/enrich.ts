import { openai } from "../openaiClient.js";

export interface RawInput {
  name: string;
  websiteUrl: string;
  instagramHandle: string;
  oneLineDescription: string;
}

export interface EnrichedData {
  brand_name: string;
  offer: string;
  price_range: string;
  business_model: string;
  target_audience: { who: string; age_range: string; stage: string };
  brand_tone: string;
  positioning: string;
  platform: string;
  content_preference: string;
  competitors: string[];
}

const ENRICH_SYSTEM = `You are a senior brand strategist. From minimal input about a business, infer a rich, plausible, specific brand profile.

Rules:
- Be concrete and specific. No generic marketing filler. No empty platitudes.
- Where information is unstated, infer the most likely answer based on the website domain, Instagram handle, and one-line description. Mark uncertain inferences as your best educated guess.
- Always return valid JSON matching the schema.
- Competitors: name 3-5 real or plausibly real competitors in this category.
- target_audience.stage: one of "early-stage", "growth-stage", "established", "scaling".
- price_range: use a clear band (e.g. "$80-$250 per piece", "$15-$40 per item", "$2,500-$10,000 per engagement").
- business_model: one of "D2C ecommerce", "B2B services", "B2B SaaS", "Marketplace", "Personal brand / creator", "Hybrid retail", "Subscription".
- platform: the single primary acquisition platform (e.g. "Instagram", "TikTok", "Google Search", "LinkedIn", "Email + Referral").`;

export async function enrich(raw: RawInput): Promise<EnrichedData> {
  const userPrompt = `Business name: ${raw.name}
Website: ${raw.websiteUrl}
Instagram: ${raw.instagramHandle}
One-line description: ${raw.oneLineDescription}

Return JSON with exactly these keys: brand_name, offer, price_range, business_model, target_audience (object with who, age_range, stage), brand_tone, positioning, platform, content_preference, competitors (array of strings).`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: ENRICH_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as Partial<EnrichedData>;

  return {
    brand_name: parsed.brand_name ?? raw.name,
    offer: parsed.offer ?? "",
    price_range: parsed.price_range ?? "",
    business_model: parsed.business_model ?? "",
    target_audience: {
      who: parsed.target_audience?.who ?? "",
      age_range: parsed.target_audience?.age_range ?? "",
      stage: parsed.target_audience?.stage ?? "",
    },
    brand_tone: parsed.brand_tone ?? "",
    positioning: parsed.positioning ?? "",
    platform: parsed.platform ?? "",
    content_preference: parsed.content_preference ?? "",
    competitors: Array.isArray(parsed.competitors) ? parsed.competitors : [],
  };
}
