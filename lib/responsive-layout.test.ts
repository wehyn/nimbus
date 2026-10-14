import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stylesheet = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

function narrowBreakpoint() {
  const match = stylesheet.match(/@media \(max-width: 420px\)\s*\{([\s\S]*?)\n\}/);
  return match?.[1] || "";
}

test("stacks Web UI protocol and port fields below the narrow phone breakpoint", () => {
  assert.match(narrowBreakpoint(), /\.web-ui-fields\s*\{\s*grid-template-columns:\s*1fr;\s*\}/);
});

test("keeps the Web UI host above the stacked protocol and port fields", () => {
  assert.match(narrowBreakpoint(), /\.web-ui-host\s*\{\s*grid-column:\s*1;\s*grid-row:\s*1;\s*\}/);
});

test("keeps the mobile launcher header below the iOS top safe area", () => {
  assert.ok(/\.launcher-bar\s*\{\s*height:\s*calc\(54px \+ env\(safe-area-inset-top, 0px\)\);\s*padding:\s*0 15px;\s*padding-top:\s*env\(safe-area-inset-top, 0px\);/.test(stylesheet), "mobile launcher header must include iOS top safe-area padding");
});
