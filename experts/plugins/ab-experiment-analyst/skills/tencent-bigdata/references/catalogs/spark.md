# Spark 子系统 Skill 明细

> [WARN] **使用本 catalog 内任何子 skill 前，必须先读取该子 skill 的 `SKILL.md`**
>
> 本文档仅用于 **路由发现**：根据触发场景 / 关键词定位到目标子 skill 后，**必须再加载** `sub-skills/<子系统>/<skill-name>/SKILL.md`，了解完整的执行步骤、参数约束、两阶段流程与边界条件，再调用 CLI 命令或脚本。
>
> [FAIL] 严禁仅凭本文档列出的命令清单直接执行；catalog 描述通常省略关键参数与前置依赖，跳读会导致执行路径不准确。

### spark-slow-analyzer

- **目录**: `Spark/spark-slow-analyzer/`
- **触发场景**: Spark Application 跑得慢/某个 Job/Stage 耗时长；两次 Spark 执行对比；数据倾斜/Shuffle 溢出/GC 问题；Spark 配置参数合理性分析。
- **触发关键词**: Spark慢、Spark Application、Stage耗时、数据倾斜、shuffle、GC问题、Spark配置、执行对比
- **核心能力**:
  - Spark Application 性能分析
  - Job/Stage 耗时定位
  - 数据倾斜和 Shuffle 溢出诊断
  - 多次执行对比分析
- **联动关系**: 被 supersql-slow-query-analyzer 引擎执行层下钻调用；资源等待严重时联动 yarn-queue-analysis；Application 失败时联动 yarn-app-diagnose
- **包含资源**:
  - 详见子 Skill SKILL.md
