# Strategy Prompt Templates

This folder stores versioned strategy prompt templates for reusable AI generation.

## Format Standard

Use Markdown (`.md`) as the canonical prompt file format in this project.

Why Markdown over `.txt`:
- better readability and reviewability for long prompts
- still plain text, so runtime loading/injection is identical
- easier prompt version diffs in git

## Files

- `v1-full.md`
  - Full strategy generation prompt
  - Produces complete strategy JSON with canonical sections, summary, and metadata

- `v1-patch.md`
  - Section regenerate / patch prompt
  - Produces patch-only JSON for one canonical section

## Placeholders in `v1-full.md`

### Full Placeholder List

- `{{client_name}}`
- `{{industry_category}}`
- `{{website_summary}}`
- `{{instagram_handle}}`
- `{{one_line_description}}`
- `{{business_dna}}`
- `{{sow_scope}}`
- `{{platforms_list}}`
- `{{monthly_post_counts}}`
- `{{content_mix_breakdown}}`
- `{{tone_by_platform}}`
- `{{budget_resources}}`
- `{{pillar_priorities}}`
- `{{monthly_goals}}`
- `{{target_audience_definition}}`
- `{{key_business_objectives}}`

### Required Placeholders

- `{{client_name}}`
- `{{industry_category}}`
- `{{one_line_description}}`
- `{{business_dna}}`
- `{{sow_scope}}`
- `{{platforms_list}}`
- `{{target_audience_definition}}`
- `{{key_business_objectives}}`

### Optional Placeholders

- `{{website_summary}}`
- `{{instagram_handle}}`
- `{{monthly_post_counts}}`
- `{{content_mix_breakdown}}`
- `{{tone_by_platform}}`
- `{{budget_resources}}`
- `{{pillar_priorities}}`
- `{{monthly_goals}}`

Missing optional placeholders are replaced with empty strings by the injector.

## Placeholder -> Backend Schema Mapping

| Placeholder | Backend Source (priority order where relevant) |
| --- | --- |
| `client_name` | `client.name` |
| `industry_category` | `client.sow.industry` |
| `website_summary` | `onboarding.enrichedData.websiteSummary` -> `onboarding.enrichedData.websiteSignalSummary` -> `client.website` |
| `instagram_handle` | `client.instagramHandle` |
| `one_line_description` | `client.oneLineDescription` |
| `business_dna` | `onboarding.enrichedData.businessDna` -> composed enriched fallback (`brand_name`, `offer`, `positioning`, `brand_tone`, `target_audience`) |
| `sow_scope` | `client.sow.scopeOfWork` -> merge of `understandingOfRequirements` + `strategyLaunchPlanning` + `contentCreation` |
| `platforms_list` | `client.sow.platforms` |
| `monthly_post_counts` | `client.sow.monthlyPosts` |
| `content_mix_breakdown` | `client.sow.contentMix` |
| `tone_by_platform` | `client.sow.toneByPlatform` |
| `budget_resources` | `client.sow.deliverables` |
| `pillar_priorities` | `strategy.structuredStrategy.__summary.pillarPriorities` |
| `monthly_goals` | `strategy.structuredStrategy.__summary.monthlyGoals` |
| `target_audience_definition` | `client.sow.targetAudience` |
| `key_business_objectives` | 1) normalized SOW goals/objectives (`client.sow.normalizedSections` goal/objective keys) -> 2) onboarding/business inputs (`onboarding.enrichedData.*`, `onboarding.rawInput.*`) -> 3) existing strategy summary (`strategy.structuredStrategy.__summary.strategy`) |

## Patch Prompt Placeholder

- `v1-patch.md` currently uses full `{{INPUT_JSON}}` payload style.
- If migrating patch prompt to granular placeholders later, reuse the same mapper with `sectionPatchRequest` keys.

## Output Schema Expectation

- `v1-full.md` must return strict JSON:
  - root: `strategy`
  - fields: `canonicalSections`, `summary`, `meta`

- `v1-patch.md` must return strict JSON:
  - root: `patch`
  - fields: `sectionKey`, `sectionValue`, `meta`

Prompt outputs should be validated by downstream parsing/contract checks before persistence.

## Version Naming Convention

Use semantic prompt versioning in filenames:
- `v1-full.md`
- `v1-patch.md`
- `v2-full.md`, `v2-patch.md`, etc.

Rules:
- bump major (`v1` -> `v2`) for schema or behavior changes
- keep `-full` / `-patch` suffix stable by mode
- do not modify old versions in-place once used in production flows
