import { expect, test } from "@playwright/test";

test.describe("dashboard", () => {
  test("loads and shows clients heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    await expect(page.getByTestId("new-client-button")).toBeVisible();
    const loadDemo = page.getByTestId("load-demo-clients-button");
    if (await loadDemo.isVisible()) {
      await loadDemo.click();
      await expect(page.getByTestId("load-demo-clients-button")).toBeVisible();
    }
  });
});
