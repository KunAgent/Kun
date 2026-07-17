# 核验工作流（verification-workflow）

本工作台的端到端流程与 CLI 详解。统一入口为 `bin/legal-verify`，内部调用 `scripts/run-verification-pipeline.mjs`。所有命令输出机器可读 JSON。

> 定位提醒：本工作台是**溯源**工序，帮用户把 AI 回答关联的法律依据原文一键定位出来供自行核验，**不替用户判对错**。产出三个客观标签：已关联 / 弱关联 / 待核验。**核验结果内嵌进按场景命名的最终报告（可一键关闭高亮），是这份报告的内嵌图层、不另起独立"溯源辅助报告"；过程文件（answer.md/sources.json/claims.json）不对外交付。** 这只约束"核验不另起文件、过程文件不冒充交付物"，整个任务交几份产物仍由场景/系统/用户需求决定。

## 命令总览

```bash
legal-verify init    --query "用户问题" [--task <dir>] [--title "报告标题"] [--out "output/文件名.html"]
legal-verify capture --input retrieval-batch.json [--task <dir>] [--provider web] [--allow-snippet]
legal-verify audit-sources --task <dir> [--out verification/source-fulltext-queue.json]
legal-verify persist --input sources.json [--task <dir>]
legal-verify build   --task <dir> [--answer answer.md] [--claims claims.json]
legal-verify repair-export --task <dir> [--out verification/supplemental-search-queue.json]
legal-verify repair-apply  --task <dir> --input supplemental-findings.json
legal-verify html    --task <dir>
legal-verify all     --query "..." --sources sources.json --answer answer.md [--claims claims.json] [--title "报告标题"] [--out "output/文件名.html"]
```

- 未指定 `--task` 时，`init`/`all` 会在当前工作目录的 `.legal-search-memory/<taskId>/` 下新建任务。
- **`--title`/`--out`（推荐）**：把承载核验的最终报告按场景命名（如《合规分析报告》），而不是通用的《法律依据溯源辅助报告》。在 `init`/`all` 时给定，`html` 阶段沿用。
- `--root` 可显式指定工作区根目录（默认 `process.cwd()`）。
- **`--claims claims.json`（强烈推荐）**：**定稿后**复盘成稿得出的语义关联（每句话依据哪个来源/条号）。这是工作台从"文字精确匹配"转向"AI 语义复盘 → 脚本确认存在 → 用户点击溯源"的关键输入。它在意见写完之后产出，绝不反过来影响输出。不给也能跑（退化为纯规则兜底），但给了溯源质量显著提升。格式见 `@references/verification-point-spec.md`。
- 运行命令：托管 Node `/Users/howeli/.workbuddy/binaries/node/versions/22.22.2/bin/node`，或系统 `node`。零 npm 依赖。

## 推荐用法：all 一步到位

```bash
node <expert>/bin/legal-verify all \
  --query "我被口头辞退且未签书面合同能否主张赔偿" \
  --sources sources.json \
  --answer answer.md \
  --claims claims.json \
  --title "劳动争议法律意见" \
  --out "output/劳动争议法律意见.html"
```

执行顺序：init → persist（来源入库+段落化+索引）→ 复制 answer.md + claims.json → extract（声明点 + 规则兜底点合并）→ match（证据锚定）→ html（生成报告）。

返回：
```json
{ "success": true, "taskId": "...", "taskDir": "...",
  "htmlPath": ".../output/核验报告.html",
  "declared": 55,
  "stats": { "points": 112, "associated": 55, "weak": 51, "unverified": 6, "statuteHits": 60, "caseHits": 0 },
  "sourceFulltextQueuePath": ".../verification/source-fulltext-queue.json",
  "sourceFulltextIssueCount": 3,
  "sourceFulltextBlockerCount": 2,
  "sourceFulltextReviewCount": 1,
  "repairRequired": true,
  "health": { "ok": false, "deliveryBlocked": true, "nextRoute": "dynamic_retrieval_strategy_then_repair_apply" } }
```

- `declared` 是来自 AI 声明（claims.json）的核验点数；`stats` 是三标签分布。
- `associated` 多、`unverified` 少 = 大部分论断都能溯源到真实来源原文。
- `sourceFulltextQueuePath` 是源头补全文队列；只要 `sourceFulltextBlockerCount>0` 或 `health.gates` 含 `source_fulltext_required`，先补取全文并重新 capture；`sourceFulltextReviewCount` 表示需人工/AI确认的疑似截断或正文过短来源。
- `legal-verify all/build` 会在首轮匹配后自动生成 `repairRequired`、`supplementalQueuePath`、`supplementalQueueCount`。只要 `repairRequired:true`、`health.deliveryBlocked:true` 或 `health.ok:false`，不能直接交付，应进入二次补检修复。

## 二次补检修复：把弱关联/待核验转成已关联或已修正

首轮核验出现弱关联/待核验，或正文中出现明显需要法律依据但没有高亮关联的内容时，正确处理不是解释给用户听，而是补检索解决。这里的“明显需要法律依据”不能靠穷举本次截图里的关键词判断，而应由 AI 结合上下文判断：该句是否在表达**独立的**法律命题、监管义务、权利义务边界、法律后果、条款引用，或 AI 基于预训练知识补入但首轮检索没有覆盖的规范性内容。脚本只提供通用候选和检索词，最终是否补检、补哪部法规、是否修正，必须由 AI 语义判断。

> v8 纠偏：补检不是把“未关联内容”批量补成“弱关联”。补检是初稿后的复核与修订闭环：原句正确且补到真实依据 → 补 sources/claims 并升级“已关联”；原句/条号错误 → 局部修订正文、标“已修正”、关联正确来源；只是前一句已关联法规后的解释、推论、结论或重复内容 → `ignore`，不新增核验点、不制造弱关联。

导出补检队列：

```bash
legal-verify repair-export --task <taskDir> --out verification/supplemental-search-queue.json
```

该队列列出每个弱关联/待核验点，以及每个 `label:"unlinked"` 未关联法律内容的 `pointId`、原句、声明来源/条号（如有）、现有候选段落、推荐检索语句和 `aiReviewInstruction`。Agent 应先按 `aiReviewInstruction` 做语义门控：若该句不是独立法律命题、只是前一句已关联依据后的判断结论，应直接 `ignore`；确需补检时，内部优先使用北大法宝 `pkulaw` / `mcp__pkulaw*`、华宇元典 `yuandian-mcp` / `mcp__yuandian*`、其他法律 MCP/Skill 或官方来源补充检索，并写入：

```json
{
  "findings": [
    {
      "pointId": "vp-001",
      "action": "confirm",
      "source": { "title": "中华人民共和国个人信息保护法", "sourceType": "law", "provider": "pkulaw", "status": "现行有效", "url": "...", "content": "第六条 ..." },
      "sourceTitle": "中华人民共和国个人信息保护法",
      "articleNo": "第六条",
      "correctionNote": "补充检索确认该句依据为第六条"
    }
  ]
}
```

`action` 规则：
- `confirm`：原句正确，只是首轮资料没检到或原本未建立关联；补入真实 `source.content` 与正确条号，重跑后升级为已关联。
- `correct` / `wrong_article`：有相关规定，但原句或条号错；必须提供 `correctedText`，脚本会替换 `answer.md` 原句并标识"已修正"。
- `hallucination`：补检确认没有该规定/条款；必须提供删除或谨慎化后的 `correctedText`，不得把幻觉原句留在报告中。
- `ignore`：确认无需独立处理的点，例如前一句已经关联法规、当前句只是该法规下的解释/结论/风险提示/重复内容。`ignore` 是防止错误弱关联的必要动作，不是偷懒。

应用补检结果：

```bash
legal-verify repair-apply --task <taskDir> --input supplemental-findings.json
```

脚本会补充来源入库、更新 `claims.json`、必要时改写 `answer.md` 并标注"已修正"，然后自动重新 extract → match → html。

## 分步用法：需要中途检查或多轮累积来源

```bash
# 1) 建库（顺便定名这份报告）
legal-verify init --query "..." --title "合规分析报告" --out "output/合规分析报告.html"   # 读取返回的 taskDir

# 2) 多次入库（每次检索一批就先 capture；带全文的结果会自动 persist，只有摘要的会进入补全文队列）
legal-verify capture --task <taskDir> --input retrieval-batch1.json --provider web
legal-verify capture --task <taskDir> --input retrieval-batch2.json --provider pkulaw
legal-verify audit-sources --task <taskDir>
# 如有人工整理好的完整 sources，也可补充 persist
legal-verify persist --task <taskDir> --input sources.json

# 3) 意见定稿写入 answer.md 后，复盘成稿得出 claims.json，再抽取+锚定
legal-verify build --task <taskDir> --answer answer.md --claims claims.json

# 4) 出报告
legal-verify html --task <taskDir>
```

## Agent 在对话中的标准调用时机

1. **检索阶段**：每检索到一批资料（法宝/官方/网页/用户提供），立即整理成 retrieval batch 并 `capture`；搜索结果若只有标题/摘要，必须继续读取全文后再次 `capture`。不要等到最后才一次性入库，也不要只把工具 observation 片段当完整来源。
2. **来源完整性验收阶段**：运行 `audit-sources`，读取 `source-fulltext-queue.json`。队列有 blocker 时，先用 WebFetch/官方库/MCP detail 工具补取全文，再 capture/persist。
3. **输出阶段**：按用户意图与场景标准把最终意见写好、定稿——**此阶段不考虑核验**，不为它改变写法。把成稿原样写入 `answer.md`。
4. **定稿后的复盘阶段**：回头通读 `answer.md`，对其中引用了法律依据的关键句子，把它关联的来源/条号标注进 `claims.json`（`claimText` 逐字摘自成稿，只标注不改稿）。
5. **复核阶段**：运行 `build` + `html`（或直接 `all`），带上 `--claims`。运行后必须读取返回 JSON 中的 `repairRequired`、`supplementalQueuePath`、`supplementalQueueCount`、`sourceFulltextQueuePath`、`sourceFulltextIssueCount`、`sourceFulltextBlockerCount`、`health.ok`、`health.deliveryBlocked` 和 `health.warnings`，不能只看 `success:true`。
6. **补检修复阶段**：若 `repairRequired:true`、`health.deliveryBlocked:true` 或 `health.ok:false`，说明首轮稿尚未过门禁。先处理 `sourceFulltextQueuePath` 补全文，再使用 `supplementalQueuePath` 指向的队列逐条语义判断是否确需补检：能补依据的改为已关联；条号错/AI幻觉的改正文并标识"已修正"；只是前文依据后的结论/解释则 `ignore`，并从最终可见统计中抑制，避免无意义弱关联。完成 findings 后 `repair-apply`。
7. **回复阶段**：只有在补检门禁处理完毕并通过模板验收后，才把 `htmlPath` 指向的报告交给用户——它就是承载核验的最终报告（正文=定稿意见，核验=内嵌的可关闭高亮层）。合格 HTML 必须来自 `templates/verification-report.html`，具备深色 `report-head`、黄色 notice、toolbar、stats、左右双栏、右侧“关联依据/来源资料库” tabs；若是单栏文章、右上角 `v-toggle`、没有 stats/右栏/tabs，或 `assert-html` 因弱关联/待核验比例过高失败，必须重跑补全文/补检/`legal-verify html/all`。交付时说明三标签含义（已关联=可点开原文溯源；弱关联=语义相关或条号待核对；待核验=本次资料未给出可溯源依据，需自行查证）。**务必强调：报告帮溯源、不替你下对错结论，且核验高亮可一键关闭。** `answer.md`/`sources.json`/`claims.json` 是过程文件，留在记忆库内，不对外交付、不改后缀冒充正式报告。（核验本身不另起独立文件；任务整体交几份产物由场景/系统/用户需求决定。）

## 失败处理

- 所有脚本失败时返回 `{ "success": false, "error": "..." }` 并以非零退出码结束，便于 Agent 判断。
- `answer.md` 为空 → build 报错；先确保已写入回答。
- 无来源、来源无 `content`、`source-fulltext-queue.json` 有 blocker → 阻断报告生成/交付；先补充检索并写入真实来源原文。
- **大量"待核验"≠回答错**，只代表本次资料没给出可点击溯源的依据；工作台会触发动态检索策略回路，应补检补关联或修正文稿后再交付。
