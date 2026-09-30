import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("default Compose is project-scoped and keeps host binding configurable", () => {
  const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
  assert.match(compose, /- "\$\{NIMBUS_BIND_ADDRESS:-0\.0\.0\.0\}:\$\{NIMBUS_PORT:-10000\}:10000"/);
  assert.match(compose, /\n      HOSTNAME: 0\.0\.0\.0\n/);
  assert.doesNotMatch(compose, /container_name:/);
  assert.doesNotMatch(compose, /var\/run\/docker\.sock/);
  assert.match(compose, /\n      PROC_ROOT: \/host\/proc\n/);
  assert.match(compose, /\n      STORAGE_ROOT: \/host\/storage\n/);
  assert.doesNotMatch(compose, /source: \/\n\s+target:/);
});

test("the optional Docker override remains explicitly read-only", () => {
  const override = readFileSync(join(root, "docker-compose.docker.yml"), "utf8");
  assert.match(override, /target: \/var\/run\/docker\.sock/);
  assert.match(override, /read_only: true/);
});
