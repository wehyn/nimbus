import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function getFreePort() {
  const server = https.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
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
      if ((await fetch(`${baseUrl}/api/apps`)).ok) return { baseUrl, child };
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stopNextServer(child);
  throw new Error(`Timed out waiting for Next server: ${stderr}`);
}

async function stopNextServer(child: ChildProcess) {
  if (child.exitCode === null) child.kill("SIGTERM");
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([once(child, "exit"), new Promise((resolve) => { timeout = setTimeout(resolve, 5_000); })]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

test("returns offline when an allowed self-signed TLS health check times out", async () => {
  const root = mkdtempSync(join(tmpdir(), "nimbus-health-timeout-"));
  const keyPath = join(root, "key.pem");
  const certificatePath = join(root, "certificate.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certificatePath, "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  const tlsServer = https.createServer({ key: readFileSync(keyPath), cert: readFileSync(certificatePath) }, () => {});
  tlsServer.listen(0, "127.0.0.1");
  await once(tlsServer, "listening");
  const address = tlsServer.address();
  assert.ok(address && typeof address !== "string");

  let child: ChildProcess | undefined;
  try {
    const server = await startNextServer(join(root, "health.db"));
    child = server.child;
    const saveResponse = await fetch(`${server.baseUrl}/api/apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "stalled-tls", name: "Stalled TLS", description: "", category: "Other",
        url: `https://127.0.0.1:${address.port}`, color: "#65e6a5", status: "unknown",
        source: "manual", isVisible: true, sortOrder: 0, allowInsecureTls: true,
      }),
    });
    assert.equal(saveResponse.ok, true, await saveResponse.text());

    let deadlineTimer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => { deadlineTimer = setTimeout(() => reject(new Error("Health route did not settle within 12 seconds")), 12_000); });
    let response: Response;
    try {
      response = await Promise.race([fetch(`${server.baseUrl}/api/health?id=stalled-tls`), deadline]);
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "offline" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  } finally {
    if (child) await stopNextServer(child);
    tlsServer.closeAllConnections();
    await new Promise<void>((resolve) => tlsServer.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
