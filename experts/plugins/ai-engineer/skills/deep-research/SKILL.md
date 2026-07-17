---
name: deep-research
description: "Structured deep research workflow with human-in-the-loop control. Use /research to generate research outline, /research-deep for parallel web search across items, /research-report to compile markdown reports. Supports academic research, benchmark research, technology selection, market analysis, and due diligence. Triggers: 'deep research', 'research topic', 'benchmark comparison', 'technology survey', 'market analysis'. Requires: WebSearch capability."
description_zh: "结构化深度调研工作流，支持大纲生成、并行搜索、报告输出"
description_en: "Structured deep research workflow: outline, parallel search, report generation"
version: 1.0.0
homepage: https://github.com/Weizhena/Deep-Research-skills
license: MIT
allowed-tools: Read, Write, Glob, WebSearch, Task, AskUserQuestion
---

# Deep Research — 结构化深度调研工作流

基于 [Deep-Research-skills](https://github.com/Weizhena/Deep-Research-skills) 项目，提供人机协作的结构化调研能力。

## 核心命令

| 命令 | 说明 |
|------|------|
| `/research <topic>` | 初步调研，生成 outline.yaml + fields.yaml |
| `/research-deep` | 并行深度搜索，逐项收集数据 |
| `/research-report` | 汇总生成 Markdown 报告 |
| `/research-add-items` | 追加调研条目 |
| `/research-add-fields` | 追加调研字段 |

## 工作流程

```
/research "AI Agent 2025"
    ↓ 生成大纲（items + fields）
    ↓ 用户确认/修改
/research-deep
    ↓ 并行 web-search-agent 逐项搜索
    ↓ 结果写入 results/
/research-report
    ↓ 汇总为 report.md
```

## 适用场景

- **学术调研**：论文综述、Benchmark 对比
- **技术选型**：框架评估、工具对比
- **市场调研**：竞品分析、行业趋势
- **尽职调查**：公司研究、投资分析

## 目录结构

```
deep-research/
├── research/SKILL.md          # /research 命令（中文版）
├── research-deep/SKILL.md     # /research-deep 命令
├── research-report/SKILL.md   # /research-report 命令
├── research-add-items/SKILL.md
├── research-add-fields/SKILL.md
├── research-en/               # 英文版本
│   ├── research/SKILL.md
│   ├── research-deep/SKILL.md
│   ├── research-report/SKILL.md
│   ├── research-add-items/SKILL.md
│   └── research-add-fields/SKILL.md
└── agents/                    # 搜索代理
    ├── web-search-agent.md
    └── web-search-modules/    # 搜索策略模块
```

## 输出示例

```
{topic_slug}/
├── outline.yaml    # 调研条目 + 执行配置
├── fields.yaml     # 字段定义
├── results/        # 逐项搜索结果
│   ├── item_1.yaml
│   ├── item_2.yaml
│   └── ...
└── report.md       # 最终报告
```

## 致谢

- 作者：[Weizhena](https://github.com/Weizhena)
- 灵感：RhinoInsight — Improving Deep Research through Control Mechanisms for Model Behavior and Context
