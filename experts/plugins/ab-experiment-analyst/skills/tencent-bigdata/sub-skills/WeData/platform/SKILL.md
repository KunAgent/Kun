---
name: WeData-Platform
description: WeData 控制台（平台管理）相关技能的入口。当用户提到 WeData 控制台、应用组、项目空间、成员管理、加入应用组、退出应用组、查询应用组等平台管理类操作时，使用此技能了解可用的子技能列表并路由到合适的技能。
---

# WeData 平台管理技能集

## 概述

WeData 平台管理（Platform）是 WeData 控制台侧的管理能力集合，区别于数据探索 / SQL 生成 / 诊断这些数据开发能力，本目录聚焦"控制台资源管理"类操作：应用组（AppGroup）、项目空间、成员、权限审批等。

> **范围划分**：
> - 数据开发类（SQL 执行 / 分析 / 生成 / 诊断 / Notebook）→ 见 `WeData/SKILL.md` 中的其他子技能
> - 控制台管理类（应用组 / 项目 / 成员 / 审批）→ 在本目录下

## 可用技能

### 1. app-group-management — 应用组管理

- **路径**: `app-group-management/`
- **用途**: 通过 WeData 控制台管理应用组，支持查询应用组详细信息、申请加入应用组、退出应用组三个原子操作
- **触发场景**:
  - 用户需要查看某个应用组的详细信息（成员、配额、所属项目等）
  - 用户需要申请加入某个应用组
  - 用户需要退出当前所在的某个应用组
- **核心能力**:
  - 通过 `do-bigdata wedata` CLI 命令调用（3 个原子命令：`describe-app-group` / `apply-join-app-group` / `leave-app-group`）
  - 申请加入走审批流，需要管理员同意
  - 退出操作不可逆，需二次确认
  - 凭证由 `@auth_required` 中间件自动加载
- **触发关键词**: 应用组、app group、AppGroup、查询应用组、应用组详情、应用组信息、申请加入应用组、加入应用组、退出应用组、离开应用组、应用组成员

## 路由规则

| 用户意图 | 推荐技能 |
|---------|---------|
| 查询应用组详情 / 应用组成员 / 应用组配额 | app-group-management |
| 申请加入某个应用组 / 加入应用组审批 | app-group-management |
| 退出应用组 / 离开应用组 | app-group-management |

> 如果用户的问题不属于平台管理类（应用组/项目/成员），请回到 `WeData/SKILL.md` 中按数据开发类技能路由。

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
