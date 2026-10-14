import "server-only";

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { toDatabaseRow } from "./db-row";
import { seedApps } from "./seed";
import { pruneActivities } from "./activity-retention";
import { hasStaleDockerMetadata } from "./reconciliation.ts";
import type { DockerContainer, DockerContainerState, DockerHealthState } from "./docker-discovery";
import type { ActivityEvent, ActivityType, AppStatus, HistoricalMetric, ManagedApp } from "./types";
import { canPersistHealthResult, createHealthPersistenceSnapshot, type HealthPersistenceRow, type HealthPersistenceSnapshot } from "./health-persistence";

const databasePath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "nimbus.db");
let database: DatabaseSync | undefined;

function getDatabase() {
  if (!database) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec(`
      CREATE TABLE IF NOT EXISTS apps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'Other',
        url TEXT NOT NULL,
        icon TEXT,
        color TEXT NOT NULL DEFAULT '#65e6a5',
        health_url TEXT,
        allow_insecure_tls INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unknown',
        source TEXT NOT NULL DEFAULT 'manual',
        -- Legacy compatibility column. It is intentionally inert and not part of the app contract.
        is_favorite INTEGER NOT NULL DEFAULT 0,
        is_visible INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        docker_project TEXT,
        docker_service TEXT,
        container_id TEXT,
        container_name TEXT,
        container_image TEXT,
        container_state TEXT NOT NULL DEFAULT 'unknown',
        container_health TEXT NOT NULL DEFAULT 'unknown',
        container_started_at TEXT,
        container_observed_at TEXT,
        casaos_scheme TEXT,
        casaos_hostname TEXT,
        casaos_port_map TEXT,
        casaos_index TEXT,
        health_generation TEXT
      )
    `);
    const appColumns = database.prepare("PRAGMA table_info(apps)").all() as { name?: unknown }[];
    if (!appColumns.some((column) => column.name === "allow_insecure_tls")) {
      database.exec("ALTER TABLE apps ADD COLUMN allow_insecure_tls INTEGER NOT NULL DEFAULT 0");
    }
    addColumnIfMissing(database, appColumns, "docker_project", "TEXT");
    addColumnIfMissing(database, appColumns, "docker_service", "TEXT");
    addColumnIfMissing(database, appColumns, "container_id", "TEXT");
    addColumnIfMissing(database, appColumns, "container_name", "TEXT");
    addColumnIfMissing(database, appColumns, "container_image", "TEXT");
    addColumnIfMissing(database, appColumns, "container_state", "TEXT NOT NULL DEFAULT 'unknown'");
    addColumnIfMissing(database, appColumns, "container_health", "TEXT NOT NULL DEFAULT 'unknown'");
    addColumnIfMissing(database, appColumns, "container_started_at", "TEXT");
    addColumnIfMissing(database, appColumns, "container_observed_at", "TEXT");
    addColumnIfMissing(database, appColumns, "casaos_scheme", "TEXT");
    addColumnIfMissing(database, appColumns, "casaos_hostname", "TEXT");
    addColumnIfMissing(database, appColumns, "casaos_port_map", "TEXT");
    addColumnIfMissing(database, appColumns, "casaos_index", "TEXT");
    addColumnIfMissing(database, appColumns, "health_generation", "TEXT");
    database.prepare("UPDATE apps SET health_generation = lower(hex(randomblob(16))) WHERE health_generation IS NULL OR health_generation = ''");
    database.exec(`
      CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        app_id TEXT,
        app_name TEXT NOT NULL,
        status TEXT,
        created_at TEXT NOT NULL
      )
    `);
    database.exec("CREATE INDEX IF NOT EXISTS activities_created_at_idx ON activities (created_at DESC)");
    database.exec(`
      CREATE TABLE IF NOT EXISTS metric_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_at TEXT NOT NULL,
        cpu REAL NOT NULL,
        memory REAL NOT NULL,
        storage REAL NOT NULL,
        temperature_c REAL,
        power_watts REAL
      )
    `);
    database.exec("CREATE INDEX IF NOT EXISTS metric_snapshots_recorded_at_idx ON metric_snapshots (recorded_at DESC)");
    const count = database.prepare("SELECT COUNT(*) as count FROM apps").get() as { count: number };
    if (count.count === 0) {
      const insert = database.prepare(`INSERT INTO apps (id, name, description, category, url, icon, color, health_url, allow_insecure_tls, status, source, is_visible, sort_order, docker_project, docker_service, container_id, container_name, container_image, container_state, container_health, container_started_at, container_observed_at, casaos_scheme, casaos_hostname, casaos_port_map, casaos_index, health_generation)
        VALUES (@id, @name, @description, @category, @url, @icon, @color, @healthUrl, @allowInsecureTls, @status, @source, @isVisible, @sortOrder, @dockerProject, @dockerService, @containerId, @containerName, @containerImage, @containerState, @containerHealth, @containerStartedAt, @containerObservedAt, @casaosScheme, @casaosHostname, @casaosPortMap, @casaosIndex, @healthGeneration)`);
      database.exec("BEGIN");
      try {
        seedApps.forEach((app) => insert.run({ ...toDatabaseRow(app), healthGeneration: createHealthGeneration() }));
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
  }
  return database;
}

function fromRow(row: Record<string, unknown>): ManagedApp {
  return {
    id: String(row.id), name: String(row.name), description: String(row.description), category: String(row.category),
    url: String(row.url), icon: row.icon ? String(row.icon) : undefined, color: String(row.color),
    healthUrl: row.health_url ? String(row.health_url) : undefined, allowInsecureTls: Boolean(row.allow_insecure_tls), status: row.status as ManagedApp["status"],
    source: row.source as ManagedApp["source"], isVisible: Boolean(row.is_visible), sortOrder: Number(row.sort_order),
    dockerProject: row.docker_project ? String(row.docker_project) : undefined,
    dockerService: row.docker_service ? String(row.docker_service) : undefined,
    containerId: row.container_id ? String(row.container_id) : undefined,
    containerName: row.container_name ? String(row.container_name) : undefined,
    containerImage: row.container_image ? String(row.container_image) : undefined,
    containerState: row.container_observed_at || row.container_state !== "unknown" ? normalizeContainerState(row.container_state) : undefined,
    containerHealth: row.container_observed_at || row.container_health !== "unknown" ? normalizeContainerHealth(row.container_health) : undefined,
    containerStartedAt: row.container_started_at ? String(row.container_started_at) : undefined,
    containerObservedAt: row.container_observed_at ? String(row.container_observed_at) : undefined,
    casaosScheme: row.casaos_scheme === "http" || row.casaos_scheme === "https" ? row.casaos_scheme : undefined,
    casaosHostname: row.casaos_hostname ? String(row.casaos_hostname) : undefined,
    casaosPortMap: row.casaos_port_map ? String(row.casaos_port_map) : undefined,
    casaosIndex: row.casaos_index ? String(row.casaos_index) : undefined,
  };
}

export function listApps() {
  return (getDatabase().prepare("SELECT * FROM apps ORDER BY sort_order ASC, id ASC").all() as Record<string, unknown>[]).map(fromRow);
}

export function reorderApps(orderedIds: readonly string[], expectedIds: readonly string[], expectedVisibleIds: readonly string[]) {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const currentApps = database.prepare("SELECT id, is_visible FROM apps ORDER BY sort_order ASC, id ASC").all() as { id: string; is_visible: number }[];
    const currentIds = currentApps.map((app) => app.id);
    const currentVisibleIds = currentApps.filter((app) => app.is_visible === 1).map((app) => app.id);
    if (expectedIds.length !== currentIds.length || expectedIds.some((id, index) => id !== currentIds[index]) || expectedVisibleIds.length !== currentVisibleIds.length || expectedVisibleIds.some((id, index) => id !== currentVisibleIds[index])) {
      database.exec("ROLLBACK");
      return false;
    }

    const existingIds = new Set(currentIds);
    const requestedIds = new Set(orderedIds);
    if (requestedIds.size !== orderedIds.length || requestedIds.size !== existingIds.size || [...existingIds].some((id) => !requestedIds.has(id)) || currentApps.some((app, index) => app.is_visible === 0 && orderedIds[index] !== app.id)) {
      database.exec("ROLLBACK");
      return false;
    }

    const update = database.prepare("UPDATE apps SET sort_order = ? WHERE id = ?");
    orderedIds.forEach((id, sortOrder) => update.run(sortOrder, id));
    database.exec("COMMIT");
    return true;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function findApp(id: string) {
  const row = getDatabase().prepare("SELECT * FROM apps WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? fromRow(row) : undefined;
}

export function getHealthPersistenceSnapshot(id: string, target: string): HealthPersistenceSnapshot | undefined {
  const row = getDatabase().prepare("SELECT rowid, health_generation, url, health_url, allow_insecure_tls, casaos_scheme, casaos_hostname, casaos_port_map, casaos_index FROM apps WHERE id = ?").get(id) as {
    rowid?: number;
    health_generation?: string | null;
    url?: string;
    health_url?: string | null;
    allow_insecure_tls?: number;
    casaos_scheme?: string | null;
    casaos_hostname?: string | null;
    casaos_port_map?: string | null;
    casaos_index?: string | null;
  } | undefined;
  if (!row?.rowid || typeof row.health_generation !== "string" || !row.health_generation || typeof row.url !== "string") return undefined;
  const healthRow: HealthPersistenceRow = {
    rowVersion: Number(row.rowid),
    recordGeneration: row.health_generation,
    allowInsecureTls: row.allow_insecure_tls === 1,
    url: row.url,
    healthUrl: row.health_url ?? null,
    casaosScheme: row.casaos_scheme ?? null,
    casaosHostname: row.casaos_hostname ?? null,
    casaosPortMap: row.casaos_port_map ?? null,
    casaosIndex: row.casaos_index ?? null,
  };
  return createHealthPersistenceSnapshot(healthRow, target);
}

export function updateAppStatusIfHealthSnapshotMatches(id: string, status: AppStatus, started: HealthPersistenceSnapshot) {
  const database = getDatabase();
  const app = database.prepare("SELECT name, status, rowid, health_generation, url, health_url, allow_insecure_tls, casaos_scheme, casaos_hostname, casaos_port_map, casaos_index FROM apps WHERE id = ?").get(id) as {
    name?: string;
    status?: AppStatus;
    rowid?: number;
    health_generation?: string | null;
    url?: string;
    health_url?: string | null;
    allow_insecure_tls?: number;
    casaos_scheme?: string | null;
    casaos_hostname?: string | null;
    casaos_port_map?: string | null;
    casaos_index?: string | null;
  } | undefined;
  if (!app?.name || typeof app.rowid !== "number" || typeof app.health_generation !== "string" || !app.health_generation || typeof app.url !== "string") return false;
  const current = createHealthPersistenceSnapshot({
    rowVersion: Number(app.rowid),
    recordGeneration: app.health_generation,
    allowInsecureTls: app.allow_insecure_tls === 1,
    url: app.url,
    healthUrl: app.health_url ?? null,
    casaosScheme: app.casaos_scheme ?? null,
    casaosHostname: app.casaos_hostname ?? null,
    casaosPortMap: app.casaos_port_map ?? null,
    casaosIndex: app.casaos_index ?? null,
  }, started.target);
  if (!canPersistHealthResult(started, current) || app.status === status) return false;
  const result = database.prepare(`UPDATE apps SET status = ?
    WHERE id = ? AND rowid = ? AND status IS NOT ?
      AND url = ? AND health_url IS ? AND allow_insecure_tls IS ? AND health_generation IS ?
      AND casaos_scheme IS ? AND casaos_hostname IS ? AND casaos_port_map IS ? AND casaos_index IS ?`).run(
    status,
    id,
    started.rowVersion,
    status,
    started.url,
    started.healthUrl,
    started.allowInsecureTls ? 1 : 0,
    started.recordGeneration,
    started.casaosScheme,
    started.casaosHostname,
    started.casaosPortMap,
    started.casaosIndex,
  );
  if (Number(result.changes) !== 1) return false;
  recordActivity("status-changed", id, app.name, status);
  return true;
}

function getCurrentHealthPersistenceSnapshot(database: DatabaseSync, id: string, target: string, allowInsecureTls: boolean) {
  const row = database.prepare("SELECT rowid, health_generation, url, health_url, allow_insecure_tls, casaos_scheme, casaos_hostname, casaos_port_map, casaos_index FROM apps WHERE id = ?").get(id) as {
    rowid?: number;
    health_generation?: string | null;
    url?: string;
    health_url?: string | null;
    allow_insecure_tls?: number;
    casaos_scheme?: string | null;
    casaos_hostname?: string | null;
    casaos_port_map?: string | null;
    casaos_index?: string | null;
  } | undefined;
  if (!row?.rowid || typeof row.health_generation !== "string" || !row.health_generation || typeof row.url !== "string") return undefined;
  const healthRow: HealthPersistenceRow = {
    rowVersion: Number(row.rowid),
    recordGeneration: row.health_generation,
    allowInsecureTls: row.allow_insecure_tls === 1,
    url: row.url,
    healthUrl: row.health_url ?? null,
    casaosScheme: row.casaos_scheme ?? null,
    casaosHostname: row.casaos_hostname ?? null,
    casaosPortMap: row.casaos_port_map ?? null,
    casaosIndex: row.casaos_index ?? null,
  };
  return createHealthPersistenceSnapshot(healthRow, target);
}

export function saveApp(app: ManagedApp) {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  let existing: {
    id?: string;
    status?: AppStatus;
    sort_order?: number;
    health_generation?: string | null;
    docker_project?: string | null;
    docker_service?: string | null;
  } | undefined;
  let persistedApp: ManagedApp;
  try {
    existing = database.prepare("SELECT id, status, sort_order, health_generation, docker_project, docker_service FROM apps WHERE id = ?").get(app.id) as typeof existing;
    if (existing) {
      persistedApp = { ...app, status: existing.status || app.status, sortOrder: existing.sort_order ?? app.sortOrder };
    } else {
      const nextSortOrder = (database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM apps").get() as { next_sort_order: number }).next_sort_order;
      persistedApp = { ...app, sortOrder: nextSortOrder };
    }
    const healthGeneration = existing && existing.health_generation && existing.health_generation.length > 0
      ? existing.health_generation
      : createHealthGeneration();
    if (existing && (normalizeLinkValue(existing.docker_project) !== normalizeLinkValue(app.dockerProject)
      || normalizeLinkValue(existing.docker_service) !== normalizeLinkValue(app.dockerService))) {
      persistedApp = clearDockerMetadata(persistedApp);
    }
    database.prepare(`INSERT INTO apps (id, name, description, category, url, icon, color, health_url, allow_insecure_tls, status, source, is_visible, sort_order, docker_project, docker_service, container_id, container_name, container_image, container_state, container_health, container_started_at, container_observed_at, casaos_scheme, casaos_hostname, casaos_port_map, casaos_index, health_generation)
      VALUES (@id, @name, @description, @category, @url, @icon, @color, @healthUrl, @allowInsecureTls, @status, @source, @isVisible, @sortOrder, @dockerProject, @dockerService, @containerId, @containerName, @containerImage, @containerState, @containerHealth, @containerStartedAt, @containerObservedAt, @casaosScheme, @casaosHostname, @casaosPortMap, @casaosIndex, @healthGeneration)
      ON CONFLICT(id) DO UPDATE SET name=@name, description=@description, category=@category, url=@url, icon=@icon, color=@color, health_url=@healthUrl, allow_insecure_tls=@allowInsecureTls, status=@status, source=@source, is_visible=@isVisible, docker_project=@dockerProject, docker_service=@dockerService, container_id=@containerId, container_name=@containerName, container_image=@containerImage, container_state=@containerState, container_health=@containerHealth, container_started_at=@containerStartedAt, container_observed_at=@containerObservedAt, casaos_scheme=@casaosScheme, casaos_hostname=@casaosHostname, casaos_port_map=@casaosPortMap, casaos_index=@casaosIndex, health_generation=@healthGeneration`).run({ ...toDatabaseRow(persistedApp), healthGeneration });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  recordActivity(existing ? "app-updated" : "app-created", persistedApp.id, persistedApp.name);
  return persistedApp;
}

export function reconcileDockerApps(containers: DockerContainer[], options: { preserveUnmatched?: boolean } = {}) {
  const database = getDatabase();
  const apps = listApps();
  const claimed = new Set<string>();
  let didChange = false;
  for (const app of apps) {
    const container = findContainerForApp(app, containers, claimed);
    if (container) {
      claimed.add(container.id);
      const casaos = container.casaos;
      const nextMetadata = {
        dockerProject: container.compose.project || app.dockerProject || null,
        dockerService: container.compose.service || app.dockerService || null,
        containerId: container.id,
        containerName: container.name,
        containerImage: container.image,
        containerState: container.state,
        containerHealth: container.health,
        containerStartedAt: container.startedAt,
        casaosScheme: casaos?.scheme || app.casaosScheme || null,
        casaosHostname: casaos?.hostname || app.casaosHostname || null,
        casaosPortMap: casaos?.portMap || app.casaosPortMap || null,
        casaosIndex: casaos?.index || app.casaosIndex || null,
      };
      const metadataChanged = nextMetadata.dockerProject !== (app.dockerProject || null)
        || nextMetadata.dockerService !== (app.dockerService || null)
        || nextMetadata.containerId !== (app.containerId || null)
        || nextMetadata.containerName !== (app.containerName || null)
        || nextMetadata.containerImage !== (app.containerImage || null)
        || nextMetadata.containerState !== (app.containerState || "unknown")
        || nextMetadata.containerHealth !== (app.containerHealth || "unknown")
        || nextMetadata.containerStartedAt !== (app.containerStartedAt || null)
        || nextMetadata.casaosScheme !== (app.casaosScheme || null)
        || nextMetadata.casaosHostname !== (app.casaosHostname || null)
        || nextMetadata.casaosPortMap !== (app.casaosPortMap || null)
        || nextMetadata.casaosIndex !== (app.casaosIndex || null);
      if (!metadataChanged) continue;
      didChange = true;
      database.prepare(`UPDATE apps SET docker_project = ?, docker_service = ?, container_id = ?, container_name = ?, container_image = ?, container_state = ?, container_health = ?, container_started_at = ?, container_observed_at = ?, casaos_scheme = ?, casaos_hostname = ?, casaos_port_map = ?, casaos_index = ? WHERE id = ?`).run(
        nextMetadata.dockerProject,
        nextMetadata.dockerService,
        nextMetadata.containerId,
        nextMetadata.containerName,
        nextMetadata.containerImage,
        nextMetadata.containerState,
        nextMetadata.containerHealth,
        nextMetadata.containerStartedAt,
        new Date().toISOString(),
        nextMetadata.casaosScheme,
        nextMetadata.casaosHostname,
        nextMetadata.casaosPortMap,
        nextMetadata.casaosIndex,
        app.id,
      );
    } else if (!options.preserveUnmatched && hasDockerMetadata(app)) {
      const changed = Boolean(app.containerId || app.containerName || app.containerImage || app.containerStartedAt || app.containerObservedAt
        || app.casaosScheme || app.casaosHostname || app.casaosPortMap || app.casaosIndex
        || (app.containerState && app.containerState !== "unknown")
        || (app.containerHealth && app.containerHealth !== "unknown"));
      if (!changed) continue;
      didChange = true;
      database.prepare(`UPDATE apps SET container_id = NULL, container_name = NULL, container_image = NULL, container_state = 'unknown', container_health = 'unknown', container_started_at = NULL, container_observed_at = NULL, casaos_scheme = NULL, casaos_hostname = NULL, casaos_port_map = NULL, casaos_index = NULL WHERE id = ?`).run(app.id);
    }
  }
  return didChange ? listApps() : apps;
}

export function removeApp(id: string) {
  const database = getDatabase();
  const app = database.prepare("SELECT name FROM apps WHERE id = ?").get(id) as { name?: string } | undefined;
  database.prepare("DELETE FROM apps WHERE id = ?").run(id);
  if (app?.name) recordActivity("app-deleted", id, app.name);
}

export function updateAppStatus(id: string, status: AppStatus) {
  const database = getDatabase();
  const app = database.prepare("SELECT name, status FROM apps WHERE id = ?").get(id) as { name?: string; status?: AppStatus } | undefined;
  if (!app?.name || app.status === status) return;
  const result = database.prepare("UPDATE apps SET status = ? WHERE id = ? AND status IS NOT ?").run(status, id, status);
  if (Number(result.changes) !== 1) return;
  recordActivity("status-changed", id, app.name, status);
}

export function listActivities(limit = 5): ActivityEvent[] {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 5;
  const rows = getDatabase().prepare(`SELECT id, type, app_id, app_name, status, created_at
    FROM activities ORDER BY created_at DESC, id DESC LIMIT ?`).all(normalizedLimit) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: Number(row.id),
    type: row.type as ActivityType,
    appId: row.app_id ? String(row.app_id) : undefined,
    appName: String(row.app_name),
    status: row.status ? row.status as AppStatus : undefined,
    createdAt: String(row.created_at),
  }));
}

export function recordMetricSnapshot(snapshot: HistoricalMetric, retentionDays: number) {
  const database = getDatabase();
  database.prepare(`INSERT INTO metric_snapshots (recorded_at, cpu, memory, storage, temperature_c, power_watts)
    VALUES (?, ?, ?, ?, ?, ?)`).run(snapshot.timestamp, snapshot.cpu, snapshot.memory, snapshot.storage, snapshot.temperatureC, snapshot.powerWatts);
  database.prepare("DELETE FROM metric_snapshots WHERE recorded_at < ?").run(new Date(Date.now() - retentionDays * 86_400_000).toISOString());
}

export function listMetricSnapshots(since: string): HistoricalMetric[] {
  const rows = getDatabase().prepare(`SELECT recorded_at, cpu, memory, storage, temperature_c, power_watts
    FROM metric_snapshots WHERE recorded_at >= ? ORDER BY recorded_at ASC`).all(since) as Record<string, unknown>[];
  return rows.map((row) => ({
    timestamp: String(row.recorded_at),
    cpu: Number(row.cpu),
    memory: Number(row.memory),
    storage: Number(row.storage),
    temperatureC: row.temperature_c === null ? null : Number(row.temperature_c),
    powerWatts: row.power_watts === null ? null : Number(row.power_watts),
  }));
}

function recordActivity(type: ActivityType, appId: string, appName: string, status?: AppStatus) {
  const database = getDatabase();
  database.prepare(`INSERT INTO activities (type, app_id, app_name, status, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(type, appId, appName, status ?? null, new Date().toISOString());
  pruneActivities(database);
}


function addColumnIfMissing(database: DatabaseSync, columns: { name?: unknown }[], name: string, definition: string) {
  if (!columns.some((column) => column.name === name)) database.exec(`ALTER TABLE apps ADD COLUMN ${name} ${definition}`);
}

function createHealthGeneration() {
  return randomUUID();
}

function clearDockerMetadata(app: ManagedApp): ManagedApp {
  return {
    ...app,
    containerId: undefined,
    containerName: undefined,
    containerImage: undefined,
    containerState: undefined,
    containerHealth: undefined,
    containerStartedAt: undefined,
    containerObservedAt: undefined,
    casaosScheme: undefined,
    casaosHostname: undefined,
    casaosPortMap: undefined,
    casaosIndex: undefined,
  };
}

function normalizeLinkValue(value: string | null | undefined) {
  return value?.trim() || "";
}

function hasDockerMetadata(app: ManagedApp) {
  const clearable = hasStaleDockerMetadata(app);
  return clearable;
}

function findContainerForApp(app: ManagedApp, containers: DockerContainer[], claimed: Set<string>) {
  const candidates = containers.filter((container) => !claimed.has(container.id));
  if (app.containerId) {
    const byId = candidates.find((container) => container.id === app.containerId);
    if (byId) return byId;
  }
  if (app.dockerProject && app.dockerService) {
    return candidates.find((container) => container.compose.project === app.dockerProject && container.compose.service === app.dockerService);
  }
  const byLabel = candidates.find((container) => container.labels["com.nimbus.app-id"] === app.id);
  if (byLabel) return byLabel;
  if (app.dockerService) {
    const serviceMatches = candidates.filter((container) => container.compose.service === app.dockerService);
    if (serviceMatches.length === 1) return serviceMatches[0];
    if (serviceMatches.length > 1) return undefined;
  }
  const normalizedIds = new Set([normalizeIdentifier(app.id), normalizeIdentifier(app.name)].filter(Boolean));
  if (app.dockerProject) {
    const projectMatches = candidates.filter((container) => container.compose.project === app.dockerProject);
    if (projectMatches.length === 1) return projectMatches[0];
    const exactProjectMatch = projectMatches.filter((container) => {
      const values = [container.name, container.compose.service].map((value) => normalizeIdentifier(value || ""));
      return values.some((value) => value && normalizedIds.has(value));
    });
    if (exactProjectMatch.length === 1) return exactProjectMatch[0];
    if (projectMatches.length > 1) return undefined;
    if (projectMatches.length === 0) return undefined;
  }
  const exact = candidates.filter((container) => {
    const values = [container.name, container.compose.project, container.compose.service].map((value) => normalizeIdentifier(value || ""));
    return values.some((value) => value && normalizedIds.has(value));
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return chooseProjectContainer(exact, normalizedIds);
  const loose = candidates.filter((container) => {
    const values = [container.name, container.compose.project, container.compose.service].map((value) => normalizeIdentifier(value || ""));
    return values.some((value) => value && [...normalizedIds].some((id) => value.startsWith(id) || id.startsWith(value)));
  });
  if (loose.length === 1) return loose[0];
  return undefined;
}

function chooseProjectContainer(containers: DockerContainer[], normalizedIds: Set<string>) {
  return [...containers].sort((left, right) => containerMatchScore(right, normalizedIds) - containerMatchScore(left, normalizedIds))[0];
}

function containerMatchScore(container: DockerContainer, normalizedIds: Set<string>) {
  const service = normalizeIdentifier(container.compose.service || "");
  const name = normalizeIdentifier(container.name);
  return (container.casaos ? 100 : 0)
    + (container.state === "running" ? 20 : 0)
    + (normalizedIds.has(service) ? 50 : 0)
    + (normalizedIds.has(name) ? 40 : 0)
    + (service.includes("server") || service.includes("web") || service.includes("app") ? 10 : 0);
}

function normalizeIdentifier(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeContainerState(value: unknown): DockerContainerState {
  return ["created", "restarting", "running", "removing", "paused", "exited", "dead", "unknown"].includes(String(value))
    ? value as DockerContainerState
    : "unknown";
}

function normalizeContainerHealth(value: unknown): DockerHealthState {
  return ["healthy", "unhealthy", "starting", "none", "unknown"].includes(String(value))
    ? value as DockerHealthState
    : "unknown";
}
