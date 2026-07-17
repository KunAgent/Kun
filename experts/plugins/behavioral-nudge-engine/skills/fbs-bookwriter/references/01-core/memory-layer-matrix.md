# 记忆分层与写入矩阵（策略 A / B / C 总览）

> **版本**：2.1.2
> **目的**：界定「书稿真值」「宿主系统记忆」「工作区叙事」边界，避免双写冲突与恢复链断裂。  
> **战略口径**：认知资产「三化」与商业机制映射见 [`cognitive-asset-threeization.md`](../05-ops/cognitive-asset-threeization.md)（与本矩阵中的策略 A/B/C 互补：本表管分层写入，该文管价值叙事与机读对齐）。

---

## 1. 分层模型

| 层级 | 典型位置 | 写入方式 | 权威内容 |
|------|-----------|----------|----------|
| **L1 书稿真值** | `书稿根/.fbs/` | `intake-router`、`session-exit`、`smart-memory-core`、各质检脚本 | 阶段、恢复卡、章节台账、偏好 JSON、检索账本 |
| **L2 宿主系统记忆** | 宿主 API（create / update / delete） | 模型在关键时刻调用宿主工具 | 短摘要、可检索条目；**update 须带 ID**；用户推翻时用 **delete** |
| **L3 工作区叙事** | `书稿根/.workbuddy/memory/*.md` | `session-exit` 默认追加镜像（可 `--no-workbuddy-mirror` 关闭） | 给人看的日志、排障、审计；**不替代 L1** |
| **L4 用户全局** | `~/.workbuddy/` | 宿主与技能安装 | 技能副本、乐包账本、`settings.json`、二进制登记 |

---

## 2. 写入矩阵（谁写谁）

| 场景 | L1 | L2 | L3 |
|------|----|----|-----|
| 首响 / intake | ✅ host-capability、恢复卡补写 | ✅ 可选摘要 | — |
| 阶段完成 | ✅ esm / chapter-status | ✅ create/update | — |
| 用户否定旧偏好 | ✅ 偏好 JSON | ✅ delete + create | — |
| 退出 | ✅ resume + brief | — | ✅ 默认镜像 |

---

## 3. 冲突处理

1. **以用户最新陈述 + L1 最新落盘为准**。  
2. L2 与 L1 冲突 → 先修正 L1 文件，再 **update** 或 **delete** 宿主记忆。  
3. L3 仅作叙事；若与 L1 不一致，以 L1 为准。

---

## 4. 相关脚本

- 排障包：`node scripts/collect-host-diagnostics.mjs --book-root <书稿根> --json`  
- 退出镜像：见 `session-exit.mjs`（`--no-workbuddy-mirror`）

详见 [`runtime-mandatory-contract.md`](./runtime-mandatory-contract.md)。
