import { expect, test } from "@playwright/test";
import { seedClientWithStrategy } from "./fixtures/seed";

test.describe("calendar generate dialog (UI)", () => {
  let clientId: string;

  test.beforeAll(async ({ request }) => {
    clientId = await seedClientWithStrategy(request, `dlg-${Date.now()}`);
  });

  test("opens plan dialog and cancels without error", async ({ page }) => {
    await page.goto(`clients/${clientId}/calendar`);
    await page.getByTestId("plan-month-button").click();
    await expect(page.getByTestId("month-label-input")).toBeVisible();
    await page.getByTestId("cancel-generate-calendar-button").click();
    await expect(page.getByTestId("month-label-input")).not.toBeVisible();
  });
});
