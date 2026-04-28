import {
  STRATEGY_V1_OPTIONAL_PLACEHOLDERS,
  STRATEGY_V1_REQUIRED_PLACEHOLDERS,
  injectPromptVariables,
  loadPromptTemplate,
  mapStrategyV1PromptVariables,
  type StrategyPromptVariableInput,
} from "./template.js";

async function run(): Promise<void> {
  const dummy: StrategyPromptVariableInput = {
    client: {
      name: "Svara Naturals",
      website: "https://svaranaturals.com",
      instagramHandle: "@svaranaturals",
      oneLineDescription: "Ayurvedic D2C skincare for sensitive skin.",
      sow: {
        industry: "D2C skincare",
        scopeOfWork: "Monthly strategy, content planning, captions, and calendar operations.",
        platforms: ["instagram"],
        monthlyPosts: { instagram: 20 },
        contentMix: { education: 40, proof: 30, conversion: 30 },
        toneByPlatform: { instagram: "warm, expert, trustworthy" },
        deliverables: ["Founder videos", "Design support", "Monthly content ops"],
        targetAudience: "Women 24-40 with sensitive skin concerns",
        normalizedSections: {
          businessGoals:
            "Increase qualified profile visits and conversion intent while improving repeat purchase behavior.",
        },
      },
    },
    onboarding: {
      enrichedData: {
        websiteSummary:
          "Ayurvedic skincare brand focused on sensitive skin routines with trust-led education.",
        businessDna: {
          narrative: "Trust-led education with ingredient clarity.",
          positioning: "Sensitive-skin authority with practical routines.",
        },
      },
      rawInput: {
        keyBusinessObjectives: "Grow trust and convert high-intent users into repeat buyers.",
      },
    },
    strategy: {
      structuredStrategy: {
        __summary: {
          strategy: "Build authority then convert through proof-led content.",
          pillarPriorities: ["education", "proof", "conversion"],
          monthlyGoals: ["improve saves/share rate", "increase profile CTR", "raise qualified DMs"],
        },
      },
    },
  };

  const variables = mapStrategyV1PromptVariables(dummy);
  const template = await loadPromptTemplate("strategy/v1-full");
  const injected = injectPromptVariables(template, variables, {
    requiredKeys: [...STRATEGY_V1_REQUIRED_PLACEHOLDERS],
    optionalKeys: [...STRATEGY_V1_OPTIONAL_PLACEHOLDERS],
  });

  const unresolved = injected.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) ?? [];
  const preview = injected.slice(0, 500);
  console.log("Svara sanity: OK");
  console.log(`Unresolved placeholders: ${unresolved.length}`);
  console.log(`Contains client name: ${String(injected.includes("Svara Naturals"))}`);
  console.log(`Contains industry: ${String(injected.includes("D2C skincare"))}`);
  console.log(`Contains audience: ${String(injected.includes("Women 24-40 with sensitive skin concerns"))}`);
  console.log("Preview:");
  console.log(preview);
}

run().catch((err) => {
  console.error("Svara sanity: FAILED");
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
