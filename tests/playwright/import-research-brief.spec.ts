import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getApiConfig } from "./fixtures/seed";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "../fixtures/svara-research-brief.md");
const svaraBrief = readFileSync(fixturePath, "utf8");

test.describe("import research brief", () => {
  test("parses Svara brief, previews mappings, and fills SOW fields", async ({ page, request, baseURL }) => {
    const { apiUrl, apiKey } = getApiConfig();
    const headers = { "x-api-key": apiKey };
    const stamp = Date.now();
    const create = await request.post(`${apiUrl}/clients`, {
      headers,
      data: { name: `Import Brief ${stamp}` },
    });
    expect(create.ok()).toBeTruthy();
    const { id: clientId } = (await create.json()) as { id: string };

    await page.goto(`${baseURL}/clients/${clientId}`);
    await page.getByTestId("research-brief-paste-input").fill(svaraBrief);
    await page.getByTestId("research-brief-parse-button").click();
    await expect(page.getByTestId("research-brief-preview-dialog")).toBeVisible();
    await expect(page.getByTestId("research-brief-preview-row-sow.industry")).toBeVisible();
    await expect(page.getByTestId("research-brief-preview-row-instagram.bio")).toBeVisible();
    await page.getByTestId("research-brief-confirm-import-button").click();
    await expect(page.getByTestId("sow-industry-input")).not.toHaveValue("");
    await expect(page.getByTestId("sow-instagram-bio-input")).not.toHaveValue("");

    await page.getByTestId("sow-approve-and-save").click();
    await expect(page.getByText(/SOW approved/i)).toBeVisible({ timeout: 15000 });

    const detail = await request.get(`${apiUrl}/clients/${clientId}`, { headers });
    expect(detail.ok()).toBeTruthy();
    const payload = (await detail.json()) as {
      client: { sow?: Record<string, unknown> };
      onboarding?: { rawInput?: Record<string, unknown> };
    };
    expect(payload.onboarding?.rawInput?.importedResearchBrief).toBeTruthy();
    expect(payload.client.sow?.researchBriefImport).toBeTruthy();
    expect(String((payload.client.sow as { industry?: string }).industry ?? "")).toMatch(/fragrance|perfume/i);
  });

  test("warns on overwrite when industry already filled", async ({ page, request, baseURL }) => {
    const { apiUrl, apiKey } = getApiConfig();
    const headers = { "x-api-key": apiKey };
    const stamp = Date.now();
    const create = await request.post(`${apiUrl}/clients`, {
      headers,
      data: { name: `Import Overwrite ${stamp}` },
    });
    const { id: clientId } = (await create.json()) as { id: string };
    await request.put(`${apiUrl}/clients/${clientId}/sow`, {
      headers,
      data: {
        industry: "Existing manual industry",
        understandingOfRequirements: "Goals",
        strategyLaunchPlanning: "Launch plan",
        contentCreation: "Deliverables",
        scopeOfWork: "Launch plan\n\nDeliverables",
        approval: { approved: false },
        platforms: ["Instagram"],
        monthlyPosts: { Instagram: 12 },
        contentMix: { education: 6, thought_leadership: 6 },
        deliverables: [],
        toneByPlatform: { Instagram: "Warm" },
      },
    });

    await page.goto(`${baseURL}/clients/${clientId}`);
    await page.getByTestId("research-brief-paste-input").fill(svaraBrief);
    await page.getByTestId("research-brief-parse-button").click();
    const industryRow = page.getByTestId("research-brief-preview-row-sow.industry");
    await expect(industryRow).toBeVisible();
    await expect(industryRow.getByText("Will update")).toBeVisible();
    const checkbox = industryRow.getByRole("checkbox");
    await expect(checkbox).not.toBeChecked();
  });
});
