import path from "node:path";
import { expect, test } from "@playwright/test";

const sowFixture = path.resolve(
  process.cwd(),
  "tests/playwright/fixtures/sow-sample.pdf",
);

test.describe("create client (UI)", () => {
  test("dialog cancel closes without creating", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("new-client-button").click();
    await expect(page.getByTestId("client-name-input")).toBeVisible();
    await page.getByTestId("client-name-input").fill("Cancel Test");
    await page.getByTestId("cancel-create-client-button").click();
    await expect(page.getByTestId("client-name-input")).not.toBeVisible();
    await expect(page).toHaveURL(/content-calendar\/?$/);
  });

  test("creates client from dashboard", async ({ page }) => {
    const unique = Date.now();
    const clientName = `UI Client ${unique}`;
    await page.goto("/");
    await page.getByTestId("new-client-button").click();
    await page.getByTestId("client-name-input").fill(clientName);
    await page.getByTestId("client-website-input").fill(`https://ui-${unique}.example`);
    await page.getByTestId("client-instagram-input").fill(`@ui_${unique}`);
    await page.getByTestId("client-description-input").fill("UI smoke create client.");
    await page.getByTestId("client-sow-pdf-input").setInputFiles(sowFixture);
    await page.getByTestId("create-client-submit").click();
    await Promise.race([
      page.waitForURL(/\/clients\/.+$/, { timeout: 20000 }),
      page.getByText(clientName).first().waitFor({ timeout: 20000 }),
    ]);
  });
});
