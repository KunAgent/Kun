---
name: DataIntegration
description: DataIntegration 子系统入口。当问题涉及 数据接入、TDBank、Inlong、Pulsar、TubeMQ、消息队列消费慢、订阅滞后、日志分析 等主题时，使用此技能查看可用的子技能列表并路由到合适的技能。所有子命令通过 `do-bigdata dataintegration` 调用。
---

# DataIntegration Skills 总览

> 本文档汇总 `sub-skills/DataIntegration` 下所有数据接入相关 Skills，方便快速浏览和查找。
> 所有命令均通过统一 CLI 入口 `do-bigdata dataintegration <prefix>:<command>` 调用。

## 目录

| # | Skill 名称 | 目录 | 命令前缀 | 简介 |
|---|-----------|-----|----------|------|
| 1 | [InLong 平台诊断](#1-inlong-platform-diagnosis--inlong-平台一站式诊断) | `inlong-platform-diagnosis/` | `inlong:` | InLong 平台一站式诊断工具，提供集群配置查询、异常诊断、数据上报纠错等完整运维能力 |
| 2 | [TDBank 平台诊断](#2-tdbank-platform-diagnosis--tdbank-平台一站式诊断) | `tdbank-platform-diagnosis/` | `tdbank:` | TDBank 平台一站式诊断工具，支持接口配置查询、异常诊断、数据上报问题排查等运维场景 |
| 3 | [TubeMQ 诊断](#3-tubemq-diagnosis--tubemq-消息队列诊断) | `tubemq-diagnosis/` | `tubemq:` | TubeMQ 消息队列诊断工具，专注于消息积压、消费延迟、集群状态等问题的查询与诊断 |
| 4 | [Pulsar 诊断](#4-pulsar-diagnosis--pulsar-消息系统诊断) | `pulsar-diagnosis/` | `pulsar:` | Pulsar 消息系统诊断工具，提供订阅关系、分区状态、消息堆积等核心指标的查询与诊断分析 |

## 统一 CLI 入口

所有命令均通过 `do-bigdata dataintegration <prefix>:<command>` 调用，`<prefix>` 对应表中的命令前缀（`inlong:` / `tdbank:` / `tubemq:` / `pulsar:`）。

```bash
# 查看 DataIntegration 子系统所有可用命令
do-bigdata dataintegration --help

# 查看某个具体命令的参数
do-bigdata dataintegration <prefix>:<command> --help
```

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## CMK 凭证配置

InLong 相关命令需要 CMK 凭证，首次使用请执行：

```bash
do-bigdata auth init
```

---

## 1. inlong-platform-diagnosis — InLong 平台一站式诊断

**简介**：InLong 平台一站式诊断工具，提供集群配置查询、异常诊断、数据上报纠错等完整运维能力。

**适用场景**：查询 InLong 平台相关信息，包括集群健康状态、数据组（Group）详情与状态统计、数据流（Stream）信息、Source/Sink 配置、审计日志、操作日志、字段变更日志、DataProxy IP 列表等。

### 常用命令

```bash
# 检测 InLong Manager 是否可达
do-bigdata dataintegration inlong:ping --query "<用户原始问题>"

# 判断 group/stream 是否存在
do-bigdata dataintegration inlong:group-exist --group-id <groupId> --query "<用户原始问题>"
do-bigdata dataintegration inlong:stream-exist --group-id <groupId> --stream-id <streamId> --query "<用户原始问题>"

# 查询 group/stream 详情（需要 --tenant）
do-bigdata dataintegration inlong:group-detail --tenant <tenant> --group-id <groupId> --query "<用户原始问题>"
do-bigdata dataintegration inlong:stream-get --tenant <tenant> --group-id <groupId> --stream-id <streamId> --query "<用户原始问题>"
```

详见子 Skill 的 [SKILL.md](inlong-platform-diagnosis/SKILL.md)。

---

## 2. tdbank-platform-diagnosis — TDBank 平台一站式诊断

**简介**：TDBank 平台一站式诊断工具，支持接口配置查询、异常诊断、数据上报问题排查等运维场景。

**适用场景**：获取 TDBank 业务下的接口列表、接口详情、MQ 主题 TTL/分区/订阅、消费组指标等。当用户提到 tdbank.woa.com 平台、业务接口、入库异常、MQ 主题配置时使用。

### 常用命令

```bash
# 获取业务详情（含 MQ 类型与集群标签）
do-bigdata dataintegration tdbank:bid-detail -b <业务ID> --query "<用户原始问题>"

# 获取业务下所有接口
do-bigdata dataintegration tdbank:interfaces -b <业务ID> --query "<用户原始问题>"

# 获取 Pulsar 主题订阅列表
do-bigdata dataintegration tdbank:pulsar-subscriptions -c <集群标签> -t <租户> -n <命名空间> -p <主题> --query "<用户原始问题>"

# 查询 TubeMQ 消费组指标（该命令已迁移至 tubemq-diagnosis Skill）
do-bigdata dataintegration tubemq:csm-metric -g <消费组> -f json --query "<用户原始问题>"
```

详见子 Skill 的 [SKILL.md](tdbank-platform-diagnosis/SKILL.md)。

---

## 3. tubemq-diagnosis — TubeMQ 消息队列诊断

**简介**：TubeMQ 消息队列诊断工具，专注于消息积压、消费延迟、集群状态等问题的查询与诊断。

**适用场景**：用户需要分析 TubeMQ 客户端日志性能，包括 msg_call_dlt、csm_latency_dlt、msg_confirm_dlt、rsp_details、status_details 等多维指标，以及时间线趋势追踪。

### 常用命令

```bash
# 本地日志分析：基本使用
do-bigdata dataintegration tubemq:log-analyze /path/to/taskmanager.log --query "<用户原始问题>"

# 本地日志分析：指定维度与节点数
do-bigdata dataintegration tubemq:log-analyze /path/to/taskmanager.log \
  -t msg_call_dlt -t rsp_details --top-n 5 --sort-msg-call p9999 --query "<用户原始问题>"

# 本地日志分析：时间线分析
do-bigdata dataintegration tubemq:log-analyze /path/to/taskmanager.log \
  --timeline-metrics msg_call_dlt --timeline-ips 10.1.2.3 --query "<用户原始问题>"

# 消费组指标诊断（API）
do-bigdata dataintegration tubemq:csm-metric -g <消费组> -f json --query "<用户原始问题>"
```

详见子 Skill 的 [SKILL.md](tubemq-diagnosis/SKILL.md)。

---

## 4. pulsar-diagnosis — Pulsar 消息系统诊断

**简介**：Pulsar 消息系统诊断工具，提供订阅关系、分区状态、消息堆积等核心指标的查询与诊断分析。

**适用场景**：Pulsar 订阅滞后诊断，通过 Pulsar API 获取订阅统计信息、分析滞后指标、检查消费者状态，输出标准化 Markdown 诊断报告。

### 常用命令

```bash
# 获取主题订阅列表
do-bigdata dataintegration pulsar:subscription-list -c <cluster_tag> -t <tenant> -n <namespace> -p <topic> --query "<用户原始问题>"

# 获取指定订阅的分区统计
do-bigdata dataintegration pulsar:partitioned-stats -c <cluster_tag> -t <tenant> -n <namespace> -p <topic> -s <subscription> --query "<用户原始问题>"

# 执行完整诊断
do-bigdata dataintegration pulsar:diagnose \
  -c <cluster_tag> -t <tenant> -n <namespace> -p <topic> -s <subscription> \
  --output-file diagnosis_report.md --query "<用户原始问题>"
```

详见子 Skill 的 [SKILL.md](pulsar-diagnosis/SKILL.md)。

---

## 联动说明

- 当仅知道 topic 但不知道 Pulsar 集群标签时，可以先用 `tdbank:bid-detail` 或 `tdbank:pulsar-subscriptions` 获取 `cluster_tag`，再喂给 `pulsar:diagnose`。
- 当 `tubemq:csm-metric` 发现消费滞后后，如果业务提供了本地日志文件, 可以结合 `tubemq:log-analyze` 分析客户端日志定位慢 consumer。

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
