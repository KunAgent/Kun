# 宿主侧质检脚本与 FBS 报告落盘约定

> **背景**：部分宿主工作区会出现会话级 `qc-*.js` 等脚本，与 FBS 仓库内 `quality-auditor`、`run-p0-audits` 并行存在。为避免**两套口径互相打架**，约定如下。

## 1. FBS 权威输出（书稿根内）

| 产物 | 说明 |
|------|------|
| `.fbs/p0-audit-report.json` | `run-p0-audits.mjs` 结构化报告 |
| `.fbs/reports/` | **建议**宿主或会话质检将**摘要**写入此目录（若目录不存在可由 Agent 创建） |
| `.fbs/audit/*.jsonl` | 追溯轨迹，见 `fbs-continuous-improvement.md` |

## 2. 宿主会话 `qc-*` 脚本

若 WorkBuddy 工作区生成 `qc-ai-strict.js` 等文件：

- **不要**与 FBS「七锁 / S 层」定义冲突时仍声称「官方质检」；应在汇报中说明来源（会话工具 vs FBS 脚本）。
- 若需对用户展示单一结论：以 **`run-p0-audits` + quality 系列脚本** 为发版与复盘权威；宿主 qc 可作为补充。

## 3. 推荐文件名

- `qc-host-summary-<date>.md`（放在 `.fbs/reports/`）
- 内容至少含：执行时间、书稿根、结论摘要、与 `p0-audit-report` 是否一致
