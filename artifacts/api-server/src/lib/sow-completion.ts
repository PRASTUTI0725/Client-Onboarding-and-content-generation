/**
 * SOW gating: aligned with `strategy-workflow` in the app — absolute pillar counts, not %.
 * Sections 3–6 (pricing, timeline, payment, next steps) are optional for "PDF sections 1+2 only" flows.
 */

import { effectiveScopeOfWork } from "./sow-canonical.js";

export type SowLike = Record<string, unknown> | null | undefined;

function sumRecord(rec: Record<string, number>): number {
  return Object.values(rec).reduce((acc, v) => acc + (Number(v) || 0), 0);
}

export function isSowComplete(sow: SowLike): boolean {
  if (!sow || typeof sow !== "object") return false;
  const uor = String(sow.understandingOfRequirements ?? "").trim();
  const v = Number((sow as { sowVersion?: unknown }).sowVersion) || 1;
  const sowText =
    v >= 2
      ? effectiveScopeOfWork(sow as Record<string, unknown>) || String(sow.scopeOfWork ?? "").trim()
      : String(sow.scopeOfWork ?? "").trim();
  if (!uor || !sowText) return false;
  if (!((sow.approval as { approved?: boolean } | undefined)?.approved)) return false;
  const platforms = Array.isArray(sow.platforms) ? (sow.platforms as string[]) : [];
  if (platforms.length === 0) return false;
  const monthly = (sow.monthlyPosts ?? {}) as Record<string, number>;
  const totalPosts = sumRecord(monthly);
  if (totalPosts <= 0) return false;
  for (const p of platforms) {
    if ((Number(monthly[p]) || 0) <= 0) return false;
  }
  const contentMix = (sow.contentMix ?? {}) as Record<string, number>;
  const totalMix = sumRecord(contentMix);
  return totalMix > 0 && totalMix === totalPosts;
}

export function isSowWorkflowReady(sow: SowLike): boolean {
  return isSowComplete(sow);
}
