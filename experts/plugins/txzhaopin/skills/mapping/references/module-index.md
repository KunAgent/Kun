# 内置模块索引

本 Skill 以根 `SKILL.md` 为统一入口，按用户意图选择下列内部模块和资源。所有模块文件均作为参考资料按需读取，**全部在主进程内执行，不启动子代理**。

公共知识库写入协议：`references/iwiki-storage-protocol.md`

## 四阶段提示词参考（主进程串行 Read 执行，非可调子代理）

| 阶段 | 路径 | 用途 |
|---|---|---|
| 市场概览（Market） | `references/stage-prompts/mapping-market-searcher.md` | 市场概览、行业趋势、人才池规模 |
| 组织架构（Org） | `references/stage-prompts/mapping-org-searcher.md` | 组织架构、部门层级、负责人线索 |
| 候选人（Candidate） | `references/stage-prompts/mapping-candidate-searcher.md` | 候选人画像、匹配度、公开证据 |
| 洞察建议（Insight） | `references/stage-prompts/mapping-insight-searcher.md` | 洞察建议、风险与触达策略 |

## 总调度与知识库

| 模块 | 路径 | 用途 |
|---|---|---|
| mapping-universal | `references/modules/mapping-universal/instructions.md` | 总调度说明、工作流、路由策略 |
| org-knowledge-base | `references/modules/org-knowledge-base/instructions.md` | 组织知识库结构、职级映射、图谱沉淀 |
| wiki-reader | `references/modules/wiki-reader/instructions.md` | 查询已有候选人/组织知识 |
| wiki-compiler | `references/modules/wiki-compiler/instructions.md` | 将新 Mapping 结果整理入库 |
| wiki-evolver | `references/modules/wiki-evolver/instructions.md` | 增量更新、冲突处理、知识库演进 |

## 公开来源挖掘

| 模块 | 路径 | 优先场景 |
|---|---|---|
| linkedin-deep-miner | `references/modules/linkedin-deep-miner/instructions.md` | 通用履历、公司团队、组织现状、管理层 |
| google-snapshot-spa-bypass | `references/modules/google-snapshot-spa-bypass/instructions.md` | SPA/登录墙/搜索摘要可见但页面难抓取时补证 |
| zhihu-miner | `references/modules/zhihu-miner/instructions.md` | 中文互联网公开讨论、产品/运营/技术社区补盲 |
| alumni-network-miner | `references/modules/alumni-network-miner/instructions.md` | 校友网络、实验室、学校背景线索 |

## 金融与交易文件

| 模块 | 路径 | 优先场景 |
|---|---|---|
| hkex-prospectus-miner | `references/modules/hkex-prospectus-miner/instructions.md` | 港股招股书、中介机构、保荐人、律所、投行团队 |
| sec-filing-miner | `references/modules/sec-filing-miner/instructions.md` | 美股 SEC 文件、S-1/10-K/8-K、交易/高管披露 |
| deal-news-miner | `references/modules/deal-news-miner/instructions.md` | 投融资、并购、IPO 新闻中的 Banker/律师/投资人 |

## 技术、学术、创意作品

| 模块 | 路径 | 优先场景 |
|---|---|---|
| github-miner | `references/modules/github-miner/instructions.md` | 开源贡献者、技术栈、工程能力验证 |
| authorfilter | `references/modules/authorfilter/instructions.md` | 论文作者、学术/技术影响力、作者归属过滤 |
| artstation-talent-finder | `references/modules/artstation-talent-finder/instructions.md` | 游戏美术、原画、3D、TA、作品集人才 |

## 模板

- 白色完整报告模板：`templates/mapping-report.html.tpl`
- 深色五段式报告模板：`templates/mapping-report-dark.html.tpl`
- 画像模板：`profile-templates/engineering.md`、`investment.md`、`product.md`、`operations.md`、`generic.md`
