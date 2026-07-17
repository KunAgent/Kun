# AICoding 架构专家团

> 一个多角色协作的 Team 型专家包，把零散需求、历史资料、调研结论和架构约束协同推进为一套可审阅、可返工、可归档的架构设计交付物。

---

## 适合用来做什么

| 场景 | 说明 |
|------|------|
| 从零散输入到全量架构交付 | 手上只有 PRD、会议纪要、招投标材料、PDF/PPT/Word/Excel 等混合资料，需要先统一消化再做架构设计 |
| 带审核门控的分阶段交付 | 需要"资料摄入 → 行业调研 → 高层架构 → 系统设计 → UserStory → 部署设计 → 安全设计 → 归档"的完整流程，每个阶段都有人工审核节点 |
| 多角色专业评审 | 不希望一个人全写完，而是由不同专业角色（业务架构师、系统架构师、安全架构师等）各司其职，产出各自的专业文档 |
| 需要返工与回退机制 | 每个 Gate 都可以打回返工，且只回退当前阶段，不整体重启 |
| 模板驱动的标准化产出 | 所有文档都有模板约束，产出前通过自动校验脚本检查章节目录、硬指标数量等合规项 |

**典型用户画像**：你是一个架构师或技术 Leader，手上有业务需求但入口资料不规整，需要一个团队来帮你分步产出可归档的架构方案。

---

## 团队结构

### 主理人（1 人）

| ID | 名字 | 职责 |
|----|------|------|
| `aicoding-architecture-expert-team-lead` | 齐构成 | 建队、编排流程、注入模板/路径、推进 Gate、组织人工审核、处理返工、合稿归档。**不代写成员的专业结论** |

### 核心设计组（5 人）

负责架构设计的主线产出。

| ID | 名字 | 职责 | Gate |
|----|------|------|------|
| `business-architect` | 许边界 | 冻结业务边界、MVP 范围、高层架构设计 | G3 |
| `system-architect` | 高见远 | 系统设计、模块拆分、接口契约、数据与可观测设计 | G4 |
| `product-story-designer` | 顾全景 | UserStory、角色场景、验收标准、非功能需求 | G4 |
| `platform-architect` | 毕落地 | 部署设计、资源拓扑、CI/CD、容量与成本 | G5 |
| `security-architect` | 严守正 | 安全设计、威胁模型、IAM、数据与运行时防护 | G5 |

### 增强支持组（2 人）

负责前置输入处理与行业调研。

| ID | 名字 | 职责 | Gate |
|----|------|------|------|
| `knowledge-ingest-engineer` | 闻资料 | 将原始资料整理为结构化的资料摘要 | G1 |
| `research-analyst` | 查有据 | 行业标杆调研、方案对比、加权评分与建议 | G2 |

---

## 校验脚本

本包内置两个校验脚本，位于 `bin/` 目录下：

### 1. `validate_myteam.py` — 项目结构完整性校验

校验整个 myteam 目录结构是否完整，确保团队包可以正常工作。

```
python3 bin/validate_myteam.py
```

#### 校验内容（共 5 步）

| 步骤 | 校验项目 | 详细说明 |
|------|---------|---------|
| **1/5 根目录入口** | 5 个必需入口 | `.workbuddy-plugin/plugin.json`、`.workbuddy/output/`、`delivery/`、`settings.json`、`README.md` |
| **2/5 Agent 定义** | 8 个 Agent 文件 | 检查 `agents/` 目录下 8 个成员的 `.md` 文件是否齐全（主理人 + 5 核心 + 2 支持） |
| **3/5 Skill 定义** | 11 个 Skill + 模板文件 | 检查 `skills/` 目录下每个 Skill 的 `SKILL.md` 是否存在；对 `aicoding-team-bootstrap` 额外检查其 `references/team-runtime.json` 和 `templates/` 下的 5 份模板文件 |
| **4/5 plugin.json 一致性** | agents 与 skills 清单 | 对比 `plugin.json` 中注册的 agents/skills 与代码要求是否一致，防止漏注册或多注册 |
| **5/5 bin/ 目录** | 校验脚本存在 | 确认 `bin/` 目录中有可执行的 `.py` 脚本 |

**通过标准**：5 步全部无错误；警告不阻断通过。

---

### 2. `validate_template_compliance.py` — 文档模板合规性校验

校验 agent 产出的文档是否满足模板硬指标约束。支持按单个文档或全量文档校验。  
**注意**：该脚本只对格式和结构做检查，不对内容的正确性做判断。

```
# 校验单个文档
python3 bin/validate_template_compliance.py --output-dir .workbuddy/output --filter material_digest.md

# 校验全量文档
python3 bin/validate_template_compliance.py --output-dir .workbuddy/output

# JSON 格式输出
python3 bin/validate_template_compliance.py --output-dir .workbuddy/output --format json
```

#### 通用检查项（所有文档）

| 检查项 | 说明 |
|--------|------|
| 无残留占位符 | 文档中不能出现 `<...>`、`YYYY-MM-DD`、`TBD`、`<n>`、`示例：` 等模板占位标记 |

#### 资料摘要 `material_digest.md` — 6 项

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | §0 元信息存在 | 标题含"元信息" |
| 2 | §1 资料清单存在 | 标题含"资料清单" |
| 3 | §2 资料内容摘要存在 | 标题含"资料内容摘要" |
| 4 | §2 含 D编号,§章节 出处标注 | 出现 `D数字,§数字` 或 `D数字,第 数字` 格式 |
| 5 | §3 冲突记录存在 | 标题含"冲突记录"或"冲突信息" |
| 6 | §4 硬指标清单存在 | 标题含"硬指标" |

#### 调研报告 `research_report.md` — 11 项

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | §1 调研问题收敛存在 | 标题含"调研问题"或"问题收敛" |
| 2 | §2 事实章节存在 | 标题含"事实"或"标杆" |
| 3 | §3 对比章节存在 | 标题含"对比"或"矩阵" |
| 4 | §4 建议章节存在 | 标题含"建议"或"取舍" |
| 5 | §5 风险章节存在 | 标题含"风险"或"待确认" |
| 6 | §6 关键来源存在且可追溯 | 文档中出现 URL 或"来源/出处/参考资料"关键词 |
| 7 | 标杆系统 ≥ 3 家 | 表格中以 `B1`、`B2` 等编号的标杆条目至少 3 行 |
| 8 | 对比矩阵含权重+评分 | 出现"对比矩阵/评分矩阵/加权评分/权重"关键词 |
| 9 | 三层评分结论 | 出现"优先借鉴""部分借鉴""不借鉴"三级分类 |
| 10 | 风险 ≥ 3 条含缓解建议 | 表格中以 `R-1`、`R-2` 等编号的风险条目至少 3 行 |
| 11 | 来源 ≥ 3 条含 URL | 文档中至少出现 3 个 `https?://` 链接 |

#### 高层架构设计 `高层架构设计.md` — 11 项

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | §1 需求概要存在 | 标题含"需求" |
| 2 | §2 行业调研存在 | 标题含"行业" |
| 3 | §3 方案决策存在 | 标题含"方案" |
| 4 | §4 业务架构存在 | 标题含"业务架构" |
| 5 | §5 产品需求存在 | 标题含"产品" |
| 6 | 三层业务架构图 | 出现"接入层/业务能力层/基础能力层"三层描述 |
| 7 | 业务闭环含主链路 | 出现"闭环/主链路/反馈回路"关键词 |
| 8 | In-Scope ≤ 15 条 | In-Scope 表格行数不超过 15 |
| 9 | Out-of-Scope ≥ 3 条 | Out-of-Scope 表格行数至少 3 |
| 10 | P0 = MVP | P0 优先级与 MVP 关联 |
| 11 | 核心角色 ≥ 3 类 | 角色描述段落至少 2 段 |

#### 系统设计 `系统设计.md` — 11 项

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | §1~§8 全部章节存在 | 第 8 章"可观测设计"存在（隐含前 7 章也为必填） |
| 2 | DDD 限界上下文 ≥ 3 | 出现"核心域/支撑域/通用域"三类域分类 |
| 3 | 上下文映射关系 | 出现 Customer-Supplier / ACL / Shared Kernel 等映射模式 |
| 4 | 模块设计五段式 | 每个模块至少覆盖"概述/接口/结构/时序/关键流程"中 4 项 |
| 5 | 技术选型含版本号 | 出现 `v数字.数字` 并伴随选型理由 |
| 6 | 全局错误码 6 位格式 | 出现 6 位数字编号或 `XX-XX-XX` 分层错误码 |
| 7 | RPO/RTO 有数字 | 出现"RPO + 数字"或"RTO + 数字" |
| 8 | Dashboard ≥ 5 | 出现"Dashboard/仪表盘/看板"关键词 |
| 9 | Logs 含 traceId+tenantId | 日志规范中同时出现 traceId 和 tenantId |
| 10 | 告警 P0~P3 分级 | 出现 P0 到 P3 的告警分级体系 |

#### UserStory `UserStory.md` — 5 项

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | 角色清单 ≥ 3 条 | 角色表格至少 2 行数据 |
| 2 | 用户旅程七段式展开 | US 覆盖"场景/流程/原型/逻辑/数据/验收/集成"中至少 6 段 |
| 3 | 验收标准 Given/When/Then | 出现 GIVEN-WHEN-THEN 三段式验收格式 |
| 4 | 非功能需求 6.1~6.4 | 覆盖易用性、性能、环境、安全四个维度 |

#### 部署设计 `部署设计.md` — 9 项

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | 环境矩阵 4 环境 | 同时出现 dev / int / uat / prod 四套环境 |
| 2 | 资源清单六类 | 覆盖"计算/存储/网络/中间件/安全/可观测"中至少 5 类 |
| 3 | 故障域划分 | 出现"故障域/AZ/Region/容灾/高可用"关键词 |
| 4 | CI/CD 流水线 | 出现"CI/CD/流水线/Pipeline/构建部署"关键词 |
| 5 | 配置管理 L1~L4 | 出现 L1 到 L4 的分层配置体系 |
| 6 | 容量水位线 | 出现"水位/60%/80%/95%/预警/危险"关键词 |
| 7 | 成本计算含月度/年度 | 出现"成本/费用/月度/年度"关键词 |

#### 安全设计 `安全设计.md` — 9 项

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | STRIDE 6 类威胁 | 覆盖 STRIDE 六类威胁中至少 5 类 |
| 2 | 威胁映射缓解措施 | 出现"缓解/对策/防护"关键词 |
| 3 | IAM 认证 ≥ 2 种 | 出现至少 2 种认证方式（密码/MFA/SSO/OAuth 等） |
| 4 | 数据分级 L1~L4 | 出现至少 3 级数据分级（公开/内部/敏感/机密） |
| 5 | OWASP Top 10 防护 | 覆盖 OWASP 中至少 7 类（SQL 注入/XSS/CSRF/反序列化/SSRF 等） |
| 6 | 密钥分级 5 类 | 出现至少 3 种密钥管理概念 |
| 7 | 审计日志 5 维度 | 出现至少 3 个审计维度（云资源/数据库/堡垒机/WAF 等） |
| 8 | 应急响应预案 | 出现"应急/响应/预案/Runbook"关键词 |

---

## 交付流程

`Phase 0 → G0 → Phase 1 → G1 → Phase 2 → G2 → Phase 3 → G3 → Phase 4 → G4 → Phase 5 → G5 → Phase 6 → G6`

| 阶段 | 执行者 | 产物 | Gate |
|------|--------|------|------|
| Phase 0 | 主理人 | 运行时决策、团队创建 | G0 |
| Phase 1 | knowledge-ingest-engineer | `material_digest.md` | G1 |
| Phase 2 | research-analyst | `research_report.md` | G2 |
| Phase 3 | business-architect | `高层架构设计.md` | G3 |
| Phase 4 | system-architect + product-story-designer | `系统设计.md` + `UserStory.md` | G4 |
| Phase 5 | platform-architect + security-architect | `部署设计.md` + `安全设计.md` | G5 |
| Phase 6 | 主理人 | 合稿、术语统一、归档到 `delivery/` | G6 |

每个 Gate 的标准动作：
1. 结构检查（章节是否齐全）
2. `python3 bin/validate_template_compliance.py --filter <文档>` 自动校验
3. **输出完整报告原文给用户查看**
4. AskUserQuestion 弹窗人工审核（选项：审核通过 / 反馈修改）
5. 审核通过 → Gate 放行；反馈修改 → 仅回退当前阶段

---

## 包内文件索引

| 路径 | 说明 |
|------|------|
| `agents/aicoding-architecture-expert-team-lead.md` | 主理人 SOP、Gate 与审核协议 |
| `agents/business-architect.md` | 高层架构设计执行手册 |
| `agents/system-architect.md` | 系统设计执行手册 |
| `agents/product-story-designer.md` | UserStory 执行手册 |
| `agents/platform-architect.md` | 部署设计执行手册 |
| `agents/security-architect.md` | 安全设计执行手册 |
| `agents/knowledge-ingest-engineer.md` | 资料摄入执行手册 |
| `agents/research-analyst.md` | 行业调研执行手册 |
| `skills/aicoding-team-bootstrap/SKILL.md` | 启动、模板注入、阶段推进纪律 |
| `skills/aicoding-team-bootstrap/references/team-runtime.json` | 运行时阶段与 Gate 定义 |
| `skills/aicoding-team-bootstrap/templates/` | 7 份产出文档模板 |
| `bin/validate_myteam.py` | 项目结构完整性校验 |
| `bin/validate_template_compliance.py` | 文档模板合规性校验 |
| `delivery/` | 最终交付物归档目录 |
| `.workbuddy/output/` | 过程产出物的临时存放目录 |