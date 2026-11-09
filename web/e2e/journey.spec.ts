import { expect, type Page, test } from "@playwright/test";
import path from "node:path";

/**
 * The whole product, driven through the browser like a person would:
 * register → upload → ask → build → run (live) → approve → monitor.
 * Covers acceptance criteria 1–9 of NEXUS_SPEC.md (10 is the Compose smoke test).
 */

const SAMPLES = path.resolve(__dirname, "../../docs/samples");
const email = `e2e-${Date.now()}@nexus.dev`;
const password = "nexus-e2e-pass";

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

test("1 · register and land in a seeded workspace", async () => {
  await page.goto("/register");
  await page.getByLabel("Name").fill("Grace Hopper");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await expect(page.getByText("Get your first run going")).toBeVisible();
  await expect(page.getByText("Research brief").first()).toBeVisible();
});

test("1b · sign out and sign back in", async () => {
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
});

test("4 · upload documents; they are parsed, chunked and embedded", async () => {
  await page.goto("/app/knowledge");
  await page.locator('input[type="file"]').setInputFiles([
    path.join(SAMPLES, "supplier-agreement-2026.md"),
    path.join(SAMPLES, "postmortem-checkout-outage.md"),
    path.join(SAMPLES, "obsolete-draft-2024.txt"),
  ]);
  for (const name of ["supplier-agreement-2026.md", "postmortem-checkout-outage.md", "obsolete-draft-2024.txt"]) {
    const row = page.locator("li", { hasText: name });
    await expect(row.getByText("Ready")).toBeVisible({ timeout: 120_000 });
  }
});

test("5 · retrieval returns the relevant chunk, and answers cite it", async () => {
  await page.getByRole("radio", { name: "Passages" }).click();
  await page.getByPlaceholder(/refund policy|Add a document/).fill("early exit fee termination for convenience");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const first = page.locator("tbody tr").first();
  await expect(first).toContainText("supplier-agreement-2026.md");
  await expect(first).toContainText("35%");

  await page.getByRole("radio", { name: "Answer" }).click();
  await page.getByPlaceholder(/What does the policy say/).fill("How long did the checkout outage last?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".prose-agent").first()).toContainText("47 minutes");
  await expect(page.locator("#ask-src-1")).toContainText("postmortem-checkout-outage.md");
});

test("2 · build a workflow on the canvas and it saves", async () => {
  await page.goto("/app/workflows");
  await page.getByRole("button", { name: "New workflow" }).click();
  await expect(page).toHaveURL(/\/app\/workflows\/[0-9a-f-]+$/);
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.getByLabel("Workflow name").fill("Due diligence");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("2"); // add an Analyst
  await page.keyboard.press("Escape");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(page.getByText(/Connect or remove/)).toBeVisible();

  // connect Research → Analyst by dragging between handles
  const source = page.locator('.react-flow__node[data-id="research"] .react-flow__handle.source');
  const target = page.locator('.react-flow__node[data-id="analyst"] .react-flow__handle.target');
  await page.waitForTimeout(600); // let the view settle after the new agent pans in
  await source.dragTo(target, { timeout: 10_000 });
  await expect(page.getByText("Compiles to LangGraph · 2 nodes")).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByLabel("Workflow name")).toHaveValue("Due diligence");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("3 · 6 · 8 · agents collaborate through LangGraph, grounded in RAG, live in the builder", async () => {
  await page.goto("/app/workflows");
  await page.getByRole("link", { name: "Research brief" }).click();
  await expect(page).toHaveURL(/\/app\/workflows\/[0-9a-f-]+$/);
  await expect(page.getByText("Compiles to LangGraph · 3 nodes")).toBeVisible();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByLabel("Task").fill("What are the biggest risks in the supplier agreement?");
  await page.getByRole("button", { name: "Start run" }).click();

  // the canvas follows the run: a node shows violet "working" state, then everything finishes
  const drawer = page.locator(".glass", { hasText: "Open run" });
  await expect(drawer).toBeVisible();
  await expect(page.locator(".react-flow__node .thinking-dot").first()).toBeVisible({ timeout: 30_000 });
  await expect(drawer.getByText("Succeeded", { exact: true }).first()).toBeVisible({ timeout: 60_000 });

  await drawer.getByRole("link", { name: "Open run" }).click();
  await expect(page.getByText("Reviewer").first()).toBeVisible();
  // the reviewer sent work back once (revision), then approved
  await expect(page.getByText("revision 1", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await expect(page.locator("#source-1")).toContainText("supplier-agreement-2026.md");
});

test("9 · execution logs are persisted and replay", async () => {
  await page.getByRole("tab", { name: /Event log/ }).click();
  await expect(page.getByRole("cell", { name: "workflow.started" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "workflow.completed" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "review.revision_requested" })).toBeVisible();
  await page.reload(); // a fresh connection replays everything from the database
  await page.getByRole("tab", { name: /Event log/ }).click();
  await expect(page.getByRole("cell", { name: "workflow.completed" })).toBeVisible();
});

test("approval · a destructive action pauses the run until a person approves", async () => {
  await page.goto("/app/workflows");
  const card = page.locator("article", { hasText: "Analyze & act" });
  await card.getByRole("button", { name: "Run" }).click();
  await page.getByLabel("Task").fill("Summarise the supplier agreement and delete obsolete-draft-2024.txt");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page).toHaveURL(/\/app\/runs\//);

  const dialog = page.getByRole("dialog", { name: "Approve these actions?" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog).toContainText("obsolete-draft-2024.txt");
  await dialog.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Succeeded").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Artifacts" })).toBeVisible();

  await page.goto("/app/knowledge");
  await expect(page.getByText("supplier-agreement-2026.md")).toBeVisible();
  await expect(page.getByText("obsolete-draft-2024.txt")).toHaveCount(0);
});

test("7 · lifecycle events flowed through the bus to the consumers", async () => {
  await page.goto("/app/monitoring");
  await expect(page.getByText("nexus-projector")).toBeVisible();
  await expect(page.getByText("Pipeline healthy")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("tbody").first()).toContainText("Research");
  await page.goto("/app");
  await expect(page.getByText(/runs succeeded|All clear/)).toBeVisible();
});

test("⌘K palette jumps anywhere", async () => {
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Search workflows, runs and commands…").fill("due dil");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/workflows\//);
});
