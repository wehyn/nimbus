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
- App IDs must be URL-encoded as a single route segment without tightening the existing ID contract.
- Frame-denied apps and apps with blocked embedded sign-in must retain a visible external link and
  clear user guidance.
- Reload must not inspect or mutate a cross-origin frame document.

---

## File Map

- app/apps/[id]/page.tsx: dynamic Node.js route, server-side app lookup, 404 handling.
- app/apps/[id]/app-viewer.tsx: client-side URL resolution, viewer toolbar, iframe, and fallback.
- app/launcher/launcher-components.tsx: internal navigation links for the grid and dock.
- app/globals.css: full-viewport, responsive viewer layout.
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
- Modify: lib/app-validation.ts
- Modify: lib/app-validation.test.ts
- Test: tests/app-viewer.spec.ts

**Interfaces:**
- Server page signature: AppPage({ params }: { params: Promise<{ id: string }> }). Await params,
  resolve id against listApps(), and call notFound() if no record exists.
- The page passes only app launch metadata to the client:
  Pick<ManagedApp, "id" | "name" | "url" | "containerId" | "dockerProject" | "dockerService">.
- AppViewer accepts that launch metadata and resolves its browser URL with
  resolveAppLaunchUrl(app, window.location.hostname) after mount.
- Export the existing isWebUrl(value: string): boolean from lib/app-validation.ts; it remains the
  shared check for absolute HTTP(S) URLs without username or password.

- [ ] **Step 1: Add failing URL validator assertions** in lib/app-validation.test.ts for HTTP and
  HTTPS acceptance plus rejection of file URLs, malformed URLs, and URLs with credentials.
- [ ] **Step 2: Run the focused unit test** with
  node --experimental-strip-types --test --test-concurrency=1 lib/app-validation.test.ts.
  Expected: it fails because isWebUrl is not exported.
- [ ] **Step 3: Export isWebUrl** from lib/app-validation.ts without changing its current validation
  behavior. Run the focused unit test again; expected: all assertions pass.
- [ ] **Step 4: Add failing browser coverage** in tests/app-viewer.spec.ts:
  verify the seeded app's heading, titled iframe URL, Nimbus link, and external link with
  target="_blank" and rel="noreferrer"; verify Reload causes a second frame request; and verify
  an unknown ID returns 404. At desktop and phone viewport widths, assert document width does not
  exceed the viewport. Intercept the seeded service URL so the test never contacts a real service.
- [ ] **Step 5: Run the focused browser test** with
  npm run test:browser -- tests/app-viewer.spec.ts.
  Expected: the tests fail because the viewer route does not exist.
- [ ] **Step 6: Create the dynamic server page** with runtime set to nodejs and dynamic rendering
  enabled. Await params, read the app via listApps(), select by exact ID, call notFound() when
  absent, and pass only the launch metadata above.
- [ ] **Step 7: Create the client viewer** with a full-viewport iframe, app title, Nimbus link,
  Reload button, visible frame-policy/login hint, and external link. Resolve the URL using the
  existing helper and current browser hostname. Validate it with isWebUrl before using it. Show an
  unavailable message and no app link for an invalid value. Implement Reload by changing the
  iframe key.
- [ ] **Step 8: Add responsive viewer styles** in app/globals.css. Keep the toolbar visible above
  the frame, avoid horizontal overflow, and apply safe-area insets on phones.
- [ ] **Step 9: Run the focused browser test** again.
  Expected: route rendering, frame request, toolbar behavior, and 404 coverage pass.

### Task 2: Navigate launcher links into the viewer

**Files:**
- Modify: app/launcher/launcher-components.tsx
- Modify: tests/dashboard.spec.ts

**Interfaces:**
- Grid and dock links use /apps/${encodeURIComponent(app.id)} in the current tab.
- Keep their existing app-name labels and remove external-target attributes from these internal links.

- [ ] **Step 1: Add failing launcher assertions** for the grid and dock hrefs, including an ID with
  reserved path characters. Assert an ID such as other/a b produces /apps/other%2Fa%20b and that
  the links have no target attribute.
- [ ] **Step 2: Run the targeted browser regression test** with
  npm run test:browser -- tests/dashboard.spec.ts.
  Expected: the new href assertions fail while links still point at service URLs.
- [ ] **Step 3: Update LauncherTile and LauncherDock** to link to the encoded /apps/<id> route in
  the current tab. Keep accessible labels and the existing icon and reorder behavior.
- [ ] **Step 4: Run the targeted browser regression test** again.
  Expected: grid and dock links point to the internal viewer route and the existing launcher
  behaviors still pass.

### Task 3: Document the feature and verify the complete change

**Files:**
- Modify: docs/architecture.md
- Modify: docs/security.md
- Modify: docs/testing.md

- [ ] **Step 1: Document the route and data flow** in docs/architecture.md, including the server
  registry lookup, browser-side URL resolution, direct iframe load, and external fallback.
- [ ] **Step 2: Document the security boundary** in docs/security.md: no server-side app fetch or
  proxy, service-owned frame headers, browser-owned TLS, and possible embedded cookie/login limits.
- [ ] **Step 3: Document the new browser smoke coverage** in docs/testing.md.
- [ ] **Step 4: Run npm test and npm run lint.**
  Expected: all existing unit/integration tests pass and TypeScript reports no errors.
- [ ] **Step 5: Run npm run test:browser** serially.
  Expected: the full desktop/mobile and application-management browser suite passes, including the
  new viewer and launcher navigation checks.
- [ ] **Step 6: Stop any running Next.js development server, then run npm run build.**
  Expected: the production build completes successfully. Restart a server only if one was running
  before verification.
