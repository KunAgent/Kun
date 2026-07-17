# 长任务 / 辅助子任务机读契约（FBS）

> 与 `fbs-runtime-hints.json` → `subTaskContract`、`intake-router --json` → `firstResponseContext.subTaskDecompositionContract` 对齐。

## 目的

在**不引入**完整多 Agent 运行时的情况下，让宿主（企微 / WorkBuddy / 外部 worker）能把「耗时子步骤」与主对话解耦：超时、产出路径、并发上限由机读字段约定，避免各端硬编码。

## 宿主侧建议字段（示例）

单条子任务（由宿主或编排器生成，非用户气泡原文）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 会话内唯一 |
| `title` | string | 人话标题 |
| `timeoutSeconds` | number | 默认见 `subTaskContract.defaultTimeoutSeconds` |
| `outputRelativePath` | string | 相对**书稿根**的落盘路径（须在 `.fbs/` 或宿主约定目录下） |
| `kind` | string | 可选：`search` \| `render` \| `script` \| `other` |

## 与 intake 的关系

- `firstResponseContext.subTaskDecompositionContract` 仅提供**契约版本、默认超时、文档路径、示例占位**；真实任务列表由宿主/worker 维护。
- 主对话区仍以 `userFacingOneLiner` + ≤3 主选项为准（见 `hostPresentation`）。
