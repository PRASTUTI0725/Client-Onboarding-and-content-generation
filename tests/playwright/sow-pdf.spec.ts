import path from "node:path";
import { expect, test } from "@playwright/test";
import { seedClientWithStrategy } from "./fixtures/seed";

test.describe("sow pdf upload", () => {
  let clientId: string;

  test.beforeAll(async ({ request }) => {
    clientId = await seedClientWithStrategy(request, `pdf-${Date.now()}`);
  });

  test("uploads SOW PDF and applies suggestions when available", async ({ page }) => {
    await page.goto(`clients/${clientId}`);

    const filePath = path.resolve(
      process.cwd(),
      "tests/playwright/fixtures/sow-sample.pdf",
    );
    await page.getByTestId("sow-pdf-input").setInputFiles(filePath);
    await page.getByTestId("parse-sow-pdf-button").click();

    const parseFeedback = page.getByTestId("sow-pdf-parse-feedback");
    await expect(parseFeedback).toBeVisible({ timeout: 25000 });
    const feedbackText = (await parseFeedback.textContent()) ?? "";

    if (feedbackText.toLowerCase().includes("success")) {
      const applyBtn = page.getByTestId("apply-sow-pdf-suggestions-button");
      if (await applyBtn.isEnabled()) {
        await applyBtn.click();
        await expect(page.getByText("Applied PDF suggestions").first()).toBeVisible();
      }
    }
  });
});

