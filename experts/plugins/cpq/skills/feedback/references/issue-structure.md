# Issue 结构 & Labels

> 从 SKILL.md 提取 · 装配器(`bin/feedback.ts`)自动渲染

## Issue Body 结构

Body 顶部是 yaml fenced block（机器可解析，给 Triage agent），下方是人类可读的 markdown。
v2 起分 4 段：

````text
```yaml
kind: bug
plugin: cpq
skill: cpq
summary: <≤80字>
context:
  client: workbuddy/1.2.3
  llm_model: claude-sonnet-4.5            # 用户出问题时跑的 client agent 模型
  submitter: alice@tencent.com
  submitter_source: knot
  via: bac@cli
  os: { platform, arch }
  cwd: ~/WorkBuddy/...
  reproducible: yes
  ai_severity: blocker
  cli_versions:
    cpq_cli: 0.0.29
    panshi_skill: 2.1.5
  field_completeness: complete            # complete | partial
  ai_analysis_status: success             # success | partial-no-sidecar | missing
  missing_fields: []
```

> [!WARNING]                              # success 之外都会出现
> **此 issue 信息不全 · triage 可能需要追加确认**
> - 缺失环境字段：`cpq_cli_version` / `llm_model`
> - **仅含 AI 提炼的 body 4 段 · 无会话 transcript 根因分析**

## 用户描述
<脱敏后的详细描述 · 来自 --detail>

## 根本原因（AI 提炼）
<来自 ai-enrichment.body_sections.root_cause · 缺则「由提交者补充」>

## 复现步骤
1. <step>
2. <step>

## 期望 vs 实际
- **期望**：<expected>
- **实际**：<actual>
````

## Labels

附带 labels（复用工蜂仓库通用 label，不加前缀）：

- `evolution/new`
- `feedback/<plugin>`
- `skill/<skill>`
- 裸 kind（`bug` / `suggestion` / `enhancement` / `documentation`）
- `severity=critical` 时再附加 `critical`

完整标签体系见 [`docs/evolution/issue-label-sop.md`](../../../../../docs/evolution/issue-label-sop.md)。
