# Flink 子系统 Skill 明细

> [WARN] **使用本 catalog 内任何子 skill 前，必须先读取该子 skill 的 `SKILL.md`**
>
> 本文档仅用于 **路由发现**：根据触发场景 / 关键词定位到目标子 skill 后，**必须再加载** `sub-skills/<子系统>/<skill-name>/SKILL.md`，了解完整的执行步骤、参数约束、两阶段流程与边界条件，再调用 CLI 命令或脚本。
>
> [FAIL] 严禁仅凭本文档列出的命令清单直接执行；catalog 描述通常省略关键参数与前置依赖，跳读会导致执行路径不准确。

### flink-yarn-perjob

- **目录**: `Flink/flink-yarn-perjob/`
- **触发场景**: 用户需要诊断 Flink 作业异常 / 异常重启 / TM 容器问题，包括 YARN per-job 模式下作业、Oceanus 峰峦（K8s）任务的心跳超时、GC 问题、OOM、Checkpoint 失败、Kafka Sink 失败、TM 启动异常等。兼容 Flink 1.7+。
- **触发关键词**: Flink异常、TaskExecutor关闭、心跳超时、Heartbeat timeout、GC分析、OOM、Checkpoint失败、Kafka写失败、Connection reset、oceanus.woa.com、TM日志、TM容器、taskmanager-1-X、execution、峰峦、fengluan、归档日志、stoplog、Flink作业诊断
- **核心能力**:
  - **作业级诊断（`do-bigdata flink diag`）**：
    - 通过 Flink REST API 获取作业级异常（root + per-task exceptions）
    - 心跳超时时自动获取 TaskManager GC 日志，分析 Full GC 频次并给出明确结论
    - 分析 taskmanager.log 是否存在 OutOfMemoryError，给出明确结论
    - 默认启用 JobManager GC/OOM 分析（`--no-analyze-jm-gc` 可禁用）
    - 不活跃 TM 日志获取（NodeManager 优先，MCP 兜底）
    - NoResourceAvailableException 自动诊断（搜未注册 Worker → 故障节点 → 故障单）
    - 非运行状态作业自动获取 startlog/stoplog 并提取关键错误模式
    - **关键字过滤**：`--keyword`（可多次叠加），透传给 MCP service 端按时间戳行去重，旧版 MCP 自动客户端兜底
  - **Checkpoint 失败分析（`do-bigdata flink checkpoint`）**：
    - 通过运行时指标（`/jobs/:jobid/checkpoints`）诊断 6 类失败原因（超时、对齐耗时过长、状态过大、Task 失败、被取代/取消、Coordinator 异常、数据倾斜/反压）
  - **单 TM 容器定向诊断（`do-bigdata flink tm-log`）** ⭐ 仅诊断指定 TM 一个容器，不遍历整作业其他 TM：
    - **5 种入参模式**：① `--log-url` 完整归档日志 URL（最精准，单文件直诊）② 仅 `--tm-id`（自动解析 job_id + 反查 execution）③ 叠加 `--keyword` 关键字过滤 ④ `--fengluan-url` 已知 redirect URL ⑤ `--env` 切换 Oceanus 环境
    - **默认采集分析三类文件**（仅针对目标 TM）：
      - `taskmanager.log` — 业务异常 + Caused by 链 + 关键字过滤
      - `taskmanager.out` — 容器层信号（OOMKilled / JVM crash / Native crash / Stderr）
      - `taskmanager.gc_log.0~N.current` — 自动列举所有 GC 轮转文件并合并分析，输出 ★ Full GC 结论
    - **execution 一致性校验 + 自动切换**：检测 tm-id 中的 execution 与 redirect URL 不一致时（典型场景：作业已重启，旧 execution 容器已回收），自动从 Oceanus executions 列表反查目标 execution 的 platforms URL，透明切到「已停止」流程，**仅诊断目标 TM**（精确匹配 tm-id，不遍历其他）
    - **ERROR 抽取智能裁剪**：检测 `failure cause:` / `with Exception` / `Caused by` 锚点，把 message 头部冗长 logger meta 替换为 subtask 简短摘要 + 锚点后内容；stack 优先保 Caused by 链（最多 8 行），再补 at
    - **已知噪声自动过滤**（service 端 + CLI 端双层）：
      - TDBank `BusConfigManager.requestConfiguration` 配置中心拉取失败（SDK 自带容灾）
      - Flink `FatalExitExceptionHandler.uncaughtException` / TaskExecutor / TaskManager 的 fatal 兜底声明
      - HDFS `dfsFailoverCache` 镜像缺目录
      - ClassLoader 隔离冲突的「幻影异常」`IllegalArgumentException: Expecting FormatMetricGroup, but got org.apache.flink.formats.metrics.FormatMetricGroup`（同名 FQCN 双加载）
  - **支持的 Oceanus 环境**: `pub_oceanus2.0` / `pcg_new_oceanus2.0` / `pcg_oceanus2.0` / `fit_oceanus2.0` / `pre_oceanus2.0` / `pub_oceanus1.0` / `sg_oceanus2.0` / `sg_oceanus1.0` / `wxgpay_oceanus2.0`，共 9 个；URL 自动识别
  - 通过 MCP 查询故障节点的硬件故障单（xray + xwork）
- **不触发场景**: 启动/编译失败 → `oceanus-log-analyzer`；查看作业列表 → `oceanus-job-list`；指标查询 → `oceanus-metrics-query`
- **包含资源**:
  - `scripts/yarn_flink_diag.py` — 一站式异常诊断脚本（`flink diag`）
  - `scripts/yarn_flink_checkpoint.py` — Checkpoint 失败分析脚本（`flink checkpoint`）
  - `scripts/fengluan_flink_tm_log.py` — 单 TM 容器定向诊断脚本（`flink tm-log`）
  - `references/yarn_flink_api.md` — API 端点参考文档

---

### oceanus-job-list

- **目录**: `Flink/oceanus-job-list/`
- **触发场景**: 用户需要查看、搜索、列出 Oceanus 平台上的作业（任务），支持按应用名称全局搜索（跨项目）、按项目 ID/名称查询、按应用 ID 精确查找等。仅限只读查询，不执行写操作。
- **触发关键词**: Oceanus作业列表、查询作业、搜索任务、项目列表、应用ID、作业状态、Oceanus任务
- **核心能力**:
  - 按应用名称全局搜索（非数字关键词默认跨项目模糊搜索）
  - 按应用 ID 精确查找
  - 按项目 ID/名称查询作业列表
  - 按环境列出项目列表
  - 按状态过滤（RUNNING/CANCELLED/FAILED 等）
  - 从 Oceanus URL 自动提取环境、项目 ID、任务 ID
  - 支持 9 个 Oceanus 环境
  - 单个作业自动触发 `flink-yarn-perjob` 异常分析
- **不触发场景**: 修改/创建/启停作业 → `oceanus-job-management`；诊断异常 → `flink-yarn-perjob`
- **包含资源**:
  - `scripts/oceanus_job_list.py` — 作业列表查询脚本
  - `references/oceanus_job_api.md` — Oceanus 作业列表 REST API 参考文档

---

### oceanus-log-analyzer

- **目录**: `Flink/oceanus-log-analyzer/`
- **触发场景**: **仅当**用户提到「启动失败」「启动异常」「启动错误」「编译异常」「编译失败」「编译错误」「停止中」「停止失败」「停止错误」时触发。专攻作业的构建/启动/停止三阶段日志，不处理运行期异常。
- **触发关键词**: 启动失败、启动异常、编译异常、编译失败、停止中、停止失败、Oceanus启动日志、构建失败、JAR冲突、ClassNotFoundException
- **不触发场景**: 查看作业状态 → `oceanus-job-management`；修改配置 → `oceanus-job-management`；运行期异常 / Checkpoint → `flink-yarn-perjob`；指标 → `oceanus-metrics-query`
- **核心能力**:
  - 获取作业构建/启动/停止阶段日志（buildlog / startlog / stoplog）
  - 基于 20+ 种常见异常模式自动识别问题类型
  - 检测 ClassNotFoundException、NoSuchMethodError、NoClassDefFoundError 等 JAR 冲突
- **包含资源**:
  - `scripts/oceanus_log_diag.py` — Oceanus 日志分析脚本
  - `references/oceanus_log_api.md` — Oceanus 日志 REST API 参考文档

---

### oceanus-resource-advisor

- **目录**: `Flink/oceanus-resource-advisor/`
- **触发场景**: 用户需要了解项目资源总量/使用情况、应用组资源、作业资源占用明细、资源申请/扩容/换集群指引。仅查询资源配额与使用，不修改作业配置、不诊断异常。
- **触发关键词**: 项目资源、资源概览、资源配额、应用组资源、集群资源、CPU内存、资源申请、扩容、换集群、集群列表、资源不足
- **不触发场景**: 诊断作业异常 → `flink-yarn-perjob`；分析启动/停止日志 → `oceanus-log-analyzer`；查看作业列表 → `oceanus-job-list`；调整作业 CU 配置 → `oceanus-job-management`
- **包含资源**:
  - `scripts/oceanus_resource_query.py` — 资源查询脚本
  - `references/oceanus_resource_api.md` — 资源 REST API 参考文档

---

### oceanus-job-management

- **目录**: `Flink/oceanus-job-management/`
- **触发场景**: 用户需要对 Oceanus 作业进行全生命周期管理（查看详情、创建、修改、启动、停止、重启、编译、资源配置、告警配置、版本管理）。
- **触发关键词**: 查看作业、修改作业、创建作业、启动作业、停止作业、重启作业、编译作业、作业状态、作业详情、作业版本、资源配置、告警配置
- **不触发场景**: 仅查看作业列表（不做操作）→ `oceanus-job-list`；诊断作业异常 → `flink-yarn-perjob`
- **包含资源**:
  - `scripts/oceanus_job_mgmt.py` — 作业管理脚本
  - `references/oceanus_job_api.md` — 作业管理 REST API 参考文档

---

### oceanus-file-management

- **目录**: `Flink/oceanus-file-management/`
- **触发场景**: 管理 Oceanus 平台文件（JAR 包、依赖文件），包括上传、列表查看、版本管理、函数/应用关联和迁移。
- **触发关键词**: 文件、JAR 包、依赖文件、文件版本、上传、下载、迁移、文件管理、jar、upload、download
- **包含资源**:
  - `scripts/oceanus_file_mgmt.py` — 文件管理脚本
  - `references/oceanus_file_api.md` — 文件管理 REST API 参考文档

---

### oceanus-metrics-query

- **目录**: `Flink/oceanus-metrics-query/`
- **触发场景**: 查询 Oceanus 平台 Flink 作业监控指标。覆盖三大数据源 + 历史回溯能力。
- **触发关键词**: 指标、监控、TPS、延迟、Checkpoint、背压、吞吐量、metrics、Hermes、NGCP、connector 指标、operator 指标、MQ 消费延迟、StarRocks 历史指标、离线指标、Trace 事件、告警消息、作业阶段耗时、vertices 详情、TaskManager 资源、Flink 版本、多版本适配
- **核心能力**:
  - **Hermes 平台指标**（`oceanus_metrics_query.py`）：实时业务指标查询
  - **Flink UI 指标**（`flink_ui_query.py`）：直接调用 Flink REST API 取实时指标，支持 vertices 详情、TaskManager 资源、异常信息、Flink 版本探测与多版本适配
  - **StarRocks 历史指标**（`starrocks_metrics_query.py`）：离线指标分析、运行失败后回溯、Trace 事件查询、告警消息聚合、作业阶段耗时
- **不触发场景**: 诊断作业异常 → `flink-yarn-perjob`；启动/编译日志 → `oceanus-log-analyzer`
- **包含资源**:
  - `scripts/oceanus_metrics_query.py` — Hermes 平台指标查询
  - `scripts/flink_ui_query.py` — Flink UI 指标查询
  - `scripts/starrocks_metrics_query.py` — StarRocks 历史指标查询
  - `references/oceanus_metrics_api.md` — Hermes 指标 API 参考
  - `references/flink_rest_api_reference.md` — Flink REST API 端点参考
  - `references/starrocks_metrics_reference.md` — StarRocks 历史指标查询参考
  - `references/flink_metrics_analysis_guide.md` — Flink 指标分析指南

---

### oceanus-project-management

- **目录**: `Flink/oceanus-project-management/`
- **触发场景**: 管理 Oceanus 项目（项目列表、详情、创建、更新、成员管理）。
- **触发关键词**: 查看项目、项目列表、创建项目、更新项目、项目成员、项目详情
- **包含资源**:
  - `scripts/oceanus_project_mgmt.py` — 项目管理脚本
  - `references/oceanus_project_api.md` — 项目管理 REST API 参考文档

---

### oceanus-resource-management

- **目录**: `Flink/oceanus-resource-management/`
- **触发场景**: 管理 Oceanus 平台库表（Connector/Schema）和函数（UDF），包括创建、查看、更新，以及版本管理和关联作业查询。
- **触发关键词**: 库表、函数、connector、schema、UDF、table、function、资源管理、元数据
- **不触发场景**: 资源配额/集群资源 → `oceanus-resource-advisor`（注意区分：本 skill 是「业务元数据」，那个是「计算资源配额」）
- **包含资源**:
  - `scripts/oceanus_resource_mgmt.py` — 资源管理脚本
  - `references/oceanus_resource_api.md` — 资源管理 REST API 参考文档
