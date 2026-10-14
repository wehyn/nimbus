# Nimbus Dashboard Performance Design

**Status:** Proposed; awaiting review

**Date:** 2026-10-15

## Goal

Make Nimbus feel faster at startup and when opening its management and system-detail screens. Keep long launcher, management, and process lists responsive as users move through older/offscreen entries. Preserve the existing routes, API contracts, stored data, visual language, app reordering, and accessibility behavior.

## Baseline evidence

Measurements were collected from a production build served with the same standalone file layout as the Docker image. Browser measurements used the T3 Chromium preview at 1280×800. Database and metrics data were synthetic and isolated; no local user database or live service records were read or changed.

| Path | Baseline |
| --- | --- |
| Production bundle | `/` First Load JS: 169 KB (62.6 KB route, 103 KB shared). Management and system-detail code are in the initial client graph. |
| Standalone startup | Ready in 110–172 ms across clean starts. |
| First launcher view | FCP 444 ms with 256 app entries; this marks the loading shell, not the first usable tile. |
| App registry | 53.9 KB for 256 apps; warm API TTFB 13–15 ms. |
| Overview | 126 ms for the first sample; about 3 ms for cached reads. |
| Settings panel | 207 ms with 24 apps and 488 ms with 256 apps, measured until all rows mounted. |
| CPU and memory details | 443 ms–1.20 s with 256 process rows; the process API itself took 9–37 ms. One warm open included a 187 ms main-thread task. |
| Storage and app viewer | 156 ms and 215 ms respectively. |
| Seven-day history | 10,080 rows, 1.14 MB, and 25–26 ms warm from 43,201 retained one-minute samples. |
| Launcher scroll | Three 700 px wheel inputs on 256 tiles produced three 52–68 ms long tasks in a 14-second run; only one overlapped an input. A 10-second idle control produced no long tasks. The preview's frame clock was too variable for a reliable FPS result. |

The evidence points to client bundle and list-rendering work. Startup, app/overview APIs, and the indexed history query do not justify backend, database, retention, caching, or polling changes.

## Options considered

### 1. Defer unopened panels and test native offscreen rendering — recommended

Split application management and system details from the launcher’s first-load bundle. Then test browser-native `content-visibility: auto` on repeated list items, with measured intrinsic sizes, while keeping every row in the DOM and accessibility tree. Measure the two changes separately and keep each only if it improves the target path without hurting the first open, scroll stability, or app reordering.

This reuses Next.js code splitting and CSS containment. It does not add a dependency, change list ordering, or require a new windowing system.

### 2. Virtualize the app and process lists

Mount only the visible rows plus an overscan window. This could cut more DOM and layout work, but it introduces custom scroll state, spacer sizing, and interaction work. It can interfere with Framer Motion layout measurement, drag/drop targets, keyboard reordering, and table navigation for assistive technology. The current 256-row process cap and browser evidence do not justify this added complexity yet.

### 3. Change server delivery, caching, or history storage

Server-render a bootstrap payload, cache operational API responses, or change history queries and retention. The measured route and history costs are already low. These changes would add freshness, privacy, or data-compatibility risks without addressing the measured list-rendering delay, so they are out of scope.

## Proposed design

### Phase A: split closed modal code

- Dynamically load `SettingsPanel` when application management opens and `SystemDetailsModal` when a processor, memory, or storage detail opens. The chart remains inside the system-detail chunk unless build evidence justifies a separate split.
- Keep modal state, `inert`, Escape handling, focus return, reduced motion, error states, and retry behavior correct while a chunk loads. Provide a small accessible loading state; do not leave the page inert without a focusable modal state.
- Measure a cold first open as well as repeat opens. If the split delays the first open materially, test intent preloading on trigger focus/hover before deciding whether to keep it. Do not add preloading preemptively.
- Make no API, health, overview, service-worker, or SQLite changes.

### Phase B: defer offscreen list rendering

- Test CSS `content-visibility: auto` at repeated item boundaries in the launcher grid, settings app list, and process table. Set intrinsic sizes from measured item geometry so skipped content reserves stable space.
- Preserve every item's DOM node, order, focusability, accessible name, and table semantics. Do not remove rows or change the process response cap.
- Keep an item-level rule only if it reduces scroll-associated long tasks or list-open work in the controlled benchmark. Skip a target if the table-row or Framer Motion layout behavior makes sizes, drag/drop, keyboard reordering, or focus unreliable.

## Measurement plan

Use the same production build/runtime packaging and isolated fixtures before and after each phase. Report medians and ranges from repeated runs; do not use machine-specific timing assertions in CI or claim an FPS improvement from the preview's unstable frame clock.

### Phase A comparison

- Record First Load JS, per-route chunk transfer, FCP, and time to first usable app tile.
- Measure first and repeat opens for management, processor, memory, and storage details, plus the app viewer.
- Verify focus, Escape, `inert`, focus restoration, reduced motion, loading/error presentation, and modal close behavior.
- Keep the split only if first-screen transfer/rendering improves and the first-use screen experience remains acceptable. Add intent preloading only as a separately measured adjustment if a cold open regresses.

### Phase B comparison

- Use 24 and 256 synthetic apps, 24 and 256 settings rows, and the existing 256-process response fixture.
- Repeat real wheel scrolling on desktop and phone-sized viewports; collect scroll-associated long tasks and their timestamps, list-open time, row counts, and scroll-height stability. Include an idle control to separate periodic work from scroll work.
- Confirm that all rows remain in the accessibility tree and that grid/dock mouse, touch, and keyboard reordering still works.
- Keep each CSS target only when the before/after evidence shows a repeatable gain and no layout shift or interaction regression.

The seven-day metrics endpoint remains a before/after no-change control. Its response time and payload size must stay within normal measurement variance; no new history range or pagination UI is included.

## Files and verification boundaries

Likely implementation files:

- `app/page.tsx` and `app/launcher/system-overview.tsx` for deferred panel imports and loading behavior.
- `app/globals.css` for the measured offscreen-rendering rules.
- `tests/performance.spec.ts` and focused existing modal/reordering browser coverage for structural behavior and accessibility.
- `docs/architecture.md` and `docs/testing.md` for the final behavior and benchmark procedure.

Run the project-required `npm test`, `npm run lint`, and `npm run build`; run `npm run build:agent` and the browser suite serially as required by the project verification workflow. Keep a `next dev` server stopped during production builds. Use only temporary `DATABASE_PATH` data for browser and performance fixtures.

No new dependencies, database schema or data changes, API response changes, health target changes, new navigation, or service-worker caching changes are part of this design.

## Risks and rollback

- Deferred chunks reduce first-load transfer but can add first-open delay or leave an inaccessible transition if loading state is incomplete. Verify both cold and warm opens and preserve modal focus/inert behavior.
- Intrinsic-size estimates can shift long content as it becomes visible. Measure row/card sizes and check visual stability while scrolling at desktop and mobile widths.
- Native offscreen rendering may interact with Framer Motion layout measurement and the semantic table. Revert the affected CSS target if row geometry, sorting, focus, accessibility, or reordering changes.
- Both phases are independent. Revert a phase that does not produce a repeatable user-visible gain; no data rollback or migration is needed.

## Out of scope

Changing the server-start path, API payloads, health or overview refresh cadence, history schema/retention/ranges, static/API caching, app search/pagination, removing rows from the DOM or accessibility tree, changing typography/card visuals, and reducing app drag/reorder accessibility.
