---
name: spark-skills
description: "Spark 技能总览。当用户问题涉及 Spark Application 性能分析、Job/Stage 慢分析、数据倾斜诊断、Executor 资源分析、多次执行对比等 Spark 层面的问题时，路由到对应的子 Skill。"
---

# Spark 技能集

## 子 Skill 目录

| # | Skill 名称 | 目录 | 简介 |
|---|-----------|------|------|
| 1 | Spark Job 慢分析 | `spark-slow-analyzer/` | 基于 Spark History Server API 对单个 Spark Application 进行 Job/Stage/Task 级性能分析，支持多 Application 横向比对，定位数据倾斜、Shuffle 溢出、GC 压力、配置不合理等慢查询根因 |

## 路由规则

### [WARN] 预分类：失败 vs 慢（最高优先级，必须在选择子 Skill 前执行）

> **当用户提供 Application ID 但问题描述包含"报错/失败/异常/error/failed/killed"等关键词时，本子系统（Spark）不处理，必须路由到 `Yarn/yarn-app-diagnose` 进行失败诊断。**

| 用户意图关键词 | 路由目标 | 说明 |
|---------------|---------|------|
| 报错、失败、异常、error、exception、failed、killed、挂了 | **→ `Yarn/yarn-app-diagnose`**（跨子系统路由） | 本子系统仅处理"慢"，不处理"失败" |
| 慢、耗时长、卡住、比以前慢、性能差 | → 本子系统 `spark-slow-analyzer` | 本子系统核心场景 |
| 意图不明确（如只给了 app_id 没说明问题类型） | **先通过 Yarn API 查询 App 状态** → FAILED/KILLED 走 `yarn-app-diagnose`；SUCCEEDED 走 `spark-slow-analyzer` | 禁止不查状态就默认走慢分析 |

> [PIN] **判定顺序**：关键词判定 > 状态判定。如果用户明确说了"报错"，即使 App 可能是 Spark 类型，也必须先路由到 `yarn-app-diagnose`。`yarn-app-diagnose` 在完成失败诊断后，如有需要会自行联动回 Spark 子系统做进一步分析。

### 子 Skill 内部路由（仅处理"慢"场景）

根据用户问题类型分发到对应子 Skill：

| 用户问题 | 路由到 |
|---------|-------|
| Spark Application 跑得慢、某个 Job/Stage 耗时长 | `spark-slow-analyzer` |
| 两次 Spark 执行对比（为什么这次比上次慢） | `spark-slow-analyzer`（compare 模式） |
| 数据倾斜、Shuffle 溢出、GC 问题 | `spark-slow-analyzer` |
| Spark 配置参数是否合理 | `spark-slow-analyzer` |

## 与其他 Skill 的联动

- **SuperSQL 慢查询** → 当 `supersql-slow-query-analyzer` 定位到引擎执行层（E4: Livy Spark Job 慢）时，下钻到 `spark-slow-analyzer` 进行 Job/Stage 级分析
- **YARN 队列分析** → 当 Spark 分析发现资源等待严重时，联动 `yarn-queue-analysis` 分析队列拥堵原因
- **YARN App 诊断**（强制路由） → 当 Spark Application 失败/报错时，**必须路由到** `yarn-app-diagnose` 分析失败根因，不在本子系统内处理

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
