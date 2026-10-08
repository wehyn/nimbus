import { expect, test } from "@playwright/test";

const discoveredApp = {
  id: "discovered",
  name: "Discovered service",
  description: "Found by Docker discovery",
  category: "Other",
  url: "https://discovered.invalid",
  icon: "",
  color: "#b9e394",
  status: "online" as const,
  source: "docker" as const,
  isVisible: true,
  sortOrder: 0,
  dockerProject: "demo",
  dockerService: "web",
  containerName: "demo-web-1",
};

const pendingResponse = {
  apps: [discoveredApp],
  docker: {
    available: false,
    status: "unavailable",
    warnings: ["Docker discovery is still loading."],
    updatedAt: null,
  },
};

const completedResponse = {
  apps: [{ ...discoveredApp, dockerDetails: {
    source: "container" as const,
    image: "example/discovered:1.0",
    networks: ["bridge"],
    ports: [],
    volumes: [],
    environment: [],
  } }],
  docker: {
    available: true,
    status: "available",
    warnings: [],
    updatedAt: "2026-10-08T00:00:00.000Z",
  },
};

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
  storageVolumes: [],
  updatedAt: "2026-10-08T00:00:00.000Z",
};

test("refreshes the open application details when Docker discovery completes", async ({ page }) => {
  let appReads = 0;
  await page.route("**/api/apps", async (route) => {
    appReads += 1;
    if (appReads === 1) await new Promise((resolve) => setTimeout(resolve, 750));
    await route.fulfill({ json: appReads === 1 ? pendingResponse : completedResponse });
  });
  await page.route("**/api/activity", (route) => route.fulfill({ json: { activities: [] } }));
  await page.route("**/api/overview", (route) => route.fulfill({ json: overview }));
  await page.route("**/api/health**", (route) => route.fulfill({ json: { status: "online", latency: 10, statusCode: 200 } }));

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Discovered service" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Application management" })).toBeVisible();
  await page.getByRole("button", { name: "Application management" }).click();
  await page.getByRole("button", { name: "Edit Discovered service" }).click();
  const titleInput = page.getByLabel("Title");
  await titleInput.fill("Locally edited title");
  await expect.poll(() => appReads).toBe(2);
  const imageMetadata = page.locator(".docker-metadata-item").filter({ hasText: "Docker image tag" });
  await expect(imageMetadata).toContainText("example/discovered:1.0");
  await expect(titleInput).toHaveValue("Locally edited title");
  await imageMetadata.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/docker-discovery-refresh.png", animations: "disabled" });
  await page.waitForTimeout(1_100);
  expect(appReads).toBe(2);
});

test("caps pending Docker discovery follow-up reads at three", async ({ page }) => {
  let appReads = 0;
  await page.route("**/api/apps", async (route) => {
    appReads += 1;
    await route.fulfill({ json: pendingResponse });
  });
  await page.route("**/api/activity", (route) => route.fulfill({ json: { activities: [] } }));
  await page.route("**/api/overview", (route) => route.fulfill({ json: overview }));
  await page.route("**/api/health**", (route) => route.fulfill({ json: { status: "online", latency: 10, statusCode: 200 } }));

  await page.goto("/");
  await expect.poll(() => appReads).toBe(4);
  await page.waitForTimeout(1_100);

  expect(appReads).toBe(4);
});
