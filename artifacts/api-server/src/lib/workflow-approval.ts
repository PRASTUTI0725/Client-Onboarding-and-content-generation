export const APPROVED_SOW_REQUIRED_MESSAGE =
  "Approve the current SOW before generating Business DNA.";

export type WorkflowArtifactStatus =
  | "missing"
  | "legacy"
  | "validation_failed"
  | "stale"
  | "unapproved"
  | "approved_current";

export type WorkflowApprovalState<T> = {
  status: WorkflowArtifactStatus;
  artifact: T | null;
  approvalSnapshotId: string | null;
};

type ApprovalMeta = {
  approved?: boolean;
  approvedSnapshotId?: string | null;
};

type BusinessDnaMeta = {
  validationStatus?: "passed" | "warning" | "failed" | "not_run";
  approval?: ApprovalMeta;
  stale?: boolean;
};

type StrategyMeta = {
  validationStatus?: "passed" | "warning" | "failed" | "not_run";
  approval?: ApprovalMeta;
  snapshotState?: "fresh" | "stale";
};

export function readApprovedSnapshotRecord<T extends Record<string, unknown>>(
  sow: Record<string, unknown> | null | undefined,
): T | null {
  const value = (sow?.__approvedContextSnapshot as T | undefined) ?? undefined;
  if (!value || typeof value.id !== "string" || !value.id.trim()) return null;
  return value;
}

export function getBusinessDnaWorkflowState<T extends Record<string, unknown>>(
  enrichedData: Record<string, unknown> | null | undefined,
  snapshotId: string | null,
): WorkflowApprovalState<T> {
  const artifact = ((enrichedData?.businessDna as T | null | undefined) ?? null) as T | null;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact) || Object.keys(artifact).length === 0) {
    return { status: "missing", artifact: null, approvalSnapshotId: null };
  }
  const meta = ((artifact.__meta as BusinessDnaMeta | undefined) ?? undefined);
  if (!meta) {
    return { status: "legacy", artifact, approvalSnapshotId: null };
  }
  if (meta.validationStatus === "failed") {
    return { status: "validation_failed", artifact, approvalSnapshotId: meta.approval?.approvedSnapshotId ?? null };
  }
  if (meta.stale) {
    return { status: "stale", artifact, approvalSnapshotId: meta.approval?.approvedSnapshotId ?? null };
  }
  if (snapshotId && meta.approval?.approvedSnapshotId && meta.approval.approvedSnapshotId !== snapshotId) {
    return { status: "stale", artifact, approvalSnapshotId: meta.approval.approvedSnapshotId };
  }
  if (!meta.approval?.approved) {
    return { status: "unapproved", artifact, approvalSnapshotId: meta.approval?.approvedSnapshotId ?? null };
  }
  return { status: "approved_current", artifact, approvalSnapshotId: meta.approval?.approvedSnapshotId ?? null };
}

export function getJtaWorkflowState<T extends Record<string, unknown>>(
  structured: Record<string, unknown> | null | undefined,
  snapshotId: string | null,
): WorkflowApprovalState<T> {
  const artifact = ((structured as T | null | undefined) ?? null) as T | null;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact) || Object.keys(artifact).length === 0) {
    return { status: "missing", artifact: null, approvalSnapshotId: null };
  }
  const meta = ((artifact.__meta as StrategyMeta | undefined) ?? undefined);
  if (!meta) {
    return { status: "legacy", artifact, approvalSnapshotId: null };
  }
  if (meta.validationStatus === "failed") {
    return { status: "validation_failed", artifact, approvalSnapshotId: meta.approval?.approvedSnapshotId ?? null };
  }
  if (meta.snapshotState === "stale") {
    return { status: "stale", artifact, approvalSnapshotId: meta.approval?.approvedSnapshotId ?? null };
  }
  if (snapshotId && meta.approval?.approvedSnapshotId && meta.approval.approvedSnapshotId !== snapshotId) {
    return { status: "stale", artifact, approvalSnapshotId: meta.approval.approvedSnapshotId };
  }
  if (!meta.approval?.approved) {
    return { status: "unapproved", artifact, approvalSnapshotId: meta.approval?.approvedSnapshotId ?? null };
  }
  return { status: "approved_current", artifact, approvalSnapshotId: meta.approval?.approvedSnapshotId ?? null };
}

export function getBusinessDnaRequirementError(
  state: WorkflowApprovalState<unknown>,
  actionLabel: string,
): string | null {
  switch (state.status) {
    case "missing":
    case "legacy":
      return `Generate and approve the current Business DNA before ${actionLabel}.`;
    case "validation_failed":
      return `Regenerate Business DNA until it passes validation, then approve the current Business DNA before ${actionLabel}.`;
    case "stale":
      return `Regenerate and approve the current Business DNA before ${actionLabel}.`;
    case "unapproved":
      return `Approve the current Business DNA before ${actionLabel}.`;
    case "approved_current":
    default:
      return null;
  }
}

export function getJtaRequirementError(
  state: WorkflowApprovalState<unknown>,
  actionLabel: string,
): string | null {
  switch (state.status) {
    case "missing":
    case "legacy":
      return `Generate and approve the current Jump-to-Action before ${actionLabel}.`;
    case "validation_failed":
      return `Regenerate Jump-to-Action until it passes validation, then approve the current Jump-to-Action before ${actionLabel}.`;
    case "stale":
      return `Regenerate and approve the current Jump-to-Action before ${actionLabel}.`;
    case "unapproved":
      return `Approve the current Jump-to-Action before ${actionLabel}.`;
    case "approved_current":
    default:
      return null;
  }
}

export function getCurrentJtaDraftRequirementError(
  state: WorkflowApprovalState<unknown>,
  actionLabel: string,
): string | null {
  switch (state.status) {
    case "missing":
    case "legacy":
      return `Generate the current Jump-to-Action before ${actionLabel}.`;
    case "validation_failed":
      return `Regenerate Jump-to-Action until it passes validation before ${actionLabel}.`;
    case "stale":
      return `Regenerate the current Jump-to-Action before ${actionLabel}.`;
    case "unapproved":
    case "approved_current":
    default:
      return null;
  }
}

/*
Manual verification checklist for the approved-current workflow:
1. Approve SOW, generate DNA, approve DNA, generate JTA, approve JTA, then verify strategy/calendar actions unlock.
2. Change approved SOW and confirm DNA/JTA surfaces become stale and downstream generation blocks.
3. Open a legacy client with missing __meta and confirm artifacts stay readable but unapproved/unknown.
4. Force a failed-validation artifact and confirm approval-dependent routes return the matching actionable error.
*/
