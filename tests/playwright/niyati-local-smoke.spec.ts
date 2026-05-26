import { expect, test } from "@playwright/test";
import { getApiConfig } from "./fixtures/seed";

const INSTAGRAM_ONLY_SOW = {
  sowVersion: 2,
  industry: "Social media marketing",
  targetAudience: "Founder-led and growth-focused brands seeking Instagram strategy support.",
  understandingOfRequirements:
    "Client needs a clear Instagram-first brand-building strategy with strong positioning, content planning, and repeatable creative systems.",
  strategyLaunchPlanning:
    "Brand-building strategy, Instagram content system, and launch planning for consistent visibility.",
  contentCreation:
    "Instagram-first content planning and creative direction with proof-led messaging.",
  scopeOfWork:
    "Instagram strategy, content planning, and monthly execution support for brand building.",
  approval: {
    approved: true,
    approvedAt: new Date().toISOString(),
  },
  platforms: ["Instagram"],
  monthlyPosts: { Instagram: 16 },
  contentMix: {
    education: 40,
    thought_leadership: 30,
    social_proof: 20,
    promotion: 10,
  },
  deliverables: [],
  toneByPlatform: { Instagram: "Clear, warm, strategic" },
};

const DRAFT_SOW = {
  ...INSTAGRAM_ONLY_SOW,
  approval: {
    approved: false,
    approvedAt: null,
  },
};

type ClientSummary = {
  id: string;
  name: string;
  website?: string | null;
  instagramHandle?: string | null;
};

test.describe("Niyati / The Social Idiots local smoke", () => {
  test.setTimeout(180_000);

  test("approval gate, snapshot flow, and strategy generation stay Instagram-only", async ({
    request,
  }) => {
    const { apiUrl, apiKey } = getApiConfig();
    const headers = { "x-api-key": apiKey };

    const listRes = await request.get(`${apiUrl}/clients`, { headers });
    expect(listRes.ok()).toBeTruthy();
    const clients = (await listRes.json()) as ClientSummary[];

    let client = clients.find((entry) => /niyati|the social idiots/i.test(entry.name));

    if (!client) {
      const createRes = await request.post(`${apiUrl}/clients`, {
        headers,
        data: {
          name: "Niyati Jain · The Social Idiots",
          websiteUrl: "https://thesocialidiots.com",
          instagramHandle: "@thesocialidiots",
          oneLineDescription:
            "The Social Idiots is a social-first growth partner for founder-led brands with an Instagram-led brand building focus.",
        },
      });
      expect(createRes.ok()).toBeTruthy();
      client = (await createRes.json()) as ClientSummary;
    }

    const draftSowRes = await request.put(`${apiUrl}/clients/${client.id}/sow`, {
      headers,
      data: DRAFT_SOW,
    });
    expect(draftSowRes.ok()).toBeTruthy();

    const blockedStrategyRes = await request.post(`${apiUrl}/clients/${client.id}/strategy/bootstrap`, {
      headers,
      data: { templateType: "brand_building" },
    });
    expect(blockedStrategyRes.ok()).toBeFalsy();
    expect(blockedStrategyRes.status()).toBe(400);

    const sowRes = await request.put(`${apiUrl}/clients/${client.id}/sow`, {
      headers,
      data: INSTAGRAM_ONLY_SOW,
    });
    expect(sowRes.ok()).toBeTruthy();

    const clientRes = await request.get(`${apiUrl}/clients/${client.id}`, { headers });
    expect(clientRes.ok()).toBeTruthy();
    const clientDetail = (await clientRes.json()) as {
      client: {
        sow?: {
          platforms?: string[];
          approval?: { approved?: boolean };
          __approvedContextSnapshot?: {
            id?: string;
            sourceContext?: string;
            sow?: { platforms?: string[] };
          };
        };
      };
    };
    expect(clientDetail.client.sow?.platforms ?? []).toEqual(["Instagram"]);
    expect(clientDetail.client.sow?.approval?.approved).toBeTruthy();
    expect(clientDetail.client.sow?.__approvedContextSnapshot?.id).toBeTruthy();
    expect(clientDetail.client.sow?.__approvedContextSnapshot?.sourceContext).toBe("approved_snapshot");
    expect(clientDetail.client.sow?.__approvedContextSnapshot?.sow?.platforms ?? []).toEqual(["Instagram"]);

    const rebuildUrl = `${apiUrl}/clients/${client.id}/onboarding/business-dna/rebuild`;
    const rebuildTimeoutMs = 45_000;
    let dnaRes: Awaited<ReturnType<typeof request.post>>;
    try {
      dnaRes = await request.post(rebuildUrl, {
        headers,
        timeout: rebuildTimeoutMs,
      });
    } catch (error) {
      throw new Error(
        `Business DNA rebuild request did not finish within ${rebuildTimeoutMs}ms for client ${client.id}. ` +
          `Check API diagnostics for request_start, website_fetch_*, instagram_fetch_*, and request_timeout. ` +
          `Cause: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!dnaRes.ok()) {
      const body = await dnaRes.text();
      throw new Error(
        `Business DNA rebuild failed for client ${client.id} with ${dnaRes.status()}: ${body.slice(0, 500)}`,
      );
    }

    const afterDnaRes = await request.get(`${apiUrl}/clients/${client.id}`, { headers });
    expect(afterDnaRes.ok()).toBeTruthy();
    const afterDna = (await afterDnaRes.json()) as {
      onboarding?: {
        enrichedData?: {
          __provenance?: {
            artifactStale?: boolean;
          };
          businessDna?: {
            __artifactMeta?: {
              stale?: boolean;
            };
          };
        };
      };
    };
    expect(afterDna.onboarding?.enrichedData?.businessDna?.__artifactMeta?.stale).toBeFalsy();
    expect(afterDna.onboarding?.enrichedData?.__provenance?.artifactStale).not.toBeTruthy();

    let strategyRes = await request.post(`${apiUrl}/clients/${client.id}/strategy/bootstrap`, {
      headers,
      data: { templateType: "brand_building" },
    });

    if (!strategyRes.ok()) {
      strategyRes = await request.post(`${apiUrl}/clients/${client.id}/strategy/generate`, {
        headers,
        data: { templateType: "brand_building" },
      });
    }

    expect(strategyRes.ok()).toBeTruthy();
    const strategy = (await strategyRes.json()) as {
      templateType?: string;
      structuredStrategy?: {
        canonicalSections?: {
          platformStrategy?: string;
        };
      };
    };

    expect(strategy.templateType).toBe("brand_building");
    const platformStrategy = String(
      strategy.structuredStrategy?.canonicalSections?.platformStrategy ?? "",
    );
    expect(platformStrategy).toContain("Instagram");
    expect(platformStrategy).not.toContain("Pinterest");

    const staleRes = await request.put(`${apiUrl}/clients/${client.id}/sow`, {
      headers,
      data: {
        ...INSTAGRAM_ONLY_SOW,
        strategyLaunchPlanning:
          "Brand-building strategy, Instagram content system, launch planning, and creator partnership rollout.",
      },
    });
    expect(staleRes.ok()).toBeTruthy();

    const afterEditRes = await request.get(`${apiUrl}/clients/${client.id}`, { headers });
    expect(afterEditRes.ok()).toBeTruthy();
    const afterEdit = (await afterEditRes.json()) as {
      client: {
        sow?: {
          __artifactState?: { stale?: boolean };
          __approvedContextSnapshot?: { id?: string };
        };
      };
      strategy?: {
        structuredStrategy?: {
          __meta?: { snapshotState?: string };
        };
      };
    };
    expect(afterEdit.client.sow?.__artifactState?.stale).toBeTruthy();
    expect(afterEdit.strategy?.structuredStrategy?.__meta?.snapshotState).toBe("stale");
  });
});
