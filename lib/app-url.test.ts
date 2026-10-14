import assert from "node:assert/strict";
import test from "node:test";
import { getAppUrlParts, isHostLocalService, resolveAppLaunchUrl, updateAppUrl } from "./app-url.ts";

const dockerApp = {
  url: "http://192.168.2.116:2283/photos",
  dockerProject: "immich",
  dockerService: "immich-server",
  containerId: undefined,
  dockerDetails: undefined,
};

test("uses the current Nimbus host for Docker-backed app links", () => {
  assert.equal(resolveAppLaunchUrl(dockerApp, "100.123.45.66"), "http://100.123.45.66:2283/photos");
  assert.equal(resolveAppLaunchUrl(dockerApp, "192.168.2.116"), dockerApp.url);
});

test("keeps non-local app links unchanged", () => {
  assert.equal(resolveAppLaunchUrl({ ...dockerApp, dockerProject: undefined, dockerService: undefined }, "100.123.45.66"), dockerApp.url);
});

test("parses and updates the editable Web UI URL parts", () => {
  assert.deepEqual(getAppUrlParts("https://192.168.2.116:8443/crafty"), { protocol: "https", host: "192.168.2.116", port: "8443" });
  assert.equal(updateAppUrl(dockerApp.url, "https", "100.123.45.66", "9443"), "https://100.123.45.66:9443/photos");
  assert.equal(updateAppUrl("", "http", "100.123.45.66", "2283"), "http://100.123.45.66:2283/");
});

test("identifies only host-local application records", () => {
  assert.equal(isHostLocalService(dockerApp), true);
  assert.equal(isHostLocalService({ dockerDetails: undefined, containerId: undefined, dockerProject: undefined, dockerService: undefined }), false);
});

test("round-trips arbitrary app IDs through safe route tokens", async () => {
  const routeCodec = await import("./app-url.ts") as unknown as {
    encodeAppRouteId?: (id: string) => string;
    decodeAppRouteId?: (token: string) => string | undefined;
  };
  for (const [id, token] of [
    [".", "002e"],
    ["..", "002e002e"],
    ["other/a b", "006f0074006800650072002f006100200062"],
    ["📷", "d83ddcf7"],
  ]) {
    assert.equal(routeCodec.encodeAppRouteId?.(id), token);
    assert.equal(routeCodec.decodeAppRouteId?.(token), id);
  }
});

test("rejects malformed app route tokens", async () => {
  const routeCodec = await import("./app-url.ts") as unknown as {
    decodeAppRouteId?: (token: string) => string | undefined;
  };
  for (const token of ["", "2e", "zzzz", "002e/", "002E"]) assert.equal(routeCodec.decodeAppRouteId?.(token), undefined);
});
