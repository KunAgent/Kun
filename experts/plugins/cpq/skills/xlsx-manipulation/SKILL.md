---
# ═══════════════════════════════════════════════════════════════════════════════
# CLAUDE OFFICE SKILL - Enhanced Metadata v2.0
# ═══════════════════════════════════════════════════════════════════════════════

# Basic Information
name: xlsx-manipulation
description: "Create, edit, and manipulate Excel spreadsheets programmatically using openpyxl"
version: "1.0"
author: claude-office-skills
license: MIT

# Categorization
category: spreadsheet
tags:
  - xlsx
  - excel
  - manipulation
  - editing
department: All

# AI Model Compatibility
models:
  recommended:
    - claude-sonnet-4
    - claude-opus-4
  compatible:
    - claude-3-5-sonnet
    - gpt-4
    - gpt-4o

# MCP Tools Integration
mcp:
  server: office-mcp
  tools:
    - read_xlsx
    - create_xlsx
    - apply_formula
    - create_chart

# Skill Capabilities
capabilities:
  - spreadsheet_creation
  - formula_handling
  - charting

# Language Support
languages:
  - en
  - zh
---

# XLSX Manipulation Skill

## Overview

This skill enables programmatic creation, editing, and manipulation of Microsoft Excel (.xlsx) spreadsheets using the **openpyxl** library. Create professional spreadsheets with formulas, formatting, charts, and data validation without manual editing.

## How to Use

1. Describe the spreadsheet you want to create or modify
2. Provide data, formulas, or formatting requirements
3. I'll generate openpyxl code and execute it

**Example prompts:**
- "Create a budget spreadsheet with monthly tracking"
- "Add conditional formatting to highlight values above threshold"
- "Generate a pivot-table-like summary from this data"
- "Create a dashboard with charts and KPIs"

## Domain Knowledge

### openpyxl Fundamentals

```python
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, Fill, Border, Alignment
from openpyxl.chart import BarChart, Reference

# Create new workbook
wb = Workbook()
ws = wb.active

# Or open existing
wb = load_workbook('existing.xlsx')
ws = wb.active
```

### Workbook Structure
```
Workbook
├── worksheets (sheets/tabs)
│   ├── cells (data storage)
│   ├── rows/columns (formatting)
│   ├── merged_cells
│   └── charts
├── defined_names (named ranges)
└── styles (formatting templates)
```

### Working with Cells

#### Basic Cell Operations
```python
# By cell reference
ws['A1'] = 'Header'
ws['B1'] = 42

# By row, column
ws.cell(row=1, column=3, value='Data')

# Multiple cells
ws['A1:C1'] = [['Col1', 'Col2', 'Col3']]

# Append rows
ws.append(['Row', 'Data', 'Here'])
```

#### Reading Cells
```python
# Single cell
value = ws['A1'].value

# Cell range
for row in ws['A1:C3']:
    for cell in row:
        print(cell.value)

# Iterate rows
for row in ws.iter_rows(min_row=1, max_row=10, min_col=1, max_col=3):
    for cell in row:
        print(cell.value)
```

### Formulas
```python
# Basic formulas
ws['D1'] = '=SUM(A1:C1)'
ws['D2'] = '=AVERAGE(A2:C2)'
ws['E1'] = '=IF(D1>100,"High","Low")'

# Named ranges
from openpyxl.workbook.defined_name import DefinedName
ref = "Sheet!$A$1:$C$10"
defn = DefinedName("SalesData", attr_text=ref)
wb.defined_names.add(defn)

# Use named range
ws['F1'] = '=SUM(SalesData)'
```

### Formatting

#### Cell Styles
```python
from openpyxl.styles import Font, Fill, PatternFill, Border, Side, Alignment

# Font
ws['A1'].font = Font(
    name='Arial',
    size=14,
    bold=True,
    italic=False,
    color='FF0000'  # Red
)

# Fill (background)
ws['A1'].fill = PatternFill(
    start_color='FFFF00',  # Yellow
    end_color='FFFF00',
    fill_type='solid'
)

# Border
thin_border = Border(
    left=Side(style='thin'),
    right=Side(style='thin'),
    top=Side(style='thin'),
    bottom=Side(style='thin')
)
ws['A1'].border = thin_border

# Alignment
ws['A1'].alignment = Alignment(
    horizontal='center',
    vertical='center',
    wrap_text=True
)
```

#### Number Formats
```python
# Currency
ws['B2'].number_format = '$#,##0.00'

# Percentage
ws['C2'].number_format = '0.00%'

# Date
ws['D2'].number_format = 'YYYY-MM-DD'

# Custom
ws['E2'].number_format = '#,##0.00 "units"'
```

#### Conditional Formatting
```python
from openpyxl.formatting.rule import ColorScaleRule, CellIsRule, FormulaRule
from openpyxl.styles import PatternFill

# Color scale (heatmap)
color_scale = ColorScaleRule(
    start_type='min', start_color='FF0000',
    end_type='max', end_color='00FF00'
)
ws.conditional_formatting.add('A1:A10', color_scale)

# Cell value rule
red_fill = PatternFill(start_color='FFCCCC', end_color='FFCCCC', fill_type='solid')
rule = CellIsRule(operator='greaterThan', formula=['100'], fill=red_fill)
ws.conditional_formatting.add('B1:B10', rule)
```

### Charts
```python
from openpyxl.chart import BarChart, LineChart, PieChart, Reference

# Prepare data
data = Reference(ws, min_col=2, min_row=1, max_col=3, max_row=5)
categories = Reference(ws, min_col=1, min_row=2, max_row=5)

# Bar Chart
chart = BarChart()
chart.type = "col"  # or "bar" for horizontal
chart.title = "Sales by Region"
chart.add_data(data, titles_from_data=True)
chart.set_categories(categories)
chart.shape = 4
ws.add_chart(chart, "E1")

# Line Chart
line = LineChart()
line.title = "Trend Analysis"
line.add_data(data, titles_from_data=True)
line.set_categories(categories)
ws.add_chart(line, "E15")

# Pie Chart
pie = PieChart()
pie.add_data(data, titles_from_data=True)
pie.set_categories(categories)
ws.add_chart(pie, "M1")
```

### Data Validation
```python
from openpyxl.worksheet.datavalidation import DataValidation

# Dropdown list
dv = DataValidation(
    type="list",
    formula1='"Option1,Option2,Option3"',
    allow_blank=True
)
dv.error = "Please select from list"
dv.errorTitle = "Invalid Input"
ws.add_data_validation(dv)
dv.add('A1:A100')

# Number range
dv_num = DataValidation(
    type="whole",
    operator="between",
    formula1="1",
    formula2="100"
)
ws.add_data_validation(dv_num)
dv_num.add('B1:B100')
```

### Sheet Operations
```python
# Create new sheet
ws2 = wb.create_sheet("Data")
ws3 = wb.create_sheet("Summary", 0)  # At position 0

# Rename
ws.title = "Main Report"

# Delete
del wb["Sheet2"]

# Copy
source = wb["Template"]
target = wb.copy_worksheet(source)
```

### Row/Column Operations
```python
# Set column width
ws.column_dimensions['A'].width = 20

# Set row height
ws.row_dimensions[1].height = 30

# Hide column
ws.column_dimensions['C'].hidden = True

# Freeze panes
ws.freeze_panes = 'B2'  # Freeze row 1 and column A

# Auto-filter
ws.auto_filter.ref = "A1:D100"
```

## Best Practices

1. **Use Templates**: Start with a .xlsx template for complex formatting
2. **Batch Operations**: Minimize cell-by-cell operations for speed
3. **Named Ranges**: Use defined names for clearer formulas
4. **Data Validation**: Add validation to prevent input errors
5. **Save Incrementally**: For large files, save periodically

## Common Patterns

### Data Import
```python
def import_csv_to_xlsx(csv_path, xlsx_path):
    import csv
    wb = Workbook()
    ws = wb.active
    
    with open(csv_path) as f:
        reader = csv.reader(f)
        for row in reader:
            ws.append(row)
    
    wb.save(xlsx_path)
```

### Report Template
```python
def create_monthly_report(data, output_path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Monthly Report"
    
    # Headers
    headers = ['Date', 'Revenue', 'Expenses', 'Profit']
    ws.append(headers)
    
    # Style headers
    for col in range(1, 5):
        cell = ws.cell(1, col)
        cell.font = Font(bold=True)
        cell.fill = PatternFill('solid', fgColor='4472C4')
        cell.font = Font(bold=True, color='FFFFFF')
    
    # Data
    for row in data:
        ws.append(row)
    
    # Add totals
    last_row = len(data) + 1
    ws.cell(last_row + 1, 1, 'TOTAL')
    ws.cell(last_row + 1, 2, f'=SUM(B2:B{last_row})')
    ws.cell(last_row + 1, 3, f'=SUM(C2:C{last_row})')
    ws.cell(last_row + 1, 4, f'=SUM(D2:D{last_row})')
    
    wb.save(output_path)
```

## Examples

### Example 1: Budget Tracker
```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = Workbook()
ws = wb.active
ws.title = "Budget 2024"

# Headers
months = ['Category', 'Jan', 'Feb', 'Mar', 'Q1 Total']
ws.append(months)

# Categories and data
budget_data = [
    ['Salary', 5000, 5000, 5000],
    ['Rent', -1500, -1500, -1500],
    ['Utilities', -200, -180, -220],
    ['Food', -400, -450, -380],
    ['Transport', -150, -160, -140],
    ['Entertainment', -200, -250, -200],
]

for row in budget_data:
    ws.append(row + [f'=SUM(B{ws.max_row + 1}:D{ws.max_row + 1})'])

# Total row
ws.append(['TOTAL', 
    f'=SUM(B2:B{ws.max_row})',
    f'=SUM(C2:C{ws.max_row})',
    f'=SUM(D2:D{ws.max_row})',
    f'=SUM(E2:E{ws.max_row})'
])

# Formatting
header_fill = PatternFill('solid', fgColor='366092')
header_font = Font(bold=True, color='FFFFFF')

for cell in ws[1]:
    cell.fill = header_fill
    cell.font = header_font
    cell.alignment = Alignment(horizontal='center')

# Currency format
for row in ws.iter_rows(min_row=2, min_col=2, max_col=5):
    for cell in row:
        cell.number_format = '$#,##0.00'

# Column widths
ws.column_dimensions['A'].width = 15
for col in range(2, 6):
    ws.column_dimensions[get_column_letter(col)].width = 12

wb.save('budget_2024.xlsx')
```

### Example 2: Sales Dashboard
```python
from openpyxl import Workbook
from openpyxl.chart import BarChart, PieChart, Reference
from openpyxl.styles import Font, PatternFill

wb = Workbook()
ws = wb.active
ws.title = "Sales Dashboard"

# Data
ws.append(['Region', 'Q1', 'Q2', 'Q3', 'Q4'])
data = [
    ['North', 150000, 165000, 180000, 195000],
    ['South', 120000, 125000, 140000, 155000],
    ['East', 180000, 190000, 210000, 225000],
    ['West', 95000, 110000, 125000, 140000],
]
for row in data:
    ws.append(row)

# Bar Chart
data_ref = Reference(ws, min_col=2, min_row=1, max_col=5, max_row=5)
cats_ref = Reference(ws, min_col=1, min_row=2, max_row=5)

bar = BarChart()
bar.type = "col"
bar.title = "Quarterly Sales by Region"
bar.add_data(data_ref, titles_from_data=True)
bar.set_categories(cats_ref)
bar.height = 10
bar.width = 15
ws.add_chart(bar, "A8")

# Pie Chart - Q4 breakdown
pie_data = Reference(ws, min_col=5, min_row=1, max_row=5)
pie = PieChart()
pie.title = "Q4 Market Share"
pie.add_data(pie_data, titles_from_data=True)
pie.set_categories(cats_ref)
ws.add_chart(pie, "J8")

wb.save('sales_dashboard.xlsx')
```

## Limitations

- Cannot execute VBA macros
- Complex pivot tables not fully supported
- Limited sparkline support
- External data connections not supported
- Some advanced chart types unavailable

## Installation

```bash
pip install openpyxl
```

## Resources

- [openpyxl Documentation](https://openpyxl.readthedocs.io/)
- [GitHub Repository](https://github.com/theorchard/openpyxl)
- [Working with Styles](https://openpyxl.readthedocs.io/en/stable/styles.html)
