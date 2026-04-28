import { expect, test } from "@playwright/test";
import {
  seedClientWithStrategy,
  generateCalendarViaApi,
  getApiConfig,
} from "./fixtures/seed";

test.describe("calendar", () => {
  test.setTimeout(120_000);

  let clientId: string;

  test.beforeAll(async ({ request }) => {
    clientId = await seedClientWithStrategy(request, `cal-${Date.now()}`);
    const { apiUrl, apiKey } = getApiConfig();
    const detailRes = await request.get(`${apiUrl}/clients/${clientId}`, {
      headers: { "x-api-key": apiKey },
    });
    const detail = (await detailRes.json()) as {
      strategy: { structuredStrategy: Record<string, unknown> } | null;
    };
    const sectionKeys = [
      "marketNarrative",
      "problemGapSolution",
      "brandFoundation",
      "brandPhilosophy",
      "audience",
      "emotionalDrivers",
      "platformStrategy",
      "contentStrategy",
      "kpis",
      "trackingPlan",
      "executionPhases",
      "assetRequirements",
    ];
    const approvals = Object.fromEntries(sectionKeys.map((key) => [key, true]));
    await request.patch(`${apiUrl}/clients/${clientId}/strategy`, {
      headers: { "x-api-key": apiKey },
      data: {
        structuredStrategy: {
          ...(detail.strategy?.structuredStrategy ?? {}),
          __meta: {
            ...(((detail.strategy?.structuredStrategy as { __meta?: Record<string, unknown> } | undefined)
              ?.__meta ?? {}) as Record<string, unknown>),
            sectionApprovals: approvals,
          },
        },
        status: "approved",
      },
    });
    await generateCalendarViaApi(request, clientId, {
      month: "June 2026",
      startDate: "2026-06-01",
      goal: "First fixture month",
    });
    await generateCalendarViaApi(request, clientId, {
      month: "July 2026",
      startDate: "2026-07-01",
      goal: "Second fixture month (regenerate)",
    });
  });

  test("calendar shows seeded posts; update status and comments in sheet", async ({
    page,
  }) => {
    await page.goto(`clients/${clientId}/calendar`);
    await page.getByTestId("calendar-view-toggle-calendar").click();

    const firstPost = page.locator('[data-testid^="calendar-post-"]').first();
    await expect(firstPost).toBeVisible({ timeout: 60_000 });

    await firstPost.click();
    await page.getByTestId("post-status-approved").click();
    await page.getByTestId("post-comment-input").fill("E2E comment one");
    await page.getByTestId("post-comment-submit").click();
    await expect(page.getByText("Comment added").first()).toBeVisible();

    await page.getByTestId("post-comment-input").fill("E2E comment two");
    await page.getByTestId("post-comment-submit").click();
    await expect(page.getByText("Comment added").first()).toBeVisible();
  });
});
