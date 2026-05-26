import { normalizeHeading, normalizeLineEndings } from "./normalize-heading.js";
import { MAX_HEADINGS } from "./section-registry.js";
import { detectConfidence, parseMultilineItems } from "./parse-multiline-items.js";
import { matchFieldDef, matchSectionId } from "./section-registry.js";
import { sanitizeParsedFields } from "./sanitize-parsed-fields.js";
import type { ParsedField, ParsedResearchBrief, ParsedSection } from "./types.js";

type HeadingNode = {
  level: number;
  sourceHeading: string;
  normalized: string;
  bodyLines: string[];
  children: HeadingNode[];
};

const HEADING_RE = /^(#{1,4})\s+(.+?)\s*$/;
const KV_RE = /^\s*(?:[-*•]\s+)?([^:：]+?)[:：]\s*(.+)$/;

function parseHeadingTree(text: string): HeadingNode[] {
  const lines = normalizeLineEndings(text).split("\n");
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  for (const line of lines) {
    const match = line.match(HEADING_RE);
    if (match) {
      const level = match[1].length;
      const sourceHeading = match[2].trim();
      const node: HeadingNode = {
        level,
        sourceHeading,
        normalized: normalizeHeading(sourceHeading),
        bodyLines: [],
        children: [],
      };
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      if (stack.length === 0) roots.push(node);
      else stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }
    if (stack.length > 0) stack[stack.length - 1].bodyLines.push(line);
  }
  return roots;
}

function flattenNodes(nodes: HeadingNode[], parentSectionId: string | null = null): Array<{
  node: HeadingNode;
  sectionId: string | null;
}> {
  const out: Array<{ node: HeadingNode; sectionId: string | null }> = [];
  for (const node of nodes) {
    const sectionMatch = matchSectionId(node.sourceHeading);
    const sectionId = sectionMatch ?? (node.level <= 2 ? null : parentSectionId);
    const effectiveSection = sectionMatch ?? parentSectionId;
    out.push({ node, sectionId: effectiveSection });
    out.push(...flattenNodes(node.children, sectionMatch ?? parentSectionId));
  }
  return out;
}

function extractBody(node: HeadingNode): string {
  return node.bodyLines.join("\n").trim();
}

function extractKeyValueFields(body: string, sectionId: string | null, sourceHeading: string): ParsedField[] {
  const fields: ParsedField[] = [];
  const confidence = detectConfidence(body);
  for (const line of body.split("\n")) {
    const kv = line.match(KV_RE);
    if (!kv) continue;
    const key = kv[1].trim();
    const value = kv[2].trim();
    if (!value) continue;
    const def = matchFieldDef(key, sectionId);
    if (!def || def.skip) continue;
    fields.push({
      canonicalFieldId: def.id,
      alias: key,
      value: def.valueType === "string[]" ? parseMultilineItems(value, { allowCommaFallback: true }) : value,
      sourceHeading,
      confidence,
    });
  }
  return fields;
}

function extractFieldFromNode(
  node: HeadingNode,
  sectionId: string | null,
): ParsedField | null {
  const def = matchFieldDef(node.sourceHeading, sectionId);
  if (!def || def.skip) return null;
  const body = extractBody(node);
  if (!body) return null;
  const kvFields = extractKeyValueFields(body, sectionId, node.sourceHeading);
  if (kvFields.length === 1 && kvFields[0].canonicalFieldId === def.id) {
    return kvFields[0];
  }
  const confidence = detectConfidence(body);
  const value =
    def.valueType === "string[]"
      ? parseMultilineItems(body, { allowCommaFallback: def.id.includes("recurringTopics") })
      : body;
  if ((Array.isArray(value) && value.length === 0) || (typeof value === "string" && !value.trim())) {
    return null;
  }
  return {
    canonicalFieldId: def.id,
    alias: node.sourceHeading,
    value,
    sourceHeading: node.sourceHeading,
    confidence,
  };
}

function countHeadings(nodes: HeadingNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countHeadings(node.children), 0);
}

export function parseResearchBriefMarkdown(rawText: string): ParsedResearchBrief {
  const warnings: string[] = [];
  const errors: string[] = [];
  const text = normalizeLineEndings(rawText).trim();

  if (!text) {
    return {
      sections: [],
      fields: [],
      warnings,
      errors: ["Paste or upload a research brief first."],
      unmappedSections: [],
      parseMeta: {
        headingCount: 0,
        mappedFieldCount: 0,
        unmappedSectionCount: 0,
        parsedAt: new Date().toISOString(),
      },
    };
  }

  const roots = parseHeadingTree(text);
  const headingCount = countHeadings(roots);
  if (headingCount === 0) {
    errors.push("No Markdown headings detected.");
  }
  if (headingCount > MAX_HEADINGS) {
    warnings.push(`More than ${MAX_HEADINGS} headings detected; only the first ${MAX_HEADINGS} were processed.`);
  }

  const flat = flattenNodes(roots).slice(0, MAX_HEADINGS);
  const sections: ParsedSection[] = [];
  const fields: ParsedField[] = [];
  const unmappedSections: Array<{ sourceHeading: string; body: string }> = [];
  const seenFieldIds = new Map<string, string>();

  let title: string | undefined;
  if (roots[0]?.level === 1) title = roots[0].sourceHeading;

  for (const { node, sectionId } of flat) {
    const body = extractBody(node);
    const isTopSection = matchSectionId(node.sourceHeading) != null;

    if (isTopSection) {
      sections.push({
        canonicalId: sectionId,
        sourceHeading: node.sourceHeading,
        level: node.level,
        body,
        fields: [],
      });
      continue;
    }

    const kvFields = extractKeyValueFields(body, sectionId, node.sourceHeading);
    if (kvFields.length > 0) {
      for (const field of kvFields) {
        if (seenFieldIds.has(field.canonicalFieldId)) {
          warnings.push(`Duplicate field "${field.canonicalFieldId}" — using latest value from "${node.sourceHeading}".`);
        }
        seenFieldIds.set(field.canonicalFieldId, node.sourceHeading);
        fields.push(field);
      }
      continue;
    }

    const field = extractFieldFromNode(node, sectionId);
    if (field) {
      if (seenFieldIds.has(field.canonicalFieldId)) {
        warnings.push(`Duplicate field "${field.canonicalFieldId}" — using latest value from "${node.sourceHeading}".`);
      }
      seenFieldIds.set(field.canonicalFieldId, node.sourceHeading);
      fields.push(field);
      continue;
    }

    if (body && node.level >= 2) {
      if (sectionId === "source_and_provenance_map") {
        fields.push({
          canonicalFieldId: "preserve.sourceProvenance",
          alias: node.sourceHeading,
          value: body,
          sourceHeading: node.sourceHeading,
        });
      } else if (sectionId === "missing_information") {
        const items = parseMultilineItems(body);
        fields.push({
          canonicalFieldId: "preserve.missingInformation",
          alias: node.sourceHeading,
          value: items.length > 1 ? items : body,
          sourceHeading: node.sourceHeading,
          confidence: "missing",
        });
      } else if (node.level === 2 && !sectionId) {
        unmappedSections.push({ sourceHeading: node.sourceHeading, body });
      } else if (node.level >= 3 && body) {
        unmappedSections.push({ sourceHeading: node.sourceHeading, body });
      }
    }
  }

  // Section-level bodies without sub-headings (e.g. whole section as one block)
  for (const { node, sectionId } of flat) {
    if (!matchSectionId(node.sourceHeading)) continue;
    const body = extractBody(node);
    if (!body || node.children.length > 0) continue;
    if (sectionId === "source_and_provenance_map") {
      fields.push({
        canonicalFieldId: "preserve.sourceProvenance",
        alias: node.sourceHeading,
        value: body,
        sourceHeading: node.sourceHeading,
      });
    } else if (sectionId === "missing_information") {
      const items = parseMultilineItems(body);
      fields.push({
        canonicalFieldId: "preserve.missingInformation",
        alias: node.sourceHeading,
        value: items,
        sourceHeading: node.sourceHeading,
        confidence: "missing",
      });
    }
  }

  if (headingCount > 0 && headingCount < 3) {
    const totalBody = flat.reduce((sum, { node }) => sum + extractBody(node).length, 0);
    if (totalBody / Math.max(headingCount, 1) > 2000) {
      warnings.push("This may not be a structured brief (few headings with long prose).");
    }
  }

  const mappedFieldCount = fields.filter((f) => !f.canonicalFieldId.startsWith("preserve.")).length;
  const sanitizedFields = sanitizeParsedFields(fields);

  return {
    title,
    sections,
    fields: sanitizedFields,
    warnings,
    errors,
    unmappedSections,
    parseMeta: {
      headingCount,
      mappedFieldCount: sanitizedFields.filter((f) => !f.canonicalFieldId.startsWith("preserve.")).length,
      unmappedSectionCount: unmappedSections.length,
      parsedAt: new Date().toISOString(),
    },
  };
}
