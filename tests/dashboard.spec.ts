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

async function installReorderFixtures(page: import("@playwright/test").Page, fixtureApps: DashboardApp[], patchStatus = 200) {
  const state = { apps: fixtureApps };
  await installDashboardFixtures(page, state.apps);
  await page.unroute("**/api/apps");
  await page.route("**/api/apps", async (route) => {
    if (route.request().method() === "GET") {
      const orderedApps = [...state.apps].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
      return route.fulfill({ json: { apps: orderedApps, docker: { available: false, status: "unavailable", warnings: [], updatedAt: null } } });
    }
    if (route.request().method() === "PATCH") {
      if (patchStatus !== 200) return route.fulfill({ status: patchStatus, json: { error: "Unable to save application order." } });
      const { expectedIds, expectedVisibleIds, orderedIds } = route.request().postDataJSON() as { expectedIds: string[]; expectedVisibleIds: string[]; orderedIds: string[] };
      const currentApps = [...state.apps].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
      const currentIds = currentApps.map((app) => app.id);
      const currentVisibleIds = currentApps.filter((app) => app.isVisible).map((app) => app.id);
      if (expectedIds.length !== currentIds.length || expectedIds.some((id, index) => id !== currentIds[index]) || expectedVisibleIds.length !== currentVisibleIds.length || expectedVisibleIds.some((id, index) => id !== currentVisibleIds[index])) return route.fulfill({ status: 409, json: { error: "application order changed; reload and retry" } });
      const appsById = new Map(state.apps.map((app) => [app.id, app]));
      state.apps = orderedIds.map((id, sortOrder) => ({ ...appsById.get(id)!, sortOrder }));
      return route.fulfill({ json: { ok: true, orderedIds } });
    }
    return route.fulfill({ status: 400, json: { error: "unsupported application mutation" } });
  });
  return state;
}

async function dragBetween(page: import("@playwright/test").Page, source: import("@playwright/test").Locator, target: import("@playwright/test").Locator) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 10 });
  await page.mouse.up();
}

test.describe("dashboard browser regressions", () => {
  test("routes grid and dock app links to the encoded in-app viewer", async ({ page }) => {
    const fixtureApp = { ...apps[0], id: "other/a b", name: "Reserved ID service" };
    await installDashboardFixtures(page, [fixtureApp]);
    await page.goto("/");

    const gridLink = page.getByRole("region", { name: "Applications" }).getByRole("link", { name: /Reserved ID service/ });
    const dockLink = page.getByRole("navigation", { name: "Quick launch" }).getByRole("link", { name: "Open Reserved ID service" });
    for (const link of [gridLink, dockLink]) {
      await expect(link).toHaveAttribute("href", "/apps/app-006f0074006800650072002f006100200062");
      await expect(link).not.toHaveAttribute("target");
    }
  });

  const orderScenarios = [
    { label: "after a deletion gap", orders: [0, 1, 2], deletedIndex: 1, expectedOrder: 3 },
    { label: "with negative existing orders", orders: [-4, -3], deletedIndex: 0, expectedOrder: -2 },
  ];

  for (const scenario of orderScenarios) {
    test(`adds after the maximum ${scenario.label} from Settings`, async ({ page }) => {
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
      await page.getByRole("dialog", { name: "Application details" }).getByRole("button", { name: "Delete", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Application management" })).toBeVisible();

      await page.getByRole("button", { name: "Add", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Application details" });
      await dialog.getByLabel("Title").fill("Added via Settings");
      await dialog.getByLabel("Application URL").fill("https://added.invalid");
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await expect.poll(() => postedApp?.sortOrder).toBe(scenario.expectedOrder);
      await expect(page.getByRole("region", { name: "Applications" }).getByRole("link", { name: "Added via Settings" })).toBeVisible();
    });
  }

  test("keeps app order after editing a reordered application", async ({ page }) => {
    let persistedApps: DashboardApp[] = [
      { ...apps[0], id: "alpha", name: "Alpha", sortOrder: 0 },
      { ...apps[0], id: "beta", name: "Beta", sortOrder: 1 },
    ];
    let savedApp: DashboardApp | null = null;
    await installDashboardFixtures(page, persistedApps);
    await page.unroute("**/api/apps");
    await page.route("**/api/apps", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        const orderedApps = [...persistedApps].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
        return route.fulfill({ json: { apps: orderedApps, docker: { available: false, status: "unavailable", warnings: [], updatedAt: null } } });
      }
      if (method === "PATCH") {
        const orderedIds = (route.request().postDataJSON() as { orderedIds: string[] }).orderedIds;
        const appsById = new Map(persistedApps.map((app) => [app.id, app]));
        persistedApps = orderedIds.map((id, sortOrder) => ({ ...appsById.get(id)!, sortOrder }));
        return route.fulfill({ json: { ok: true, orderedIds } });
      }
      if (method === "POST") {
        savedApp = route.request().postDataJSON() as DashboardApp;
        persistedApps = persistedApps.map((app) => app.id === savedApp?.id ? savedApp : app);
        return route.fulfill({ json: { app: savedApp } });
      }
      return route.fulfill({ status: 400, json: { error: "unsupported application mutation" } });
    });

    await page.goto("/");
    await page.getByRole("region", { name: "Applications" }).getByRole("button", { name: "Reorder application" }).first().press("ArrowDown");
    await expect.poll(() => [...persistedApps].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)).map((app) => app.id)).toEqual(["beta", "alpha"]);

    await page.getByRole("button", { name: "Application management" }).click();
    await page.getByRole("button", { name: "Edit Alpha" }).click();
    const dialog = page.getByRole("dialog", { name: "Application details" });
    await dialog.getByLabel("Description").fill("Edited after reorder");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => savedApp?.sortOrder).toBe(1);
    await expect.poll(() => page.locator(".launcher-grid [data-reorder-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-reorder-id")))).toEqual(["beta", "alpha"]);
  });

  test("reorders applications by dragging between the grid and dock", async ({ page }) => {
    const fixtureState = await installReorderFixtures(page, [
      { ...apps[0], id: "alpha", name: "Alpha", sortOrder: 0 },
      { ...apps[0], id: "beta", name: "Beta", sortOrder: 1 },
    ]);

    await page.goto("/");
    const gridSource = page.locator('.launcher-grid [data-reorder-id="alpha"] .app-reorder-handle');
    const dockTargetHandle = page.locator('.launcher-dock [data-reorder-id="beta"] .app-reorder-handle');
    await dragBetween(page, gridSource, dockTargetHandle);

    await expect.poll(() => [...fixtureState.apps].sort((left, right) => left.sortOrder - right.sortOrder).map((app) => app.id)).toEqual(["beta", "alpha"]);
    await expect.poll(() => page.locator(".launcher-grid [data-reorder-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-reorder-id")))).toEqual(["beta", "alpha"]);
    await expect.poll(() => page.locator(".launcher-dock [data-reorder-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-reorder-id")))).toEqual(["beta", "alpha"]);
    await expect.poll(() => page.locator('.launcher-grid [data-reorder-id="alpha"]').evaluate((element) => getComputedStyle(element).transform)).toBe("none");

  });

  test("does not reorder an app when a drag ends inside its original tile", async ({ page }) => {
    const fixtureState = await installReorderFixtures(page, [
      { ...apps[0], id: "alpha", name: "Alpha", sortOrder: 0 },
      { ...apps[0], id: "beta", name: "Beta", sortOrder: 1 },
      { ...apps[0], id: "gamma", name: "Gamma", sortOrder: 2 },
    ]);

    await page.goto("/");
    const handle = page.locator('.launcher-grid [data-reorder-id="beta"] .app-reorder-handle');
    const tile = page.locator('.launcher-grid [data-reorder-id="beta"]');
    const bounds = await handle.boundingBox();
    expect(bounds).not.toBeNull();
    const x = bounds!.x + bounds!.width / 2;
    const y = bounds!.y + bounds!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 6, y, { steps: 2 });
    await expect.poll(() => tile.evaluate((element) => getComputedStyle(element).transform)).not.toBe("none");
    await page.mouse.up();

    await expect.poll(() => [...fixtureState.apps].sort((left, right) => left.sortOrder - right.sortOrder).map((app) => app.id)).toEqual(["alpha", "beta", "gamma"]);
  });

  for (const surface of ["grid", "dock"] as const) {
    test(`uses empty ${surface} space as a drop target`, async ({ page }) => {
      const fixtureState = await installReorderFixtures(page, Array.from({ length: 6 }, (_, index) => ({
        ...apps[0],
        id: `app-${index}`,
        name: `App ${index + 1}`,
        sortOrder: index,
      })));

      await page.goto("/");
      const containerSelector = surface === "grid" ? ".launcher-grid" : ".launcher-dock";
      const container = page.locator(containerSelector);
      const bounds = await container.boundingBox();
      expect(bounds).not.toBeNull();
      const point = surface === "grid"
        ? await container.locator("[data-reorder-id]").evaluateAll((elements) => {
          const first = elements[0].getBoundingClientRect();
          const second = elements[1].getBoundingClientRect();
          return { x: (first.right + second.left) / 2, y: first.top + first.height / 2 };
        })
        : { x: bounds!.x + 2, y: bounds!.y + bounds!.height / 2 };
      const hit = await page.evaluate(({ x, y, surface }) => {
        const element = document.elementFromPoint(x, y);
        return { inSurface: Boolean(element?.closest(surface === "grid" ? ".launcher-grid" : ".launcher-dock")), appId: element?.closest<HTMLElement>("[data-reorder-id]")?.dataset.reorderId ?? null };
      }, { ...point, surface });
      expect(hit).toEqual({ inSurface: true, appId: null });

      const source = page.locator(surface === "dock"
        ? '.launcher-grid [data-reorder-id="app-4"] .app-reorder-handle'
        : '.launcher-dock [data-reorder-id="app-3"] .app-reorder-handle');
      const sourceBounds = await source.boundingBox();
      expect(sourceBounds).not.toBeNull();
      await page.mouse.move(sourceBounds!.x + sourceBounds!.width / 2, sourceBounds!.y + sourceBounds!.height / 2);
      await page.mouse.down();
      await page.mouse.move(point.x, point.y, { steps: 10 });
      await page.mouse.up();

      const expectedOrder = surface === "grid"
        ? ["app-0", "app-1", "app-2", "app-4", "app-5", "app-3"]
        : ["app-0", "app-1", "app-2", "app-4", "app-3", "app-5"];
      await expect.poll(() => [...fixtureState.apps].sort((left, right) => left.sortOrder - right.sortOrder).map((app) => app.id)).toEqual(expectedOrder);
    });
  }

  test("labels each reorder handle with its application", async ({ page }) => {
    await installReorderFixtures(page, [
      { ...apps[0], id: "alpha", name: "Alpha", sortOrder: 0 },
      { ...apps[0], id: "beta", name: "Beta", sortOrder: 1 },
    ]);

    await page.goto("/");
    await expect(page.locator('.launcher-grid [data-reorder-id="alpha"] .app-reorder-handle')).toHaveAccessibleName("Reorder application Alpha");
    await expect(page.locator('.launcher-dock [data-reorder-id="alpha"] .app-reorder-handle')).toHaveAccessibleName("Reorder application Alpha");
  });

  for (const surface of ["grid", "dock"] as const) {
    test(`reorders a later app before an earlier app in the ${surface}`, async ({ page }) => {
      const fixtureState = await installReorderFixtures(page, [
        { ...apps[0], id: "alpha", name: "Alpha", sortOrder: 0 },
        { ...apps[0], id: "beta", name: "Beta", sortOrder: 1 },
      ]);

      await page.goto("/");
      const containerSelector = surface === "grid" ? ".launcher-grid" : ".launcher-dock";
      await dragBetween(
        page,
        page.locator(`${containerSelector} [data-reorder-id="beta"] .app-reorder-handle`),
        page.locator(`${containerSelector} [data-reorder-id="alpha"] .app-reorder-handle`),
      );

      await expect.poll(() => [...fixtureState.apps].sort((left, right) => left.sortOrder - right.sortOrder).map((app) => app.id)).toEqual(["beta", "alpha"]);
      await expect.poll(() => page.locator(`${containerSelector} [data-reorder-id]`).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-reorder-id")))).toEqual(["beta", "alpha"]);
    });
  }

  test("moves focus into the grid when a dock app is dragged out of the dock", async ({ page }) => {
    const fixtureState = await installReorderFixtures(page, Array.from({ length: 5 }, (_, index) => ({
      ...apps[0],
      id: `app-${index}`,
      name: `App ${index + 1}`,
      sortOrder: index,
    })));

    await page.goto("/");
    const dockHandle = page.locator('.launcher-dock [data-reorder-id="app-3"] .app-reorder-handle');
    await dockHandle.focus();
    await dragBetween(page, dockHandle, page.locator('.launcher-grid [data-reorder-id="app-4"] .app-reorder-handle'));

    await expect.poll(() => [...fixtureState.apps].sort((left, right) => left.sortOrder - right.sortOrder).map((app) => app.id)).toEqual(["app-0", "app-1", "app-2", "app-4", "app-3"]);
    await expect(page.locator('.launcher-grid [data-reorder-id="app-3"] .app-reorder-handle')).toBeFocused();
  });

  test("starts touch reordering only after a long press", async ({ page }) => {
    const fixtureState = await installReorderFixtures(page, [
      { ...apps[0], id: "alpha", name: "Alpha", sortOrder: 0 },
      { ...apps[0], id: "beta", name: "Beta", sortOrder: 1 },
    ]);

    await page.setViewportSize({ width: 390, height: 844 });
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await page.goto("/");
    const alphaHandle = page.locator('.launcher-grid [data-reorder-id="alpha"] .app-reorder-handle');
    const betaHandle = page.locator('.launcher-grid [data-reorder-id="beta"] .app-reorder-handle');
    const source = await alphaHandle.boundingBox();
    const target = await betaHandle.boundingBox();
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();

    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: source!.x + source!.width / 2, y: source!.y + source!.height / 2, id: 1 }] });
    await page.waitForTimeout(100);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(fixtureState.apps.map((app) => app.id)).toEqual(["alpha", "beta"]);

    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: source!.x + source!.width / 2, y: source!.y + source!.height / 2, id: 1 }] });
    await page.waitForTimeout(400);
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: target!.x + target!.width / 2, y: target!.y + target!.height / 2, id: 1 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await expect.poll(() => [...fixtureState.apps].sort((left, right) => left.sortOrder - right.sortOrder).map((app) => app.id)).toEqual(["beta", "alpha"]);
  });

  test("opens system details from every KPI card surface on desktop and mobile", async ({ page }) => {
    await installDashboardFixtures(page);
    await page.goto("/");

    const systemOverview = page.getByRole("region", { name: "System overview" });
    const cards = [
      { index: 0, title: "Processor", trigger: "View cpu details" },
      { index: 1, title: "Memory", trigger: "View memory details" },
      { index: 2, title: "Storage", trigger: "View storage details" },
    ];

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const card of cards) {
        const bounds = await systemOverview.locator(".system-summary-card").nth(card.index).boundingBox();
        expect(bounds).not.toBeNull();
        await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height - 8);

        const dialog = page.getByRole("dialog", { name: card.title });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute("aria-modal", "true");
        await page.keyboard.press("Shift+Tab");
        await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(card.trigger);
      }
    }
  });

  test("keeps focus and announces when keyboard reordering moves an app out of the dock", async ({ page }) => {
    const fixtureState = await installReorderFixtures(page, Array.from({ length: 5 }, (_, index) => ({
      ...apps[0],
      id: `app-${index}`,
      name: `App ${index + 1}`,
      sortOrder: index,
    })));

    await page.goto("/");
    const dockHandle = page.locator('.launcher-dock [data-reorder-id="app-3"] .app-reorder-handle');
    await dockHandle.focus();
    await dockHandle.press("ArrowDown");

    await expect.poll(() => [...fixtureState.apps].sort((left, right) => left.sortOrder - right.sortOrder).map((app) => app.id)).toEqual(["app-0", "app-1", "app-2", "app-4", "app-3"]);
    await expect(page.locator('.launcher-grid [data-reorder-id="app-3"] .app-reorder-handle')).toBeFocused();
    await expect(page.locator(".launcher-dock [role=status]").last()).toHaveText("App 4 moved to position 5 of 5.");
  });

  test("reannounces an identical dock keyboard move", async ({ page }) => {
    const fixtureState = await installReorderFixtures(page, Array.from({ length: 5 }, (_, index) => ({
      ...apps[0],
      id: `app-${index}`,
      name: `App ${index + 1}`,
      sortOrder: index,
    })));

    await page.goto("/");
    const dockStatus = page.locator(".launcher-dock [role=status]").last();
    const dockHandle = page.locator('.launcher-dock [data-reorder-id="app-3"] .app-reorder-handle');
    await dockHandle.focus();
    await dockHandle.press("ArrowDown");
    await expect.poll(() => [...fixtureState.apps].sort((left, right) => left.sortOrder - right.sortOrder).map((app) => app.id)).toEqual(["app-0", "app-1", "app-2", "app-4", "app-3"]);
    await expect(dockStatus).toHaveText("App 4 moved to position 5 of 5.");

    const gridHandle = page.locator('.launcher-grid [data-reorder-id="app-3"] .app-reorder-handle');
    await gridHandle.focus();
    await gridHandle.press("ArrowUp");
    await expect.poll(() => [...fixtureState.apps].sort((left, right) => left.sortOrder - right.sortOrder).map((app) => app.id)).toEqual(["app-0", "app-1", "app-2", "app-3", "app-4"]);

    await page.evaluate(() => {
      const liveRegions = document.querySelectorAll(".launcher-dock [role=status]");
      const liveRegion = liveRegions.item(liveRegions.length - 1);
      if (!liveRegion) throw new Error("Dock reorder live region is missing");
      const changes: string[] = [];
      new MutationObserver(() => changes.push(liveRegion.textContent ?? "")).observe(liveRegion, { childList: true, characterData: true, subtree: true });
      (window as Window & { __dockAnnouncementChanges?: string[] }).__dockAnnouncementChanges = changes;
    });

    await dockHandle.focus();
    await dockHandle.press("ArrowDown");
    await expect.poll(() => [...fixtureState.apps].sort((left, right) => left.sortOrder - right.sortOrder).map((app) => app.id)).toEqual(["app-0", "app-1", "app-2", "app-4", "app-3"]);
    await expect(dockStatus).toHaveText("App 4 moved to position 5 of 5.");
    await expect.poll(() => page.evaluate(() => (window as Window & { __dockAnnouncementChanges?: string[] }).__dockAnnouncementChanges)).toContain("");
  });

  test("keeps the dock item focused without announcing a failed keyboard reorder", async ({ page }) => {
    const fixtureApps = Array.from({ length: 5 }, (_, index) => ({
      ...apps[0],
      id: `app-${index}`,
      name: `App ${index + 1}`,
      sortOrder: index,
    }));
    await installReorderFixtures(page, fixtureApps, 500);

    await page.goto("/");
    const dockHandle = page.locator('.launcher-dock [data-reorder-id="app-3"] .app-reorder-handle');
    await dockHandle.focus();
    await dockHandle.press("ArrowDown");

    await expect.poll(() => page.locator(".launcher-dock [data-reorder-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-reorder-id")))).toEqual(["app-0", "app-1", "app-2", "app-3"]);
    await expect(dockHandle).toBeFocused();
    await expect(page.locator(".launcher-dock [role=status]").last()).toBeEmpty();
  });

  test("does not let an in-flight app load overwrite a reorder", async ({ page }) => {
    let persistedApps: DashboardApp[] = [
      { ...apps[0], id: "alpha", name: "Alpha", sortOrder: 0 },
      { ...apps[0], id: "beta", name: "Beta", sortOrder: 1 },
    ];
    let holdNextGet = false;
    let notifyStaleGet: () => void = () => undefined;
    let releaseStaleGet: () => void = () => undefined;
    const staleGetStarted = new Promise<void>((resolve) => { notifyStaleGet = resolve; });
    await installDashboardFixtures(page, persistedApps);
    await page.unroute("**/api/apps");
    await page.route("**/api/apps", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        const orderedApps = [...persistedApps].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
        if (holdNextGet) {
          holdNextGet = false;
          const staleResponse = new Promise<void>((resolve) => { releaseStaleGet = resolve; });
          notifyStaleGet();
          await staleResponse;
        }
        try {
          return await route.fulfill({ json: { apps: orderedApps, docker: { available: false, status: "unavailable", warnings: [], updatedAt: null } } });
        } catch {
          return;
        }
      }
      if (method === "POST") {
        const updatedApp = route.request().postDataJSON() as DashboardApp;
        persistedApps = persistedApps.map((app) => app.id === updatedApp.id ? updatedApp : app);
        holdNextGet = true;
        return route.fulfill({ json: { app: updatedApp } });
      }
      if (method === "PATCH") {
        const orderedIds = (route.request().postDataJSON() as { orderedIds: string[] }).orderedIds;
        const appsById = new Map(persistedApps.map((app) => [app.id, app]));
        persistedApps = orderedIds.map((id, sortOrder) => ({ ...appsById.get(id)!, sortOrder }));
        return route.fulfill({ json: { ok: true, orderedIds } });
      }
      return route.fulfill({ status: 400, json: { error: "unsupported application mutation" } });
    });

    try {
      await page.goto("/");
      await page.getByRole("button", { name: "Application management" }).click();
      await page.getByRole("button", { name: "Edit Alpha" }).click();
      const dialog = page.getByRole("dialog", { name: "Application details" });
      await dialog.getByLabel("Description").fill("Edited before reorder");
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await staleGetStarted;
      await page.getByRole("button", { name: "Close application modal" }).click();
      await page.getByRole("navigation", { name: "Quick launch" }).getByRole("button", { name: "Reorder application" }).first().press("ArrowDown");
      await expect.poll(() => persistedApps.map((app) => app.id)).toEqual(["beta", "alpha"]);
      releaseStaleGet();
      await expect.poll(() => page.locator(".launcher-dock [data-reorder-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-reorder-id")))).toEqual(["beta", "alpha"]);
    } finally {
      releaseStaleGet();
    }
  });

  test("shows network and processor readings in their cards and lets me switch storage volumes", async ({ page }) => {
    const fixtureOverview = { ...overview, temperatureC: 53, powerWatts: 3.28 };
    await installDashboardFixtures(page, apps, [], fixtureOverview);
    await page.goto("/");

    const systemOverview = page.getByRole("region", { name: "System overview" });
    await expect(systemOverview.getByRole("progressbar", { name: "CPU usage" })).toBeVisible();
    await expect(systemOverview.getByRole("progressbar", { name: "Memory usage" })).toBeVisible();
    await expect(systemOverview.getByRole("img", { name: "Upload rate: 500 KB/s" })).toBeVisible();
    await expect(systemOverview.getByRole("img", { name: "Download rate: 1.2 MB/s" })).toBeVisible();
    const processorReadings = systemOverview.getByRole("group", { name: "Processor readings" });
    await expect(processorReadings.getByRole("img", { name: "Temperature: 53°C" })).toBeVisible();
    await expect(processorReadings.getByRole("img", { name: "Power: 3.28 W" })).toBeVisible();

    const memoryTrigger = page.getByRole("button", { name: "View memory details" });
    await memoryTrigger.click();
    await expect(page.getByRole("dialog", { name: "Memory" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(memoryTrigger).toBeFocused();

    const storageTrigger = page.getByRole("button", { name: "View storage details" });
    await storageTrigger.dispatchEvent("click");
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

  test("opens system details when the body of a KPI card is pressed", async ({ page }) => {
    await installDashboardFixtures(page);
    await page.goto("/");

    const systemOverview = page.getByRole("region", { name: "System overview" });
    const cards = [
      { index: 0, title: "Processor", trigger: "View cpu details" },
      { index: 1, title: "Memory", trigger: "View memory details" },
      { index: 2, title: "Storage", trigger: "View storage details" },
    ];

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const card of cards) {
        const bounds = await systemOverview.locator(".system-summary-card").nth(card.index).boundingBox();
        expect(bounds).not.toBeNull();
        await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height - 8);

        const dialog = page.getByRole("dialog", { name: card.title });
        await expect(dialog).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(card.trigger);
      }
    }

    const networkBounds = await systemOverview.locator(".network-summary-card").boundingBox();
    expect(networkBounds).not.toBeNull();
    await page.mouse.click(networkBounds!.x + networkBounds!.width / 2, networkBounds!.y + networkBounds!.height / 2);
    await expect(page.getByRole("dialog")).toHaveCount(0);
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
    const settingsDialog = page.getByRole("dialog", { name: "Application management" });
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog).toHaveAttribute("aria-modal", "true");
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => settingsDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
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
    await expect(settingsDialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(settingsDialog).toBeVisible();
    await page.getByRole("button", { name: "Close application modal" }).click();
    await expect(settingsDialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
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
    await expect(page.getByRole("dialog", { name: "Processor" })).toHaveAttribute("aria-modal", "true");
    await page.getByRole("button", { name: "Close processor details" }).click();
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
    await expect(page.getByRole("region", { name: "Applications" }).getByRole("link", { name: "Demo service" })).toBeVisible();
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
    await expect(page.getByRole("region", { name: "Applications" }).getByRole("link", { name: "Demo service" })).toBeVisible();
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
