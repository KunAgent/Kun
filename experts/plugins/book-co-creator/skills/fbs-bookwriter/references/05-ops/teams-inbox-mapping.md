# Teams 收件箱与福帮手编排对齐（策略 B）

> **版本**：2.1.1  
> **状态**：约定稿；以宿主实际 JSON  schema 为准迭代。

---

## 1. 目的

当 WorkBuddy 在工作区使用 **`.workbuddy/teams/<teamId>/inboxes/*.json`** 时，福帮手多智能体（team-lead / reviewer / writer）的**任务状态**宜与收件箱字段对齐，避免「对话里并行、磁盘未同步」。

---

## 2. 建议字段映射（逻辑层）

| 福帮手概念 | 宿主 inbox 建议含义 |
|------------|---------------------|
| 当前阶段（S0–S6） | `metadata.stage` 或团队 config 扩展 |
| 待办质检类型（P/C/B） | `task.type` / `role` |
| 阻塞原因 | `status.blockedReason` |
| 书稿根 | 与 `workspacePath` / `bookRoot` 一致 |

---

## 3. 落地策略

1. **探测**：若存在 `.workbuddy/teams/**/inboxes/team-lead.json`，首响提示「检测到团队编排目录」。  
2. **写入**：仅由 **team-lead** 或明确授权脚本写入 inbox；子智能体优先落盘 `.fbs/` 再通知。  
3. **冲突**：以 `.fbs` 与 `workbuddy-resume.json` 为准；inbox 为协调层。

---

## 4. 相关

- [`multi-agent-horizontal-sync.md`](./multi-agent-horizontal-sync.md)  
- `intake-router` JSON 中 `firstResponseContext`（环境三元组）
