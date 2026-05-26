import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProofConstraintsFromResearchContext,
  compactImportedResearchForJta,
} from "./compact-research-context.js";

test("compactImportedResearchForJta extracts claim safety and proof gaps", () => {
  const context = compactImportedResearchForJta({
    version: 1,
    rawMarkdownHash: "abc",
    importedAt: new Date().toISOString(),
    claimSafetyNotes: {
      claimsToAvoid: "Do not claim clinical sleep cures",
      proofLimitations: "Strong testimonials and UGC are not confirmed",
    },
    missingInformation: [
      "Customer testimonials not confirmed",
      "Shipping policy unclear",
      "UGC library not available",
    ],
    websiteContext: {
      brandPositioning: "Ritual-first wellness brand",
      primaryProducts: "Magnesium body mists",
    },
    researchInputs: {
      positioning: { valueProposition: "Shop your calm" },
      offer: { primaryOffers: "Daily ritual sprays" },
    },
  });

  assert.ok(context);
  assert.equal(context?.claimSafety?.claimsToAvoid, "Do not claim clinical sleep cures");
  assert.ok((context?.proofGaps?.length ?? 0) >= 2);
  assert.equal(context?.websiteSignals?.brandPositioning, "Ritual-first wellness brand");
  assert.equal(context?.researchHighlights?.positioning, "Shop your calm");
});

test("compactImportedResearchForJta omits redundant research highlights", () => {
  const knownBlob = "shop your calm ritual-first wellness brand";
  const context = compactImportedResearchForJta(
    {
      version: 1,
      rawMarkdownHash: "abc",
      importedAt: new Date().toISOString(),
      researchInputs: {
        positioning: { valueProposition: "Shop your calm" },
      },
    },
    { knownTextBlob: knownBlob },
  );

  assert.equal(context?.researchHighlights?.positioning, undefined);
});

test("buildProofConstraintsFromResearchContext infers unconfirmed proof types", () => {
  const constraints = buildProofConstraintsFromResearchContext({
    claimSafety: { proofLimitations: "No confirmed testimonials or UGC" },
    proofGaps: ["Customer reviews not confirmed"],
  });
  assert.ok(constraints);
  assert.ok(constraints?.limitations?.includes("No confirmed testimonials"));
  assert.ok(constraints?.unconfirmedProofTypes?.includes("testimonials"));
  assert.ok(constraints?.unconfirmedProofTypes?.includes("ugc"));
});
