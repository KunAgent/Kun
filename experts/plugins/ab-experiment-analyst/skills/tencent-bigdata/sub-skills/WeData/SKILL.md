---
name: WeData
description: WeData（大数据开发治理平台）相关技能的入口。当用户提到 WeData、数据探索、SQL查询、ChatBI、数据分析、SQL预检、SQL诊断、SQL执行失败、SQL生成相关问题时，使用此技能了解可用的子技能列表并路由到合适的技能。
---

# WeData（大数据开发治理平台）技能集

## 概述

WeData 是腾讯内部的大数据开发治理平台（https://wedata.woa.com），提供数据集成、数据开发、数据治理、数据探索等一站式大数据能力。本目录包含与 WeData 平台相关的所有技能。

## 必填参数与用户确认规则（全局强制）

> **该规则适用于本目录下所有 wedata 子技能。** AI 在调用任何 wedata CLI 命令前必须严格遵守。

### * 强制铁律

1. **必填参数缺失时，必须先向用户确认，绝对不能自行决定**：
   - 例如：用户说"帮我创建一个 wedata 任务"，但没说在哪个项目（`--project-id`），AI **必须**回复"请问您要在哪个项目下创建？可以先用 wedata 项目列表查询命令查看您有权限的项目"，**不允许**任意挑一个项目。
   - 例如：用户说"查一下表结构"，但没说集群和库（`--cluster` / `--database`），AI **必须**先问清楚，**不允许**默认到 tl 集群或某个常用库。
2. **业务关键参数（即便有默认值），如果用户没明说，也必须先核对**：
   - `--enable-public`（任务可见性，默认 0=维护人）：涉及任务安全边界，AI 不能默认全员可见
   - `--data-charger` / `--in-charger`（任务负责人 / 维护人）：涉及职责归属
   - `--alarm-recipient` / `--notify-recipient`（告警通知接收人）：涉及通知打扰他人
   - `--task-priority`（任务优先级）：涉及调度排队
3. **高危/写操作必须先复述影响面再执行**：
   - `create / modify / publish / offline / freeze / unfreeze / folder-create / kill / submit` 等写操作，AI 在调用前必须用自然语言向用户复述："我将要在 项目 X 下创建 Y 类型任务，负责人 Z，调度周期 D，告警接收人 ABC..."，待用户确认后再执行。
   - 严禁加 `--yes` 直接跳过用户确认，除非用户已经明确说"直接执行不要再确认"。

### [OK] 推荐的用户确认话术模板

> 在执行前，我需要确认以下信息：
> 1. **项目 ID**：?（如果不确定，可以先列出您能访问的项目）
> 2. **任务名称**：?
> 3. **任务类型**：?（SuperSQL / Shell / PySpark / ...）
> 4. **任务负责人**：?
> 5. **资源组**：?（如果不确定，我可以帮您查询当前项目可用资源）
>
> 请确认或补充以上信息后，我再执行创建。

### [FAIL] 反面示例（严禁这样做）

```
用户："帮我创建一个 daily 的 supersql 任务"
AI：（直接挑了第一个项目，把负责人填成自己，把告警接收人留空）→ 调用 create
```

[OK] **正确做法**：先反问用户项目、负责人、目录、告警接收人、调度周期等关键信息；如有信息可以从查询接口拿到（如项目列表、资源列表、目录列表），先查询再让用户挑选，**不替用户做选择**。

## 可用技能

<!-- skill:sql-execute-analyze -->
### 7. sql-execute-analyze — WeData SQL 执行与分析

- **路径**: `sql-execute-analyze/`
- **用途**: 通过 WeData 数据探索 执行 SQL 查询，获取查询结果
- **触发场景**:
  - 用户需要在 WeData 数据探索平台上执行 SQL 查询
  - 用户需要查看 SQL 查询结果、任务状态
  - 用户需要获取集群列表、资源池信息
  - 用户需要配置 CMK 凭证以访问 WeData
- **核心能力**:
  - 封装 WeData 数据探索，通过 `do-bigdata wedata` CLI 命令调用（5 个原子命令：`query-clusters` / `query-pools` / `run-task` / `query-status` / `query-result-url`）
  - 支持 SQL 任务提交、状态轮询、结果获取完整流程
  - 支持集群和资源池信息查询
  - CMK 凭证由 `@auth_required` 中间件自动加载（加密存储，三级 fallback）
- **触发关键词**: WeData、数据探索、SQL查询、执行SQL、查询结果、集群列表、资源池、SuperSQL、TDW查询、CMK凭证
<!-- /skill:sql-execute-analyze -->

<!-- skill:chatbi -->
### 8. chatbi — ChatBI 智能数据分析

- **路径**: `chatbi/`
- **用途**: 对 SQL 查询结果数据进行 AI 驱动的智能分析（趋势、统计、洞察等），支持自然语言提问。[WARN] **不支持获取或导出原始明细数据**
- **触发场景**:
  - 用户需要对 SQL 查询结果进行智能分析、数据洞察
  - 用户需要分析数据趋势、异常值、分布特征
  - 用户希望用自然语言对数据进行提问和探索
  - 用户需要端到端完成「执行 SQL → 分析数据」的完整流程
- **核心能力**:
  - 与 sql-execute-analyze 端到端串联，通过 `do-bigdata wedata` CLI 命令调用（2 个原子命令：`create-session` / `analyze`）
  - 接收 task_id 和 sql_id 进行数据分析
  - 支持创建分析会话，同一会话内多轮对话上下文连续
  - 支持深度思考模式，获取更详细的分析结果
  - 与其他 WeData 子技能共享 CMK 凭证配置
- **触发关键词**: ChatBI、数据分析、分析数据、数据洞察、趋势分析、结果分析、智能分析
<!-- /skill:chatbi -->

<!-- skill:sql-prediagnosis -->
### 9. prediagnosis_skills — SQL 执行前预检与优化

- **路径**: `prediagnosis_skills/`
- **用途**: 在 SQL 提交执行前，评估性能风险、排查语法错误、优化查询效率
- **触发场景**:
  - 用户需要在执行 SQL 前评估性能风险或检查语法正确性
  - 用户希望优化 SQL 查询效率、获取优化建议
  - 数据开发/分析师/DBA 在 SQL 提交至生产环境前的预检环节
- **不触发场景**:
  - SQL 已执行失败需要诊断（→ supersql-diagnosis）
  - 需要实际执行 SQL 获取结果（→ sql-execute-analyze）
- **触发关键词**: SQL预检、性能评估、语法检查、SQL优化建议、执行前检查、预诊断
<!-- /skill:sql-prediagnosis -->

<!-- skill:supersql-diagnosis -->
### 10. supersql-diagnosis — SQL 执行失败诊断

- **路径**: `skill-sql-diagnosis/`
- **用途**: 针对 SuperSQL/TDW/WeData SQL 执行失败场景进行智能诊断，提炼日志中的核心错误，检索知识库，输出异常类型、根因定位和解决方案
- **触发场景**:
  - 用户提供了 SQL 执行失败的报错日志、堆栈信息
  - 用户反馈 SQL 执行失败、任务失败，需要定位根因
  - 用户仅提供 SQL，需要拉取日志并诊断问题
- **不触发场景**:
  - SQL 尚未执行，需要预检优化（→ prediagnosis_skills）
  - 需要执行 SQL 查询获取结果（→ sql-execute-analyze）
  - 需要生成/编写 SQL（→ supersql-codegen）
- **触发关键词**: SQL报错、执行失败、SQL诊断、报错日志、任务失败、根因分析、异常诊断
<!-- /skill:supersql-diagnosis -->

<!-- skill:supersql-codegen -->
### 11. supersql-codegen — SuperSQL/THive SQL 生成

- **路径**: `supersql-codegen/`
- **用途**: 根据自然语言需求生成符合 SuperSQL/THive 语法规范的 SQL（基于 TDW Hive + Spark 3.3），并保证生成结果在 StarRocks / Presto 跨引擎下可执行
- **触发场景**（满足任一即可加载本 Skill）:
  - 用户要求**生成 / 编写 / 写一条 SQL**，包括取数 SQL、取数视图、导出 SQL、聚合统计 SQL、多表 JOIN SQL、指标对比 SQL 等
  - 用户咨询 **THive / SuperSQL 特有语法**：建表（CREATE TABLE）、分区（PARTITION BY LIST）、INSERT、CTE / WITH、字段类型、UDF、转义符、二级分区/分桶 等
  - 用户咨询**跨引擎兼容性 / 函数白名单**：StarRocks 与 Presto 都支持的 158 个函数清单、禁用函数替代方案、Null 处理差异、StarRocks 不支持的语法等
  - 用户希望**优化、调试、改写**已有的 SuperSQL/THive SQL（语法层面，不涉及执行报错）
- **不触发场景**（应路由到其他 Skill）:
  - 用户希望**执行 SQL / 看结果 / 导出原始明细数据** → sql-execute-analyze
  - 用户希望**对查询结果做数据分析、洞察、趋势** → chatbi
  - 用户提供了**SQL 报错日志**需要诊断 → supersql-diagnosis
  - 用户希望在 SQL 提交执行**前做性能预检** → prediagnosis_skills
- **功能说明**:
  - **能做**：仅做"自然语言 → SQL 文本"的一次性生成；输出包含 SQL 列表、执行计划、模型解读
  - **不能做**：不执行 SQL、不返回业务数据、不做结果分析、不对失败任务做诊断、不做性能预检
  - **跨引擎约束**：生成的 SQL 严格限定在 StarRocks + Presto 共同支持的 158 个函数白名单内，避免下推到不同引擎时报错
  - **无状态**：每次调用都是一次性独立请求，**没有会话复用 / 多轮追问**语义；用户追问时由 AI 在新一轮请求里自行携带上下文（与 chatbi 的多轮 session 模型本质不同）
  - **必备入参**：自然语言查询描述 + 候选表名（必须含库名 `<database>.<table>`）；表名缺失时必须先向用户确认，严禁自行编造
  - **凭证与文档**：与 sql-execute-analyze、chatbi 共享同一份 CMK 凭证；标准参考文档通过 `do-bigdata docs list/show/search --skill supersql-codegen` 查阅，禁止 `read_file` 直读
- **触发关键词**: 生成SQL、写SQL、取数SQL、取数视图、导出SQL、SuperSQL语法、THive语法、建表语法、分区语法、INSERT语法、CTE、WITH、跨引擎兼容、函数白名单、158函数、SQL优化、SQL改写、SQL调试
<!-- /skill:supersql-codegen -->

<!-- skill:notebook -->
### 12. notebook — Notebook 智能编辑运行诊断
- **路径**: `notebook/`
- **用途**: 对 WeData Notebook 进行代码编辑、执行运行、诊断排错，支持串联为"编辑→执行→诊断→修改→执行→诊断"的循环工作流
- **触发场景**:
  - 用户需要读取、保存、创建 notebook 文件
  - 用户需要提交 notebook 执行任务并查询状态
  - 用户需要获取 notebook 诊断信息（kernel 状态、执行错误、环境信息等）
  - 用户需要通过 Spark app_id 进行 AI 智能诊断
  - 用户需要管理计算资源（Compute）
  - 用户需要在 notebook 中添加存储操作 cell（Ceph/HDFS）
  - 用户需要向 oncall 负责人告警或拉群
- **核心能力**:
  - 通过 `do-bigdata wedata` CLI 命令调用（18 个原子命令）
  - 代码编辑：`read-notebook` / `save-notebook` / `create-notebook` / `upload-file` / `download-file`
  - 代码运行：`execute` / `execute-status`
  - 代码诊断：`diagnose`
  - Spark 诊断：`spark-diagnose`
  - 串联工作流：`run-and-diagnose` / `edit-run-diagnose`
  - Compute 管理：`list-computes` / `get-compute` / `create-compute` / `update-compute`
  - 存储交互：`add-storage-cell`
  - Oncall 通知：`send-alert` / `create-group-chat`
  - CMK 凭证由 `@auth_required` 中间件自动加载（加密存储，三级 fallback）
- **触发关键词**: notebook、代码编辑、代码运行、代码执行、代码诊断、排错、调试、Spark诊断、app_id、oncall、告警、拉群、负责人、Compute、计算资源、存储操作、Ceph、HDFS
<!-- /skill:notebook -->

<!-- skill:explore-log-analyzer -->
### 13. explore-log-analyzer — 数据探索任务日志诊断（链路串联）

- **路径**: `explore-log-analyzer/`
- **用途**: 当用户提供一条数据探索任务日志链接（WeData 控制台日志页 `https://wedata.woa.com/explore/task/log/...`，或 SuperSQL QE 原始 apilog 链接 `https://ss-qe-log.woa.com/v1/session/explore_apilog_...`）时，自动解析出底层 SuperSQL SessionId 并转交 supersql-job-analyzer 完成根因诊断
- **强制约束（最高优先级）**: 只要用户提供的是上述两类 **URL 形态** 或 **WeData TaskId**（非 UUID 字符串），必须先经本技能调用 `do-bigdata wedata explore-query-session` 换取真正的 SuperSQL SessionId（UUID），再转交 supersql-job-analyzer。**绝对禁止**把 URL 路径里 `explore_apilog_` 之后或 `task/log/` 之后的字符串直接当作 SessionId 喂给 supersql-job-analyzer——那是 TaskId 不是 SessionId，会导致诊断拉到错误日志
- **触发场景**:
  - 用户粘贴数据探索任务日志链接（两种形态均可），问「为什么失败 / 为什么慢」
  - 用户已有 WeData TaskId，希望进一步诊断底层执行问题
- **不触发场景**:
  - 用户已经手里有 SuperSQL SessionId（**严格 UUID 格式**）且无 WeData 链接 → 直接走 supersql-job-analyzer
  - 用户想执行 SQL / 看结果 → sql-execute-analyze
- **核心能力**:
  - 通过 `do-bigdata wedata explore-query-session` 解析日志链接 → 换取 SuperSQL SessionId
  - 自身不做诊断推理，全部转交 supersql-job-analyzer
  - 在最终输出中追加 WeData TaskId ↔ SuperSQL SessionId 的链路映射，便于回溯
- **触发关键词**: 数据探索失败、explore 任务、wedata.woa.com/explore/task/log、ss-qe-log.woa.com、explore_apilog、任务日志链接诊断、探索 SQL 跑挂了
<!-- skill:explore-log-analyzer -->

<!-- skill:datamap -->
### 14. datamap — 数据地图 AI 库表检索 + 数据治理问答

- **路径**: `datamap/`
- **用途**: 数据地图（DataMap）的 AI 检索 + 治理问答双链路。一条命令搞定「按业务关键词找物理表 / 看字段说明书 / 查血缘」+「用自然语言查我（或组织）的存储治理现状」，并支持两条链路自动嵌套串联（如「治理找候选表 → 检索查血缘判可删性」）。
- **触发场景**:
  - 业务搜表：按关键词（如"微信支付"、"视频号 GMV"）找物理表，可切 4 种 scope（any 业务搜 / accessible 我有权限 / owned 我名下 / hot 我常用）
  - 单表字段说明书：要 `db.table` 的完整字段、中文名、业务含义
  - 表关联 / 血缘：双源混合（Hippo 语义图谱 + wedata DescribeMapTableLineage 兜底）
  - 自然语言查治理现状：低热度表、未配置生命周期、治理项分布、存储 Top N、应用组治理、治理方案
  - 已查过的治理结果想再加条件二次过滤（不重新走 LLM）
  - 检索 + 治理复合问题（先治理找候选 → 再检索看血缘 / 先检索找业务表 → 再看治理状态）
- **不触发场景**:
  - 跑即席 SQL（非治理底表）→ `wedata-sql-explore` / `sql-execute-analyze`
  - wedata 控制台原生元数据 / 血缘 → `wedata-metadata`（datamap 走 Hippo + wedata 双源混合，定位不同）
  - 实例运行日志 / kill / 重跑 → `wedata-instance-ops`
- **核心能力**:
  - 通过 `do-bigdata wedata datamap` 二级分组 CLI 命令调用（12 个原子命令，按 P0/P1/P2 分级）
  - **库表检索四件套**（P0 核心）: `search` / `schema` / `related` / `ask`
  - **数据治理问答**（P0 核心 + P1 重要 + P2 辅助）: `gov-chat` / `gov-detail` / `gov-summary` / `gov-suggestions` / `gov-history` / `gov-status` / `gov-stop` / `gov-health`
  - **三路并行召回**: Hippo 语义 + wedata 字面 + 热度表（任意一路挂掉自动兜底）
  - **三级权限标记**: `can_view_schema` / `has_select` 自动判定（避免介绍无权限字段）
  - **治理 5s 自适应同步/异步 + 自动轮询**: 短任务直返，长任务异步 + CLI 自动 poll
  - **SQL 透明审计**: 每次返回 `sql_info`（含 `is_llm_generated` 标记）让用户审计
  - **裸表名自动消歧**: `related` / `schema` 收到无 `db.` 前缀的表名时按表名精确召回，唯一命中自动回填，多重命中返回消歧清单
  - **结果文件落盘**: 每次调用都落盘 `tmp/datamap_result_*.json` / `governance_<endpoint>_*.json`，翻页 / 二次过滤 / 跨步串联靠 read_file，不重跑
  - ⛔ **治理写操作红线**: 检测到删表 / 改生命周期意图时**仅警告透传**，绝不自动调写接口；用户需到网页端 `http://11.151.217.90:8080/` 人工确认
- **触发关键词**: 找表、库表检索、数据资产、字段反查、表 schema、查字段、表结构、上下游、血缘、关联表、我有权限、我名下、我常用、热度表、accessible、owned、hot、related、存储概览、低热度表、未配生命周期、治理项分布、存储 Top N、优化收益、治理方案、我占了多少存储、我有多少 TB 数据、按库名统计存储分布、应用组治理、governance、数据治理、ads_wedata_cost_table_gov_detail_df、datamap、数据地图
<!-- /skill:datamap -->

## 路由规则

收到用户请求后，根据以下规则选择合适的技能（**注意**：以下条目按当前网络环境对各 Skill 的可见性动态裁剪，不在列表中的能力即代表当前环境无法使用，请勿臆测）：

| 用户意图 | 推荐技能 |
|---------|---------|
<!-- skill:sql-execute-analyze -->
| 执行 SQL 查询 / 查看查询结果 | sql-execute-analyze |
| 获取集群列表 / 资源池信息 | sql-execute-analyze |
| CMK 凭证配置 | sql-execute-analyze |
| WeData 数据探索相关咨询 | sql-execute-analyze |
<!-- /skill:sql-execute-analyze -->
<!-- skill:chatbi -->
| 对查询结果进行数据分析 | chatbi |
| 数据洞察 / 趋势分析 | chatbi |
<!-- /skill:chatbi -->
<!-- skill-any:sql-execute-analyze,chatbi -->
| 执行 SQL 并分析结果（端到端） | sql-execute-analyze → chatbi |
<!-- /skill-any:sql-execute-analyze,chatbi -->
<!-- skill:sql-execute-analyze -->
| 获取原始明细数据 / 导出数据 / 下载数据 | sql-execute-analyze（[WARN] **禁止使用 chatbi**，ChatBI 不支持获取原始明细数据） |
<!-- /skill:sql-execute-analyze -->
<!-- skill:sql-prediagnosis -->
| SQL 执行前预检 / 性能评估 / 语法检查 | prediagnosis_skills |
| SQL 优化建议（执行前） | prediagnosis_skills |
<!-- /skill:sql-prediagnosis -->
<!-- skill:supersql-diagnosis -->
| SQL 执行失败 / 报错日志诊断 | supersql-diagnosis |
| SQL 任务失败根因分析 | supersql-diagnosis |
<!-- /skill:supersql-diagnosis -->
<!-- skill:supersql-codegen -->
| 生成取数 SQL / 导出 SQL / 取数视图 | supersql-codegen |
| 编写、调试、优化 THive/SuperSQL 查询 | supersql-codegen |
| SuperSQL 语法咨询（分区、INSERT、CTE、函数兼容等） | supersql-codegen |
| 通过一条 SQL 直接完成复杂计算 | supersql-codegen |
<!-- /skill:supersql-codegen -->
<!-- skill:notebook -->
| notebook 代码编辑（读取/保存/创建文件） | notebook |
| notebook 执行运行 / 查询执行状态 | notebook |
| notebook 诊断排错 / kernel 状态 | notebook |
| Spark app_id 诊断 | notebook |
| Compute 计算资源管理 | notebook |
| notebook 存储操作（Ceph/HDFS） | notebook |
| oncall 告警 / 拉群 | notebook |
| 编辑→执行→诊断循环工作流 | notebook |
<!-- /skill:notebook -->

<!-- skill:explore-log-analyzer -->
| 数据探索任务日志链接诊断（wedata.woa.com/explore/task/log/... 或 ss-qe-log.woa.com/v1/session/explore_apilog_...） | **必须** explore-log-analyzer → supersql-job-analyzer（禁止跳过 explore-log-analyzer 直接拿 URL 里的字符串当 SessionId） |
| 提供 WeData TaskId（非 UUID 字符串）诊断底层执行问题 | **必须** explore-log-analyzer → supersql-job-analyzer |
<!-- skill:explore-log-analyzer -->

<!-- skill:datamap -->
| 按业务关键词找物理表 / 库表检索 / 数据资产搜索 | datamap（`search --scope any`） |
| 查我有权限 / 我名下 / 我常用的表 | datamap（`search --scope accessible/owned/hot`） |
| 看单张表完整字段说明书（含字段中文名 + 业务含义） | datamap（`schema`） |
| 查表关联 / 上下游血缘（Hippo + wedata 双源混合） | datamap（`related`） |
| 用自然语言查存储治理现状（低热度表 / 未配生命周期 / 治理项分布 / 存储 Top N） | datamap（`gov-chat`） |
| 在已有治理查询结果上加条件二次过滤 | datamap（`gov-detail`，从上次落盘文件读 `filter_sql`） |
| 拉用户/组织治理大盘概览 / 治理项分布 | datamap（`gov-summary`） |
| 数据/数仓概念开放问答（X 是什么 / 怎么做） | datamap（`ask` — Hippo KB Agent） |
<!-- /skill:datamap -->

<!-- skill-any:sql-prediagnosis,sql-execute-analyze,chatbi -->
| 预检 SQL → 执行 SQL → 分析结果 | prediagnosis_skills → sql-execute-analyze → chatbi |
<!-- /skill-any:sql-prediagnosis,sql-execute-analyze,chatbi -->
<!-- skill-any:supersql-codegen,sql-execute-analyze,chatbi -->
| 生成 SQL → 执行 SQL → 分析结果（全链路） | supersql-codegen → sql-execute-analyze → chatbi |
<!-- /skill-any:supersql-codegen,sql-execute-analyze,chatbi -->

<!-- skill-any:sql-execute-analyze,chatbi -->
> **端到端场景**：当用户需要「执行 SQL 并分析结果」时，先使用 sql-execute-analyze 执行 SQL 获取 task_id 和 sql_id，确认任务成功后，再使用 chatbi 进行数据分析。两个技能共享同一份 CMK 凭证配置。
<!-- /skill-any:sql-execute-analyze,chatbi -->

<!-- skill-any:supersql-codegen,sql-execute-analyze,chatbi -->
> **全链路场景**：当用户需要「从自然语言生成 SQL → 执行 → 分析」时，先使用 supersql-codegen 生成 SQL，再使用 sql-execute-analyze 执行，最后使用 chatbi 分析结果。三个技能共享同一份 CMK 凭证配置。
<!-- /skill-any:supersql-codegen,sql-execute-analyze,chatbi -->

> 如果用户的问题不属于以上任何场景，可尝试基于通用知识回答，或建议用户查阅 [WeData 使用文档](https://wedata.woa.com)。

<!-- BIGDATA_QUERY_GUARD -->

## [WARN] --query 参数（强制要求）

每次调用 `do-bigdata` 命令时，**必须**带上 `--query "<用户原始问题>"` 参数，将用户的原始自然语言问题传递给 CLI。

**正确示例**：
```bash
do-bigdata olap metric-data --cluster starrocks-prod --metric cpu_util --query "帮我看看 starrocks-prod 最近一小时的 CPU 使用率"
```

**错误示例**（缺少 --query）：
```bash
do-bigdata olap metric-data --cluster starrocks-prod --metric cpu_util
```

> `--query` 参数用于使用回传记录用户的真实问题，缺少此参数会导致回传数据中 `user_query` 字段记录为 CLI 命令而非用户原始问题。

**严禁省略 `--query` 参数。**

<!-- /BIGDATA_QUERY_GUARD -->

<!-- BIGDATA_CLI_GUARD -->

## [WARN] CLI 可用性检查（强制前置）

在执行任何 `do-bigdata` 命令之前，**必须**先检查 CLI 是否已安装：

```bash
which do-bigdata
```

### 如果 CLI 不可用，按以下步骤修复：

**第一步**：执行本地热加载脚本安装 CLI：

```bash
python3 tencent-bigdata/hot_reload.py
```

执行后再次检查 `which do-bigdata`。如果 CLI 已可用，跳到「安装后检查」。

**第二步（仅当第一步后 CLI 仍不可用时）**：本地 `hot_reload.py` 可能是远古版本，不包含 CLI 安装逻辑。需要从远程下载最新版本并重新执行：

```bash
# 从 Skills Manager 下载最新的 hot_reload.py，覆盖本地远古版本
curl -fsSL "http://bigdata-do-skills-manager.woa.com/api/root-skill/hot_reload.py/download" -o tencent-bigdata/hot_reload.py

# 同时更新根 SKILL.md
curl -fsSL "http://bigdata-do-skills-manager.woa.com/api/root-skill/SKILL.md/download" -o tencent-bigdata/SKILL.md

# 执行最新的热加载脚本（会自动安装 CLI + 更新所有 Skills）
python3 tencent-bigdata/hot_reload.py
```

### 安装后检查

检查 hot_reload 输出：
- 如果输出包含 `[WARN] 注意: do-bigdata 不在默认 PATH 中`，需要根据输出的 `bin_dir` 执行 `export PATH` 后再调用 `do-bigdata`
- 如果输出 `CLI 可用: <路径>`，则可直接使用 `do-bigdata` 命令

**如果 CLI 不可用，必须先按照上述步骤完成安装，严禁跳过安装步骤直接放弃调用。** 如果安装出现问题，请联系 shimerhe 处理。

<!-- /BIGDATA_CLI_GUARD -->
