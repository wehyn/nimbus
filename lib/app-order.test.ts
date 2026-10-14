import assert from "node:assert/strict";
import test from "node:test";
import { reorderVisibleAppIds } from "./app-order.ts";

const apps = [
  { id: "first", isVisible: true },
  { id: "hidden", isVisible: false },
  { id: "second", isVisible: true },
  { id: "third", isVisible: true },
];

test("reorders visible apps while preserving hidden app positions", () => {
  assert.deepEqual(reorderVisibleAppIds(apps, "first", "third"), ["second", "hidden", "third", "first"]);
});

test("ignores hidden or missing drag targets", () => {
  assert.equal(reorderVisibleAppIds(apps, "first", "hidden"), null);
  assert.equal(reorderVisibleAppIds(apps, "missing", "second"), null);
});
