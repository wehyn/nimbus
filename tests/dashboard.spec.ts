import { expect, test } from "@playwright/test";

type DashboardApp = {
  id: string;
  name: string;
  description: string;
  category: string;
  url: string;
  icon: string;
  color: string;
  status: "online" | "degraded" | "offline" | "unknown";
  source: "manual" | "docker";
  isVisible: boolean;
  sortOrder: number;
};

const apps: DashboardApp[] = [{
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
}];

const overview = {
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
  downloadBytesPerSecond: 1_228_800,
  uploadBytesPerSecond: 512_000,
  storageVolumes: [
    { id: "nimbus", label: "Nimbus", usedBytes: 42_000_000_000, availableBytes: 58_000_000_000, reservedBytes: 0, totalBytes: 100_000_000_000 },
    { id: "disk:media drive", label: "Media drive", usedBytes: 1_200_000_000_000, availableBytes: 800_000_000_000, reservedBytes: 0, totalBytes: 2_000_000_000_000 },
  ],
  updatedAt: "2026-09-02T12:00:00.000Z",
};

const historyPoints = [
  { timestamp: "2026-09-02T11:56:00.000Z", cpu: 11.2, memory: 36.9, storage: 42, temperatureC: null, powerWatts: null },
  { timestamp: "2026-09-02T11:57:00.000Z", cpu: 12.5, memory: 37.5, storage: 42, temperatureC: null, powerWatts: null },
  { timestamp: "2026-09-02T11:58:00.000Z", cpu: 13.1, memory: 38.2, storage: 42, temperatureC: null, powerWatts: null },
];

async function installDashboardFixtures(page: import("@playwright/test").Page, fixtureApps = apps, historyRequests: string[] = [], fixtureOverview: Omit<typeof overview, "temperatureC" | "powerWatts"> & { temperatureC: number | null; powerWatts: number | null } = overview) {
  await page.route("**/api/apps", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { apps: fixtureApps, docker: { available: false, status: "unavailable", warnings: [], updatedAt: null } } });
    return route.fulfill({ json: { app: fixtureApps[0] } });
  });
  await page.route("**/api/activity", (route) => route.fulfill({ json: { activities: [] } }));
  await page.route("**/api/overview", (route) => route.fulfill({ json: fixtureOverview }));
  await page.route("**/api/health**", (route) => route.fulfill({ json: { status: "online", latency: 20, statusCode: 200 } }));
  await page.route("**/api/metrics/history**", (route) => {
    const requestUrl = route.request().url();
    historyRequests.push(requestUrl);
    const minutes = Number(new URL(requestUrl).searchParams.get("minutes") ?? 5);
    return route.fulfill({ json: { minutes, points: historyPoints } });
  });
  await page.route("**/api/processor/processes", (route) => route.fulfill({ json: {
    updatedAt: "2026-09-02T12:00:00.000Z",
    cpuPercent: 12.5,
    cpuCores: 4,
    loadAverage: { one: 0.2, five: 0.3, fifteen: 0.4 },
    sampling: false,
    partial: true,
    omittedCount: 2,
    totalCount: 3,
    returnedCount: 1,
    unreadableCount: 2,
    policyOmittedCount: 0,
    policyOmittedReason: null,
    warnings: ["2 processes were unavailable while scanning."],
    processes: [{ name: "node", command: "node server", pid: 42, user: "dei", cpuPercent: 8, rssBytes: 1024 * 1024, memoryPercent: 1.2 }],
  } }));
  await page.route("**/api/memory/processes", (route) => route.fulfill({ json: {
    updatedAt: "2026-09-02T12:00:00.000Z",
    totalBytes: 8 * 1024 * 1024 * 1024,
    usedBytes: 3 * 1024 * 1024 * 1024,
    availableBytes: 5 * 1024 * 1024 * 1024,
    usedPercent: 37.5,
    partial: true,
    omittedCount: 2,
    totalCount: 3,
    returnedCount: 1,
    unreadableCount: 2,
    policyOmittedCount: 0,
    policyOmittedReason: null,
    warnings: ["2 processes were unavailable while scanning."],
    processes: [{ name: "node", command: "node server", pid: 42, user: "dei", rssBytes: 1024 * 1024, memoryPercent: 1.2 }],
  } }));
}

test.describe("dashboard browser regressions", () => {
  const orderScenarios = [
    { label: "after a deletion gap", orders: [0, 1, 2], deletedIndex: 1, expectedOrder: 3 },
    { label: "with negative existing orders", orders: [-4, -3], deletedIndex: 0, expectedOrder: -2 },
  ];

  for (const scenario of orderScenarios) {
    for (const addFrom of ["management panel", "launcher tile"] as const) {
      test(`adds after the maximum ${scenario.label} from the ${addFrom}`, async ({ page }) => {
      const fixtureApps = scenario.orders.map((sortOrder, index) => ({
        ...apps[0],
        id: `fixture-${index}`,
        name: index === scenario.deletedIndex ? "Delete me" : `Existing ${index}`,
        sortOrder,
        isVisible: index !== scenario.orders.length - 1,
      }));
        let persistedApps = fixtureApps;
        let postedApp: DashboardApp | null = null;
        await installDashboardFixtures(page, persistedApps);
        await page.unroute("**/api/apps");
        await page.route("**/api/apps", async (route) => {
          if (route.request().method() === "GET") return route.fulfill({ json: { apps: persistedApps, docker: { available: false, status: "unavailable", warnings: [], updatedAt: null } } });
          if (route.request().method() === "DELETE") {
            persistedApps = persistedApps.filter((app) => app.id !== (route.request().postDataJSON() as { id: string }).id);
            return route.fulfill({ json: { ok: true } });
          }
          postedApp = route.request().postDataJSON() as DashboardApp;
          persistedApps = [...persistedApps, postedApp];
          return route.fulfill({ json: { app: postedApp } });
        });
        await page.goto("/");
        await page.getByRole("button", { name: "Application management" }).click();
        await page.getByRole("button", { name: "Edit Delete me" }).click();
        page.on("dialog", (dialog) => dialog.accept());
        await page.getByRole("button", { name: "Delete", exact: false }).click();
        await expect(page.getByRole("dialog", { name: "Application management" })).toBeVisible();

        if (addFrom === "launcher tile") {
          await page.getByRole("button", { name: "Close application modal" }).click();
          await page.getByRole("button", { name: "Add application" }).click();
        } else {
          await page.getByRole("button", { name: "Add", exact: true }).click();
        }
        const dialog = page.getByRole("dialog", { name: "Application details" });
        await dialog.getByLabel("Title").fill(`Added via ${addFrom}`);
        await dialog.getByLabel("Application URL").fill("https://added.invalid");
        await dialog.getByRole("button", { name: "Save changes" }).click();
        await expect.poll(() => postedApp?.sortOrder).toBe(scenario.expectedOrder);
        await expect(page.getByRole("link", { name: `Added via ${addFrom}` })).toBeVisible();
      });
    }
  }

  test("shows network rates beside temperature and power and lets me switch storage volumes", async ({ page }) => {
    const fixtureOverview = { ...overview, temperatureC: 53, powerWatts: 3.28 };
    await installDashboardFixtures(page, apps, [], fixtureOverview);
    await page.goto("/");

    await expect(page.getByRole("progressbar", { name: "CPU usage" })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Memory usage" })).toBeVisible();
    const readings = page.getByRole("group", { name: "System readings" });
    await expect(readings.getByRole("img", { name: "Upload rate: 500 KB/s" })).toBeVisible();
    await expect(readings.getByRole("img", { name: "Download rate: 1.2 MB/s" })).toBeVisible();
    await expect(readings.getByRole("img", { name: "Temperature: 53°C" })).toBeVisible();
    await expect(readings.getByRole("img", { name: "Power: 3.28 W" })).toBeVisible();

    const storageTrigger = page.getByRole("button", { name: "View storage details" });
    await storageTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Storage" });
    await expect(dialog).toBeVisible();
    const volumeSelect = dialog.getByRole("combobox", { name: "Storage volume" });
    await expect(volumeSelect.locator("option")).toHaveText(["Nimbus", "Media drive"]);
    await expect(dialog.locator(".storage-stat-used strong")).toHaveText("39.1 GB");
    await expect(dialog.locator(".storage-stat-total strong")).toHaveText("93.1 GB");

    await volumeSelect.selectOption("disk:media drive");
    await expect(dialog.locator(".storage-stat-used strong")).toHaveText("1.1 TB");
    await expect(dialog.locator(".storage-stat-total strong")).toHaveText("1.8 TB");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(dialog).toBeVisible();
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).resolves.toBeTruthy();
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("View storage details");
  });

  test("serves install metadata and network-first service worker without private services", async ({ page, request }) => {
    await installDashboardFixtures(page);
    const manifestResponse = await request.get("/manifest.webmanifest");
    expect(manifestResponse.ok()).toBeTruthy();
    const manifest = await manifestResponse.json();
    expect(manifest.lang).toBe("en");
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBeTruthy();

    const workerResponse = await request.get("/sw.js");
    expect(workerResponse.ok()).toBeTruthy();
    expect(await workerResponse.text()).toMatch(/fetch\(request\)[\s\S]*cache\.match/);
    await page.goto("/");
    await expect(page.locator("main.launcher")).toBeVisible();
  });

  test("keeps responsive Web UI controls usable at phone widths", async ({ page }) => {
    const hostLocalApp = { ...apps[0], dockerProject: "demo", dockerService: "web", url: "http://localhost:8080" };
    await installDashboardFixtures(page, [hostLocalApp]);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      await page.getByRole("button", { name: "Application management" }).click();
      await page.getByRole("button", { name: "Edit Demo service" }).click();
      await expect(page.locator("#app-demo-url-protocol")).toBeVisible();
      await expect(page.locator("#app-demo-url-host")).toBeVisible();
      await expect(page.locator("#app-demo-url-port")).toBeVisible();
      await expect(page.locator("main.launcher")).toHaveCSS("overflow-x", "hidden");
      await page.getByRole("button", { name: "Close application modal" }).click();
    }
  });

  test("contains settings focus, restores the trigger, and exposes the TLS toggle", async ({ page }) => {
    await installDashboardFixtures(page);
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Application management" });
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Application management" })).toBeVisible();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Application details" });
    await expect(dialog).toBeVisible();
    await expect(page.getByText(/favorite/i)).toHaveCount(0);
    const toggle = page.getByRole("button", { name: "Allow self-signed TLS" });
    await expect(toggle).toHaveAttribute("aria-describedby", /description/);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.press("Space");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Application management" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Application management");
  });

  test("resynchronizes application form fields when switching records", async ({ page }) => {
    const secondApp = { ...apps[0], id: "second", name: "Second service", description: "Second description", dockerProject: "demo", dockerService: "second", url: "http://localhost:9090" };
    await installDashboardFixtures(page, [{ ...apps[0], dockerProject: "demo", dockerService: "first", url: "http://localhost:8080" }, secondApp]);
    await page.goto("/");
    await page.getByRole("button", { name: "Application management" }).click();
    await page.getByRole("button", { name: "Edit Demo service" }).click();
    await expect(page.locator("#app-demo-title")).toHaveValue("Demo service");
    await page.getByRole("button", { name: "All applications" }).click();
    await page.getByRole("button", { name: "Edit Second service" }).click();
    await expect(page.locator("#app-second-title")).toHaveValue("Second service");
    await expect(page.locator("#app-second-description")).toHaveValue("Second description");
    await expect(page.locator("#app-second-url-port")).toHaveValue("9090");
  });

  test("loads metric history only in the modal and polls only in Live mode", async ({ page }) => {
    const historyRequests: string[] = [];
    await page.clock.install({ time: new Date("2026-09-02T12:00:00.000Z") });
    await installDashboardFixtures(page, apps, historyRequests);
    await page.goto("/");
    expect(historyRequests).toHaveLength(0);

    await page.getByRole("button", { name: "View cpu details" }).click();
    const chart = page.getByRole("dialog", { name: "Processor" }).locator(".metrics-history-card");
    await expect.poll(() => historyRequests.length).toBe(1);
    expect(new URL(historyRequests[0]).searchParams.get("minutes")).toBe("5");

    await page.clock.fastForward(30_000);
    await expect.poll(() => historyRequests.length).toBe(2);

    await chart.getByRole("button", { name: "15m", exact: true }).click();
    await expect.poll(() => historyRequests.length).toBe(3);
    expect(new URL(historyRequests[2]).searchParams.get("minutes")).toBe("15");
    await page.clock.fastForward(30_000);
    expect(historyRequests).toHaveLength(3);

    await chart.getByRole("button", { name: "30m", exact: true }).click();
    await expect.poll(() => historyRequests.length).toBe(4);
    expect(new URL(historyRequests[3]).searchParams.get("minutes")).toBe("30");
    await page.clock.fastForward(30_000);
    expect(historyRequests).toHaveLength(4);

    await chart.getByRole("button", { name: "Live", exact: true }).click();
    await expect.poll(() => historyRequests.length).toBe(5);
    expect(new URL(historyRequests[4]).searchParams.get("minutes")).toBe("5");
    await page.clock.fastForward(30_000);
    await expect.poll(() => historyRequests.length).toBe(6);
  });

  test("stops metric history polling when the detail modal closes", async ({ page }) => {
    const historyRequests: string[] = [];
    await page.clock.install({ time: new Date("2026-09-02T12:00:00.000Z") });
    await installDashboardFixtures(page, apps, historyRequests);
    await page.goto("/");

    await page.getByRole("button", { name: "View cpu details" }).click();
    await expect.poll(() => historyRequests.length).toBe(1);
    await page.getByRole("button", { name: "Close processor details" }).click();
    await expect(page.locator("body > div")).not.toHaveAttribute("inert", "");
    await page.evaluate(() => new Promise<void>((resolve) => queueMicrotask(resolve)));
    await page.clock.runFor(1_000);
    await expect(page.getByRole("dialog", { name: "Processor" })).toHaveCount(0);

    await page.clock.fastForward(30_000);
    expect(historyRequests).toHaveLength(1);
  });

  test("renders metrics text alternatives and accessible process sorting", async ({ page }) => {
    await installDashboardFixtures(page);
    await page.goto("/");
    await page.getByRole("button", { name: "View cpu details" }).click();
    const dialog = page.getByRole("dialog", { name: "Processor" });
    await expect(dialog).toBeVisible();
    const assertMetricsChartContract = async (chart: import("@playwright/test").Locator, name: RegExp, current: string) => {
      await expect(chart.getByRole("img", { name })).toBeVisible();
      await expect(chart.locator(".metrics-history-current")).toHaveText(current);
      await expect(chart.locator(".metrics-chart-area")).toHaveCSS("opacity", "0.14");
      await expect(chart.getByRole("button", { name: "Live", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(chart.getByRole("button", { name: "15m", exact: true })).toHaveAttribute("aria-pressed", "false");
      await expect(chart.getByRole("button", { name: "30m", exact: true })).toHaveAttribute("aria-pressed", "false");
      await expect(chart.getByRole("button", { name: "5m", exact: true })).toHaveCount(0);
      await expect(chart.locator(".metrics-chart-label")).toHaveCount(3);
      await expect(chart.locator(".metrics-chart-point")).toHaveCount(0);
      await expect(chart.locator(".metrics-chart-point-current")).toHaveCount(0);
      await expect(chart.locator(".metrics-chart-point-current-value")).toHaveCount(0);
      await expect(chart.locator(".metrics-chart-time-label")).toHaveCount(0);
      await expect(chart.getByText(/\b\d+\s+samples?\b/i)).toHaveCount(0);
      for (const removedCopy of ["System history", "Latest", "Low", "High", "View readings", "Stored locally", "30-day retention"]) {
        await expect(chart.getByText(removedCopy, { exact: true })).toHaveCount(0);
      }
      await expect(chart.getByRole("table")).toHaveCount(0);
    };
    await assertMetricsChartContract(dialog.locator(".metrics-history-card"), /CPU usage live over/, "13.1%");
    await expect(dialog.getByRole("columnheader", { name: /CPU %/ })).toHaveAttribute("aria-sort", "descending");
    await expect(dialog.getByRole("button", { name: /Sort by CPU %/ })).toBeVisible();
    await expect(dialog.getByText(/2 unavailable/)).toBeVisible();
    await expect(dialog.getByText("1 / 3").last()).toBeVisible();
    await page.getByRole("button", { name: "Close processor details" }).click();

    await page.getByRole("button", { name: "View memory details" }).click();
    const memoryDialog = page.getByRole("dialog", { name: "Memory" });
    await expect(memoryDialog).toBeVisible();
    await assertMetricsChartContract(memoryDialog.locator(".metrics-history-card"), /Memory usage live over/, "38.2%");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(memoryDialog.locator(".metrics-history-card")).toBeVisible();
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).resolves.toBeTruthy();
    }
  });

  test("marks the launcher and app routes as structural performance boundaries", async ({ page }) => {
    await installDashboardFixtures(page);
    const apiRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/")) apiRequests.push(new URL(request.url()).pathname);
    });
    const appsResponsePromise = page.waitForResponse((response) => response.url().includes("/api/apps") && response.request().method() === "GET");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main.launcher")).toBeVisible();
    await appsResponsePromise;
    await expect(page.getByRole("link", { name: "Demo service" })).toBeVisible();
    await expect.poll(() => apiRequests.filter((path) => path === "/api/apps").length).toBe(1);
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).resolves.toBeTruthy();
    expect(apiRequests.filter((path) => path === "/api/health").length).toBeLessThanOrEqual(1);
  });

  test("does not poll health while hidden and refreshes when visible again", async ({ page }) => {
    await installDashboardFixtures(page);
    let healthRequests = 0;
    await page.route("**/api/health**", (route) => {
      healthRequests += 1;
      return route.fulfill({ json: { status: "online", latency: 20, statusCode: 200 } });
    });
    const appsResponsePromise = page.waitForResponse((response) => response.url().includes("/api/apps") && response.request().method() === "GET");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await appsResponsePromise;
    await expect(page.getByRole("link", { name: "Demo service" })).toBeVisible();
    await expect.poll(() => healthRequests).toBeGreaterThan(0);
    const initialRequests = healthRequests;
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(100);
    expect(healthRequests).toBe(initialRequests);
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => healthRequests).toBeGreaterThan(initialRequests);
  });

  test("shows an explicit offline state and retries after reconnecting", async ({ page }) => {
    await installDashboardFixtures(page);
    await page.goto("/");
    await page.evaluate(() => Object.defineProperty(navigator, "onLine", { configurable: true, value: false }));
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByRole("status").filter({ hasText: "You’re offline" })).toBeVisible();
    await page.evaluate(() => Object.defineProperty(navigator, "onLine", { configurable: true, value: true }));
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("status").filter({ hasText: "You’re offline" })).toBeHidden();
  });
});
