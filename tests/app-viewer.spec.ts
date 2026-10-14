import { expect, test, type APIRequestContext } from "@playwright/test";

async function getCraftyUrl(request: APIRequestContext) {
  const response = await request.get("/api/apps");
  expect(response.ok()).toBe(true);
  const { apps } = await response.json() as { apps: { id: string; url: string }[] };
  const crafty = apps.find((app) => app.id === "crafty-controller");
  if (!crafty) throw new Error("Crafty Controller is missing from the app registry");
  return crafty.url;
}

test("shows Crafty controls and reloads its intercepted frame", async ({ page, request }) => {
  let frameRequests = 0;
  const craftyUrl = await getCraftyUrl(request);
  await page.route(craftyUrl, async (route) => {
    frameRequests += 1;
    await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Intercepted Crafty</title>" });
  });

  await page.goto("/apps/app-006300720061006600740079002d0063006f006e00740072006f006c006c00650072");

  await expect(page.getByRole("heading", { name: "Crafty Controller" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/");
  const frame = page.locator('iframe[title="Crafty Controller"]');
  await expect(frame).toHaveAttribute("src", craftyUrl);
  await expect(page.getByText(/Some apps block framing or sign-in/i)).toHaveCount(0);
  const externalLink = page.getByRole("link", { name: "Open in new tab" });
  await expect(externalLink).toHaveAttribute("href", craftyUrl);
  await expect(externalLink).toHaveAttribute("target", "_blank");
  await expect(externalLink).toHaveAttribute("rel", "noreferrer");
  await expect.poll(() => frameRequests).toBe(1);

  await page.getByRole("button", { name: "Reload" }).click();
  await expect.poll(() => frameRequests).toBe(2);
});

test("returns 404 for an unknown app ID", async ({ page }) => {
  const response = await page.goto("/apps/app-006e006f002d0073007500630068002d006100700070");

  expect(response?.status()).toBe(404);
});

test("returns 404 for a noncanonical uppercase route token", async ({ page }) => {
  const response = await page.goto("/apps/app-006300720061006600740079002D0063006F006E00740072006F006C006C00650072");

  expect(response?.status()).toBe(404);
});

test("opens reserved and dot-only app IDs from launcher links", async ({ page, request }) => {
  const apps = [".", "..", "other/a b"].map((id) => ({
    id,
    name: id === "." ? "Dot service" : id === ".." ? "Dot dot service" : "Reserved service",
    description: "A persisted route fixture",
    category: "Other",
    url: "http://crafty.example.test",
    icon: "",
    color: "#b9e394",
    status: "unknown",
    source: "manual",
    isVisible: true,
    sortOrder: id === "." ? 0 : 1,
  }));

  await page.route("**/api/apps", (route) => route.fulfill({
    json: { apps, docker: { available: false, status: "unavailable", warnings: [], updatedAt: null } },
  }));
  await page.route("**/api/activity", (route) => route.fulfill({ json: { activities: [] } }));
  await page.route("**/api/overview", (route) => route.fulfill({ json: {
    uptime: "1m", cpu: 1, cpuCores: 1, temperatureC: null, powerWatts: null, powerSource: null,
    memory: 1, memoryUsed: "1 GB", memoryTotal: "8 GB", storage: 1, storageUsed: "1 GB",
    storageAvailable: "99 GB", storageTotal: "100 GB", downloadBytesPerSecond: null,
    uploadBytesPerSecond: null, storageVolumes: [], updatedAt: "2026-10-14T00:00:00.000Z",
  } }));
  await page.route("**/api/health**", (route) => route.fulfill({ json: { status: "online", latency: 1, statusCode: 200 } }));
  await page.route(/^http:\/\/crafty\.example\.test\/?$/, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));

  try {
    for (const app of apps) {
      const response = await request.post("/api/apps", { data: app });
      expect(response.ok()).toBe(true);
    }

    await page.goto("/");
    for (const app of apps) {
      const link = page.getByRole("region", { name: "Applications" }).getByRole("link", { name: new RegExp("^" + app.name) });
      await link.click();
      const routeIds: Record<string, string> = {
        ".": "002e",
        "..": "002e002e",
        "other/a b": "006f0074006800650072002f006100200062",
      };
      await expect.poll(() => new URL(page.url()).pathname).toBe("/apps/app-" + routeIds[app.id]);
      await expect(page.getByRole("heading", { name: app.name })).toBeVisible();
      await page.goto("/");
    }
  } finally {
    for (const app of apps) await request.delete("/api/apps", { data: { id: app.id } });
  }
});

test("keeps the viewer toolbar on one row at desktop and mobile widths", async ({ page, request }) => {
  const craftyUrl = await getCraftyUrl(request);
  await page.route(craftyUrl, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/apps/app-006300720061006600740079002d0063006f006e00740072006f006c006c00650072");
  await expect(page.getByRole("heading", { name: "Crafty Controller" })).toBeVisible();

  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 720 });
    const bounds = await Promise.all([
      page.getByRole("link", { name: "Back to dashboard" }).boundingBox(),
      page.getByRole("heading", { name: "Crafty Controller" }).boundingBox(),
      page.getByRole("button", { name: "Reload" }).boundingBox(),
      page.getByRole("link", { name: "Open in new tab" }).boundingBox(),
    ]);
    expect(bounds.every(Boolean)).toBe(true);
    const rowCenters = bounds.map((box) => box!.y + box!.height / 2);
    expect(Math.max(...rowCenters) - Math.min(...rowCenters)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
