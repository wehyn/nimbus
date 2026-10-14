import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const databaseSchema = `
  CREATE TABLE apps (
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
  );
`;

async function getFreePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startNextServer(databasePath: string) {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development", DATABASE_PATH: databasePath, DOCKER_AGENT_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next server exited before readiness: ${stderr}`);
    try {
      const response = await fetch(`${baseUrl}/api/apps`);
      if (response.ok) return { baseUrl, child };
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  stopNextServer(child);
  throw new Error(`Timed out waiting for Next server: ${stderr}`);
}

async function stopNextServer(child: ChildProcess) {
  if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

function appColumn(database: DatabaseSync, name: string) {
  return (database.prepare("PRAGMA table_info(apps)").all() as { name?: unknown }[]).some((column) => column.name === name);
}

test("reads and updates a legacy database without exposing the inert schema column", async () => {
  const root = mkdtempSync(join(tmpdir(), "nimbus-db-compat-"));
  const databasePath = join(root, "legacy.db");
  const database = new DatabaseSync(databasePath);
  database.exec(databaseSchema);
  database.prepare(`INSERT INTO apps (
    id, name, description, category, url, icon, color, health_url, allow_insecure_tls,
    status, source, is_favorite, is_visible, sort_order, container_state, container_health, health_generation
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "legacy", "Legacy app", "Old record", "Other", "http://legacy.local", null, "#65e6a5", null, 0,
    "online", "manual", 1, 1, 0, "unknown", "unknown", "legacy-generation",
  );
  database.close();

  let child: ChildProcess | undefined;
  try {
    const server = await startNextServer(databasePath);
    child = server.child;
    const response = await fetch(`${server.baseUrl}/api/apps`);
    const data = await response.json() as { apps: Array<Record<string, unknown>> };
    assert.equal(data.apps[0].name, "Legacy app");
    assert.equal(Object.prototype.hasOwnProperty.call(data.apps[0], "isFavorite"), false);

    const savedResponse = await fetch(`${server.baseUrl}/api/apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data.apps[0], name: "Updated legacy app", isFavorite: true }),
    });
    const savedData = await savedResponse.json() as { app?: Record<string, unknown> };
    assert.equal(savedResponse.ok, true);
    assert.equal(savedData.app?.name, "Updated legacy app");
    assert.equal(Object.prototype.hasOwnProperty.call(savedData.app, "isFavorite"), false);
  } finally {
    if (child) await stopNextServer(child);
    const reopened = new DatabaseSync(databasePath);
    const row = reopened.prepare("SELECT name, is_favorite FROM apps WHERE id = ?").get("legacy") as { name: string; is_favorite: number };
    assert.deepEqual({ ...row }, { name: "Updated legacy app", is_favorite: 1 });
    assert.equal(appColumn(reopened, "is_favorite"), true);
    reopened.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps the inert column on a newly initialized database", async () => {
  const root = mkdtempSync(join(tmpdir(), "nimbus-db-fresh-"));
  const databasePath = join(root, "fresh.db");
  let child: ChildProcess | undefined;

  try {
    const server = await startNextServer(databasePath);
    child = server.child;
    const response = await fetch(`${server.baseUrl}/api/apps`);
    const data = await response.json() as { apps: Array<Record<string, unknown>> };
    assert.equal(data.apps.length, 8);
    assert.equal(Object.prototype.hasOwnProperty.call(data.apps[0], "isFavorite"), false);
  } finally {
    if (child) await stopNextServer(child);
    const database = new DatabaseSync(databasePath);
    assert.equal(appColumn(database, "is_favorite"), true);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM apps WHERE is_favorite <> 0").get()?.count, 0);
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects stale app orders and preserves order across stale edits", async () => {
  const root = mkdtempSync(join(tmpdir(), "nimbus-app-order-"));
  const databasePath = join(root, "apps.db");
  let child: ChildProcess | undefined;

  try {
    const server = await startNextServer(databasePath);
    child = server.child;
    const initialResponse = await fetch(`${server.baseUrl}/api/apps`);
    const initialData = await initialResponse.json() as { apps: Array<{ id: string; isVisible: boolean; sortOrder: number; description: string; [key: string]: unknown }> };
    const expectedIds = initialData.apps.map((app) => app.id);
    const expectedVisibleIds = initialData.apps.filter((app) => app.isVisible).map((app) => app.id);
    assert.ok(expectedVisibleIds.length > 1);
    const orderedVisibleIds = [...expectedVisibleIds].reverse();
    let visibleIndex = 0;
    const orderedIds = initialData.apps.map((app) => app.isVisible ? orderedVisibleIds[visibleIndex++] : app.id);
    const response = await fetch(`${server.baseUrl}/api/apps`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedIds, expectedVisibleIds, orderedIds }),
    });
    assert.equal(response.status, 200);

    const staleVisibleIds = [...expectedVisibleIds];
    [staleVisibleIds[0], staleVisibleIds[1]] = [staleVisibleIds[1], staleVisibleIds[0]];
    visibleIndex = 0;
    const staleOrderedIds = initialData.apps.map((app) => app.isVisible ? staleVisibleIds[visibleIndex++] : app.id);
    const staleOrderResponse = await fetch(`${server.baseUrl}/api/apps`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedIds, expectedVisibleIds, orderedIds: staleOrderedIds }),
    });
    assert.equal(staleOrderResponse.status, 409);

    const afterStaleOrderResponse = await fetch(`${server.baseUrl}/api/apps`);
    const afterStaleOrder = await afterStaleOrderResponse.json() as { apps: Array<{ id: string }> };
    assert.deepEqual(afterStaleOrder.apps.map((app) => app.id), orderedIds);

    const invalidResponse = await fetch(`${server.baseUrl}/api/apps`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedIds: orderedIds, expectedVisibleIds, orderedIds: orderedIds.slice(1) }),
    });
    assert.equal(invalidResponse.status, 400);

    const staleApp = { ...initialData.apps[0], description: "Edited from a stale tab" };
    const expectedSortOrder = orderedIds.indexOf(staleApp.id);
    const editResponse = await fetch(`${server.baseUrl}/api/apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(staleApp),
    });
    assert.equal(editResponse.status, 200);
    const editData = await editResponse.json() as { app: { sortOrder: number } };
    assert.equal(editData.app.sortOrder, expectedSortOrder);

    const savedResponse = await fetch(`${server.baseUrl}/api/apps`);
    const savedData = await savedResponse.json() as { apps: Array<{ id: string; sortOrder: number; description: string }> };
    assert.deepEqual(savedData.apps.map((app) => app.id), orderedIds);
    assert.equal(savedData.apps.find((app) => app.id === staleApp.id)?.sortOrder, expectedSortOrder);
    assert.equal(savedData.apps.find((app) => app.id === staleApp.id)?.description, "Edited from a stale tab");
  } finally {
    if (child) await stopNextServer(child);
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects reorder requests that move hidden application slots", async () => {
  const root = mkdtempSync(join(tmpdir(), "nimbus-hidden-order-"));
  const databasePath = join(root, "apps.db");
  let child: ChildProcess | undefined;

  try {
    const server = await startNextServer(databasePath);
    child = server.child;
    const initialResponse = await fetch(`${server.baseUrl}/api/apps`);
    const initialData = await initialResponse.json() as { apps: Array<{ id: string; isVisible: boolean; [key: string]: unknown }> };
    const appToHide = initialData.apps.find((app) => app.isVisible);
    assert.ok(appToHide);
    const hideResponse = await fetch(`${server.baseUrl}/api/apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...appToHide, isVisible: false }),
    });
    assert.equal(hideResponse.status, 200);

    const snapshotResponse = await fetch(`${server.baseUrl}/api/apps`);
    const snapshot = await snapshotResponse.json() as { apps: Array<{ id: string; isVisible: boolean }> };
    const expectedIds = snapshot.apps.map((app) => app.id);
    const expectedVisibleIds = snapshot.apps.filter((app) => app.isVisible).map((app) => app.id);
    const hiddenIndex = snapshot.apps.findIndex((app) => !app.isVisible);
    const neighborIndex = hiddenIndex === 0 ? 1 : hiddenIndex - 1;
    const orderedIds = [...expectedIds];
    [orderedIds[hiddenIndex], orderedIds[neighborIndex]] = [orderedIds[neighborIndex], orderedIds[hiddenIndex]];

    const reorderResponse = await fetch(`${server.baseUrl}/api/apps`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedIds, expectedVisibleIds, orderedIds }),
    });
    assert.equal(reorderResponse.status, 409);

    const savedResponse = await fetch(`${server.baseUrl}/api/apps`);
    const savedData = await savedResponse.json() as { apps: Array<{ id: string }> };
    assert.deepEqual(savedData.apps.map((app) => app.id), expectedIds);
  } finally {
    if (child) await stopNextServer(child);
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects stale visibility snapshots without changing app order", async () => {
  const root = mkdtempSync(join(tmpdir(), "nimbus-visibility-order-"));
  const databasePath = join(root, "apps.db");
  let child: ChildProcess | undefined;

  try {
    const server = await startNextServer(databasePath);
    child = server.child;
    const initialResponse = await fetch(`${server.baseUrl}/api/apps`);
    const initialData = await initialResponse.json() as { apps: Array<{ id: string; isVisible: boolean; [key: string]: unknown }> };
    const expectedIds = initialData.apps.map((app) => app.id);
    const expectedVisibleIds = initialData.apps.filter((app) => app.isVisible).map((app) => app.id);
    assert.ok(expectedVisibleIds.length > 1);
    const appToHide = initialData.apps.find((app) => app.id === expectedVisibleIds[0]);
    assert.ok(appToHide);

    const hideResponse = await fetch(`${server.baseUrl}/api/apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...appToHide, isVisible: false }),
    });
    assert.equal(hideResponse.status, 200);

    const staleOrderedIds = [...expectedIds];
    const firstVisibleIndex = expectedIds.indexOf(expectedVisibleIds[0]);
    const secondVisibleIndex = expectedIds.indexOf(expectedVisibleIds[1]);
    [staleOrderedIds[firstVisibleIndex], staleOrderedIds[secondVisibleIndex]] = [staleOrderedIds[secondVisibleIndex], staleOrderedIds[firstVisibleIndex]];
    const reorderResponse = await fetch(`${server.baseUrl}/api/apps`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedIds, expectedVisibleIds, orderedIds: staleOrderedIds }),
    });
    assert.equal(reorderResponse.status, 409);

    const savedResponse = await fetch(`${server.baseUrl}/api/apps`);
    const savedData = await savedResponse.json() as { apps: Array<{ id: string }> };
    assert.deepEqual(savedData.apps.map((app) => app.id), expectedIds);
  } finally {
    if (child) await stopNextServer(child);
    rmSync(root, { recursive: true, force: true });
  }
});

test("assigns new apps distinct positions when clients submit the same stale order", async () => {
  const root = mkdtempSync(join(tmpdir(), "nimbus-add-order-"));
  const databasePath = join(root, "apps.db");
  let child: ChildProcess | undefined;

  try {
    const server = await startNextServer(databasePath);
    child = server.child;
    const initialResponse = await fetch(`${server.baseUrl}/api/apps`);
    const initialData = await initialResponse.json() as { apps: Array<{ id: string; sortOrder: number; [key: string]: unknown }> };
    const staleSortOrder = Math.max(...initialData.apps.map((app) => app.sortOrder)) + 1;
    const firstApp = { ...initialData.apps[0], id: "parallel-add-alpha", name: "Parallel add Alpha", sortOrder: staleSortOrder };
    const secondApp = { ...initialData.apps[0], id: "parallel-add-beta", name: "Parallel add Beta", sortOrder: staleSortOrder };
    const responses = await Promise.all([firstApp, secondApp].map((app) => fetch(`${server.baseUrl}/api/apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(app),
    })));
    const savedApps = await Promise.all(responses.map((response) => response.json() as Promise<{ app: { sortOrder: number } }>));

    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    assert.deepEqual(savedApps.map((result) => result.app.sortOrder).sort((left, right) => left - right), [staleSortOrder, staleSortOrder + 1]);
  } finally {
    if (child) await stopNextServer(child);
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps legacy tied app positions stable after a rename", async () => {
  const root = mkdtempSync(join(tmpdir(), "nimbus-tied-order-"));
  const databasePath = join(root, "apps.db");
  let child: ChildProcess | undefined;

  try {
    const server = await startNextServer(databasePath);
    child = server.child;
    const initialResponse = await fetch(`${server.baseUrl}/api/apps`);
    const initialData = await initialResponse.json() as { apps: Array<{ id: string; name: string; sortOrder: number; [key: string]: unknown }> };
    assert.ok(initialData.apps.length > 1);
    const [firstApp, secondApp] = initialData.apps;
    const tiedSortOrder = Math.max(...initialData.apps.map((app) => app.sortOrder)) + 1;
    const database = new DatabaseSync(databasePath);
    database.prepare("UPDATE apps SET name = ?, sort_order = ? WHERE id = ?").run("A stable tie", tiedSortOrder, firstApp.id);
    database.prepare("UPDATE apps SET name = ?, sort_order = ? WHERE id = ?").run("B stable tie", tiedSortOrder, secondApp.id);
    database.close();

    const tiedResponse = await fetch(`${server.baseUrl}/api/apps`);
    const tiedData = await tiedResponse.json() as { apps: Array<{ id: string; name: string; sortOrder: number; [key: string]: unknown }> };
    const expectedTieOrder = tiedData.apps.filter((app) => app.sortOrder === tiedSortOrder).map((app) => app.id);
    assert.equal(expectedTieOrder.length, 2);
    const renamedApp = tiedData.apps.find((app) => app.id === firstApp.id);
    assert.ok(renamedApp);

    const renameResponse = await fetch(`${server.baseUrl}/api/apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...renamedApp, name: "Z stable tie" }),
    });
    assert.equal(renameResponse.status, 200);

    const savedResponse = await fetch(`${server.baseUrl}/api/apps`);
    const savedData = await savedResponse.json() as { apps: Array<{ id: string; sortOrder: number }> };
    assert.deepEqual(savedData.apps.filter((app) => app.sortOrder === tiedSortOrder).map((app) => app.id), expectedTieOrder);
  } finally {
    if (child) await stopNextServer(child);
    rmSync(root, { recursive: true, force: true });
  }
});
