# 运维操作参考指南

按需加载本文档。适用场景：路由歧义需要更多触发词、组合诊断需要联动关系、遇到脚本执行报错。

---

## 热加载说明

`hot_reload.py` 是会话级总入口，每次会话首次加载时执行：

1. 从远程 Skills Manager 拉取最新 `sub-skills/` 全部内容
2. 自动检查并安装/升级 `do-bigdata` CLI（wheel 包）
3. 同步全局规则（CLI 调用规则，写入 CodeBuddy / OpenClaw / WorkBuddy agents）

权限校验不再独立为步骤，由 `do-bigdata` CLI 内部的 `@auth_required` 装饰器自动完成。

---

## 触发关键词

触发关键词的权威来源为各子系统 SKILL.md 和子 Skill SKILL.md。如需查看全量关键词，加载 `references/skill_catalog.md`。

以下仅列出**易混淆的路由歧义**场景及判定规则：

| 歧义场景 | 判定规则 |
|----------|---------|
| `BlockMissingException` vs `Could not get block locations` | 前者为丢块 → hdfs-miss-block-diagnose；后者为存储满 → hdfs-storage-full-diagnose |
| SuperSQL sessionId 但未说明"慢"还是"报错" | **禁止默认选择**，必须反问用户确认 |
| "查询失败" + StarRocks vs SuperSQL | 有集群名 → starrocks-query-failure；有 sessionId → supersql-job-analyzer |
| OOM（多个子系统共用） | Flink 上下文 → flink-yarn-perjob；YARN 上下文 → yarn-app-diagnose；US 上下文 → us-fail-task-diagnose |
| "权限" 关键词 | tauth/库表权限 → Authentication；StarRocks Access denied → starrocks-privilege-analysis |

---

## Skills 间联动关系

```
┌─────────────────────────┐
│  starrocks-cluster-ops  │  ← 集群全貌入口
│  （集群信息/节点/配置）    │
└──────────┬──────────────┘
           │ 节点异常时查看监控
           ▼
┌─────────────────────────┐       ┌──────────────────────────┐
│ starrocks-load-analysis │ ◄─────│  starrocks-query-failure │
│  （智研监控指标查询）      │  超时  │  （查询失败分析）          │
└──────────▲──────────────┘  联动  └──────────────────────────┘
           │                                    ▲
           │ 负载异常时                           │ 失败记录
           │ 查看监控                             │ 来源
           │                                    │
┌──────────┴──────────────┐       ┌──────────────┴───────────┐
│ starrocks-schema-change │       │  starrocks-query-info    │
│  （Schema Change 分析）   │       │  （审计/高危/计划/Profile）│
└─────────────────────────┘       └──────────────────────────┘

┌─────────────────────────┐       ┌──────────────────────────┐
│  supersql-job-analyzer  │ ───── │   yarn-app-diagnose      │
│  （SuperSQL 链路追踪）    │  下游  │  （YARN Application 诊断）│
└─────────────────────────┘  联动  └──────────────────────────┘

┌──────────────────────────────┐       ┌──────────────────────────┐
│ supersql-slow-query-analyzer │ ───── │   spark-slow-analyzer    │
│  （SuperSQL 慢查询诊断）       │  下钻  │  （Spark 性能分析）        │
└──────────────────────────────┘  联动  └──────────┬───────────────┘
                                                   │ 资源等待时
                                                   ▼
                                        ┌──────────────────────────┐
                                        │  yarn-queue-analysis     │
                                        │  （队列资源分析）          │
                                        └──────────────────────────┘

┌─────────────────────────┐       ┌──────────────────────────┐
│  us-fail-task-diagnose  │ ───── │   supersql-job-analyzer   │
│  （US 任务失败诊断）      │  级联  │   / yarn-app-diagnose    │
└─────────────────────────┘  下钻  └──────────────────────────┘

┌──────────────────────────────┐       ┌──────────────────────────────┐
│ hdfs-miss-block-diagnose     │ ───── │ hdfs-cluster-load-diagnose   │
│  （HDFS 丢块诊断）            │  负载  │  （HDFS 集群负载诊断）         │
└──────────────────────────────┘  联动  └──────────────────────────────┘

┌──────────────────────────────┐
│ WeData 全链路                 │
│ supersql-codegen → sql-execute-analyze → chatbi │
└──────────────────────────────┘
```

### 典型组合场景

| 场景 | 涉及 Skills | 流程 |
|------|------------|------|
| 集群全面巡检 | cluster-ops → load-analysis | 先看节点状态，再看监控指标 |
| 查询超时排查 | query-failure → load-analysis → query-info | 看失败概览 → 查监控 → 看具体 SQL 和 Profile |
| 慢查询优化 | query-info（audit → explain → profile） | 找慢查询 → 看执行计划 → 看 Profile |
| Schema Change 失败 | schema-change → load-analysis | 看失败原因 → 查操作时段集群负载 |
| SuperSQL 作业失败 | supersql-job-analyzer → yarn-app-diagnose | 全链路追踪 → 分析 YARN 应用失败原因 |
| SuperSQL 慢查询 | supersql-slow-query-analyzer → spark-slow-analyzer → yarn-queue-analysis | 慢查询诊断 → Spark 下钻 → 队列资源分析 |
| US 任务失败级联 | us-fail-task-diagnose → supersql-job-analyzer / yarn-app-diagnose | 任务诊断 → 定位到引擎层 → 级联下钻 |
| HDFS 丢块排查 | hdfs-miss-block-diagnose → hdfs-cluster-load-diagnose | 丢块诊断 → 如有负载问题进一步分析 |
| WeData SQL 全链路 | supersql-codegen → sql-execute-analyze → chatbi | 生成 SQL → 执行查询 → 数据分析 |
| WeData SQL 查询执行 | sql-execute-analyze | SQL 提交 → 状态轮询 → 结果获取 |
| WeData 集群资源查询 | sql-execute-analyze（describe-clusters/describe-pools） | 获取集群列表 → 查询资源池信息 |

---

## 常见分析场景示例

### WeData SQL 查询执行
```
用户："在 WeData 上帮我执行 SQL 查询：SELECT * FROM table LIMIT 10"

步骤：
1. 提交 SQL 任务：wedata_tool.py run-task --statements "..." --database default_db --cluster-id tl --pool-id root.pool --gaia-id 1
2. 轮询任务状态：wedata_tool.py query-status --task-id <TASK_ID>
3. 获取结果 URL：wedata_tool.py query-result-url --task-id <TASK_ID> --sql-id <SQL_ID>
4. 输出查询结果和查看链接
```

### StarRocks 查询超时排查
```
用户："我的 StarRocks 查询超时了"

步骤：
1. 查询失败概览：query_failure_analysis.py summary --cluster <集群名称>
2. 查看监控指标：query_zhiyan_metric.py data --cluster <集群名称> --metric cpu_usage
3. 查看失败详情：query_failure_analysis.py detail --cluster <集群名称> --error-code <超时错误码>
4. 综合分析：判断是查询过重还是集群负载过高
5. 输出诊断报告和优化建议
```

### HDFS 丢块诊断
```
用户："读取 HDFS 文件报丢块异常 BlockMissingException"

步骤：
1. 提取文件路径
2. 丢块诊断：hdfs_miss_block_diag.py --path <文件路径>
3. 判断丢块是否恢复
4. 如有负载问题，进一步：hdfs_cluster_load_diag.py --cluster <集群名>
5. 输出诊断报告和修复建议
```

### US 任务失败分析
```
用户："US 任务失败了，帮我看看"

步骤：
1. 加载 us-fail-task-diagnose Skill
2. 通过 US API 采集任务配置、实例状态、执行日志
3. 识别任务类型和错误阶段
4. 匹配已知错误模式
5. 输出结构化诊断报告
```

### SuperSQL 作业链路追踪
```
用户："SuperSQL 作业失败了，sessionId 是 xxx"

步骤：
1. 链路追踪：analyze_session.py <session_id>
2. 解析 supersql → thive/livy → yarn 全链路
3. 如定位到 YARN 层，联动 yarn-app-diagnose 分析
4. 输出包含时间线、引擎详情、错误诊断的报告
```

---

## 脚本路径规范

脚本位于各 Skill 的 `scripts/` 目录下，调用时必须使用完整路径：

```bash
# [OK] 正确 - 使用 sub-skills 下的完整路径
python3 sub-skills/OLAP/starrocks-load-analysis/scripts/query_zhiyan_metric.py search --keyword cpu
python3 sub-skills/HDFS/hdfs-miss-block-diagnose/scripts/hdfs_miss_block_diag.py --path /data/file

# [FAIL] 错误 - 缺少 sub-skills 和子系统目录
python3 scripts/query_zhiyan_metric.py search --keyword cpu

# [FAIL] 错误 - 在错误的子系统目录下查找
python3 sub-skills/Flink/starrocks-load-analysis/scripts/query_zhiyan_metric.py
```

---

## Python 版本兼容性

本 Skill 集合中的 Python 脚本可能使用了 **Python 3.10+** 语法特性：
- `str | None` 联合类型语法（PEP 604）→ 改为 `Optional[str]`（需 `from typing import Optional`）
- `match/case` 模式匹配（PEP 634）→ 改为 `if/elif/else`

遇到 `SyntaxError` 时，对不兼容语法进行局部修改即可。**禁止私自下载或创建新的 Python 环境。**
