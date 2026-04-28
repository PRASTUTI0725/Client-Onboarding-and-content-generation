function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Unwraps JSON-RPC `tools/call` result. Many servers return
 * `{ content: [{ type: "text", text: "<stringified json or prose>" }], isError?: boolean }`
 * instead of a plain object — `parseInstagramMcpData` would see no `bioSignals` and drop everything.
 */
export function normalizeMcpToolResult(result: unknown): unknown {
  if (result == null) return null;

  if (typeof result === "string") {
    const t = result.trim();
    if (!t) return null;
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        return JSON.parse(t) as unknown;
      } catch {
        return { rawText: t };
      }
    }
    return { rawText: t };
  }

  const rec = asRecord(result);
  if (!rec) return result;

  if (rec.structuredContent != null) {
    const sc = asRecord(rec.structuredContent) ?? asRecord((rec.structuredContent as { data?: unknown }).data);
    if (sc) return { ...sc };
  }

  if (rec.data != null && typeof rec.data === "object" && !Array.isArray(rec.data)) {
    return rec.data;
  }

  if (rec.result != null && typeof rec.result === "object") {
    return rec.result;
  }

  const content = rec.content;
  if (!Array.isArray(content) || content.length === 0) {
    return rec;
  }

  if (rec.isError === true) {
    return { _mcpError: true, content };
  }

  const merged: Record<string, unknown> = {};
  const textParts: string[] = [];

  for (const item of content) {
    const block = asRecord(item);
    if (!block) continue;
    const t = block.type;
    if (t === "text" && typeof block.text === "string") {
      const raw = block.text.trim();
      if (!raw) continue;
      if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (asRecord(parsed)) {
            Object.assign(merged, asRecord(parsed)!);
          } else if (Array.isArray(parsed) && !merged.bioSignals) {
            merged.bioSignals = parsed;
          } else {
            textParts.push(typeof parsed === "string" ? parsed : raw);
          }
        } catch {
          textParts.push(raw);
        }
      } else {
        textParts.push(raw);
      }
    }
  }

  if (Object.keys(merged).length > 0) {
    if (textParts.length > 0 && !merged.bio && !merged.bioSignals) {
      merged.bio = textParts.join("\n");
    }
    return merged;
  }

  if (textParts.length > 0) {
    return { bio: textParts.join("\n"), _fromPlainText: true };
  }

  return rec;
}
