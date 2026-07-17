---
name: Authentication
description: 当用户需要确认 Hive/TDW 库表的访问权限（select/update/alter/create/admin）时，优先使用当前的 Skill。仅支持 Hive 库表权限检查，不支持 HDFS 文件权限、StarRocks 权限、消息队列权限等其他系统。
---

# 认证与权限管理

## 概述

Authentication 模块提供 **Hive/TDW 库表** 的身份认证和权限检查能力。通过与安全中心（tauth）集成，为用户提供统一的 Hive 库表权限检查接口。

> [WARN] **注意**：本模块仅支持 Hive/TDW 库表权限检查，不覆盖 HDFS 文件权限、StarRocks 权限、消息队列权限、WeData 平台权限等其他系统的权限场景。

## 适用场景

- 需要检查用户对 **Hive/TDW 数据表**的访问权限（select/update/alter/create/admin）
- 需要进行 Hive/TDW 库表的批量权限检查
- 需要通过 tauth 验证 Hive/TDW 库表的身份和权限信息

## 不适用场景

- 申请新权限（应通过权限管理平台）
- 修改其他用户权限（需管理员操作）
- **HDFS 文件/目录权限检查**（应通过 `hdfs dfs -ls` 查看或使用 `HDFS/hdfs-basic-operations` 操作 chmod/chown）
- **StarRocks 内部表权限**（应使用 `OLAP/starrocks-privilege-analysis`）
- **StarRocks 外部 Catalog（Hive/Iceberg）权限**（需分别到对应系统确认）
- **Kafka / Pulsar / TubeMQ Topic 级权限**（需到对应消息中间件管理平台确认，或参考 `DataIntegration` 子系统）
- **WeData 平台项目权限 / 资源权限**（需到 WeData 权限管理页面确认）
- **Oceanus 项目成员权限**（需通过 Oceanus 项目管理确认）
- **Ranger 策略查询与管理**（暂不支持）

## 可用 Sub-Skills

| Sub-Skill | 功能 | 适用场景 |
|-----------|------|---------|
| [`table-permission-check`](#table-permission-check) | 表权限检查 | 检查用户对数据表的权限（select/update/alter/create） |

---

## table-permission-check

### 功能描述

检查用户对数据表的访问权限，支持单条和批量检查，支持多个 BG（Business Group）和集群。

### 快速使用

```bash
# 配置凭证（首次使用）
do-bigdata auth init --user <username> --cmk <cmk_key> --cmk-id <cmk_id>

# 检查权限
do-bigdata authentication permission-check \
  -c tl \
  -d mydb \
  -t mytable \
  -a select \
  --query "检查mydb.mytable的select权限"

# 批量检查
do-bigdata authentication batch-permission-check \
  --permissions '[{"cluster":"tl","database":"mydb","table":"mytable","access_type":"select"}]' \
  --query "批量检查权限"
```

### 关键特性

- [OK] 支持单条和批量权限检查
- [OK] 支持 select/update/alter/create 四种权限类型
- [OK] 支持多集群和多 BG 支持
- [OK] 完整的错误处理和结果格式化
- [OK] Agent 模式支持

### 更多信息

详见 [`table-permission-check` 子技能文档](./table-permission-check/SKILL.md)

---

## 前置条件

### 凭证配置

所有权限检查操作都需要有效的认证凭证：

- **CMK（Cryptography Master Key）**：从 https://wedata.woa.com/security/user/keys 获取
- **用户名（RTX）**：当前用户身份
- **CMK ID**：CMK 文件中的 id 字段（可选）

### 配置方式

```bash
do-bigdata auth init --user <username> --cmk <cmk_key> --cmk-id <cmk_id>
```

## 工作流

### 典型权限检查流程

```
1. 检查并加载认证凭证（do-bigdata auth init 已配置）
   ↓
2. 生成 TAUTH token
   ↓
3. 构建权限检查请求
   ↓
4. 调用权限检查 CLI 命令
   ↓
5. 解析并返回结果
```

## 参考文档

通过 CLI 查看参考文档：
```bash
# 列出可用参考文档
do-bigdata docs list --skill Authentication/table-permission-check

# 查看指定文档
do-bigdata docs show --skill Authentication/table-permission-check --name api_schema.md
```

---

## 跨模块路由说明

当用户的权限检查需求不属于 Hive/TDW 库表范围时，应引导到对应的子系统：

| 权限场景 | 应路由到 | 说明 |
|---------|---------|------|
| StarRocks 表权限（Access denied） | `OLAP/starrocks-privilege-analysis` | 通过 SHOW GRANTS 排查 |
| HDFS 文件/目录权限 | `HDFS/hdfs-basic-operations` | chmod/chown 操作 |
| US 任务中发现库表权限问题 | 由 US 主动联动本 Skill | 已有跨模块引导机制 |
| Pulsar/TubeMQ/InLong 权限 | `DataIntegration` 子系统 | 需到对应管理平台确认 |
| WeData 项目/资源权限 | WeData 权限管理页面 | 暂无 Skill 支持 |
| Oceanus 项目成员权限 | Oceanus 项目管理 | 暂无 Skill 支持 |
| Ranger 策略查询 | 暂无对应 Skill | 暂不支持自动化查询 |

---

## 常见问题

### Q: 如何获取 CMK？
A: 访问 https://wedata.woa.com/security/user/keys 下载个人 CMK 文件，打开文件找到 "key" 字段的值。

### Q: 权限检查失败了怎么办？
A: 请检查：
1. CMK 凭证是否正确配置
2. 网络连接是否正常
3. 是否拥有相应的权限
4. Token 是否过期

### Q: Agent 模式下如何指定用户名？
A: 设置环境变量 `TIANQIONG_PROXY_USERNAME` 或 `KNOT_USERNAME`，优先级从高到低。

---

## 支持与反馈

如遇到问题，请提交 issue 或联系相关技术支持团队。

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
