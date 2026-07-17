---
name: hdfs
description: HDFS 相关技能的入口。当问题提到 HDFS、丢块（BlockMissingException）、集群存储满（Could not get block locations / Unable to close file because the last）、存储集群负载、DataNode、NameNode、目录列表（ls）、路径统计（count）、创建目录（mkdir）、上传文件（put）等 HDFS 相关问题时，使用此技能了解可用的子技能列表并路由到合适的技能。
---

# HDFS Skills 总览

> 本文档汇总 `sub-skills/HDFS` 目录下所有 HDFS 相关 Skills，方便快速浏览和查找。所有 Skill 均已 CLI 化，统一通过 `do-bigdata hdfs <command>` 调用。

## [WARN] 丢块 vs 集群存储满 场景判断

| 报错关键字 | 问题类型 | 本质原因 | 对应 Skill |
|-----------|---------|---------|-----------|
| `BlockMissingException` / `Could not obtain block` | **丢块** | 数据已经存储在集群上了，但 Block 丢失了，**读取失败** | `hdfs-miss-block-diagnose` |
| `Could not get block locations` | **集群存储满** | 集群满了，想创建新 Block 但创建不出来，**写入失败** | `hdfs-storage-full-diagnose` |

## 目录

| # | Skill 名称 | 目录 | 简介 |
|---|-----------|------|------|
| 1 | [HDFS 丢块诊断](#1-hdfs-miss-block-diagnose--hdfs-丢块诊断) | `hdfs-miss-block-diagnose/` | 诊断 HDFS BlockMissingException，通过 CLI 调用 API 查询文件所属集群和丢块状态，定位丢块是否恢复，分析原因并提供修复建议 |
| 2 | [HDFS 集群负载诊断](#2-hdfs-cluster-load-diagnose--hdfs-集群负载诊断) | `hdfs-cluster-load-diagnose/` | 诊断 HDFS 集群负载问题，从 DataNode（Xceiver 连接数）和 NameNode（RPC CallQueueLength 请求负载）两个维度分析集群瓶颈，获取集群状态和监控指标进行分析 |
| 3 | [HDFS 集群存储满诊断](#3-hdfs-storage-full-diagnose--hdfs-集群存储满诊断) | `hdfs-storage-full-diagnose/` | 诊断 HDFS 集群存储空间已满（Could not get block locations / Unable to close file because the last）导致写入失败的问题，定位所属集群并告知用户重试 |
| 4 | [HDFS 基础操作](#4-hdfs-basic-operations--hdfs-基础操作) | `hdfs-basic-operations/` | 执行 HDFS 基础操作（ls、du、stat、count、test 只读查询 + mkdir 创建目录 + put 文件上传），通过 CLI 自动解析路径和查询集群，底层使用 tdwdfsclient 的 hadoop 命令执行 |

## 全局限流规则

- 所有 HDFS 能力通过 `do-bigdata hdfs` 命令调用，**严禁通过 `curl`、`web_fetch`、`urllib.request` 等方式直接请求 `http://do-mcp.server.woa.com:8080/api/hdfs/...` 的 API**（会绕过认证）
- `hdfs-basic-operations` 下的 HDFS 读写操作需要先执行 `do-bigdata auth init` 完成 CMK 凭证配置
- 诊断类 Skill（miss-block / cluster-load / storage-full）均需携带 `--query "用户原始问题"` 参数

---

## 1. hdfs-miss-block-diagnose — HDFS 丢块诊断

**适用场景**：用户咨询或抛出 HDFS `BlockMissingException` 失败原因，需要定位丢块是否已恢复、分析丢块产生的原因。

### 核心能力

| 能力 | 说明 |
|------|------|
| 路径解析与集群定位 | 从异常日志或用户输入中提取 HDFS 路径，由 CLI 自动查询文件所属集群 |
| 丢块诊断报告获取 | CLI 调用丢块诊断接口获取文件的 Block 分布和健康状态 |
| 丢块恢复判断 | 根据诊断报告判断丢块是否已恢复或仍然存在 |
| 根因分析与修复建议 | 结合诊断数据和参考文档分析丢块原因，给出修复建议 |

### API 接口（CLI 内部调用）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/hdfs/get_file_location_info` | GET | 查询文件所属 HDFS 集群名（集群名未知时使用） |
| `/api/hdfs/get_missing_block_info` | GET | 获取指定集群指定文件的丢块诊断报告 |

### 常用命令

```bash
# 一键完成丢块诊断（自动查询文件所属集群）
do-bigdata hdfs miss-block --path /user/tdw/warehouse/db.db/table/part-00000 --query "<用户原始问题>"

# 指定集群名
do-bigdata hdfs miss-block --path /data/part-00000 --cluster ss-pcg-13-v3 --query "<用户原始问题>"

# 路径带 hdfs:// schema（CLI 自动提取集群名）
do-bigdata hdfs miss-block --path hdfs://ss-pcg-13-v3/data/part-00000 --query "<用户原始问题>"

# 原子化：只查询文件所属集群
do-bigdata hdfs file-location --path /data/part-00000 --query "<用户原始问题>"

# 原子化：只获取丢块诊断报告（需已知集群名）
do-bigdata hdfs missing-block --cluster ss-pcg-13-v3 --path /data/part-00000 --query "<用户原始问题>"
```

### 资源文件

```bash
do-bigdata docs list --skill hdfs-miss-block-diagnose
do-bigdata docs show --skill hdfs-miss-block-diagnose --file hdfs_miss_block_guide.md
```

---

## 2. hdfs-cluster-load-diagnose — HDFS 集群负载诊断

**适用场景**：用户咨询 HDFS 集群负载问题，包括 DataNode Xceiver 连接数过高、NameNode RPC CallQueueLength 请求堆积、读写性能下降、DataNode 负载不均等。优先从用户问题中提取时间范围查询指定时段负载数据（同时包含 DataNode 和 NameNode 两个维度）；未指定时间时回退查询最近 30 分钟数据。

### 核心能力

| 能力 | 说明 |
|------|------|
| 集群定位 | 从用户输入获取集群名，或通过文件路径由 CLI 自动查询所属集群 |
| 时间范围提取 | 从用户问题中识别时间信息，以 `YYYY-MM-DD HH:MM:SS` 格式传入 CLI |
| DataNode Xceiver 负载获取 | CLI 优先按时间范围查询，无时间时回退查询最近 30 分钟 |
| NameNode RPC 负载获取 | 同一接口同时返回 NameNode CallQueueLength 请求堆积情况（6400 为上限阈值） |
| 瓶颈判断 | CLI 从 DataNode（Xceiver）和 NameNode（CallQueueLength）两个维度判断集群负载状况 |
| 优化建议 | 结合参考文档给出针对性优化方案 |

### API 接口（CLI 内部调用）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/hdfs/get_file_location_info` | GET | 查询文件所属集群（集群名未知时使用） |
| `/api/hdfs/get_cluster_load_info_by_time` | GET | 获取集群指定时段 DataNode Xceiver + NameNode CallQueueLength 负载（优先使用，时间范围不超过 24 小时） |
| `/api/hdfs/get_cluster_load_info` | GET | 获取集群最近 30 分钟 DataNode Xceiver + NameNode CallQueueLength 负载（未指定时间时回退使用） |

### 常用命令

```bash
# 指定时间范围查询（推荐）
do-bigdata hdfs cluster-load --cluster ss-pcg-13-v3 --start "2026-03-11 08:00:00" --end "2026-03-11 09:00:00" --query "<用户原始问题>"

# 未指定时间，默认查询最近 30 分钟
do-bigdata hdfs cluster-load --cluster ss-pcg-13-v3 --query "<用户原始问题>"

# 通过文件路径反查集群 + 时间范围
do-bigdata hdfs cluster-load --path /user/tdw/warehouse/db.db/table/part-00000 --start "2026-03-11 08:00:00" --end "2026-03-11 09:00:00" --query "<用户原始问题>"

# 原子化：只获取最近 30 分钟负载
do-bigdata hdfs get-cluster-load-info --cluster ss-pcg-13-v3 --query "<用户原始问题>"

# 原子化：按时间范围获取负载
do-bigdata hdfs get-cluster-load-info-by-time --cluster ss-pcg-13-v3 --start "2026-03-11 08:00:00" --end "2026-03-11 09:00:00" --query "<用户原始问题>"
```

### 资源文件

```bash
do-bigdata docs list --skill hdfs-cluster-load-diagnose
do-bigdata docs show --skill hdfs-cluster-load-diagnose --file hdfs_cluster_load_guide.md
```

---

## 3. hdfs-storage-full-diagnose — HDFS 集群存储满诊断

**适用场景**：用户任务报错 `java.io.IOException: Could not get block locations` 或 `java.io.IOException: Unable to close file because the last`，表示 HDFS 集群存储空间已满导致写入失败。定位所属集群，告知用户是哪个集群存储满、平台正在处理，任务直接重试即可。

### 核心能力

| 能力 | 说明 |
|------|------|
| 报错特征识别 | CLI 识别 `Could not get block locations` / `Unable to close file` 的存储满特征 |
| 路径解析与集群定位 | 从报错日志 `Source file "..."` 中自动提取 HDFS 路径，CLI 自动查询文件所属集群（支持截取表级别路径重试） |
| 存储使用率趋势查询 | CLI 查询集群 PercentUsed 趋势，判断平台是否正在执行清理 |
| 结论与建议 | 告知用户哪个集群存储满，结合趋势给出精准建议 |

### API 接口（CLI 内部调用）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/hdfs/get_file_location_info` | GET | 查询文件所属 HDFS 集群名（集群名未知时使用） |
| `/api/hdfs/get_cluster_storage_usage` | GET | 查询集群存储使用率趋势 |

### 常用命令

```bash
# 一键诊断（直接传入完整报错日志片段，CLI 自动抽取路径）
do-bigdata hdfs storage-full --path 'Could not get block locations. Source file "/user/tdw/warehouse/db.db/table/part-00000.gz" - Aborting...' --query "<用户原始问题>"

# 直接传入 HDFS 路径
do-bigdata hdfs storage-full --path /user/tdw/warehouse/db.db/table/part-00000 --query "<用户原始问题>"

# 指定集群名
do-bigdata hdfs storage-full --path /data/part-00000 --cluster ss-pcg-13-v3 --query "<用户原始问题>"

# 原子化：只查询集群存储使用率趋势
do-bigdata hdfs cluster-storage --cluster ss-pcg-13-v3 --query "<用户原始问题>"
```

### 资源文件

```bash
do-bigdata docs list --skill hdfs-storage-full-diagnose
do-bigdata docs show --skill hdfs-storage-full-diagnose --file hdfs_storage_full_guide.md
```

---

## 4. hdfs-basic-operations — HDFS 基础操作

**适用场景**：用户需要执行 HDFS 基础操作，包括 ls、du、stat、count、test 只读查询，以及 mkdir（创建目录）和 put（文件上传）写操作。当用户提到"看看目录下有什么"、"目录占多大空间"、"有多少文件"、"路径是否存在"、"上传文件到 HDFS"、"创建目录"等需求，或提到 `hdfs dfs -ls`、`-du`、`-stat`、`-count`、`-test`、`-mkdir`、`-put` 等命令时使用。**不包含下载get、删除rm、cat、tail、touchz、mv、cp、chmod、chown 等操作**（按 skill 定义拒绝）。

**底层执行机制**：skill 识别用户问题 → 调用 `do-bigdata hdfs <op>` 命令 → CLI 内部注入 user/cmk 鉴权后调用 do_mcp API → service 层通过 subprocess 执行 tdwdfsclient 的 hadoop 命令（使用 TQ_USER_NAME / TQ_USER_TOKEN 环境变量鉴权）→ 返回执行结果和等效命令。

### 核心能力

| 能力 | 说明 | CLI 命令 |
|------|------|---------|
| user + cmk 鉴权 | 由 CLI 的 `@auth_required` 从加密凭证文件自动注入，API 层转为 `TQ_USER_NAME`/`TQ_USER_TOKEN` 环境变量 | 所有命令 |
| 路径解析与集群定位 | 支持 `hdfs://` 自动提取集群名，也支持调用 API 反查集群 | 所有命令 |
| 标准目录规范校验 | 客户端 + 服务端双重校验，非标准路径直接拒绝 | 所有命令 |
| 列目录（ls） | 调用 `/api/hdfs/ls` | `do-bigdata hdfs ls` |
| 空间使用（du） | 调用 `/api/hdfs/du` 查看目录/文件磁盘空间使用（-du -h） | `do-bigdata hdfs du` |
| 状态信息（stat） | 调用 `/api/hdfs/stat`（支持 `--fmt`） | `do-bigdata hdfs stat` |
| 路径统计（count） | 调用 `/api/hdfs/count` 统计路径的目录数、文件数和总字节数 | `do-bigdata hdfs count` |
| 路径检测（test） | 调用 `/api/hdfs/test` 检测路径是否存在 | `do-bigdata hdfs test` |
| 创建目录（mkdir） | 调用 `/api/hdfs/mkdir` 递归创建目录（-mkdir -p） | `do-bigdata hdfs mkdir` |
| 文件上传（put） | 调用 `POST /api/hdfs/put`，覆盖保护 + 大小限制（1GB）+ 上传后自动 ls 验证 | `do-bigdata hdfs put` |

### API 接口（CLI 内部调用）

所有操作接口均需 user + cmk 鉴权（CLI 自动注入，不需要用户在命令行显式传入）：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/hdfs/get_file_location_info` | GET | 查询文件所属集群（集群名未知时使用） |
| `/api/hdfs/ls` | GET | 列出目录内容 |
| `/api/hdfs/du` | GET | 查看磁盘空间使用（-du -h） |
| `/api/hdfs/stat` | GET | 查看文件/目录状态（`fmt` 可选） |
| `/api/hdfs/count` | GET | 统计路径信息 |
| `/api/hdfs/test` | GET | 检测路径是否存在 |
| `/api/hdfs/mkdir` | GET | 递归创建目录（-mkdir -p） |
| `/api/hdfs/put` | POST | 上传文件到 HDFS（multipart/form-data） |

### 常用命令

```bash
# 配置 CMK 凭证（首次使用前必须执行）
do-bigdata auth init                        # 交互式
do-bigdata auth init --from-json '{"id":...,"subject":"xxx","key":"xxx",...}'

# 列出目录内容
do-bigdata hdfs ls --path hdfs://ss-pcg-13-v3/stage/interface/TEG/mygroup/ --query "<用户问题>"

# 查看磁盘空间使用
do-bigdata hdfs du --path hdfs://ss-pcg-13-v3/stage/interface/TEG/mygroup/ --query "<用户问题>"

# 查看文件状态
do-bigdata hdfs stat --path hdfs://ss-pcg-13-v3/stage/interface/TEG/mygroup/file.txt --query "<用户问题>"

# 统计路径信息
do-bigdata hdfs count --path hdfs://ss-pcg-13-v3/stage/interface/TEG/mygroup/mydb.db/ --query "<用户问题>"

# 检测路径是否存在
do-bigdata hdfs test --path hdfs://ss-pcg-13-v3/stage/interface/TEG/mygroup/ --query "<用户问题>"

# 不带 hdfs:// schema（CLI 自动查询集群）
do-bigdata hdfs ls --path /stage/interface/TEG/mygroup/ --query "<用户问题>"

# 手动指定集群名
do-bigdata hdfs ls --path /stage/interface/TEG/mygroup/ --cluster ss-pcg-13-v3 --query "<用户问题>"

# 上传文件到 HDFS
do-bigdata hdfs put --local /path/to/local/data.csv --path hdfs://ss-pcg-13-v3/stage/interface/TEG/mygroup/data.csv --query "<用户问题>"

# 创建目录（递归）
do-bigdata hdfs mkdir --path hdfs://ss-pcg-13-v3/stage/interface/TEG/mygroup/new_dir --query "<用户问题>"
```

### 资源文件

```bash
do-bigdata docs list --skill hdfs-basic-operations
do-bigdata docs show --skill hdfs-basic-operations --file hdfs_basic_ops_guide.md
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
