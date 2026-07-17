---
name: finance-ops
description: "AI-powered financial analysis suite. Generates executive CFO briefings from QuickBooks exports (P&L, Balance Sheet, General Ledger, Cash Flow, etc.) with anomaly detection, burn rate, runway analysis, and scenario modeling. Also estimates codebase development costs with organizational overhead and AI ROI analysis. Triggers on: 'CFO briefing', 'financial analysis', 'cost briefing', 'expense review', 'runway analysis', 'burn rate', 'cost estimate', 'how much would this cost to build', 'development cost', 'Claude ROI'."
description_zh: "AI CFO 助手，财务简报、成本分析与场景建模"
description_en: "AI CFO assistant for financial briefings, cost analysis, and scenario modeling"
version: 1.0.0
homepage: https://github.com/ericosiu/ai-marketing-skills
---


## Preamble (runs on skill start)

```bash
# Version check (silent if up to date)
python3 telemetry/version_check.py 2>/dev/null || true

# Telemetry opt-in (first run only, then remembers your choice)
python3 telemetry/telemetry_init.py 2>/dev/null || true
```

> **Privacy:** This skill logs usage locally to `~/.ai-marketing-skills/analytics/`. Remote telemetry is opt-in only. No code, file paths, or repo content is ever collected. See `telemetry/README.md`.

---

# AI Finance Ops

Two tools: CFO Briefing Generator and Codebase Cost Estimator.

---

## Tool 1: CFO Briefing Generator

Generate executive financial summaries from QuickBooks exports.

### Workflow

#### 1. Ingest Files

Place QuickBooks export files (CSV, XLSX, XLS) in a working directory. Accepted report types (any subset works — P&L alone is sufficient):

- **P&L Summary** — Revenue, COGS, expenses, net income (MOST IMPORTANT)
- **P&L by Customer** — Revenue breakdown by client
- **P&L Detail** — Transaction-level detail (XLSX)
- **Balance Sheet** — Assets, liabilities, equity
- **General Ledger** — All account transactions
- **Expenses by Vendor** — Vendor-level expense breakdown
- **Transaction List by Vendor** — Detailed vendor transactions
- **Bill Payments** — AP payment history
- **Cash Flow Statement** — Operating/investing/financing flows (XLSX)
- **Account List** — Chart of accounts

#### 2. Run Analysis

```bash
python3 scripts/cfo-analyzer.py --input ./data/uploads/ [--period YYYY-MM]
```

Options:
- `--input DIR` — Directory with QB exports
- `--period YYYY-MM` — Override period label (default: auto-detected from files)
- `--history DIR` — History directory for MoM comparison (default: `./data/history/`)
- `--no-history` — Skip saving to history

The script:
1. Auto-detects file types by scanning headers
2. Parses each file into structured data
3. Computes all KPIs (see `references/metrics-guide.md` for definitions and healthy ranges)
4. Loads prior period from history for MoM comparison
5. Saves current period to history
6. Outputs formatted executive summary to stdout

#### 3. Scenario Modeling (Optional)

After running the CFO analysis, model base/bull/bear scenarios:

```bash
python3 scripts/scenario-modeler.py --input ./data/financial-latest.json
```

This generates 12-month projections for:
- **Base case** — current trajectory continues
- **Bull case** — growth targets met (new product revenue + new clients)
- **Bear case** — lose top clients

#### 4. Deliver Summary

The script outputs a formatted briefing with emoji status indicators (🟢🟡🔴), suitable for Slack, email, or any messaging surface.

### File Format Details

See `references/quickbooks-formats.md` for expected CSV/XLSX column formats and detection heuristics.

### Metric Thresholds

See `references/metrics-guide.md` for healthy ranges, red/yellow/green thresholds, and benchmark context. Adjust thresholds for your business size and type.

---

## Tool 2: Codebase Cost Estimator

Estimate full development cost of a codebase.

### Workflow

#### Step 1: Analyze the Codebase

Read the entire codebase. Catalog total lines of code by language/type, architectural complexity, advanced features, testing coverage, and documentation quality.

#### Step 2: Calculate Development Hours

Apply productivity rates from `references/rates.md`. Calculate base hours per code type, then apply overhead multipliers for architecture, debugging, review, docs, integration, and learning curve.

#### Step 3: Research Market Rates

Use web search to find current hourly rates for the relevant specializations. Build a rate table with low / median / high for the project's tech stack.

#### Step 4: Calculate Organizational Overhead

Convert raw dev hours to calendar time using efficiency factors from `references/org-overhead.md`. Show estimates across company types (Solo through Enterprise).

#### Step 5: Calculate Full Team Cost

Apply supporting role ratios and team multipliers from `references/team-cost.md`. Show role-by-role breakdown, plus summary across all company stages.

#### Step 6: Generate Cost Estimate

Output the full estimate using the template in `references/output-template.md`. Include all sections: codebase metrics, dev hours, calendar time, market rates, engineering cost, full team cost, grand total summary, and assumptions.

#### Step 7: AI ROI Analysis (Optional)

If the codebase was built with AI assistance, calculate value per AI hour using `references/claude-roi.md`. Determine active hours via git history clustering, calculate speed multiplier vs human developer, and compute cost savings and ROI.

### Key Principles

- Present professionally, suitable for stakeholders
- Include confidence level (low/medium/high) and key assumptions
- Highlight highest-complexity areas that drive cost
- Always show ranges (low/avg/high), never a single number
- Search for CURRENT year market rates, don't use stale data
