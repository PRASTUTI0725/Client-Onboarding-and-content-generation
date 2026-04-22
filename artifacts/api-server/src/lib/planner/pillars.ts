const PALETTE = [
  "#B05B47", // terracotta
  "#7A8B6F", // sage
  "#D4A574", // ochre
  "#5C7A91", // dusty blue
  "#9C7B8E", // mauve
  "#A8956B", // olive
];

export interface PillarMeta {
  name: string;
  color: string;
  description: string;
}

export function buildPillarMeta(
  contentStrategy: Record<string, unknown> | null | undefined,
): PillarMeta[] {
  const raw = (contentStrategy?.["pillars"] ?? []) as Array<unknown>;
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      { name: "Education", color: PALETTE[0]!, description: "Teach the audience something useful." },
      { name: "Engagement", color: PALETTE[1]!, description: "Spark conversation and connection." },
      { name: "Conversion", color: PALETTE[2]!, description: "Move people toward the offer." },
    ];
  }
  return raw.slice(0, 6).map((entry, i) => {
    if (typeof entry === "string") {
      return { name: entry, color: PALETTE[i % PALETTE.length]!, description: "" };
    }
    const obj = (entry ?? {}) as Record<string, unknown>;
    return {
      name: String(obj["name"] ?? `Pillar ${i + 1}`),
      color: PALETTE[i % PALETTE.length]!,
      description: String(obj["description"] ?? ""),
    };
  });
}
