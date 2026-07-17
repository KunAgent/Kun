---
name: hdfs-miss-block-diagnose
description: 当用户咨询或提供的任务报错日志抛出 HDFS BlockMissingException 失败原因时使用此 skill判断文件是否已经恢复。通过 do-bigdata CLI 调用 do_mcp API 获取文件所属集群信息和丢块诊断报告，定位丢块是否恢复，分析丢块产生的可能原因，提供修复建议，需要提供 HDFS 文件路径，集群名可选（若未提供则自动查询）。
---

## 概述

诊断 HDFS 文件丢块（BlockMissingException）问题。通过 `do-bigdata` CLI 工具调用 do_mcp API 服务，先定位文件所属集群，再获取文件的丢块诊断报告，分析丢块是否已恢复及产生原因，给出修复建议。

## [WARN] 场景判断（必读）

本 Skill 处理的是**丢块**问题，请根据报错关键字准确判断：

| 报错关键字 | 问题类型 | 本质原因 | 对应 Skill |
|-----------|---------|---------|-----------|
| `BlockMissingException` / `Could not obtain block` | **丢块** | 数据已经存储在集群上了，但 Block 丢失了，**读取失败** | 本 Skill（hdfs-miss-block-diagnose） |
| `Could not get block locations` | **集群存储满** | 集群满了，想创建新 Block 但创建不出来，**写入失败** | hdfs-storage-full-diagnose |

- 丢块 = 已有数据丢了读不出来（Block 已存在但丢失了）
- 集群存储满 = 新数据写不进去（Block 建不出来）

**适用场景**：
- 用户遇到 `org.apache.hadoop.hdfs.BlockMissingException` 异常
- 用户遇到 `Could not obtain block: BP-xxx:blk_xxx` 异常
- 用户需要确认某个 HDFS 文件的丢块是否已恢复
- 用户需要排查 HDFS 文件读取失败（疑似丢块）的根因
- 下游计算任务（Spark/MapReduce/Flink）因 HDFS 丢块而失败，需要定位丢块状态

**核心诊断能力**：

1. **路径解析与集群定位** — 从用户输入或异常日志中提取 HDFS 文件路径，由 CLI 自动查询文件所属集群
2. **丢块诊断报告获取** — CLI 调用丢块诊断接口获取文件的 Block 分布和健康状态
3. **丢块恢复判断** — 根据诊断报告判断丢块是否已恢复或仍然存在
4. **根因分析与修复建议** — 结合诊断数据分析丢块原因，给出修复建议

## 前置条件

- 已知丢块的 HDFS 文件路径（如 `/user/tdw/warehouse/db.db/table/part-00000`）或包含路径信息的异常日志
- 已安装 `do-bigdata` CLI 工具
- 已执行 `do-bigdata auth init` 完成凭证配置（CLI 的 `@auth_required` 装饰器会自动读取凭证）

## 工作流

当用户提供 HDFS 文件路径或 BlockMissingException 异常信息时，按以下步骤执行：

### 第 1 步：提取文件路径和集群名

从用户输入中提取 HDFS 文件路径和集群名：

**输入来源**：
- 用户直接提供的 HDFS 路径（如 `hdfs://my-cluster/data/part-00000` 或 `/user/tdw/warehouse/db.db/table/part-00000`）
- 异常日志中提取（如 `BlockMissingException: Could not obtain block: BP-xxx file=/data/xxx`）
- 计算任务失败日志中提取

**解析要点**：
- 若路径包含 `hdfs://cluster-name/...` 格式，从 schema 部分提取集群名 `cluster-name`，文件路径为 schema 后面的部分
- 若用户同时提供了集群名和文件路径，直接使用
- **若用户只贴了报错日志而未携带集群信息**，需要从日志中解析出 `file=` 后面的完整 HDFS 文件路径（CLI 会自动反查集群）
- 若用户仅提供了文件路径而未提供集群名，CLI 内部会自动查询

### 第 2 步：执行丢块诊断（一条命令完成）

直接调用 CLI 命令，CLI 会自动完成：解析路径 → 查询集群 → 获取诊断报告 → 输出状态判断：

```bash
# 自动查询集群（最常见场景，用户只贴了日志或路径）
do-bigdata hdfs miss-block --path <HDFS文件路径> --query "<用户原始问题>"

# 用户同时提供了集群名
do-bigdata hdfs miss-block --path <路径> --cluster <集群名> --query "<用户原始问题>"

# 路径包含 hdfs:// schema（CLI 自动从 schema 中提取集群名）
do-bigdata hdfs miss-block --path hdfs://<集群>/<路径> --query "<用户原始问题>"
```

**参数说明**：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--path` / `-p` | HDFS 文件路径（必选），支持 `/path` 或 `hdfs://cluster/path` | — |
| `--cluster` / `-c` | HDFS 集群名（可选，不提供则自动查询） | — |
| `--query` / `-q` | 用户原始问题（由 AI Agent 自动传入） | — |
| `--output` / `-o` | 输出格式：`text`（默认） / `json` | `text` |

**命令输出**：CLI 会输出结构化的诊断报告，包含：
- 文件路径、所属集群
- 诊断数据原文（status、missing_blocks、corrupt_blocks 等）
- 结论：丢块已恢复 / 丢块仍然存在 / 需要人工分析

### 第 3 步：根因分析与修复建议

基于 CLI 输出的诊断报告，对照参考文档中的丢块原因分类进行根因分析：

```bash
do-bigdata docs show --skill hdfs-miss-block-diagnose --file hdfs_miss_block_guide.md
```

**判断逻辑**：

**场景 A — 丢块已恢复**（文件状态为 HEALTHY，无 Missing blocks）：
- 文件所有 Block 的副本已完整，丢块已自动恢复
- 分析丢块产生的可能历史原因（DataNode 临时下线、网络抖动、NameNode 切换等）
- 建议用户重新执行失败的计算任务

**场景 B — 丢块仍然存在**（文件状态为 CORRUPT 或存在 Missing blocks）：
- 记录丢失的具体 Block 信息和预期副本数
- 分析丢块原因（DataNode 下线、磁盘故障、副本数不足等）
- 给出修复建议（等待自动恢复、手动干预、从上游重新生成数据等）

**诊断报告格式**（AI 据 CLI 输出整理）：

```
## HDFS 丢块诊断报告

### 基础信息
- 文件路径: {file_path}
- 所属集群: {cluster_name}

### 诊断结果
{从 CLI 输出中提取的关键信息}

### 诊断结论
{一句话概述丢块是否已恢复及原因}

### 详细分析
{分步骤的分析过程，包含关键数据引用}

### 修复建议
{具体的修复步骤和操作建议}
```

## 执行流程举例

### 示例 1：用户只贴了报错日志（不携带集群信息）

**用户输入**：

```
org.apache.hadoop.hdfs.BlockMissingException: Could not obtain block: BP-915542327-11.135.243.96-1698149125866:blk_9145297336_9018168272 file=/data/tianqiong/TEG/g_teg_admlpd_g_teg_admlpd_mlpd_automl/pxxr_feature_evaluate/20260306153331/yanjiaoma_5d05d105-3c50-4502-985e-a813c661a23e/tensor_dump/yanjiaoma/7334000001/1611335/tensor_dump_2112_198195154629117913.text-00000
```

**执行流程**：

1. **解析报错日志，提取文件路径**：从日志中找到 `file=` 关键字，提取其后的完整路径：
   ```
   /data/tianqiong/TEG/g_teg_admlpd_g_teg_admlpd_mlpd_automl/pxxr_feature_evaluate/20260306153331/yanjiaoma_5d05d105-3c50-4502-985e-a813c661a23e/tensor_dump/yanjiaoma/7334000001/1611335/tensor_dump_2112_198195154629117913.text-00000
   ```

2. **一条命令完成诊断**（CLI 内部自动查询集群 + 获取诊断报告）：
   ```bash
   do-bigdata hdfs miss-block \
     --path /data/tianqiong/TEG/g_teg_admlpd_g_teg_admlpd_mlpd_automl/.../tensor_dump_2112_198195154629117913.text-00000 \
     --query "这个文件丢块了，帮我看看是否已恢复"
   ```

3. **根据 CLI 输出的诊断报告判断丢块是否恢复，给出分析结论和修复建议**。

### 示例 2：用户提供了带 hdfs schema 的完整路径

**用户输入**：

```
hdfs://ss-pcg-13-v3/user/tdw/warehouse/mydb.db/mytable/part-00000 这个文件丢块了
```

**执行流程**：

1. **解析路径**：识别 `hdfs://` 前缀，CLI 会自动从 schema 中提取集群名。

2. **执行 CLI 命令**：
   ```bash
   do-bigdata hdfs miss-block \
     --path hdfs://ss-pcg-13-v3/user/tdw/warehouse/mydb.db/mytable/part-00000 \
     --query "这个文件丢块了"
   ```

3. **根据诊断报告给出分析结论和修复建议**。

### 示例 3：用户提供了文件路径和集群名

**用户输入**：

```
帮我看下集群 ss-pcg-13-v3 上 /data/logs/access.log 是否还有丢块
```

**执行流程**：

1. **解析输入**：获取集群名 `ss-pcg-13-v3` 和文件路径 `/data/logs/access.log`。

2. **执行 CLI 命令**（显式指定 `--cluster` 跳过集群查询）：
   ```bash
   do-bigdata hdfs miss-block \
     --path /data/logs/access.log \
     --cluster ss-pcg-13-v3 \
     --query "帮我看下 /data/logs/access.log 是否还有丢块"
   ```

3. **根据诊断报告给出分析结论和修复建议**。

### 关键提示

- **最常见的场景是示例 1**：用户直接粘贴了异常堆栈或错误日志，不会主动告知集群名。此时必须先从日志中解析出文件路径（关注 `file=` 关键字），CLI 会自动反查集群。
- 日志中的 `BP-xxx:blk_xxx` 是 Block Pool ID 和 Block ID，不需要用它们查集群，用 **文件路径** 查询即可。
- 文件路径可能非常长，提取时注意完整性，不要截断。

## 原子化命令（按需使用）

场景化命令 `miss-block` 已封装了完整流程；如需单独调用某一步 API，使用原子化命令：

```bash
# 查询文件所属集群
do-bigdata hdfs file-location --path <文件路径> --query "<用户问题>"

# 获取文件丢块诊断报告（需要已知集群名）
do-bigdata hdfs missing-block --cluster <集群名> --path <文件路径> --query "<用户问题>"
```

> [WARN] **铁律**：严禁通过 `curl`、`web_fetch`、`urllib.request` 等方式直接请求 `http://do-mcp.server.woa.com:8080/api/hdfs/...`。所有数据获取必须通过 `do-bigdata` CLI 命令完成，否则认证将失效。

## 参考文档

```bash
# 列出本 Skill 的所有参考文档
do-bigdata docs list --skill hdfs-miss-block-diagnose

# 查看丢块诊断指南（原因分类、fsck 输出解读、监控分析、诊断用例）
do-bigdata docs show --skill hdfs-miss-block-diagnose --file hdfs_miss_block_guide.md
```

当需要深入分析丢块原因时，通过上述命令读取参考文档获取诊断思路。

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
