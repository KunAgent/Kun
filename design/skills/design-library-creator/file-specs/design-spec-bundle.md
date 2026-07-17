# Input Bundle Structure Reference

## Overview

A **DesignSpecBundle** is a multi-file bundle (Markdown + SVG + binary assets), NOT a single JSON blob. It is extracted from Figma and organized into a directory structure optimized for incremental reading by AI agents.

## Directory Tree

A typical bundle follows this structure:

```
<library-name>.design-spec/
├── METADATA.md                       # Start here: stats, navigation, quick brand context
├── README.md                         # Explorer guide and actual bundle tree
├── tokens/
│   ├── variables-index.md            # Master index of variables, modes, and navigation hints
│   ├── colors-full*.md               # ALL color variables by set/mode (primary color data source)
│   ├── typography*.md                # Font families + type scale + raw styles
│   ├── spacing.md                    # Radius + spacing + float variables
│   ├── shadows*.md                   # Shadow tokens, when present
│   └── grids.md                      # Grid definitions, when present
├── components/
├── assets/
│   ├── icons/index.md                # Icon inventory
│   ├── icons/<prefix-slug>.md        # Icon names by prefix group; may paginate
│   ├── icons/*.svg                    # Reconstructed SVG files, when vector paths exist
│   ├── images*.md                    # Embedded image catalog; binaries optional
│   └── fonts.md                      # Font family list and usage details
├── pages/
│   ├── index.md                      # Page/frame inventory
│   └── primitives*.md                # All primitives with page assignment; may paginate
├── annotations/
│   ├── index.md                      # Annotation summary
│   ├── ui-copies*.md                 # All UI text/copy extracted; may paginate
│   ├── by-component*.md              # Notes grouped by component, when present
│   └── by-page*.md                   # Notes grouped by page, when present
├── context/
│   ├── import-context.md             # Library name, source file, selected frames
│   ├── selected-frames-full.md       # Full selected frame list, when needed
│   ├── data-integrity.md             # Warnings about missing/incomplete data
│   ├── summary.md                    # Design system summary
│   ├── brand-clues.md                # Brand/product inference data
│   ├── component-page-matrix.md      # Page → component reverse mapping
│   ├── design-system-type.md         # Structural analysis
│   ├── variable-aliases.md           # Token hierarchy and alias chains, when present
│   └── variables-raw*.md             # Raw Figma variables, when present
└── generated/                            # Machine-generated structured data (JSONL format)
    ├── bundle-manifest.jsonl              # Aggregated index: stats, shortlist, file manifest (START HERE)
    ├── design-tokens.jsonl                # Core token data: colors, typography, spacing, radius, shadows
    ├── brand-input.jsonl                  # Brand analysis input: UI copies, color signals, font usage
    ├── annotations-summary.jsonl          # Designer notes and UI copy summary
    ├── uikit-planning-input.jsonl         # Component candidates for UIKit planning
    └── components/
        ├── index.jsonl                    # Component category index with variant counts
        └── <slug>.jsonl                   # Per-category evidence/render contract data
```

## JSONL Format Convention

All `generated/*.jsonl` files use a self-describing line-based format:

- **Line 0 (meta)**: `{"_type":"meta", "format":"<name>/v1", "lines":[...]}` — describes file contents with actual data values. Read this FIRST to understand what each line contains without loading the full file.
- **Line 1+**: Each line is a self-contained JSON object with `_type` field identifying its role.
- **Selective reading**: Use meta line descriptions to determine which lines contain relevant data, then read only those lines (by offset/limit).
- **Example**: A component evidence file's meta line lists each variant by name and size, allowing the agent to target specific variants without loading all structural data.

### Reading Strategy for JSONL

1. **Read line 0 (meta)** — understand structure and content overview
2. **Decide what you need** — meta descriptions include counts, names, and key values
3. **Read specific lines** — use offset/limit to read only the lines you need
4. **Each line is independent** — parse one line at a time, no cross-line dependencies

## Pagination Rules

- **Maximum file size**: 16 KB per file
- When content exceeds 16 KB, it is split with a `-part1.md`, `-part2.md` suffix pattern
- Example: `colors-full-part1.md`, `colors-full-part2.md`, `buttons-part1.md`
- The index file for each directory always references all parts

## Reading Strategy

Follow a progressive disclosure approach:

1. **Overview** — Read `METADATA.md` + `README.md` + `context/import-context.md` + `context/data-integrity.md` first
2. **Detail** — Read relevant index files such as `tokens/variables-index.md` and `pages/index.md`
3. **Deep-dive** — Read assigned token/component/page/annotation files only as needed

### Critical Rules

- **NEVER** load the entire bundle into memory at once. Read files incrementally.
- **`selectedFrameNames`** in METADATA are focus hints indicating which frames the user cares about most. They are NOT destructive filters — other data in the bundle is still valid and usable.
- **If `data-integrity.md` reports warnings**, acknowledge the gaps explicitly in your output. Never fabricate data to fill missing information.
- Start with context files to understand the brand before diving into tokens or components.
- Cross-reference `annotations/ui-copies.md` when generating realistic content for previews.
