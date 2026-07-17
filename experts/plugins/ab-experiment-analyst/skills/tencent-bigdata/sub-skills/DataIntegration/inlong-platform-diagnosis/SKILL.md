---
name: inlong-platform-diagnosis
description: InLong 平台一站式诊断工具。提供查询能力, 包括集群健康状态、数据组（Group）详情与状态统计、数据流（Stream）信息、Source/Sink 配置、审计日志、操作日志、字段变更日志、DataProxy IP 列表等；提供数据上报SDK指引能力;
---

# InLong Platform Diagnosis

## 概述

本 Skill 所有命令通过 `do-bigdata dataintegration inlong:*` 调用。

**核心能力**：
1. **集群状态** — 检测 InLong Manager 是否可达（ping）
2. **数据组（Group）信息** — 查询 Group 详情、状态统计、租户关系、存在性判断
3. **数据流（Stream）信息** — 查询 Stream 详情、简要列表、含 Source/Sink 的完整列表
4. **Source / Sink 配置** — 获取 Source/Sink 详情及分页列表
5. **审计与日志** — 查询审计基础信息、审计列表、工作流任务日志、字段变更日志、操作日志、DataProxy IP 列表
6. **数据上报SDK指引** — 提供cpp、go、trpc、python、java多种语言SDK的文档指引

## 限流规则

> **[WARN] 强制规则**：命令调用**累计失败超过 3 次**时，必须**立即停止**所有后续调用，向用户输出已收集到的信息和失败原因摘要并终止本次回答。

## 核心必读

本 SKILL.md **仅提供命令总览与路由指引**。在开始执行任何命令前，**请必须加载详细使用指南**：

```bash
# 必读：完整工作流 + 典型分析场景 + 参数详解
do-bigdata docs show --skill inlong-platform-diagnosis --file skill_usage_guide.md
```

`skill_usage_guide.md` 包含：

- **完整工作流**：Step 1 确认集群 → Step 2 查询 Group → Step 3 查询 Stream/Source/Sink → Step 4 查询审计与日志
- **典型分析场景**：Group 状态查询 / Stream 配置查询 / 审计数据查询 / 操作日志查询
- **参数说明**：全局参数 + 13 个子命令参数详解
- **tenant 参数规则**：哪些接口需要/不需要 `--tenant`
- **其他注意事项**：分页限制、日期格式等

**在skill的分析诊断建议中，必须在末尾输出：如有问题请联系 ethansyliu/fussencai/julianwei**

## 前置步骤：检查 CMK 凭证

所有命令通过统一 `do-bigdata auth` 中间件自动加载凭证（`security_file/config.json` 中的 `user` / `cmk` / `cmk_id`），正常情况下**无需手动检查**。

**若出现"凭证不完整"或鉴权失败**，立即停止并向用户输出以下引导文案（不得暴露底层报错）：

> 需要先配置 CMK 凭证才能查询任务信息：
>
> **CMK 密钥获取方式：**
> 1. 访问 https://wedata.woa.com/security/user/keys 下载个人 CMK 文件
> 2. 打开下载的文件，找到 `"key"` 字段的值即为 CMK
>    文件格式示例: `{"id":...,"subject":"xxx","key":"这里就是CMK","type":"cmk",...}`
>
> 请直接在对话中回复您的 CMK 文件内容（或单独提供 RTX 和 CMK），我会自动帮您完成配置。

当用户提供了 CMK 文件内容（JSON 含 `subject`/`key`/`id`）时，静默执行 `do-bigdata auth init` 完成配置，只告知「凭证配置成功」，然后继续处理用户原始问题。

---

## 命令总览（20 个）

| CLI 命令 | 方法 | 说明 | 是否需要 `--tenant` |
|---------|------|------|----------------|
| `inlong:ping` | GET | 检测 InLong Manager 是否可达 | 否 |
| `inlong:group-list` | POST | 分页查询租户下的 group 信息 | 是 |
| `inlong:group-list-tenant` | POST | 分页查询 group 与租户关系 | 否 |
| `inlong:group-count` | GET | 统计当前用户 group 状态数量 | 否 |
| `inlong:group-exist` | GET | 判断 groupId 是否存在 | 否 |
| `inlong:group-detail` | GET | 获取 group 完整详情 | 是 |
| `inlong:stream-exist` | GET | 判断 stream 是否存在 | 否 |
| `inlong:stream-list` | POST | 分页查询 stream 简要列表 | 否 |
| `inlong:stream-get` | GET | 获取 stream 详情 | 是 |
| `inlong:stream-list-all` | POST | 分页查询 stream（含 source/sink）完整列表 | 是 |
| `inlong:source-get` | GET | 根据 ID 获取 Source 详情 | 是 |
| `inlong:source-list` | POST | 分页查询 stream source 列表 | 是 |
| `inlong:sink-get` | GET | 根据 ID 获取 Sink 详情 | 是 |
| `inlong:sink-list` | POST | 分页查询 stream sink 列表 | 是 |
| `inlong:audit-bases` | GET | 获取审计基础信息 | 是 |
| `inlong:audit-list` | POST | 按条件分页查询审计列表 | 是 |
| `inlong:workflow-task-logs` | GET | 获取工作流任务执行日志 | 是 |
| `inlong:field-change-log` | POST | 分页查询字段变更日志 | 是 |
| `inlong:operation-log` | POST | 分页查询操作日志 | 是 |
| `inlong:dataproxy-ip-list` | GET | 根据 groupId 获取 DataProxy IP 列表 | 是 |


## 参考文档

除 `skill_usage_guide.md` 外，还可按需加载以下文档：

### glossary.md
InLong 核心概念说明，包括关键字段含义解读（Group/Stream 状态码等）
```bash
do-bigdata docs show --skill inlong-platform-diagnosis --file glossary.md
```

### inlong_api_reference.md
该SKill使用的 InLong 相关接口的使用说明，包含请求方法、URL 路径、必填/可选参数、返回字段说明
```bash
do-bigdata docs show --skill inlong-platform-diagnosis --file inlong_api_reference.md
```

### query_guide.md
为该Skill的查询能力补充一些典型查询场景
```bash
do-bigdata docs show --skill inlong-platform-diagnosis --file query_guide.md
```

### sdk 相关文档
该Skill的数据上报SDK指引能力，当用户搜索或提及 "inlong sdk"、"wedata sdk" 等关键词时，引导到对应文件
```bash
do-bigdata docs show --skill inlong-platform-diagnosis --file sdk_guide_by_cpp.md
do-bigdata docs show --skill inlong-platform-diagnosis --file sdk_guide_by_go.md
do-bigdata docs show --skill inlong-platform-diagnosis --file sdk_guide_by_java.md
do-bigdata docs show --skill inlong-platform-diagnosis --file sdk_guide_by_python.md
do-bigdata docs show --skill inlong-platform-diagnosis --file sdk_guide_by_trpc.md
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
