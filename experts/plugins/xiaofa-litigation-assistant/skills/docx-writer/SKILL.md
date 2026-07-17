---
name: docx-writer
description: |
  将法律文书内容生成为 DOCX 文件（python-docx）。覆盖起诉状、强制执行申请书、利息计算表三个场景。
  用户无需 MD 编辑器——Word/WPS 打开即编辑，填空位直接打字替换，A4 打印即可提交法院。
---

> **版本**：v1.0 | **日期**：2026-06-17
> **定位**：面向普通用户的 DOCX 文书生成器——轻量，零配置，python-docx 标准库


# DOCX 文书生成器

## 核心原则

1. **普通用户直接用**——输出 .docx，Word/WPS 打开即编辑，不需要技术工具
2. **填空位用下划线**——`______`，用户点进去直接打字替换，不需要"开发工具→控件"
3. **字体就两种**——标题 黑体 小二加粗，正文 仿宋 四号，表格 宋体 五号
4. **A4 标准页面**——上下 2.54cm，左右 3.17cm，段后 0.5 行
5. **不依赖 .NET**——纯 Python + python-docx，pip install 即可

## 禁止行为

- ❌ 生成 MD 格式的文书
- ❌ 使用 NPOI / OpenXML SDK（需要 .NET）
- ❌ 使用"开发工具→控件"方式做填空（普通用户不会操作）
- ❌ 使用复杂 Word 功能（分节符、页眉页脚、样式继承）

## 三个输出场景

### 场景 1：起诉状

**触发**：用户要求起草起诉状 / 生成起诉状 DOCX

**格式要求**：
- 标题："民事起诉状"，居中，黑体，小二，加粗
- 当事人信息：仿宋四号，"原告：______，身份证号：______，住址：______"
- 诉讼请求：仿宋四号，编号 "一、" "二、" "三、"
- 事实与理由：仿宋四号，正文
- 落款："此致\n______人民法院"，右对齐，"具状人：______\n日期：______"

**填空位**：所有真人信息处用 `______` 占位，不下划线（避免打印问题），用仿宋四号

### 场景 2：强制执行申请书

**触发**：用户要求申请强制执行 / 生成执行申请书 DOCX

**格式要求**：
- 标题："强制执行申请书"，居中，黑体，小二，加粗
- 申请人/被执行人信息：仿宋四号
- 申请事项：仿宋四号，含本金+利息+迟延履行金
- 执行依据：仿宋四号，含案号+判决生效日期
- 财产线索：仿宋四号（可留空，标注"以下如有线索请填写"）
- 落款：右对齐

### 场景 3：利息/诉讼费计算表

**触发**：用户要求计算利息 / 诉讼费 / 生成计算表格 DOCX

**格式要求**：
- 标题："利息计算明细" 或 "诉讼费用计算表"，居中，黑体，小二
- 用 Word 表格（`docx.table`），列：起算日 | 截止日 | 天数 | 本金 | 利率 | 利息 | 法条依据
- 表格：宋体五号，表头加粗，金额列右对齐
- 表格下方：计算结果汇总 + 计息公式说明

## 技术实现

```python
from docx import Document
from docx.shared import Pt, Cm, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

# ===== 页面设置 =====
def setup_page(doc):
    section = doc.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.54)
    section.bottom_margin = Cm(2.54)
    section.left_margin = Cm(3.17)
    section.right_margin = Cm(3.17)

# ===== 字体工具 =====
def set_font(run, name_cn, name_en, size, bold=False):
    run.font.size = Pt(size)
    run.bold = bold
    run.font.name = name_en
    r = run._element
    r.rPr.rFonts.set(qn('w:eastAsia'), name_cn)

def add_title(doc, text):
    """黑体小二加粗居中"""
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(12)
    run = p.add_run(text)
    set_font(run, '黑体', 'SimHei', 18, bold=True)

def add_body(doc, text):
    """仿宋四号"""
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.first_line_indent = Pt(28)  # 两个字符缩进
    run = p.add_run(text)
    set_font(run, '仿宋', 'FangSong', 14)

def add_blank_line(doc, text):
    """仿宋四号，不缩进（用于当事人信息/填空行）"""
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    run = p.add_run(text)
    set_font(run, '仿宋', 'FangSong', 14)

def add_signature(doc, text):
    """仿宋四号右对齐（用于落款）"""
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run(text)
    set_font(run, '仿宋', 'FangSong', 14)

# ===== 表格工具 =====
def create_table(doc, headers, rows):
    """创建宋体五号表格，表头加粗深蓝底白字"""
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = 'Table Grid'
    
    # 表头
    header_cells = table.rows[0].cells
    for i, h in enumerate(headers):
        header_cells[i].text = ''
        p = header_cells[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(h)
        set_font(run, '宋体', 'SimSun', 10.5, bold=True)
        # 深蓝背景
        shading = header_cells[i]._element.get_or_add_tcPr()
        shd = shading.makeelement(qn('w:shd'), {
            qn('w:fill'): '1F3864',
            qn('w:val'): 'clear'
        })
        shading.append(shd)
        run.font.color.rgb = RGBColor(255, 255, 255)
    
    # 数据行
    for r, row in enumerate(rows):
        cells = table.rows[r + 1].cells
        for c, val in enumerate(row):
            cells[c].text = ''
            p = cells[c].paragraphs[0]
            # 金额列右对齐
            if c >= len(headers) - 2:
                p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            run = p.add_run(str(val))
            set_font(run, '宋体', 'SimSun', 10.5)
    
    doc.add_paragraph()  # 表后空行
    return table

# ===== 用法示例 =====
def make_complaint(output_path, data):
    """生成起诉状 DOCX"""
    doc = Document()
    setup_page(doc)
    
    add_title(doc, '民事起诉状')
    
    add_blank_line(doc, f'原告：______，身份证号：______')
    add_blank_line(doc, f'住址：______，联系电话：______')
    add_blank_line(doc, f'被告：______，身份证号/统一社会信用代码：______')
    add_blank_line(doc, f'住址：______')
    
    doc.add_paragraph()
    add_blank_line(doc, '诉讼请求：')
    for i, req in enumerate(data.get('claims', []), 1):
        add_body(doc, f'{num_to_cn(i)}、{req}')
    
    doc.add_paragraph()
    add_blank_line(doc, '事实与理由：')
    for para in data.get('facts', []):
        add_body(doc, para)
    
    doc.add_paragraph()
    add_signature(doc, '此致')
    add_signature(doc, '______人民法院')
    doc.add_paragraph()
    add_signature(doc, '具状人：______')
    add_signature(doc, '日期：______')
    
    doc.save(output_path)
    return output_path

def num_to_cn(n):
    """数字转中文大写序号"""
    return ['一','二','三','四','五','六','七','八','九','十'][n-1]

def make_enforcement(output_path, data):
    """生成强制执行申请书 DOCX"""
    doc = Document()
    setup_page(doc)
    
    add_title(doc, '强制执行申请书')
    
    add_blank_line(doc, f'申请人：______，身份证号：______')
    add_blank_line(doc, f'住址：______，联系电话：______')
    add_blank_line(doc, f'被执行人：______，身份证号/统一社会信用代码：______')
    add_blank_line(doc, f'住址：______')
    
    doc.add_paragraph()
    add_blank_line(doc, '申请事项：')
    add_body(doc, f'一、强制被执行人支付本金 ______ 元及利息 ______ 元')
    add_body(doc, '二、强制被执行人支付迟延履行期间的加倍债务利息')
    add_body(doc, '三、执行费用由被执行人承担')
    
    doc.add_paragraph()
    add_blank_line(doc, '执行依据：')
    add_body(doc, f'______人民法院（______）______号民事判决书，已于 ______ 年 ______ 月 ______ 日生效。')
    
    doc.add_paragraph()
    add_blank_line(doc, '财产线索（以下如有线索请填写）：')
    add_body(doc, '1. 银行账户：______')
    add_body(doc, '2. 车辆：______')
    add_body(doc, '3. 房产：______')
    add_body(doc, '4. 其他：______')
    
    doc.add_paragraph()
    add_signature(doc, '此致')
    add_signature(doc, '______人民法院')
    doc.add_paragraph()
    add_signature(doc, '申请人：______')
    add_signature(doc, '日期：______')
    
    doc.save(output_path)
    return output_path

def make_calculation_table(output_path, title, headers, rows, note):
    """生成计算表 DOCX"""
    doc = Document()
    setup_page(doc)
    
    add_title(doc, title)
    create_table(doc, headers, rows)
    
    if note:
        add_body(doc, note)
    
    doc.save(output_path)
    return output_path
```

## 执行流程

```
用户要求生成文书（起诉状/申请书/计算表）
  → 1. 从对话中提取所有已知信息（姓名、金额、日期、案号等）
  → 2. 未知信息用"______"填空（绝不编造）
  → 3. 调用 python-docx 按对应场景生成 .docx
  → 4. 告知用户文件路径，提醒："用 Word 打开，在横线上填写你的信息"
  → 5. 列出来源标注（哪些信息来自对话、哪些需要用户补充）
```

## 与其他技能的衔接

| 上游技能 | 提供内容 | 本技能输出 |
|---------|---------|-----------|
| 强制执行 | 申请书内容+利息数据 | 强制执行申请书.docx + 利息计算明细.docx |
| legal-calculator | 利息/诉讼费计算结果 | 利息计算明细.docx |
| agent MD Step 2 | 起诉状模板内容 | 民事起诉状.docx |

当用户说"帮我生成起诉状文档"或"导出成 Word"时，自动调用本技能。
