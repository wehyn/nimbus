import assert from "node:assert/strict";
import test from "node:test";
import { HISTORY_RETENTION_DAYS, HISTORY_SAMPLE_INTERVAL_MS, normalizeHistoryMinutes, shouldRecordSnapshot } from "./metrics-history.ts";

test("normalizes supported history ranges and clamps invalid values", () => {
  assert.equal(normalizeHistoryMinutes(undefined), 5);
  assert.equal(normalizeHistoryMinutes(null), 5);
  assert.equal(normalizeHistoryMinutes("15"), 15);
  assert.equal(normalizeHistoryMinutes("10080"), 10080);
  assert.equal(normalizeHistoryMinutes("0"), 1);
  assert.equal(normalizeHistoryMinutes("99999"), 10080);
  assert.equal(normalizeHistoryMinutes("not-a-number"), 5);
});

test("only records a snapshot after the sampling interval", () => {
  assert.equal(shouldRecordSnapshot(undefined, 1_000), true);
  assert.equal(shouldRecordSnapshot(1_000, 1_000 + HISTORY_SAMPLE_INTERVAL_MS - 1), false);
  assert.equal(shouldRecordSnapshot(1_000, 1_000 + HISTORY_SAMPLE_INTERVAL_MS), true);
});

test("keeps retention longer than the largest supported chart range", () => {
  assert.ok(HISTORY_RETENTION_DAYS >= 7);
});
