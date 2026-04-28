import type { APIRequestContext } from "@playwright/test";

const DEFAULT_SOW = {
  understandingOfRequirements:
    "Men's personal care audience with urgent launch and end-to-end social management requirement.",
  scopeOfWork:
    "Strategy, content creation, platform management, and monthly reporting with launch support.",
  pricingOptions: "Option 1: 14,000/month; Option 2: 17,000/month with growth add-on.",
  timeline: "Kick-off immediate, first batch in 3-5 working days.",
  paymentTerms: "50% advance, 50% later on monthly billing cycle.",
  nextSteps: "Finalize package, share brand assets, start execution.",
  approval: { approved: true },
  platforms: ["Instagram"],
  monthlyPosts: { Instagram: 16 },
  contentMix: {
    education: 6,
    thought_leadership: 5,
    social_proof: 3,
    promotion: 2,
  },
  deliverables: [] as string[],
  toneByPlatform: { Instagram: "Clear, warm, proof-led" },
};

export function getApiConfig(): { apiUrl: string; apiKey: string } {
  return {
    apiUrl: (process.env.E2E_API_URL ?? "http://127.0.0.1:3001/api").replace(
      /\/$/,
      "",
    ),
    apiKey: process.env.E2E_API_KEY ?? "sk-content-calendar-test-2026",
  };
}

/**
 * Creates a client, saves SOW, and runs strategy generation via API.
 * Works with DB-backed or in-memory fallback backends (deterministic when DB is unavailable).
 */
export async function seedClientWithStrategy(
  request: APIRequestContext,
  suffix: string,
): Promise<string> {
  const { apiUrl, apiKey } = getApiConfig();
  const headers = { "x-api-key": apiKey };

  const create = await request.post(`${apiUrl}/clients`, {
    headers,
    data: {
      name: `E2E Client ${suffix}`,
      websiteUrl: `https://e2e-${suffix}.example`,
      instagramHandle: "@e2e_fixture",
      oneLineDescription: "Playwright fixture client for regression tests.",
    },
  });
  if (!create.ok()) {
    throw new Error(
      `create client failed: ${create.status()} ${await create.text()}`,
    );
  }
  const client = (await create.json()) as { id: string };

  const sow = await request.put(`${apiUrl}/clients/${client.id}/sow`, {
    headers,
    data: DEFAULT_SOW,
  });
  if (!sow.ok()) {
    throw new Error(`put sow failed: ${sow.status()} ${await sow.text()}`);
  }
  const verify = await request.get(`${apiUrl}/clients/${client.id}`, { headers });
  if (!verify.ok()) {
    throw new Error(`verify client failed: ${verify.status()} ${await verify.text()}`);
  }

  const gen = await request.post(
    `${apiUrl}/clients/${client.id}/strategy/generate`,
    {
      headers,
      data: {},
    },
  );
  if (!gen.ok()) {
    throw new Error(
      `strategy generate failed: ${gen.status()} ${await gen.text()}`,
    );
  }

  return client.id;
}

export async function generateCalendarViaApi(
  request: APIRequestContext,
  clientId: string,
  input: { month: string; startDate: string; goal?: string; notes?: string },
): Promise<void> {
  const { apiUrl, apiKey } = getApiConfig();
  const res = await request.post(
    `${apiUrl}/clients/${clientId}/calendar/generate`,
    {
      headers: { "x-api-key": apiKey },
      data: {
        month: input.month,
        startDate: input.startDate,
        goal: input.goal ?? "Fixture calendar goal",
        notes: input.notes ?? "",
      },
    },
  );
  if (!res.ok()) {
    throw new Error(
      `calendar generate failed: ${res.status()} ${await res.text()}`,
    );
  }
}
