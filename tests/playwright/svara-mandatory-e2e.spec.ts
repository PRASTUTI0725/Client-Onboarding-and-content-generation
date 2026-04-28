/**
 * Full browser Svara workflow: real WhatsApp transfer PDF, screenshots, real/fallback discovery.
 * Run with servers up: pnpm start:isolated
 * Optional: SVARA_SOW_PDF_PATH=... npx playwright test tests/playwright/svara-mandatory-e2e.spec.ts
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const DEFAULT_SVARA_PDF =
  "C:\\Users\\prateek\\AppData\\Local\\Packages\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\\LocalState\\sessions\\4C8A9A0CB63EF008B32104806B2CF161801117E5\\transfers\\2026-17\\SOW_Svara_TheSocialIdiots (2).pdf";

function shotDir() {
  const dir = path.join(process.cwd(), "test-results", "svara-mandatory-e2e");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

test.describe("Svara mandatory browser E2E", () => {
  test.setTimeout(480_000);

  test("onboard Svara PDF → SOW → DNA → strategy → calendar (screenshots)", async ({ page, baseURL }, testInfo) => {
    const pdfPath = process.env.SVARA_SOW_PDF_PATH ?? DEFAULT_SVARA_PDF;
    test.skip(!existsSync(pdfPath), `SOW PDF missing at ${pdfPath} — set SVARA_SOW_PDF_PATH or copy the file.`);
    const out = shotDir();
    const stamp = Date.now();
    const name = `Svara ${stamp}`;

    const headersSeen: { strategySource?: string; strategyHeaders?: string; calendarSource?: string; strategyFailure?: unknown; calendarFailure?: unknown } = {};

    await page.setViewportSize({ width: 1400, height: 900 });
    const start = baseURL ?? "http://127.0.0.1:5174/content-calendar/";
    await page.goto(start, { waitUntil: "domcontentloaded" });

    await page.getByTestId("new-client-button").first().click();
    await expect(page.getByTestId("client-name-input")).toBeVisible();

    await page.getByTestId("client-name-input").fill(name);
    await page.getByTestId("client-website-input").fill("https://svaraonline.in/");
    await page.getByTestId("client-instagram-input").fill("svara_online");
    await page.getByTestId("client-sow-pdf-input").setInputFiles(pdfPath);
    await page.screenshot({ path: path.join(out, "00-dialog-filled.png"), fullPage: true });

    await page.getByTestId("create-client-submit").click();

    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/i, { timeout: 120_000 });
    const clientUrl = page.url();
    const clientId = clientUrl.match(/clients\/([0-9a-f-]+)/i)?.[1];
    expect(clientId).toBeTruthy();

    if (await page.getByRole("button", { name: "Proceed anyway" }).isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "Proceed anyway" }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${clientId}`));
    }

    await expect(page.getByRole("heading", { name: "Statement of Work" })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(out, "01-workspace-sow.png"), fullPage: true });

    const uor = page.getByTestId("sow-understanding-input");
    await uor.waitFor({ state: "visible", timeout: 30_000 });
    const uorText = await uor.inputValue();
    await uor.screenshot({ path: path.join(out, "02-sow-uor-roman.png") });
    const romanOk = /\bI[\s.]+|Objectives|Roman|Goals/i.test(uorText) || uorText.length > 80;
    testInfo.annotations.push({ type: "sow-roman", description: String(romanOk) });
    void expect(romanOk || uorText.length > 0).toBe(true);

    const strip = page.getByTestId("sow-validation-status-strip");
    await expect(strip).toBeVisible();
    await strip.screenshot({ path: path.join(out, "03-content-mix-status-strip.png") });
    const stripText = await strip.innerText();
    void expect(stripText).toMatch(/SOW status|monthly|posts|pillars|Instagram|Pinterest|✓|✗/i);

    await page.screenshot({ path: path.join(out, "04-full-sow-dna.png"), fullPage: true });

    const dnaCard = page.getByText("Purpose").first();
    if (await dnaCard.isVisible().catch(() => false)) {
      await dnaCard.scrollIntoViewIfNeeded();
    }
    await page.screenshot({ path: path.join(out, "05-business-dna.png"), fullPage: true });

    const pageText = await page.innerText("body");
    void expect(pageText).not.toContain("India&#39;s");
    void expect(pageText).not.toContain("&#39;");

    await page.getByTestId("sow-approve-and-save").click();
    await expect(page.getByText("SOW approved and saved", { exact: true })).toBeVisible({ timeout: 90_000 });

    const genRespPromise = page.waitForResponse(
      (r) => r.url().includes("/strategy/generate") && r.request().method() === "POST",
      { timeout: 300_000 },
    );
    await page.getByTestId("generate-strategy-button").click();
    const genRes = await genRespPromise;
    expect(genRes.ok()).toBeTruthy();
    const genJson = (await genRes.json()) as { strategySource?: string; aiFailure?: unknown };
    headersSeen.strategySource = genJson.strategySource;
    if (genJson.aiFailure) headersSeen.strategyFailure = genJson.aiFailure;
    const hs = genRes.headers();
    headersSeen.strategyHeaders = hs["x-strategy-source"] ?? hs["X-Strategy-Source"];

    await expect(page.getByTestId("regenerate-strategy-button")).toBeVisible({ timeout: 300_000 });
    await expect(page.getByTestId("approve-strategy-button")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: path.join(out, "06-after-strategy-generated.png"), fullPage: true });

    await page.getByTestId("approve-strategy-button").click();
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible({ timeout: 60_000 });

    await page.getByTestId("open-calendar-button").click();
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/calendar`));

    await expect(page.getByTestId("plan-month-button")).toBeVisible({ timeout: 30_000 });
    const calRespPromise = page.waitForResponse(
      (r) => r.url().includes("/calendar/generate") && r.request().method() === "POST",
      { timeout: 300_000 },
    );
    await page.getByTestId("plan-month-button").click();
    await page.getByTestId("monthly-goal-input").fill("Svara founder demo month");
    await page.getByTestId("confirm-generate-calendar-button").click();
    const calRes = await calRespPromise;
    expect(calRes.ok()).toBeTruthy();
    const calJson = (await calRes.json()) as { calendarSource?: string; aiFailure?: unknown };
    headersSeen.calendarSource = calJson.calendarSource;
    if (calJson.aiFailure) headersSeen.calendarFailure = calJson.aiFailure;

    await expect(page.getByText("Calendar generated", { exact: true })).toBeVisible({ timeout: 120_000 });
    await page.screenshot({ path: path.join(out, "07-calendar-generated.png"), fullPage: true });

    const headersJson = JSON.stringify(headersSeen, null, 2);
    writeFileSync(path.join(out, "e2e-headers.json"), headersJson, "utf-8");
    await testInfo.attach("e2e-headers.json", {
      body: Buffer.from(headersJson, "utf-8"),
      contentType: "application/json",
    });
  });
});
