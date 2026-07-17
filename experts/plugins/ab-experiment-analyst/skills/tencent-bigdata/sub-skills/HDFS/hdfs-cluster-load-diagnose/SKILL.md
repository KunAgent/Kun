---
name: hdfs-cluster-load-diagnose
description: 当用户咨询 HDFS 集群负载问题时使用此 skill。优先从用户问题中提取时间范围，通过 do-bigdata CLI 调用 get_cluster_load_info_by_time API 获取指定时段内各 DataNode 的 Xceiver 连接数分布以及 NameNode 的 RPC CallQueueLength 请求负载情况；若用户未指定时间，则回退调用 get_cluster_load_info 获取最近 30 分钟的负载数据。据此从 DataNode 和 NameNode 两个维度分析集群是否存在负载瓶颈，并给出优化建议。
---

## 概述

诊断 HDFS 集群负载问题。核心方式是从用户问题中提取时间范围和集群名，通过 `do-bigdata` CLI 工具一条命令完成全流程：**优先使用指定时间段查询**，若未指定时间则**回退使用最近 30 分钟数据**。CLI 同时获取 **DataNode Xceiver 连接数**和 **NameNode RPC CallQueueLength** 两个维度的负载指标，据此判断集群是否存在负载瓶颈。

**适用场景**：
- DataNode Xceiver 连接数过高导致读写失败（`IOException`、间歇性 `BlockMissingException`）
- NameNode RPC 请求堆积导致客户端操作超时、响应变慢
- 集群整体读写性能下降，任务执行变慢
- DataNode 负载不均（部分节点 Xceiver 过高，部分空闲）
- 大量并发任务导致 HDFS 集群压力过大
- 需要评估集群在某个时间段的负载状况

**核心诊断能力**：

1. **集群定位** — 从用户输入获取集群名，或通过文件路径由 CLI 自动查询所属集群
2. **时间范围提取** — 从用户问题中识别时间信息（如"今天早上8点到9点"、"昨天下午2点到4点"），以 `YYYY-MM-DD HH:MM:SS` 格式传入 CLI
3. **DataNode Xceiver 负载获取** — CLI 优先使用 `get_cluster_load_info_by_time` 查询指定时段数据；无时间信息时回退使用 `get_cluster_load_info` 获取最近 30 分钟数据
4. **NameNode RPC 负载获取** — 同一接口同时返回 NameNode 的 CallQueueLength 请求堆积情况，6400 为堆积量上限阈值
5. **瓶颈判断** — CLI 从 DataNode（Xceiver）和 NameNode（CallQueueLength）两个维度给出负载状况分析
6. **优化建议** — 结合参考文档给出针对性优化方案

## 前置条件

- 已知 HDFS 集群名称，或有 HDFS 文件路径（CLI 可自动查询所属集群）
- 已安装 `do-bigdata` CLI 工具
- 已执行 `do-bigdata auth init` 完成凭证配置

## 工作流

当用户咨询 HDFS 集群负载问题时，按以下步骤执行：

### 第 1 步：从用户输入中提取集群名和时间范围

**集群名来源**：
- 用户直接提供集群名（如 `ss-pcg-13-v3`）
- 用户提供 HDFS 文件路径（如 `hdfs://my-cluster/data/...` 或 `/user/tdw/warehouse/...`），CLI 自动反查集群
- 异常日志中提取集群信息

**时间提取规则**：
- 用户明确指定了起止时间（如"今天早上8点到9点"、"昨天14:00到16:00"、"3月10日 10:00~12:00"）→ 解析为 `YYYY-MM-DD HH:MM:SS` 字符串
- 用户指定了相对时间（如"最近2小时"、"过去1小时"）→ 计算对应的起止时间
- 用户未提及任何时间信息 → 不传 `--start`/`--end`，CLI 会自动回退到最近 30 分钟
- 时间范围不能超过 24 小时（API 限制）；时区为本地时间（北京时间 UTC+8）

### 第 2 步：执行集群负载诊断（一条命令完成）

直接调用 CLI 命令，CLI 会自动完成：确定集群 → 选择合适的 API → 获取负载数据 → 从 DataNode + NameNode 两个维度分析 → 输出结构化诊断报告和优化建议：

```bash
# 方式 1：指定集群名 + 时间范围（推荐）
do-bigdata hdfs cluster-load \
  --cluster <集群名> \
  --start "2026-03-11 08:00:00" \
  --end "2026-03-11 09:00:00" \
  --query "<用户原始问题>"

# 方式 2：指定集群名，未指定时间（自动使用最近 30 分钟）
do-bigdata hdfs cluster-load --cluster <集群名> --query "<用户原始问题>"

# 方式 3：通过文件路径反查集群 + 指定时间
do-bigdata hdfs cluster-load \
  --path /user/tdw/warehouse/db.db/table/part-00000 \
  --start "2026-03-11 08:00:00" \
  --end "2026-03-11 09:00:00" \
  --query "<用户原始问题>"

# 方式 4：路径带 hdfs:// schema（CLI 自动提取集群名）
do-bigdata hdfs cluster-load \
  --path hdfs://<集群>/<路径> \
  --query "<用户原始问题>"
```

**参数说明**：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--cluster` / `-c` | HDFS 集群名（与 `--path` 二选一） | — |
| `--path` / `-p` | HDFS 文件路径（用于自动查询所属集群） | — |
| `--start` / `-s` | 起始时间，格式 `'YYYY-MM-DD HH:MM:SS'`（与 `--end` 配合使用） | — |
| `--end` / `-e` | 结束时间，格式 `'YYYY-MM-DD HH:MM:SS'`（与 `--start` 配合使用） | — |
| `--query` / `-q` | 用户原始问题（由 AI Agent 自动传入） | — |
| `--output` / `-o` | 输出格式：`text`（默认） / `json` | `text` |

### 第 3 步：分析 CLI 输出（DataNode + NameNode 两个维度）

CLI 输出包含以下信息（AI 需对照下方场景判断）：

**CLI 输出关键字段**：

| 字段 | 说明 |
|------|------|
| 集群名称 / 分析时间范围 / DataNode 数量 | 基础信息 |
| 集群平均 Xceiver / 集群最大 Xceiver / 超阈值节点数 | DataNode Xceiver 负载概览 |
| NameNode 平均/最大/最小 CallQueueLength / 是否高负载 | NameNode RPC 负载概览 |
| Xceiver Top 10 DataNode | 负载最高的节点列表 |
| 高负载节点详情 | `avg_xceiver ≥ 阈值` 的节点列表 |
| 负载分析 + 优化建议 | CLI 自动根据阈值给出的诊断结论 |

**DataNode 维度判断逻辑**（对照 CLI 输出）：

**场景 A — Xceiver 连接数过高（严重）**：
- 存在节点 avg_xceiver ≥ 3500，或 `cluster_max_xceiver` 接近/达到 4096（默认上限）
- 表示集群中有 DataNode 的 Xceiver 线程接近耗尽，新的读写请求可能获取不到线程
- 修复：短期增大 `dfs.datanode.max.transfer.threads`，长期分析热点和并发来源

**场景 B — DataNode 负载偏高**：
- `high_xceiver_count > 0`，存在节点 avg_xceiver ≥ 1000
- 已可能影响数据读写效率，任务执行变慢
- 修复：分析热点数据分布，优化任务并发度

**场景 C — DataNode 负载不均**：
- `cluster_avg_xceiver` 不高（< 1000），但有个别节点 avg_xceiver 远高于平均值（> 3 倍）
- 说明负载集中在少数节点上，可能是数据热点或 Balancer 未均衡
- 修复：运行 Balancer、增加热点数据副本数

**场景 D — 集群整体负载过高**：
- `cluster_avg_xceiver` > 1000，且大量节点 Xceiver 均较高
- 整个集群并发压力大，而非个别节点问题
- 修复：优化任务并发度、错峰调度、考虑扩容

**场景 E — 集群负载正常**：
- `high_xceiver_count = 0` 且 `cluster_avg_xceiver` < 1000
- DataNode 负载在正常范围内

**NameNode 维度判断逻辑**：

**场景 F — NameNode RPC 请求堆积严重**：
- `is_high_load = true`（`max_call_queue_length` ≥ 6400）
- NameNode RPC 请求队列已严重堆积，客户端操作（ls、open、create 等）响应极慢甚至超时
- 6400 是 CallQueueLength 请求堆积量的上限阈值，表示负载很高、请求响应慢
- 修复：优化客户端并发度，减少不必要的 HDFS 元数据操作，排查异常脚本，考虑 NameNode Federation

**场景 G — NameNode RPC 负载偏高**：
- `avg_call_queue_length` > 1000 但 `max_call_queue_length` < 6400
- NameNode RPC 队列有一定堆积，客户端操作可能偶尔变慢
- 修复：关注趋势，优化高频元数据操作

**场景 H — NameNode 负载正常**：
- `avg_call_queue_length` < 1000 且 `max_call_queue_length` < 6400
- NameNode RPC 请求处理正常

**诊断报告格式**（AI 基于 CLI 输出整理）：

```
## HDFS 集群负载诊断报告

### 基础信息
- 集群名称: {cluster_name}
- 分析时间范围: {time_range.description}
- DataNode 数量: {datanode_count}

### DataNode Xceiver 负载概览
- 集群平均 Xceiver: {cluster_avg_xceiver}
- 集群最大 Xceiver: {cluster_max_xceiver}
- 超阈值节点数: {high_xceiver_count} (阈值: {xceiver_threshold})

### NameNode RPC 负载概览
- 平均 CallQueueLength: {namenode_load.avg_call_queue_length}
- 最大 CallQueueLength: {namenode_load.max_call_queue_length}
- 最小 CallQueueLength: {namenode_load.min_call_queue_length}
- 采样点数: {namenode_load.sample_count}
- 是否负载过高: {namenode_load.is_high_load} (阈值: 6400)

### 诊断结论
{分别从 DataNode 和 NameNode 两个维度概述负载状况及主要瓶颈}

### 详细分析
{高负载节点的 IP 和 Xceiver 数据；NameNode CallQueueLength 趋势分析}

### 优化建议
{具体的优化步骤和参数调整建议}
```

## 原子化命令（按需使用）

场景化命令 `cluster-load` 已封装了完整流程；如需单独调用某一步 API，使用原子化命令：

```bash
# 查询文件所属集群
do-bigdata hdfs file-location --path <文件路径> --query "<用户问题>"

# 获取集群最近 30 分钟负载（DataNode Xceiver + NameNode CallQueueLength）
do-bigdata hdfs get-cluster-load-info --cluster <集群名> --query "<用户问题>"

# 按时间范围获取集群负载
do-bigdata hdfs get-cluster-load-info-by-time \
  --cluster <集群名> \
  --start "2026-03-11 08:00:00" \
  --end "2026-03-11 09:00:00" \
  --query "<用户问题>"
```

> [WARN] **铁律**：严禁通过 `curl`、`web_fetch`、`urllib.request` 等方式直接请求 `http://do-mcp.server.woa.com:8080/api/hdfs/...`。所有数据获取必须通过 `do-bigdata` CLI 命令完成，否则认证将失效。

## 参考文档

```bash
# 列出本 Skill 的所有参考文档
do-bigdata docs list --skill hdfs-cluster-load-diagnose

# 查看集群负载诊断指南（Xceiver 机制详解、NameNode CallQueueLength 详解、负载场景分类、API 返回字段说明、诊断用例）
do-bigdata docs show --skill hdfs-cluster-load-diagnose --file hdfs_cluster_load_guide.md
```

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
