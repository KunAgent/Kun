# 体验与防卡顿专项（性能 / 价值显性化）

> 机读入口：`fbs-runtime-hints.json` → **`performanceUx`**；与 `antiStall`、`file-growth-guard` 协同。

## 1. 目标

- **少卡顿**：控制 `.fbs/`、`deliverables/`、`releases/` 下可追踪文件体积与总量，避免单文件膨胀拖慢检索与宿主工具。
- **早发现**：**软阈值**（黄区）在门禁阻断前提示治理；**硬阈值**（红区）与 P0 审计对齐。
- **价值显性**：首响用一句话 + 少量要点说明「用户得到什么」，而非仅技术状态。

## 2. 文件增长策略

| 层级 | 单文件 | 追踪总量 | 行为 |
|------|--------|----------|------|
| 软阈值 | 默认 >5MB 且 ≤8MB | 默认 >40MB 且 ≤64MB | `advisoryAlerts`，不单独阻断 P0 |
| 硬阈值 | >8MB | >64MB | `alerts`，`--enforce` 可失败 |

- **审计 JSONL**（`.fbs/audit/*.jsonl`）默认**不计入**追踪体量，避免轨迹写入拖垮「书稿目录」口径；全库大文件体检仍可用 `npm run inspect:large-files`。

## 3. 报告刷新

- `intake-router` 在存在 `.fbs/` 且报告缺失或**过旧**时，会**非强制**重跑 `file-growth-guard` 刷新 `.fbs/file-growth-report.json`（见 `performanceUx.fileGrowthReportMaxAgeHours`）。

## 4. 宿主展示

- `firstResponseContext.userValueSnapshot`：价值一句话 + 要点（新会话或恢复信息薄时 `showAsSecondaryLine` 为真，便于副标题区展示）。
- `firstResponseContext.stallPreventionUserHint`：黄/红区时的人话一句，**勿**与主一句摘要混成超长气泡；可放次行或折叠提示。
