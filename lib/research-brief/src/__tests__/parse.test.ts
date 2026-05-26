import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildApplyPayload,
  buildImportPreview,
  isUnreliableImportValue,
  matchFieldDef,
  normalizeFieldHeading,
  parseResearchBriefMarkdown,
  resolveImportAction,
} from "@workspace/research-brief";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "../../../../tests/fixtures/svara-research-brief.md");
const apifyFixturePath = join(__dirname, "../../../../tests/fixtures/svara-apify-research-brief.md");
const svaraBrief = readFileSync(fixturePath, "utf8");
const apifyBrief = readFileSync(apifyFixturePath, "utf8");

test("parses full Svara brief with mapped fields", () => {
  const parsed = parseResearchBriefMarkdown(svaraBrief);
  assert.equal(parsed.errors.length, 0);
  assert.ok(parsed.parseMeta.mappedFieldCount >= 30);
  assert.ok(parsed.fields.some((f) => f.canonicalFieldId === "client.name"));
  assert.ok(parsed.fields.some((f) => f.canonicalFieldId === "sow.industry"));
  assert.ok(parsed.fields.some((f) => f.canonicalFieldId === "instagram.bio"));
  assert.ok(parsed.fields.some((f) => f.canonicalFieldId === "research.offer.pricingSignals"));
  assert.ok(parsed.fields.some((f) => f.canonicalFieldId === "claim.claimsToAvoid"));
  assert.ok(parsed.fields.some((f) => f.canonicalFieldId === "preserve.sourceProvenance"));
});

test("detects inferred confidence from offer pricing", () => {
  const parsed = parseResearchBriefMarkdown(svaraBrief);
  const pricing = parsed.fields.find((f) => f.canonicalFieldId === "research.offer.pricingSignals");
  assert.ok(pricing);
  assert.equal(pricing?.confidence, "inferred");
});

test("flags unstructured text without headings", () => {
  const parsed = parseResearchBriefMarkdown("This is just a paragraph with no headings at all.");
  assert.ok(parsed.errors.some((e) => e.includes("No Markdown headings")));
});

test("overwrite scenario marks will_update", () => {
  const parsed = parseResearchBriefMarkdown(svaraBrief);
  const preview = buildImportPreview({
    parsed,
    rawMarkdown: svaraBrief,
    existing: { industry: "Existing industry value" },
  });
  const industryRow = preview.rows.find((r) => r.id === "sow.industry");
  assert.ok(industryRow);
  assert.equal(industryRow?.status, "will_update");
  assert.equal(industryRow?.selected, false);
});

test("resolveImportAction behaves safely", () => {
  assert.equal(resolveImportAction("", "new"), "will_fill");
  assert.equal(resolveImportAction("same", "same"), "skipped");
  assert.equal(resolveImportAction("old", "new"), "will_update");
});

test("buildApplyPayload applies selected rows only", () => {
  const parsed = parseResearchBriefMarkdown(svaraBrief);
  const preview = buildImportPreview({ parsed, rawMarkdown: svaraBrief, existing: {} });
  const selected = new Set(preview.rows.filter((r) => r.selected).map((r) => r.id));
  const payload = buildApplyPayload(preview, selected);
  assert.equal(payload.clientBasics?.name, "Svara Naturals");
  assert.ok(payload.sow?.industry);
  assert.ok(payload.instagram?.bio);
  assert.ok(payload.importedResearchBrief.claimSafetyNotes?.claimsToAvoid);
});

test("missing instagram bio in partial brief still parses", () => {
  const partial = svaraBrief.replace(/### Profile bio[\s\S]*?(?=### Profile category)/, "");
  const parsed = parseResearchBriefMarkdown(partial);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.fields.some((f) => f.canonicalFieldId === "instagram.bio"), false);
});

test("normalizeFieldHeading collapses slashes and strips source suffixes", () => {
  assert.equal(
    normalizeFieldHeading("Proof / trust signals from Instagram"),
    "proof/trust signals",
  );
  assert.equal(
    normalizeFieldHeading("Goals and requirements from SOW"),
    "goals and requirements",
  );
  assert.equal(
    normalizeFieldHeading("Important website pages / links"),
    "important website pages/links",
  );
});

test("matchFieldDef maps Apify SOW suffix headings in sow_summary section", () => {
  const goals = matchFieldDef("Goals and requirements from SOW", "sow_summary");
  assert.equal(goals?.id, "sow.understandingOfRequirements");

  const strategy = matchFieldDef("Strategy and launch plan from SOW", "sow_summary");
  assert.equal(strategy?.id, "sow.strategyLaunchPlanning");

  const content = matchFieldDef("Content deliverables from SOW", "sow_summary");
  assert.equal(content?.id, "sow.contentCreation");

  const fullNotes = matchFieldDef("Full SOW notes from SOW", "sow_summary");
  assert.equal(fullNotes?.id, "sow.contentCreation");

  const deliverables = matchFieldDef("Deliverables summary from SOW", "sow_summary");
  assert.equal(deliverables?.id, "sow.deliverables");
});

test("matchFieldDef maps Apify Instagram slash and suffix headings", () => {
  const offer = matchFieldDef("What they sell / offer from Instagram", "instagram_context");
  assert.equal(offer?.id, "instagram.offerSummary");

  const proof = matchFieldDef("Proof / trust signals from Instagram", "instagram_context");
  assert.equal(proof?.id, "instagram.proofSignals");

  const websiteProof = matchFieldDef("Proof / trust signals from Instagram", "website_context");
  assert.notEqual(websiteProof?.id, "instagram.proofSignals");
});

test("parses Apify-style Svara brief with previously missing fields", () => {
  const parsed = parseResearchBriefMarkdown(apifyBrief);
  assert.equal(parsed.errors.length, 0);

  const fieldIds = parsed.fields.map((f) => f.canonicalFieldId);
  assert.ok(fieldIds.includes("sow.understandingOfRequirements"));
  assert.ok(fieldIds.includes("sow.strategyLaunchPlanning"));
  assert.ok(fieldIds.includes("sow.contentCreation"));
  assert.ok(fieldIds.includes("sow.deliverables"));
  assert.ok(fieldIds.includes("instagram.offerSummary"));
  assert.ok(fieldIds.includes("instagram.proofSignals"));
  assert.ok(fieldIds.includes("website.importantPages"));
  assert.equal(fieldIds.includes("instagram.category"), false);
});

test("Apify profile category placeholder reroutes to additional Instagram notes", () => {
  const parsed = parseResearchBriefMarkdown(apifyBrief);
  const noteField = parsed.fields.find((f) => f.canonicalFieldId === "instagram.additionalInstagramNotes");
  assert.ok(noteField);
  assert.match(String(noteField?.value), /Profile category \(import note\)/i);
  assert.match(String(noteField?.value), /not returned by apify/i);
});

test("unreliable import values are skipped in preview", () => {
  const parsed = parseResearchBriefMarkdown(apifyBrief);
  const preview = buildImportPreview({ parsed, rawMarkdown: apifyBrief, existing: {} });
  const proofRow = preview.rows.find((r) => r.id === "instagram.proofSignals");
  assert.ok(proofRow);
  assert.equal(proofRow?.status, "skipped");
  assert.equal(proofRow?.selected, false);
  assert.match(proofRow?.warning ?? "", /Low-confidence value/i);
});

test("isUnreliableImportValue detects low-confidence phrases", () => {
  assert.equal(isUnreliableImportValue("Not confirmed: verified badge"), true);
  assert.equal(isUnreliableImportValue("Customer UGC reposts"), false);
});

test("Apify brief apply payload fills SOW and Instagram targets", () => {
  const parsed = parseResearchBriefMarkdown(apifyBrief);
  const preview = buildImportPreview({ parsed, rawMarkdown: apifyBrief, existing: {} });
  const selected = new Set(
    preview.rows.filter((r) => r.selected || r.status === "will_fill").map((r) => r.id),
  );
  selected.add("instagram.proofSignals");
  const payload = buildApplyPayload(preview, selected);
  assert.ok(payload.sow?.understandingOfRequirements);
  assert.ok(payload.sow?.strategyLaunchPlanning);
  assert.ok(payload.sow?.deliverables?.length);
  assert.ok(payload.instagram?.offerSummary);
  assert.ok(payload.importedResearchBrief.websiteContext?.importantPages);
});
