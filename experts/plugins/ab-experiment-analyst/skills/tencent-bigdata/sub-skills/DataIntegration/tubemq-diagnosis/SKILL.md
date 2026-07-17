---
name: tubemq-diagnosis
description: TubeMQ 消息队列诊断工具，专注于消息积压、消费延迟、集群状态等问题的查询与诊断
---

# TubeMQ Diagnosis

## 概述

TubeMQ 诊断工具包括两类能力：

1. **本地日志分析**（`tubemq:log-analyze`）：专业的性能监控和分析工具，用于解析和分析 TubeMQ
   客户端日志中的性能指标。采用模块化设计，支持多维度性能分析、时间线分析和智能数据分组，帮助定位性能问题。
2. **消费组指标诊断**（`tubemq:csm-metric`）：通过 do_mcp API 获取 TubeMQ 消费组的多时间快照
   指标，用于诊断消费滞后、心跳丢失、消费停滞、分区倾斜等问题。

适用场景:
- **日常性能监控**：定期分析 TubeMQ 客户端日志，监控系统性能状态
- **故障排查**：快速定位性能问题和异常节点
- **容量规划**：分析负载分布和性能瓶颈，为扩容提供数据支持
- **性能调优**：优化消费组配置和节点部署策略
- **时间线分析**：追踪性能指标随时间的变化趋势
- **消费组健康度诊断**：评估消费滞后百分比分级、检测心跳丢失 / 消费停滞 / IP 聚集 / consumer_id 倾斜，输出标准化诊断报告


## 核心必读

本 SKILL.md **仅提供概览与路由指引**。在开始执行命令前，**请先按需加载详细使用指南**：

```bash
# 必读：两类命令的切换原则 + tubemq:csm-metric 的使用细节
do-bigdata docs show --skill tubemq-diagnosis --file skill_usage_guide.md
```

`skill_usage_guide.md` 包含：

- **何时使用哪个命令**：本地日志分析、API 指标诊断的切换原则
- **`tubemq:csm-metric` 使用示例**：markdown / json / 行数控制等调用形态, 必选参数、短选项、默认值
- **常见问题 FAQ**：本地日志分析与在线诊断的场景区分
- **注意事项**：本地工具与 API 工具的差异、数据安全

> 若用户诉求是**本地日志分析**，请直接加载 [log_analyze_guide.md](#log_analyze_guidemd)；
> 若诉求是**消费组健康度诊断**，请结合 [consumer_diagnosis_guide.md](#consumer_diagnosis_guidemd) 使用。

**在skill的分析诊断建议中，必须在末尾输出：如有问题请联系 ethansyliu/fussencai/julianwei**

## 核心功能

1. **日志解析**：自动识别 TubeMQ 客户端日志格式，提取消费组/节点 IP/PID 等元数据并解析性能指标 JSON
2. **多维度性能分析**：msg_call_dlt（调用耗时）/ csm_latency_dlt（消费时延）/ msg_confirm_dlt（确认耗时）/ rsp_details（响应异常）/ status_details（状态异常）五大维度
3. **时间线追踪分析**：性能趋势、异常突变检测、指标关联分析
4. **智能数据分组**：按消费组、IP_PID、时间戳分组
5. **灵活配置**：top-n 限制、多种排序方式、维度选择

## 命令总览（2 个）

| CLI 命令 | 类型 | 说明 |
|---------|------|------|
| `tubemq:log-analyze` | local | 分析 TubeMQ 客户端日志，生成多维度性能指标报告（本地工具，不依赖 API） |
| `tubemq:csm-metric` | GET | 获取 TubeMQ 消费组的多时间快照消费指标，支持 markdown/json 输出，用于消费滞后与健康度诊断 |

## 参考文档

除 `skill_usage_guide.md` 外，还可按需加载以下文档：

### log_analyze_guide.md
`tubemq:log-analyze` 本地日志分析完整指南，包含前置条件、使用示例、命令行参数、技术规格（日志格式 / 分析维度 / 输出报告）、FAQ。当用户提到"客户端日志"、"性能分析"、"时间线"、"p99/p999/p9999"、"rsp_details"等关键词时读取此文件
```bash
do-bigdata docs show --skill tubemq-diagnosis --file log_analyze_guide.md
```

### consumer_diagnosis_guide.md
TubeMQ 消费组诊断指南。当用户需要诊断 TubeMQ 消费组健康状态时读取，涵盖基于 `tubemq:csm-metric` 的消费健康度评估（滞后百分比分级）、趋势分析（4 个时间快照对比）、异常检测（心跳丢失、消费停滞、IP 聚集、consumer_id 倾斜）及标准化诊断报告输出
```bash
do-bigdata docs show --skill tubemq-diagnosis --file consumer_diagnosis_guide.md
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
