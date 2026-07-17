---
name: legal-verification-workbench
description: 法律检索核验工作台。任务单出现【核验工作台：必用】、【输出档位：重量】或输出形态属于全面合规检索、文书引用素材、诉讼仲裁支撑、非诉文书检索、企业合规体检、案例专题分析、刑事量刑参考、行政复议证据时必须使用。本 skill 执行脚本化动作：保存 answer/sources/claims，运行 legal-verify all/html/repair-* 生成模板 HTML；禁止手写 HTML。
---

# 法律检索核验工作台

本工作台是重量级法律检索任务的脚本化执行终点：**接收已经定稿的正文和真实检索来源，运行 `legal-verify` 生成一份可点击溯源的 HTML 报告。** 任务单标记【核验工作台：必用】时必须进入本工作台，不能由其他步骤手写 HTML 替代。

它不判断 AI 回答最终对错，不替用户作法律结论；只给三个客观标签：

- **已关联**：回答声明的来源/条文在本次资料库中真实存在，可点击查看原文。
- **弱关联**：来源相关但条号或直接依据需人工核对。
- **待核验**：本次资料库没有可溯源依据，不等于错误。

## 何时启用

| 档位 | 场景 | 做法 |
|---|---|---|
| 轻量 | 单条法条、效力查询、公众简易咨询 | 对话内联给来源链接，不用工作台 |
| 中量 | 事实关联法规、教学案例 | 默认内联；高风险、要存档/入文书、用户要求逐条出处时升级 |
| 重量 | 全面合规检索、文书引用素材、诉讼仲裁支撑、非诉文书检索、企业合规体检、案例专题分析、刑事量刑参考、行政复议证据 | 启用工作台，生成 HTML 报告 |

判断锚点：**输出形态 + 用户拿去做什么 + 风险等级 + 是否需要成体系交付**。任务单写有【核验工作台：必用】时，必须执行本工作台；所有重量级输出形态均为必用。

## 标准流程

0. **检索即捕获（新增强制步骤）**：凡本轮任务调用过 WebSearch/WebFetch、北大法宝、华宇元典、用户自有 Skill/MCP 或其他检索工具，必须把每一批返回资料先写入检索批次 JSON，并运行 `legal-verify capture`。这样资料同时存在于上下文中供推理，也进入任务级 `raw-search/` 与可段落化 `sources/index`，避免后续核验工作台只能面对一段无来源文本。只拿到标题/摘要的搜索结果会被保存到 `raw-search/`，但不会作为可引用来源；必须继续读取网页/文档全文后再次 capture。
1. **定稿正文**：先按场景写好最终意见，原样保存为 `answer.md`。不要为了核验改写正文。
2. **整理来源**：优先使用 capture 已入库的资料；如仍需手工补充，把本次真实检索到、报告会用到的资料写入 `sources.json` 并运行 `legal-verify persist`。不得只在聊天上下文里保留来源。
3. **声明依据**：通读定稿，对关键法律句子写 `claims.json`，声明它对应的来源和条号。
4. **一键生成首轮报告**：运行 `legal-verify all`。这是首轮稿，不等于最终交付稿。
5. **强制读取补检门禁**：查看 `repairRequired`、`supplementalQueuePath`、`supplementalQueueCount`、`sourceFulltextQueuePath`、`sourceFulltextIssueCount`、`sourceFulltextBlockerCount`、`health.deliveryBlocked`、`health.gates` 和 `health.warnings`。只要 `repairRequired:true`、`health.ok:false` 或 `health.deliveryBlocked:true`，不得交付首轮 HTML。
6. **先补全文，再补关联**：若 `sourceFulltextBlockerCount>0` 或 `health.gates` 含 `source_fulltext_required`，先打开 `sourceFulltextQueuePath`，逐条用 WebFetch/官方库/MCP detail 工具读取全文并再次 `capture`；不要直接对残缺资料做语义补联。`sourceFulltextReviewCount` 仅为复核提示，但重量级报告也应确认后再交付。
7. **补充检索/补充关联（强制门禁触发时）**：若统计中弱关联/待核验比例过高，或正文有未高亮但明显需要法律依据的内容，使用补检队列逐条语义判断；补到真实依据后应用补充关联并重建 HTML；确认无需独立依据的点必须 `ignore` 并从最终可见统计中抑制。
8. **看返回结果**：`success:false` 必须修复后重跑；`health.ok:false`、`health.deliveryBlocked:true` 或 `repairRequired:true` 必须完成补全文/补检闭环后再交付。

## 输入格式

### sources.json

推荐顶层对象，也兼容裸数组。每条来源必须包含可溯源正文：

```json
{
  "sources": [
    {
      "title": "中华人民共和国个人信息保护法",
      "sourceType": "law",
      "provider": "pkulaw",
      "status": "现行有效",
      "url": "https://...",
      "content": "第二十九条 处理敏感个人信息应当取得个人的单独同意。"
    }
  ]
}
```

硬规则：**没有 `content` 就不要入库，也不要生成核验报告。** `title/url/doc_no` 不能替代原文。

### claims.json

推荐格式：

```json
{
  "claims": [
    {
      "claimText": "处理敏感个人信息应取得个人的单独同意",
      "sourceTitle": "中华人民共和国个人信息保护法",
      "articleNo": "第29条"
    }
  ]
}
```

要点：
- `claimText` 必须逐字摘自 `answer.md`，用于定位高亮。
- 优先用 `sourceTitle`；不要让 AI 自己编 12 位 sourceId。
- 条文用 `articleNo`，案例用 `caseNo`。

## 命令

### 命令执行方式

优先使用专家包内 CLI：`<expert>/bin/legal-verify`。如果运行时出现 `permission denied` 或当前环境未把该文件作为可执行脚本处理，改用 Node 直接执行：

```bash
node <expert>/bin/legal-verify <command> <args>
```

不要因为 CLI 权限或 PATH 问题跳过核验工作台，也不要改为手写 HTML。

### 检索批次捕获（检索后立即执行）

```bash
legal-verify init --query "用户原始问题" --title "合规分析报告" --out "output/合规分析报告.html"
legal-verify capture --task <taskDir> --input retrieval-batch-001.json --provider web
legal-verify audit-sources --task <taskDir>
```

`retrieval-batch-001.json` 可接收 `{"results":[...]}`、`{"sources":[...]}` 或裸数组；单条结果字段可为 `title/url/content/markdown/text/body/fullText/snippet/metadata` 等。`capture` 会：

- 将整批原始结果写入 `raw-search/{batchId}.json` 与 `raw-search/{batchId}.md`；
- 对带全文的结果自动转成 `sources/*.md`、`sources/*.json` 并重建 `index/paragraphs.jsonl`、`article_index.json`、`source_index.json`；
- 对只有标题/摘要、没有正文的结果只存 raw-search 并返回 warning，提醒继续读取全文后再次 capture。

随后运行 `audit-sources`。它会生成 `verification/source-fulltext-queue.json`，列出需要补取全文的 URL、摘要-only 结果、正文过短或带“展开全文/摘要/…”等截断迹象的来源。

只有在明确接受降级时才使用 `--allow-snippet`；否则不要把搜索摘要当作可引用原文。

### 生成核验报告

```bash
node <expert>/bin/legal-verify all \
  --query "用户原始问题" \
  --sources sources.json \
  --answer answer.md \
  --claims claims.json \
  --title "合规分析报告" \
  --out "output/合规分析报告.html"
```

也可分步执行：

```bash
legal-verify init --query "..." --title "合规分析报告" --out "output/合规分析报告.html"
legal-verify capture --task <taskDir> --input retrieval-batch-001.json --provider web
legal-verify audit-sources --task <taskDir>
legal-verify persist --task <taskDir> --input sources.json
legal-verify build --task <taskDir> --answer answer.md --claims claims.json
legal-verify html --task <taskDir>
```

## 补充检索与补充关联

这是核验工作台的二次修复能力，不能省略。它用于处理首轮报告中仍然存在的明显弱关联/待核验点，或者正文里未高亮但明显需要法律依据的法律命题。

### 第一步：导出补检队列

```bash
legal-verify repair-export --task <taskDir> --out verification/supplemental-search-queue.json
```

队列会列出需要复核的点，包括原句、现有候选、推荐检索语句和 `aiReviewInstruction`。

### 第二步：AI 语义门控 + 补充检索

逐条判断：
- 若该句只是前一句已关联依据后的解释、推论、总结或重复内容，写 `action:"ignore"`，不要为了提高关联率硬补弱关联。
- 若该句独立提出新的法规条款、监管义务、权利义务边界或法律后果，先用工具发现能力查找并优先调用北大法宝 `mcp__pkulaw__mcp-law-search-service/search_article`、`mcp__pkulaw__mcp-law-search-service/get_article`、`mcp__pkulaw__mcp-law/get_law_list`，以及华宇元典/其他法律 MCP/Skill；专业库不可用或结果不足时，再用官方来源或公开可核验来源补充检索，取得真实原文；不要向用户说明工具选择或连接状态。
- 若原报告条号或说法错误，应补检后修正对应依据并在 `correctionNote` 说明。

补检结果写成：

```json
{
  "findings": [
    {
      "pointId": "vp-001",
      "action": "confirm",
      "source": {
        "title": "中华人民共和国个人信息保护法",
        "sourceType": "law",
        "provider": "pkulaw",
        "status": "现行有效",
        "url": "https://...",
        "content": "第六条 ..."
      },
      "claim": {
        "claimText": "逐字摘自 answer.md 的原句",
        "sourceTitle": "中华人民共和国个人信息保护法",
        "articleNo": "第6条"
      },
      "correctionNote": "补充检索确认该句依据为第六条"
    }
  ]
}
```

### 第三步：应用补充关联并重建 HTML

```bash
legal-verify repair-apply --task <taskDir> --input supplemental-findings.json
legal-verify html --task <taskDir>
```

`repair-apply` 会把补充来源写入来源库、追加/修正 claims，并重新执行匹配。最终仍只交付 `htmlPath` 指向的 HTML 报告。

## 脚本门禁

为减少 AI 手工规则负担，关键检查由脚本完成：

- `--sources` / `--input` JSON 解析失败：直接失败，不生成报告。
- `capture` 只要拿到检索结果就会保存 raw-search；但只有含 `content/markdown/text/body/fullText` 的结果才进入可引用 `sources/index`。只有标题/摘要时必须继续读取全文。
- `audit-sources` 会输出 `source-fulltext-queue.json`；若发现摘要-only、正文截断、来源无段落或 `status:不完整`，`health.deliveryBlocked:true`，必须先补全文。
- 来源为空或总段落数为 0：直接失败。
- 默认每条 source 必须有 `content`；特殊降级必须显式传 `--allow-degraded`。
- 传入 `--claims` 但解析出 0 条有效声明：直接失败。
- `claims.json` JSON 解析失败：直接失败。
- `health.ok:false`、`health.deliveryBlocked:true` 或 `repairRequired:true` 会输出补全文/补检门禁信息；此时不得交付首轮 HTML，必须先处理 `sourceFulltextQueuePath` 与 `supplementalQueuePath` 后重建。
- `assert-html` 不再只是模板检查；若 HTML 内仍有较高弱关联/待核验比例，也会验收失败，强制回到动态检索策略。

## 交付前检查

最终只交付 `htmlPath` 指向的 HTML 报告。它必须由模板渲染，页面应包含：深色标题栏、黄色说明条、筛选按钮、统计条、左右双栏、右侧“关联依据/来源资料库”两个 tab、导出 Word/Excel/PDF 按钮。

交付前运行：

```bash
legal-verify assert-html --html <htmlPath>
```

该命令不通过时，可能是报告不是核验工作台模板产物，也可能是弱关联/待核验仍未闭环。必须重新运行 `legal-verify all/html` 或回到补全文/补检队列修复。不要把 `answer.md`、`sources.json`、`claims.json`、手写 HTML 或临时 HTML 当正式报告交付。

## References

- `references/virtual-memory-schema.md` — sources 输入与任务目录结构
- `references/verification-point-spec.md` — claims 与核验点规范
- `references/evidence-matching-spec.md` — 三类核验标签与匹配逻辑
- `references/html-report-spec.md` — HTML 报告结构
