import { expect, type Page, test } from "@playwright/test";
import path from "node:path";

/**
 * Captures docs/screenshots/*.png from a live stack with real data.
 * Run with:  SHOTS=1 npx playwright test e2e/screenshots.spec.ts
 */
const OUT = path.resolve(__dirname, "../../docs/screenshots");
const SAMPLES = path.resolve(__dirname, "../../docs/samples");
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
});

test("landing", async () => {
  await page.goto("/");
  await page.waitForTimeout(1500);
  await shot(page, "01-landing-hero");
  await page.getByRole("button", { name: "Run" }).first().click();
  await page.waitForTimeout(5200);
  await shot(page, "02-landing-hero-live");
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible({ timeout: 20_000 });
  await shot(page, "03-landing-hero-approval");
  await page.getByRole("heading", { name: "Every run, on one board." }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await shot(page, "04-landing-board");
});

test("app", async () => {
  await page.goto("/register");
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(`shots-${Date.now()}@nexus.dev`);
  await page.getByLabel("Password").fill("nexus-shots-pass");
  await shot(page, "05-register");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();

  await page.goto("/app/knowledge");
  await page.locator('input[type="file"]').setInputFiles([
    path.join(SAMPLES, "supplier-agreement-2026.md"),
    path.join(SAMPLES, "postmortem-checkout-outage.md"),
    path.join(SAMPLES, "obsolete-draft-2024.txt"),
  ]);
  await expect(page.locator("li", { hasText: "obsolete-draft-2024.txt" }).getByText("Ready")).toBeVisible({ timeout: 120_000 });
  await page.getByPlaceholder(/What does the policy say/).fill("What happens if we terminate the supplier agreement early?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".prose-agent").first()).toContainText("35%");
  await page.waitForTimeout(800);
  await shot(page, "06-knowledge");

  // a run followed live on the canvas
  await page.goto("/app/workflows");
  await shot(page, "07-workflows");
  await page.getByRole("link", { name: "Research brief" }).click();
  await expect(page.getByText("Compiles to LangGraph · 3 nodes")).toBeVisible();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByLabel("Task").fill("What are the biggest risks in the supplier agreement, and what do they cost?");
  await shot(page, "08-run-dialog");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.locator(".react-flow__node .thinking-dot").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await shot(page, "09-builder-live-run");
  const drawer = page.locator(".glass", { hasText: "Open run" });
  await expect(drawer.getByText("Succeeded", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(600);
  await shot(page, "10-builder-run-done");
  await drawer.getByRole("link", { name: "Open run" }).click();
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, "11-run-detail");

  // approval
  await page.goto("/app/workflows");
  await page.locator("article", { hasText: "Analyze & act" }).getByRole("button", { name: "Run" }).click();
  await page.getByLabel("Task").fill("Summarise the supplier agreement and delete obsolete-draft-2024.txt");
  await page.getByRole("button", { name: "Start run" }).click();
  const dialog = page.getByRole("dialog", { name: "Approve these actions?" });
  await expect(dialog).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(500);
  await shot(page, "12-approval");
  await dialog.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "Artifacts" })).toBeVisible({ timeout: 90_000 });

  // one more run so the charts have shape
  await page.goto("/app/workflows");
  await page.locator("article", { hasText: "Two-angle comparison" }).getByRole("button", { name: "Run" }).click();
  await page.getByLabel("Task").fill("Weigh the outage follow-ups against each other.");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.getByText("Succeeded").first()).toBeVisible({ timeout: 90_000 });

  await page.goto("/app");
  await page.waitForTimeout(1500);
  await shot(page, "13-overview");

  await page.goto("/app/runs");
  await page.waitForTimeout(800);
  await shot(page, "14-runs");

  await page.goto("/app/monitoring");
  await page.waitForTimeout(3500);
  await shot(page, "15-monitoring");

  await page.goto("/app/playground");
  await page.getByLabel("Message").fill("When did checkout recover, and why did it fail?");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Searched the knowledge base/)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await shot(page, "16-playground");

  await page.goto("/app/settings");
  await page.waitForTimeout(600);
  await shot(page, "17-settings");

  await page.goto("/app");
  await page.waitForTimeout(800);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(500);
  await shot(page, "18-command-palette");
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await page.waitForTimeout(1200);
  await shot(page, "19-mobile-overview");
  await page.goto("/");
  await page.waitForTimeout(1500);
  await shot(page, "20-mobile-landing");
});
