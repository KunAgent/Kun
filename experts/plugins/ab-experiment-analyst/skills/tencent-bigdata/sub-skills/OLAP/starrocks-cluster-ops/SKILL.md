---
name: starrocks-cluster-ops
description: >
  获取 StarRocks 集群的运营信息和集群状态。包括查询集群基本信息（版本、地域、负责人等）、获取 FE/BE/CN 节点状态、查看全局变量配置、查看活跃连接列表、查看数据均衡状态。
  当用户询问 StarRocks 集群的版本、地域、节点状态、全局配置、连接数、数据均衡等运营相关信息时使用。
  触发关键词："集群版本", "集群信息", "节点状态", "FE状态", "BE状态", "全局变量", "连接数", "数据均衡", "processlist", "balance"
---

## 概述

通过 do_mcp API 服务获取 StarRocks 集群的运营信息和运行状态，覆盖集群基本信息、节点拓扑、配置参数和均衡状态等维度。

**核心能力**：
1. **集群运营信息** — 查询集群名称、描述、负责人、版本、地域、FE 端口
2. **节点状态** — 获取 FE / BE / CN 节点的存活状态、资源用量等
3. **全局变量** — 查看集群参数配置，支持按关键字过滤
4. **活跃连接** — 查看当前连接数和正在执行的 SQL
5. **数据均衡** — 查看均衡概览、运行中/等待中/历史均衡任务

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 1: 确定用户需求

根据用户的描述判断需要查询的信息类型：

| 用户需求 | 对应 CLI 命令 | 需要参数 |
|---------|-------------|---------|
| 查看集群版本、地域、负责人等 | `do-bigdata olap ops-info` | 集群名称 |
| 查看 FE 节点状态 | `do-bigdata olap frontends` | 集群名称 |
| 查看 BE 节点状态 | `do-bigdata olap backends` | 集群名称 |
| 查看 CN 节点状态 | `do-bigdata olap computenodes` | 集群名称 |
| 查看集群配置 / 全局变量 | `do-bigdata olap variables` | 集群名称 |
| 查看连接数 / 活跃 SQL | `do-bigdata olap processlist` | 集群名称 |
| 查看数据均衡状态 | `do-bigdata olap balance` | 集群名称 |

如果用户未提供集群名称但需要指定集群的信息，**先向用户询问集群名称**。

### Step 2: 执行查询

根据 Step 1 确定的需求，执行对应的 CLI 命令：

```bash
# 查询集群运营信息（版本、地域、负责人等）
do-bigdata olap ops-info --cluster <集群名称> --query "<用户原始问题>"

# 获取 FE 节点状态
do-bigdata olap frontends --cluster <集群名称> --query "<用户原始问题>"

# 获取 BE 节点状态
do-bigdata olap backends --cluster <集群名称> --query "<用户原始问题>"

# 获取 CN 节点状态
do-bigdata olap computenodes --cluster <集群名称> --query "<用户原始问题>"

# 获取全局变量配置
do-bigdata olap variables --cluster <集群名称> --query "<用户原始问题>"

# 按关键字过滤变量
do-bigdata olap variables --cluster <集群名称> --keyword <关键字> --query "<用户原始问题>"

# 获取活跃连接列表
do-bigdata olap processlist --cluster <集群名称> --query "<用户原始问题>"

# 获取数据均衡状态（概览）
do-bigdata olap balance --cluster <集群名称> --query "<用户原始问题>"

# 获取数据均衡状态（运行中/等待中/历史）
do-bigdata olap balance --cluster <集群名称> --sub-type running --query "<用户原始问题>"
```

### Step 3: 分析输出结果

命令输出包含格式化的可读信息和 JSON 数据，分析时关注以下要点（详见参考文档）：

**运营信息分析**：
- 确认集群版本是否需要升级
- 确认集群地域和负责人信息

**节点状态分析**：
- **FE 节点**：检查 LEADER 是否存在、所有节点 Alive 是否为 true
- **BE 节点**：检查 Alive 状态、磁盘使用率（UsedPct > 80% 需关注）、ErrMsg 是否为空
- **CN 节点**：无返回则说明是存算一体架构

**全局变量分析**：
- 关注 `query_timeout`、`exec_mem_limit` 等性能相关参数
- 查看是否有非默认的配置调整

**活跃连接分析**：
- 按 Time 排序找出长时间运行的查询
- 统计各用户的连接数判断是否有连接泄漏

**数据均衡分析**：
- overview 查看整体均衡状态
- running/pending 查看均衡任务进度

## 典型分析场景

### 场景 A：全面了解集群概况

1. `do-bigdata olap ops-info` 获取集群基本信息
2. `do-bigdata olap frontends` + `do-bigdata olap backends`（+ `do-bigdata olap computenodes`）查看全部节点状态
3. 汇总输出集群概况报告

### 场景 B：节点异常排查

1. `do-bigdata olap frontends` 确认 FE LEADER 存在且健康
2. `do-bigdata olap backends` 检查 BE 节点 Alive 和 ErrMsg
3. 发现异常节点后联动 `starrocks-load-analysis` 查看监控指标

## 参考文档

需要深入理解字段含义或制定分析方案时，通过 CLI 按需加载参考文档：

```bash
do-bigdata docs list --skill starrocks-cluster-ops
do-bigdata docs show --skill starrocks-cluster-ops --file cluster_ops_guide.md
```

- `cluster_ops_guide.md` — 集群运营信息分析参考文档。包含运营信息字段说明、StarRocks 节点架构（FE/BE/CN）、各节点关键字段解读、常用全局变量说明、数据均衡机制、活跃连接分析和典型分析组合场景。

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
