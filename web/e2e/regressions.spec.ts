import { expect, test } from "@playwright/test";

/** Regression checks for behaviour changed in the lint pass (hooks moved out of effects). */

test("landing hero: replay pauses for approval, finishes, and resets when the task changes", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator("[data-ui]").first();
  await hero.getByRole("button", { name: "Run", exact: true }).click();
  await hero.getByRole("button", { name: "Approve" }).click({ timeout: 30_000 });
  await expect(hero.getByText(/Reviewer approved/)).toBeVisible({ timeout: 60_000 });

  // choosing another task mid-replay stops it and returns to the ready state
  await hero.getByRole("button", { name: "Replay" }).click();
  await hero.getByRole("radio", { checked: false }).first().click();
  await expect(hero.getByText("Press Run to watch.")).toBeVisible();
  await expect(hero.getByText("0.0 s")).toBeVisible();
});

test("a ?task= link opens the run dialog once, and closing it keeps it closed", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(`e2e-preset-${Date.now()}@nexus.dev`);
  await page.getByLabel("Password").fill("nexus-e2e-pass");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/workflows?task=Summarise%20the%20supplier%20contracts");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox")).toHaveValue("Summarise the supplier contracts");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(1000); // the old effect reopened it on the next render
  await expect(dialog).toBeHidden();
});
