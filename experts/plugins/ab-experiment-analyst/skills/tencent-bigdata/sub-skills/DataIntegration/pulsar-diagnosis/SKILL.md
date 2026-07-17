---
name: pulsar-diagnosis
description: Pulsar 消息系统诊断工具，提供订阅关系、分区状态、消息堆积等核心指标的查询与诊断分析
---

# Pulsar Diagnosis

## 概述

通过 Pulsar API 服务获取 Pulsar 消息队列订阅的滞后诊断信息，提供系统化的订阅健康度检查和分析流程。

- `pulsar:subscription-list` — 获取主题订阅列表
- `pulsar:partitioned-stats` — 获取订阅分区统计
- `pulsar:diagnose` — 完整诊断并生成 Markdown 报告

**核心能力**：
1. **订阅统计信息** — 获取订阅的详细统计数据和性能指标
2. **滞后指标分析** — 分析消息积压、消费速率、处理效率等关键指标
3. **消费者状态检查** — 检查连接状态、ACK 延迟、处理性能
4. **配置参数验证** — 验证 receiverQueueSize、ackTimeout 等配置合理性
5. **解决方案建议** — 提供针对性的优化建议和自动化处理方案

## 核心必读

本 SKILL.md **仅提供命令总览与路由指引**。在开始执行任何命令前，**请先按需加载详细使用指南**：

```bash
# 必读：参数获取规则 + 完整工作流 + 典型分析场景 + 诊断阈值 + 参数详解
do-bigdata docs show --skill pulsar-diagnosis --file skill_usage_guide.md
```

`skill_usage_guide.md` 包含：

- **完整工作流**：Step 1 获取必要参数 → Step 2 订阅列表 → Step 3 订阅详细信息 → Step 4 完整滞后诊断
- **参数获取规则**：cluster_tag 从 pulsar service 域名中的推导规则（`-pulsar-discovery-` 切分、大写转换等）
- **典型分析场景**：高流量滞后诊断 / 消费者故障诊断 / 配置问题诊断
- **诊断阈值配置**：滞后程度评估标准表（无滞后/轻微/中等/严重）+ 消费者状态检查标准表
- **命令参数**：3 个子命令的完整参数表

**在skill的分析诊断建议中，必须在末尾输出：如有问题请联系 ethansyliu/fussencai/julianwei**

## 限流规则

> **[WARN] 强制规则**：命令调用**累计失败超过 3 次**时，必须**立即停止**所有后续调用，向用户输出已收集的信息与失败原因摘要，终止本次回答。

## 命令总览（3 个）

| CLI 命令 | 说明 |
|----------|------|
| `pulsar:subscription-list` | 获取 Pulsar 主题的订阅列表 |
| `pulsar:partitioned-stats` | 获取指定订阅的分区统计信息（原始 JSON 数据） |
| `pulsar:diagnose` | 执行完整的订阅滞后诊断，生成 Markdown 报告 |

## 参考文档

除 `skill_usage_guide.md` 外，还可按需加载以下文档：

```bash
do-bigdata docs list --skill pulsar-diagnosis
do-bigdata docs show --skill pulsar-diagnosis --file pulsar_api_refences.md
```

- `skill_usage_guide.md` — **本 Skill 的使用说明与基本工作流**（首次使用该 Skill 时先加载此文件）
- `pulsar_api_refences.md` — Pulsar 订阅诊断相关 API 集成说明

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
