# US（统一调度）子系统 Skill 明细

> [WARN] **使用本 catalog 内任何子 skill 前，必须先读取该子 skill 的 `SKILL.md`**
>
> 本文档仅用于 **路由发现**：根据触发场景 / 关键词定位到目标子 skill 后，**必须再加载** `sub-skills/<子系统>/<skill-name>/SKILL.md`，了解完整的执行步骤、参数约束、两阶段流程与边界条件，再调用 CLI 命令或脚本。
>
> [FAIL] 严禁仅凭本文档列出的命令清单直接执行；catalog 描述通常省略关键参数与前置依赖，跳读会导致执行路径不准确。

### us-fail-task-diagnose

- **目录**: `US/us-fail-task-diagnose/`
- **触发场景**: US 任务失败/报错/诊断失败原因；出库入库失败/脏数据/权限错误；查询告警记录（延迟/失败告警）；US 平台使用咨询（权限、配置、调度等）；封闭域相关问题。
- **触发关键词**: US任务失败、出库失败、入库失败、脏数据、权限错误、SQL报错、连接失败、OOM、告警记录、封闭域、Permission denied、脚本错误、连接超时
- **核心能力**:
  - 通过 US API 采集任务配置、实例状态、执行日志、依赖关系
  - 识别任务类型（20+种）和错误阶段（调度阶段/运行阶段）
  - 匹配已知错误模式（出库/入库/权限/连接/资源/超时/SQL/脚本/HDFS/Shell/封闭域等 11 类）
  - 失败任务自动调用平台智能分析接口（fail_task_analyze）
  - 级联深度诊断（US → SuperSQL → YARN 自动级联）：
    - 有 Application ID → 自动级联 YARN 诊断
    - 有 Session/Connection ID → 自动级联 SuperSQL 链路诊断
    - 支持 SuperSQL Implicit Bypass 机制感知
  - 诊断报告输出（基础信息、执行记录、依赖链路、根因分析、解决方案、相关链接）
  - 临时诊断文件自动清理
- **包含资源**:
  - 共享 `us-log-analyzer` 的 CLI 命令能力和参考文档
  - 独立参考文档：execution-rules、cascade-diagnosis、error-patterns、platform-and-log、fail-task-analyze-api、reference-links

---

### us-slow-task-diagnose

- **目录**: `US/us-slow-task-diagnose/`
- **触发场景**: US 任务慢/耗时异常/超时；等待下发/调度延迟/队列排队；任务各阶段耗时分析/性能瓶颈定位。
- **触发关键词**: 任务慢、执行慢、耗时长、耗时异常、跑得慢、超时、等待下发、运行时间长、调度延迟、队列排队、资源等待、任务超时
- **核心能力**:
  - 6 阶段全生命周期耗时拆解（US 调度等待 → 提交引擎 → Runner 准备 → 引擎提交 → Application 运行 → 收尾）
  - 自动获取上一运行周期日志进行耗时对比分析
  - 自动标注占比 >30% 的瓶颈阶段
  - 耗时增幅判定（总耗时或关键阶段增幅 >50% 为异常）
  - 级联深度诊断（慢任务专项）：
    - 底层引擎=Spark + 1个 App ID → 级联 spark-slow-analyzer（diagnose 模式）
    - 底层引擎=Spark + 2个 App ID（含上一周期）→ 级联 spark-slow-analyzer（compare 模式）
    - 底层引擎=MR/Flink + App ID → 级联 yarn-app-diagnose
    - 有 Session/Connection ID → 级联 SuperSQL 链路诊断
    - 无关键 ID 但耗时异常 → 级联 yarn-queue-analysis（队列资源分析）
  - 诊断报告输出（基础信息、阶段耗时分析、耗时对比表格、根因分析、优化建议）
  - 临时诊断文件自动清理
- **包含资源**:
  - 共享 `us-log-analyzer` 的 CLI 命令能力和参考文档
  - 独立参考文档：execution-rules、cascade-diagnosis、platform-and-log

---

### us-operate-diagnose

- **目录**: `US/us-operate-diagnose/`
- **触发场景**: 用户需要对 US 任务或实例进行管理操作，包括创建、修改、复制、上传脚本、创建依赖、冻结解冻、补录、回溯、重跑、终止、强制成功等。
- **触发关键词**: 创建任务、上传脚本、创建依赖、冻结任务、解冻任务、修改任务、复制任务、任务补录、任务回溯、重跑实例、终止实例、kill实例、强制成功、查询告警配置、修改告警
- **核心能力**:
  - **任务级操作**：
    - 创建任务（两阶段：prepare 校验 + execute 执行，三道门禁确认流程）
    - 批量创建任务
    - 修改任务（两阶段，支持告警配置自动补全，展示修改前后对比）
    - 复制任务（两阶段，支持批量复制、超过 10 个自动分批，支持 addlink 控制是否复制关联关系）
    - 上传脚本（四道门禁流程：参数校验 → 脚本检查 → 确认上传 → 执行上传）
    - 创建依赖关系（在两个任务间建立父子依赖）
    - 冻结/解冻任务（两阶段，自动查询任务信息展示确认，超过 10 个自动分批）
    - 查询任务类型、查询告警配置、获取扩展参数列表
  - **实例级操作**：
    - 补录实例（自动按周期类型分批，生效日期约束自动处理）
    - 回溯任务（自动路由 WeData/US 接口，根据任务 ID 长度和 projectId 智能判断）
    - 重跑实例（自动分批 + 异步轮询结果，支持多种重跑方式选择）
    - 终止实例（两阶段 + 终止轮询策略）
    - 强制成功（两阶段 + 强制成功轮询策略）
  - **智能特性**：
    - 操作前自动查询任务信息，基于调度周期给出合理时间范围示例
    - 操作人自动从 CMK 凭证获取，无需用户提供
    - 小时/分钟任务时间格式自动补齐
    - 隐藏底层命令行和原始 JSON，只展示结构化结果
- **包含资源**:
  - 独立参考文档：create-task-flow、upload-script-flow、task-modify-freeze-flow、instance-operate-flow、operation-notes、cli-reference

---

### us-log-analyzer

- **目录**: `US/us-log-analyzer/`
- **触发场景**: **不直接对用户触发**（失败/慢任务诊断由对应 Skill 调用）；但以下场景直接路由到此 Skill：下载脚本、批量下载应用组脚本、查询脚本版本、查询视图/视图详情、查询任务列表、查询 WeData 开发态日志、US 平台使用咨询。
- **触发关键词**: 下载脚本、批量下载、脚本版本、脚本查询、应用组脚本、WeData日志、开发态日志、执行记录、US使用指南、封闭域、任务类型配置、Gaia集群、查询视图、视图ID、视图详情、任务所属视图、视图任务列表、任务列表查询、WeData任务列表、WeData任务详情、下载WeData脚本
- **核心能力**:
  - **US API 查询命令**（`do-bigdata us`）：
    - 任务查询（check、query-task）
    - 实例状态查询（query-run）
    - 执行日志获取（log、stage-log，支持精确定位参数）
    - 集群 Job ID 查询（job-info）
    - 依赖关系查询（relation，支持依赖检测模式）
    - 变更记录查询（change-log）
    - 重跑明细查询（redo-list）
    - 任务列表查询（task-list，按负责人/应用组/视图ID等条件筛选）
    - 任务类型信息查询（task-type-info）
    - 视图查询（list-view 查询任务所属视图、view-detail 查询视图详情含任务列表和依赖关系）
  - **US 脚本管理命令**：
    - 单个脚本下载（download-script）
    - 批量下载应用组脚本（batch-download，内置限流保护 192次/min）
    - 脚本版本查询（script-versions）
    - 脚本元数据查询（script-view）
    - 脚本存在检查（script-exist）
  - **WeData API 查询命令**（`do-bigdata us`）：
    - 调度态日志查询（describe-log）
    - 开发态执行记录查询（describe-execution-records）
    - 开发态执行日志查询（describe-execution-log）
    - WeData 项目任务列表查询（describe-tasks）
    - WeData 任务详情查询（describe-task-detail）
    - WeData 任务脚本下载（download-file）
  - **脚本下载降级策略**：US API 下载失败时自动降级到 WeData API 重试
  - **通用功能**：本地缓存、自动重试（3次指数退避）、限流保护（100ms间隔）、错误处理
- **包含资源**:
  - `references/` — 11 个参考文档：
    - `troubleshooting-guide.md` — 排障流程（含任务责任人管理流程）
    - `common-errors.md` — 错误码索引及解决方案（含 US 工具箱分类列表）
    - `us-user-guide.md` — US 平台使用指南（权限/依赖/补录/告警/冻结/重跑/视图等）
    - `us-task-types.md` — 任务类型配置指南（出库/入库/计算/同步/Shell等）
    - `closed-domain-guide.md` — 封闭域使用指南
    - `us-api-identification.md` — US API 前缀识别规则
    - `gaia-clusters.md` — Gaia 集群 ID 与名称映射表（300+集群）
    - `notebook-runner-guide.md` — WeData Notebook 一键转调度指南
    - `us-faq.md` — US 常见问题（FAQ）
    - `tdw-sql-common-issues.md` — TDW SQL 常见问题汇总
    - `mysql-sync-ip-whitelist.md` — MySQL 同步 IP 白名单授权指南
