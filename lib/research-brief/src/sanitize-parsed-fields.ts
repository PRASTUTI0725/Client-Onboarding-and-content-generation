import { joinFieldValue } from "./parse-multiline-items.js";
import { isProfileCategoryPlaceholder } from "./value-quality.js";
import type { ParsedField } from "./types.js";

export function sanitizeParsedFields(fields: ParsedField[]): ParsedField[] {
  return fields.map((field) => {
    if (field.canonicalFieldId !== "instagram.category") return field;
    const text = joinFieldValue(field.value);
    if (!isProfileCategoryPlaceholder(text)) return field;
    return {
      ...field,
      canonicalFieldId: "instagram.additionalInstagramNotes",
      alias: field.sourceHeading,
      value: `Profile category (import note): ${text}`,
      confidence: "missing",
    };
  });
}
