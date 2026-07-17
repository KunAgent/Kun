---
name: finance-workflows
description: Comprehensive finance workflows including income statements, journal entries, reconciliations, SOX testing, and variance analysis
---

# Finance Workflows Skill

**Important**: This skill assists with financial workflows but does not provide financial advice. All outputs should be reviewed by qualified financial professionals before use in reporting, filings, or audit documentation.

This skill provides comprehensive support for five core financial workflows:
1. **Income Statement Generation** - Period-over-period P&L with variance analysis
2. **Journal Entry Preparation** - Debits, credits, and supporting documentation
3. **Account Reconciliation** - GL to subledger, bank, or third-party balance reconciliation
4. **SOX Compliance Testing** - Control testing workpapers, sample selections, and assessments
5. **Variance Analysis** - Decompose variances into drivers with waterfall analysis

---

## 1. Income Statement Generation

Generate an income statement with period-over-period comparison and variance analysis. Highlight material variances for investigation.

### Usage

Generate an income statement for:
- **Monthly**: Single month P&L with prior month and prior year month comparison
- **Quarterly**: Quarter P&L with prior quarter and prior year quarter comparison
- **Annual**: Full year P&L with prior year comparison
- **YTD**: Year-to-date P&L with prior year YTD comparison

### Workflow

#### 1.1. Gather Financial Data

**Data sources**: User can paste data or upload files containing:
- Current period revenue and expense data (by account or category)
- Comparison period data (prior period, prior year, and/or budget)
- Any known adjustments or reclassifications

#### 1.2. Generate Income Statement

Present in standard multi-column format:

```
INCOME STATEMENT
Period: [Period description]
(in thousands, unless otherwise noted)

                              Current    Prior      Variance   Variance   Budget    Budget
                              Period     Period     ($)        (%)        Amount    Var ($)
                              --------   --------   --------   --------   --------  --------
REVENUE
  Product revenue             $XX,XXX    $XX,XXX    $X,XXX     X.X%       $XX,XXX   $X,XXX
  Service revenue             $XX,XXX    $XX,XXX    $X,XXX     X.X%       $XX,XXX   $X,XXX
  Other revenue               $XX,XXX    $XX,XXX    $X,XXX     X.X%       $XX,XXX   $X,XXX
                              --------   --------   --------              --------  --------
TOTAL REVENUE                 $XX,XXX    $XX,XXX    $X,XXX     X.X%       $XX,XXX   $X,XXX

COST OF REVENUE
  [Cost items]                $XX,XXX    $XX,XXX    $X,XXX     X.X%       $XX,XXX   $X,XXX
                              --------   --------   --------              --------  --------
GROSS PROFIT                  $XX,XXX    $XX,XXX    $X,XXX     X.X%       $XX,XXX   $X,XXX
  Gross Margin                XX.X%      XX.X%

OPERATING EXPENSES
  Research & development      $XX,XXX    $XX,XXX    $X,XXX     X.X%       $XX,XXX   $X,XXX
  Sales & marketing           $XX,XXX    $XX,XXX    $X,XXX     X.X%       $XX,XXX   $X,XXX
  General & administrative    $XX,XXX    $XX,XXX    $X,XXX     X.X%       $XX,XXX   $X,XXX
                              --------   --------   --------              --------  --------
TOTAL OPERATING EXPENSES      $XX,XXX    $XX,XXX    $X,XXX     X.X%       $XX,XXX   $X,XXX

OPERATING INCOME (LOSS)       $XX,XXX    $XX,XXX    $X,XXX     X.X%       $XX,XXX   $X,XXX
  Operating Margin            XX.X%      XX.X%

OTHER INCOME (EXPENSE)
  Interest income             $XX,XXX    $XX,XXX    $X,XXX     X.X%
  Interest expense           ($XX,XXX)  ($XX,XXX)   $X,XXX     X.X%
  Other, net                  $XX,XXX    $XX,XXX    $X,XXX     X.X%
                              --------   --------   --------
TOTAL OTHER INCOME (EXPENSE)  $XX,XXX    $XX,XXX    $X,XXX     X.X%

INCOME BEFORE TAXES           $XX,XXX    $XX,XXX    $X,XXX     X.X%
  Income tax expense          $XX,XXX    $XX,XXX    $X,XXX     X.X%
                              --------   --------   --------

NET INCOME (LOSS)             $XX,XXX    $XX,XXX    $X,XXX     X.X%       $XX,XXX   $X,XXX
  Net Margin                  XX.X%      XX.X%
```

#### 1.3. Variance Analysis

For each line item, calculate and flag material variances:

**Materiality thresholds** (flag if either condition met):
- Dollar variance exceeds a defined threshold (ask user for their threshold, e.g., $50K, $100K)
- Percentage variance exceeds 10% (or user-defined threshold)

For flagged variances, provide:
- Direction and magnitude of the variance
- Possible drivers (if data is available to decompose)
- Questions to investigate
- Whether the variance is favorable or unfavorable

#### 1.4. Key Metrics Summary

```
KEY METRICS
                              Current    Prior      Change
Revenue growth (%)                                  X.X%
Gross margin (%)              XX.X%      XX.X%      X.X pp
Operating margin (%)          XX.X%      XX.X%      X.X pp
Net margin (%)                XX.X%      XX.X%      X.X pp
OpEx as % of revenue          XX.X%      XX.X%      X.X pp
Effective tax rate (%)        XX.X%      XX.X%      X.X pp
```

#### 1.5. Material Variance Summary

List all material variances requiring investigation:

| Line Item | Variance ($) | Variance (%) | Direction | Preliminary Driver | Action |
|-----------|-------------|-------------|-----------|-------------------|--------|
| [Item]    | $X,XXX      | X.X%        | Unfav.    | [If known]        | Investigate |

#### 1.6. Output

Provide:
1. Formatted income statement with comparisons
2. Key metrics summary
3. Material variance listing with investigation flags
4. Suggested follow-up questions for unexplained variances

---

## 2. Journal Entry Preparation

Prepare journal entries with proper debits, credits, supporting detail, and review documentation.

### Entry Types

- **AP Accrual**: Accounts payable accruals for goods/services received but not yet invoiced
- **Fixed Assets**: Depreciation and amortization entries for fixed assets and intangibles
- **Prepaid**: Amortization of prepaid expenses (insurance, software, rent, etc.)
- **Payroll**: Payroll accruals including salaries, benefits, taxes, and bonus accruals
- **Revenue**: Revenue recognition entries including deferred revenue adjustments

### Workflow

#### 2.1. Gather Source Data

**Data sources**: User can paste data or upload files containing:
- Trial balance or GL balances for affected accounts
- Subledger detail or supporting schedules
- Prior period entries for reference (optional)

#### 2.2. Calculate the Entry

Based on the JE type:

**AP Accrual:**
- Identify goods/services received but not invoiced by period end
- Calculate accrual amounts from PO receipts, contracts, or estimates
- Debit: Expense accounts (or asset accounts for capitalizable items)
- Credit: Accrued liabilities

**Fixed Assets:**
- Pull the fixed asset register or depreciation schedule
- Calculate period depreciation by asset class and method (straight-line, declining balance, units of production)
- Debit: Depreciation expense (by department/cost center)
- Credit: Accumulated depreciation

**Prepaid:**
- Pull the prepaid amortization schedule
- Calculate the period amortization for each prepaid item
- Debit: Expense accounts (by type — insurance, software, rent, etc.)
- Credit: Prepaid expense accounts

**Payroll:**
- Calculate accrued salaries for days worked but not yet paid
- Calculate accrued benefits (health, retirement contributions, PTO)
- Calculate employer payroll tax accruals
- Calculate bonus accruals (if applicable, based on plan terms)
- Debit: Salary expense, benefits expense, payroll tax expense
- Credit: Accrued payroll, accrued benefits, accrued payroll taxes

**Revenue:**
- Review contracts and performance obligations
- Calculate revenue to recognize based on delivery/performance
- Adjust deferred revenue balances
- Debit: Deferred revenue (or accounts receivable)
- Credit: Revenue accounts (by stream/category)

#### 2.3. Generate the Journal Entry

Present the entry in standard format:

```
Journal Entry: [Type] — [Period]
Prepared by: [User]
Date: [Period end date]

| Line | Account Code | Account Name | Debit | Credit | Department | Memo |
|------|-------------|--------------|-------|--------|------------|------|
| 1    | XXXX        | [Name]       | X,XXX |        | [Dept]     | [Detail] |
| 2    | XXXX        | [Name]       |       | X,XXX  | [Dept]     | [Detail] |
|      |             | **Total**    | X,XXX | X,XXX  |            |      |

Supporting Detail:
- [Calculation basis and assumptions]
- [Reference to supporting schedule or documentation]

Reversal: [Yes/No — if yes, specify reversal date]
```

#### 2.4. Review Checklist

Before finalizing, verify:

- [ ] Debits equal credits
- [ ] Correct accounting period
- [ ] Account codes are valid and map to the right GL accounts
- [ ] Amounts are calculated correctly with supporting detail
- [ ] Memo/description is clear and specific enough for audit
- [ ] Department/cost center coding is correct
- [ ] Entry is consistent with prior period treatment
- [ ] Reversal flag is set appropriately (accruals should auto-reverse)
- [ ] Supporting documentation is referenced or attached
- [ ] Entry is within the user's approval authority
- [ ] No unusual or out-of-pattern amounts that need investigation

#### 2.5. Output

Provide:
1. The formatted journal entry
2. Supporting calculations
3. Comparison to prior period entry of the same type (if available)
4. Any items flagged for review or follow-up
5. Instructions for posting (manual entry or upload format for the user's ERP)

---

## 3. Account Reconciliation

Reconcile GL account balances to subledger, bank, or third-party balances. Identify and categorize reconciling items and generate a reconciliation workpaper.

### Account Types

- **Cash/Bank**: Bank reconciliation (GL cash to bank statement)
- **Accounts Receivable**: AR subledger reconciliation
- **Accounts Payable**: AP subledger reconciliation
- **Fixed Assets**: Fixed asset subledger reconciliation
- **Intercompany**: Intercompany balance reconciliation
- **Prepaid**: Prepaid expense schedule reconciliation
- **Accrued Liabilities**: Accrued liabilities detail reconciliation
- **Specific GL accounts**: Any specific GL account code

### Workflow

#### 3.1. Gather Both Sides of the Reconciliation

**Data sources**: User can paste data or upload files containing:
1. **GL side**: The general ledger balance for the account as of period end
2. **Other side**: The subledger balance, bank statement balance, or third-party confirmation balance
3. **Prior period outstanding items** (optional): Any reconciling items from the prior period reconciliation

#### 3.2. Compare Balances

Calculate the difference between the two sides:

```
GL Balance:                    $XX,XXX.XX
Subledger/Bank/Other Balance:  $XX,XXX.XX
                               ----------
Difference:                    $XX,XXX.XX
```

#### 3.3. Identify Reconciling Items

Analyze the difference and categorize reconciling items:

**Timing Differences** (items that will clear in subsequent periods):
- Outstanding checks / payments issued but not yet cleared
- Deposits in transit / receipts recorded but not yet credited
- Invoices posted in one system but pending in the other
- Accruals awaiting reversal

**Permanent Differences** (items requiring adjustment):
- Errors in recording (wrong amount, wrong account, duplicate entries)
- Missing entries (transactions in one system but not the other)
- Bank fees or charges not yet recorded
- Foreign currency translation differences

**Prior Period Items** (carryforward from prior reconciliation):
- Items from prior period that have now cleared (remove from reconciliation)
- Items from prior period still outstanding (carry forward with aging)

#### 3.4. Generate Reconciliation Workpaper

```
ACCOUNT RECONCILIATION
Account: [Account code] — [Account name]
Period End: [Date]
Prepared by: [User]
Date Prepared: [Today]

RECONCILIATION SUMMARY
=======================

Balance per General Ledger:              $XX,XXX.XX

Add: Reconciling items increasing GL
  [Item description]                     $X,XXX.XX
  [Item description]                     $X,XXX.XX
                                         ---------
  Subtotal additions:                    $X,XXX.XX

Less: Reconciling items decreasing GL
  [Item description]                    ($X,XXX.XX)
  [Item description]                    ($X,XXX.XX)
                                         ---------
  Subtotal deductions:                  ($X,XXX.XX)

Adjusted GL Balance:                     $XX,XXX.XX

Balance per [Subledger/Bank/Other]:      $XX,XXX.XX

Add: Reconciling items
  [Item description]                     $X,XXX.XX

Less: Reconciling items
  [Item description]                    ($X,XXX.XX)

Adjusted [Other] Balance:                $XX,XXX.XX

DIFFERENCE:                              $0.00
```

#### 3.5. Reconciling Items Detail

Present each reconciling item with:

| # | Description | Amount | Category | Age (Days) | Status | Action Required |
|---|-------------|--------|----------|------------|--------|-----------------|
| 1 | [Detail]    | $X,XXX | Timing   | 5          | Expected to clear | Monitor |
| 2 | [Detail]    | $X,XXX | Error    | N/A        | Requires correction | Post adjusting JE |

#### 3.6. Review and Escalation

Flag items that require attention:

- **Aged items**: Reconciling items outstanding more than 30/60/90 days
- **Large items**: Individual items exceeding materiality thresholds
- **Growing balances**: Reconciling item totals increasing period over period
- **Unresolved prior period items**: Items carried forward without resolution
- **Unexplained differences**: Amounts that cannot be tied to specific transactions

#### 3.7. Output

Provide:
1. The formatted reconciliation workpaper
2. List of reconciling items with categorization and aging
3. Required adjusting entries (if any permanent differences identified)
4. Action items for items requiring follow-up
5. Comparison to prior period reconciliation (if available)
6. Sign-off section for preparer and reviewer

---

## 4. SOX Compliance Testing

Generate sample selections, create testing workpapers, document control assessments, and provide testing templates for SOX 404 internal controls over financial reporting.

### Control Areas

- **Revenue Recognition**: Revenue cycle controls (order-to-cash)
- **Procure-to-Pay (P2P)**: Procurement and AP controls (purchase-to-pay)
- **Payroll**: Payroll processing and compensation controls
- **Financial Close**: Period-end close and reporting controls
- **Treasury**: Cash management and treasury controls
- **Fixed Assets**: Capital asset lifecycle controls
- **Inventory**: Inventory valuation and management controls
- **ITGC**: IT general controls (access, change management, operations)
- **Entity-Level**: Entity-level and monitoring controls
- **Journal Entries**: Journal entry processing controls
- **Specific controls**: Any specific control ID or name

### Workflow

#### 4.1. Identify Controls to Test

Based on the control area, identify the key controls. Present the control matrix:

| Control # | Control Description | Type | Frequency | Key/Non-Key | Risk | Assertion |
|-----------|-------------------|------|-----------|-------------|------|-----------|
| [ID]      | [Description]     | Manual/Automated/IT-Dependent | Daily/Weekly/Monthly/Quarterly/Annual | Key | High/Medium/Low | [CEAVOP] |

**Control types:**
- **Automated**: System-enforced controls with no manual intervention
- **Manual**: Controls performed by personnel with judgment
- **IT-dependent manual**: Manual controls that rely on system-generated data

**Assertions (CEAVOP):**
- **C**ompleteness — All transactions are recorded
- **E**xistence/Occurrence — Transactions actually occurred
- **A**ccuracy — Amounts are correctly recorded
- **V**aluation — Assets/liabilities are properly valued
- **O**bligations/Rights — Entity has rights to assets, obligations for liabilities
- **P**resentation/Disclosure — Properly classified and disclosed

#### 4.2. Determine Sample Size

Calculate sample sizes based on control frequency and risk:

| Control Frequency | Population Size (approx.) | Recommended Sample |
|------------------|--------------------------|-------------------|
| Annual           | 1                        | 1 (test the instance) |
| Quarterly        | 4                        | 2 |
| Monthly          | 12                       | 2-4 (based on risk) |
| Weekly           | 52                       | 5-15 (based on risk) |
| Daily            | ~250                     | 20-40 (based on risk) |
| Per-transaction  | Varies                   | 25-60 (based on risk and volume) |

Adjust for:
- **Risk level**: Higher risk controls require larger samples
- **Prior year results**: Controls with prior deficiencies need larger samples
- **Reliance**: Controls relied upon by external auditors may need larger samples

#### 4.3. Generate Sample Selection

Select samples from the population using the appropriate method:

**Random selection** (default for transaction-level controls):
- Generate random numbers to select specific items from the population
- Ensure coverage across the full period

**Systematic selection** (for periodic controls):
- Select items at fixed intervals with a random start point
- Ensure representation across all sub-periods

**Targeted selection** (supplement to random, for risk-based testing):
- Select items with specific risk characteristics (high dollar, unusual, period-end)
- Document rationale for targeted selections

Present the sample:

```
SAMPLE SELECTION
Control: [Control ID] — [Description]
Period: [Testing period]
Population: [Count] items, $[Total value]
Sample size: [N] items
Selection method: [Random/Systematic/Targeted]

| Sample # | Transaction Date | Reference/ID | Amount | Selection Basis |
|----------|-----------------|--------------|--------|-----------------|
| 1        | [Date]          | [Ref]        | $X,XXX | Random          |
| 2        | [Date]          | [Ref]        | $X,XXX | Random          |
| ...      | ...             | ...          | ...    | ...             |
```

#### 4.4. Create Testing Workpaper

Generate a testing template for each control:

```
SOX CONTROL TESTING WORKPAPER
==============================
Control #: [ID]
Control Description: [Full description of the control activity]
Control Owner: [Role/title — to be filled by tester]
Control Type: [Manual/Automated/IT-Dependent Manual]
Frequency: [How often the control operates]
Key Control: [Yes/No]
Relevant Assertion(s): [CEAVOP]
Testing Period: [Period]

TEST OBJECTIVE:
To determine whether [control description] operated effectively throughout the testing period.

TEST PROCEDURES:
1. [Step 1 — What to inspect, examine, or re-perform]
2. [Step 2 — What evidence to obtain]
3. [Step 3 — What to compare or verify]
4. [Step 4 — How to evaluate completeness of performance]
5. [Step 5 — How to assess timeliness of performance]

EXPECTED EVIDENCE:
- [Document type 1 — e.g., signed approval form]
- [Document type 2 — e.g., system screenshot showing review]
- [Document type 3 — e.g., reconciliation with preparer sign-off]

TEST RESULTS:

| Sample # | Ref | Procedure 1 | Procedure 2 | Procedure 3 | Result | Exception? | Notes |
|----------|-----|-------------|-------------|-------------|--------|------------|-------|
| 1        |     | Pass/Fail   | Pass/Fail   | Pass/Fail   | Pass/Fail | Y/N    |       |
| 2        |     | Pass/Fail   | Pass/Fail   | Pass/Fail   | Pass/Fail | Y/N    |       |

EXCEPTIONS NOTED:
| Sample # | Exception Description | Root Cause | Compensating Control | Impact |
|----------|----------------------|------------|---------------------|--------|
|          |                      |            |                     |        |

CONCLUSION:
[ ] Effective — Control operated effectively with no exceptions
[ ] Effective with exceptions — Control operated effectively; exceptions are isolated
[ ] Deficiency — Control did not operate effectively
[ ] Significant Deficiency — Deficiency is more than inconsequential
[ ] Material Weakness — Reasonable possibility of material misstatement not prevented/detected

Tested by: ________________  Date: ________
Reviewed by: _______________  Date: ________
```

#### 4.5. Provide Common Control Templates

Based on the control area, provide pre-built test step templates:

**Revenue Recognition:**
- Verify sales order approval and authorization
- Confirm delivery/performance evidence
- Test revenue recognition timing against contract terms
- Verify pricing accuracy to contract/price list
- Test credit memo approval and validity

**Procure to Pay:**
- Verify purchase order approval and authorization limits
- Confirm three-way match (PO, receipt, invoice)
- Test vendor master data change controls
- Verify payment approval and segregation of duties
- Test duplicate payment prevention controls

**Financial Close:**
- Verify account reconciliation completeness and timeliness
- Test journal entry approval and segregation of duties
- Verify management review of financial statements
- Test consolidation and elimination entries
- Verify disclosure checklist completion

**ITGC:**
- Test user access provisioning and de-provisioning
- Verify privileged access reviews
- Test change management approval and testing
- Verify batch job monitoring and exception handling
- Test backup and recovery procedures

#### 4.6. Document Control Assessment

Classify any identified deficiencies:

**Deficiency:** A control does not allow management or employees to prevent or detect misstatements on a timely basis. Consider:
- Likelihood of misstatement
- Magnitude of potential misstatement
- Whether compensating controls exist

**Significant Deficiency:** A deficiency (or combination) that is less severe than a material weakness but important enough to merit attention by those responsible for oversight.

**Material Weakness:** A deficiency (or combination) such that there is a reasonable possibility that a material misstatement will not be prevented or detected on a timely basis.

#### 4.7. Output

Provide:
1. Control matrix for the selected area
2. Sample selections with methodology documentation
3. Testing workpaper templates with pre-populated test steps
4. Results documentation template
5. Deficiency evaluation framework (if exceptions are identified)
6. Suggested remediation actions for any noted deficiencies

---

## 5. Variance / Flux Analysis

Decompose variances into underlying drivers, provide narrative explanations for significant variances, and generate waterfall analysis.

### Analysis Areas

- **Revenue**: Revenue variance by stream, product, geography, customer segment
- **OpEx**: Operating expense variance by category, department, cost center
- **CapEx**: Capital expenditure variance vs budget by project and asset class
- **Headcount**: Headcount and compensation variance by department and role level
- **COGS/Cost of Revenue**: Cost of revenue variance by component
- **Gross Margin**: Gross margin analysis with mix and rate effects
- **Specific accounts**: Any specific GL account or account group

### Period Comparison Formats

- Month over month: `2024-12 vs 2024-11`
- Year over year: `2024-12 vs 2023-12`
- Quarter over quarter: `2024-Q4 vs 2024-Q3`
- Actual vs budget: `2024-12 vs budget`
- Actual vs forecast: `2024-12 vs forecast`
- Three-way comparison: `2024-Q4 vs 2024-Q3 vs 2023-Q4`

### Workflow

#### 5.1. Gather Data

**Data sources**: User can paste data or upload files containing:
1. Actual data for both comparison periods (at account or line-item detail)
2. Budget/forecast data (if comparing to plan)
3. Any operational metrics that drive the financial results (headcount, volumes, pricing, etc.)

#### 5.2. Calculate Top-Level Variance

```
VARIANCE SUMMARY: [Area] — [Period 1] vs [Period 2]

                              Period 1   Period 2   Variance ($)   Variance (%)
                              --------   --------   ------------   ------------
Total [Area]                  $XX,XXX    $XX,XXX    $X,XXX         X.X%
```

#### 5.3. Decompose Variance by Driver

Break down the total variance into constituent drivers. Use the appropriate decomposition method for the area:

**Revenue Decomposition:**
- **Volume effect**: Change in units/customers/transactions at prior period pricing
- **Price/rate effect**: Change in pricing/ASP applied to current period volume
- **Mix effect**: Shift between products/segments at different margin levels
- **New vs existing**: Revenue from new customers/products vs base business
- **Currency effect**: FX impact on international revenue (if applicable)

**Operating Expense Decomposition:**
- **Headcount-driven**: Salary and benefits changes from headcount additions/reductions
- **Compensation changes**: Merit increases, promotions, bonus accruals
- **Volume-driven**: Expenses that scale with business activity (hosting, commissions, travel)
- **New programs/investments**: Incremental spend on new initiatives
- **One-time items**: Non-recurring expenses (severance, legal settlements, write-offs)
- **Timing**: Expenses shifted between periods (prepaid amortization changes, contract timing)

**CapEx Decomposition:**
- **Project-level**: Variance by capital project vs approved budget
- **Timing**: Projects ahead of or behind schedule
- **Scope changes**: Approved scope expansions or reductions
- **Cost overruns**: Unit cost increases vs plan

**Headcount Decomposition:**
- **Hiring pace**: Actual hires vs plan by department and level
- **Attrition**: Unplanned departures and backfill timing
- **Compensation mix**: Salary, bonus, equity, benefits variance
- **Contractor/temp**: Supplemental workforce changes

#### 5.4. Waterfall Analysis

Generate a text-based waterfall showing how each driver contributes to the total variance:

```
WATERFALL: [Area] — [Period 1] vs [Period 2]

[Period 2 Base]                           $XX,XXX
  |
  |--[+] [Driver 1 description]          +$X,XXX
  |--[+] [Driver 2 description]          +$X,XXX
  |--[-] [Driver 3 description]          -$X,XXX
  |--[+] [Driver 4 description]          +$X,XXX
  |--[-] [Driver 5 description]          -$X,XXX
  |
[Period 1 Actual]                         $XX,XXX

Variance Reconciliation:
  Driver 1:    +$X,XXX  (XX% of total variance)
  Driver 2:    +$X,XXX  (XX% of total variance)
  Driver 3:    -$X,XXX  (XX% of total variance)
  Driver 4:    +$X,XXX  (XX% of total variance)
  Driver 5:    -$X,XXX  (XX% of total variance)
  Unexplained: $X,XXX   (XX% of total variance)
               --------
  Total:       $X,XXX   (100%)
```

#### 5.5. Narrative Explanations

For each significant driver, generate a narrative explanation:

> **[Driver name]** — [Favorable/Unfavorable] variance of $X,XXX (X.X%)
>
> [2-3 sentence explanation of what caused this variance, referencing specific operational factors, business events, or decisions. Include quantification where possible.]
>
> *Outlook:* [Whether this is expected to continue, reverse, or change in future periods]

#### 5.6. Identify Unexplained Variances

If the decomposition does not fully explain the total variance, flag the residual:

> **Unexplained variance:** $X,XXX (X.X% of total)
>
> Possible causes to investigate:
> - [Suggested area 1]
> - [Suggested area 2]
> - [Suggested area 3]

Ask the user for additional context on unexplained variances:
- "Can you provide context on [specific unexplained item]?"
- "Were there any business events in [period] that would explain [variance area]?"
- "Is the [specific driver] variance expected or a surprise?"

#### 5.7. Output

Provide:
1. Top-level variance summary
2. Detailed variance decomposition by driver
3. Waterfall analysis (text format)
4. Narrative explanations for each significant driver
5. Unexplained variance flag with investigation suggestions
6. Trend context (is this variance new, growing, or consistent with recent periods?)
7. Suggested actions or follow-ups

---

## Usage Guidelines

### Data Input Methods

For all workflows, users can provide data by:
1. **Pasting directly**: Copy/paste data from spreadsheets or other sources
2. **Uploading files**: Attach Excel, CSV, or PDF files containing financial data
3. **Manual entry**: Type in key figures and details in conversation

### Review and Approval

All outputs from this skill should be:
- Reviewed by qualified financial professionals
- Validated against source systems
- Approved according to the organization's internal controls
- Documented and retained according to audit requirements

### Materiality and Thresholds

Users should define their own materiality thresholds based on:
- Company size and financial statement scale
- Industry norms
- Regulatory requirements
- Internal control frameworks

### Customization

This skill provides standard templates and formats. Users should:
- Adjust formats to match their organization's standards
- Add or remove sections as needed
- Incorporate company-specific policies and procedures
- Tailor account hierarchies and categorizations
