# Open Apps Inside Nimbus

**Status:** Implemented

**Date:** 2026-10-14

## Goal

Let a user open a registered home-server app and use it without leaving Nimbus. Keep the service's
own browser origin and preserve a direct way to open the service in a separate tab.

## Current behavior

The launcher grid and quick-launch dock link directly to each app URL and open it in a new tab.
Managed app URLs are stored in the existing SQLite registry. The shared
resolveAppLaunchUrl helper adjusts Docker-hosted app URLs for the current browser hostname.

## Decision

Add a full-viewport app viewer at /apps/[id]. Launcher links use a fixed app- prefix followed by
four lowercase hex digits for each UTF-16 code unit in the app ID (for example,
/apps/app-006300720061006600740079002d0063006f006e00740072006f006c006c00650072). This keeps
single-dot, double-dot, slash, and other IDs inside one route-safe segment without changing the
existing ID contract. The server route removes the prefix and decodes the token before the exact
registry lookup. The viewer loads the selected registered app in an iframe using its resolved
HTTP(S) URL. The launcher grid and dock navigate to this route in the current tab.

The viewer has a compact one-row toolbar with the app name, an arrow-only Back link to the
dashboard, and icon-only Reload and Open in new tab controls. The Back link's accessible name is
"Back to dashboard"; the other controls also have accessible names. Keep the direct-open link
available, but do not show a persistent framing or sign-in hint. Reload remounts the iframe instead
of reading or changing its cross-origin document.

The app route reads the selected app by ID from the server-side registry. It passes only the
launch data needed by the client viewer and never accepts an app URL from a query parameter or
browser request body. The client resolves the URL with resolveAppLaunchUrl and the browser's
current hostname, then validates it with the shared HTTP(S), no-credentials app URL validator
before assigning it to the iframe or external link. Unknown or deleted IDs return a 404.

## Security and compatibility

- Load the configured service URL directly in the browser. Do not add a server-side URL proxy,
  fetch the app URL from the Nimbus server, or rewrite app response headers.
- Keep each service's own origin. Do not path-proxy unrelated services onto Nimbus's origin.
- A service must permit framing through its own X-Frame-Options or Content-Security-Policy policy.
  If it blocks framing, the user can use Open in new tab. Do not strip or weaken those headers.
- Cross-site cookie rules and service authentication can behave differently in a frame. The
  external link remains available; Nimbus does not try to repair service cookies or login flows.
- The browser handles TLS for the iframe. The existing allowInsecureTls setting only affects
  Nimbus health and icon requests; it does not bypass browser certificate checks.
- Do not grant camera, microphone, or other optional iframe permissions by default.
- This feature adds no API route, database field, migration, dependency, authentication change, or
  container control.

## Interaction and accessibility

- App tile and dock links remain keyboard-accessible links with their app names in accessible text.
- The viewer is a route rather than a small modal so apps have the available viewport.
- Give the iframe an accessible title matching the app name.
- Give the arrow-only Back link the accessible name "Back to dashboard"; give Reload and Open in new
  tab clear accessible names.
- Keep the toolbar usable at desktop and phone widths, including device safe areas.
- The arrow-only Back control always links to /; browser Back also follows normal route history.

## Acceptance criteria

1. Selecting a visible app from the grid or dock navigates to /apps/app-<hex-app-id> in the same
   tab. Dot-only, slash-containing, space-containing, and Unicode IDs round-trip to their exact
   registry records.
2. The viewer resolves Docker-hosted URLs with the browser's current hostname, using the existing
   URL helper.
3. The viewer embeds only a valid absolute HTTP(S) URL from the selected registry record.
4. The title and iframe identify the selected app; Back returns to the dashboard, Reload remounts
   the frame, and Open in new tab targets the selected app.
5. Reload requests the frame again without accessing the cross-origin frame document.
6. Unknown or deleted app IDs return 404. Invalid stored URLs do not become iframe or external-link
   targets.
7. If framing or embedded authentication fails, the user can still open the service directly.
8. The viewer works without horizontal overflow on desktop and mobile.
9. No server-side request is made to an app URL, and app frame headers remain under each service's
   control.

## Files and implementation boundaries

- Create app/apps/[id]/page.tsx for the dynamic server route and registry lookup.
- Create app/apps/[id]/app-viewer.tsx for the client viewer and its toolbar.
- Update app/launcher/launcher-components.tsx for grid and dock navigation.
- Update app/globals.css for the full-viewport viewer layout.
- Add focused browser coverage in tests/app-viewer.spec.ts and extend launcher link coverage in
  tests/dashboard.spec.ts.
- Add the route ID encoder/decoder and focused cases in lib/app-url.ts and lib/app-url.test.ts.
- Export and reuse the existing URL validator in lib/app-validation.ts; add coverage in
  lib/app-validation.test.ts.
- Update docs/architecture.md, docs/security.md, and docs/testing.md.
- Reuse lib/app-url.ts, lib/db.ts, and the existing ManagedApp contract. No schema or API change is
  required.

## Out of scope

Reverse-proxy setup, service-specific header changes, a per-app embedding toggle, proxy-based
cookie repair, changes to app management, and authentication are separate work.

## Implementation plan

See docs/plans/2026-10-14-22-51-open-apps-in-dashboard.md.
