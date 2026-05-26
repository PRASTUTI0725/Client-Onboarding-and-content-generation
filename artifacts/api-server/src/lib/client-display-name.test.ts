import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveClientFacingBrandName, sanitizeClientFacingText } from "./client-display-name.js";

test("resolveClientFacingBrandName strips internal CRM suffixes from Svara", () => {
  assert.equal(
    resolveClientFacingBrandName("Svara (client) 1", {
      oneLineDescription: "Svara is India's first wellness perfume brand",
    }),
    "Svara",
  );
});

test("resolveClientFacingBrandName strips internal CRM suffixes from Nike", () => {
  assert.equal(resolveClientFacingBrandName("Nike (client) 2"), "Nike");
});

test("resolveClientFacingBrandName does not extract sentence fragments from one-line description", () => {
  assert.equal(
    resolveClientFacingBrandName("", {
      oneLineDescription: "Brand is India's first wellness perfume for modern rituals",
    }),
    "Brand",
  );
  assert.notEqual(
    resolveClientFacingBrandName("", {
      oneLineDescription: "Brand is India's first wellness perfume for modern rituals",
    }),
    "Brand is India's",
  );
});

test("resolveClientFacingBrandName prefers cleaned raw name over description extraction", () => {
  assert.equal(
    resolveClientFacingBrandName("Svara (client) 1", {
      oneLineDescription: "Svara is India's first wellness perfume brand",
    }),
    "Svara",
  );
});

test("resolveClientFacingBrandName leaves normal names unchanged", () => {
  assert.equal(resolveClientFacingBrandName("Acme Studio"), "Acme Studio");
});

test("sanitizeClientFacingText replaces raw internal label with resolved brand", () => {
  const text = "Svara (client) 1 should lead with ritual education.";
  const sanitized = sanitizeClientFacingText(text, "Svara (client) 1", "Svara");
  assert.equal(sanitized, "Svara should lead with ritual education.");
});

test("sanitizeClientFacingText repairs sentence-fragment brand leaks", () => {
  const text = "Svara is India's is poised to lead ritual education. At Svara is India's core audience.";
  const sanitized = sanitizeClientFacingText(text, "Svara (client) 1", "Svara");
  assert.match(sanitized, /^Svara is poised/);
  assert.match(sanitized, /At Svara,/);
});
