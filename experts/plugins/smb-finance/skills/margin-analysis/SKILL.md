---
name: margin-analysis
description: "Product/service margin analysis with pricing recommendations. Calculate gross margin per line, diagnose problem items, model price increase scenarios. Triggers on: margin, profitability, pricing, gross profit, should we raise prices."
---

# Margin Analysis & Pricing Recommendations

## Overview

Analyze gross margin per product or service line, diagnose problem items, model price increase scenarios, and deliver actionable pricing and product-mix recommendations.

## Workflow

### Step 1: Inventory Revenue Lines

Collect from user:
- List of all products/services (SKU or line-item names)
- For each: revenue (last 3–6 months), COGS or direct cost, units sold
- Any bundled or tiered offerings (note the composition)

Build a revenue line inventory:

| Product/Service | Revenue | Direct Cost | Units | Avg Selling Price | Avg Unit Cost |
|----------------|---------|-------------|-------|-------------------|---------------|
| | | | | | |

### Step 2: Calculate Gross Margin per Line

For each line:

- **Gross Margin %** = (Revenue − Direct Cost) / Revenue × 100
- **Contribution Margin** = Revenue − Direct Cost (absolute dollars)
- **Margin Dollars per Unit** = (Revenue − Direct Cost) / Units

Sort by gross margin % ascending (worst first).

### Step 3: Flag Problem Lines

Diagnose each line against these thresholds:

| Flag | Condition | Implication |
|------|-----------|-------------|
| Negative Margin | Gross Margin % < 0% | Losing money on every sale — fix price or cut cost immediately |
| Thin Margin | Gross Margin % < 20% | Vulnerable to cost increases; minimal contribution to overhead |
| Revenue Illusion | Revenue in top 25% but margin < 15% | Looks important but contributes little profit — consider repricing or deprioritizing |
| Healthy | Gross Margin % ≥ 20% | Performing acceptably |
| Premium | Gross Margin % ≥ 50% | Strong performer — protect and promote |

### Step 4: Model Price Scenarios

For each problem line, model three price increase scenarios:

| Scenario | Price Increase | Assumptions |
|----------|---------------|-------------|
| Conservative | +5% | No volume loss assumed |
| Moderate | +10% | Assume 5% volume loss |
| Strategic | Reposition price | Based on competitive analysis or value-based pricing; assume 10–15% volume loss |

For each scenario, calculate:
- New gross margin %
- New contribution margin (with volume adjustment)
- Break-even: minimum units needed to match current contribution margin

### Step 5: Output Pricing Recommendations

Deliver:

1. **Margin ranking table** — All lines sorted by gross margin % with flags
2. **Problem line diagnosis** — One paragraph per flagged line explaining why it's underperforming and root cause (pricing too low, costs too high, wrong product-market fit)
3. **Price scenario models** — For each problem line, show the three scenarios with projected impact
4. **Recommendations** — Clear "do this next" for each line:
   - Raise price to ¥X (scenario Y) — expected margin improvement
   - Cut cost by negotiating X or switching supplier
   - Discontinue if margin cannot reach 15% within 2 quarters
   - Bundle with premium line to improve blended margin
5. **Product-mix suggestion** — If > 30% of revenue comes from lines with < 15% margin, recommend strategic shift toward higher-margin offerings

## Notes

- Include only direct/variable costs in gross margin; do not allocate overhead
- If user cannot provide per-unit COGS, use aggregate (Revenue − COGS) and flag as approximate
- For service businesses, direct cost = labor hours × hourly cost + any project-specific expenses
- Always note the time period the analysis covers (e.g., "based on Q1 2026 data")
