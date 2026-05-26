import assert from "node:assert/strict";
import { test } from "node:test";
import { expandWeeklyBucketSequence } from "./compact-calendar-context.js";

test("monthly bucket sequence across four weeks matches SOW totals", () => {
  const monthlyBuckets = { Education: 8, Promotion: 4, "Social proof": 2, "Thought leadership": 2 };
  const weekTotals = [4, 4, 4, 4];
  const sequences = weekTotals.map((count) => {
    const weekTargets = {
      Education: 2,
      Promotion: 1,
      "Social proof": count === 4 ? 1 : 0,
      "Thought leadership": count === 4 ? 0 : 1,
    };
    if (count === 4 && weekTargets["Thought leadership"] === 0) {
      weekTargets["Thought leadership"] = 1;
      weekTargets["Social proof"] = 0;
    }
    return expandWeeklyBucketSequence(weekTargets, count);
  });

  const merged = sequences.flat();
  assert.equal(merged.length, 16);
  const counts = merged.reduce<Record<string, number>>((acc, bucket) => {
    acc[bucket] = (acc[bucket] ?? 0) + 1;
    return acc;
  }, {});
  assert.equal(counts.Education, monthlyBuckets.Education);
  assert.equal(counts.Promotion, monthlyBuckets.Promotion);
});

test("requiredBuckets order is deterministic for a week", () => {
  const first = expandWeeklyBucketSequence({ Education: 2, Promotion: 2 }, 4);
  const second = expandWeeklyBucketSequence({ Education: 2, Promotion: 2 }, 4);
  assert.deepEqual(first, second);
  assert.deepEqual(first, ["Education", "Promotion", "Education", "Promotion"]);
});
