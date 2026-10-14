# Open Apps Inside Nimbus Implementation Plan

> **For implementers:** Follow repository instructions and this spec. Steps use checkbox syntax for tracking.

**Goal:** Let users open registered home-server apps inside Nimbus through a full-viewport viewer.

**Architecture:** Add a dynamic server route that looks up an app by ID from the existing SQLite
registry and passes limited launch data to a client viewer. The viewer resolves and validates the
stored URL in the browser, embeds it directly, and keeps an external link available. Grid and dock
links navigate to the viewer route; no proxy, API, or schema changes are needed.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, existing Node test runner, Playwright.

**Spec:** docs/superpowers/specs/2026-10-14-open-apps-in-dashboard-design.md

## Global Constraints

- Keep database access server-only; the browser viewer must not import lib/db.ts.
- Use Node.js runtime for the server route that reads SQLite.
- Preserve current app URL validation and Docker hostname resolution.
- Only embed absolute HTTP(S) URLs without user information. Do not take a target URL from query
  parameters, request bodies, or client-supplied values.
- Route IDs use four lowercase hex digits per UTF-16 code unit behind the fixed app- prefix;
  preserve every currently valid app ID, including dot-only and slash-containing values.
- Do not fetch app URLs from Nimbus, proxy them, or change their response headers.
- Keep app-specific frame policy, authentication, and TLS behavior under the service/browser.
- Add no dependency, database field, migration, or authentication mechanism.
- Preserve the existing interface and accessible controls; support desktop, mobile, and safe areas.
- For TypeScript/runtime changes, run npm test, npm run lint, npm run build, and the relevant
  Playwright browser coverage. Run Next.js browser checks and builds serially; stop any next dev
  process before the build.

## Review Focus

- Unknown or deleted app IDs must return 404 without constructing a frame URL.
- Invalid stored URLs must not become iframe or external-link targets.
- The route token must round-trip the existing app ID contract; malformed tokens return 404.
- Frame-denied apps and apps with blocked embedded sign-in must retain a visible external link and
  clear user guidance.
- Reload must not inspect or mutate a cross-origin frame document.

---

## File Map

- app/apps/[id]/page.tsx: dynamic Node.js route, server-side app lookup, 404 handling.
- app/apps/[id]/app-viewer.tsx: client-side URL resolution, viewer toolbar, iframe, and fallback.
- app/launcher/launcher-components.tsx: internal navigation links for the grid and dock.
- app/globals.css: full-viewport, responsive viewer layout.
- lib/app-url.ts: existing launch URL resolution plus app ID route encoding/decoding.
- lib/app-url.test.ts: route token round-trip and malformed token tests.
- lib/app-validation.ts: export the existing HTTP(S)-and-no-credentials URL validator.
- lib/app-validation.test.ts: validator tests.
- tests/app-viewer.spec.ts: route and viewer browser tests.
- tests/dashboard.spec.ts: grid and dock destination tests.
- docs/architecture.md, docs/security.md, docs/testing.md: implementation and verification notes.

### Task 1: Add the app viewer route

**Files:**
- Create: app/apps/[id]/page.tsx
- Create: app/apps/[id]/app-viewer.tsx
- Modify: app/globals.css
- Modify: lib/app-url.ts
- Modify: lib/app-url.test.ts
- Modify: lib/app-validation.ts
- Modify: lib/app-validation.test.ts
- Test: tests/app-viewer.spec.ts

**Interfaces:**
- Server page signature: AppPage({ params }: { params: Promise<{ id: string }> }). Await params,
  remove the app- prefix, decode the hex token with decodeAppRouteId(encodedId), resolve the exact
  app ID against listApps(), and call notFound() for an invalid token or missing record.
- encodeAppRouteId(id) emits four lowercase hex digits per UTF-16 code unit. decodeAppRouteId(token)
  returns the exact string or undefined for an empty or malformed token.
- The page passes only app launch metadata to the client:
  Pick<ManagedApp, "id" | "name" | "url" | "containerId" | "dockerProject" | "dockerService">.
- AppViewer accepts that launch metadata and resolves its browser URL with
  resolveAppLaunchUrl(app, window.location.hostname) after mount.
- Export the existing isWebUrl(value: string): boolean from lib/app-validation.ts; it remains the
  shared check for absolute HTTP(S) URLs without username or password.

- [x] **Step 1: Add failing URL validator and route token tests** in lib/app-validation.test.ts and
  lib/app-url.test.ts. Cover HTTP and HTTPS, invalid schemes and credentials, exact route tokens
  for dot IDs, slash and space IDs, Unicode IDs, and malformed token rejection.
- [x] **Step 2: Run the focused unit tests** with
  node --experimental-strip-types --test --test-concurrency=1 lib/app-validation.test.ts lib/app-url.test.ts.
  Expected: the new route token assertions fail because the encoder and decoder do not exist yet.
- [x] **Step 3: Export isWebUrl** from lib/app-validation.ts and implement encodeAppRouteId and
  decodeAppRouteId in lib/app-url.ts. Run the focused unit tests again; expected: all assertions
  pass.
- [x] **Step 4: Add failing browser coverage** in tests/app-viewer.spec.ts:
  verify the seeded app's heading, titled iframe URL, Nimbus link, and external link with
  target="_blank" and rel="noreferrer"; verify Reload causes a second frame request; and verify
  an unknown ID returns 404. Create isolated persisted fixtures for dot-only and slash/space IDs,
  then click their launcher links and assert each opens its matching viewer. The unit test covers
  Unicode round-tripping. At desktop and phone viewport widths, assert document width does not
  exceed the viewport. Intercept service URLs so tests never contact a real service.
- [x] **Step 5: Run the focused browser test** with
  npm run test:browser -- tests/app-viewer.spec.ts.
  Expected: the tests fail because the viewer route does not exist.
- [x] **Step 6: Create the dynamic server page** with runtime set to nodejs and dynamic rendering
  enabled. Await params, read the app via listApps(), select by exact ID, call notFound() when
  absent, and pass only the launch metadata above.
- [x] **Step 7: Create the client viewer** with a full-viewport iframe, app title, Nimbus link,
  Reload button, visible frame-policy/login hint, and external link. Resolve the URL using the
  existing helpers and current browser hostname. Validate it with isWebUrl before using it. Show an
  unavailable message and no app link for an invalid value. Implement Reload by changing the
  iframe key.
- [x] **Step 8: Add responsive viewer styles** in app/globals.css. Keep the toolbar visible above
  the frame, avoid horizontal overflow, and apply safe-area insets on phones.
- [x] **Step 9: Run the focused browser test** again.
  Expected: route rendering, frame request, toolbar behavior, and 404 coverage pass.

### Task 2: Navigate launcher links into the viewer

**Files:**
- Modify: app/launcher/launcher-components.tsx
- Modify: tests/dashboard.spec.ts
- Modify: tests/app-viewer.spec.ts

**Interfaces:**
- Grid and dock links use /apps/app-${encodeAppRouteId(app.id)} in the current tab.
- Keep their existing app-name labels and remove external-target attributes from these internal links.

- [x] **Step 1: Add failing launcher assertions** for the grid and dock hrefs. Assert the reserved
  ID other/a b produces /apps/app-006f0074006800650072002f006100200062 and that the links have no
  target attribute. The viewer test must also click persisted dot-only and reserved-character IDs.
- [x] **Step 2: Run the targeted browser regression test** with
  npm run test:browser -- tests/dashboard.spec.ts.
  Expected: the new href assertions fail while links still use percent-encoded route IDs.
- [x] **Step 3: Update LauncherTile and LauncherDock** to use encodeAppRouteId and link to
  /apps/app-<hex-id> in the current tab. Keep accessible labels and existing icon/reorder behavior.
- [x] **Step 4: Run the targeted browser regression test** again.
  Expected: grid and dock links point to safe internal route segments and the existing launcher
  behaviors still pass.

### Task 3: Document the feature and verify the complete change

**Files:**
- Modify: docs/architecture.md
- Modify: docs/security.md
- Modify: docs/testing.md

- [x] **Step 1: Document the route and data flow** in docs/architecture.md, including the server
  registry lookup, browser-side URL resolution, direct iframe load, and external fallback.
- [x] **Step 2: Document the security boundary** in docs/security.md: no server-side app fetch or
  proxy, service-owned frame headers, browser-owned TLS, and possible embedded cookie/login limits.
- [x] **Step 3: Document the new browser smoke coverage** in docs/testing.md.
- [x] **Step 4: Run npm test and npm run lint.**
  Expected: all existing unit/integration tests pass and TypeScript reports no errors.
- [x] **Step 5: Run npm run test:browser** serially.
  Expected: the full desktop/mobile and application-management browser suite passes, including the
  new viewer and launcher navigation checks.
- [x] **Step 6: Stop any running Next.js development server, then run npm run build.**
  Expected: the production build completes successfully. Restart a server only if one was running
  before verification.
