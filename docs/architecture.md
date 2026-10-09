# Architecture

Nimbus is a local-first launcher for web applications hosted on a home server. It combines
service links, health status, activity history, and basic host metrics in one home screen.

## Runtime flow

```mermaid
flowchart TD
    Browser[Browser: launcher UI in app/page.tsx and app/launcher/] --> Next[Next.js App Router]
    Next --> AppsAPI[GET/POST/DELETE /api/apps]
    Next --> HealthAPI[GET /api/health]
    Next --> OverviewAPI[GET /api/overview]
    Next --> ActivityAPI[GET /api/activity]
    Next --> DetailAPI[Processor and memory detail routes]
    AppsAPI --> DB[lib/db.ts]
    DB --> SQLite[(SQLite: DATABASE_PATH)]
    DB --> Seed[lib/seed.ts]
    OverviewAPI --> OS[Node os module]
    OverviewAPI --> Hardware[Local sysfs or optional hardware agent]
    HealthAPI --> Services[Configured service health URLs]
    Next --> Static[app/globals.css and public/]
```

The browser initially loads the application registry and server overview. `app/page.tsx` owns the
application registry, health state, and mutations. `SystemOverview` owns the overview request,
five-second poll, readings, and system-detail selection; `LauncherClock` owns its thirty-second
clock tick. `ApplicationGrid` filters and renders app states, while memoized launcher tiles and the
settings panel isolate stable application UI from unrelated overview and clock updates. New app
sort orders are derived from the highest current order, including hidden apps, so gaps from deletion
do not cause a duplicate order. Application changes are
sent to `/api/apps`, whose handlers delegate to the singleton `DatabaseSync` connection in
`lib/db.ts`. The database creates its schema and seeds `lib/seed.ts` only when the `apps` table is
empty.

The registry, activity, overview, and health routes remain separate. Operational API responses are
not cached by the service worker. Overview sampling uses a two-second in-process TTL with
in-flight request coalescing; this limits duplicate host probes while preserving a fresh response
for the five-second dashboard refresh. The response's `updatedAt` is the sampling time, not the
time a cached response was served. Health requests explicitly use `no-store`, retain last-known
statuses on failed checks, skip overlapping client refreshes, and run with a maximum of eight
concurrent checks. Activity is refreshed only when a successful health cycle changes an app status.
Docker discovery has an agent-side deadline, bounded concurrent container inspection, bounded
Compose traversal, and a short server-side fallback budget so optional discovery cannot block the
local application registry indefinitely. When the `/api/apps` response reports that Docker
discovery is still loading, the browser retries the registry read once per second up to three
times. Completed discovery responses stop this refresh; the server's 750 ms response budget remains
unchanged.
Health polling pauses while the document is hidden and performs one refresh when the page becomes
visible again; overview polling retains its five-second cadence.

The overview endpoint derives uptime, CPU, memory, and Nimbus storage from the filesystem containing
`DATABASE_PATH`. Hardware telemetry uses local sysfs data and can fall back to an optional hardware
agent configured through `HARDWARE_AGENT_URL`. The agent measures traffic counters for the host's
lowest-metric IPv4 default route and reports receive/send rates as download/upload; the ring fill is
an activity cue and is not a link-capacity percentage. Storage details list Nimbus first, followed
by exact mounted targets explicitly exposed below `/host/storage`; unmounted folders are ignored.
The health endpoint checks each configured HTTP(S) target and reports `online`, `degraded`, or
`offline`. The client refreshes overview data every five seconds and health data every thirty
seconds; system detail modals refresh process data every five seconds.

To expose another local or network-mounted filesystem to the storage selector, add one bind mount
to the `metrics-agent` service for that filesystem's host mount point. Give each mount its own
direct target such as `/host/storage/media`, mark it read-only, and set
`bind.create_host_path: false`. The agent lists only direct child targets that are actual mounts in
its mount table and calls `statfs` on those targets. Do not expose `/`, `/mnt`, or a parent directory
containing several filesystems. The shipped Compose file includes no extra disk source paths, so it
shows Nimbus until an operator adds individual mounts.

For example, add this under `metrics-agent.volumes` and replace the source with one filesystem
mount point on the host:

```yaml
- type: bind
  source: /replace/with/one/mounted/filesystem
  target: /host/storage/media
  read_only: true
  bind:
    create_host_path: false
```

Metric history charts are mounted only inside processor and memory detail modals. Opening a chart performs one no-store history read; the Live selection reads the rolling five-minute window again every 30 seconds while the modal remains open, while 15m and 30m read once when selected. Unmounting the modal clears the timer and aborts any in-flight chart request. History samples are still recorded by overview sampling at the existing one-minute cadence and are retained for 30 days.

## Main components

- `app/page.tsx`: application registry, health polling, application mutations, and settings modal.
- `app/launcher/system-overview.tsx`: overview polling/readings and system-detail ownership.
- `app/launcher/launcher-clock.tsx`: local clock state and timer.
- `app/launcher/application-grid.tsx`: app filtering, loading/error states, and launcher tiles.
- `app/launcher/`: settings, icons, activity, and display helpers.
- `app/system-details-modal.tsx`: sortable CPU and memory process views plus storage details.
- `app/api/apps/`: application CRUD API.
- `app/api/health/`: configured service health checks.
- `app/api/overview/`: host overview metrics.
- `app/api/activity/`: recent activity history.
- `app/api/processor/processes/` and `app/api/memory/processes/`: process detail APIs.
- `agent/`: host metrics and optional Docker/Compose discovery helpers.
- `lib/db.ts`: server-only SQLite access.
- `lib/seed.ts`: default application records.
- `lib/types.ts`: shared application and telemetry types.
- `lib/app-order.ts`: next application sort-order calculation.

## Persistence and deployment

`DATABASE_PATH` selects the SQLite file. Local development defaults to `data/nimbus.db`; Docker
Compose stores the database at `/app/data/nimbus.db` in the persistent `nimbus-data` named volume.

Next.js is built as a standalone server for the container runtime. The default Compose file does
not mount the Docker socket. Compose uses project-scoped container names derived from the Compose
project, so separate deployments can coexist without fixed container-name collisions. The web
host binding is controlled by `NIMBUS_BIND_ADDRESS` (default `0.0.0.0`) and `NIMBUS_PORT` (default
`10000`); these affect only the published host port. Optional Docker/Compose discovery must remain
read-only unless a separately reviewed control path is introduced.

`apps.is_favorite` is retained as an inert legacy SQLite column for compatibility with existing
files and newly initialized databases. It is not selected into `ManagedApp`, accepted as an API
field, written by the application contract, seeded, or rendered. This release performs no
destructive schema migration. A future physical removal requires a versioned migration with
backup, rollback, old/new schema tests, and explicit deployment coordination. Activities and metric
history remain separate from the application contract; metric samples retain their existing
30-day policy. App and Docker discovery responses are private/no-store; Docker agent reads are
short-TTL coalesced and capped to prevent repeated unbounded reconciliation work.

## Extension points

- Add or edit application records through the `/api/apps` route handlers.
- Extend the `ManagedApp` type in `lib/types.ts` when application metadata needs to grow.
- Change default applications in `lib/seed.ts`.
- Use `DATABASE_PATH` for deployment-specific database placement.
- Use `public/` for static assets.

There is currently no feature-flag system, plugin loader, or general event hook.
Activity records are retained for 90 days and capped at the newest 1,000 rows. Pruning runs after
activity writes, not during the five-second overview polling path. SQLite remains a single-process
WAL-backed store; this policy does not claim multi-writer coordination.

Process detail collection uses a 32-worker filesystem-read bound, scans at most 1,024 process
directories per snapshot, and returns at most the top 256 rows after sorting. Responses expose
`totalCount`, `returnedCount`, `unreadableCount`, and `policyOmittedCount` with a reason so a capped
list is never presented as all readable processes. Agent responses are bounded to 512 KiB and
cancel when the downstream request closes; the process table keeps its accessible sorting and
partial/error states.
