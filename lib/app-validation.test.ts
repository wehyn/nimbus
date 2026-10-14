import assert from "node:assert/strict";
import test from "node:test";
import { isWebUrl, parseManagedAppPayload } from "./app-validation.ts";
import { toDatabaseRow } from "./db-row.ts";

const validApp = {
  id: "demo",
  name: "Demo",
  description: "A demo app",
  category: "Productivity",
  url: "http://demo.local",
  icon: "",
  color: "#65e6a5",
  healthUrl: "",
  allowInsecureTls: false,
  status: "unknown",
  source: "manual",
  isVisible: true,
  sortOrder: 0,
};

test("accepts HTTP(S) URLs without credentials and rejects unsafe or malformed URLs", () => {
  for (const value of ["http://example.com", "https://example.com/path?q=1"]) {
    assert.equal(isWebUrl(value), true);
  }
  for (const value of ["file:///tmp/demo", "not a URL", "https://user:pass@example.com"]) {
    assert.equal(isWebUrl(value), false);
  }
});

test("rejects malformed application mutation payloads before database access", () => {
  for (const value of [null, [], {}, { id: "demo", name: "Demo", url: "http://demo.local" }, { ...validApp, sortOrder: NaN }]) {
    assert.equal(parseManagedAppPayload(value), null);
  }
  assert.equal(parseManagedAppPayload({ ...validApp, url: "file:///tmp/demo" }), null);
  assert.equal(parseManagedAppPayload({ ...validApp, icon: "javascript:alert(1)" }), null);
  assert.equal(parseManagedAppPayload({ ...validApp, color: "red" }), null);
});

test("normalizes supported application payload defaults", () => {
  const app = parseManagedAppPayload({ ...validApp, id: " demo ", name: " Demo ", source: undefined, icon: undefined });
  assert.equal(app?.id, "demo");
  assert.equal(app?.name, "Demo");
  assert.equal(app?.source, "manual");
  assert.equal(app?.icon, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(app, "isFavorite"), false);
});

test("accepts and strips stale Favorites fields from rolling clients", () => {
  for (const staleField of ["isFavorite", "is_favorite"]) {
    const app = parseManagedAppPayload({ ...validApp, [staleField]: true });
    assert.ok(app);
    assert.equal(Object.prototype.hasOwnProperty.call(app, "isFavorite"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(app, "is_favorite"), false);
  }
});

test("does not allow a stale favorite field into the database row", () => {
  const row = toDatabaseRow({ ...parseManagedAppPayload(validApp)!, isFavorite: true } as Parameters<typeof toDatabaseRow>[0]);
  assert.equal(Object.prototype.hasOwnProperty.call(row, "isFavorite"), false);
  const snakeCaseRow = toDatabaseRow({ ...parseManagedAppPayload(validApp)!, is_favorite: true } as Parameters<typeof toDatabaseRow>[0] & { is_favorite: boolean });
  assert.equal(Object.prototype.hasOwnProperty.call(snakeCaseRow, "is_favorite"), false);
});

test("strips both legacy Favorite spellings regardless of their value", () => {
  for (const value of [true, false, "stale", 1, null]) {
    const app = parseManagedAppPayload({ ...validApp, isFavorite: value, is_favorite: value });
    assert.ok(app);
    assert.equal("isFavorite" in app, false);
    assert.equal("is_favorite" in app, false);
  }
});
