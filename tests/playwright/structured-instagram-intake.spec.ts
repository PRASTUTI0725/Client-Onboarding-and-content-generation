import { expect, test, type APIRequestContext } from "@playwright/test";
import { getApiConfig } from "./fixtures/seed";

const STRUCTURED_INSTAGRAM = {
  handle: "@structured_intake_brand",
  bio: "Instagram-first strategy studio helping founder-led brands grow with clear messaging and content systems. ✨",
  offerSummary: "We sell Instagram strategy, positioning, and recurring content planning for founder-led brands.",
  recentCaptionSnippets: [
    "Why most founder brands sound the same on Instagram — and how to fix it.",
    "Behind the scenes of rebuilding a service brand's content system.",
    "Three messaging mistakes that keep premium service brand’s invisible.",
    "Client win: from random posts to a repeatable Instagram narrative.",
  ],
  recurringTopics: [
    "Instagram strategy",
    "founder-led brands",
    "content systems",
  ],
  ctaPatterns: ["DM START for details"],
  proofSignals: ["Client win breakdowns", "Before/after strategy examples"],
  followerCount: "12.4K",
  category: "Marketing Agency",
  visualStyleNotes: "Minimal, editorial layouts with clear high-contrast reels covers.",
  additionalInstagramNotes:
    "Top-performing posts are proof-led carousels.\nDM replies spike when the CTA is specific and time-bound. The brand’s strongest proof comes from before/after messaging.",
};

const BASE_SOW = {
  sowVersion: 2,
  industry: "Social media marketing",
  targetAudience: "Founder-led service brands that want a stronger Instagram presence.",
  understandingOfRequirements:
    "Client needs a clear Instagram-first strategy, better positioning, and repeatable content execution.",
  strategyLaunchPlanning:
    "Build an Instagram-first strategy, tighten positioning, and roll out monthly content themes.",
  contentCreation:
    "Instagram-first content planning, hooks, proof-led messaging, and recurring topic guidance.",
  scopeOfWork:
    "Instagram strategy, positioning, content planning, and monthly content system support.",
  approval: {
    approved: true,
    approvedAt: new Date().toISOString(),
  },
  platforms: ["Instagram"],
  monthlyPosts: { Instagram: 16 },
  contentMix: {
    education: 6,
    thought_leadership: 5,
    social_proof: 3,
    promotion: 2,
  },
  deliverables: [],
  toneByPlatform: { Instagram: "Clear, warm, strategic" },
};

type ClientDetail = {
  client: {
    id: string;
    instagramHandle?: string | null;
    sow?: {
      approval?: { approved?: boolean };
      __approvedContextSnapshot?: {
        id?: string;
        sow?: {
          instagram?: Record<string, unknown>;
        };
      };
    };
  };
  onboarding?: {
    rawInput?: Record<string, unknown> | null;
    enrichedData?: Record<string, unknown> | null;
  } | null;
};

async function createClient(request: APIRequestContext, suffix: string) {
  const { apiUrl, apiKey } = getApiConfig();
  const res = await request.post(`${apiUrl}/clients`, {
    headers: { "x-api-key": apiKey },
    data: {
      name: `Structured Intake ${suffix}`,
      websiteUrl: `https://structured-${suffix}.example`,
      instagramHandle: "@structuredseed",
      oneLineDescription: "Playwright client for structured Instagram intake verification.",
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; name: string };
}

async function getClientDetail(
  request: APIRequestContext,
  clientId: string,
): Promise<ClientDetail> {
  const { apiUrl, apiKey } = getApiConfig();
  const res = await request.get(`${apiUrl}/clients/${clientId}`, {
    headers: { "x-api-key": apiKey },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as ClientDetail;
}

test.describe("structured Instagram intake", () => {
  test.setTimeout(180_000);

  test("new structured client can save/approve from SOW UI and rebuild Business DNA", async ({
    page,
    request,
  }) => {
    const client = await createClient(request, `ui-${Date.now()}`);

    await page.goto(`clients/${client.id}`);
    await page.getByTestId("sow-industry-input").fill(BASE_SOW.industry);
    await page.getByTestId("sow-target-audience-input").fill(BASE_SOW.targetAudience);
    await page.getByTestId("sow-understanding-input").fill(BASE_SOW.understandingOfRequirements);
    await page.getByTestId("sow-scope-input").fill(BASE_SOW.strategyLaunchPlanning);
    await page.getByTestId("sow-content-creation-narrative").fill(BASE_SOW.contentCreation);
    await page.getByTestId("sow-instagram-handle-input").fill(STRUCTURED_INSTAGRAM.handle);
    await page.getByTestId("sow-instagram-bio-input").fill(STRUCTURED_INSTAGRAM.bio);
    await page.getByTestId("sow-instagram-offer-input").fill(STRUCTURED_INSTAGRAM.offerSummary);
    await page.getByTestId("sow-instagram-captions-input").fill(
      STRUCTURED_INSTAGRAM.recentCaptionSnippets.join("\n"),
    );
    await page.getByTestId("sow-instagram-topics-input").fill(
      STRUCTURED_INSTAGRAM.recurringTopics.join("\n"),
    );
    await page.getByTestId("sow-instagram-additional-notes-input").fill(
      STRUCTURED_INSTAGRAM.additionalInstagramNotes,
    );
    await page.getByTestId("toggle-instagram-advanced-details").click();
    await page.getByTestId("sow-instagram-cta-input").fill(
      STRUCTURED_INSTAGRAM.ctaPatterns?.join("\n") ?? "",
    );
    await page.getByTestId("sow-instagram-proof-input").fill(
      STRUCTURED_INSTAGRAM.proofSignals?.join("\n") ?? "",
    );
    await page.getByTestId("sow-instagram-followers-input").fill(
      STRUCTURED_INSTAGRAM.followerCount ?? "",
    );
    await page.getByTestId("sow-instagram-category-input").fill(
      STRUCTURED_INSTAGRAM.category ?? "",
    );
    await page.getByTestId("sow-instagram-visual-input").fill(
      STRUCTURED_INSTAGRAM.visualStyleNotes ?? "",
    );

    const saveRequestPromise = page.waitForRequest(
      (request) =>
        request.url().includes(`/api/clients/${client.id}/sow`) &&
        request.method() === "PUT",
    );
    await page.getByTestId("sow-approve-and-save").click();
    const saveRequest = await saveRequestPromise;
    const savePayload = saveRequest.postDataJSON() as {
      instagram?: {
        handle?: string;
        bio?: string;
        offerSummary?: string;
        recentCaptionSnippets?: string[];
        recurringTopics?: string[];
        additionalInstagramNotes?: string;
      };
    };
    expect(savePayload.instagram?.handle).toBe(STRUCTURED_INSTAGRAM.handle);
    expect(savePayload.instagram?.bio).toBe(STRUCTURED_INSTAGRAM.bio);
    expect(savePayload.instagram?.offerSummary).toBe(STRUCTURED_INSTAGRAM.offerSummary);
    expect(savePayload.instagram?.recentCaptionSnippets).toEqual(
      STRUCTURED_INSTAGRAM.recentCaptionSnippets,
    );
    expect(savePayload.instagram?.recurringTopics).toEqual(
      STRUCTURED_INSTAGRAM.recurringTopics,
    );
    expect(savePayload.instagram?.additionalInstagramNotes).toBe(
      STRUCTURED_INSTAGRAM.additionalInstagramNotes,
    );
    await expect(page.getByTestId("sow-approval-status")).toContainText("Approved and saved", {
      timeout: 30_000,
    });

    const afterSave = await getClientDetail(request, client.id);
    expect(afterSave.client.sow?.approval?.approved).toBeTruthy();
    expect(afterSave.client.instagramHandle).toBe(STRUCTURED_INSTAGRAM.handle);
    const snapshotInstagram = afterSave.client.sow?.__approvedContextSnapshot?.sow?.instagram;
    expect(snapshotInstagram).toBeTruthy();
    expect(snapshotInstagram).toMatchObject({
      handle: STRUCTURED_INSTAGRAM.handle,
      bio: STRUCTURED_INSTAGRAM.bio,
      offerSummary: STRUCTURED_INSTAGRAM.offerSummary,
      recentCaptionSnippets: STRUCTURED_INSTAGRAM.recentCaptionSnippets,
      recurringTopics: STRUCTURED_INSTAGRAM.recurringTopics,
      additionalInstagramNotes: STRUCTURED_INSTAGRAM.additionalInstagramNotes,
    });
    expect(String(snapshotInstagram?.additionalInstagramNotes ?? "")).toContain(
      "Top-performing posts are proof-led carousels.",
    );
    const rawInstagram = afterSave.onboarding?.rawInput?.instagram as
      | {
          handle?: string;
          bio?: string;
          offerSummary?: string;
          recentCaptionSnippets?: string[];
          recurringTopics?: string[];
          additionalInstagramNotes?: string;
        }
      | undefined;
    expect(rawInstagram).toMatchObject({
      handle: STRUCTURED_INSTAGRAM.handle,
      bio: STRUCTURED_INSTAGRAM.bio,
      offerSummary: STRUCTURED_INSTAGRAM.offerSummary,
      recentCaptionSnippets: STRUCTURED_INSTAGRAM.recentCaptionSnippets,
      recurringTopics: STRUCTURED_INSTAGRAM.recurringTopics,
      additionalInstagramNotes: STRUCTURED_INSTAGRAM.additionalInstagramNotes,
    });

    await expect(page.getByTestId("structured-instagram-summary")).toBeVisible();
    await expect(page.getByTestId("legacy-instagram-notes")).toHaveCount(0);
    await expect(page.getByTestId("structured-instagram-summary")).toContainText(
      "Additional Instagram notes:",
    );
    await expect(page.getByTestId("structured-instagram-summary")).toContainText(
      "Top-performing posts are proof-led carousels.",
    );
    await expect(page.getByTestId("structured-instagram-summary")).toContainText(
      "DM replies spike when the CTA is specific and time-bound.",
    );

    await page.reload();
    await expect(page.getByTestId("structured-instagram-summary")).toContainText(
      "Top-performing posts are proof-led carousels.",
    );
    await expect(page.getByTestId("sow-instagram-additional-notes-input")).toHaveValue(
      STRUCTURED_INSTAGRAM.additionalInstagramNotes,
    );

    const rebuildButton = page.getByTestId("generate-business-dna-button");
    await expect(rebuildButton).toBeVisible();
    const rebuildResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/clients/${client.id}/onboarding/business-dna/rebuild`) &&
        response.request().method() === "POST",
    );
    await rebuildButton.click();
    expect((await rebuildResponse).ok()).toBeTruthy();

    const afterRebuild = await getClientDetail(request, client.id);
    const dna = (afterRebuild.onboarding?.enrichedData?.businessDna as Record<string, unknown> | undefined) ?? null;
    expect(dna).toBeTruthy();
    const platformSignals = (dna?.platformSignals as Record<string, unknown> | undefined) ?? null;
    const instagramSignals = (platformSignals?.instagram as Record<string, unknown> | undefined) ?? null;
    expect(String(instagramSignals?.handle ?? "")).toContain("structured_intake_brand");
  });

  test("legacy-only client can update SOW without structured Instagram and still sees legacy notes UI", async ({
    page,
    request,
  }) => {
    const client = await createClient(request, `legacy-${Date.now()}`);
    const { apiUrl, apiKey } = getApiConfig();

    const sowRes = await request.put(`${apiUrl}/clients/${client.id}/sow`, {
      headers: { "x-api-key": apiKey },
      data: BASE_SOW,
    });
    expect(sowRes.ok()).toBeTruthy();

    const patchRes = await request.patch(`${apiUrl}/clients/${client.id}/onboarding`, {
      headers: { "x-api-key": apiKey },
      data: {
        instagramSummaryNotes:
          "Legacy Instagram notes only: founder-led brand, DM CTA, strong proof-led positioning.",
      },
    });
    expect(patchRes.ok()).toBeTruthy();

    await page.goto(`clients/${client.id}`);
    await expect(page.getByTestId("legacy-instagram-notes")).toBeVisible();
    await expect(page.getByTestId("structured-instagram-summary")).toHaveCount(0);
    await page.getByTestId("sow-instagram-additional-notes-input").fill(
      "These notes are optional and should not block a legacy-only save.",
    );

    const saveRequestPromise = page.waitForRequest(
      (request) =>
        request.url().includes(`/api/clients/${client.id}/sow`) &&
        request.method() === "PUT",
    );
    await page.getByTestId("sow-target-audience-input").fill(
      "Founder-led service brands who want a stronger Instagram narrative.",
    );
    await page.getByTestId("sow-approve-and-save").click();
    const saveRequest = await saveRequestPromise;
    const savePayload = saveRequest.postDataJSON() as {
      instagram?: { additionalInstagramNotes?: string };
    };
    expect(savePayload.instagram).toBeUndefined();
    await expect(page.getByTestId("sow-approval-status")).toContainText("Approved and saved", {
      timeout: 30_000,
    });

    const afterSave = await getClientDetail(request, client.id);
    expect(afterSave.client.sow?.approval?.approved).toBeTruthy();
    expect(afterSave.client.sow?.__approvedContextSnapshot?.sow?.instagram).toBeFalsy();
  });

  test("save payload omits additional Instagram notes when blank", async ({
    page,
    request,
  }) => {
    const client = await createClient(request, `blank-notes-${Date.now()}`);

    await page.goto(`clients/${client.id}`);
    await page.getByTestId("sow-industry-input").fill(BASE_SOW.industry);
    await page.getByTestId("sow-target-audience-input").fill(BASE_SOW.targetAudience);
    await page.getByTestId("sow-understanding-input").fill(BASE_SOW.understandingOfRequirements);
    await page.getByTestId("sow-scope-input").fill(BASE_SOW.strategyLaunchPlanning);
    await page.getByTestId("sow-content-creation-narrative").fill(BASE_SOW.contentCreation);
    await page.getByTestId("sow-instagram-handle-input").fill(STRUCTURED_INSTAGRAM.handle);
    await page.getByTestId("sow-instagram-bio-input").fill(STRUCTURED_INSTAGRAM.bio);
    await page.getByTestId("sow-instagram-offer-input").fill(STRUCTURED_INSTAGRAM.offerSummary);
    await page.getByTestId("sow-instagram-captions-input").fill(
      STRUCTURED_INSTAGRAM.recentCaptionSnippets.join("\n"),
    );
    await page.getByTestId("sow-instagram-topics-input").fill(
      STRUCTURED_INSTAGRAM.recurringTopics.join("\n"),
    );
    await page.getByTestId("sow-instagram-additional-notes-input").fill("");

    const saveRequestPromise = page.waitForRequest(
      (request) =>
        request.url().includes(`/api/clients/${client.id}/sow`) &&
        request.method() === "PUT",
    );
    await page.getByTestId("sow-approve-and-save").click();
    const saveRequest = await saveRequestPromise;
    const savePayload = saveRequest.postDataJSON() as {
      instagram?: Record<string, unknown>;
    };
    expect(savePayload.instagram).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(savePayload.instagram ?? {}, "additionalInstagramNotes")).toBeFalsy();
    await expect(page.getByTestId("sow-approval-status")).toContainText("Approved and saved", {
      timeout: 30_000,
    });
  });

  test("onboarding PATCH persists body.instagram and partial structured input keeps legacy fallback visible", async ({
    page,
    request,
  }) => {
    const client = await createClient(request, `mixed-${Date.now()}`);
    const { apiUrl, apiKey } = getApiConfig();

    const patchA = await request.patch(`${apiUrl}/clients/${client.id}/onboarding`, {
      headers: { "x-api-key": apiKey },
      data: {
        instagram: {
          ...STRUCTURED_INSTAGRAM,
          handle: "@override_a",
        },
      },
    });
    if (!patchA.ok()) {
      throw new Error(
        `patchA failed: status=${patchA.status()} url=${apiUrl}/clients/${client.id}/onboarding body=${await patchA.text()}`,
      );
    }

    const patchB = await request.patch(`${apiUrl}/clients/${client.id}/onboarding`, {
      headers: { "x-api-key": apiKey },
      data: {
        instagram: {
          handle: "@partial_stub_only",
        },
        instagramSummaryNotes: "Fallback legacy notes should still remain visible for partial structured input.",
      },
    });
    if (!patchB.ok()) {
      throw new Error(
        `patchB failed: status=${patchB.status()} url=${apiUrl}/clients/${client.id}/onboarding body=${await patchB.text()}`,
      );
    }

    const detail = await getClientDetail(request, client.id);
    const rawInstagram = (detail.onboarding?.rawInput?.instagram as Record<string, unknown> | undefined) ?? null;
    expect(String(rawInstagram?.handle ?? "")).toBe("@partial_stub_only");

    await page.goto(`clients/${client.id}`);
    await expect(page.getByTestId("legacy-instagram-notes")).toBeVisible();
    await expect(page.getByTestId("structured-instagram-summary")).toHaveCount(0);
  });
});
