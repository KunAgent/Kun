---
name: starrocks-routine-load-diagnose
description: >
  诊断 StarRocks Routine Load 实时写入作业的问题，覆盖任务暂停（PAUSED）、
  任务失败（Aborted Task）、写入延迟（Lag）三大核心场景，并给出参数优化建议。
  支持 Kafka / Pulsar / Iceberg 三类数据源。
  即使用户没有明确提到 "Routine Load" 字样，只要涉及到 StarRocks 流式导入、
  实时写入、消费 Kafka/Pulsar、作业 PAUSE/CANCEL、导入延迟、消费卡住等场景，
  都应优先触发本 Skill。
  触发关键词："Routine Load", "实时导入", "流式写入", "PAUSED", "导入暂停",
  "消费延迟", "消费卡住", "导入失败", "Kafka 消费", "Pulsar 消费",
  "Iceberg 实时", "ALTER ROUTINE LOAD", "resume routine load"
---

## 概述

StarRocks Routine Load 是常驻的流式导入作业，生产环境最典型的问题有三类：

1. **作业暂停（PAUSED）** — 源端错误、主键超限、错误行数超阈值等导致自动 PAUSE
2. **任务持续失败（Aborted Task 高）** — 作业仍 RUNNING，但每轮 Task 都在失败重试
3. **写入延迟高（Lag 大）** — 并发不足、源端流量突增、FE/BE 压力等导致消费跟不上

本 Skill 把这三个场景的诊断链路封装为一组**原子化**命令，由 AI 按需编排。

**核心能力**：

1. **作业枚举与健康度摘要** — 一键列出所有 Routine Load 作业，按状态聚合，快速定位异常作业
2. **作业详情深度解析** — 自动展开 JobProperties / DataSourceProperties / Statistic / Progress 等 JSON 字段，重点高亮 `ReasonOfStateChanged` / `ErrorLogUrls` / `OtherMsg`
3. **Task 级下钻** — 查看作业下所有 Task 的 Message，精确定位单次失败原因
4. **延迟与失败时序** — 通过智研监控拉取 `starrocks_fe_routine_load_time_lag_of_partition` / `starrocks_fe_routine_load_aborted_tasks` 两个指标的趋势

## 前置条件

- 已执行 `do-bigdata auth init` 配置 CMK 凭证（由 CLI 的 `@auth_required` 装饰器自动读取）
- 集群可达（走 FE 9030，通过 `集群名.polaris` 域名）
- 如果要看延迟/失败时序，需要集群已接入智研监控

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

**重要原则**：下面的步骤是**一个原子命令池**，AI 应根据用户问题**按需选用**，而不是每次都从 Step 1 一路跑到 Step 5。**每一步执行后分析输出再决定下一步参数**，不要一次性排队所有命令。

### Step 1：定位问题作业（用户未指定作业名时）

**目的**：找到用户所说"有问题的作业"到底是哪一个。

```bash
do-bigdata olap rl-list --cluster <集群名称> --query "<用户原始问题>"
```

- 输出会带 `state_summary`，快速看到有多少 `PAUSED` / `CANCELLED`
- 诊断优先级：**PAUSED > CANCELLED > RUNNING（但延迟或失败高）**
- 可加过滤：`--state PAUSED` 只看暂停的，`--data-source KAFKA` 只看 Kafka 作业

如果用户已经给了作业名，**跳过本步**直接 Step 2。

### Step 2：作业详情 — 最核心的一步

**目的**：拿到问题作业的 `State`、`ReasonOfStateChanged`、`OtherMsg`、`ErrorLogUrls`，这是判断根因的第一手证据。

```bash
do-bigdata olap rl-detail \
    --cluster <集群名称> \
    --database <数据库名> \
    --job <作业名> \
    --query "<用户原始问题>"
```

**输出解读要点**：

| 字段 | 看什么 |
|------|--------|
| `State` | RUNNING / PAUSED / CANCELLED / STOPPED / NEED_SCHEDULE |
| `ReasonOfStateChanged` | 非空时就是**直接根因**（`too many filtered rows` / `primary key size exceed` / `cannot get offset` 等） |
| `ErrorLogUrls` | 有此 URL 说明有错误样本，用户可手动访问排查数据 |
| `OtherMsg` | 最近一次 Task 失败的原因（比 ReasonOfStateChanged 更细粒度） |
| `JobProperties.maxFilterRatio` / `maxErrorNum` / `exec_mem_limit` | 用于判断是否参数设置过严 |
| `DataSourceProperties.topic` / `subscription` / `brokerList` | 确认源端配置 |
| `Statistic.errorRows` vs `loadedRows` | 错误率，超 1% 就要警惕 |
| `Statistic.abortedTaskNum` | 累计失败任务数 |
| `CurrentTaskNum` | 实际并行度（可能远小于 desireTaskConcurrentNum） |

### Step 3：分场景下钻

按 Step 2 得到的 `State` 和根因分场景处理。**不是每个场景都要跑完**，按需选用。

#### 场景 A：State = PAUSED（最高优先级）

- Step 2 的 `ReasonOfStateChanged` 已经给出暂停原因，直接按 `references/routine_load_guide.md` **第三节**的关键词对照表给出建议
- 常见处理：`PAUSE → ALTER ROUTINE LOAD ... PROPERTIES(...) → RESUME`
- **不需要**再跑 `rl-tasks`（作业已暂停，当前无 task）

#### 场景 B：State = CANCELLED

- 这是**终态**，不可恢复，需重新 `CREATE ROUTINE LOAD`
- `ReasonOfStateChanged` 通常是：表被删除、权限变更、DB 被删、不可恢复的源端错误
- 直接基于 Step 2 的信息给用户结论，不用继续下钻

#### 场景 C：State = RUNNING 但 `abortedTaskNum` 高 / 用户抱怨导入失败

- 拉 Task 列表看**具体失败 Message**：

  ```bash
  do-bigdata olap rl-tasks \
      --cluster <集群名称> \
      --job <作业名> \
      --query "<用户原始问题>"
  ```

- 看 Task 的 `Message` 字段，对照 `references/routine_load_guide.md` **第五节**的关键词表
- 可选：看失败数时序趋势

  ```bash
  do-bigdata olap rl-failure \
      --cluster <集群名称> \
      --job <作业名> \
      --hours 6 \
      --query "<用户原始问题>"
  ```

#### 场景 D：State = RUNNING 但延迟高 / 用户抱怨消费慢

- 拉延迟指标时序：

  ```bash
  do-bigdata olap rl-lag \
      --cluster <集群名称> \
      --job <作业名> \
      --hours 6 \
      --query "<用户原始问题>"
  ```

- 从 Step 2 的详情里提取 `desireTaskConcurrentNum`、`currentTaskConcurrentNum`、`maxBatchIntervalS`，判断并行度是否被限制（见 guide 第四节）
- 需要时联动 `starrocks-load-analysis` 看 BE CPU/IO 是否打满
- 需要时联动 `starrocks-cluster-ops` 的 `backends` 看 BE 存活数

#### 场景 E：State = NEED_SCHEDULE

- 通常是过渡状态，等几秒自动恢复
- 若长时间卡住，一般是 FE 调度压力大或存活 BE 数量不足，联动 cluster-ops 看 BE 状态

### Step 4：给出优化建议并输出诊断摘要

建议模板：

```
### Routine Load 诊断摘要

- 集群           : <cluster>
- 作业           : <database>.<job>
- 数据源类型     : KAFKA / PULSAR / ICEBERG
- 当前状态       : PAUSED / RUNNING / CANCELLED ...
- 状态变更原因   : <ReasonOfStateChanged 原文>
- 关键统计       : loadedRows=<x>, errorRows=<x>, abortedTaskNum=<x>, loadRowsRate=<x>
- 延迟水位       : 最近 N 小时最大 <M> 秒（仅延迟类问题时展示）
- 直接诱因       : <如"主键长度超限" / "Kafka offset 过期" / "并行度不足">
- 建议处理       :
    1. <具体参数调整，如 desired_concurrent_number、max_filter_ratio、exec_mem_limit>
    2. <源端或目标表侧修复>
    3. <恢复序列：PAUSE → ALTER → RESUME>
```

## 典型分析场景

### 场景 1：用户说"xx 集群的 Routine Load 有任务暂停了"

1. `rl-list --cluster xx --state PAUSED` → 拿到所有 PAUSED 作业清单
2. 对每个（或最典型的那个）PAUSED 作业跑 `rl-detail`
3. 根据 `ReasonOfStateChanged` 对照 guide 第三节给建议
4. 按模板输出摘要

### 场景 2：用户说"xx 集群的 xx 作业消费慢/延迟高"

1. `rl-detail --cluster xx --database db --job xx` 拿当前并行度和参数
2. `rl-lag --cluster xx --job xx --hours 6` 看延迟趋势
3. 按 guide 第四节给并发度或批量参数建议
4. 必要时联动 `starrocks-load-analysis` 看 BE 负载

### 场景 3：用户贴了一个作业名但没说具体啥问题

1. `rl-detail` 先看 State，按 State 分派到场景 A/C/D
2. 按需下钻

### 场景 4：用户问"我的 Pulsar/Iceberg Routine Load 怎么配参数"

- 不用跑命令，直接 `do-bigdata docs show --skill starrocks-routine-load-diagnose --file routine_load_guide.md` 给 references 参考

## Skill 联动关系

- **上游依赖**：无（本 Skill 自身入口就是 rl-list）
- **横向联动**：
  - `starrocks-cluster-ops`（`backends` 看 BE 存活数，判断 desired_concurrent_number 上限）
  - `starrocks-load-analysis`（BE CPU/IO 指标，判断是否资源不足）
  - `starrocks-schema-change`（`ReasonOfStateChanged` 提到 "tablet not found" 时，看目标表是否有 DDL 变更）

## 参考文档

```bash
do-bigdata docs list --skill starrocks-routine-load-diagnose
do-bigdata docs show --skill starrocks-routine-load-diagnose --file routine_load_guide.md
```

- `routine_load_guide.md` — PAUSED 根因关键词对照表、Task Message 关键词表、参数调优速查表、Kafka/Pulsar/Iceberg 数据源特定要点、诊断结论模板。

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
