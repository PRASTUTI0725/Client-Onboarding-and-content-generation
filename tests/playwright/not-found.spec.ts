import { expect, test } from "@playwright/test";

test("404 route renders", async ({ page }) => {
  await page.goto("does-not-exist");
  await expect(page.getByText("404 Page Not Found")).toBeVisible();
  await expect(
    page.getByText(
      "The page you requested does not exist or may have been moved.",
    ),
  ).toBeVisible();
});
