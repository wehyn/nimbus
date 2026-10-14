import { expect, test } from "@playwright/test";

test("shows Crafty controls and reloads its intercepted frame", async ({ page }) => {
  let frameRequests = 0;
  await page.route(/^http:\/\/localhost:8443\/?$/, async (route) => {
    frameRequests += 1;
    await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Intercepted Crafty</title>" });
  });

  await page.goto("/apps/crafty-controller");

  await expect(page.getByRole("heading", { name: "Crafty Controller" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nimbus" })).toHaveAttribute("href", "/");
  const frame = page.locator('iframe[title="Crafty Controller"]');
  await expect(frame).toHaveAttribute("src", "http://localhost:8443");
  await expect(page.getByText(/frame|sign-in/i)).toBeVisible();
  const externalLink = page.getByRole("link", { name: "Open in new tab" });
  await expect(externalLink).toHaveAttribute("href", "http://localhost:8443");
  await expect(externalLink).toHaveAttribute("target", "_blank");
  await expect(externalLink).toHaveAttribute("rel", "noreferrer");
  await expect.poll(() => frameRequests).toBe(1);

  await page.getByRole("button", { name: "Reload" }).click();
  await expect.poll(() => frameRequests).toBe(2);
});

test("returns 404 for an unknown app ID", async ({ page }) => {
  const response = await page.goto("/apps/no-such-app");

  expect(response?.status()).toBe(404);
});

test("keeps the viewer within desktop and mobile viewport widths", async ({ page }) => {
  await page.route(/^http:\/\/localhost:8443\/?$/, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/apps/crafty-controller");
  await expect(page.getByRole("heading", { name: "Crafty Controller" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);

  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
