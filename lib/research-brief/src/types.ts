export type ImportRowStatus = "will_fill" | "will_update" | "skipped" | "unmapped";

export type FieldValueType = "string" | "string[]";

export type CanonicalFieldDef = {
  id: string;
  label: string;
  sectionId: string;
  valueType: FieldValueType;
  /** Dot path for apply target, e.g. sow.industry */
  targetPath: string;
  /** Skip mapping when section body matches ignore patterns */
  skip?: boolean;
};

export type ParsedField = {
  canonicalFieldId: string;
  alias: string;
  value: string | string[];
  sourceHeading: string;
  confidence?: "confirmed" | "inferred" | "missing";
};

export type ParsedSection = {
  canonicalId: string | null;
  sourceHeading: string;
  level: number;
  body: string;
  fields: ParsedField[];
};

export type ParsedResearchBrief = {
  title?: string;
  sections: ParsedSection[];
  fields: ParsedField[];
  warnings: string[];
  errors: string[];
  unmappedSections: Array<{ sourceHeading: string; body: string }>;
  parseMeta: {
    headingCount: number;
    mappedFieldCount: number;
    unmappedSectionCount: number;
    parsedAt: string;
  };
};

export type ImportedFieldProvenance = {
  source: "imported_markdown";
  sourceHeading: string;
  originalSectionId: string;
  confidence?: "confirmed" | "inferred" | "missing";
  importedAt: string;
  importFileName?: string;
  importHash: string;
};

export type ResearchBriefImportMeta = {
  lastImportedAt: string;
  importFileName?: string;
  importHash: string;
  fieldProvenance: Record<string, ImportedFieldProvenance>;
  sectionMap: Record<string, { sourceHeading: string; canonicalId: string }>;
};

export type ImportedResearchBrief = {
  version: 1;
  rawMarkdownHash: string;
  importedAt: string;
  importFileName?: string;
  websiteContext?: Record<string, string>;
  researchInputs?: {
    audience?: Record<string, string>;
    positioning?: Record<string, string>;
    offer?: Record<string, string>;
    toneOfVoice?: Record<string, string>;
    visualIdentity?: Record<string, string>;
    contentStrategy?: Record<string, string>;
  };
  claimSafetyNotes?: {
    claimsAllowed?: string;
    claimsToAvoid?: string;
    proofLimitations?: string;
    sensitiveCategoryNotes?: string;
  };
  sourceProvenance?: string;
  missingInformation?: string[];
  additionalImportedNotes?: string;
  fieldProvenance?: Record<string, ImportedFieldProvenance>;
};

export type ImportPreviewRow = {
  id: string;
  section: string;
  extractedValue: string;
  targetField: string;
  targetPath: string;
  targetLabel: string;
  status: ImportRowStatus;
  selected: boolean;
  warning?: string;
  value: string | string[];
};

export type ImportPreview = {
  rows: ImportPreviewRow[];
  warnings: string[];
  errors: string[];
  unmappedSections: Array<{ sourceHeading: string; body: string }>;
  parseMeta: ParsedResearchBrief["parseMeta"];
  importedResearchBrief: ImportedResearchBrief;
  researchBriefImportMeta: ResearchBriefImportMeta;
};

export type ExistingClientValues = {
  clientName?: string;
  website?: string;
  instagramHandle?: string;
  oneLineDescription?: string;
  businessType?: string;
  industry?: string;
  targetAudience?: string;
  understandingOfRequirements?: string;
  strategyLaunchPlanning?: string;
  contentCreation?: string;
  deliverables?: string[];
  instagram?: {
    handle?: string;
    bio?: string;
    offerSummary?: string;
    recentCaptionSnippets?: string[];
    recurringTopics?: string[];
    ctaPatterns?: string[];
    proofSignals?: string[];
    followerCount?: string;
    category?: string;
    visualStyleNotes?: string;
    additionalInstagramNotes?: string;
  };
};

export type ResearchBriefApplyPayload = {
  clientBasics?: {
    name?: string;
    website?: string;
    instagramHandle?: string;
    oneLineDescription?: string;
    businessType?: string;
  };
  sow?: {
    industry?: string;
    targetAudience?: string;
    understandingOfRequirements?: string;
    strategyLaunchPlanning?: string;
    contentCreation?: string;
    deliverables?: string[];
  };
  instagram?: {
    handle?: string;
    bio?: string;
    offerSummary?: string;
    recentCaptionSnippets?: string[];
    recurringTopics?: string[];
    ctaPatterns?: string[];
    proofSignals?: string[];
    followerCount?: string;
    category?: string;
    visualStyleNotes?: string;
    additionalInstagramNotes?: string;
  };
  importedResearchBrief: ImportedResearchBrief;
  researchBriefImportMeta: ResearchBriefImportMeta;
};
