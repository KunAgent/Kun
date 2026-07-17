# QuickBooks Export Formats

## File Detection Heuristics

The analyzer identifies report type by scanning the first 10 lines for signature patterns:

| Report Type | Detection Pattern |
|---|---|
| P&L Summary | "Profit and Loss" in header, two-column (account, total) |
| P&L by Customer | "Profit and Loss by Customer" in header, multi-column with customer names |
| P&L Detail | "Profit and Loss Detail" in sheet name or header; columns: Date, Transaction Type, Num, Name, Class, Memo, Split, Amount, Balance |
| Balance Sheet | "Balance Sheet" in header |
| Cash Flow Statement | "Statement of Cash Flows" in sheet name or header; monthly columns |
| General Ledger | "General Ledger" in header; columns include Date, Account, Debit, Credit |
| Expenses by Vendor | "Expenses by Vendor" in header |
| Transaction List by Vendor | "Transaction List by Vendor" in header |
| Bill Payments | "Bill Payment" in header or transaction types dominated by "Bill Payment" |
| Account List | "Account List" in header; columns include Account, Type, Balance |

## P&L Summary CSV Format

```
Profit and Loss,
Your Company Name,
"January, 2025-December, 2025",
<blank line>
Distribution account,Total
Income,
40000 Revenue,
40010 Consulting Revenue,"250,000.00"
...
Total for 40000 Revenue,"$2,000,000.00"
Total for Income,"$2,000,000.00"
Cost of Goods Sold,
...
Total for Cost of Goods Sold,"$900,000.00"
Gross Profit,"$1,100,000.00"
Expenses,
...
Total for Expenses,"$850,000.00"
Net Operating Income,"$250,000.00"
Other Income,
...
Net Income,"$200,000.00"
```

Key parsing rules:
- Dollar values may have `$` prefix, commas, quotes, negative in parens or with `-`
- "Total for X" lines aggregate their parent category
- Indentation (spaces) indicates hierarchy depth
- Account numbers (5 digits) prefix account names

## P&L by Customer CSV Format

Same structure as P&L Summary but with customer names as column headers. The last column is "Total". Revenue and COGS broken down per customer.

## P&L Detail XLSX Format

Columns: (blank), Date, Transaction Type, Num, Name, Class, Memo/Description, Split, Amount, Balance

- Hierarchical account names in column A
- Transaction rows have Date populated
- Subtotal rows show "Total for [Account]"

## Cash Flow Statement XLSX Format

Monthly columns (e.g., "Feb 12-28, 2025", "Mar 2025", ..., "Total")
Sections: OPERATING ACTIVITIES, INVESTING ACTIVITIES, FINANCING ACTIVITIES
Values stored as Excel formulas (e.g., `=-236705.50`) — use `data_only=False` and parse formula strings, or open with `data_only=True`.

Note: openpyxl with `data_only=True` may return None for formula cells unless the file was last saved by Excel. Parse formula strings as fallback: strip `=` prefix, evaluate simple numeric expressions.

## Common Parsing Pitfalls

1. **Comma-separated thousands in quotes**: `"1,250,000.00"` — strip commas before float conversion
2. **Dollar signs**: `"$2,000,000.00"` — strip `$`
3. **Negative values**: Both `-50,000.00` and `($50,000.00)` formats
4. **Empty rows**: QB exports include blank lines between sections
5. **Header rows**: First 3-5 rows are company name, report name, date range
6. **"(deleted)" in names**: Customer/vendor names may include "(deleted)"
7. **Formula cells in XLSX**: May need formula string parsing as fallback
