# Security

Nimbus is intended for a trusted home LAN or VPN. Do not expose it directly to the public internet
without authentication, authorization, rate limiting, and a reviewed reverse-proxy configuration.

## Secrets and local data

- Keep runtime secrets and machine-specific values in `.env`.
- `.env*` is ignored except for `.env.example`.
- Never commit credentials, private keys, tokens, private URLs, or production database files.
- Docker and Compose environment values are treated as sensitive telemetry: redact every value
  before it crosses the agent/API boundary, including connection URLs and encryption/database
  variables. Do not expose raw environment values to the browser.
- Keep SQLite data under the configured `DATABASE_PATH`; local `data/` files are runtime artifacts.
- Preserve the existing database schema and data when making changes.
- The legacy `apps.is_favorite` column is intentionally retained and inert; it is omitted from
  API JSON and application writes rather than dropped or used as a hidden compatibility channel.

## Health checks and SSRF

`/api/health` makes bounded server-side requests to configured service URLs. Treat these URLs as an
SSRF boundary:

- Accept only the intended HTTP(S) protocols.
- Preserve the existing request timeout of 4.5 seconds.
- Validate and constrain allowed destinations before exposing the endpoint beyond a trusted LAN.
- Do not allow arbitrary browser-supplied URLs to become unrestricted server-side fetches.
- Add authentication and rate limiting before internet-facing deployment.

The icon route also makes bounded requests to configured service URLs and must receive the same
security review when its behavior changes.

## Docker access

`DOCKER_SOCKET` is opt-in through `docker-compose.docker.yml`. The default Compose file keeps the
socket mount disabled. A Docker socket grants powerful control over the host and must not be
enabled casually.

Do not expose raw Docker socket operations through browser-facing API routes. Future container
controls should use a narrowly scoped server-side adapter or local agent, require authentication,
validate every operation, and record mutation activity. Any container-control feature requires
human security review before implementation or deployment.

## Deployment review

The default Compose stack publishes the dashboard on NIMBUS_BIND_ADDRESS defaulting to 0.0.0.0 and NIMBUS_PORT defaulting to 10000, and has no built-in authentication or authorization. Bind it to an appropriate interface or place it behind authentication, authorization, rate limiting, and a reviewed reverse proxy before exposing it beyond a trusted LAN or VPN.

The metrics agent runs as 0:0 because the host RAPL and sensor mounts may require root-readable access. Its /proc, /sys, /etc/passwd, and service-root mounts are read-only. Any extra storage shown in the selector must be exposed as an individual read-only bind mount at a direct child of `/host/storage`; the agent checks the mount table and stats only the mount point. Because the agent runs as root, each such bind still gives it read access to that selected filesystem's contents; expose only disks the operator intends the agent to see. Do not mount host root, a broad parent containing multiple filesystems, or accept browser-supplied paths. Network-mounted volumes may be exposed the same way after they are mounted on the host. The default stack does not mount /var/run/docker.sock; the optional Docker override is read-only but still grants access to a powerful host control interface and requires human review.

Run docs/release-smoke.md with a unique Compose project and throwaway volume. Never use the production project or production DATABASE_PATH for release validation.

## Privileged operations

Do not add arbitrary shell execution, terminal access, filesystem administration, package
installation, firewall management, or other privileged controls without explicit security review.
Prefer read-only telemetry and narrowly scoped operations.

## Sensors and host telemetry

When diagnosing sensors exposed under `/sys/class`, resolve class symlinks and check read
permissions before concluding that a sensor is absent. Host telemetry should remain read-only and
should not require broad additional permissions.

## Review requirements

Human review is required for changes involving:

- API validation or persistence
- network access or health-check destinations
- authentication or authorization
- container permissions or Docker socket mounts
- deployment configuration
- new privileged endpoints

Dependency scanning and lockfile auditing are enforced by `npm run audit` and the CI `Dependency
audit` job. Vulnerability thresholds remain high and critical as documented in the dependency
policy.
