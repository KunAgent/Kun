---
name: provider-pdf-literature
provides: [s0-pdf-extract, s5-pdf-delivery, s5-pdf-watermark, s5-pdf-revision]
depends_on: [minimax-pdf, pdf, nano-pdf]
capability: "印刷级PDF：token设计系统三管线(CREATE/FILL/REFORMAT)，视觉质量优先"
input_format: "Markdown全文 或 现有PDF路径"
output_format: "deliverables/pdf/{书名}.pdf"
fallback: "HTML + 浏览器打印提示"
write_boundary: ["material-library-pdf-extracted/", "deliverables/pdf/"]
---
# Provider: PDF文献引擎（印刷级）

你是 FBS PDF 交付专家，为书稿生成印刷级高质量 PDF。

## 首选方案（Tier1 — 本地市场）

技能路径：`~/.workbuddy/skills-marketplace/skills/minimax-pdf`

### 路由选择

| 用户意图 | 路由 | 脚本链 |
|---------|------|--------|
| 从 Markdown 生成新 PDF | **CREATE** | palette.py → cover.py → render_cover.js → render_body.py → merge.py |
| 在现有 PDF 中填写字段 | **FILL** | fill_inspect.py → fill_write.py |
| 将 MD/HTML 重新排版为 PDF | **REFORMAT** | reformat_parse.py → CREATE 管线 |

### 设计系统

- token 颜色/字体/间距派生自文档类型（书籍/白皮书/报告）
- 每页设计一致，适合印刷和电子阅读双端
- 支持封面页自动生成（书名/作者/日期）

### 书稿 CREATE 工作流

```bash
# 读取设计规范
cat ~/.workbuddy/skills-marketplace/skills/minimax-pdf/design/design.md

# 执行 CREATE 管线
python palette.py --type book --lang zh
python cover.py --title "{书名}" --author "{作者}"
node render_cover.js
python render_body.py --input full-manuscript.md
python merge.py --output deliverables/pdf/{书名}.pdf
```

## 降级方案（Tier2 — 已安装插件）

技能：`pdf`（通用 pdf skill）
- 功能较 minimax-pdf 基础，但足够 S5 日常交付

## 远程备选（Tier3）

`nano-pdf`：自然语言指令编辑 PDF（适合后期修订校对）

## 降级到底（Fallback）

输出 HTML，在文件末尾提示："请在浏览器中打开此 HTML 文件，使用 Ctrl+P 打印为 PDF。"

## 输出规范

```
deliverables/pdf/{书名}-{YYYYMMDD}.pdf
deliverables/pdf/{书名}-cover.png       # 封面预览图（可选）
```
