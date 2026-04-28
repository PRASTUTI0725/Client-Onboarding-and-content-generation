/* Run: pnpm exec dotenv -e artifacts/api-server/.env.local -- node scripts/smoke-e2e.mjs */

const API = "http://127.0.0.1:3001/api";
const KEY = process.env.LOCAL_API_KEY || "sk-content-calendar-test-2026";
const h = { "x-api-key": KEY, "content-type": "application/json" };

const SOW = {
  understandingOfRequirements:
    "Svara: premium alcohol-free oil-based fragrance for daily pulse points; India market; audience wants skin-safe luxury scent.",
  scopeOfWork:
    "End-to-end Instagram-led content, monthly calendar, Reels and carousels, performance reporting, DM response framework.",
  pricingOptions: "",
  timeline: "",
  paymentTerms: "",
  nextSteps: "",
  approval: { approved: true },
  platforms: ["Instagram"],
  monthlyPosts: { Instagram: 16 },
  contentMix: { education: 6, thought_leadership: 5, social_proof: 3, promotion: 2 },
  deliverables: ["Reels", "Carousels"],
  toneByPlatform: { Instagram: "Premium, skin-kind, sensorial" },
};

const keys12 = [
  "marketNarrative",
  "problemGapSolution",
  "brandFoundation",
  "brandPhilosophy",
  "audience",
  "emotionalDrivers",
  "platformStrategy",
  "contentStrategy",
  "kpis",
  "trackingPlan",
  "executionPhases",
  "assetRequirements",
];

async function j(url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { ...h, ...opt.headers } });
  const t = await r.text();
  let data;
  try {
    data = t ? JSON.parse(t) : null;
  } catch {
    data = t;
  }
  return { r, data, t };
}

const report = {
  dbWrites: "unknown",
  websiteOk: false,
  instagramMcp: false,
  dnaFieldsPopulated: 0,
  strategyReal: "unknown",
  templateMarkers: [] ,
  postContext: "unknown",
};

// 1) Create client
const create = await j(`${API}/clients`, {
  method: "POST",
  body: JSON.stringify({
    name: "E2E Svara Smoke",
    websiteUrl: "https://svaraonline.in",
    instagramHandle: "@svara_online",
    oneLineDescription:
      "Svara alcohol-free oil-based wellness perfume, gentle for sensitive skin, made in India.",
  }),
});
if (create.r.status !== 201) {
  console.log(JSON.stringify({ step: "create", status: create.r.status, data: create.data }, null, 2));
  process.exit(1);
}
const clientId = create.data.id;
console.log("clientId", clientId);

// 2) SOW
const sow = await j(`${API}/clients/${clientId}/sow`, { method: "PUT", body: JSON.stringify(SOW) });
if (sow.r.status !== 200) {
  console.log("sow fail", sow.r.status, sow.t?.slice(0, 500));
  process.exit(1);
}

// 3) Strategy
const stratHeaders = {
  "x-use-real-ai": "true",
  "x-ai-provider": "openrouter",
};
const gen = await j(`${API}/clients/${clientId}/strategy/generate`, {
  method: "POST",
  headers: stratHeaders,
  body: JSON.stringify({ templateType: "d2c_growth" }),
});
const src = gen.r.headers.get("x-strategy-source");
console.log("strategy status", gen.r.status, "x-strategy-source", src);
if (gen.r.status !== 200) {
  console.log(gen.t?.slice(0, 2000));
  process.exit(1);
}
if (src === "fallback") {
  report.strategyReal = "fallback";
} else {
  report.strategyReal = "real";
}

const doc = (gen.data?.strategyDocument ?? gen.data) || "";
const structured = gen.data?.structuredStrategy ?? gen.data;
const textBlob = JSON.stringify(structured) + (typeof doc === "string" ? doc : "");
if (/demo|fallback|unavailable|placeholder/i.test(textBlob) && !/Svara|svara|alcohol|pulse/i.test(textBlob)) {
  report.templateMarkers.push("suspicious-generic");
}
if (/Svara|svaraonline|alcohol|pulse|India/i.test(textBlob)) {
  report.postContext = "client-specific";
} else {
  report.postContext = "weak";
}

// 4) Approve all sections
const meta = (structured?.__meta ?? {}) ;
const sa = { ...(meta.sectionApprovals || {}) };
for (const k of keys12) sa[k] = true;
const patch = await j(`${API}/clients/${clientId}/strategy`, {
  method: "PATCH",
  body: JSON.stringify({
    structuredStrategy: { ...structured, __meta: { ...meta, sectionApprovals: sa } },
  }),
});
if (patch.r.status !== 200) {
  console.log("patch fail", patch.r.status, patch.t?.slice(0, 500));
  process.exit(1);
}

// 5) Calendar
const cal = await j(`${API}/clients/${clientId}/calendar/generate`, {
  method: "POST",
  body: JSON.stringify({
    month: "May 2026",
    startDate: "2026-05-01",
    goal: "awareness and consideration",
  }),
});
console.log("calendar", cal.r.status);
if (cal.r.status !== 200) {
  console.log(cal.t?.slice(0, 2000));
  process.exit(1);
}
const posts = cal.data?.posts ?? [];
const p0 = posts[0] || {};
const pjson = JSON.stringify(p0);
if (/Svara|svara|alcohol|fragrance|skin/i.test(pjson)) {
  report.postContext = "client-specific";
}

// 6) GET client + onboarding
const g = await j(`${API}/clients/${clientId}`);
const ed = g.data?.onboarding?.enrichedData;
const bdna = ed?.businessDna;
if (bdna) {
  const flat = JSON.stringify(bdna);
  report.dnaFieldsPopulated = Object.keys(bdna).length;
  report.websiteOk = bdna.mcp?.website?.ok === true;
  report.instagramMcp = bdna.mcp?.instagram?.ok === true;
}

console.log("---REPORT---");
console.log(
  JSON.stringify(
    {
      clientId,
      strategySource: src,
      postSampleHook: p0.hook,
      businessDnaMcp: bdna?.mcp,
      dnaTopLevelKeys: bdna ? Object.keys(bdna).length : 0,
      hasPurpose: Boolean(bdna?.purpose),
    },
    null,
    2,
  ),
);
