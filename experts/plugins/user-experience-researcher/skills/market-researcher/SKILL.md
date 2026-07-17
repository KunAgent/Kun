---
name: market-researcher
description: "Market research specialist focused on comprehensive market analysis, consumer behavior insights, and market opportunity identification. Excels at quantitative market sizing (TAM/SAM/SOM), qualitative consumer research, and strategic market positioning analysis."
description_zh: "市场调研专家，提供市场分析、消费者洞察与机会评估"
description_en: "Market research specialist for analysis, consumer insights, and sizing"
version: 1.0.0
---

# Market Researcher

## Purpose

Provides comprehensive market research expertise specializing in market sizing, consumer behavior analysis, and strategic opportunity identification. Excels at quantitative market analysis, qualitative consumer insights, and strategic market positioning for business decision-making.

## When to Use

- Sizing markets (TAM/SAM/SOM calculations)
- Analyzing consumer behavior and purchase decisions
- Conducting competitive market analysis
- Identifying market opportunities and white spaces
- Validating product-market fit or positioning strategies

## Quick Start

**Invoke this skill when:**
- Sizing markets (TAM/SAM/SOM calculations)
- Analyzing consumer behavior and purchase decisions
- Conducting competitive market analysis
- Identifying market opportunities and white spaces
- Validating product-market fit or positioning strategies

**Do NOT invoke when:**
- Analyzing direct competitors only (use competitive-analyst instead)
- Pure data analysis without market context (use data-analyst)
- Sales forecasting from existing data (use data-scientist)
- Marketing campaign execution (use content-marketer or seo-specialist)

---
---

## Core Workflows

### Workflow 1: Calculate TAM, SAM, SOM

**Use case:** Sizing addressable market for new product or investment decision

**Step 1: Define Market Scope**
```
Market Definition Template:
- Product/Service: [Specific offering]
- Geography: [Target regions]
- Customer Segment: [Who specifically?]
- Time Frame: [Current year or 5-year projection?]

Example:
- Product: AI-powered customer service chatbot for e-commerce
- Geography: United States
- Customer Segment: E-commerce companies with \u003e$10M revenue
- Time Frame: 2024-2029
```

**Step 2: Calculate TAM (Top-Down Approach)**
```
TAM = Total market demand if 100% market share

Data sources:
1. Industry reports (Gartner, Forrester, IBISWorld)
2. Government statistics (Census Bureau, BLS)
3. Trade associations

Example calculation:
Total US e-commerce market: $1.1T (2024)
× % needing customer service: 80%
× Average customer service spend: 2.5% of revenue
TAM = $1.1T × 80% × 2.5% = $22B
```

**Step 3: Calculate SAM (Serviceable Addressable Market)**
```
SAM = Portion of TAM you can realistically serve

Filters to apply:
- Geographic constraints (if only operating in US)
- Product limitations (if only for e-commerce, not all retail)
- Customer size constraints (if targeting $10M+ companies)

Example:
E-commerce companies \u003e$10M revenue: 15,000 companies
× Average annual customer service budget: $500K
SAM = 15,000 × $500K = $7.5B
```

**Step 4: Calculate SOM (Serviceable Obtainable Market)**
```
SOM = Realistic market share you can capture in near term (1-3 years)

Factors:
- Competitive landscape (how many competitors?)
- Your differentiation (unique value prop strength)
- Sales \u0026 marketing capacity (realistic reach)
- Growth trajectory (realistic penetration rate)

Conservative SOM:
Year 1: 0.1-0.5% of SAM
Year 2: 0.5-2% of SAM
Year 3: 1-5% of SAM

Example (Year 3):
SOM = $7.5B × 2% = $150M
```

**Step 5: Bottom-Up Validation**
```
Validate top-down sizing with bottom-up:

Unit Economics Approach:
- Target customers: 15,000 e-commerce companies
- Realistic conversion rate: 5% (industry benchmark)
- Customers acquired: 750
- Average contract value: $50K/year
- Bottom-up market capture: 750 × $50K = $37.5M

Compare: Top-down SOM ($150M) vs Bottom-up ($37.5M)
If gap \u003e3x → revisit assumptions
```

---
---

### Workflow 3: Competitive Market Analysis

**Use case:** Understanding competitive landscape and positioning opportunities

**Step 1: Identify Competitors**
```
Competitor Categories:
1. Direct: Same product, same target customer
2. Indirect: Different product, solves same problem
3. Substitute: Alternative way to address need
4. Potential: Could enter market easily

Example (Project Management Software):
- Direct: Asana, Monday.com, ClickUp
- Indirect: Excel/Sheets (for simple tracking)
- Substitute: Consultants (outsource instead of software)
- Potential: Microsoft, Google (have adjacent products)
```

**Step 2: Competitive Intelligence Gathering**
```
Data Sources Matrix:

Public Information:
- Company websites (pricing, features, positioning)
- App store reviews (4.2★ rating, "easy to use" appears 45%)
- Social media (follower count, engagement rate)
- Job postings (hiring for X roles = growing that area)

Industry Sources:
- Gartner Magic Quadrant (market position)
- G2 Crowd reviews (feature comparison, user satisfaction)
- Crunchbase (funding, valuation, investor profiles)
- LinkedIn (employee count trends, key hires)

Competitive Metrics Template:
| Competitor | Pricing | Features | Market Share | Customer Satisfaction |
|------------|---------|----------|--------------|----------------------|
| Asana | $10-25/user/mo | 85% feature parity | ~20% | 4.5/5 (G2) |
| Monday.com | $8-16/user/mo | 90% feature parity | ~15% | 4.6/5 (G2) |
```

**Step 3: Positioning Map**
```
Create 2D positioning map:
X-axis: Price (Low → High)
Y-axis: Feature Complexity (Simple → Advanced)

┌─────────────────────────────────┐
│ Advanced                        │
│                    [Enterprise] │
│                                 │
│  [Our Product]         [Leader] │
│                                 │
│                        [Asana]  │
│  [Budget Option]                │
│ Simple                          │
└─────────────────────────────────┘
  Low Price            High Price

Insight: Gap in "Simple but Premium" quadrant = opportunity
```

---
---

### Pattern 2: Van Westendorp Price Sensitivity Analysis

**When to use:** Determining optimal pricing

```
Survey Questions (ask in this order):
1. At what price would you consider this product to be so expensive 
   that you would not consider buying it? (Too Expensive)

2. At what price would you consider this product to be priced so low 
   that you would feel the quality couldn't be very good? (Too Cheap)

3. At what price would you consider this product starting to get 
   expensive, so that it is not out of the question, but you would 
   have to give some thought to buying it? (Expensive/High Side)

4. At what price would you consider this product to be a bargain—a 
   great buy for the money? (Cheap/Good Value)

Analysis:
- Plot cumulative % for each price point
- Optimal Price Point (OPP) = intersection of "Too Expensive" and "Too Cheap"
- Acceptable Price Range = between "Too Cheap" and "Too Expensive" intersections

Example Results:
OPP: $49/month
Range: $35-$75/month
Recommendation: Price at $49-$59 for maximum acceptance
```

---
---

### ❌ Anti-Pattern 2: Survey Leading Questions

**What it looks like:**
```
"Don't you think our innovative new product would solve your problems better than competitors?"

Answer options:
[ ] Yes, absolutely!
[ ] Yes, somewhat
[ ] Maybe
```

**Why it fails:**
- Leading language ("innovative", "better")
- No negative options (biased toward "yes")
- Worthless data (everyone says yes)

**Correct approach:**
```
"How well does [our product] solve [specific problem] compared to alternatives you've used?"

[ ] Much better
[ ] Somewhat better
[ ] About the same
[ ] Somewhat worse
[ ] Much worse
[ ] Haven't used alternatives
```

---
---

## Quality Checklist

### Research Design
- [ ] Clear, measurable research objectives defined
- [ ] Sample size calculated for statistical significance
- [ ] Survey/interview questions tested with pilot group
- [ ] No leading or biased questions
- [ ] Mix of qualitative and quantitative methods (if appropriate)

### Data Collection
- [ ] Representative sample (demographics match target market)
- [ ] Response rate \u003e25% for surveys (higher is better)
- [ ] Data quality checks during collection
- [ ] Respondent privacy protected (GDPR/CCPA compliant)

### Analysis \u0026 Insights
- [ ] Statistical significance tested (p-values, confidence intervals)
- [ ] Outliers identified and handled appropriately
- [ ] Multiple hypotheses tested (not just confirmation bias)
- [ ] Insights validated with multiple data points

### Reporting
- [ ] Findings actionable (not just "interesting facts")
- [ ] Visualizations clear and accurate
- [ ] Limitations acknowledged
- [ ] Recommendations prioritized by impact

---
