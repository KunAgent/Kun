# Output Library Structure

## Overview

The output of the Design Library Creator is a self-contained directory that serves as a complete design system reference. It includes CSS tokens, interactive previews, component documentation, and a functional UI kit.

## Required Output Directory Tree

```
<library-name>/
├── SKILL.md                       # ~25-50 lines skill entry point
├── README.md                      # Rich brand narrative
├── colors_and_type.css            # SINGLE combined CSS token file
├── components.css                 # Aggregated component CSS (auto-extracted from preview HTML)
├── css.json                       # JSON format design tokens for programmatic consumption
├── uikit-plan.json                 # Optional evidence-backed component whitelist and screen blueprint (Figma bundle route)
├── library-consumption.json        # Recommended downstream read order for agents
├── assets/
│   ├── icons/
│   │   └── *.svg                  # Copied from input bundle (pre-exported SVG icons)
│   └── previews/
│       ├── index.json             # Optional document-level visual hint index
│       └── *.png                  # Optional .fig archive previews
├── ui_kits/<type>/                # One of: app | website | poster | dashboard
│   └── index.html                 # Interactive React app (self-contained)
├── preview/                       # Component preview HTML pages
│   └── component-{slug}.html      # One per shortlisted category from Phase 1
├── specs/                         # [OPTIONAL — user-maintained] Supplementary context
│   ├── *.md                       # Design guidelines, constraints, usage patterns
│   └── <subdirs>/                 # Categorized spec subdirectories
└── components/
    ├── index.json                  # Component index + crossComponentPatterns + summary
    ├── {slug}.json                 # Component contract JSON — primary source for downstream consumption
    ├── _evidence/                  # Optional raw Figma extraction archive, present only for Figma bundle route
    │   ├── index.json              # Compact evidence index (component families, semantic candidates, priority hints)
    │   └── {slug}.json             # Raw component extraction from Figma (<16KB each)
    └── ...
```

## System-Managed Files (NOT Part of Library Output)

| File | Purpose | Managed By |
|------|---------|------------|
| `metadata.json` | Library registration info (id, name, version) | Backend writes after server-side creation confirmed |

> ⛔ **HARD PROHIBITION — engineering-owned, write-once by backend**: Agent (Main or sub) MUST NEVER create, write, modify, or delete `metadata.json` — in ANY route (create / refine / expand / duplicate). It is produced EXCLUSIVELY by the engineering system after server-side registration. A missing `metadata.json` is NOT a defect to repair: do not "fix" it by generating one, do not add placeholder ids/names/versions, and never list it in `writtenFiles`. If it already exists, treat it as read-only opaque data.

> **Copy Rule**: When duplicating a Design Library directory to create a new one, `metadata.json` MUST be excluded. This file is written back by the engineering system after the new library is registered on the server. It is NOT intrinsic library content.

## Kit Type Selection Rules

| Product Domain | Kit Type | Rationale |
|---|---|---|
| Food delivery, social media, messaging, fitness | `app/` | Mobile-first interaction patterns |
| E-commerce, SaaS landing, corporate | `website/` | Desktop/responsive layouts |
| Event promotion, art, editorial | `poster/` | Visual composition focus |
| Admin panels, analytics, CRM | `dashboard/` | Data-dense information architecture |

When ambiguous, prefer `app/` for consumer products and `website/` for B2B products.

## FORBIDDEN Patterns

| ❌ FORBIDDEN | ✅ REQUIRED | Reason |
|---|---|---|
| `tokens/` directory with multiple CSS files | Single `colors_and_type.css` | Simplicity; one import for all tokens |
| `components/*.css` style files | A resolved `ComponentContractFile` | Components are documented as structured JSON, not styled separately |
| Reading full `components/{slug}.json` when evidence exists | Read only the resolved `ComponentContractFile` | Evidence-backed Figma libraries must not expand LLM context with full JSON |
| Generic Material 3 color names (`--md-primary`) | Actual brand color names (`--panda-orange-600`) | Brand identity must be explicit |
| English text for Chinese brand products | Match the product's actual language | Authenticity of content |
| Flat showcase grid layout | Interactive multi-screen app experience | Demonstrate real product context |
| Generating ALL files in one step | Incremental phased generation | Memory limits; quality per file |
| Lorem ipsum placeholder text | Real brand-appropriate content | Demonstrate actual usage |
| External CDN dependencies for tokens | Self-contained CSS file | Offline-capable, no network dependency |

> **Allowed CDN dependencies** (UI Kit only, does not affect token self-containment):
> React 18 + ReactDOM + Babel Standalone. NO external icon libraries (lucide-react, heroicons, etc.) — use exported SVGs + inline `<symbol>` instead.

## Generation Dependencies

The canonical phase numbering lives ONLY in `workflows/create-library.md`. This file defines dependencies, not phase numbers:

1. `colors_and_type.css` is the foundation token file.
2. `preview/` pages depend on `colors_and_type.css`.
3. `components.css` depends on `preview/*.html` — auto-extracted by `extract-components-css.mjs` after all preview pages are generated.
4. `components/_evidence/index.json` + `components/_evidence/{slug}.json` files are copied from the bundle in Phase 2b when available and serve as the raw evidence archive.
4. `components/{slug}.json` files are the primary component contract for all routes — synthesized intent (Figma Phase 3 merged synthesis) or compact schema (non-Figma). When only `_evidence/` exists (pre-intent libraries), sub-agents read evidence directly.
5. `css.json` is the structured JSON token representation. In `create-library` it is generated from the final CSS via `css-to-json.mjs`.
6. `uikit-plan.json` constrains component preview selection and UI Kit component usage when the route produces it. Other routes use compact component JSON directly.
7. `ui_kits/<type>/` depends on css.json, completed docs, preview pages, optional intent JSON, and `_evidence/` fallback when preview pages are insufficient.
8. `library-consumption.json`, `SKILL.md`, and `README.md` are generated last because they reference the complete file index.

ComponentContractKind values:

- `intent-json`: `components/{slug}.json` from create-library Phase 3 merged synthesis; synthesized component intent and variants/states auxiliary for UIKit.
- `compact-json`: `components/{slug}.json` from non-Figma compact routes.
- `legacy-json`: `components/{slug}.json` from older libraries without compact schema.
- `evidence`: `components/_evidence/{slug}.json`, used only when preview is missing or insufficient.

## Component Contract Resolution

Generation sub-agents resolve one `ComponentContractFile` plus one `ComponentContractKind` per planned component. UIKit still uses preview HTML as the first source for DOM/CSS fidelity; component contracts provide intent, variants, states, or evidence fallback only.

| Condition | ComponentContractFile | ComponentContractKind | Format |
|---|---|---|---|
| `components/{slug}.json` from create-library Phase 3 merged synthesis exists | `components/{slug}.json` | `intent-json` | synthesized component intent; variants/states auxiliary for UIKit |
| `components/{slug}.json` from non-Figma routes exists | `components/{slug}.json` | `compact-json` or `legacy-json` | compact component contract |
| Preview is missing/insufficient and `components/_evidence/{slug}.json` exists | `components/_evidence/{slug}.json` | `evidence` | raw Figma evidence fallback |

`uikit-plan.json` constrains component whitelist and screen blueprint only; it is never a styling source. When UIKit falls back to `components/_evidence/{slug}.json`, it must keep the rendered structure within evidence anatomy/traits and return `rendered-from-evidence:{slug}`.

When `ComponentContractKind` is `intent-json`, sub-agents apply Intent-Mode rendering rules. When it is `compact-json` or `legacy-json`, sub-agents use the compact contract as primary component data. When it is `evidence`, sub-agents apply Evidence Traits Fidelity rules.

## Non-Figma Compact Component JSON

Routes that generate component data directly (`create-from-scratch`, `create-from-structured-spec`, and non-bundle incremental inference) MUST write compact schema v2 `components/{slug}.json` instead of verbose full JSON.

Required fields:

- `schemaVersion: 2`
- `slug`, `name`, `category`
- `sourceKind`: `from-scratch` | `structured-spec` | `legacy-inferred`
- `confidence`: `medium` | `low`
- `semanticTypeCandidates`: 1-3 candidates with evidence
- `variantDimensions`: compact dimensions, not full cartesian combinations
- `coverageMatrix`, `sizeDeltas`, `stateCoverage`: machine-readable Figma evidence for axis coverage, size specs, and same-base state deltas
- `representativeVariants`: 2-4 debug/sample variants with `whySelected`, `traits`, and `childrenDigest`; do not use as the primary source for size/state fidelity when coverage fields exist
- `anatomy`, `structurePatterns`, `usageHints`, `doNotInvent`, `unknowns`

Size budget:

- Target ≤8KB per component file
- Hard cap 12KB
- If the file is too large, remove low-value variants and long prose before removing source uncertainty fields

## User-Maintained Directories

| Directory | Generated by Creator | Deletable during Refine/Expand |
|-----------|---------------------|-------------------------------|
| `specs/`  | ❌ Never             | ❌ Never delete               |

> `specs/` is a user-uploaded context directory. The Design Library Creator MUST NOT autonomously generate or delete any content within `specs/`. However, if the user explicitly requests modifications to specs content (e.g., "update my spacing guidelines"), the Agent MAY edit existing files within `specs/`. Deletion of `specs/` or any of its files is NEVER permitted.
