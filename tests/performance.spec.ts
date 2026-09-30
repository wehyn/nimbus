import { expect, test } from "@playwright/test";

const fixtureApp = {
  id: "demo",
  name: "Demo service",
  description: "A deterministic fixture",
  category: "Other",
  url: "https://demo.invalid",
  icon: "",
  color: "#b9e394",
  status: "online",
  source: "manual",
  isVisible: true,
  sortOrder: 0,
};

const fixtureOverview = {
  uptime: "1h 2m",
  cpu: 12.5,
  cpuCores: 4,
  temperatureC: null,
  powerWatts: null,
  powerSource: null,
  memory: 37.5,
  memoryUsed: "3.0 GB",
  memoryTotal: "8 GB",
  storage: 42,
  storageUsed: "42 GB",
  storageAvailable: "58 GB",
  storageTotal: "100 GB",
  downloadBytesPerSecond: null,
  uploadBytesPerSecond: null,
  storageVolumes: [{ id: "nimbus", label: "Nimbus", usedBytes: 42_000_000_000, availableBytes: 58_000_000_000, reservedBytes: 0, totalBytes: 100_000_000_000 }],
  updatedAt: "2026-09-02T12:00:00.000Z",
};

async function installFixtures(page: import("@playwright/test").Page) {
  await page.route("**/api/apps", (route) => route.fulfill({ json: { apps: [fixtureApp], docker: { available: false, status: "unavailable", warnings: [], updatedAt: null } } }));
  await page.route("**/api/activity", (route) => route.fulfill({ json: { activities: [] } }));
  await page.route("**/api/overview", (route) => route.fulfill({ json: fixtureOverview }));
  await page.route("**/api/health**", (route) => route.fulfill({ json: { status: "online", latency: 20, statusCode: 200 } }));
  await page.route("**/api/processor/processes", (route) => route.fulfill({ json: {
    cpuPercent: 12,
    cpuCores: 4,
    loadAverage: { one: 0.2, five: 0.3, fifteen: 0.4 },
    processes: [],
    totalCount: 0,
    returnedCount: 0,
    unreadableCount: 0,
    policyOmittedCount: 0,
    policyOmittedReason: null,
    sampling: false,
    partial: false,
    omittedCount: 0,
    warnings: [],
    updatedAt: "2026-09-02T12:00:00.000Z",
  } }));
  await page.route("**/api/memory/processes", (route) => route.fulfill({ json: {
    totalBytes: 8 * 1024,
    usedBytes: 4 * 1024,
    availableBytes: 4 * 1024,
    usedPercent: 50,
    processes: [],
    totalCount: 0,
    returnedCount: 0,
    unreadableCount: 0,
    policyOmittedCount: 0,
    policyOmittedReason: null,
    partial: false,
    omittedCount: 0,
    warnings: [],
    updatedAt: "2026-09-02T12:00:00.000Z",
  } }));
}

test.describe("performance smoke", () => {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
    { name: "narrow-mobile", width: 320, height: 844 },
  ]) {
    test(`keeps the ${viewport.name} launcher within the viewport`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installFixtures(page);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.locator("main.launcher")).toBeVisible();
      await expect(page.getByRole("link", { name: "Demo service" })).toBeVisible({ timeout: 15_000 });
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).resolves.toBeTruthy();
    });
  }
});
