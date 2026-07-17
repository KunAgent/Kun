# SuperSQL 子系统 Skill 明细

> [WARN] **使用本 catalog 内任何子 skill 前，必须先读取该子 skill 的 `SKILL.md`**
>
> 本文档仅用于 **路由发现**：根据触发场景 / 关键词定位到目标子 skill 后，**必须再加载** `sub-skills/<子系统>/<skill-name>/SKILL.md`，了解完整的执行步骤、参数约束、两阶段流程与边界条件，再调用 CLI 命令或脚本。
>
> [FAIL] 严禁仅凭本文档列出的命令清单直接执行；catalog 描述通常省略关键参数与前置依赖，跳读会导致执行路径不准确。

### supersql-job-analyzer

- **目录**: `SuperSQL/supersql-job-analyzer/`
- **触发场景**: 排查 SuperSQL 作业执行失败，追踪 SQL 全链路（supersql → thive/livy → yarn）。需提供 sessionId。
- **触发关键词**: SuperSQL、supersql sessionId、作业分析、session日志、thive、livy、SQL链路追踪、执行失败
- **包含资源**:
  - `scripts/analyze_session.py` — 作业全链路分析诊断脚本

---

### supersql-slow-query-analyzer

- **目录**: `SuperSQL/supersql-slow-query-analyzer/`
- **触发场景**: 用户反馈 SuperSQL 执行慢、耗时长、比以前慢、查询卡住、多次执行耗时差异大。支持单 Session 诊断和多 Session 横向比对。
- **触发关键词**: 执行慢、耗时长、比以前慢、卡住、性能变差、慢查询、sessionId + 慢
- **不触发场景**: 非慢查询场景（如任务失败但不慢、纯语法错误等）→ supersql-job-analyzer
- **核心能力**:
  - 单 Session 诊断和多 Session 横向比对
  - 分层下钻（SuperSQL → 引擎 → Yarn/Spark）逐层定位性能瓶颈
  - 构建执行时间线，定位耗时瓶颈层级
  - Spark/YARN 下钻（联动 spark-slow-analyzer）
- **包含资源**:
  - `scripts/session_timeline.py` — Session 时间线分析脚本
