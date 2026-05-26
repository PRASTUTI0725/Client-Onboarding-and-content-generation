import assert from "node:assert/strict";
import { test } from "node:test";
import { validateJtaSemantics } from "./validate.js";

const baseSections = {
  marketNarrative: "Market whitespace for ritual-led wellness.",
  problemGapSolution: "Pain, gap, solve.",
  brandFoundation: "Mission and promise.",
  brandPhilosophy: "Philosophy.",
  audience: "Audience details.",
  emotionalDrivers: "Emotional triggers.",
  platformStrategy: "Instagram for education.",
  kpis: "Track saves and shares weekly.",
  trackingPlan: "Review weekly by platform.",
  executionPhases: "Phase 1 foundation.",
  assetRequirements: "Video and static assets.",
};

const proofConstraints = {
  limitations: "Strong testimonials, UGC, and influencer proof are not confirmed",
  unconfirmedProofTypes: ["testimonials", "ugc", "influencer proof"],
};

test("validateJtaSemantics escalates showcase testimonials and UGC to blocker", () => {
  const result = validateJtaSemantics({
    canonicalSections: {
      ...baseSections,
      contentStrategy: "Showcase customer testimonials and user-generated content across reels and carousels.",
    },
    platforms: ["instagram"],
    proofConstraints,
  });

  const proofIssue = result.issueDetails.find((issue) => issue.category === "unsupported_proof_asset_assumption");
  assert.ok(proofIssue);
  assert.equal(proofIssue?.severity, "blocker");
  assert.equal(result.status, "failed");
});

test("validateJtaSemantics fails share customer testimonials phrasing", () => {
  const result = validateJtaSemantics({
    canonicalSections: {
      ...baseSections,
      contentStrategy: "Share customer testimonials in weekly reels.",
    },
    platforms: ["instagram"],
    proofConstraints,
  });

  const proofIssue = result.issueDetails.find((issue) => issue.category === "unsupported_proof_asset_assumption");
  assert.ok(proofIssue);
  assert.equal(proofIssue?.severity, "blocker");
});

test("validateJtaSemantics fails utilize UGC and influencer partnerships phrasing", () => {
  const result = validateJtaSemantics({
    canonicalSections: {
      ...baseSections,
      contentStrategy: "Utilize user-generated content and influencer partnerships across the content mix.",
    },
    platforms: ["instagram"],
    proofConstraints,
  });

  const proofIssue = result.issueDetails.find((issue) => issue.category === "unsupported_proof_asset_assumption");
  assert.ok(proofIssue);
  assert.equal(proofIssue?.severity, "blocker");
});

test("validateJtaSemantics allows collect testimonials and build UGC pipeline phrasing", () => {
  const result = validateJtaSemantics({
    canonicalSections: {
      ...baseSections,
      contentStrategy: "Collect customer testimonials and build a UGC pipeline through ritual demo prompts.",
    },
    platforms: ["instagram"],
    proofConstraints,
  });

  const proofIssue = result.issueDetails.find((issue) => issue.category === "unsupported_proof_asset_assumption");
  assert.equal(proofIssue, undefined);
});

test("validateJtaSemantics allows source creator trials as future collection", () => {
  const result = validateJtaSemantics({
    canonicalSections: {
      ...baseSections,
      contentStrategy: "Source creator trials and influencer content through a structured outreach pipeline.",
    },
    platforms: ["instagram"],
    proofConstraints,
  });

  const proofIssue = result.issueDetails.find((issue) => issue.category === "unsupported_proof_asset_assumption");
  assert.equal(proofIssue, undefined);
});

test("validateJtaSemantics fails existing-proof influencer framing", () => {
  const result = validateJtaSemantics({
    canonicalSections: {
      ...baseSections,
      contentStrategy: "Leverage influencer partnerships as social proof across reels.",
    },
    platforms: ["instagram"],
    proofConstraints,
  });

  const proofIssue = result.issueDetails.find((issue) => issue.category === "unsupported_proof_asset_assumption");
  assert.ok(proofIssue);
  assert.equal(proofIssue?.severity, "blocker");
});

test("validateJtaSemantics does not excuse definitive proof in one section via build language in another", () => {
  const result = validateJtaSemantics({
    canonicalSections: {
      ...baseSections,
      contentStrategy: "Showcase customer testimonials in hero reels.",
      assetRequirements: "Collect first-party ritual demos over time.",
    },
    platforms: ["instagram"],
    proofConstraints,
  });

  const proofIssue = result.issueDetails.find((issue) => issue.category === "unsupported_proof_asset_assumption");
  assert.ok(proofIssue);
  assert.equal(proofIssue?.severity, "blocker");
  assert.ok(proofIssue?.fields.includes("canonicalSections.contentStrategy"));
});

test("validateJtaSemantics allows proof-building language when limitations documented", () => {
  const result = validateJtaSemantics({
    canonicalSections: {
      ...baseSections,
      contentStrategy:
        "Build proof through founder-led education and collect UGC over time while reels explain daily ritual use.",
    },
    platforms: ["instagram"],
    proofConstraints: {
      limitations: "UGC not confirmed",
      unconfirmedProofTypes: ["ugc"],
    },
  });

  const proofIssue = result.issueDetails.find((issue) => issue.category === "unsupported_proof_asset_assumption");
  assert.equal(proofIssue, undefined);
});

test("validateJtaSemantics treats proofGaps as documented proof limits", () => {
  const result = validateJtaSemantics({
    canonicalSections: {
      ...baseSections,
      contentStrategy: "Share customer testimonials across carousels.",
    },
    platforms: ["instagram"],
    proofGaps: ["Customer testimonials not confirmed"],
  });

  const proofIssue = result.issueDetails.find((issue) => issue.category === "unsupported_proof_asset_assumption");
  assert.ok(proofIssue);
  assert.equal(proofIssue?.severity, "blocker");
});
