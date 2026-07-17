# 虚拟记忆库结构（virtual-memory-schema）

WorkBuddy 没有 LawBuddy 的会话文件区 / Prisma / 预览栏状态，因此本工作台自建**任务级本地虚拟记忆库**。每个任务一个目录，默认在当前工作目录下：

```text
.legal-search-memory/
└── {taskId}/                      # 形如 20260620-103000-a1b2c3
    ├── manifest.json              # 任务清单，串联全部状态
    ├── answer.md                  # 专家最终回答（待核验文本）
    ├── raw-search/
    │   ├── {batchId}.json         # 每次检索工具返回的原始批次，完整保留
    │   └── {batchId}.md           # 同批次可读版，便于人工排查
    ├── sources/
    │   ├── {sourceId}.md          # 来源 Markdown（YAML frontmatter + [PN] 段落）
    │   └── {sourceId}.json        # 来源元数据 + 段落结构化数据
    ├── index/
    │   ├── paragraphs.jsonl       # 全部段落，每行一段
    │   ├── source_index.json      # 来源索引（标题/归一化标题/类型/状态/案号）
    │   ├── article_index.json     # 条文索引：{sourceId:{法名:{第13条:[P4]}}}
    │   └── inverted_index.json    # 关键词倒排：{token:["sourceId:P3"]}
    └── verification/
        ├── verification_points.json
        ├── evidence_matches.json
        ├── source-fulltext-queue.json     # 来源完整性补全文队列
        ├── supplemental-search-queue.json # 弱关联/待核验补检队列
        └── citations.json
    └── output/
        └── {reportTitle}.html       # 承载核验的最终报告：按场景命名（如 合规分析报告.html），未指定时为 法律依据溯源辅助报告.html
```

> `output/` 下这份 HTML 是**对外交付的最终报告**——正文是定稿意见、核验是内嵌的可关闭高亮层；核验不另起独立文件。其余文件（`answer.md`/`sources/`/`index/`/`verification/`）都是**过程文件**，留在记忆库内，不对外交付。（任务整体要交几份产物，仍由场景/系统/用户需求决定。）

## ID 规则

- `taskId`：时间戳 + 短随机串，如 `20260620-103000-a1b2c3`。
- `sourceId`：`sha1(provider + "|" + title + "|" + (url||lawId)).slice(0,12)`，稳定且可去重——同一来源重复入库只更新不新增。
- `paragraphId`：`{sourceId}:P{index}`，index 从 1 开始；同一文件的 `[P42]` 永远指向同一段。

## manifest.json

```json
{
  "schemaVersion": "1.0",
  "taskId": "20260620-103000-a1b2c3",
  "createdAt": "2026-06-20T10:30:00+08:00",
  "query": "用户原始检索问题",
  "workspaceRoot": "/path/to/workspace",
  "reportTitle": "合规分析报告",
  "answerFile": "answer.md",
  "sourcesDir": "sources",
  "rawSearchDir": "raw-search",
  "indexDir": "index",
  "verificationDir": "verification",
  "outputHtml": "output/合规分析报告.html",
  "retrievalBatches": [
    {
      "batchId": "batch-20260620T103100Z-a1b2c3d4",
      "tool": "WebFetch",
      "rawFile": "raw-search/batch-20260620T103100Z-a1b2c3d4.json",
      "rawMarkdownFile": "raw-search/batch-20260620T103100Z-a1b2c3d4.md",
      "totalItems": 5,
      "persistedSources": 5,
      "skippedNoContent": 0
    }
  ],
  "sources": [
    {
      "sourceId": "ab12cd34ef56",
      "title": "中华人民共和国个人信息保护法",
      "sourceType": "law",
      "provider": "official",
      "status": "现行有效",
      "url": "",
      "file": "sources/ab12cd34ef56.md",
      "metaFile": "sources/ab12cd34ef56.json",
      "paragraphCount": 82,
      "caseNo": "",
      "createdAt": "2026-06-20T10:31:00+08:00",
      "updatedAt": "2026-06-20T10:31:00+08:00"
    }
  ]
}
```

## capture 输入：retrieval-batch.json

`capture-retrieval-batch.mjs` / `legal-verify capture` 用于把每次检索工具返回的资料先持久化，再把有正文的资料自动送入 `persist` 段落库。它支持 WebSearch/WebFetch、北大法宝、华宇元典、用户自有 Skill/MCP 等不同来源的统一适配。

```json
{
  "query": "用户问题",
  "tool": "WebFetch",
  "provider": "web",
  "results": [
    {
      "title": "网页或文档标题",
      "url": "https://example.com/a",
      "sourceType": "web",
      "provider": "web",
      "content": "检索或读取到的网页/文档全文 Markdown 或相关原文",
      "metadata": { "retrievedBy": "WebFetch" }
    }
  ]
}
```

字段兼容：`results/sources/documents/items/data` 任一数组；单条结果兼容 `title/name/lawName/caseName`、`url/link/sourceUrl`、`content/markdown/text/body/fullText/rawContent`、`snippet/summary/abstract/description`。默认只把有全文字段的结果写入 `sources/index`；只有摘要的结果进入 `raw-search` 留痕，并提示继续读取全文。若显式传 `--allow-snippet`，摘要可降级入库，状态应标为 `不完整`。

## 来源完整性验收：source-fulltext-queue.json

`legal-verify audit-sources --task <taskDir>` 会扫描 `raw-search/` 与 `sources/`，识别以下阻断项：

- 检索批次只有标题/URL/摘要，没有 `content/markdown/text/body/fullText/rawContent`；
- 曾用 `--allow-snippet` 把摘要降级入库；
- 来源登记了但没有段落、`status:"不完整"`、正文含“展开全文/摘要/…/更多内容”等截断信号；
- 法律/案例/规范来源正文异常短，需要复核是否只是工具 observation 片段。

队列项包含 `title/url/snippet/searchQueries/expectedAction`。若队列存在 blocker，`health.deliveryBlocked:true`，必须先补取全文并重新 `capture`，再进入补检补关联。

## persist 输入：sources.json

`persist-legal-sources.mjs` / `legal-verify persist` 的输入格式（也支持 stdin）：

```json
{
  "taskId": "可选，不传且无 --task 则新建任务",
  "query": "用户问题",
  "sources": [
    {
      "title": "中华人民共和国个人信息保护法",
      "sourceType": "law",
      "provider": "official",
      "status": "现行有效",
      "url": "",
      "content": "法条/案例正文或与本报告有关的原文摘录（必填；脚本会自动段落化）",
      "metadata": { "lawId": "", "publishDate": "", "effectiveDate": "" }
    },
    {
      "title": "张某诉某公司个人信息保护纠纷案",
      "sourceType": "case",
      "provider": "pkulaw",
      "status": "现行有效",
      "content": "案号（2023）京0105民初12345号 ... 本院认为 ...",
      "metadata": { "caseNo": "（2023）京0105民初12345号", "court": "北京朝阳法院", "judgeDate": "2023-06-15" }
    }
  ]
}
```

### 字段取值

- `sourceType`: `law`(法律法规) / `case`(案例) / `regulation`(监管/规范性文件) / `web`(网页) / `user`(用户提供)
- `provider`: `pkulaw`(北大法宝) / `official`(官方发布) / `web` / `user` / `model_suggested`(仅模型先验；默认不得参与核验入库)
- `status`: `现行有效` / `已修订` / `已废止` / `不完整`(只拿到部分正文/摘录) / `未核验`(模型知识，不参与核验入库)

### 入库铁律

> ⚠️ **`content` 是溯源的命根子，现在也是硬门禁**：每条来源**必须带 `content`**（法条原文 / 案例正文 / 规范全文 / 与本报告有关的原文摘录）。脚本靠 `content` 做段落化、建条文索引（`第X条→段落`）。**没有 `content` → 段落库为空、`article_index={}` → 任何引用都锚不到 → 报告会大量弱关联/待核验。** 因此默认情况下，缺 `content` 时 `persist/all` 会直接失败并阻断 HTML 生成。
>
> 另外：`persist` 的输入顶层应为 `{"sources":[...]}` 对象（裸数组虽被兼容，但请按规范写）。跑完看返回的 `totalParagraphs`，应明显大于 0；若失败提示缺 content，必须补正文再重跑，不要交付半成品。

- 任何后续可能被引用的检索结果**都要带正文入库**，不要只在聊天里输出摘要。
- 只有模型知识、无来源 → 不参与核验入库；可在正文中提示"请以官方发布为准"。
- 抓不到全文 → 先继续检索；最低要求是入库与本报告实际引用点相关的原文摘录，并标 `status:"不完整"`。完全没有正文的标题/URL/摘要不得入库。

## 来源 Markdown 格式（{sourceId}.md）

```md
---
sourceId: ab12cd34ef56
title: 中华人民共和国个人信息保护法
sourceType: law
provider: official
status: 现行有效
url: https://example.com
retrievedAt: 2026-06-20T10:31:00+08:00
---

# 中华人民共和国个人信息保护法

[P1] 第一章 总则

[P2] 第一条 为了保护个人信息权益……
```
