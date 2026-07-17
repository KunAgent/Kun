# FBS-BookWriter v2.1.2 审核版说明

> **福帮手出品 | 高质量长文档手稿工具链**：书籍、手册、白皮书、行业指南、长篇报道、深度专题；支持联网查证（宿主允许时启用，离线自动降级）、S/P/C/B 分层审校、中文排版与 MD/HTML 交付。

## 版本定位

- **版本**：`2.1.2`
- **定性**：在 v2.1.1「长上下文钉住 · 阶段门禁 · 质检闭环」基线上，强化 **写作优先（Writing-First）** 体验、宿主契约与治理门禁（含工具输出预算、技能导入安全扫描、北极星 KPI 采集等）；详见仓库内 `CHANGELOG.md` 与 `releases/workbuddy-review-v2.1.2.md`。
- **正式产物**：WorkBuddy Marketplace 主包（默认 `npm run pack:release`）；完整三通道可用 `npm run pack:release:all`。
- **WorkBuddy 包（示例名）**：`dist/fbs-bookwriter-v212-workbuddy.zip`
- **CodeBuddy 包（示例名）**：`dist/fbs-bookwriter-v212-codebuddy.zip`
- **plugin-id（SKILL frontmatter）**：`fbs-bookwriter-v212`

## 与 v2.1.1 文档的关系

- **v2.1.1 审核版快照**（历史对照）：仍保留在源码仓为 `README-v2.1.1.md`，**默认不再随 WorkBuddy 上架 ZIP 附带**；需要时从 Git 历史或 `archive/versions/` 查阅。
- **当前用户主读**：根目录 `README.md`（完整仓库中有；上架 ZIP 以 `SKILL.md` 为规范入口，建议与本文版本号一致）。

## 部署自检

```bash
npm install --omit=dev
node scripts/env-preflight.mjs --json
```

验收：`deps.glob` 与 `deps.iconv-lite` 为 `true` 后再跑长链路脚本。

## 延伸阅读

- [`releases/workbuddy-writing-first-os-implementation-v2.1.2.md`](./releases/workbuddy-writing-first-os-implementation-v2.1.2.md)
- [`releases/hermes-agent-benchmark-to-fbs-improvement-checklist-v2.1.2.md`](./releases/hermes-agent-benchmark-to-fbs-improvement-checklist-v2.1.2.md)
