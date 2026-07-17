---
name: product-management-workflows
description: Complete product management workflows including feature specs, roadmap management, stakeholder updates, user research synthesis, competitive analysis, and metrics review
---

# Product Management Workflows

This skill provides comprehensive product management capabilities across the full PM workflow. Use these workflows to write specs, plan roadmaps, communicate with stakeholders, synthesize research, analyze competitors, and review metrics.

## Available Workflows

### 1. Write Feature Spec / PRD

Write a feature specification or product requirements document (PRD).

#### When to Use
- Speccing out a new feature or product
- Creating a PRD from a problem statement
- Documenting requirements for a feature idea
- Need structured requirements for engineering

#### Workflow

**Step 1: Understand the Feature**

Ask the user what they want to spec. Accept any of:
- A feature name ("SSO support")
- A problem statement ("Enterprise customers keep asking for centralized auth")
- A user request ("Users want to export their data as CSV")
- A vague idea ("We should do something about onboarding drop-off")

**Step 2: Gather Context**

Ask the user for the following. Be conversational — do not dump all questions at once. Ask the most important ones first and fill in gaps as you go:

- **User problem**: What problem does this solve? Who experiences it?
- **Target users**: Which user segment(s) does this serve?
- **Success metrics**: How will we know this worked?
- **Constraints**: Technical constraints, timeline, regulatory requirements, dependencies
- **Prior art**: Has this been attempted before? Are there existing solutions?

User can provide context through:
- Pasted text or descriptions
- Uploaded files (existing docs, research)
- Screenshots or mockups
- Links to related work

**Step 3: Generate the PRD**

Produce a structured PRD with these sections. See the **feature-spec** skill for detailed guidance on user stories, requirements categorization, acceptance criteria, and success metrics.

- **Problem Statement**: The user problem, who is affected, and impact of not solving it (2-3 sentences)
- **Goals**: 3-5 specific, measurable outcomes tied to user or business metrics
- **Non-Goals**: 3-5 things explicitly out of scope, with brief rationale for each
- **User Stories**: Standard format ("As a [user type], I want [capability] so that [benefit]"), grouped by persona
- **Requirements**: Categorized as Must-Have (P0), Nice-to-Have (P1), and Future Considerations (P2), each with acceptance criteria
- **Success Metrics**: Leading indicators (change quickly) and lagging indicators (change over time), with specific targets
- **Open Questions**: Unresolved questions tagged with who needs to answer (engineering, design, legal, data)
- **Timeline Considerations**: Hard deadlines, dependencies, and phasing

**Step 4: Review and Iterate**

After generating the PRD:
- Ask the user if any sections need adjustment
- Offer to expand on specific sections
- Offer to create follow-up artifacts (design brief, engineering ticket breakdown, stakeholder pitch)

**Output Format**: Use markdown with clear headers. Keep the document scannable — busy stakeholders should be able to read just the headers and bold text to get the gist.

**Tips**:
- Be opinionated about scope. It is better to have a tight, well-defined spec than an expansive vague one.
- If the user's idea is too big for one spec, suggest breaking it into phases and spec the first phase.
- Success metrics should be specific and measurable, not vague ("improve user experience").
- Non-goals are as important as goals. They prevent scope creep during implementation.
- Open questions should be genuinely open — do not include questions you can answer from context.

---

### 2. Roadmap Management

Update, create, or reprioritize a product roadmap.

#### When to Use
- Creating a new product roadmap
- Adding features to existing roadmap
- Reprioritizing roadmap items
- Updating status of roadmap items
- Adjusting timelines or dates
- Communicating roadmap changes

#### Workflow

**Step 1: Understand Current State**

Ask the user to describe their current roadmap or paste/upload it. Accept any format: list, table, spreadsheet, screenshot, or prose description.

**Step 2: Determine the Operation**

Ask what the user wants to do:

**Add item**: New feature, initiative, or work item to the roadmap
- Gather: name, description, priority, estimated effort, target timeframe, owner, dependencies
- Suggest where it fits based on current priorities and capacity

**Update status**: Change status of existing items
- Options: not started, in progress, at risk, blocked, completed, cut
- For "at risk" or "blocked": ask for the blocker and mitigation plan

**Reprioritize**: Change the order or priority of items
- Ask what changed (new information, strategy shift, resource change, customer feedback)
- Apply a prioritization framework if helpful — see the **roadmap-management** skill for RICE, MoSCoW, ICE, and value-vs-effort frameworks
- Show before/after comparison

**Move timeline**: Shift dates for items
- Ask why (scope change, dependency slip, resource constraint)
- Identify downstream impacts on dependent items
- Flag items that move past hard deadlines

**Create new roadmap**: Build a roadmap from scratch
- Ask about timeframe (quarter, half, year)
- Ask about format preference (Now/Next/Later, quarterly columns, OKR-aligned)
- Gather the list of initiatives to include

**Step 3: Generate Roadmap Summary**

Produce a roadmap view with:

**Status Overview**: Quick summary: X items in progress, Y completed this period, Z at risk.

**Roadmap Items**: For each item, show:
- Name and one-line description
- Status indicator (on track / at risk / blocked / completed / not started)
- Target timeframe or date
- Owner
- Key dependencies

Group items by:
- Timeframe (Now / Next / Later) or quarter, depending on format
- Or by theme/goal if the user prefers

**Risks and Dependencies**:
- Items that are blocked or at risk, with details
- Cross-team dependencies and their status
- Items approaching hard deadlines

**Changes This Update**: If this is an update to an existing roadmap, summarize what changed:
- Items added, removed, or reprioritized
- Timeline shifts
- Status changes

**Step 4: Follow Up**

After generating the roadmap:
- Offer to format for a specific audience (executive summary, engineering detail, customer-facing)
- Offer to draft communication about roadmap changes

**Output Format**: Use a clear, scannable format. Tables work well for roadmap items. Use text status labels: **Done**, **On Track**, **At Risk**, **Blocked**, **Not Started**.

**Tips**:
- A roadmap is a communication tool, not a project plan. Keep it at the right altitude — themes and outcomes, not tasks.
- When reprioritizing, always ask what changed. Priority shifts should be driven by new information, not whim.
- Flag capacity issues early. If the roadmap has more work than the team can handle, say so.
- Dependencies are the biggest risk to roadmaps. Surface them explicitly.
- If the user asks to add something, always ask what comes off or moves. Roadmaps are zero-sum against capacity.

---

### 3. Stakeholder Updates

Generate a stakeholder update tailored to audience and cadence.

#### When to Use
- Weekly team updates
- Monthly leadership updates
- Feature launch announcements
- Ad-hoc escalations or pivots
- Board or investor updates
- Cross-functional partner updates

#### Workflow

**Step 1: Determine Update Type**

Ask the user what kind of update:
- **Weekly**: Regular cadence update on progress, blockers, and next steps
- **Monthly**: Higher-level summary with trends, milestones, and strategic alignment
- **Launch**: Announcement of a feature or product launch with details and impact
- **Ad-hoc**: One-off update for a specific situation (escalation, pivot, major decision)

**Step 2: Determine Audience**

Ask who the update is for:
- **Executives / leadership**: High-level, outcome-focused, strategic framing, brief
- **Engineering team**: Technical detail, implementation context, blockers, decisions needed
- **Cross-functional partners**: Context-appropriate detail, focus on shared goals and dependencies
- **Customers / external**: Benefits-focused, clear timelines, no internal jargon
- **Board**: Metrics-driven, strategic, risk-focused, very concise

**Step 3: Gather Context**

Ask the user to provide:
- What was accomplished since the last update
- Current blockers or risks
- Key decisions made or needed
- What is coming next

User can provide through:
- Pasted status updates or notes
- Uploaded documents
- Verbal description
- Links to project tracking or docs

**Step 4: Generate the Update**

Structure the update for the target audience. See the **stakeholder-comms** skill for detailed templates, G/Y/R status definitions, and the ROAM risk communication framework.

**For executives**: TL;DR, status color (G/Y/R), key progress tied to goals, decisions made, risks with mitigation, specific asks, and next milestones. Keep it under 300 words.

**For engineering**: What shipped (with links), what is in progress (with owners), blockers, decisions needed (with options and recommendation), and what is coming next.

**For cross-functional partners**: What is coming that affects them, what you need from them (with deadlines), decisions that impact their team, and areas open for input.

**For customers**: What is new (framed as benefits), what is coming soon, known issues with workarounds, and how to provide feedback. No internal jargon.

**For launch announcements**: What launched, why it matters, key details (scope, availability, limitations), success metrics, rollout plan, and feedback channels.

**Step 5: Review and Deliver**

After generating the update:
- Ask if the user wants to adjust tone, detail level, or emphasis
- Offer to format for the delivery channel (email, chat post, doc, slides)

**Output Format**: Keep updates scannable. Use bold for key points, bullets for lists. Executive updates should be under 300 words. Engineering updates can be longer but should still be structured for skimming.

**Tips**:
- The most common mistake in stakeholder updates is burying the lead. Start with the most important thing.
- Status colors (Green/Yellow/Red) should reflect reality, not optimism. Yellow is not a failure — it is good risk communication.
- Asks should be specific and actionable. "We need help" is not an ask. "We need a decision on X by Friday" is.
- For executives, frame everything in terms of outcomes and goals, not activities and tasks.
- If there is bad news, lead with it. Do not hide it after good news.
- Match the length to the audience's attention. Executives get a few bullets. Engineering gets the details they need.

---

### 4. User Research Synthesis

Synthesize user research from multiple sources into structured insights and recommendations.

#### When to Use
- After conducting user interviews
- Analyzing survey responses
- Synthesizing support tickets or feedback
- Combining multiple research sources
- Need to identify themes and patterns
- Creating personas or user segments
- Identifying opportunity areas

#### Workflow

**Step 1: Gather Research Inputs**

Accept research from any combination of:
- **Pasted text**: Interview notes, transcripts, survey responses, feedback
- **Uploaded files**: Research documents, spreadsheets, recordings summaries

Ask the user what they have:
- What type of research? (interviews, surveys, usability tests, analytics, support tickets, sales call notes)
- How many sources / participants?
- Is there a specific question or hypothesis they are investigating?
- What decisions will this research inform?

**Step 2: Process the Research**

For each source, extract:
- **Key observations**: What did users say, do, or experience?
- **Quotes**: Verbatim quotes that illustrate important points
- **Behaviors**: What users actually did (vs what they said they do)
- **Pain points**: Frustrations, workarounds, and unmet needs
- **Positive signals**: What works well, moments of delight
- **Context**: User segment, use case, experience level

**Step 3: Identify Themes and Patterns**

Apply thematic analysis — see the **user-research-synthesis** skill for detailed methodology including affinity mapping and triangulation techniques.

Group observations into themes, count frequency across participants, and assess impact severity. Note contradictions and surprises.

Create a priority matrix:
- **High frequency + High impact**: Top priority findings
- **Low frequency + High impact**: Important for specific segments
- **High frequency + Low impact**: Quality-of-life improvements
- **Low frequency + Low impact**: Note but deprioritize

**Step 4: Generate the Synthesis**

Produce a structured research synthesis:

**Research Overview**:
- Methodology: what types of research, how many participants/sources
- Research question(s): what we set out to learn
- Timeframe: when the research was conducted

**Key Findings**: For each major finding (aim for 5-8):
- **Finding statement**: One clear sentence describing the insight
- **Evidence**: Supporting quotes, data points, or observations (with source attribution)
- **Frequency**: How many participants/sources support this finding
- **Impact**: How significantly this affects the user experience or business
- **Confidence level**: High (strong evidence), Medium (suggestive), Low (early signal)

Order findings by priority (frequency x impact).

**User Segments / Personas**: If the research reveals distinct user segments:
- Segment name and description
- Key characteristics and behaviors
- Unique needs and pain points
- Size estimate if data is available

**Opportunity Areas**: Based on the findings, identify opportunity areas:
- What user needs are unmet or underserved
- Where do current solutions fall short
- What new capabilities would unlock value
- Prioritized by potential impact

**Recommendations**: Specific, actionable recommendations:
- What to build, change, or investigate further
- Tied back to specific findings
- Prioritized by impact and feasibility

**Open Questions**: What the research did not answer:
- Gaps in understanding
- Areas needing further investigation
- Suggested follow-up research methods

**Step 5: Review and Extend**

After generating the synthesis:
- Ask if any findings need more detail or different framing
- Offer to generate specific artifacts: persona documents, opportunity maps, research presentations
- Offer to create follow-up research plans for open questions
- Offer to draft product implications (how findings should influence the roadmap)

**Output Format**: Use clear headers and structured formatting. Each finding should stand on its own — a reader should be able to read any single finding and understand it without reading the rest.

**Tips**:
- Let the data speak. Do not force findings into a predetermined narrative.
- Distinguish between what users say and what they do. Behavioral data is stronger than stated preferences.
- Quotes are powerful evidence. Include them generously, with attribution to participant type (not name).
- Be explicit about confidence levels. A finding from 2 interviews is a hypothesis, not a conclusion.
- Contradictions in the data are interesting, not inconvenient. They often reveal distinct user segments.
- Recommendations should be specific enough to act on. "Improve onboarding" is not actionable. "Add a progress indicator to the setup flow" is.
- Resist the temptation to synthesize too many themes. 5-8 strong findings are better than 20 weak ones.

---

### 5. Competitive Analysis

Create a competitive analysis brief for one or more competitors or a feature area.

#### When to Use
- Analyzing specific competitors
- Feature comparison across market
- Positioning and go-to-market analysis
- Sales enablement / battle cards
- Strategic planning
- Investor or board materials
- Identifying competitive opportunities

#### Workflow

**Step 1: Scope the Analysis**

Ask the user:
- **Competitor(s)**: Which specific competitor(s) to analyze? Or a feature area to compare across competitors?
- **Focus**: Full product comparison, specific feature area, pricing/packaging, go-to-market, or positioning?
- **Context**: What decision will this inform? (product strategy, sales enablement, investor/board materials, feature prioritization)

**Step 2: Research**

**Via web search**:
- Product pages and feature lists
- Pricing pages and packaging
- Recent product launches, blog posts, and changelogs
- Press coverage and analyst reports
- Customer reviews and ratings (G2, Capterra, TrustRadius)
- Job postings (signal of strategic direction)
- Social media and community discussions

User can also provide:
- Existing competitive documents
- Sales feedback or win/loss reports
- Customer feedback about competitors
- Screenshots or demos

**Step 3: Generate the Brief**

**Competitor Overview**: For each competitor:
- Company summary: founding, size, funding/revenue if public, target market
- Product positioning: how they describe themselves, who they target
- Recent momentum: launches, funding, partnerships, customer wins

**Feature Comparison**: Compare capabilities across key areas relevant to the analysis. See the **competitive-analysis** skill for rating frameworks and comparison matrix templates.

**Positioning Analysis**: Analyze how each competitor positions themselves — target customer, category claim, key differentiator, and value proposition. See the **competitive-analysis** skill for positioning analysis frameworks.

**Strengths and Weaknesses**: For each competitor:
- **Strengths**: Where they genuinely excel. What customers praise.
- **Weaknesses**: Where they fall short. What customers complain about.
- Be honest and evidence-based — do not dismiss competitors or inflate their weaknesses.

**Opportunities**: Based on the analysis:
- Where are there gaps in competitor offerings we could exploit?
- What are customers asking for that no one provides well?
- Where are competitors making bets we disagree with?
- What market shifts could advantage our approach?

**Threats**:
- Where are competitors investing heavily?
- What competitive moves could disrupt our position?
- Where are we most vulnerable?
- What would a "nightmare scenario" competitive move look like?

**Strategic Implications**: Tie the analysis back to product strategy:
- What should we build, accelerate, or deprioritize based on this analysis?
- Where should we differentiate vs. achieve parity?
- How should we adjust positioning or messaging?
- What should we monitor going forward?

**Step 4: Follow Up**

After generating the brief:
- Ask if the user wants to dive deeper on any section
- Offer to create a one-page summary for executives
- Offer to create sales battle cards for competitive deals
- Offer to draft a "how to win against [competitor]" guide
- Offer to set up a monitoring plan for competitive moves

**Output Format**: Use tables for feature comparisons. Use clear headers for each section. Keep the strategic implications section concise and actionable — this is where the value is for the reader.

**Tips**:
- Be honest about competitor strengths. Dismissing competitors makes the analysis useless.
- Focus on what matters to customers, not what matters to product teams. Customers do not care about architecture elegance.
- Pricing is hard to compare fairly. Note the caveats (different packaging, usage-based vs seat-based, enterprise custom pricing).
- Job postings are underrated competitive intelligence. A competitor hiring ML engineers signals a strategic direction.
- Customer reviews are gold. They reveal what real users love and hate, unfiltered by marketing.
- The most valuable part of competitive analysis is the "so what" — the strategic implications. Do not skip this.
- Competitive analysis has a shelf life. Note the date and flag areas that change quickly.

---

### 6. Metrics Review

Review and analyze product metrics, identify trends, and surface actionable insights.

#### When to Use
- Regular metrics reviews (weekly, monthly, quarterly)
- Analyzing product health
- Investigating metric trends
- Preparing for leadership or board reviews
- Post-launch analysis
- Identifying areas of concern

#### Workflow

**Step 1: Gather Metrics Data**

Ask the user to provide:
- The metrics and their values (paste a table, screenshot, or describe)
- Comparison data (previous period, targets)
- Any context on recent changes (launches, incidents, seasonality)

Ask the user:
- What time period to review? (last week, last month, last quarter)
- What metrics to focus on? Or should we review the full product metrics suite?
- Are there specific targets or goals to compare against?
- Any known events that might explain changes (launches, outages, marketing campaigns, seasonality)?

**Step 2: Organize the Metrics**

Structure the review using the metrics hierarchy from the **metrics-tracking** skill: North Star metric at the top, L1 health indicators (acquisition, activation, engagement, retention, revenue, satisfaction), and L2 diagnostic metrics for drill-down.

If the user has not defined their metrics hierarchy, help them identify their North Star and key L1 metrics before proceeding.

**Step 3: Analyze Trends**

For each key metric:
- **Current value**: What is the metric today?
- **Trend**: Up, down, or flat compared to previous period? Over what timeframe?
- **vs Target**: How does it compare to the goal or target?
- **Rate of change**: Is the trend accelerating or decelerating?
- **Anomalies**: Any sudden changes, spikes, or drops?

Identify correlations:
- Do changes in one metric correlate with changes in another?
- Are there leading indicators that predict lagging metric changes?
- Do segment breakdowns reveal that an aggregate trend is driven by a specific cohort?

**Step 4: Generate the Review**

**Summary**: 2-3 sentences: overall product health, most notable changes, key callout.

**Metric Scorecard**: Table format for quick scanning:

| Metric | Current | Previous | Change | Target | Status |
|--------|---------|----------|--------|--------|--------|
| [Metric] | [Value] | [Value] | [+/- %] | [Target] | [On track / At risk / Miss] |

**Trend Analysis**: For each metric worth discussing:
- What happened and how significant is the change
- Why it likely happened (attribution based on known events, correlated metrics, segment analysis)
- Whether this is a one-time event or a sustained trend

**Bright Spots**: What is going well:
- Metrics beating targets
- Positive trends to sustain
- Segments or features showing strong performance

**Areas of Concern**: What needs attention:
- Metrics missing targets or trending negatively
- Early warning signals before they become problems
- Metrics where we lack visibility or understanding

**Recommended Actions**: Specific next steps based on the analysis:
- Investigations to run (dig deeper into a concerning trend)
- Experiments to launch (test hypotheses about what could improve a metric)
- Investments to make (double down on what is working)
- Alerts to set (monitor a metric more closely)

**Context and Caveats**:
- Known data quality issues
- Events that affect comparability (outages, holidays, launches)
- Metrics we should be tracking but are not yet

**Step 5: Follow Up**

After generating the review:
- Ask if any metric needs deeper investigation
- Offer to create a dashboard spec for ongoing monitoring
- Offer to draft experiment proposals for areas of concern
- Offer to set up a metrics review template for recurring use

**Output Format**: Use tables for the scorecard. Use clear status indicators. Keep the summary tight — the reader should get the essential story in 30 seconds.

**Tips**:
- Start with the "so what" — what is the most important thing in this metrics review? Lead with that.
- Absolute numbers without context are useless. Always show comparisons (vs previous period, vs target, vs benchmark).
- Be careful about attribution. Correlation is not causation. If a metric moved, acknowledge uncertainty about why.
- Segment analysis often reveals that an aggregate metric masks important differences. A flat overall number might hide one segment growing and another shrinking.
- Not all metric movements matter. Small fluctuations are noise. Focus attention on meaningful changes.
- If a metric is missing its target, do not just report the miss — recommend what to do about it.
- Metrics reviews should drive decisions. If the review does not lead to at least one action, it was not useful.

---

## General Usage Notes

- These workflows are designed to work without external tool connections. Users can provide context through pasted text, uploaded files, screenshots, or verbal descriptions.
- For Figma integration: If design context is available via Figma, pull mockups and design system components to enrich feature specs and roadmap items.
- Always be conversational and ask clarifying questions before generating artifacts.
- Tailor outputs to the audience and purpose — executives get concise summaries, engineering gets details.
- Follow up after generating artifacts to offer refinements, expansions, or related deliverables.

## Related Skills

For deeper expertise in specific areas, refer to these complementary skills:
- **feature-spec**: PRD structure, user stories, requirements categorization
- **roadmap-management**: Prioritization frameworks (RICE, MoSCoW), dependency mapping
- **stakeholder-comms**: Update templates, risk communication (ROAM), decision documentation
- **user-research-synthesis**: Thematic analysis, affinity mapping, persona development
- **competitive-analysis**: Feature comparison matrices, positioning frameworks, win/loss analysis
- **metrics-tracking**: Metrics hierarchy, OKR goal setting, dashboard design
