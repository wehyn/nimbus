import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const browserDatabasePath = process.env.NIMBUS_PLAYWRIGHT_DATABASE_PATH || join(process.cwd(), ".playwright-cli", `nimbus-browser-${process.pid}.db`);
process.env.NIMBUS_PLAYWRIGHT_DATABASE_PATH = browserDatabasePath;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    env: {
      NODE_ENV: "development",
      DATABASE_PATH: browserDatabasePath,
      DOCKER_AGENT_URL: "",
      DOCKER_AGENT_TOKEN: "",
      MEMORY_AGENT_URL: "",
      MEMORY_AGENT_TOKEN: "",
      HARDWARE_AGENT_URL: "",
      HARDWARE_AGENT_TOKEN: "",
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
