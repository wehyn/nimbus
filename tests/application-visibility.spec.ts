import { expect, test } from "@playwright/test";

const originalApp = {
  id: "visibility-demo",
  name: "Visibility demo",
  description: "An application whose launcher visibility can change.",
  category: "Other",
  url: "https://visibility.invalid",
  icon: "",
  color: "#b9e394",
  status: "online" as const,
  source: "manual" as const,
  isVisible: true,
  sortOrder: 0,
};

test("a hidden application stays manageable and can be restored to the launcher", async ({ page }) => {
  let savedApp = originalApp;
  const savedVisibility: boolean[] = [];

  await page.route("**/api/apps", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { apps: [savedApp], docker: { available: false, status: "unavailable", warnings: [], updatedAt: null } } });
    }

    const payload = route.request().postDataJSON() as typeof originalApp;
    savedVisibility.push(payload.isVisible);
    savedApp = payload;
    return route.fulfill({ json: { app: payload } });
  });
  await page.route("**/api/activity", (route) => route.fulfill({ json: { activities: [] } }));
  await page.route("**/api/overview", (route) => route.fulfill({ json: {
    uptime: "1h 2m", cpu: 12.5, cpuCores: 4, temperatureC: null, powerWatts: null, powerSource: null,
    memory: 37.5, memoryUsed: "3.0 GB", memoryTotal: "8 GB", storage: 42, storageUsed: "42 GB",
    storageAvailable: "58 GB", storageTotal: "100 GB", downloadBytesPerSecond: 0, uploadBytesPerSecond: 0,
    storageVolumes: [], updatedAt: "2026-09-02T12:00:00.000Z",
  } }));
  await page.route("**/api/health**", (route) => route.fulfill({ json: { status: "online", latency: 20, statusCode: 200 } }));

  await page.goto("/");
  await expect(page.getByRole("link", { name: /Visibility demo/ })).toBeVisible();

  await page.getByRole("button", { name: "Application management" }).click();
  await page.getByRole("button", { name: "Edit Visibility demo" }).click();
  const visibility = page.getByRole("button", { name: "Show on launcher" });
  await expect(visibility).toHaveAttribute("aria-pressed", "true");
  await visibility.click();
  await expect(visibility).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("link", { name: /Visibility demo/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Application management" })).toBeVisible();

  await page.getByRole("button", { name: "Edit Visibility demo" }).click();
  const hiddenVisibility = page.getByRole("button", { name: "Show on launcher" });
  await expect(hiddenVisibility).toHaveAttribute("aria-pressed", "false");
  await hiddenVisibility.click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("link", { name: /Visibility demo/ })).toBeVisible();
  await expect.poll(() => savedVisibility).toEqual([false, true]);
  await expect(page.getByRole("button", { name: "Edit Visibility demo" })).toBeVisible();
});
