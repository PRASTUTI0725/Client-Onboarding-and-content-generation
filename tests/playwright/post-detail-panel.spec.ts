import { expect, test, type Page } from "@playwright/test";
import { getApiConfig, seedClientWithStrategy } from "./fixtures/seed";

test.describe("post detail panel", () => {
  test.setTimeout(120_000);

  let clientId: string;

  test.beforeAll(async ({ request }) => {
    clientId = await seedClientWithStrategy(request, `post-detail-${Date.now()}`);
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
  });

  test("renders rich sections for all formats and keeps legacy posts safe", async ({ page }) => {
    const calendarPayload = buildCalendarPayload(clientId);

    await page.route(`**/api/clients/${clientId}/calendar`, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(calendarPayload),
      });
    });

    await page.goto(`clients/${clientId}/calendar`);
    await page.getByTestId("calendar-view-toggle-calendar").click();

    await openPost(page, "reel-post");
    await expect(page.getByTestId("post-detail-caption")).toBeVisible();
    await expect(page.getByTestId("post-detail-hashtags-niche")).toBeVisible();
    await expect(page.getByTestId("post-detail-reel-execution")).toBeVisible();
    await expect(page.getByTestId("post-detail-conversion-path")).toBeVisible();
    await expect(page.getByTestId("post-detail-repurpose-plan")).toBeVisible();
    await expect(page.getByTestId("post-detail-timeline")).toBeVisible();
    await expect(page.getByTestId("post-detail-dependencies")).toBeVisible();
    await expect(page.getByTestId("post-detail-feedback")).toBeVisible();
    await closeSheet(page);

    await openPost(page, "carousel-post");
    await expect(page.getByTestId("post-detail-carousel-execution")).toBeVisible();
    await closeSheet(page);

    await openPost(page, "story-post");
    await expect(page.getByTestId("post-detail-story-execution")).toBeVisible();
    await closeSheet(page);

    await openPost(page, "static-post");
    await expect(page.getByTestId("post-detail-static-execution")).toBeVisible();
    await closeSheet(page);

    await openPost(page, "legacy-post");
    await expect(page.getByTestId("post-detail-caption")).toBeVisible();
    await expect(page.getByTestId("post-detail-hashtags")).toBeVisible();
    await expect(page.getByTestId("post-detail-reel-execution")).toBeVisible();
  });
});

async function openPost(page: Page, id: string) {
  await page.getByTestId(`calendar-post-${id}`).click();
}

async function closeSheet(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("post-comment-input")).toBeHidden();
}

function buildCalendarPayload(clientId: string) {
  return {
    planner: {
      id: "planner-post-detail",
      clientId,
      distribution: { education: 40, conversion: 30, proof: 30 },
      formats: { reel: 25, carousel: 25, story: 25, static: 25 },
      platformSplit: { Instagram: 5 },
      angleBank: {
        education: ["Show the smarter buying lens"],
        conversion: ["Move viewers to a DM CTA"],
        proof: ["Use credibility and product proof"],
      },
      hookStyles: ["problem-led", "founder POV", "proof-first"],
      weeklyFlow: {
        week_1: "Awareness + positioning",
        week_2: "Education + trust",
        week_3: "Proof + conversion",
        week_4: "Offer + follow-up",
      },
      pillars: [
        { name: "education", color: "#2563EB", description: "Build audience understanding." },
        { name: "conversion", color: "#B85C38", description: "Turn interest into action." },
        { name: "proof", color: "#15803D", description: "Back claims with evidence." },
      ],
      kpis: { saves: "Educational resonance", replies: "Warm intent", dms: "Qualified leads" },
      phases: [],
      month: "June 2026",
      goal: "Validate the upgraded post detail panel.",
      notes: "",
      createdAt: new Date().toISOString(),
    },
    posts: [
      {
        id: "reel-post",
        clientId,
        plannerId: "planner-post-detail",
        date: "2026-06-01",
        platform: "Instagram",
        pillar: "education",
        angle: "Founder POV on what buyers miss before they post",
        format: "Reel",
        objective: "Drive saves and qualified DMs from founders who need clearer content direction.",
        hook: "If your reel needs 4 rewrites, the brief is the problem.",
        caption:
          "If your reel keeps getting rewritten, the issue usually starts before the camera turns on.\n\nA strong post brief should tell the creator what to say, what to show, and why the post deserves to exist. That is what cuts production friction and raises confidence.\n\nSave this if your team keeps losing time in revisions, then DM 'BRIEF' if you want the structure we use.",
        hashtags: [
          "#contentstrategy",
          "#foundermarketing",
          "#reelstrategy",
          "#contentworkflow",
          "#socialcontentplan",
          "#contentplanning",
          "#lowengagement",
          "#conversioncontent",
          "#marketing",
          "#socialmedia",
        ],
        cta: "DM 'BRIEF' for the execution template.",
        strategicIntent:
          "Show founders that execution clarity starts in the brief, not in last-minute editing decisions.",
        expectedMetric: "saves",
        expectedReason:
          "The post reframes a common production pain and gives the audience a practical diagnostic lens.",
        priority: "high",
        execution: {
          format_style: "Reel",
          production_effort: "medium",
          duration: "35 seconds",
          shoot_type: "Founder-led talking head with cutaway b-roll",
          reel_execution: {
            hook_line: "If your reel needs 4 rewrites, the brief is the problem.",
            flow: ["problem", "insight", "breakdown", "proof", "cta"],
            script:
              "Open on camera: 'If your reel needs 4 rewrites, the brief is the problem.' Cut to a messy planning screen while saying most creators do not fail at confidence, they fail at clarity. Break down the three things every brief must answer: what we are saying, what we are showing, and what action we want next. Flash one before/after planning example, then close with the DM CTA.",
            visual_direction:
              "Start with direct-to-camera hook, cut to notebook or Notion planning shots, then show one clean shot list and end on a CTA frame.",
            editing_style:
              "Fast cuts, bold subtitles, zoom on key phrases, and a clean branded end card.",
          },
          caption: {
            structure: ["hook", "context", "value", "cta"],
            text:
              "If your reel keeps getting rewritten, the issue usually starts before the camera turns on.\n\nA strong post brief should tell the creator what to say, what to show, and why the post deserves to exist. That is what cuts production friction and raises confidence.\n\nSave this if your team keeps losing time in revisions, then DM 'BRIEF' if you want the structure we use.",
          },
          hashtags: {
            niche: [
              "#contentstrategy",
              "#foundermarketing",
              "#reelstrategy",
              "#contentworkflow",
              "#socialcontentplan",
              "#creativeexecution",
            ],
            problem: ["#contentplanning", "#lowengagement", "#conversioncontent", "#brandconfusion"],
            broad: ["#marketing", "#socialmedia", "#instagrammarketing"],
          },
          conversion_path: {
            entry_point: "Call out the hidden reason reels feel hard to produce.",
            next_step: "Turn the save into a DM for the brief template.",
            final_goal: "Create qualified inbound leads who want clearer content execution.",
          },
          repurpose_plan: [
            "Turn the 3-point breakdown into a 6-slide carousel.",
            "Use the hook and proof beat as a story sequence with a poll sticker.",
            "Cut the proof example into a warm-audience ad for retargeting.",
          ],
          timeline: {
            internal_deadline: "Finalize shot list 48 hours before publish date",
            posting_time: "7:30 PM local time",
          },
          dependencies: ["Founder availability", "Shot list approval", "Subtitle/export pass"],
          feedback_structure: {
            type: "hook / caption / edit / strategy",
            comment:
              "Confirm the hook lands in the first sentence and the proof example is specific enough to feel credible.",
          },
        },
        status: "draft",
        comments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "carousel-post",
        clientId,
        plannerId: "planner-post-detail",
        date: "2026-06-02",
        platform: "Instagram",
        pillar: "education",
        angle: "Slide-by-slide buyer education",
        format: "Carousel",
        objective: "Drive saves by teaching founders how to structure a content brief.",
        hook: "Most content delays happen before anyone starts editing.",
        caption: "Carousel caption for founders who need stronger production clarity.",
        hashtags: ["#contentstrategy"],
        cta: "Save this and share it with the person who briefs your content.",
        strategicIntent: "Make the brief feel like an operating system, not admin work.",
        expectedMetric: "saves",
        expectedReason: "The structure is practical and easy to reuse.",
        priority: "medium",
        execution: {
          carousel_execution: {
            slides: [
              { slide: 1, type: "hook", text: "Most content delays happen before anyone starts editing." },
              { slide: 2, type: "problem", text: "Teams start shooting without clarity on message, proof, or CTA." },
              { slide: 3, type: "insight", text: "A usable brief reduces revision cycles because everyone aligns before production starts." },
              { slide: 4, type: "example", text: "Show one brief that defines hook, shot sequence, proof beat, and CTA." },
              { slide: 5, type: "solution", text: "Build every post around a simple operator question: what should the viewer know, feel, and do next?" },
              { slide: 6, type: "cta", text: "Save this and share it with the person who briefs your content." },
            ],
          },
        },
        status: "draft",
        comments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "story-post",
        clientId,
        plannerId: "planner-post-detail",
        date: "2026-06-03",
        platform: "Instagram",
        pillar: "conversion",
        angle: "Warm-audience story flow",
        format: "Stories",
        objective: "Drive replies from founders who need faster content execution.",
        hook: "Quick check: do your briefs tell creators what to shoot in order?",
        caption: "Story support copy.",
        hashtags: ["#storystrategy"],
        cta: "Reply 'YES' and I’ll send the framework.",
        strategicIntent: "Use a low-friction interaction format to qualify warm leads.",
        expectedMetric: "replies",
        expectedReason: "Interactive story formats make direct response feel easy.",
        priority: "medium",
        execution: {
          story_execution: {
            frames: [
              { frame: 1, type: "hook", interaction: "poll", text: "Quick check: do your briefs tell creators what to shoot in order?" },
              { frame: 2, type: "value", text: "If not, revisions usually start before your first draft even lands." },
              { frame: 3, type: "proof", text: "The teams with the fastest turnaround usually lock message, proof, and shot sequence first." },
              { frame: 4, type: "cta", interaction: "question", text: "Reply 'YES' and I’ll send the framework." },
            ],
          },
        },
        status: "draft",
        comments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "static-post",
        clientId,
        plannerId: "planner-post-detail",
        date: "2026-06-04",
        platform: "Instagram",
        pillar: "proof",
        angle: "Simple proof-led static visual",
        format: "Static",
        objective: "Drive profile visits with a strong visual promise and proof-led caption.",
        hook: "A good brief saves more production time than a better camera.",
        caption: "Static caption support.",
        hashtags: ["#staticdesign"],
        cta: "Visit the profile for the full system.",
        strategicIntent: "Give a sharp, saveable belief shift with minimal production load.",
        expectedMetric: "profile visits",
        expectedReason: "The headline is contrarian enough to trigger curiosity.",
        priority: "low",
        execution: {
          static_execution: {
            headline: "A good brief saves more production time than a better camera.",
            visual_direction:
              "Use a premium paper-texture background, one bold serif headline, and a small supporting proof note in the lower corner.",
            caption:
              "A good brief saves more production time than a better camera.\n\nMost content bottlenecks are clarity problems, not gear problems. When the brief locks the message, visual sequence, and CTA, the whole team moves faster.\n\nVisit the profile for the full system.",
          },
        },
        status: "draft",
        comments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "legacy-post",
        clientId,
        plannerId: "planner-post-detail",
        date: "2026-06-05",
        platform: "Instagram",
        pillar: "proof",
        angle: "Legacy execution shape",
        format: "Reel",
        objective: "Stay backward compatible with old saved calendars.",
        hook: "Legacy post still needs to feel usable.",
        caption:
          "Legacy calendars should still open cleanly.\n\nThe panel should normalize older fields into something a founder can actually use.\n\nThat way older months stay safe.",
        hashtags: ["#legacycontent", "#oldcalendar", "#foundersystems"],
        cta: "Keep old calendars safe.",
        strategicIntent: "Prove the new rendering layer does not abandon older execution shapes.",
        expectedMetric: "comments",
        expectedReason: "Compatibility work reduces fear around upgrading.",
        priority: "medium",
        execution: {
          hook_2s: "Legacy post still needs to feel usable.",
          pattern_interrupt: "Cut from talking head to old calendar screenshot.",
          beats: [
            "Name the compatibility concern.",
            "Show the older data shape.",
            "Translate it into a cleaner brief.",
            "Close with reassurance.",
          ],
          visual_direction: "Direct-to-camera opener, then screen-recording cutaways.",
          audio: "spoken-only",
        },
        status: "draft",
        comments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}
