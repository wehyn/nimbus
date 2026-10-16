# Nimbus Dashboard Performance Implementation Plan

> **For implementers:** Follow repository instructions and the execution method agreed with the user. Steps use checkbox syntax for tracking.

**Goal:** Measure first-load and large-list work, keep only changes that improve a user path, and preserve app data and accessible interactions.

**Architecture:** Test deferred panel loading and browser-native `content-visibility` on launcher tiles, settings rows, and process rows. The panel split and all three CSS trials failed their performance gates and were reverted. The retained change removes per-tile entrance motion after repeatable desktop grid-scroll improvement.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, CSS content-visibility, Playwright, T3 Chromium preview, SQLite through a temporary DATABASE_PATH fixture.

**Spec:** docs/superpowers/specs/2026-10-15-dashboard-performance-design.md

## Global Constraints

- Preserve modal focus, Escape, `aria-modal` semantics, focus restoration, body overflow, reduced motion, and existing data-loading/retry states.
- Keep every launcher, settings, and process row in the DOM and accessibility tree. Do not cap, virtualize, filter, or reorder data as part of this work.
- Do not change API payloads, SQLite schema/data, health and overview cadence, metric retention/ranges, service-worker policy, or dependencies.
- Use temporary app/history data and a local process fixture for benchmarks. Never use the default or production DATABASE_PATH.
- Compare each change in a production build assembled like the Docker runtime. Report repeated measurements, not CI timing thresholds or FPS inferred from the preview's variable frame clock.
- Keep Next dev, browser suites, and production builds serial because they share .next/. Stop any next dev server before npm run build.

## Review Focus

1. **Panel open and close behavior regresses:** verify loaded management and KPI dialogs, Escape, Tab trapping, and focus return after the exit animation.
2. **Long-list layout or accessibility regresses:** keep every app, settings, and process row available and verify stable scroll height.
3. **Intrinsic-size estimates shift content:** scrolling must not drop or duplicate rows or cause unstable list height. Cover in Tasks 2–4.
4. **Framer Motion drag/drop or keyboard reordering breaks:** reuse existing grid/dock interaction tests in Task 2.
5. **Offscreen rows leave the accessibility tree:** assert all app and process rows remain available after scrolling in Tasks 2–4.

---

The modal split and each list target were independent production-build experiments. See the measured outcomes below for the rejected trials and retained grid change.

## File Map

- app/page.tsx and app/launcher/system-overview.tsx: measure panel splitting and preserve focus restoration.
- app/globals.css: experiment with intrinsic-size/offscreen rules at repeated item boundaries.
- app/launcher/application-grid.tsx: remove the per-tile entrance animation after scroll measurements.
- tests/performance.spec.ts: request-boundary and long-list structural coverage; keep machine timings out of CI.
- tests/dashboard.spec.ts: delayed modal, focus/Escape, and existing modal/reorder coverage.
- docs/architecture.md and docs/testing.md: record only retained behavior and the repeatable benchmark procedure.

No new module, dependency, or runtime API is retained. SettingsPanel keeps its existing props, SystemDetailKind remains "processor" | "memory" | "storage", and SystemDetailsModal keeps its existing props.

### Task 1: Measure management and system-detail panel splitting

**Files:**

- Modify: app/page.tsx
- Modify: app/launcher/system-overview.tsx
- Modify: tests/performance.spec.ts
- Modify: tests/dashboard.spec.ts

**Interfaces:**

- SettingsPanel keeps its existing named export and props in app/launcher/settings-panel.tsx.
- SystemDetailsModal keeps its existing default export and props; SystemDetailKind remains "processor" | "memory" | "storage".
- The loading fallback uses ModalFocus, with a heading, status message, close control, and the existing dialog name. The system-detail fallback also preserves body scroll locking until the real modal mounts or closes.

- [x] **Step 1: Add failing browser coverage for deferred chunks and modal loading**

Add "does not load closed modal modules with the initial launcher" to tests/performance.spec.ts. Record same-origin JavaScript chunk requests after the app tile appears, open management and system details in fresh pages, and assert each activation requests its deferred code. Do not assert hashed chunk names or transfer-time budgets.

Add "keeps modal loading accessible and escapable" to tests/dashboard.spec.ts. After the launcher is ready, delay the first management chunk request; assert the loading dialog is named and focusable, press Escape, and verify the existing trigger regains focus. Repeat for the Processor details trigger.

- [x] **Step 2: Run the targeted tests and confirm the static-import behavior fails**

Run: NODE_ENV=development npm run test:browser -- --grep "closed modal modules|modal loading accessible"

Expected: the deferral assertion fails because both panels are in the launcher graph; existing modal interaction tests continue to pass.

- [x] **Step 3: Trial deferring each panel behind its activation boundary**

Use Next.js dynamic imports at the current SettingsPanel and SystemDetailsModal call sites. Wrap each in a Suspense boundary with an accessible fallback, preserving Escape, focus, and body-overflow contracts. This trial was reverted after production timing showed slower first opens even after preloading.

- [x] **Step 4: Run focused browser behavior and type checks**

Run: NODE_ENV=development npm run test:browser -- --grep "closed modal modules|modal loading accessible|contains settings focus|opens system details from every KPI card surface"

Run: npm run lint

The delayed-chunk tests passed during the trial. They were removed after static imports were restored; final coverage continues to verify loaded-dialog focus, Escape, Tab trapping, and exit focus restoration.

- [x] **Step 5: Build and benchmark the bundle split before starting Task 2**

Run: npm run build

Using the production bundle and isolated fixtures, record First Load JS, initial JavaScript transfer, FCP, first usable tile, and cold/repeat opens for management, processor, memory, storage, and the app viewer. The split reduced transfer but increased first-open time after focus/hover preloading, so restore static imports.

### Task 2: Defer offscreen launcher-tile rendering

**Files:**

- Modify: app/globals.css
- Modify: tests/performance.spec.ts
- Verify: tests/dashboard.spec.ts

**Interfaces:** The grid remains .launcher-grid containing .launcher-tile-wrap items. No change to ApplicationGrid, ReorderableApp, app order, links, or APIs.

- [x] **Step 1: Add a long-grid regression fixture**

Add "keeps every launcher tile available while scrolling" to tests/performance.spec.ts. Render 24 and 256 deterministic apps with empty health URLs; assert the complete tile count, the last tile's accessible link, no horizontal overflow, and stable scroll height after scrolling to the last tile.

- [x] **Step 2: Run the fixture before changing CSS**

Run: NODE_ENV=development npm run test:browser -- --grep "every launcher tile available while scrolling"

Expected: PASS on the current implementation, establishing the same structural fixture for the before/after performance comparison.

- [x] **Step 3: Test native offscreen rendering on grid wrappers only**

Trial `content-visibility: auto` on `.launcher-tile-wrap` with an intrinsic block size measured from rendered geometry. The trial showed no repeatable scroll win and was removed.

- [x] **Step 4: Run desktop/mobile structure and interaction checks**

Run the new large-grid test plus existing dashboard tests matching "reorders applications by dragging", "starts touch reordering", "keeps focus and announces", and "labels keyboard reorder controls".

Expected: all 24/256 tiles stay present and accessible; mouse, touch, and keyboard reorder behavior remains unchanged.

- [x] **Step 5: Build and compare real wheel-scroll measurements**

Run: npm run build

At 24 and 256 apps, repeat the same desktop and phone-sized wheel-scroll path and an idle control. Record long-task counts/durations and scroll-height stability. The CSS rule was removed. A separate trial removed only per-tile entrance motion; it reduced desktop 256-tile scroll long-task time from a median 108 ms to 57 ms across two after runs, without geometry or reorder regressions.

### Task 3: Test offscreen settings-row rendering

**Files:**

- Modify: app/globals.css
- Modify: tests/performance.spec.ts
- Verify: tests/dashboard.spec.ts

**Interfaces:** Settings rows stay .settings-list .settings-app; SettingsPanelProps, edit/delete callbacks, and modal focus behavior do not change.

- [x] **Step 1: Extend the long-list fixture to the settings panel**

Add "keeps every settings row accessible while scrolling". Use 24 and 256 apps; assert all Edit controls remain queryable, scroll to the final entry, close with Escape, and verify focus returns to the settings trigger.

- [x] **Step 2: Run the settings fixture before its CSS change**

Run: NODE_ENV=development npm run test:browser -- --grep "settings row|contains settings focus"

Expected: PASS with all settings rows present and focus behavior unchanged.

- [x] **Step 3: Test native offscreen rendering on settings rows only**

Trial `content-visibility: auto` on `.settings-list .settings-app` with an intrinsic size measured from the existing row layout. The rule showed no list-open or scroll win and was removed.

- [x] **Step 4: Build and measure settings open/scroll separately**

Run: npm run build

Compare click-to-mounted-row timing, scroll-associated long tasks, and scroll-height stability. Removing settings-row entrance/layout motion also showed no benefit (256-row desktop open 678 ms before vs. 685 ms after) and was reverted.

### Task 4: Test offscreen process-row rendering

**Files:**

- Modify: app/globals.css
- Modify: tests/performance.spec.ts
- Verify: tests/dashboard.spec.ts

**Interfaces:** Keep the current ProcessorSnapshot/MemorySnapshot response shapes and semantic .process-table tbody tr rows. Do not change the 256-row response cap, sorting, count labels, or 5-second detail refresh.

- [x] **Step 1: Add a deterministic 256-process browser fixture**

Add "keeps all process rows accessible while scrolling" to tests/performance.spec.ts. Return 256 contract-valid process rows from both detail endpoints; open Processor and Memory, assert all body rows and the returned/total count, then scroll to the final row and verify it remains queryable in the accessibility tree.

- [x] **Step 2: Run the process fixture before its CSS change**

Run: NODE_ENV=development npm run test:browser -- --grep "all process rows accessible|accessible process sorting"

Expected: PASS with 256 rows, existing sorting labels/directions, and modal close/focus behavior.

- [x] **Step 3: Test native offscreen rendering on process rows only**

Trial `content-visibility: auto` on `.process-table tbody tr` only if Chromium preserves table geometry and accessibility. The browser showed no repeatable scroll or content-open gain, so the rule was omitted.

- [x] **Step 4: Build and compare process-detail open/scroll measurements**

Run: npm run build

With the same 256-row fixture, record click-to-complete content time, main-thread long tasks during the initial render, and long tasks during wheel scrolling plus an idle control. Keep the selector only if it yields a repeatable gain without table, sort, focus, or accessibility regressions.

### Task 5: Document retained wins and run full verification

**Files:**

- Modify: docs/architecture.md
- Modify: docs/testing.md

- [x] **Step 1: Document retained behavior and measured decisions**

Document static modal imports, post-exit focus restoration, the retained grid entrance-motion change, rejected candidates, and the isolated-fixture benchmark procedure. Timings are reported rather than asserted as machine-specific CI budgets.

- [x] **Step 2: Run domain tests and type checks serially**

Run: npm test

Run: npm run lint

Run: npm run build:agent

Expected: all commands pass; no concurrent Next/browser/build process writes .next/.

- [x] **Step 3: Run the full browser suite with an isolated development database**

Run: NODE_ENV=development npm run test:browser -- --workers=1

Result: 50 browser tests passed, including desktop/mobile CRUD, focus/Escape/Tab, system details, process sorting, reorder, visibility, health refresh, and 24/256-row coverage.

- [x] **Step 4: Run the final production build and delivery checks**

With no worktree `next dev` server running, `npm run build` passed and reported 169 KB First Load JS. `git diff --check` and generated-file/status review passed.

- [x] **Step 5: Report each measured before/after comparison**

Results are recorded in the approved spec and `docs/testing.md`. The launcher scroll improvement was desktop-specific; phone and 24-tile median counts were zero before and after. No FPS gain is claimed.

## Final measured outcome

- **Panel split:** rejected. It saved 8 KB of First Load JS, but after preloading the 256-row first opens regressed: management 412→692 ms, processor 269→530 ms, memory 258→542 ms, storage 252→380 ms.
- **Launcher `content-visibility`:** rejected; no repeatable scroll or open win.
- **Settings/process `content-visibility`:** rejected; settings had no improvement, and process scrolling had no long tasks before or after.
- **Settings-row entrance/layout motion:** rejected; 256-row desktop open time was 678 ms before and 685 ms after.
- **Launcher entrance motion:** retained. Removing per-tile entrance animation reduced 256-tile desktop scroll-associated long-task time from a median 108 ms to 57 ms, repeated, with stable height and all rows available.
- **Startup and panel-open final result:** First Load JS remains 169 KB; FCP/first-tile and per-screen opens showed no clear overall improvement. Keep this limit explicit.
