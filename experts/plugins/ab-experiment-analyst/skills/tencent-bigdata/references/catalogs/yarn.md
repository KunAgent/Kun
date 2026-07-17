# Yarn 子系统 Skill 明细

> [WARN] **使用本 catalog 内任何子 skill 前，必须先读取该子 skill 的 `SKILL.md`**
>
> 本文档仅用于 **路由发现**：根据触发场景 / 关键词定位到目标子 skill 后，**必须再加载** `sub-skills/<子系统>/<skill-name>/SKILL.md`，了解完整的执行步骤、参数约束、两阶段流程与边界条件，再调用 CLI 命令或脚本。
>
> [FAIL] 严禁仅凭本文档列出的命令清单直接执行；catalog 描述通常省略关键参数与前置依赖，跳读会导致执行路径不准确。

### yarn-app-diagnose

- **目录**: `Yarn/yarn-app-diagnose/`
- **触发场景**: 诊断 YARN Application 失败原因，需提供 Application ID。支持 Spark、MapReduce、Flink、Tez 等引擎。Spark 类型应用在日志分析后会自动调用知识库检索，获取历史诊断案例作为辅助参考。
- **触发关键词**: YARN Application、app_id、应用失败、Container killed、Executor lost、OOM、YARN日志分析、Spark失败、MapReduce失败、Flink on YARN失败、AM日志、Driver日志
- **核心能力**:
  - 应用状态分析（state / final_status / diagnostics / am_container_logs）
  - AM 日志列表获取与精准定位
  - 日志内容分段读取 + grep 关键字过滤
  - 多 AM attempt 信息聚合（含每个 attempt 的 log_urls）
  - 失败模式匹配（基于 `yarn_log_patterns.md` 异常模式库）
  - 知识库语义检索（Spark 场景，单次诊断最多 3 次）
- **CLI 命令**:
  - `do-bigdata yarn app-info` — 获取应用基础信息（状态/耗时/diagnostics/AM 日志链接/所有 attempt log_urls）
  - `do-bigdata yarn log-list` — 获取 AM 容器日志文件列表
  - `do-bigdata yarn log-content` — 获取日志内容（支持 `--start` 字节偏移和 `--grep` 关键字过滤）
  - `do-bigdata yarn knowledge-search` — 根据错误关键词检索知识库历史诊断案例（仅 Spark 类型，最多 3 次）
- **参考文档**: `do-bigdata docs show --skill yarn-app-diagnose --file yarn_log_patterns.md`

---

### yarn-queue-analysis

- **目录**: `Yarn/yarn-queue-analysis/`
- **触发场景**: 分析 YARN 队列或应用组的资源使用情况，识别队列拥堵、资源大户、空跑/低效任务、临时任务、批量补录。需提供应用组名称（appgroup_name）和集群名称（cluster_name），也可通过 app_id 反查应用组信息。
- **触发关键词**: 队列资源、队列分析、队列拥堵、应用组资源、资源使用率、pending任务、排队任务、资源大户、空跑任务、批量补录、queue分析、YARN资源
- **核心能力**:
  - 队列健康度评估（资源使用率 / pending 任务数 / 拥堵判断）
  - 资源消耗 Top-N 应用识别（资源占用大户）
  - 空跑 / 低效任务识别（长时间运行但资源增量极低）
  - 临时任务、新增任务、批量补录任务发现
  - 用户维度资源聚合（识别资源占比最高的用户）
  - 队列使用率时序趋势分析
- **CLI 命令**:
  - `do-bigdata yarn appgroup-info` — 通过 app_id 反查应用组和集群信息
  - `do-bigdata yarn queue-clusters` — 查询应用组的集群列表
  - `do-bigdata yarn queue-status` — 获取应用组当前资源使用状态快照
  - `do-bigdata yarn queue-analysis` — 综合应用分析（一次返回 6 维度：Top-N/持续占用/临时任务/新增任务/批量补录/用户聚合，1 分钟最多 2 次）
  - `do-bigdata yarn queue-trend` — 队列使用率时序趋势 + 统计摘要
- **参考文档**: `do-bigdata docs show --skill yarn-queue-analysis --file queue_analysis_guide.md`
