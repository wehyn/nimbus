# Nimbus Dashboard Performance Design

**Status:** Approved; implemented and measured

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

## Measured outcome

The deferred-panel experiment reduced `/` First Load JS from 169 KB to 161 KB and initial JavaScript
transfer from 173,249 to 164,904 bytes. FCP and time to the first tile showed no clear improvement.
Even after pointer/focus preloading, five-run click-to-content medians for 256 rows regressed:

| Screen | Static baseline | Split after preload |
| --- | ---: | ---: |
| Management | 412 ms | 692 ms |
| Processor | 269 ms | 530 ms |
| Memory | 258 ms | 542 ms |
| Storage | 252 ms | 380 ms |

The split and its preload hooks were reverted. After restoring static imports and removing per-tile
entrance motion, five-run medians were 353 ms for management, 254 ms for processor, 260 ms for
memory, and 194 ms for storage. These ranges overlap the static baseline, so no screen-open win is
claimed. The final build reports 169 KB First Load JS and 173,058 bytes of initial JavaScript
transfer. The app-viewer timing covered only its title and toolbar because the fixture had no usable
iframe URL.

Removing per-tile entrance motion reduced desktop 256-tile scrolling long tasks from a three-run
median of two tasks / 108 ms total to one / 57 ms; a second after run measured one / 57 ms. On
phone-sized viewports and with 24 tiles, the median count remained zero. Row counts and scroll height
stayed stable. The settings-row animation trial did not improve 256-row open or scroll time and was
reverted. None of the three `content-visibility` trials produced a repeatable gain, so all were
removed. API, overview, and seven-day history paths remained fast and unchanged.

## Options considered

### 1. Defer unopened panels and test native offscreen rendering — tested, not retained

Split application management and system details from the launcher’s first-load bundle. Then test browser-native `content-visibility: auto` on repeated list items, with measured intrinsic sizes, while keeping every row in the DOM and accessibility tree. Measure the two changes separately and keep each only if it improves the target path without hurting the first open, scroll stability, or app reordering.

The split and CSS rules were measured independently. The transfer saving did not offset first-open
delays, and the offscreen rules did not improve scrolling, so none is present in the final code.

### 2. Virtualize the app and process lists

Mount only the visible rows plus an overscan window. This could cut more DOM and layout work, but it introduces custom scroll state, spacer sizing, and interaction work. It can interfere with Framer Motion layout measurement, drag/drop targets, keyboard reordering, and table navigation for assistive technology. The current 256-row process cap and browser evidence do not justify this added complexity yet.

### 3. Change server delivery, caching, or history storage

Server-render a bootstrap payload, cache operational API responses, or change history queries and retention. The measured route and history costs are already low. These changes would add freshness, privacy, or data-compatibility risks without addressing the measured list-rendering delay, so they are out of scope.

## Approved implementation and experiments

### Phase A: test closed-modal code splitting

- Dynamic imports and focus/hover preloading were implemented and measured, then reverted after first-open delays remained high.
- Final code statically imports both panels. Their `aria-modal` dialogs retain keyboard focus traps and Escape behavior; the full-screen backdrop blocks pointer access, and focus returns after the exit animation.
- Make no API, health, overview, service-worker, or SQLite changes.

### Phase B: test offscreen list rendering

- All three `content-visibility: auto` rules were tried and removed for lack of repeatable wins.
- Removing only the launcher's per-tile entrance motion reduced desktop 256-tile scroll long-task time while preserving layout/reorder motion, exits, every DOM row, and accessible names.
- A settings-row entrance/layout-motion trial did not help and was reverted.

## Measurement plan

Use the same production build/runtime packaging and isolated fixtures before and after each phase. Report medians and ranges from repeated runs; do not use machine-specific timing assertions in CI or claim an FPS improvement from the preview's unstable frame clock.

### Phase A comparison

- Record First Load JS, per-route chunk transfer, FCP, and time to first usable app tile.
- Measure first and repeat opens for management, processor, memory, and storage details, plus the app viewer.
- Verify `aria-modal`, focus trapping, Escape, focus restoration, reduced motion, loading/error presentation, and modal close behavior.
- Keep the split only if first-screen transfer/rendering improves and the first-use screen experience remains acceptable. Add intent preloading only as a separately measured adjustment if a cold open regresses.

### Phase B comparison

- Use 24 and 256 synthetic apps, 24 and 256 settings rows, and the existing 256-process response fixture.
- Repeat real wheel scrolling on desktop and phone-sized viewports; collect scroll-associated long tasks and their timestamps, list-open time, row counts, and scroll-height stability. Include an idle control to separate periodic work from scroll work.
- Confirm that all rows remain in the accessibility tree and that grid/dock mouse, touch, and keyboard reordering still works.
- Keep each CSS target only when the before/after evidence shows a repeatable gain and no layout shift or interaction regression.

The seven-day metrics endpoint remains a before/after no-change control. Its response time and payload size must stay within normal measurement variance; no new history range or pagination UI is included.

## Files and verification boundaries

Implementation and experiment files:

- `app/page.tsx` and `app/launcher/system-overview.tsx` for panel ownership and focus restoration.
- `app/launcher/application-grid.tsx` for the retained launcher entrance-motion change.
- `tests/performance.spec.ts` and existing modal/reordering browser coverage for list structure and accessibility.
- `docs/architecture.md` and `docs/testing.md` for retained behavior and benchmark results.

Run the project-required `npm test`, `npm run lint`, and `npm run build`; run `npm run build:agent` and the browser suite serially as required by the project verification workflow. Keep a `next dev` server stopped during production builds. Use only temporary `DATABASE_PATH` data for browser and performance fixtures.

No new dependencies, database schema or data changes, API response changes, health target changes, new navigation, or service-worker caching changes are part of this design.

## Risks and rollback

- Deferred chunks reduced first-load transfer but failed the first-open gate, so the imports were restored to the initial client graph.
- Intrinsic-size estimates can shift long content as it becomes visible. Measure row/card sizes and check visual stability while scrolling at desktop and mobile widths.
- Native offscreen rendering may interact with Framer Motion layout measurement and the semantic table. Revert the affected CSS target if row geometry, sorting, focus, accessibility, or reordering changes.
- The measured phases are independent. Revert any future optimization that fails its user-visible performance or interaction gate; no data rollback or migration is needed.

## Out of scope

Changing the server-start path, API payloads, health or overview refresh cadence, history schema/retention/ranges, static/API caching, app search/pagination, removing rows from the DOM or accessibility tree, changing typography/card visuals, and reducing app drag/reorder accessibility.
