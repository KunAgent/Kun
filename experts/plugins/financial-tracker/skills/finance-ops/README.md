# AI Finance Ops

> Your AI CFO that finds hidden costs in 30 minutes.

Upload your QuickBooks exports. Get a full executive CFO briefing with anomaly detection, burn rate analysis, vendor concentration risk, and actionable recommendations. Or point it at a codebase and get a development cost estimate with organizational overhead modeling and AI ROI analysis.

## What's Inside

### CFO Briefing Generator
Drop in your QuickBooks exports (P&L, Balance Sheet, General Ledger, Expenses by Vendor, Cash Flow, etc.) and get:

- **Executive financial summary** with traffic-light status indicators (🟢🟡🔴)
- **Profitability analysis** — gross margin, net margin, operating income
- **People cost breakdown** — salaries vs contractors, payroll taxes, benefits
- **Tool & subscription audit** — find the SaaS bloat
- **Customer concentration risk** — flag dangerous client dependencies
- **Month-over-month comparison** — automatic trend detection
- **Anomaly alerts** — expenses that spike, new vendors with big spend, owner draws
- **Scenario modeling** — base/bull/bear case projections with monthly burns

### Codebase Cost Estimator
Point it at any codebase and get:

- **Development hours estimate** by code type and complexity
- **Market rate research** with current-year data
- **Organizational overhead modeling** — solo founder through enterprise
- **Full team cost** — PM, design, QA, DevOps, not just engineering
- **AI ROI analysis** — what did each hour of Claude produce in value?

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Copy env template
cp .env.example .env

# 3. Drop QuickBooks exports into a folder
mkdir -p data/uploads
# Copy your CSV/XLSX files there

# 4. Run CFO analysis
python scripts/cfo-analyzer.py --input data/uploads/

# 5. Or estimate a codebase
# Use the SKILL.md workflow with Claude Code
```

## Supported QuickBooks Reports

Any subset works — P&L alone is enough to start:

| Report | What It Adds |
|--------|-------------|
| P&L Summary | Revenue, COGS, expenses, net income (core) |
| P&L by Customer | Client concentration analysis |
| P&L Detail | Transaction-level drill-down |
| Balance Sheet | Assets, liabilities, equity position |
| Cash Flow Statement | Operating/investing/financing flows |
| General Ledger | Full account transaction history |
| Expenses by Vendor | Vendor-level spend breakdown |
| Transaction List by Vendor | Detailed vendor transactions |
| Bill Payments | AP payment history |
| Account List | Chart of accounts |

## How It Works

The CFO analyzer:
1. **Auto-detects** report types by scanning file headers
2. **Parses** QuickBooks CSV/XLSX formats (handles dollar signs, commas, negative formats)
3. **Computes KPIs** against benchmarks for your business size
4. **Compares** to prior periods if history exists
5. **Generates** a formatted executive briefing with status indicators

The scenario modeler:
1. **Reads** the latest financial analysis
2. **Models** base case (status quo), bull case (growth targets hit), and bear case (lose top clients)
3. **Projects** 12 months forward with monthly P&L
4. **Identifies** the fastest cost levers to pull

## Benchmark Thresholds

Built-in benchmarks for services businesses:

| Metric | 🟢 Healthy | 🟡 Watch | 🔴 Action Needed |
|--------|-----------|---------|-----------------|
| Gross Margin | >60% | 45-60% | <45% |
| Net Margin | >10% | 0-10% | Negative |
| People Costs (% rev) | <65% | 65-75% | >75% |
| Tool/Sub Costs (% rev) | <8% | 8-12% | >12% |
| Client Concentration | No client >15% | One at 15-25% | One >25% |
| Cash Runway | >3 months | 1-3 months | <1 month |

All thresholds are configurable in `references/metrics-guide.md`.

## File Structure

```
finance-ops/
├── README.md              # This file
├── SKILL.md               # Claude Code skill definition
├── requirements.txt       # Python dependencies
├── .env.example           # Environment template
├── scripts/
│   ├── cfo-analyzer.py    # Main CFO briefing generator
│   └── scenario-modeler.py # Base/bull/bear projections
└── references/
    ├── metrics-guide.md    # KPI thresholds and benchmarks
    ├── quickbooks-formats.md # QB export format specs
    ├── rates.md            # Developer productivity rates
    ├── org-overhead.md     # Organizational overhead factors
    ├── team-cost.md        # Full team cost multipliers
    ├── claude-roi.md       # AI ROI calculation method
    └── output-template.md  # Cost estimate output format
```

## Customization

**Adjust for your business size:** Edit `references/metrics-guide.md` to change the revenue range and benchmark thresholds. A $500K startup has different healthy ranges than a $10M agency.

**Add report types:** The file detection in `cfo-analyzer.py` uses header scanning. Add new patterns to `detect_file_type()` for custom QB report layouts.

**Change categories:** Expense categorization keywords are in `compute_kpis()`. Adjust the keyword lists to match your chart of accounts.

## License

MIT


---

<div align="center">

**🧠 [Want these built and managed for you? →](https://singlebrain.com/?utm_source=github&utm_medium=skill_repo&utm_campaign=ai_marketing_skills)**

*This is how we build agents at [Single Brain](https://singlebrain.com/?utm_source=github&utm_medium=skill_repo&utm_campaign=ai_marketing_skills) for our clients.*

[Single Grain](https://www.singlegrain.com/?utm_source=github&utm_medium=skill_repo&utm_campaign=ai_marketing_skills) · our marketing agency

📬 **[Level up your marketing with 14,000+ marketers and founders →](https://levelingup.beehiiv.com/subscribe)** *(free)*

</div>
