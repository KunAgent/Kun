---
name: table-permission-check
description: 用于检测用户是否具有对应库表的访问权限。用户需提供：库名、表名、权限类型（select/update/alter/all）；集群信息可选（默认tl同乐，可选tl/cft/hk/wxpay/cftwx/paycft/wallet）。
---

# 表权限检查

## 概述

帮助用户快速检测是否拥有指定库表的访问权限，支持单条和批量权限检查。

**用户需要提供以下信息**：
- **库名**：数据库名称（必填）
- **表名**：表名称（必填）
- **权限类型**：`select`（查询）、`update`（更新）、`alter`（修改结构）、`all`（全部权限）（必填）
- **集群信息**（可选，默认 `tl`）：见[集群标识对照表](#集群标识对照表)

### 表名格式智能解析

用户输入的表名可能包含多种格式，Agent 需智能解析并自动拆分库名和表名：

| 用户输入格式 | 示例 | 解析结果 |
|-------------|------|----------|
| `db_name.table_name` | `scheduler_database.task_status` | 库名=`scheduler_database`，表名=`task_status` |
| `db_name::table_name` | `scheduler_database::task_status` | 库名=`scheduler_database`，表名=`task_status` |
| `db_name：：table_name` | `scheduler_database：：task_status` | 库名=`scheduler_database`，表名=`task_status`（中文冒号） |
| 分开提供 | 库名=`scheduler_database`，表名=`task_status` | 直接使用 |

**解析规则**（按优先级）：
1. 包含 `::` 或 `：：`（中英文双冒号）→ 按双冒号分割
2. 包含 `.`（英文句点）→ 按第一个 `.` 分割
3. 分开提供库名和表名 → 直接使用

## 适用 / 不适用场景

**适用**：检查 select/update/alter/all 权限、批量检查、数据处理前权限验证

**不适用**：申请新权限（通过权限管理平台）、修改用户权限（需管理员）

## 前置条件

### 认证凭证
- CMK（Cryptography Master Key）：从 https://wedata.woa.com/security/user/keys 获取
- 用户名（RTX）：当前用户身份标识
- CMK ID：CMK 文件中的 id 字段（可选但推荐）

### 配置

首次使用需要配置凭证：
```bash
do-bigdata auth init --user <username> --cmk <cmk_key> --cmk-id <cmk_id>
```

## 参考信息

### 参考文档

通过 CLI 查看参考文档：
```bash
# 列出可用参考文档
do-bigdata docs list --skill Authentication/table-permission-check

# 查看指定文档
do-bigdata docs show --skill Authentication/table-permission-check --name table_permission_guide.md
do-bigdata docs show --skill Authentication/table-permission-check --name api_schema.md
```

### 支持的权限类型

| 权限类型 | 说明 | 应用场景 |
|---------|------|---------|
| select | 读取权限 | 查询表数据 |
| update | 修改权限 | 更新表数据、INSERT |
| create | 创建权限 | 创建新表 |
| alter | 结构权限 | 修改表结构、删除表 |
| admin | 管理权限 | 管理表、修改权限 |

### 集群标识对照表

| 集群标识 | 说明 |
|---------|------|
| tl | 同乐（默认） |
| cft | 财付通 |
| hk | 沙田 |
| wxpay | 支付账单库 |
| cftwx | 财付通微信 |
| paycft | 支付财付通 |
| wallet | 香港钱包 |

## 工作流

### [WARN] 场景路由（二选一）

| 用户意图 | 走哪条路线 |
|---------|-----------|
| "帮我查一下 xxx 表有没有 select 权限" | **路线 A**：单表权限实时检查（走安全中心 Ranger） |
| "看看我有哪些库表的权限" / "我能访问哪些表" | **路线 B**：全量权限查询（走离线权限表） |

---

### 路线 A：单表/批量权限实时检查（原有流程）

```
1. 认证检查（do-bigdata auth init 已配置）
2. 生成 TAUTH token
3. 收集参数（集群、库名、表名、操作类型、用户名）
4. 调用权限检查 CLI 命令
5. 解析并返回结果
```

---

### 路线 B：全量权限查询（新增流程）

当用户想"看看自己有哪些库表的权限"时，按如下完整流程执行：

```
1. 认证检查（do-bigdata auth init 已配置，确认 CMK 有效）
        ↓
2. 查询个人账号拥有的全部库表权限
   do-bigdata authentication my-permissions --query "<用户问题>"
        ↓
3. 查询用户负责的平台运行账号
   do-bigdata authentication my-groups --query "<用户问题>"
        ↓
4. 使用平台运行账号查询其拥有的库表权限
   do-bigdata authentication group-permissions --groups "<group1>,<group2>,..." --query "<用户问题>"
        ↓
5. 汇总输出：个人权限 + 平台账号权限
```

**关键规则**：
- 步骤 2-4 必须**全部执行**，不能跳过，因为用户通过平台账号间接拥有的权限往往比个人直接持有的更多
- 步骤 3 返回的 `group_name` 列表作为步骤 4 的 `--groups` 参数
- 如果步骤 3 返回空（用户不属于任何平台账号），跳过步骤 4，只输出个人权限

### 无权限处理流程

当检测到用户没有相应权限（`allowed: false`）时，**必须**生成权限申请链接引导用户申请。

#### 链接生成规则

**链接模板**：
```
https://wedata.woa.com/security/myAuth?entity=true&database={数据库名}&table={表名}&clusterIdentifier={集群标识}&resourceType=HIVE_TBL
```

| 参数 | 值 |
|------|-----|
| 基础URL | `https://wedata.woa.com/security/myAuth` |
| entity | 固定 `true` |
| database | 库名（需URL编码） |
| table | 表名（需URL编码） |
| clusterIdentifier | 对应集群标识（见[集群标识对照表](#集群标识对照表)） |
| resourceType | 固定 `HIVE_TBL` |

#### 链接生成代码

```python
def generate_permission_apply_link(database: str, table: str, cluster: str = "tl") -> str:
    """生成权限申请链接"""
    from urllib.parse import quote
    base_url = "https://wedata.woa.com/security/myAuth"
    params = f"entity=true&database={quote(database)}&table={quote(table)}&clusterIdentifier={cluster}&resourceType=HIVE_TBL"
    return f"{base_url}?{params}"
```

#### 输出格式

**必须使用 Markdown 可点击链接格式**，同时提供纯文本链接方便复制。

**单个权限检查**：

```markdown
[WARN] **权限检查结果：您没有查询权限**

| 字段 | 值 |
|------|-----|
| **是否允许** | ✗ 否 |
| **集群** | tl (同乐) |
| **数据库** | analytics |
| **表名** | user_events |
| **权限类型** | select (查询) |
| **用户** | darronfang |

### 申请权限

您当前没有 `analytics.user_events` 表的 **select 查询权限**。

* **[点击此处申请权限](https://wedata.woa.com/security/myAuth?entity=true&database=analytics&table=user_events&clusterIdentifier=tl&resourceType=HIVE_TBL)**

或复制以下链接在浏览器中打开：
`https://wedata.woa.com/security/myAuth?entity=true&database=analytics&table=user_events&clusterIdentifier=tl&resourceType=HIVE_TBL`
```

**批量检查（无权限项）**：

```markdown
[WARN] **以下 2 个权限检查未通过，请分别申请：**

| # | 集群 | 数据库 | 表名 | 权限类型 | 申请链接 |
|---|------|--------|------|----------|----------|
| 1 | tl | analytics | user_events | update | [点击申请](https://wedata.woa.com/security/myAuth?entity=true&database=analytics&table=user_events&clusterIdentifier=tl&resourceType=HIVE_TBL) |
| 2 | cft | product | orders | create | [点击申请](https://wedata.woa.com/security/myAuth?entity=true&database=product&table=orders&clusterIdentifier=cft&resourceType=HIVE_TBL) |
```

## CLI 命令

### 1. permission-check - 检查单个权限

```bash
do-bigdata authentication permission-check \
  -c <cluster> \
  -d <database> \
  -t <table> \
  -a <access_type> \
  [-u <check_user>] \
  --query "<用户问题>"
```

- `-c / --cluster`: 集群标识（默认 tl） - 可选
- `-d / --database`: 库名 - 必需
- `-t / --table`: 表名 - 必需
- `-a / --access-type`: 权限类型（select/update/alter/create/admin） - 必需
- `-u / --check-user`: 检查目标用户（默认当前配置用户） - 可选

输出示例：
```json
{
  "allowed": true,
  "cluster": "tl",
  "database": "analytics",
  "table": "user_events",
  "access_type": "select",
  "user": "darronfang",
  "timestamp": "2024-04-03T10:30:00Z"
}
```

### 2. batch-permission-check - 批量检查权限

```bash
do-bigdata authentication batch-permission-check \
  --permissions '[{"cluster":"tl","database":"db","table":"tbl","access_type":"select"}]' \
  --query "<用户问题>"
```

- `-p / --permissions`: 权限列表 JSON 字符串 - 必需

### 3. list-permissions - 列出用户权限

```bash
do-bigdata authentication list-permissions \
  [-c <cluster>] \
  [-u <check_user>] \
  --query "<用户问题>"
```

- `-c / --cluster`: 指定集群（默认列出所有） - 可选
- `-u / --check-user`: 查询目标用户（默认当前用户） - 可选

### 4. my-permissions - 查询个人全量库表权限

```bash
do-bigdata authentication my-permissions --query "<用户问题>"
```

从离线权限表查询当前用户个人账号直接拥有的全部库表权限。

输出字段：`principal`（主体）、`resource_qualifier`（库.表）、`resource_type`（资源类型）、`access`（权限类型）、`cluster_name`（集群）

### 5. my-groups - 查询负责的平台运行账号

```bash
do-bigdata authentication my-groups --query "<用户问题>"
```

查询当前用户加入的全部平台运行账号（group）及其角色。

输出字段：`group_name`（平台账号名）、`role`（角色）、`user_name`（用户名）

### 6. group-permissions - 查询平台账号的库表权限

```bash
do-bigdata authentication group-permissions \
  --groups "<group1>,<group2>,<group3>" \
  --query "<用户问题>"
```

查询指定的多个平台运行账号拥有的全部库表权限。

- `-g / --groups`: 平台账号列表，逗号分隔 - 必需（最多 50 个）

输出字段：同 `my-permissions`

### 7. 凭证配置

```bash
do-bigdata auth init --user <username> --cmk <cmk_key> --cmk-id <cmk_id>
```

## 错误处理

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `未找到 CMK 凭证配置` | 未配置认证凭证 | 运行 `do-bigdata auth init` 命令配置凭证 |
| `连接权限检查接口失败` | 网络连接问题 | 检查网络连接，确认 API 服务可用 |
| `请求权限检查接口超时` | API 响应超时 | 检查网络状态，重试请求 |
| `权限检查失败` | 用户权限不足 | 按[无权限处理流程](#无权限处理流程)生成申请链接 |
| `Token 认证失败` | CMK 凭证无效 | 重新配置凭证，确认 CMK 值正确 |
| `集群标识不支持` | 集群不存在 | 确认集群标识正确（见[集群标识对照表](#集群标识对照表)） |
| `表不存在` | 指定的表名有误 | 确认库名和表名正确 |

## 常见问题

**Q: 一次最多可以批量检查多少个权限？**
A: 单次请求最多 100 条，超过限制工具会自动分批处理。

**Q: 权限检查结果是否会被缓存？**
A: 默认不缓存，每次执行都获取最新结果。

**Q: 没有权限怎么申请？**
A: 当检查返回 `allowed: false` 时，Agent 会按[无权限处理流程](#无权限处理流程)自动生成可点击的权限申请链接。

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
