import { expect, test } from "@playwright/test";
import { seedClientWithStrategy } from "./fixtures/seed";

test.describe("onboarding and strategy", () => {
  test.setTimeout(120_000);

  let clientId: string;

  test.beforeAll(async ({ request }) => {
    clientId = await seedClientWithStrategy(request, `${Date.now()}`);
  });

  test("workspace loads seeded client and strategy UI", async ({ page }) => {
    await page.goto(`clients/${clientId}`);
    await expect(
      page
        .getByTestId("edit-strategy-button")
        .or(page.getByTestId("generate-strategy-button")),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("strategy-nav-positioning")).toBeVisible();
    await expect(page.getByText("Strategy document (Markdown)")).toHaveCount(0);
    await expect(page.getByText("Structured strategy (JSON)")).toHaveCount(0);
  });

  test("edit positioning and save, edit CTA and cancel", async ({ page }) => {
    await page.goto(`clients/${clientId}`);
    if (!(await page.getByTestId("edit-strategy-button").isVisible())) {
      await page.getByTestId("generate-strategy-button").click();
      await expect(page.getByTestId("edit-strategy-button")).toBeVisible({
        timeout: 45_000,
      });
    }
    await page.getByTestId("edit-strategy-button").click();
    await page.locator("#section-positioning textarea").fill(
      "Updated positioning from Playwright section editor.",
    );
    await page.getByTestId("save-strategy-button").click();
    await expect(page.getByTestId("edit-strategy-button")).toBeVisible();

    await page.getByTestId("edit-section-cta").click();
    await page.locator("#section-cta input").fill("CTA that should not persist");
    await page.getByTestId("cancel-section-cta").click();
    await expect(page.getByText("CTA that should not persist")).toHaveCount(0);
  });

  test("regenerate strategy twice", async ({ page }) => {
    await page.goto(`clients/${clientId}`);
    if (!(await page.getByTestId("regenerate-strategy-button").isVisible())) {
      await page.getByTestId("generate-strategy-button").click();
      await expect(page.getByTestId("regenerate-strategy-button")).toBeVisible({
        timeout: 45_000,
      });
    }
    await expect(page.getByTestId("regenerate-strategy-button")).toBeVisible({
      timeout: 45_000,
    });
    page.on("dialog", (dialog) => dialog.accept());
    // Fallback + fast responses can skip the loading headline frame entirely; assert stable completion.
    await page.getByTestId("regenerate-strategy-button").click();
    await expect(page.getByTestId("edit-strategy-button")).toBeVisible({
      timeout: 120_000,
    });
    await page.getByTestId("regenerate-strategy-button").click();
    await expect(page.getByTestId("edit-strategy-button")).toBeVisible({
      timeout: 120_000,
    });
  });
});
