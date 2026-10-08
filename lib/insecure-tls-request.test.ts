import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { requestWithInsecureTls } from "./insecure-tls-request.ts";

test("settles a self-signed TLS request promptly when its caller aborts", async () => {
  const root = mkdtempSync(join(tmpdir(), "nimbus-tls-abort-"));
  const keyPath = join(root, "key.pem");
  const certificatePath = join(root, "certificate.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certificatePath, "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  const tlsServer = https.createServer({ key: readFileSync(keyPath), cert: readFileSync(certificatePath) }, () => {});
  tlsServer.listen(0, "127.0.0.1");
  await once(tlsServer, "listening");
  const address = tlsServer.address();
  assert.ok(address && typeof address !== "string");

  try {
    const controller = new AbortController();
    const request = requestWithInsecureTls(new URL(`https://127.0.0.1:${address.port}`), controller.signal);
    await once(tlsServer, "request");
    controller.abort();

    let deadlineTimer: NodeJS.Timeout | undefined;
    const deadline = new Promise<"late">((resolve) => { deadlineTimer = setTimeout(() => resolve("late"), 1000); });
    try {
      const outcome = await Promise.race([request.then(() => "resolved" as const, () => "rejected" as const), deadline]);
      assert.equal(outcome, "rejected", "TLS request did not reject within 1 second of abort");
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
  } finally {
    tlsServer.closeAllConnections();
    await new Promise<void>((resolve) => tlsServer.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
