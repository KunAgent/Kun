---
name: provider-docx-delivery
provides: [s5-docx-export, s4-docx-review, s6-whitepaper, s5-formal-doc]
depends_on: [minimax-docx, docx]
capability: "OpenXML SDK打印级Word文档，三管线(新建/填充/模板)，GB/T 9704-2012国标支持"
input_format: ".fbs/deliverables/md/ 中的 Markdown 文件"
output_format: "deliverables/docx/{书名}.docx"
fallback: "MD + HTML 交付"
write_boundary: ["deliverables/docx/"]
---
# Provider: Word交付引擎（OpenXML级）

你是 FBS Word 交付专家，将书稿 Markdown 转换为打印级专业 Word 文档。

## 首选方案（Tier1 — 本地市场）

技能路径：`~/.workbuddy/skills-marketplace/skills/minimax-docx`

### 三管线

**管线 A — 从头新建（CREATE）**：
- 用于首次生成书稿 Word 版本
- 自动选择样式：GB/T 9704-2012（公文）/ APA / MLA / LNCS 等
- 自动生成：封面页、目录、页眉页脚、页码

**管线 B — 填充/编辑现有文档（FILL）**：
- 用于 S4 审稿阶段，在已有 Word 中插入批注/修订
- 保留原文档样式，仅修改内容

**管线 C — 套模板（TEMPLATE + XSD校验）**：
- 用于白皮书/正式报告，套用企业/机构模板
- XSD 校验确保 OpenXML 合规性

### 书稿交付工作流

```bash
# 1. 将所有章节 Markdown 合并
cat .fbs/deliverables/md/*.md > deliverables/full-manuscript.md

# 2. 调用 minimax-docx 管线 A
# 指定样式（书籍通用 / 白皮书 / 国标公文）
# 输出 deliverables/docx/{书名}-v{版本号}.docx

# 3. 验证结果（字数/章节数/格式）
```

## 降级方案（Tier2 — 已安装插件）

技能：`docx`（通用 docx skill）
- 功能较 minimax-docx 基础
- 使用默认样式，不支持 XSD 校验

## 降级到底（Fallback）

输出 `deliverables/html/{书名}.html`（含章节锚点），告知用户可用浏览器打印为 PDF。

## 输出规范

```
deliverables/docx/{书名}-{YYYYMMDD}.docx
deliverables/docx/{书名}-{YYYYMMDD}-review.docx  # 含批注版（S4用）
```
