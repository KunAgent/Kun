# S5 全格式交付 SOP（Plugin Bus v3.0）

> **版本**：3.0 · **日期**：2026-04-11  
> **适用阶段**：S5 交付 + S6 内容转化  
> **核心变化（v3.0）**：所有格式均通过三层 Provider 架构支持，Tier1 本地技能优先

---

## 一、S5 交付 SOP（书稿正式交付）

### 前置检查

```bash
# 确认 S4 质检已通过
cat .fbs/qc-output/latest-summary.json | grep '"passed": true'

# 确认章节台账完整
node scripts/verify-expected-artifacts.mjs --book-root {bookRoot} --expect-all-chapters
```

### 1. DOCX 交付流程（Tier1 优先）

```
Step 1: 检测 minimax-docx 是否可用
  → ls ~/.workbuddy/skills-marketplace/skills/minimax-docx/
  → 可用：进入 Tier1 管线
  → 不可用：降级到 Tier2 (docx 插件)

Step 2 (Tier1): minimax-docx 管线 A（CREATE）
  → 将 .fbs/deliverables/md/*.md 合并为全稿
  → 选择样式：书籍通用 / 白皮书 / 国标公文（根据 genreTag）
  → 生成封面、目录、页眉页脚
  → 输出 deliverables/docx/{书名}-v{版本号}.docx

Step 2 (Tier2): docx 插件
  → 同样流程，样式较基础

Step 2 (Fallback): MD + HTML
  → deliverables/html/{书名}.html（含章节锚点导航）
  → 告知用户："Word 交付不可用，已生成 HTML 版本，可用浏览器打印为 PDF"

Step 3: 状态记录
  → .fbs/chapter-status.md 所有章节标注 "s5-docx-delivered"
```

### 2. PDF 交付流程（Tier1 优先）

```
Step 1: 检测 minimax-pdf 是否可用
  → 可用：Tier1 CREATE 管线（印刷级设计系统）
  → 不可用：降级到 Tier2 (pdf 插件)
  → 均不可用：HTML fallback + 浏览器打印提示

Step 2 (Tier1): minimax-pdf CREATE 管线
  → python palette.py（颜色/字体/间距 token）
  → python cover.py（封面设计）
  → python render_body.py（内文排版）
  → python merge.py → deliverables/pdf/{书名}.pdf

Step 3 (可选): nano-pdf 后期校对修订
  → 使用自然语言指令修改 PDF 细节
  → 适合最终发布前的微调
```

### 3. PPTX 交付流程（Tier1 优先，按需）

触发条件：用户要求"做一个配套 PPT"或 S6 培训转化

```
Step 1: 检测 deck-generator 是否可用
  → 可用：Tier1（AI 图片 + Google Slides API）
  → 不可用：降级到 Tier2 (pptx 插件)
  → 均不可用：Markdown 大纲

Step 2 (Tier1): deck-generator
  → 将书稿大纲/摘要转换为幻灯片内容规格
  → 选择视觉风格（whiteboard/corporate/minimalist）
  → 生成 deliverables/pptx/{书名}-{用途}.pptx
```

### 4. XLSX 数据表（Tier1 优先，按需）

触发条件：书稿含大量数据、需要索引表或质检仪表盘

```
minimax-xlsx(Tier1) → xlsx(Tier2) → Markdown表格(fallback)
输出：deliverables/xlsx/{书名}-index.xlsx 等
```

---

## 二、S6 内容转化 SOP

### 触发时机

- 用户说"把书转化为课程/PPT/公众号文章/播客"
- 用户说"S6 转化"
- S5 交付完成后，team-lead 主动询问是否需要 S6

### 转化流程

```
Step 1: 确认转化类型（可多选）
  □ 白皮书/正式报告 → provider-docx-delivery
  □ 培训课件/PPT → provider-pptx-delivery
  □ 数据报告 → provider-xlsx-data
  □ 社交媒体内容 → provider-content-transform (content-factory)
  □ 学习产品 → provider-learning-products (notebooklm-studio)
  □ 书名/文案优化 → provider-copy-optimizer (autoresearch)

Step 2: 依次执行，每个转化完成后通报结果

Step 3: S6 汇总报告
  → .fbs/[S6]-content-units.md（已生成的内容单元）
  → .fbs/[S6]-product-roadmap.md（未来可继续转化的产品路线图）
  → .fbs/[S6]-release-map.md（发布映射）
```

---

## 三、Provider 状态通报模板

每个 Provider 完成后输出：

```
✅ [Provider] {provider_name} (Tier{N})：{结果描述}
   输出位置：{deliverables/路径}
   文件大小：{大小}（如适用）
```

或失败时：

```
⚠️ [Provider] {provider_name} (Tier{N}) 降级：{原因}
   已切换至：{Tier{N+1} 或 Fallback}
   影响：{影响评估}
```
