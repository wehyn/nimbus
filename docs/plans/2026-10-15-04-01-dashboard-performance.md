# Nimbus Dashboard Performance Implementation Plan

> **For implementers:** Follow repository instructions and the execution method agreed with the user. Steps use checkbox syntax for tracking.

**Goal:** Reduce measured first-load and large-list rendering work without changing the app registry, operational data, routes, list contents, or accessible interactions.

**Architecture:** Split the closed management and system-detail panels from the launcher bundle, using a focusable loading dialog while a chunk is pending. In separate production-build steps, test browser-native content-visibility on launcher tiles, settings rows, and process rows; retain only targets that improve measured paths without changing DOM/accessibility or list interaction.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, CSS content-visibility, Playwright, T3 Chromium preview, SQLite through a temporary DATABASE_PATH fixture.

**Spec:** docs/superpowers/specs/2026-10-15-dashboard-performance-design.md

## Global Constraints

- Preserve modal focus, Escape, inert, focus restoration, body overflow, reduced motion, and existing data-loading/retry states.
- Keep every launcher, settings, and process row in the DOM and accessibility tree. Do not cap, virtualize, filter, or reorder data as part of this work.
- Do not change API payloads, SQLite schema/data, health and overview cadence, metric retention/ranges, service-worker policy, or dependencies.
- Use temporary app/history data and a local process fixture for benchmarks. Never use the default or production DATABASE_PATH.
- Compare each change in a production build assembled like the Docker runtime. Report repeated measurements, not CI timing thresholds or FPS inferred from the preview's variable frame clock.
- Keep Next dev, browser suites, and production builds serial because they share .next/. Stop any next dev server before npm run build.

## Review Focus

1. **Deferred chunk is slow or unavailable:** while it loads, a labeled, focusable dialog must remain available; Escape closes it and restores focus. Cover in Task 1.
2. **Modal focus breaks after a delayed open:** preserve existing settings and KPI-trigger behavior, including the loading state. Cover in Task 1 and existing modal tests.
3. **Intrinsic-size estimates shift content:** scrolling must not drop or duplicate rows or cause unstable list height. Cover in Tasks 2–4.
4. **Framer Motion drag/drop or keyboard reordering breaks:** reuse existing grid/dock interaction tests in Task 2.
5. **Offscreen rows leave the accessibility tree:** assert all app and process rows remain available after scrolling in Tasks 2–4.

---

The modal split and list rendering work can be accepted independently. Keep one plan because both are client-side launcher/detail rendering work and share the isolated production benchmark setup. The three list targets below remain separate measurement gates; remove a target that does not help or breaks an interaction.

## File Map

- app/page.tsx: defer the management panel and render its loading fallback.
- app/launcher/system-overview.tsx: defer the system-detail panel and own its loading fallback/body lock.
- app/globals.css: apply measured intrinsic-size/offscreen rules at repeated item boundaries only.
- tests/performance.spec.ts: request-boundary and long-list structural coverage; keep machine timings out of CI.
- tests/dashboard.spec.ts: delayed modal, focus/Escape, and existing modal/reorder coverage.
- docs/architecture.md and docs/testing.md: record only retained behavior and the repeatable benchmark procedure.

No new module or runtime API is planned. SettingsPanel keeps its current props, SystemDetailKind remains "processor" | "memory" | "storage", and SystemDetailsModal keeps its current props. Reuse the existing ModalFocus({ children, labelledBy, onClose }) for the loading fallback rather than adding another focus-trap abstraction.

### Task 1: Defer management and system-detail panels

**Files:**

- Modify: app/page.tsx
- Modify: app/launcher/system-overview.tsx
- Modify: tests/performance.spec.ts
- Modify: tests/dashboard.spec.ts

**Interfaces:**

- SettingsPanel keeps its existing named export and props in app/launcher/settings-panel.tsx.
- SystemDetailsModal keeps its existing default export and props; SystemDetailKind remains "processor" | "memory" | "storage".
- The loading fallback uses ModalFocus, with a heading, status message, close control, and the existing dialog name. The system-detail fallback also preserves body scroll locking until the real modal mounts or closes.

- [ ] **Step 1: Add failing browser coverage for deferred chunks and modal loading**

Add "does not load closed modal modules with the initial launcher" to tests/performance.spec.ts. Record same-origin JavaScript chunk requests after the app tile appears, open management and system details in fresh pages, and assert each activation requests its deferred code. Do not assert hashed chunk names or transfer-time budgets.

Add "keeps modal loading accessible and escapable" to tests/dashboard.spec.ts. After the launcher is ready, delay the first management chunk request; assert the loading dialog is named and focusable, press Escape, and verify the existing trigger regains focus. Repeat for the Processor details trigger.

- [ ] **Step 2: Run the targeted tests and confirm the static-import behavior fails**

Run: NODE_ENV=development npm run test:browser -- --grep "closed modal modules|modal loading accessible"

Expected: the deferral assertion fails because both panels are in the launcher graph; existing modal interaction tests continue to pass.

- [ ] **Step 3: Defer each panel behind its activation boundary**

Use Next.js dynamic imports at the current SettingsPanel and SystemDetailsModal call sites. Wrap each in a Suspense boundary whose fallback uses ModalFocus; preserve the existing parent AnimatePresence, modal state, inert, and callback contracts. Keep MetricsHistoryChart inside the system-detail chunk.

- [ ] **Step 4: Run focused browser behavior and type checks**

Run: NODE_ENV=development npm run test:browser -- --grep "closed modal modules|modal loading accessible|contains settings focus|opens system details from every KPI card surface"

Run: npm run lint

Expected: deferred requests occur on first open; loading can be escaped; existing settings focus restoration and processor/memory/storage open behavior pass.

- [ ] **Step 5: Build and benchmark the bundle split before starting Task 2**

Run: npm run build

Using the production bundle and isolated fixtures, record First Load JS, initial JavaScript transfer, FCP, first usable tile, and cold/repeat opens for management, processor, memory, storage, and the app viewer. Keep the split only if first-screen work improves and first-open behavior remains acceptable. If a cold open regresses, separately test focus/hover intent preloading and keep it only if that measurement improves.

### Task 2: Defer offscreen launcher-tile rendering

**Files:**

- Modify: app/globals.css
- Modify: tests/performance.spec.ts
- Verify: tests/dashboard.spec.ts

**Interfaces:** The grid remains .launcher-grid containing .launcher-tile-wrap items. No change to ApplicationGrid, ReorderableApp, app order, links, or APIs.

- [ ] **Step 1: Add a long-grid regression fixture**

Add "keeps every launcher tile available while scrolling" to tests/performance.spec.ts. Render 24 and 256 deterministic apps with empty health URLs; assert the complete tile count, the last tile's accessible link, no horizontal overflow, and stable scroll height after scrolling to the last tile.

- [ ] **Step 2: Run the fixture before changing CSS**

Run: NODE_ENV=development npm run test:browser -- --grep "every launcher tile available while scrolling"

Expected: PASS on the current implementation, establishing the same structural fixture for the before/after performance comparison.

- [ ] **Step 3: Test native offscreen rendering on grid wrappers only**

Apply content-visibility: auto to .launcher-tile-wrap with an intrinsic block size measured from the rendered tile geometry. Do not change animation, drag controls, or the grid's column/gap rules.

- [ ] **Step 4: Run desktop/mobile structure and interaction checks**

Run the new large-grid test plus existing dashboard tests matching "reorders applications by dragging", "starts touch reordering", "keeps focus and announces", and "labels each reorder handle".

Expected: all 24/256 tiles stay present and accessible; mouse, touch, and keyboard reorder behavior remains unchanged.

- [ ] **Step 5: Build and compare real wheel-scroll measurements**

Run: npm run build

At 24 and 256 apps, repeat the same desktop and phone-sized wheel-scroll path and an idle control. Record scroll-associated long-task counts/durations/timestamps and scroll-height stability. Do not report preview FPS. Keep the rule only if the gain is repeatable and there is no geometry or reorder regression; otherwise remove it before Task 3.

### Task 3: Test offscreen settings-row rendering

**Files:**

- Modify: app/globals.css
- Modify: tests/performance.spec.ts
- Verify: tests/dashboard.spec.ts

**Interfaces:** Settings rows stay .settings-list .settings-app; SettingsPanelProps, edit/delete callbacks, and modal focus behavior do not change.

- [ ] **Step 1: Extend the long-list fixture to the settings panel**

Add "keeps every settings row accessible while scrolling". Use 24 and 256 apps; assert all Edit controls remain queryable, scroll to the final entry, close with Escape, and verify focus returns to the settings trigger.

- [ ] **Step 2: Run the settings fixture before its CSS change**

Run: NODE_ENV=development npm run test:browser -- --grep "settings row|contains settings focus"

Expected: PASS with all settings rows present and focus behavior unchanged.

- [ ] **Step 3: Test native offscreen rendering on settings rows only**

Apply content-visibility: auto to .settings-list .settings-app with an intrinsic size measured from the existing row layout. Preserve the current Framer Motion enter/exit and layout props.

- [ ] **Step 4: Build and measure settings open/scroll separately**

Run: npm run build

Compare click-to-mounted-row timings for 24 and 256 apps, scroll-associated long tasks, and scroll-height stability. Keep the row rule only when it improves a measured settings path without focus, edit, delete, or layout regressions.

### Task 4: Test offscreen process-row rendering

**Files:**

- Modify: app/globals.css
- Modify: tests/performance.spec.ts
- Verify: tests/dashboard.spec.ts

**Interfaces:** Keep the current ProcessorSnapshot/MemorySnapshot response shapes and semantic .process-table tbody tr rows. Do not change the 256-row response cap, sorting, count labels, or 5-second detail refresh.

- [ ] **Step 1: Add a deterministic 256-process browser fixture**

Add "keeps all process rows accessible while scrolling" to tests/performance.spec.ts. Return 256 contract-valid process rows from both detail endpoints; open Processor and Memory, assert all body rows and the returned/total count, then scroll to the final row and verify it remains queryable in the accessibility tree.

- [ ] **Step 2: Run the process fixture before its CSS change**

Run: NODE_ENV=development npm run test:browser -- --grep "all process rows accessible|accessible process sorting"

Expected: PASS with 256 rows, existing sorting labels/directions, and modal close/focus behavior.

- [ ] **Step 3: Test native offscreen rendering on process rows only**

Apply content-visibility: auto to .process-table tbody tr only if Chromium preserves table geometry and accessibility for the fixture. Set intrinsic size from measured row geometry; if the browser ignores it on table rows or changes sorting/table semantics, omit this target.

- [ ] **Step 4: Build and compare process-detail open/scroll measurements**

Run: npm run build

With the same 256-row fixture, record click-to-complete content time, main-thread long tasks during the initial render, and long tasks during wheel scrolling plus an idle control. Keep the selector only if it yields a repeatable gain without table, sort, focus, or accessibility regressions.

### Task 5: Document retained wins and run full verification

**Files:**

- Modify: docs/architecture.md
- Modify: docs/testing.md

- [ ] **Step 1: Document only optimizations retained by measurement**

Describe deferred modal chunks and any retained content-visibility targets. Document the isolated-fixture benchmark procedure and that timings are reported rather than asserted as machine-specific CI budgets.

- [ ] **Step 2: Run domain tests and type checks serially**

Run: npm test

Run: npm run lint

Run: npm run build:agent

Expected: all commands pass; no concurrent Next/browser/build process writes .next/.

- [ ] **Step 3: Run the full browser suite with an isolated development database**

Run: NODE_ENV=development npm run test:browser

Expected: the existing desktop/mobile, CRUD, settings focus/Escape, system-detail, process sort, reorder, visibility, and health-refresh coverage passes with the new large-list cases.

- [ ] **Step 4: Run the final production build and delivery checks**

Ensure no next dev server is running, then run npm run build and git diff --check. Recheck the standalone asset layout, final bundle report, public/sw.js generated diff, and git status --short --branch.

- [ ] **Step 5: Report each measured before/after comparison**

Report the bundle split, launcher scroll, settings list, and process list separately. Name any target removed for lack of gain, and state remaining desktop/mobile or hardware coverage limits. Do not claim an FPS win unless the measurement supports it.
