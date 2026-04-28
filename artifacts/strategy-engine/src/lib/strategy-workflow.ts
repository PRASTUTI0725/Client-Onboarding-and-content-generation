export const CANONICAL_STRATEGY_SECTIONS = [
  { key: "marketNarrative", label: "Market Narrative" },
  { key: "problemGapSolution", label: "Problem • Gap • Solution" },
  { key: "brandFoundation", label: "Brand Foundation" },
  { key: "brandPhilosophy", label: "Brand Philosophy" },
  { key: "audience", label: "Audience" },
  { key: "emotionalDrivers", label: "Emotional Drivers" },
  { key: "platformStrategy", label: "Platform Strategy" },
  { key: "contentStrategy", label: "Content Strategy" },
  { key: "kpis", label: "KPIs" },
  { key: "trackingPlan", label: "Tracking Plan" },
  { key: "executionPhases", label: "Execution Phases" },
  { key: "assetRequirements", label: "Asset Requirements" },
] as const;

export type CanonicalSectionKey = (typeof CANONICAL_STRATEGY_SECTIONS)[number]["key"];

export const CANONICAL_SECTION_LABELS: Record<CanonicalSectionKey, string> =
  Object.fromEntries(CANONICAL_STRATEGY_SECTIONS.map((item) => [item.key, item.label])) as Record<
    CanonicalSectionKey,
    string
  >;

export type SectionApprovals = Partial<Record<CanonicalSectionKey, boolean>>;

export interface SowLike {
  platforms?: string[];
  monthlyPosts?: Record<string, number>;
  contentMix?: Record<string, number>;
  deliverables?: string[];
  toneByPlatform?: Record<string, string>;
  understandingOfRequirements?: string;
  scopeOfWork?: string;
  pricingOptions?: string;
  timeline?: string;
  paymentTerms?: string;
  nextSteps?: string;
  approval?: { approved?: boolean };
}

export function isSowComplete(sow: SowLike | null | undefined): boolean {
  if (!sow) return false;
  if (!String(sow.understandingOfRequirements ?? "").trim() || !String(sow.scopeOfWork ?? "").trim()) return false;
  if (!sow.approval?.approved) return false;
  const platforms = Array.isArray(sow.platforms) ? sow.platforms : [];
  if (platforms.length === 0) return false;
  const monthlyPosts = sow.monthlyPosts ?? {};
  const totalPosts = Object.values(monthlyPosts).reduce((acc, value) => acc + (Number(value) || 0), 0);
  if (totalPosts <= 0) return false;
  for (const p of platforms) {
    if ((Number(monthlyPosts[p]) || 0) <= 0) return false;
  }
  const contentMix = sow.contentMix ?? {};
  const totalMix = Object.values(contentMix).reduce((acc, value) => acc + (Number(value) || 0), 0);
  return totalMix > 0 && totalMix === totalPosts;
}

/** Human-readable reasons the SOW is not ready (for empty-state / sidebar). */
export function getSowIncompleteReasons(sow: SowLike | null | undefined): string[] {
  if (!sow) return ["Add and approve your SOW details below."];
  const out: string[] = [];
  if (!String(sow.understandingOfRequirements ?? "").trim()) {
    out.push("Fill “Understanding of Requirements”.");
  }
  if (!String(sow.scopeOfWork ?? "").trim()) {
    out.push("Fill “Scope of Work”.");
  }
  if (!sow.approval?.approved) {
    out.push("Click “Approve & save SOW” (or “Update & save SOW”) at the bottom of the SOW form.");
  }
  const platforms = Array.isArray(sow.platforms) ? sow.platforms : [];
  if (platforms.length === 0) {
    out.push("Select at least one platform.");
  }
  const monthlyPosts = sow.monthlyPosts ?? {};
  const totalPosts = Object.values(monthlyPosts).reduce((acc, v) => acc + (Number(v) || 0), 0);
  if (totalPosts <= 0) {
    out.push("Set monthly post counts (total > 0).");
  }
  for (const p of platforms) {
    if ((Number(monthlyPosts[p]) || 0) <= 0) {
      out.push(`Set monthly posts for ${p} (cannot be 0 while the platform is selected).`);
    }
  }
  const contentMix = sow.contentMix ?? {};
  const totalMix = Object.values(contentMix).reduce((acc, v) => acc + (Number(v) || 0), 0);
  if (totalMix <= 0 || totalMix !== totalPosts) {
    out.push(
      `Align content-mix posts with monthly total (${totalPosts} posts/month; mix currently sums to ${totalMix}).`,
    );
  }
  return out;
}

export function getPendingApprovalSections(
  approvals: SectionApprovals | null | undefined,
): CanonicalSectionKey[] {
  return CANONICAL_STRATEGY_SECTIONS.map((entry) => entry.key).filter(
    (key) => !approvals?.[key],
  );
}

export function allSectionsApproved(approvals: SectionApprovals | null | undefined): boolean {
  return getPendingApprovalSections(approvals).length === 0;
}

export function getWeekLabelFromDate(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const day = date.getUTCDate();
  const week = Math.floor((day - 1) / 7) + 1;
  return `Week ${Math.min(Math.max(week, 1), 5)}`;
}
