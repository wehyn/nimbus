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

test("persists only complete application orders through the apps API", async () => {
  const root = mkdtempSync(join(tmpdir(), "nimbus-app-order-"));
  const databasePath = join(root, "apps.db");
  let child: ChildProcess | undefined;

  try {
    const server = await startNextServer(databasePath);
    child = server.child;
    const initialResponse = await fetch(`${server.baseUrl}/api/apps`);
    const initialData = await initialResponse.json() as { apps: Array<{ id: string }> };
    const orderedIds = initialData.apps.map((app) => app.id).reverse();
    const response = await fetch(`${server.baseUrl}/api/apps`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    assert.equal(response.status, 200);

    const invalidResponse = await fetch(`${server.baseUrl}/api/apps`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: orderedIds.slice(1) }),
    });
    assert.equal(invalidResponse.status, 400);

    const savedResponse = await fetch(`${server.baseUrl}/api/apps`);
    const savedData = await savedResponse.json() as { apps: Array<{ id: string }> };
    assert.deepEqual(savedData.apps.map((app) => app.id), orderedIds);
  } finally {
    if (child) await stopNextServer(child);
    rmSync(root, { recursive: true, force: true });
  }
});
