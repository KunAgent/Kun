---
# ═══════════════════════════════════════════════════════════════════════════════
# CLAUDE OFFICE SKILL - Enhanced Metadata v2.0
# ═══════════════════════════════════════════════════════════════════════════════

# Basic Information
name: docx-manipulation
description: "Create, edit, and manipulate Word documents programmatically using python-docx"
version: "1.0"
author: claude-office-skills
license: MIT

# Categorization
category: document
tags:
  - docx
  - word
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
    - create_docx
    - extract_text_from_docx
    - fill_docx_template
    - merge_docx_files

# Skill Capabilities
capabilities:
  - document_creation
  - editing
  - template_handling

# Language Support
languages:
  - en
  - zh
---

# DOCX Manipulation Skill

## Overview

This skill enables programmatic creation, editing, and manipulation of Microsoft Word (.docx) documents using the **python-docx** library. Create professional documents with proper formatting, styles, tables, and images without manual editing.

## How to Use

1. Describe what you want to create or modify in a Word document
2. Provide any source content (text, data, images)
3. I'll generate python-docx code and execute it

**Example prompts:**
- "Create a professional report with title, headings, and a table"
- "Add a header and footer to this document"
- "Generate a contract document with placeholders"
- "Convert this markdown content to a styled Word document"

## Domain Knowledge

### python-docx Fundamentals

```python
from docx import Document
from docx.shared import Inches, Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.style import WD_STYLE_TYPE

# Create new document
doc = Document()

# Or open existing
doc = Document('existing.docx')
```

### Document Structure
```
Document
├── sections (margins, orientation, size)
├── paragraphs (text with formatting)
├── tables (rows, cells, merged cells)
├── pictures (inline images)
└── styles (predefined formatting)
```

### Adding Content

#### Paragraphs & Headings
```python
# Add heading (level 0-9)
doc.add_heading('Main Title', level=0)
doc.add_heading('Section Title', level=1)

# Add paragraph
para = doc.add_paragraph('Normal text here')

# Add styled paragraph
doc.add_paragraph('Note: Important!', style='Intense Quote')

# Add with inline formatting
para = doc.add_paragraph()
para.add_run('Bold text').bold = True
para.add_run(' and ')
para.add_run('italic text').italic = True
```

#### Tables
```python
# Create table
table = doc.add_table(rows=3, cols=3)
table.style = 'Table Grid'

# Add content
table.cell(0, 0).text = 'Header 1'
table.rows[0].cells[1].text = 'Header 2'

# Add row dynamically
row = table.add_row()
row.cells[0].text = 'New data'

# Merge cells
a = table.cell(0, 0)
b = table.cell(0, 2)
a.merge(b)
```

#### Images
```python
# Add image with size
doc.add_picture('image.png', width=Inches(4))

# Add to specific paragraph
para = doc.add_paragraph()
run = para.add_run()
run.add_picture('logo.png', width=Inches(1.5))
```

### Formatting

#### Paragraph Formatting
```python
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, Inches

para = doc.add_paragraph('Formatted text')
para.alignment = WD_ALIGN_PARAGRAPH.CENTER
para.paragraph_format.line_spacing = 1.5
para.paragraph_format.space_after = Pt(12)
para.paragraph_format.first_line_indent = Inches(0.5)
```

#### Character Formatting
```python
run = para.add_run('Styled text')
run.bold = True
run.italic = True
run.underline = True
run.font.name = 'Arial'
run.font.size = Pt(14)
run.font.color.rgb = RGBColor(0x00, 0x00, 0xFF)  # Blue
```

#### Page Setup
```python
from docx.enum.section import WD_ORIENT
from docx.shared import Inches

section = doc.sections[0]
section.page_width = Inches(11)
section.page_height = Inches(8.5)
section.orientation = WD_ORIENT.LANDSCAPE
section.left_margin = Inches(1)
section.right_margin = Inches(1)
```

### Headers & Footers
```python
section = doc.sections[0]

# Header
header = section.header
header.paragraphs[0].text = "Company Name"
header.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

# Footer with page numbers
footer = section.footer
para = footer.paragraphs[0]
para.text = "Page "
# Add page number field
run = para.add_run()
fldChar1 = OxmlElement('w:fldChar')
fldChar1.set(qn('w:fldCharType'), 'begin')
run._r.append(fldChar1)
# ... (field code for page number)
```

### Styles
```python
# Use built-in styles
doc.add_paragraph('Heading', style='Heading 1')
doc.add_paragraph('Quote', style='Quote')
doc.add_paragraph('List item', style='List Bullet')

# Common styles:
# - 'Normal', 'Heading 1-9', 'Title', 'Subtitle'
# - 'Quote', 'Intense Quote', 'List Bullet', 'List Number'
# - 'Table Grid', 'Light Shading', 'Medium Grid 1'
```

## Best Practices

1. **Structure First**: Plan document hierarchy before coding
2. **Use Styles**: Consistent formatting via styles, not manual formatting
3. **Save Often**: Call `doc.save()` periodically for large documents
4. **Handle Errors**: Check file existence before opening
5. **Clean Up**: Remove template placeholders after filling

## Common Patterns

### Report Template
```python
def create_report(title, sections):
    doc = Document()
    doc.add_heading(title, 0)
    doc.add_paragraph(f'Generated: {datetime.now()}')
    
    for section_title, content in sections.items():
        doc.add_heading(section_title, 1)
        doc.add_paragraph(content)
    
    return doc
```

### Table from Data
```python
def add_data_table(doc, headers, rows):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = 'Table Grid'
    
    # Headers
    for i, header in enumerate(headers):
        table.rows[0].cells[i].text = header
        table.rows[0].cells[i].paragraphs[0].runs[0].bold = True
    
    # Data rows
    for row_data in rows:
        row = table.add_row()
        for i, value in enumerate(row_data):
            row.cells[i].text = str(value)
    
    return table
```

### Mail Merge Pattern
```python
def fill_template(template_path, replacements):
    doc = Document(template_path)
    
    for para in doc.paragraphs:
        for key, value in replacements.items():
            if f'{{{key}}}' in para.text:
                para.text = para.text.replace(f'{{{key}}}', value)
    
    return doc
```

## Examples

### Example 1: Create a Business Letter
```python
from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from datetime import datetime

doc = Document()

# Letterhead
doc.add_paragraph('ACME Corporation')
doc.add_paragraph('123 Business Ave, Suite 100')
doc.add_paragraph('New York, NY 10001')
doc.add_paragraph()

# Date
doc.add_paragraph(datetime.now().strftime('%B %d, %Y'))
doc.add_paragraph()

# Recipient
doc.add_paragraph('Mr. John Smith')
doc.add_paragraph('XYZ Company')
doc.add_paragraph('456 Industry Blvd')
doc.add_paragraph('Chicago, IL 60601')
doc.add_paragraph()

# Salutation
doc.add_paragraph('Dear Mr. Smith,')
doc.add_paragraph()

# Body
body = """We are pleased to inform you that your proposal has been accepted...

[Letter body continues...]

Thank you for your continued partnership."""

for para_text in body.split('\n\n'):
    doc.add_paragraph(para_text)

doc.add_paragraph()
doc.add_paragraph('Sincerely,')
doc.add_paragraph()
doc.add_paragraph()
doc.add_paragraph('Jane Doe')
doc.add_paragraph('CEO, ACME Corporation')

doc.save('business_letter.docx')
```

### Example 2: Create a Report with Table
```python
from docx import Document
from docx.shared import Inches

doc = Document()
doc.add_heading('Q4 Sales Report', 0)

# Executive Summary
doc.add_heading('Executive Summary', 1)
doc.add_paragraph('Q4 2024 showed strong growth across all regions...')

# Sales Table
doc.add_heading('Regional Performance', 1)

table = doc.add_table(rows=1, cols=4)
table.style = 'Medium Grid 1 Accent 1'

headers = ['Region', 'Q3 Sales', 'Q4 Sales', 'Growth']
for i, header in enumerate(headers):
    table.rows[0].cells[i].text = header

data = [
    ['North America', '$1.2M', '$1.5M', '+25%'],
    ['Europe', '$800K', '$950K', '+18%'],
    ['Asia Pacific', '$600K', '$750K', '+25%'],
]

for row_data in data:
    row = table.add_row()
    for i, value in enumerate(row_data):
        row.cells[i].text = value

doc.save('sales_report.docx')
```

## Limitations

- Cannot execute macros or VBA code
- Complex templates may lose some formatting
- Limited support for advanced features (SmartArt, Charts)
- No direct PDF conversion (use separate tool)
- Track changes reading is limited

## Installation

```bash
pip install python-docx
```

## Resources

- [python-docx Documentation](https://python-docx.readthedocs.io/)
- [GitHub Repository](https://github.com/python-openxml/python-docx)
- [Office Open XML Spec](https://docs.microsoft.com/en-us/office/open-xml/open-xml-sdk)
