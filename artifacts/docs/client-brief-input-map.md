# Client Brief Input Map

This document explains the **current** client input and generation flow in the tool today.

It is written for two audiences:

- **Founder / ops review**: to understand what the team needs to collect from a client and in what order.
- **Product / engineering review**: to understand how each input flows into SOW, Business DNA, Jump-to-Action, and the Content Calendar.

Important notes:

- This reflects the **current product behavior**, not a future ideal workflow.
- Some context is entered manually in the UI.
- Some context is **extracted or synthesized internally** from the website, Instagram, approved SOW, or public signals.
- PDF/SOW upload parsing exists in code, but the create-client flow currently keeps PDF upload hidden for founder testing.

---

## 1. Client Creation / First Intake

When a new client is created, the tool currently asks for these first inputs:

1. **Client name**
2. **Website** (optional)
3. **Instagram handle or notes** (optional)
4. **One-line business summary** (optional)

### What these fields mean

- **Client name**
  - What to fill: the business or brand name.
  - Why it matters: this is the primary identity anchor across all later stages.
  - Used by: onboarding profile, Business DNA, JTA, calendar, exports, and client workspace labels.

- **Website**
  - What to fill: the main public website URL.
  - Why it matters: it is the current entry point for website signal extraction later.
  - Used by: Business DNA generation, website summary extraction, and downstream calendar context.

- **Instagram handle or notes**
  - What to fill: ideally the exact handle; the current placeholder also allows a short note.
  - Why it matters: it becomes the first attached Instagram identifier before the richer Instagram block is completed in SOW.
  - Used by: onboarding profile, later Instagram fetch/merge logic, and Business DNA / calendar context.

- **One-line business summary**
  - What to fill: one sentence describing what the client does and for whom.
  - Why it matters: this is a lightweight business description before full SOW details are entered.
  - Used by: onboarding profile, enrichment context, Business DNA input, and strategy framing.

### What happens after client creation

- The client workspace is created immediately.
- These values are saved as the base onboarding profile.
- If website / Instagram / one-line summary exist, the tool marks Business DNA generation as **pending SOW approval**, not immediately runnable.

Current product behavior:

- The UI explicitly tells the user that the next step is to open the **SOW section** and paste goals, launch plan, platforms, and deliverables.

---

## 2. SOW Details

After client creation, the main structured intake happens inside the **SOW form**.

The current SOW fields appear in this order:

1. **Client industry**
2. **Target audience**
3. **Goals and requirements**
4. **Strategy and launch plan**
5. **Content deliverables**
   - Full SOW notes
   - Deliverables summary

### 2.1 Client industry

- What to fill: the category, product/service type, and market context.
- Why it matters: it helps the system understand category framing and business type.
- Used by:
  - Business DNA: category, positioning, tone, audience framing
  - JTA: strategic framing and platform/content logic
  - Calendar: strategy type interpretation, category-safe messaging, and content specificity

### 2.2 Target audience

- What to fill: who the client wants to reach, what they care about, and any meaningful audience segments.
- Why it matters: this is a core audience signal before Business DNA expands it into segments, pains, desires, and objections.
- Used by:
  - Business DNA: target audience section
  - JTA: audience and emotional driver sections
  - Calendar: audience tension, themes, objections, and proof framing

### 2.3 Goals and requirements

- What to fill: business goals, success criteria, constraints, and what the work should achieve.
- Why it matters: this is one of the required SOW narrative blocks.
- Used by:
  - Business DNA: purpose/mission/positioning cues
  - JTA: goals, KPIs, execution framing
  - Calendar: monthly goal framing, strategic angle, and conversion/awareness emphasis

### 2.4 Strategy and launch plan

- What to fill: rollout plan, launch timing, monthly priorities, execution scope, and what is in/out of scope.
- Why it matters: this is the second required SOW narrative block.
- Used by:
  - Business DNA: scope context and offer/process interpretation
  - JTA: execution phases, platform strategy, content strategy, and asset requirements
  - Calendar: campaign timing, planning constraints, monthly focus

### 2.5 Content deliverables

This section has two current layers:

- **Full SOW notes**
  - What to fill: the original deliverables wording from the SOW if the team wants to preserve it.
  - Why it matters: this keeps the narrative source text.

- **Deliverables summary**
  - What to fill: a shorter list of recurring outputs such as weekly reels, monthly carousels, Pinterest pins, story sets, reporting, etc.
  - Why it matters: this gives a cleaner operational summary than the raw narrative alone.

Used by:

- Business DNA: content and offer interpretation
- JTA: asset requirements and content strategy
- Calendar: practical understanding of what the monthly program is supposed to produce

---

## 3. Platform Management

After the SOW narrative and Instagram block, the tool asks for platform planning details.

The current platform-planning fields are:

1. **Active platforms**
2. **Monthly post volume**
3. **Tone by platform**
4. **Content buckets**
5. **SOW approval state**

### 3.1 Active platforms

- What to fill: the channels the client is actively running for this engagement.
- Current options: Instagram, LinkedIn, Pinterest, X, YouTube.
- Why it matters: downstream strategy and calendar logic should only plan for the selected platforms.
- Used by:
  - JTA: platform strategy
  - Calendar: platform split, weekly targets, allowed formats, active-platform-only rules

### 3.2 Monthly post volume

- What to fill: post count per selected platform, per month.
- Why it matters: this becomes the platform volume contract for the calendar.
- Used by:
  - SOW completeness checks
  - JTA context
  - Calendar generation: post counts per platform

### 3.3 Tone by platform

- What to fill: how each active platform should sound.
- Why it matters: this is execution guidance rather than abstract brand voice alone.
- Used by:
  - Strategy/JTA platform thinking
  - Calendar platform strategy and tone alignment

### 3.4 Content buckets

- What to fill: bucket names and monthly counts, for example education / social proof / promotion / thought leadership.
- Why it matters: this is the current content distribution contract.
- Used by:
  - Calendar generation: bucket counts, weekly bucket targets, required bucket sequence

### 3.5 SOW approval state

Current behavior:

- Saving the SOW marks it as approved for strategy generation.
- The system treats SOW approval as a gate before Business DNA, Jump-to-Action, and Calendar generation.

Why this matters:

- The calendar is blocked unless:
  - SOW is complete
  - platform counts are valid
  - content bucket totals match total monthly post count
  - SOW is approved

---

## 4. Instagram Context

The current SOW form contains a detailed **Instagram Context** block.

The fields appear in this order:

1. **Instagram Handle**
2. **Profile Bio**
3. **What They Sell / Offer**
4. **Recent Post Captions or Post Themes**
5. **Recurring Content Topics**
6. **Additional Instagram Notes**
7. **Advanced Instagram details** (optional)
   - CTA Patterns
   - Proof / Trust Signals
   - Follower Count
   - Profile Category
   - Visual Style Notes

### 4.1 Instagram Handle

- What to fill: exact handle, with or without `@`.
- Why it matters: it ties manual Instagram input to the public Instagram context path.
- Used by:
  - Business DNA: Instagram signal merge
  - JTA: Instagram-aware strategy
  - Calendar: Instagram context and safety/proof interpretation

### 4.2 Profile Bio

- What to fill: the full bio exactly as shown, including CTA or link language.
- Why it matters: it provides short positioning and voice signals.
- Used by:
  - Business DNA: brand tone, offer, signals, audience cues
  - JTA: market narrative and audience framing
  - Calendar: positioning/offer context

### 4.3 What They Sell / Offer

- What to fill: 1–3 sentences describing the main service, product, or transformation promoted on Instagram.
- Why it matters: it anchors the offer beyond the bio.
- Used by:
  - Business DNA: offers, positioning, content strategy
  - JTA: strategic problem/solution and conversion framing
  - Calendar: product/service specifics, proof modes, promotion logic

### 4.4 Recent Post Captions or Post Themes

- What to fill: one idea per line; the UI currently expects at least 4.
- Why it matters: it gives the system real examples of current content patterns.
- Used by:
  - Business DNA: Instagram content patterns
  - JTA: content strategy synthesis
  - Calendar: recurring topics and content style alignment

### 4.5 Recurring Content Topics

- What to fill: one topic per line; the UI currently expects at least 3.
- Why it matters: it helps the system see repeating themes and core conversation territory.
- Used by:
  - Business DNA: themes / content pillars
  - JTA: recurring series and content moves
  - Calendar: allowed angles and weekly themes

### 4.6 Additional Instagram Notes

- What to fill: anything extra that matters for strategy, including manual insights not visible publicly.
- Why it matters: this is the “catch-all” for useful internal context.
- Used by:
  - Business DNA: supporting context and synthesis
  - JTA: strategy nuance
  - Calendar: monthly brief/context

### 4.7 Advanced Instagram details

These are optional today.

#### CTA Patterns
- What to fill: repeated CTAs, one per line.
- Why it matters: helps the system detect current conversion language.
- Used by: Business DNA and calendar CTA/proof framing.

#### Proof / Trust Signals
- What to fill: visible testimonials, results, media mentions, proof cues, one per line.
- Why it matters: this is especially important because later generation should not invent proof.
- Used by:
  - Business DNA: proof & evidence
  - JTA: trust and messaging strategy
  - Calendar: proof contract and social proof safety

#### Follower Count
- What to fill: the number as shown (for example `12.4K`).
- Why it matters: light credibility/context signal.
- Used by: Business DNA platform signals and context.

#### Profile Category
- What to fill: the category shown under the profile name.
- Why it matters: useful for business-type interpretation and platform framing.
- Used by: Business DNA and strategy inference.

#### Visual Style Notes
- What to fill: the vibe, colors, layout, thumbnail style, and general visual pattern.
- Why it matters: this is currently one of the best manual visual-style inputs.
- Used by:
  - Business DNA visual identity
  - Calendar visual/format direction indirectly

---

## 5. Website Context / Website Signals

### What is manual today

Current manual website input in the UI is only:

- **Website URL** at client creation

There is **not currently a full manual website-context form** in the main SOW UI.

### What is extracted/synthesized internally

The project currently extracts a light `WebsiteSummary` from the public site:

- `title`
- `meta_description`
- `main_text_excerpt`

These are not separate founder-facing UI fields right now. They are internal extracted inputs.

### Additional website-derived signals used in Business DNA

Business DNA generation also uses website-derived/synthesized signals such as:

- homepage/hero excerpt
- messaging patterns
- trust elements
- conversion elements
- website color candidates
- page/title/meta signals

Important: these are mostly **not manual form fields today**. They are created internally from website fetch + parsing logic.

### How to interpret website context in the current system

- **Website URL**
  - Manual field today
  - Used to trigger public website fetch/extraction

- **Website summary/signals**
  - Not a manual UI field today
  - Extracted internally
  - Used in Business DNA and JTA generation

- **Homepage copy / hero excerpt**
  - Not a manual field today
  - Extracted/synthesized internally
  - Used in Business DNA positioning/voice/offers

- **Products / services / offers**
  - Not a dedicated website form field today
  - Inferred from website summary, one-line description, Instagram, and SOW

- **CTAs**
  - Not a dedicated website form field today
  - Inferred from website conversion elements where available

- **FAQs / objections**
  - Not a dedicated website form field today
  - Sometimes inferred indirectly from website copy and strategy synthesis

- **Testimonials / reviews / proof signals**
  - Not a dedicated website form field today
  - Detected if visible in website trust elements or manually supplied via Instagram context / SOW

- **Pricing / product names**
  - Not a dedicated website form field today
  - Partly inferred if the website clearly exposes them

- **Visual identity / colors**
  - Not a manual UI field today
  - Website color candidates are extracted internally from CSS/meta color literals

- **Website tone / messaging patterns**
  - Not a manual field today
  - Synthesized internally and used in Business DNA

### Recommendation for founder review

Today, website context is still heavily **system-extracted**, not deliberately structured by the user. This is one of the clearest areas where a future structured brief format would improve accuracy and transparency.

---

## 6. Business DNA Generation

### What Business DNA is generated from

Current system behavior:

**Business DNA is generated from approved SOW + onboarding profile + Instagram context + website signals + extracted/synthesized context.**

That includes:

- approved SOW narrative and platform plan
- onboarding basics (name, website, Instagram handle, one-line description)
- structured Instagram context from the SOW form
- public website summary and website-derived signals
- public/manual Instagram-derived signals
- inferred but source-aware synthesis

### Current Business DNA sections in the product

The current Business DNA UI and data model expose these sections:

1. **Source signals**
2. **Source coverage**
3. **Instagram positioning (optional)**
4. **Purpose**
5. **Mission**
6. **Vision**
7. **Core values**
8. **Brand archetype**
9. **Personality traits**
10. **Tone of voice**
11. **Target audience**
12. **Positioning**
13. **Offers**
14. **Content strategy**
15. **Language style**
16. **Visual identity — layout & type**
17. **Visual identity — website color candidates**
18. **Platform signals — website**
19. **Platform signals — Instagram**
20. **Proof & evidence**
21. **Where signals came from**

### How to read each section

#### Source signals
- What it means: whether usable website and Instagram signals were available.
- Influenced by: website URL, public website fetch, Instagram handle, structured Instagram input.
- Nature: extracted / inferred / missing.
- Should require provenance: yes.

#### Source coverage
- What it means: confidence-like coverage indicators, not a performance score.
- Influenced by: how much usable signal was available.
- Nature: inferred diagnostic.
- Should require provenance: yes.

#### Instagram positioning (optional)
- What it means: manual Instagram notes and positioning signals.
- Influenced by: `instagramSummaryNotes` and structured Instagram block.
- Nature: manual + synthesized.
- Should require provenance: yes.

#### Purpose / Mission / Vision
- What they mean: strategic identity statements.
- Influenced by: SOW goals, business summary, website messaging, Instagram offer/voice.
- Nature: inferred/synthesized.
- Should require provenance: yes.

#### Core values
- Influenced by: SOW language, website messaging, Instagram tone, inferred strategy.
- Nature: inferred unless explicitly stated by inputs.
- Should require provenance: yes.

#### Brand archetype
- Influenced by: category, voice, positioning, offer style.
- Nature: inferred.
- Should require provenance: yes.

#### Personality traits
- Influenced by: one-line description, website tone, Instagram style, SOW wording.
- Nature: inferred/synthesized.
- Should require provenance: yes.

#### Tone of voice
- Includes:
  - style
  - do’s
  - don’ts
  - sample phrases
- Influenced by: Instagram bio/captions, website messaging, SOW tone and category.
- Nature: synthesized from signals.
- Should require provenance: yes.

#### Target audience
- Includes:
  - segments
  - demographics
  - psychographics
  - geographies
  - pains
  - desires
  - objections
- Influenced by: SOW target audience, offer summary, website context, Instagram context.
- Nature: partly manual, partly inferred.
- Should require provenance: yes.

#### Positioning
- Includes:
  - category
  - value proposition
  - differentiators
  - competitor references
  - market angle
  - reasons to believe
- Influenced by: business summary, SOW, website hero/meta, Instagram offer summary, proof signals.
- Nature: synthesized.
- Should require provenance: yes, especially for differentiators and reasons to believe.

#### Offers
- Includes:
  - primary offers
  - pricing signals
  - transformation promise
  - urgency style
- Influenced by: SOW, Instagram offer summary, website messaging, pricing language if visible.
- Nature: partly extracted, partly inferred.
- Should require provenance: yes.

#### Content strategy
- Includes:
  - pillars
  - themes
  - hooks that fit
  - topics to avoid
  - trust signals to repeat
- Influenced by: Instagram recurring topics and captions, SOW goals, offer positioning, proof context.
- Nature: synthesized.
- Should require provenance: yes.

#### Language style
- Includes:
  - reading level
  - primary patterns
  - taboo words
  - CTA style
- Influenced by: website copy, Instagram copy, SOW tone.
- Nature: inferred/synthesized.
- Should require provenance: yes.

#### Visual identity — layout & type
- Includes:
  - layout
  - primary/secondary type
  - type notes
  - logo style
  - imagery style
  - design motifs
- Influenced by: website and Instagram visual clues, plus manual Instagram visual notes.
- Nature: largely inferred.
- Should require provenance: yes.

#### Visual identity — website color candidates
- What it means: color candidates extracted from the website.
- Influenced by: website CSS/meta colors.
- Nature: extracted.
- Should require provenance: yes.

#### Platform signals — website
- Includes:
  - pages analyzed
  - messaging patterns
  - trust elements
  - conversion elements
- Influenced by: extracted website signals.
- Nature: extracted/synthesized.
- Should require provenance: yes.

#### Platform signals — Instagram
- Includes:
  - handle
  - bio signals
  - content patterns
  - visual patterns
  - engagement signals
- Influenced by: public Instagram fetch + structured Instagram form.
- Nature: extracted + manual + synthesized.
- Should require provenance: yes.

#### Proof & evidence
- Includes:
  - testimonials present
  - case studies present
  - certifications
  - clients mentioned
  - metrics claimed
- Influenced by: website trust elements, Instagram proof signals, public signals.
- Nature: extracted/inferred.
- Should require provenance: absolutely yes.

#### Where signals came from
- Includes:
  - onboarding
  - website
  - Instagram
  - SOW
  - synthesized
- Influenced by: source attribution logic.
- Nature: provenance only.
- Should require provenance: this is the provenance layer itself.

---

## 7. Business DNA Approval

Current workflow:

1. User approves the SOW.
2. User generates Business DNA from the approved context.
3. User reviews Business DNA in the workspace.
4. User can edit fields.
5. User approves Business DNA.

Why it matters:

- After approval, Business DNA becomes the strategic base for Jump-to-Action and calendar generation.
- If the approved SOW changes later, Business DNA should be treated as **stale** and regenerated/reapproved.

Current product behavior already reflects this stale/approval workflow.

---

## 8. Jump-to-Action Generation

### What JTA is generated from

Current system behavior:

**Jump-to-Action is generated from approved SOW + approved Business DNA + Instagram/website context + platform/content planning.**

The current generator input includes:

- client basics
- business type
- SOW narrative + platforms + monthly posts + content mix + deliverables + tone by platform
- Instagram structured context
- approved Business DNA summary fields
- strategy type / template type

### Current JTA headings in the product

The current canonical Jump-to-Action sections are:

1. **Market Narrative**
2. **Problem • Gap • Solution**
3. **Brand Foundation**
4. **Brand Philosophy**
5. **Audience**
6. **Emotional Drivers**
7. **Platform Strategy**
8. **Content Strategy**
9. **KPIs**
10. **Tracking Plan**
11. **Execution Phases**
12. **Asset Requirements**

### What each section should contain

#### Market Narrative
- What it should contain: the market opportunity, positioning space, and why the brand matters now.
- Influenced by: positioning, category, audience, SOW goals, website/Instagram context.

#### Problem • Gap • Solution
- What it should contain: the audience problem, current market gap, and strategic answer.
- Influenced by: audience pains/objections, positioning, offers, SOW requirements.

#### Brand Foundation
- What it should contain: mission, promise, differentiator, and strategic baseline.
- Influenced by: Business DNA purpose/mission/vision, value proposition, differentiators.

#### Brand Philosophy
- What it should contain: worldview, stance, and narrative philosophy.
- Influenced by: Business DNA values, archetype, tone, positioning.

#### Audience
- What it should contain: who matters most now, what blocks them, and what moves them.
- Influenced by: SOW audience + Business DNA audience model.

#### Emotional Drivers
- What it should contain: emotional triggers behind attention, trust, action, and loyalty.
- Influenced by: Business DNA pains/desires/objections and offer framing.

#### Platform Strategy
- What it should contain: role of each approved platform and how each supports the broader strategy.
- Influenced by: active platforms, monthly volumes, tone by platform, Business DNA, SOW.

#### Content Strategy
- What it should contain: recurring content moves, themes, proof loops, education, and message structure.
- Influenced by: Business DNA content strategy, Instagram patterns, platform mix, SOW deliverables.

#### KPIs
- What it should contain: measurable signals that matter for the program.
- Influenced by: SOW goals, strategy type, platform mix.

#### Tracking Plan
- What it should contain: how the team reviews and interprets performance.
- Influenced by: KPIs, SOW goals, approved platform plan.

#### Execution Phases
- What it should contain: sequencing of launch, learning, optimization, and scale.
- Influenced by: strategy and launch plan, monthly priorities, scope.

#### Asset Requirements
- What it should contain: content, proof, visual, or process assets needed to execute.
- Influenced by: deliverables, platform plan, proof needs, offer and trust strategy.

---

## 9. Jump-to-Action Approval

Current workflow:

1. User generates Jump-to-Action after approved Business DNA exists.
2. User reviews the draft section by section.
3. User approves Jump-to-Action.
4. Strategy/calendar generation can then rely on the approved strategy baseline.

Current behavior:

- If Business DNA changes, Jump-to-Action can become stale.
- Approval state is tracked by section and by overall workflow.

---

## 10. Content Calendar Inputs

Calendar generation currently uses:

- **Approved SOW**
- **Approved Business DNA**
- **Approved Jump-to-Action**
- **Active platforms**
- **Platform post counts**
- **Content bucket counts**
- **Strategy type**
- **Monthly goal**
- **Notes and constraints**
- **Calendar month / start date**
- **Website summary**
- **Instagram summary / merged Instagram context**

### How the calendar uses these inputs

- The system builds a **compact calendar brief** rather than passing raw source documents.
- The calendar obeys:
  - platform counts
  - content bucket counts
  - strategy type
  - proof/safety constraints
- The calendar is currently designed as a **planning skeleton**, not a full caption/script engine by default.

---

## 11. Strategy Type

The current workspace offers these strategy types:

1. **Auto-select**
2. **Brand Building**
3. **Performance Marketing**
4. **Personal Brand**
5. **D2C Growth**

### How they should affect generation

#### Auto-select
- Lets the system resolve the best-fit type from current context.

#### Brand Building
- Focus: awareness, positioning, education, trust, ritual/category understanding, soft conversion.
- Calendar implication: avoid aggressive performance-only angles unless explicitly scoped.

#### Performance Marketing
- Focus: conversions, measurable demand capture, stronger offer clarity, possibly paid angles if truly in scope.

#### Personal Brand
- Focus: founder voice, personality transfer, authority, lived perspective, relationship-building.

#### D2C Growth
- Focus: product discovery, shop intent, conversion support, reviews/proof if real, repeat purchase and retention.

Important note:

- The codebase also contains some older demo/fallback template types such as hospitality, healthcare, and real_estate. Those exist in internal/demo paths, but the current workspace selector exposes the five types above.

---

## 12. Source / Provenance Rules

The system already points toward a provenance-aware workflow. A practical source label model for current and future fields should be:

- **Manual**
- **Imported document**
- **Website extracted**
- **Instagram manual/imported**
- **Inferred by AI**
- **Fallback**
- **Missing**

### Why provenance matters

- avoids fake proof
- avoids unsupported claims
- avoids treating weak scraped signals as confirmed truth
- makes Business DNA and JTA easier to approve confidently
- helps the calendar avoid invented testimonials, metrics, or medicalized claims

### Current reality

- Some provenance is already stored and displayed, especially in Business DNA.
- Website and Instagram context are partly extracted, partly manual, and partly synthesized.
- This is a strong reason to standardize a structured brief format before future import/upload work.

---

## 13. Proposed Structured Brief Template

This template follows the **same broad order as the current tool** and is designed to be copy-paste friendly.

```md
# Client Structured Brief

## 1. Basic Client Info
- Client name:
- One-line description:
- Website URL:
- Instagram handle:
- Business type:

## 2. SOW Details
### Client industry

### Target audience

### Goals and requirements

### Strategy and launch plan

### Content deliverables / Full SOW notes

### Deliverables summary

## 3. Platform Management
### Active platforms

### Monthly post volume

### Tone by platform

### Content buckets and counts

## 4. Instagram Context
### Instagram handle

### Profile bio

### What they sell / offer

### Recent post captions or post themes

### Recurring content topics

### CTA patterns

### Proof / trust signals

### Follower count

### Profile category

### Visual style notes

### Additional Instagram notes

## 5. Website Context
### Homepage summary

### Products/services/offers

### CTAs

### Proof/trust signals

### FAQs/objections

### Tone and messaging patterns

### Visual identity and color palette

### Important pages/links

## 6. Claim and Safety Notes
### Claims allowed

### Claims to avoid

### Proof limitations

### Sensitive industry restrictions

## 7. Calendar Planning Inputs
### Monthly goal

### Notes and constraints

### Campaign dates

### Launches/offers

### Blackout dates

### Topics to lean into

### Topics to avoid
```

---

## Technical Mapping (Developer Reference)

This is a simplified technical map of the current flow.

| UI / Input label | Internal key / shape | Source section | Used by | Required today | Source type |
|---|---|---|---|---|---|
| Client name | `name` | Create client | onboarding, DNA, JTA, calendar | Yes | Manual |
| Website | `websiteUrl` | Create client | onboarding, website extraction, DNA, JTA, calendar | Optional | Manual |
| Instagram handle (create) | `instagramHandle` | Create client | onboarding, Instagram fetch path | Optional | Manual |
| One-line summary | `oneLineDescription` | Create client | onboarding, DNA, JTA | Optional | Manual |
| Client industry | `industry` | SOW | DNA, JTA, calendar context | Recommended | Manual |
| Target audience | `targetAudience` | SOW | DNA, JTA, calendar | Recommended | Manual |
| Goals and requirements | `understandingOfRequirements` | SOW | DNA, JTA, calendar | Yes | Manual / pasted |
| Strategy and launch plan | `strategyLaunchPlanning` + legacy `scopeOfWork` | SOW | DNA, JTA, calendar | Yes | Manual / pasted |
| Content deliverables notes | `contentCreation` | SOW | DNA, JTA, calendar | Recommended | Manual / pasted |
| Deliverables summary | `deliverables[]` | SOW | JTA, calendar | Recommended | Manual |
| Active platforms | `platforms[]` | SOW / platform management | JTA, calendar | Yes | Manual |
| Monthly post volume | `monthlyPosts` | SOW / platform management | calendar contract | Yes | Manual |
| Tone by platform | `toneByPlatform` | SOW / platform management | JTA, calendar | Optional | Manual |
| Content buckets | `contentMix` | SOW / platform management | calendar contract | Yes | Manual |
| Instagram bio | `instagram.bio` | Instagram Context | DNA, JTA, calendar | Required if using structured Instagram block | Manual |
| Instagram offer | `instagram.offerSummary` | Instagram Context | DNA, JTA, calendar | Required if using structured Instagram block | Manual |
| Recent captions / themes | `instagram.recentCaptionSnippets[]` | Instagram Context | DNA, JTA, calendar | Required if using structured Instagram block | Manual |
| Recurring topics | `instagram.recurringTopics[]` | Instagram Context | DNA, JTA, calendar | Required if using structured Instagram block | Manual |
| Additional Instagram notes | `instagram.additionalInstagramNotes` | Instagram Context | DNA, JTA, calendar | Optional | Manual |
| Instagram CTA patterns | `instagram.ctaPatterns[]` | Instagram advanced | DNA, calendar | Optional | Manual |
| Instagram proof signals | `instagram.proofSignals[]` | Instagram advanced | DNA, JTA, calendar | Optional | Manual |
| Instagram follower count | `instagram.followerCount` | Instagram advanced | DNA | Optional | Manual |
| Instagram category | `instagram.category` | Instagram advanced | DNA, JTA | Optional | Manual |
| Instagram visual style | `instagram.visualStyleNotes` | Instagram advanced | DNA | Optional | Manual |
| Website summary | `WebsiteSummary` (`title`, `meta_description`, `main_text_excerpt`) | Internal extraction | DNA, JTA, calendar | Internal | Website extracted |
| Website messaging/trust/conversion | website signal synthesis | Internal extraction | DNA, JTA | Internal | Website extracted / inferred |
| Approved Business DNA | approved DNA artifact | Workflow | JTA, calendar | Yes after SOW approval | Generated + approved |
| Approved JTA | approved canonical strategy sections | Workflow | calendar | Yes before calendar | Generated + approved |
| Strategy type | `templateType` | Workspace | DNA/JTA/calendar framing | Yes for generation behavior | Manual/selected |
| Calendar month goal/notes | calendar generate request | Calendar | calendar only | Optional | Manual |

---

## Current Gaps / Missing or Unclear Fields

These are the main gaps I found in the current workflow:

1. **Website context is under-structured in the UI**
   - The tool mainly asks for a website URL, then relies on extraction/synthesis.

2. **Claim / proof constraints are not a first-class founder input section yet**
   - They are handled indirectly through Business DNA rules and proof detection.

3. **Launch dates / blackout dates / campaign windows are not a clear, dedicated founder-facing calendar input section today**
   - Some of this can be implied in notes, but it is not structured.

4. **The create-client Instagram field still allows “handle or notes”**
   - This is convenient for testing, but ambiguous as a long-term structured field.

5. **Website proof, FAQ, pricing, and product/service specifics are partly inferred rather than explicitly confirmed**
   - This is a good candidate for future structured brief standardization.

---

## Recommended Future Field Changes (Separate from Current Fields)

These are **recommendations**, not current required fields:

1. Add a dedicated **Website Context** manual section.
   - Homepage summary
   - key offers/services/products
   - CTA language
   - FAQs / objections
   - proof assets
   - pricing signals

2. Add a dedicated **Claim and Safety Notes** section.
   - claims allowed
   - claims to avoid
   - proof limitations
   - regulated/sensitive category restrictions

3. Add a dedicated **Calendar Planning Inputs** section.
   - monthly goal
   - launches
   - campaign dates
   - blackout dates
   - constraints
   - topics to lean into / avoid

4. Separate **Instagram handle** from **Instagram notes** at client creation.
   - This will make provenance and fetch behavior clearer.

5. Require more explicit proof labeling before using testimonial-style social proof.
   - especially important for product/wellness/service brands

---

## Final Summary

Today, the tool already has a strong staged workflow:

1. Create client
2. Fill and approve SOW
3. Generate and approve Business DNA
4. Generate and approve Jump-to-Action
5. Generate calendar from the approved strategic stack

The biggest strengths of the current flow are:

- clear approval gating
- platform and bucket contract enforcement
- richer Instagram context than a basic form
- explicit Business DNA and JTA review stages

The biggest gaps before import/upload are:

- website context is still too implicit
- proof/safety constraints need a more explicit human input format
- some calendar planning constraints are still hidden in notes rather than structured fields

That makes this a good moment to standardize a **fixed client structured brief format** before implementing import.
