---
name: aicoding-team-bootstrap
description: 当用户要求启动、恢复或执行 AICoding 架构 Team 时使用。负责根据项目内 agents、manifest 和 templates 建立可运行的 Team。
---

# AICoding Team Bootstrap

你负责把本项目里的 Team 定义真正拉起来运行。

## 启动步骤
1. 读取 `.workbuddy-plugin/plugin.json` 获取插件元数据。
2. 读取 `references/team-runtime.json` 获取运行时配置。
3. 读取 `templates/` 下的五份架构设计模板，并优先探测 `material_digest.md` 与 `research_report.md` 模板；若不存在，则建立等价的固定结构化提纲。
4. 在任何成员调度之前，先由主理人完成 Phase 0：建立 Team、梳理运行时决策；如存在分支条件未明确，必须通过 AskUserQuestion 合并确认运行时决策，选项应与配置语义匹配（如 `按推荐配置继续`、`调整配置`），不得逐个字段弹窗，不得用 `审核通过`、`反馈修改` 表达 yes/no 型运行时决策，也不得用纯文字追问替代。
5. 为每个 Agent 注入其对应的模板路径、输出路径、当前 Gate 编号、唯一 Owner 约束和人工审核规则；同时强调“成员必须优先执行其 agent 文件中已有的工作流步骤、硬指标和定稿纪律，bootstrap 只做运行时注入，不重写成员 workflow”：
   - `knowledge-ingest-engineer` → `templates/material_digest.md`（若不存在则使用固定提纲）→ `.workbuddy/output/material_digest.md` → G1
   - `research-analyst` → `templates/research_report.md`（若不存在则使用固定提纲）→ `.workbuddy/output/research_report.md` → G2
   - `business-architect` → `templates/高层架构设计.md` → `.workbuddy/output/高层架构设计.md` → G3
   - `system-architect` → `templates/系统设计.md` → `.workbuddy/output/系统设计.md` → G4
   - `product-story-designer` → `templates/UserStory.md` → `.workbuddy/output/UserStory.md` → G4
   - `platform-architect` → `templates/部署设计.md` → `.workbuddy/output/部署设计.md` → G5
   - `security-architect` → `templates/安全设计.md` → `.workbuddy/output/安全设计.md` → G5
6. 明确告知每个 Agent：模板是只读参考，但必须以模板章节结构为骨架、以其硬指标为合格基线，不得删减核心章节。
7. 明确告知每个 Agent：如果其 `agents/*.md` 中已经定义了 `## 工作流`、Step 0、Step 1~N、硬指标、退出条件，则这些内容是主执行手册，必须完整遵守。
8. 创建 Team：核心 6 人固定纳入（aicoding-architecture-expert-team-lead、business-architect、system-architect、platform-architect、security-architect、product-story-designer）；同时根据 Phase 0 运行时决策按需纳入增强角色：`need_ingest=true` → 加入 `knowledge-ingest-engineer`，`need_research=true` → 加入 `research-analyst`。
9. 只要存在原始资料，就先启用 `knowledge-ingest-engineer`；G1 通过后，默认进入 `research-analyst`，除非用户已明确批准跳过 research。
10. 启动时建立术语表、阶段门表、主文档 Owner 表与输出目录约束。
11. 每个阶段成员回传完整原文后，必须进入“结构检查 → 自动校验 → 输出完整报告原文给用户查看 → AskUserQuestion 人工审核 → Gate 裁决”闭环；任一环节未通过，都不得推进下游阶段。
12. AskUserQuestion 必须按用途分类使用：运行时决策确认用于 Phase 0 补齐启动决策，选项必须与配置语义匹配；阶段内中间确认用于成员执行过程中的方案选择，选项必须与方案语义匹配，且不代表 Gate 通过；阶段产物审核仅用于 G1-G6，选项固定为：`审核通过`、`反馈修改`。
13. 人工审核未通过时，必须把用户意见逐条追加到原成员 prompt 中定点返工，而不是整体重启整个 Team。
14. 只有所有主文档通过自动校验与人工审核后，才允许 team-lead 将 `.workbuddy/output/` 中的最终版汇总归档到 `delivery/`。
15. 保证 Team 以协作方式工作，而不是退化为单 Agent 顺序执行。

## 增强角色触发条件
- 存在 docx/pdf/pptx/xlsx 或其他需要归一化处理的原始资料 → 先启用 `knowledge-ingest-engineer`，生成 `material_digest.md` 作为统一输入。
- 默认在 G1 通过后进入 `research-analyst`，基于 `material_digest.md` 形成 `research_report.md`；若要跳过 research，必须由主理人先说明原因并通过 AskUserQuestion 获得用户批准。
- 部署设计中需要云资源现状 → 由 `platform-architect` 自行调用 `CloudQ`
- 需要输出正式架构图/拓扑图 → 不额外启用独立角色，由对应文档 Owner 直接调用 `tcloud-arch-diagram` 或 `diagrams-generator`

## 模型分配策略
| 角色类型 | 模型 |
|---------|------|
| team-lead | reasoning |
| business-architect | default |
| system-architect | default |
| platform-architect | default |
| security-architect | default |
| product-story-designer | default |
| 增强角色 | lite |

## 人工审核协议
- G1：`material_digest.md` 通过自动校验后，由主理人通过 AskUserQuestion 发起单题审核；用户明确通过后，才可进入调研阶段。
- G2：`research_report.md` 通过自动校验后，由主理人通过 AskUserQuestion 发起单题审核；用户明确通过后，才可进入高层架构阶段。
- G3：高层架构通过自动校验与 AskUserQuestion 审核后，才可进入系统设计与 UserStory。
- G4：系统设计与 UserStory 两份文档都通过自动校验与 AskUserQuestion 审核后，才可进入部署与安全设计。
- G5：部署设计与安全设计两份文档都通过自动校验与 AskUserQuestion 审核后，才可进入合稿。
- G6：最终统一稿经 AskUserQuestion 审核确认后，才可归档交付。

## 关键纪律
- 每个任务只有一个主 Owner。
- 所有影响全局边界的结论先发 `decision`。
- 避免多成员同时编辑同一主文件。
- 阶段门必须显式通过才能进入下一阶段。
- 术语表在启动时建立，最终合稿时统一校验。
- 未注入模板路径、输出路径和 Gate 编号，不得调度成员开始写作。
- 人工审核意见必须原样保留并进入返工 prompt，禁止主理人自行“消化后转述”。
- Gate 编号与含义必须在主理人文件、runtime 清单、bootstrap 说明与校验逻辑中保持一致。
