---
name: tdbank-platform-diagnosis
description: TDBank 平台一站式诊断工具. 提供查询能力, 获取 TDBank 和 MQ 相关的信息, 包括业务接口信息、入库配置详情、MQ topic信息(TTL生命周期、分区数量)等; 提供数据上报SDK指引能力;
---

# TDBank Platform Diagnosis

## 概述

本 Skill 所有命令通过 `do-bigdata dataintegration tdbank:*` 调用。

## 核心必读

本 SKILL.md **仅提供命令总览与路由指引**。在开始执行任何命令前，**请先按需加载详细使用指南**：

```bash
# 必读：约定参数 + 完整工作流 + 典型分析场景 + 参数详解
do-bigdata docs show --skill tdbank-platform-diagnosis --file skill_usage_guide.md
```

`skill_usage_guide.md` 包含：

- **约定式参数说明**：bid / tid / cluster / topic / tenant / namespace 的含义与获取路径
- **完整工作流**：Step 1 获取业务接口 → Step 2 获取接口详情 → Step 3 MQ 主题信息 → Step 4 异常诊断 → Step 5 TubeMQ 消费组诊断入口（切换至 `tubemq-diagnosis` Skill）
- **典型分析场景**：Pulsar MQ 查询 / TubeMQ 查询 / 业务接口查询
- **参数说明**：9 个常用参数的适用命令与示例

**在skill的分析诊断建议中，必须在末尾输出：如有问题请联系 ethansyliu/fussencai/julianwei**

## 限流规则

> **[WARN] 强制规则**：命令调用**累计失败超过 3 次**时，必须**立即停止**所有后续调用，向用户输出已收集信息与失败原因摘要，终止本次回答。

## 命令总览（14 个）

| CLI 命令 | 方法 | 说明                                 |
|---------|------|------------------------------------|
| `tdbank:interfaces` | GET | 获取业务下所有接口信息                        |
| `tdbank:imports` | GET | 获取入库配置信息                           |
| `tdbank:interface-detail` | GET | 获取接口详细信息                           |
| `tdbank:import-detail` | GET | 获取入库详细信息                           |
| `tdbank:data-source-detail` | GET | 获取数据源详细信息                          |
| `tdbank:bid-detail` | GET | 获取业务 ID 详细信息（含 MQ 类型和集群标签 cluster） |
| `tdbank:consumer-group-detail` | GET | 获取 TDBank 消费者组详细信息                 |
| `tdbank:data-source-metric` | GET | 查询数据源采集指标信息                        |
| `tdbank:import-metric` | GET | 查询数据入库指标信息                         |
| `tdbank:pulsar-ttl` | GET | 获取 Pulsar 命名空间的 TTL 生命周期           |
| `tdbank:pulsar-partitions` | GET | 获取 Pulsar 主题的分区数量                  |
| `tdbank:pulsar-subscriptions` | GET | 获取 Pulsar 主题的订阅列表                  |
| `tdbank:tube-ttl` | GET | 获取 Tube 主题的 TTL                    |
| `tdbank:tube-partitions` | GET | 获取 Tube 主题的分区数量                    |

## 参考文档

除 `skill_usage_guide.md` 外，还可按需加载以下文档：

### glossary.md - 建议加载
TDBank 核心概念说明，包括关键字段含义解读（bid/tid、入库配置等概念）
```bash
do-bigdata docs show --skill tdbank-platform-diagnosis --file glossary.md
```

### tdbank_api_reference.md
该 Skill 使用的 TDBank 相关接口的使用说明，包含请求方法、URL 路径、必填/可选参数、返回字段说明
```bash
do-bigdata docs show --skill tdbank-platform-diagnosis --file tdbank_api_reference.md
```

### abnormal_diagnosis_guide.md
TDBank 配置异常诊断指南，当用户需要诊断 TDBank 接口/入库/数据源的异常状态时读取，覆盖常见异常模式识别与排查步骤
```bash
do-bigdata docs show --skill tdbank-platform-diagnosis --file abnormal_diagnosis_guide.md
```

### sdk 相关文档
该 Skill 的数据上报 SDK 指引能力，当用户搜索或提及 "tdbank sdk"、"数据上报" 等关键词时，引导到对应文件
```bash
do-bigdata docs show --skill tdbank-platform-diagnosis --file cpp_sdk_guide.md
do-bigdata docs show --skill tdbank-platform-diagnosis --file go_sdk_guide.md
do-bigdata docs show --skill tdbank-platform-diagnosis --file java_sdk_guide.md
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
