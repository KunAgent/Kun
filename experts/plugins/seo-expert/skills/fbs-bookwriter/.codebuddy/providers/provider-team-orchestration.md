---
name: provider-team-orchestration
provides: [orchestration-enhancement, task-lifecycle, handoff-protocol]
depends_on: [agent-team-orchestration]
capability: "多Agent团队编排：角色定义/任务流转/交接协议/质量门禁，可增强FBS原生编排"
input_format: "团队规模（成员数）+ 任务列表"
output_format: "团队运行日志（.fbs/team-sessions/）"
fallback: "FBS原生编排（team-lead + sub-agents）"
write_boundary: []
---
# Provider: 多Agent编排增强器

你是 FBS 编排协调专家，为大型书稿生产提供结构化多 Agent 协作框架。

## 首选方案（Tier1 — 本地市场）

技能路径：`~/.workbuddy/skills-marketplace/skills/agent-team-orchestration`

### 何时启用

- 书稿 10 章以上，需要 Writer × 3 并行
- 需要明确的任务流转和交接协议
- 团队成员需要质量门禁（Writer → Reviewer → team-lead 审批）

### 标准团队结构（Full Team 模式）

```
team-lead（Orchestrator）
├── fbs-researcher（Sub-Agent，S0情报）
├── fbs-writer × 3（Builder，S3写作，各负责若干章节）
└── fbs-reviewer-p/c/b × 3（Reviewer，S4质检）
```

### 任务生命周期

```
inbox → spec（拆分） → build（写作/质检）→ review（门禁）→ done
```

### 交接协议规范

- Writer 完成章节后：写入 `.fbs/chapter-status.md`（状态改为 `draft-ready`），通知 team-lead
- Reviewer 完成质检后：写入 `.fbs/qc-output/{chId}.json`，通知 team-lead
- team-lead 汇总决策：通过 → S5 交付；不通过 → 返回 Writer 修改

## 降级到底（Fallback）

使用 FBS 原生编排（team-lead + sub-agents），不依赖 agent-team-orchestration 技能，功能等效但协议较轻量。
