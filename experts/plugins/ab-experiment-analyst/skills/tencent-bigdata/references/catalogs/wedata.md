# WeData 子系统 Skill 明细

> [WARN] **使用本 catalog 内任何子 skill 前，必须先读取该子 skill 的 `SKILL.md`**
>
> 本文档仅用于 **路由发现**：根据触发场景 / 关键词定位到目标子 skill 后，**必须再加载** `sub-skills/<子系统>/<skill-name>/SKILL.md`，了解完整的执行步骤、参数约束、两阶段流程与边界条件，再调用 CLI 命令或脚本。
>
> [FAIL] 严禁仅凭本文档列出的命令清单直接执行；catalog 描述通常省略关键参数与前置依赖，跳读会导致执行路径不准确。

<!-- skill:notebook -->
### notebook

- **目录**: `WeData/notebook/`
- **触发场景**: 对 WeData Notebook 进行代码编辑、执行运行、诊断排错，可串联"编辑→执行→诊断→修改→执行→诊断"循环。支持 Ceph 存储交互 cell、通过 Spark `app_id` 做 AI 智能诊断、在无法解决时给对应板块 oncall 告警/拉群。
- **触发关键词**: notebook、代码编辑、代码运行、代码执行、代码诊断、排错、调试、Spark诊断、app_id、oncall、告警、拉群、负责人
- **核心能力**:
  - 读取 / 保存 notebook 文件（对应 Jupyter ContentsHandler）
  - 提交执行 + 查询状态（ExecuteHandler / ExecuteStatusHandler）
  - 文件诊断信息（kernel 状态、执行错误、环境信息）
  - Ceph 存储 cell（ls / put / get / mkdir / cat / put-variable，**禁止删除**）
  - Spark application_id → LLMAPP AI 诊断（异常类型 / 根因 / 解决方案）
  - Compute 资源管理（查 / 创建 / 更新，**不支持删除**）
  - Oncall 通知（告警、拉群需用户同意）
- **CLI 命令**（统一挂在 `do-bigdata wedata notebook` 下）:
  - 文件操作：`read-notebook` / `save-notebook` / `create-notebook` / `upload-file` / `download-file`
  - 执行：`execute` / `execute-status`
  - 诊断：`diagnose` / `spark-diagnose`
  - 组合工作流：`run-and-diagnose` / `edit-run-diagnose`
  - Compute：`list-computes` / `get-compute` / `create-compute` / `update-compute`
  - 存储 cell：`add-storage-cell`
  - Oncall：`send-alert` / `create-group-chat`
- **参考文档**: `do-bigdata docs show --skill notebook --file USER_GUIDE.md`

---
<!-- /skill:notebook -->

<!-- skill:sql-execute-analyze -->
### sql-execute-analyze

- **目录**: `WeData/sql-execute-analyze/`
- **触发场景**: 在 WeData 数据探索平台**同步执行** SQL 查询、查看结果、获取集群和资源池信息（老链路，基于 do-mcp 的端到端同步调用）。
- **触发关键词**: WeData、数据探索、SQL查询、执行SQL、查询结果、集群列表、资源池、TDW查询
- **不触发场景**:
  - 通用即席 SQL 提交+轮询+取结果（推荐新链路）→ `wedata-sql-explore`
  - SQL 执行失败诊断 → `supersql-diagnosis`
  - SQL 生成 → `supersql-codegen`
  - SQL 预检 → `sql-prediagnosis`
- **CLI 命令**:
  - `do-bigdata wedata query-clusters` — 查可用集群
  - `do-bigdata wedata query-pools` — 查某集群下的资源池
  - `do-bigdata wedata run-task` — 同步提交 SQL 任务
  - `do-bigdata wedata query-status` — 查任务状态
  - `do-bigdata wedata query-result-url` — 拉取结果下载链接

---
<!-- /skill:sql-execute-analyze -->

<!-- skill:chatbi -->
### chatbi

- **目录**: `WeData/chatbi/`
- **触发场景**: 对 SQL 查询结果进行智能分析、数据洞察、趋势分析。通常与 sql-execute-analyze / wedata-sql-explore 串联。**不支持导出原始明细数据**。
- **触发关键词**: ChatBI、数据分析、数据洞察、趋势分析、结果分析、智能分析
- **不触发场景**: 获取/导出原始数据 → `sql-execute-analyze` / `wedata-sql-explore`
- **CLI 命令**:
  - `do-bigdata wedata create-session` — 创建 ChatBI 分析会话
  - `do-bigdata wedata analyze` — 对结果集或问题做智能分析

---
<!-- /skill:chatbi -->

<!-- skill:supersql-codegen -->
### supersql-codegen

- **目录**: `WeData/supersql-codegen/`
- **触发场景**: 生成取数 SQL / 导出 SQL / 取数视图，编写、调试、优化 THive/SuperSQL 查询，SuperSQL 语法咨询，跨引擎兼容性问题（StarRocks/Presto），函数白名单查询。
- **触发关键词**: 生成SQL、写SQL、取数SQL、取数视图、导出SQL、SuperSQL语法、THive语法、CREATE TABLE、PARTITION BY LIST、INSERT、跨引擎兼容、函数白名单、SQL优化、SQL调试
- **不触发场景**: 用户不含取数关键词且明确要求"一条 SQL 搞定"时转为复杂 SQL 生成
- **核心能力**:
  - 严格遵循 THive 语法规则（与 Apache Hive 差异大）
  - 158 个跨引擎兼容白名单函数管控
  - 取数 SQL 生成（默认）和复杂 SQL 生成（明确指定时）
  - Null 处理跨引擎差异
- **当前状态**: 本 Skill **尚未 CLI 化**（`do_cli/` 下无对应目录），仍通过两个老脚本提供能力，待后续 CLI 化：
  - `scripts/sql_gen_api.py` — 取数 SQL 生成脚本
  - `scripts/complex_sql_gen_api.py` — 复杂 SQL 生成脚本
- **参考文档**: `do-bigdata docs list --skill supersql-codegen`（完整 THive/SuperSQL 语法参考文档体系，60+ 文件）

---
<!-- /skill:supersql-codegen -->

<!-- skill:sql-prediagnosis -->
### sql-prediagnosis

- **目录**: `WeData/sql-prediagnosis/`
- **触发场景**: SQL 执行前的预检环节，评估性能风险、排查语法错误、优化查询效率，适用于提交至生产环境前的 SQL 诊断。
- **触发关键词**: SQL预检、SQL诊断、语法检查、性能风险、暴力扫描、笛卡尔积、隐式转换
- **核心能力**:
  - 语法错误纠正
  - 暴力扫描检测和笛卡尔积排查
  - 隐式转换识别和空表检测
  - Where 条件逻辑问题检测
  - 业务意图不匹配分析
- **CLI 命令**:
  - `do-bigdata wedata prediagnosis-schema` — 生成包含 `sliced_sql_details` 的 `schema_info.json`
  - `do-bigdata wedata prediagnosis-hints` — 将 `schema_info.json` 转换为 `diagnosis_hints.txt`
- **参考文档**:
  - `do-bigdata docs show --skill sql-prediagnosis --file skill_usage_guide.md`
  - `do-bigdata docs show --skill sql-prediagnosis --file diagnosis_instructions.md`
  - `do-bigdata docs show --skill sql-prediagnosis --file format_of_API_return.md`
<!-- /skill:sql-prediagnosis -->

<!-- skill:datamap -->
### datamap

- **目录**: `WeData/datamap/`
- **触发场景**: 数据地图 AI 库表检索 + 数据治理问答。按业务关键词找物理表、看字段说明书、查血缘、查我有权限/我名下/我常用的表；用自然语言查询自己/组织的存储治理现状（低热度表、未配置生命周期、治理项分布、存储 Top N、治理方案）。
- **触发关键词**: 找表、库表检索、数据资产、字段反查、表 schema、查字段、表结构、上下游、血缘、关联表、我有权限、我名下、我常用、热度表、存储概览、低热度表、未配生命周期、治理项分布、存储 Top N、优化收益、治理方案、数据地图、datamap、governance、ads_wedata_cost_table_gov_detail_df
- **不触发场景**:
  - 跑即席 SQL → `wedata-sql-explore`
  - 查表实例运行日志 → `wedata-instance-ops`
  - 元数据/血缘走 wedata 控制台原生接口 → `wedata-metadata`（datamap 走 Hippo + wedata 双源混合）
- **核心能力**:
  - 三路并行召回（Hippo 语义 + wedata 字面 + 热度表）
  - 双源血缘（Hippo derivedFrom + wedata DescribeMapTableLineage 兜底）
  - 三级权限标记（can_view_schema / has_select 自动判定）
  - 治理问答 5s 自适应同步/异步 + 自动轮询
  - SQL 透明审计（每次返回 sql_info 让用户审计）
  - ⛔ 治理写操作（删表 / 改生命周期）红线：检测到删除意图仅警告透传，绝不自动 confirm
- **CLI 命令**（统一挂在 `do-bigdata wedata datamap` 下）:
  - `do-bigdata wedata datamap search` — 业务搜表（4 种 scope 可切换：any/accessible/owned/hot）
  - `do-bigdata wedata datamap schema` — 单表字段说明书
  - `do-bigdata wedata datamap related` — 关联血缘（双源混合）
  - `do-bigdata wedata datamap ask` — Hippo KB 开放问答
  - `do-bigdata wedata datamap gov-chat` — ⭐ 核心治理对话
  - `do-bigdata wedata datamap gov-detail` — 治理结果二次过滤
  - `do-bigdata wedata datamap gov-summary` — 治理概览
  - `do-bigdata wedata datamap gov-suggestions` — 首屏推荐
  - `do-bigdata wedata datamap gov-status` / `gov-stop` — 任务管理
  - `do-bigdata wedata datamap gov-history` — 历史回放
  - `do-bigdata wedata datamap gov-health` — 服务探活
- **参考文档**:
  - `do-bigdata docs show --skill datamap --file parameter_mapping.md`
  - `do-bigdata docs show --skill datamap --file output_format.md`
  - `do-bigdata docs show --skill datamap --file governance_api.md`

---
<!-- /skill:datamap -->
