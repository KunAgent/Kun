---
name: check-deck
description: |
  Investment banking presentation quality checker. Reviews pitch decks and client-ready
  presentations for: (1) Number consistency across slides, (2) Data-narrative alignment,
  (3) Language polish for IB standards, (4) Formatting QC. Use when asked to review,
  check, or QC any IB presentation, pitch deck, or client materials before delivery.
---

# IB Deck Checker

Perform comprehensive QC on investment banking presentations across four dimensions.

## Prerequisites

Extract presentation content before checking:
```bash
python -m markitdown presentation.pptx > content.md
```

For visual inspection, convert to images using the `pptx` skill workflow.

## Check Workflow

### 1. Number Consistency

Extract numbers with slide references:
```bash
python scripts/extract_numbers.py content.md --check
```

Verify:
- Key metrics match across all slides (revenue, EBITDA, multiples)
- Calculations are correct (totals, percentages, growth rates)
- Units consistent (same scale used: millions vs billions, % vs bps)
- Unit formatting consistent (e.g., $M vs $MM, $B vs $Bn - pick one style throughout)
- Time periods aligned (FY vs LTM vs quarterly)

Flag pattern:
```
ISSUE: Revenue mismatch
- $500M on Slides 3, 8
- $485M on Slide 15 (DCF input)
ACTION: Reconcile figures
```

### 2. Data-Narrative Alignment

Map claims to supporting data:
- Trend statements → chart directions
- Market position claims → revenue/share data
- Factual assertions → verify accuracy

Flag contradictions:
```
ISSUE: Narrative contradicts data
- Slide 4: "declining margins"
- Slide 7 chart: margins 18% → 22%
ACTION: Update narrative or verify data
```

Check plausibility (e.g., "#1 player in $100B market" with $200M revenue = 0.2% share).

### 3. Language Polish

Scan for:
- Casual phrasing ("pretty good", "a lot of")
- Vague quantifiers without specifics
- Contractions, exclamation points
- Inconsistent terminology

See [references/ib-terminology.md](references/ib-terminology.md) for replacement patterns.

Flag pattern:
```
ISSUE: Casual language (Slide 12)
- "This deal is a no-brainer"
→ "The transaction presents a compelling value proposition"
```

### 4. Formatting QC

Audit each slide for:
- **Charts**: Source citations, axis labels, legends
- **Typography**: Consistent fonts, size hierarchy
- **Numbers**: Consistent formatting (1,000 vs 1K)
- **Dates**: Consistent format throughout
- **Footnotes**: Proper sourcing and disclaimers

## Output

Present findings using the template in [references/report-format.md](references/report-format.md).

Categorize by severity:
- **Critical**: Number mismatches, factual errors
- **Important**: Language, narrative alignment
- **Minor**: Formatting inconsistencies
