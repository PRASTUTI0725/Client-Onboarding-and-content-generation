# Import Research Brief

Deterministic Markdown research-brief import for the SOW workspace.

## Usage

1. Open a client workspace → **SOW details**
2. Use **Import Research Brief** at the top of the form
3. Paste or upload `.md` / `.txt` (standardized Claude brief format)
4. Review the preview (mapped fields, overwrite warnings, unmapped sections)
5. Confirm import → fields fill the SOW / Instagram form
6. **Approve & save SOW** to persist and unlock Business DNA

## Parser package

Shared logic lives in [`lib/research-brief/`](../lib/research-brief/).

## Fixture

See [`tests/fixtures/svara-research-brief.md`](../tests/fixtures/svara-research-brief.md) for the reference brief used in unit and E2E tests.

## Storage

- Full imported payload: `onboarding_profiles.raw_input.importedResearchBrief`
- Slim import metadata on SOW: `clients.sow.researchBriefImport`
- Business DNA reads compact `importedResearch` at rebuild time
