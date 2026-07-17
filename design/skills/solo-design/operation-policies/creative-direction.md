# Creative Direction (Main Agent — Create, Variant & Redesign Direction)

> **When to read**: Read when routing to `create-project.md` or `generate-variants.md`; read in `redesign-ui.md` only when the redesign direction is unclear. Not needed for edit-project or customize-theme flows.

---

## Design Thinking Framework (Pre-Dispatch Decision)

Before routing to any generation workflow, the Main Agent must internally resolve these four questions to establish creative direction. This takes < 30 seconds of reasoning and prevents the "generic template" outcome:

| Phase | Question | Output |
|-------|----------|--------|
| **Purpose** | What problem does this interface solve? Who uses it daily? | User persona + core task |
| **Tone** | What is the emotional direction? Pick ONE clear extreme rather than "clean and modern" (which is meaningless) | One of: brutally minimal, maximalist dense, luxury/refined, brutalist/raw, organic/soft, retro-futuristic, editorial/magazine, playful/toy-like, industrial/utilitarian, warm/human |
| **Constraints** | Device type, brand CSS limitations, Library restrictions, performance budget | Technical boundary conditions |
| **Differentiation** | "What will someone remember about this page tomorrow?" | The `soulElement` hint for Sub-Agents |

**[IMPORTANT]** The Tone decision feeds directly into brand CSS generation (colors, typography choices, spacing density). A "luxury/refined" tone produces different brand CSS than "industrial/utilitarian" even for the same content requirements. Resolve Tone **before** generating brand CSS.

---

## Design Read Contract (Compact Execution Brief)

Before dispatching page generation, variant generation, or an unclear redesign, the Main Agent must compress the design judgment into one internal `designRead` sentence. This is not user-facing output; it is stored in `orchestration-summary.json.project.designRead` and passed to Sub-Agents as execution context.

Format:

```text
Design Read: {pageKind} / {audience} / {businessTone} / {density} / {visualRiskToAvoid}
```

Example:

```text
Design Read: B2B SaaS landing / technical buyers / calm enterprise trust / medium-low density / avoid purple neon AI hero
```

Rules:
- Keep `designRead` under 160 characters.
- Derive it from the user's brief, Design Library, reference material, and page plan; do not invent a new style direction that conflicts with those inputs.
- In Library-bound mode, `designRead` summarizes the Library-aligned interpretation; it does not override Library specs.
- If user intent is explicit, mirror it directly instead of asking another question.

### Design Dials (1-5)

The Main Agent also derives three compact numeric dials for `orchestration-summary.json.project.designDials`. These dials tune execution intensity; they never override Design Library, token, responsiveness, accessibility, or validation constraints.

| Scenario | `layoutVariance` | `motionIntensity` | `visualDensity` |
| --- | --- | --- | --- |
| Government / medical / finance / compliance | 1-2 | 1 | 3-4 |
| B2B SaaS / tools / developer products | 2-3 | 2 | 3 |
| Brand site / product launch / consumer goods | 3-4 | 2-3 | 2-3 |
| Portfolio / event / editorial publishing | 4-5 | 3 | 2 |
| Dashboard / operations / data screen | 1-2 | 1 | 4-5 |

Interpretation:
- `layoutVariance`: 1 = conservative system layout, 5 = strongly asymmetric/editorial.
- `motionIntensity`: 1 = minimal feedback only, 5 = rich motion. Current maximum recommended default is 3 unless the user explicitly asks for expressive motion.
- `visualDensity`: 1 = airy storytelling, 5 = high-density data/operations surface.

---

## Soul Injection Mandate (80/20 Rule)

Before routing to any generation workflow, the Main Agent must ensure the design will have **soul** — not just technical correctness. Apply the 80/20 formula:

**80% proven patterns + 20% unique decisions.** The 20% must be deliberately planned, not left to chance.

When dispatching Sub-Agent tasks, include a `soulElement` hint — one specific creative direction for each page:

| Soul Element Type | Example Direction | When to Use |
|-------------------|-------------------|-------------|
| **Bold visual decision** | "Hero uses an asymmetric 60/40 split instead of centered" | Showcase pages |
| **Product-specific copy** | "CTA says 'Start your first brew' not 'Get started'" | All pages with CTAs |
| **Memorable micro-interaction** | "Pricing card lifts 2px on hover with subtle shadow growth" | Pages with interactive cards |
| **Insider detail** | "Dashboard shows 'Last synced 3m ago' — implies real-time data pipeline" | Data/product pages |

**Self-check at dispatch time**: every page dispatch must carry a concrete `soulElement` hint, and the Sub-Agent completion JSON must return non-empty `designIntentEvidence` (per `page-generation-quality-gate.md`) showing how the page-specific intent landed. If no product-specific element can be named for a page — add a soul element before dispatching.

**[NOTE]** Soul elements must not conflict with brand CSS constraints or Library patterns. They operate within the design system, not around it.

---

## Anti-Convergence Mandate

> "You tend to converge toward generic, 'on distribution' outputs. In design, this creates what users call the 'AI slop' aesthetic."

AI models have a strong tendency to converge on the same "safe" choices across generations. This produces pages that are technically correct but indistinguishable from each other. The Anti-Convergence Mandate actively fights this:

**Rules for the Main Agent:**

1. **No intra-session repetition**: Within the same project/session, do not reuse the same display font pairing or the same hero composition across consecutive style proposals; record chosen fonts in `styleContinuityAnchors` so later pages inherit rather than re-pick.
2. **Vary layout structures**: When generating multiple style proposals or variants in one session, do not give every proposal a centered-hero layout — at least one SHOULD try asymmetric/split/editorial (unless user explicitly requests centered)
3. **Rotate color temperature**: Don't default to cool-toned (blue/purple) palettes every time. Warm tones (amber, terracotta, forest green) are equally valid for professional products
4. **Challenge the "safe" instinct**: When the first impulse is "white background, subtle gray cards, blue accent" — that's the convergence signal. Derive a SPECIFIC alternative from the Design Thinking Framework Tone phase, and record the deviation rationale in `designRead` so `designIntentEvidence` can reference it.

**Rules for Sub-Agents (passed via dispatch context):**

- When brand CSS allows font choice freedom: never use the same display font as the previous page in the same project
- Vary section layouts within a single multi-page project — pages should feel cohesive (same system) but not identical (same template)

**[FORBIDDEN]** "Clean and modern" as a complete aesthetic direction. It means nothing — every AI output is "clean and modern." Require a SPECIFIC direction from the Design Thinking Framework's Tone phase.

---

## Style Option Generation Constraints

When presenting visual style options to the user via AskUserQuestion, the following rules must be followed:

**Default color principle: clean, elegant, restrained.**

[FORBIDDEN] The following style tendencies in default options:
- "Futuristic tech feel", "cyberpunk", "space feel" and other futuristic styles
- "Neon", "flowing light", "glow", "halo" and other light-effect styles
- "Dark interface + neon glow" and similar combined descriptions
- Any option with dark background + high-saturation gradients as core feature

The above styles may only be offered when the **user actively requests** them (e.g., explicitly says "I want a tech feel", "I want cyberpunk style"). By default, these options produce cheap, tacky results.

[Core Principle] Style options must be derived from user requirements; using a fixed preset list is forbidden.

### Dynamic Style Option Generation Rules

**Every style inquiry's options must be derived on-the-spot from the current user's requirements**; maintaining or reusing any "default option list" is forbidden. Different users and different scenarios must produce completely different options.

**Derivation Process**:
1. **Extract contextual clues**: Identify key constraints from all information the user has provided — industry type, target audience, brand tone, product form, preference keywords explicitly mentioned by the user
2. **Scenario reasoning**: Based on the above clues, infer 2~4 differentiated style directions most reasonable for the scenario. Each direction should have clearly distinguishable differences in color tone, density, and character so the user can immediately tell them apart
3. **Concrete descriptions**: Each option must include specific color tone tendencies and visual characteristic descriptions that let the user imagine what the page roughly looks like, rather than abstract adjective stacking (such as the vague expression "modern minimalist")
4. **Mark recommendation**: Mark the option with the highest relevance to user requirements as the recommended first choice
5. **Comply with forbidden rules**: All derived results must still comply with the forbidden rules above (must not recommend neon/tech/cyberpunk styles by default)

**Handling insufficient information**: If user requirements are extremely vague (e.g., only says "make me a website"), do not fall back to a generic option list. Instead, first ask one critical business question (e.g., "What type of business is this website for?"), obtain minimum scenario information, then derive style options.

Option descriptions must not use suggestive phrasing like "leans toward intelligent assistant product character" or "leans toward AI application", to avoid guiding users toward neon/tech styles.

### AskUserQuestion Language Rule

AskUserQuestion output language rules are defined only in `operation-policies/user-facing-language.md` §AskUserQuestion Output Language (SSOT) — all fields must match the user's query language; do not redefine here.

---

## Competitor / Reference Analysis Framework

> **When to apply**: The user mentions competitors, reference products, "参考 XX"、"类似 XX 的风格" or provides competitor screenshots/URLs as style inspiration (not for reconstruction).

When user references a competitor or existing product as **style inspiration** (not reconstruction target):

### Step 1 — Extract Visual DNA (not copy)

Analyze the reference for these dimensions only:

| Dimension | What to Extract | What NOT to Copy |
|-----------|----------------|------------------|
| Color temperature | Warm/cool/neutral tone family | Exact hex values |
| Density profile | Spacious/balanced/compact | Exact spacing values |
| Typography character | Geometric/humanist/serif/mono | Exact font names |
| Layout philosophy | Card-based/editorial/dashboard/kanban | Exact grid numbers |
| Signature element | One distinctive visual trait | Implementation details |

### Step 2 — Diverge from Reference

After extracting Visual DNA, the Main Agent MUST ensure the output is **inspired by** but **distinct from** the reference:

1. Keep ≤ 2 dimensions similar to reference
2. Actively diverge on ≥ 2 other dimensions
3. Add 1 unique soul element that the reference does NOT have

### Step 3 — Document as Style Direction

Output a 3-sentence style direction brief that:
- Names the reference for context ("Inspired by [X]'s spacious card layout")
- States 2 specific divergence decisions ("Using warmer tones and more organic shapes")
- Defines the unique differentiator ("Adding illustrated section dividers for brand personality")

This brief replaces the standard AskUserQuestion style inquiry — the user has already indicated direction via their reference.

**[FORBIDDEN]** Treating competitor reference as reconstruction target. If user intent is "make me something like X" → use this framework. If intent is "copy/recreate X exactly" → route to `reference-material-handling.md` Reconstruct+Extend flow instead.
