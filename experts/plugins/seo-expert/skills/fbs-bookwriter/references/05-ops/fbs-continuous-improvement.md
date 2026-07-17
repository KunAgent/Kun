# 福帮手持续改进与进化门控（P0–P2 总览）

> 与 `fbs-runtime-hints.json` 中 `evolutionGate` / `trace` 对齐；发版前与 `pack:skill-gates` 同级执行 `evolution-gate`。

## 轨迹（A2）

- 事件写入：`bookRoot/.fbs/audit/trace-YYYY-MM-DD.jsonl`
- Schema：`references/05-ops/fbs-trace-events.schema.json`
- 覆盖入口：`intake-router`、`session-exit`、`record-search-preflight`

## 书稿索引（A1）

- 全局登记：`~/.workbuddy/fbs-book-projects.json`（`session-exit` 成功时）
- 本书关键词：`bookRoot/.fbs/index/book-snippet.json`（`intake` / `session-exit` 维护）
- 统一检索：`intake-router --search` → `searchUnifiedBookRoots`

## 进化门控（A3）

- 清单：`scripts/generated/scripts-manifest.json`（`node scripts/generate-scripts-manifest.mjs`）
- 门禁：`node scripts/evolution-gate.mjs`（打包前由 `pack-skill-gates` 调用）
- 严格模式：`FBS_STRICT_EVOLUTION=1` 时若 `references/` 有未提交变更则失败

## 提案（C1）

- `node scripts/evolution-propose.mjs --book-root <书稿根>` → `.fbs/evolution/proposal-*.md` 草稿，**须人工审核**后再改仓库规范。

## 实验（C2）

- 影子规则建议目录：`bookRoot/.fbs/experiments/`（文件名自说明，不自动晋升）

## 辅助模型（C3）

- 任务列表见 `fbs-auxiliary-tasks.md`；路由由宿主实现，技能侧只约定用途边界。
