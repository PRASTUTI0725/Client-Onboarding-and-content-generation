import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeTruncatedJson } from "./json-log.js";

test("looksLikeTruncatedJson detects unclosed object", () => {
  assert.equal(looksLikeTruncatedJson('{"purpose":"test","mission":"'), true);
  assert.equal(looksLikeTruncatedJson('{"purpose":"complete"}'), false);
});
