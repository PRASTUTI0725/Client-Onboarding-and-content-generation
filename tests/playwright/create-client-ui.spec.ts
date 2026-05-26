import { expect, test } from "@playwright/test";
import { getApiConfig } from "./fixtures/seed";

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

  test("creates client from dashboard and preserves one-line summary", async ({ page, request }) => {
    const unique = Date.now();
    const clientName = `UI Client ${unique}`;
    const websiteUrl = `https://ui-${unique}.example`;
    const instagramHandle = `@ui_${unique}`;
    const oneLineDescription = "UI smoke create client with persisted one-line summary.";
    const { apiUrl, apiKey } = getApiConfig();

    await page.goto("/");
    await page.getByTestId("new-client-button").click();
    await page.getByTestId("client-name-input").fill(clientName);
    await page.getByTestId("client-website-input").fill(websiteUrl);
    await page.getByTestId("client-instagram-input").fill(instagramHandle);
    await page.getByTestId("client-description-input").fill(oneLineDescription);
    const createRequestPromise = page.waitForRequest(
      (request) => request.url().includes("/api/clients") && request.method() === "POST",
    );
    await page.getByTestId("create-client-submit").click();
    const createRequest = await createRequestPromise;
    expect(createRequest.postDataJSON()).toMatchObject({
      name: clientName,
      websiteUrl,
      instagramHandle,
      oneLineDescription,
    });
    await Promise.race([
      page.waitForURL(/\/clients\/.+$/, { timeout: 20000 }),
      page.getByText(clientName).first().waitFor({ timeout: 20000 }),
    ]);
    const clientId = page.url().match(/\/clients\/([^/?#]+)/)?.[1];
    expect(clientId).toBeTruthy();

    const detail = await request.get(`${apiUrl}/clients/${clientId}`, {
      headers: { "x-api-key": apiKey },
    });
    expect(detail.ok()).toBeTruthy();
    const payload = (await detail.json()) as {
      client: {
        website: string | null;
        instagramHandle: string | null;
        oneLineDescription: string | null;
      };
    };
    expect(payload.client.website).toBe(websiteUrl);
    expect(payload.client.instagramHandle).toBe(instagramHandle);
    expect(payload.client.oneLineDescription).toBe(oneLineDescription);
  });
});
