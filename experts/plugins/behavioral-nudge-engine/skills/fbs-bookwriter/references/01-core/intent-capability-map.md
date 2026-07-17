# 意图-能力映射表（权威版）

> 版本：v2.1.0  
> 生效范围：WorkBuddy / CodeBuddy 的福帮手编排层  
> 目标：用户说自然语言，系统自动路由能力；**不要求用户知道技能ID**。

---

## 1) 映射原则

- 用户侧只说**中文功能名**，不暴露内部 Skill ID。
- 对用户只说平台差异（如“在 WorkBuddy 上更强”），不说 Tier。
- 映射失败时先回退到“通用检索 + 本地能力”，并给出下一步建议。

---

## 2) 主要意图映射

| 用户自然语言 | 标准意图 | 能力路由（优先 → 备选） | 平台提示 |
|---|---|---|---|
| 润色、读起来更自然、去AI感、去AI味 | `deai_polish` | `humanizer` → 内置 `ai-pattern-scan` | WorkBuddy效果更强 |
| 查资料、找来源、深度调研、做情报 | `research_deep` | `deep-research` → `multi-search-engine` → `web_search` | 中文任务优先国内源 |
| 搜公众号文章、微信文章 | `wechat_lookup` | `wechat-article-search` → 站点限定检索 | 以中文内容为主 |
| 学术引用、参考文献、格式化引用 | `citation_format` | `citation-manager` → 手工引用模板 | 学术场景建议开启 |
| 导出 PDF、打印版、排版精美 | `deliver_pdf` | `minimax-pdf` → `pdf` → HTML打印 | 两平台均可 |
| 导出 Word、正式报告 | `deliver_docx` | `minimax-docx` → `docx` → Markdown交付 | 两平台均可 |
| 做课件、PPT、演讲稿 | `deliver_pptx` | `deck-generator` → `pptx` → Markdown大纲 | WorkBuddy链路更完整 |
| 表格、数据整理、Excel | `deliver_xlsx` | `xlsx` → Markdown表格 | 两平台通用 |
| 专家评审、质量评分、质检 | `quality_review` | `content-ops` → FBS S/P/C/B | 默认“主动陪伴”模式 |
| 发公众号、多平台分发、短视频脚本 | `content_repurpose` | `content-factory` → `content-repurposer` | WorkBuddy优先 |

---

## 3) 用户可见表达规范

- 说“我帮你做深度调研”，不说“调用 deep-research”。
- 说“我先查中文权威来源”，不说“执行 CN Router”。
- 说“这是建议动作”，不说“内部调度状态变迁”。

---

## 4) 回退与兜底

当目标能力不可用时，按顺序回退：

1. 同类能力备选链路
2. `web_search` + 本地规则
3. 离线降级说明（明确告知，不静默）

输出模板：

> 你这个需求我先按「{功能中文名}」走。当前优先链路不可用，我已切到「{备选链路}」，结果会保持同样目标。
