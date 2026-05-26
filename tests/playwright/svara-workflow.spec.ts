import { expect, test } from "@playwright/test";
import { getApiConfig } from "./fixtures/seed";

test.describe("svara full workflow", () => {
  test("validates tabs, filters, board published, post detail, and pdf download", async ({
    page,
    request,
  }) => {
    const { apiKey, apiUrl } = getApiConfig();
    const headers = { "x-api-key": apiKey };
    const create = await request.post(`${apiUrl}/clients`, {
      headers,
      data: {
        name: "Svara Perfumes",
        websiteUrl: "https://svaraonline.in/",
        instagramHandle: "@svara_online",
        oneLineDescription:
          "Svara's alcohol-free, oil-based formula is gentle enough for daily use on pulse points and is free from harsh chemicals, making it suitable for sensitive, dry, or reactive skin types.",
      },
    });
    const client = (await create.json()) as { id: string };
    await request.put(`${apiUrl}/clients/${client.id}/sow`, {
      headers,
      data: {
        understandingOfRequirements: "SOW parsed from People Reflekt style proposal.",
        scopeOfWork: "Strategy, content, platform management, branding.",
        pricingOptions: "Option 1 14K; Option 2 17K",
        timeline: "Immediate launch",
        paymentTerms: "50% advance, 50% later",
        nextSteps: "Finalize and start",
        approval: { approved: true },
        platforms: ["Instagram", "Pinterest"],
        monthlyPosts: { Instagram: 12, Pinterest: 4 },
        contentMix: { education: 35, thought_leadership: 20, social_proof: 25, promotion: 20 },
        deliverables: ["Monthly content calendar"],
        toneByPlatform: { Instagram: "Playful + aspirational", Pinterest: "Educational + premium" },
      },
    });
    await request.post(`${apiUrl}/clients/${client.id}/strategy/generate`, { headers, data: {} });
    const detail = (await (
      await request.get(`${apiUrl}/clients/${client.id}`, { headers })
    ).json()) as { strategy: { structuredStrategy: Record<string, unknown> } };
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
    await request.patch(`${apiUrl}/clients/${client.id}/strategy`, {
      headers,
      data: {
        structuredStrategy: {
          ...detail.strategy.structuredStrategy,
          __meta: {
            ...((detail.strategy.structuredStrategy.__meta as Record<string, unknown>) ?? {}),
            sectionApprovals: approvals,
          },
        },
        status: "approved",
      },
    });
    const calendarGenerate = await request.post(`${apiUrl}/clients/${client.id}/calendar/generate`, {
      headers,
      data: { month: "July 2026", startDate: "2026-07-01", goal: "Svara launch month" },
    });
    const generatedCalendar = (await calendarGenerate.json()) as {
      planner?: { platformSplit?: Record<string, number> };
      posts?: Array<{ platform?: string }>;
    };
    expect(generatedCalendar.posts).toHaveLength(16);
    expect(generatedCalendar.planner?.platformSplit).toMatchObject({ Instagram: 12, Pinterest: 4 });
    const generatedPlatformCounts = (generatedCalendar.posts ?? []).reduce<Record<string, number>>((acc, post) => {
      const platform = post.platform ?? "unknown";
      acc[platform] = (acc[platform] ?? 0) + 1;
      return acc;
    }, {});
    expect(generatedPlatformCounts).toMatchObject({ Instagram: 12, Pinterest: 4 });

    await page.goto(`clients/${client.id}`);
    await expect(page.getByText("Jump to section")).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("print-strategy-button").click();
    await downloadPromise;

    await page.goto(`clients/${client.id}/calendar`);
    await page.getByTestId("calendar-view-toggle-planner").click();
    await expect(page.getByText("Weekly flow")).toBeVisible();
    await page.getByTestId("calendar-view-toggle-calendar").click();
    await expect(page.getByText("Filters")).toBeVisible();
    await page.getByText("Week 1").click();
    await page.getByTestId("calendar-view-toggle-board").click();
    await expect(page.getByTestId("board-column-published")).toBeVisible();

    const card = page.locator('[data-testid^="board-post-"]').first();
    await card.click();
    await page.getByTestId("post-status-published").click();
    await expect(page.getByText("Execution")).toBeVisible();
  });
});
