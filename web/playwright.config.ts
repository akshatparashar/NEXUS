import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against the real stack. Start it first:
 *   backend:  uv run python scripts/e2e_server.py      (API on :8000 with the extractive test model)
 *   web:      npm run dev                               (Next.js on :3000)
 * or point E2E_BASE_URL at a running Docker Compose stack.
 */
export default defineConfig({
  testDir: "./e2e",
  testIgnore: process.env.SHOTS ? [] : ["**/screenshots.spec.ts"],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    channel: process.env.E2E_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined),
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    trace: "retain-on-failure",
  },
});
