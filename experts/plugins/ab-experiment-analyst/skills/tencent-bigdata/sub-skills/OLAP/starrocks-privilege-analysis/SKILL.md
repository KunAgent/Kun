---
name: starrocks-privilege-analysis
description: >
  排查 StarRocks 集群的用户和角色权限问题。支持查看用户权限和角色权限，分析权限不足的原因并给出授权建议。
  仅能查询 default_catalog 下的权限，无法确认 Hive/Iceberg 等外部 Catalog 的权限。
  触发关键词："Access denied", "权限不足", "权限报错", "GRANT", "授权", "用户权限", "角色权限", "SHOW GRANTS", "权限排查"
---

## 概述

通过 do_mcp API 服务查询 StarRocks 集群的用户权限和角色权限信息，结合权限项参考文档进行权限问题排查。

**核心能力**：
1. **用户权限查询** — 查看指定用户被授予的所有权限（SHOW GRANTS FOR user）
2. **角色权限查询** — 查看指定角色被授予的所有权限（SHOW GRANTS FOR ROLE role）
3. **权限分析** — 根据报错信息和当前权限对比，找出缺少的权限项
4. **授权建议** — 参考权限项文档，给出具体的 GRANT 语句建议

**重要限制**：
- 本 Skill 仅能查询 `default_catalog`（StarRocks 内部数据）下的权限
- 无法查询 Hive、Iceberg 等外部 Catalog 的表权限
- 如果报错涉及外部表，请提醒用户到对应的外部权限管理系统中确认

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

### Step 0: 确认参数和场景

根据用户的问题确认：

| 参数 | 获取方式 |
|------|---------|
| **集群名称** | 用户提供（必需） |
| **用户名** | 从报错信息中提取（如 `Access denied for user 'xxx'@'%'`）或用户直接提供 |
| **角色名** | 用户提供（可选，需要进一步查看角色权限时使用） |

**场景判断**：
- **场景 A**：用户直接提供了报错信息 → 从报错中提取用户名，进入 Step 1
- **场景 B**：分析历史查询发现权限报错 → 从失败记录中提取用户名，进入 Step 1
- **场景 C**：用户直接询问权限如何授予 → 读取参考文档，给出授权语句

### Step 1: 查看用户权限

```bash
do-bigdata olap user-grants --cluster <集群名称> --user <用户名> --query "<用户原始问题>"
```

分析返回的权限列表：
- **有权限** → 逐条检查是否包含报错所需的权限
  - 注意权限范围是否匹配（具体库、具体表 vs ALL TABLES IN DATABASE）
  - 注意权限类型是否匹配（SELECT vs INSERT vs ALTER 等）
- **无权限** → 用户可能不存在或确实未被授予任何权限

### Step 2: 查看角色权限（按需）

如果 Step 1 中发现用户被授予了角色，进一步查看角色的具体权限：

```bash
do-bigdata olap role-grants --cluster <集群名称> --role <角色名> --query "<用户原始问题>"
```

### Step 3: 权限对比分析

读取参考文档中的权限项说明，进行对比分析：

```bash
do-bigdata docs show --skill starrocks-privilege-analysis --file privilege_guide.md
```

1. **确定所需权限**：根据报错信息或用户的操作，确认需要什么权限
   - 查询表 → TABLE 的 SELECT
   - 写入数据 → TABLE 的 INSERT
   - 创建表 → DATABASE 的 CREATE TABLE
   - 修改表结构 → TABLE 的 ALTER
   - 查看 Profile → SYSTEM 的 OPERATE
   - 更多对应关系参见参考文档 "常见权限报错及分析"章节

2. **对比现有权限**：
   - 用户是否直接拥有所需权限？
   - 用户的角色是否包含所需权限？
   - 权限范围是否匹配（库名、表名是否对应）？

3. **特殊情况检查**：
   - 是否从 2.x 升级到 3.0 导致权限不兼容？（参见 "版本升级权限注意事项"）
   - 是否涉及外部 Catalog？（本工具无法查询，需提醒用户）

### Step 4: 输出诊断结论和建议

根据分析结果，输出：

**分析输出格式**：

```
## StarRocks 权限分析报告

### 基本信息
- 集群名称: {cluster_name}
- 用户名称: {user_name}

### 当前权限摘要
{按对象类型分类列出用户当前拥有的权限}

### 问题分析
- 报错信息: {error_message}
- 缺少权限: {missing_privilege}
- 涉及对象: {object_type} {object_name}

### 建议操作
```sql
GRANT {privilege} ON {object_type} {object_name} TO USER '{user_name}';
```

### 注意事项
- {外部 Catalog 限制提醒（如适用）}
- {版本兼容性提醒（如适用）}
```

## 典型分析场景

### 场景 A：用户直接提供权限报错

**输入示例**：用户提供报错 `Access denied for user 'analytics'@'%' to table 'user_orders'`

**处理流程**：
1. 从报错中提取：用户名 = `analytics`，涉及对象 = `user_orders` 表
2. 执行 `do-bigdata olap user-grants` 查看 `analytics` 用户的当前权限
3. 检查权限列表中是否包含对 `user_orders` 表的 SELECT 权限
4. 如果缺少，给出 `GRANT SELECT ON TABLE db.user_orders TO USER 'analytics'` 建议

### 场景 B：历史查询失败分析发现权限问题

**前置条件**：在 `starrocks-query-failure` skill 分析中，发现有 `Access denied` 类型的失败

**处理流程**：
1. 从失败记录中提取用户名和涉及的数据库/表
2. 联动本 Skill 执行 `do-bigdata olap user-grants` 查看权限
3. 对比分析给出建议

### 场景 C：用户询问权限如何授予

**输入示例**：用户问"如何给 user1 授予 db1 库所有表的查询权限"

**处理流程**：
1. 读取参考文档中的授权语法参考
2. 直接给出 GRANT 语句：`GRANT SELECT ON ALL TABLES IN DATABASE db1 TO USER 'user1'`
3. 如果需要确认用户当前权限状态，可选执行 `do-bigdata olap user-grants` 查看

## 参数说明

| 参数 | 说明 | 适用子命令 | 示例 |
|------|------|-----------|------|
| `--cluster` / `-c` | 集群名称（必需） | user-grants, role-grants | `starrocks-prod` |
| `--user` / `-u` | 用户名（必需） | user-grants | `analytics` |
| `--role` / `-r` | 角色名（必需） | role-grants | `db_admin` |

## 联动说明

| 联动 Skill | 场景 |
|-----------|------|
| **starrocks-query-failure** | 查询失败分析发现权限问题（`Access denied`）时，联动本 Skill 确认用户权限 |
| **starrocks-query-info** | 从审计日志中发现权限报错时，获取具体 SQL 后联动本 Skill 分析权限缺失 |
| **starrocks-mv-troubleshooting** | 物化视图刷新失败且报错为权限不足时，联动本 Skill 检查权限 |
| **starrocks-schema-change** | Schema Change 失败提示权限不足时（尤其 2.x→3.0 升级后），联动本 Skill 确认 ALTER 权限 |

## 参考文档

```bash
do-bigdata docs list --skill starrocks-privilege-analysis
do-bigdata docs show --skill starrocks-privilege-analysis --file privilege_guide.md
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
