---
name: hdfs-storage-full-diagnose
description: 当用户咨询或提供的任务报错日志抛出 java.io.IOException Could not get block locations 或 java.io.IOException Unable to close file because the last 时使用此 skill。该异常表示 HDFS 集群存储空间已满，导致数据写入失败。通过 do-bigdata CLI 解析文件路径定位所属集群，查询存储使用率趋势，告知用户是哪个集群存储满导致部分数据写入失败，平台正在处理或已处理，任务直接重试即可。
---

## 概述

诊断 HDFS 集群存储空间已满（`Could not get block locations` 或 `Unable to close file because the last`）导致写入失败的问题。通过 `do-bigdata` CLI 工具调用 do_mcp API 服务，先定位文件所属集群，然后查询集群存储使用率趋势，告知用户根因并给出重试建议。

## [WARN] 场景判断（必读）

本 Skill 处理的是**集群存储满**问题，请根据报错关键字准确判断：

| 报错关键字 | 问题类型 | 本质原因 | 对应 Skill |
|-----------|---------|---------|-----------|
| `Could not get block locations` | **集群存储满** | 集群满了，想创建新 Block 但创建不出来，**写入失败** | 本 Skill（hdfs-storage-full-diagnose） |
| `Unable to close file because the last` | **集群存储满** | 集群满了，文件写入过程中无法完成关闭（Block 副本不足），**写入失败** | 本 Skill（hdfs-storage-full-diagnose） |
| `BlockMissingException` / `Could not obtain block` | **丢块** | 数据已经存储在集群上了，但 Block 丢失了，**读取失败** | hdfs-miss-block-diagnose |

- 集群存储满 = 新数据写不进去（Block 建不出来）
- 丢块 = 已有数据丢了读不出来（Block 已存在但丢失了）

**关键报错特征**：
- `java.io.IOException: Could not get block locations. Source file "..." - Aborting...`
- `java.io.IOException: Unable to close file because the last block ... does not have enough number of replicas.`
- 根因是 HDFS 集群存储空间已满（所有 DataNode 磁盘使用率达到上限），NameNode 无法为新写入分配 Block

**适用场景**：
- 用户遇到 `java.io.IOException: Could not get block locations`
- 用户遇到 `java.io.IOException: Unable to close file because the last`
- Hive/Spark 写入任务失败，报错 `Could not get block locations ... Aborting`
- Hive/Spark 写入任务失败，报错 `Unable to close file because the last block`
- 用户遇到写入 HDFS 失败但读取正常的情况
- 计算任务写入中间结果（staging 目录、_temporary 目录）失败

**核心诊断能力**：

1. **报错特征识别** — 识别 `Could not get block locations` 或 `Unable to close file because the last` 的典型存储满特征
2. **路径解析与集群定位** — 从异常日志中提取 HDFS 文件路径，由 CLI 自动查询文件所属集群（支持截取表级别路径重试）
3. **存储使用率趋势查询** — CLI 查询集群 PercentUsed 使用率趋势，判断平台是否正在执行清理操作
4. **结论与建议** — 告知用户是哪个集群存储满导致写入失败，结合使用率趋势给出精准建议

## 前置条件

- 已知报错日志中包含 `Could not get block locations` 或 `Unable to close file because the last`，以及 HDFS 文件路径信息
- 已安装 `do-bigdata` CLI 工具
- 已执行 `do-bigdata auth init` 完成凭证配置

## 工作流

当用户提供的报错日志包含 `Could not get block locations` 或 `Unable to close file because the last` 时，按以下步骤执行：

### 第 1 步：识别报错特征并提取文件路径

**报错特征识别**：

确认日志中包含以下关键特征之一：
1. `java.io.IOException: Could not get block locations`，日志中 `Source file "..."` 引号内为写入失败的 HDFS 文件路径
2. `java.io.IOException: Unable to close file because the last block`，需要从日志上下文中提取正在写入的 HDFS 文件路径

**典型报错日志示例**：

```
Caused by: java.io.IOException: Could not get block locations. Source file "/user/tdw/warehouse/sz1_mvideo.db/t_sd_mvideo_profile_interest_aggmix2/.hive-staging_hive_2026-01-04_09-15-34_879_2088087324657590595-1/-ext-10000/_temporary/0/_temporary/attempt_202601040953417391802688068430289_0019_m_000863_26487/bucket=12/part-00863-813c33cc-a7b8-454f-bdb5-8c6f90c53b3f.c000.gz" - Aborting...
```

**提取要点**：
- 对于 `Could not get block locations` 报错：从 `Source file "..."` 中提取完整的 HDFS 文件路径
- 对于 `Unable to close file` 报错：从日志上下文中提取正在写入的 HDFS 文件路径
- 路径可能很长（包含 staging 目录、_temporary 目录、partition 目录等），注意完整提取
- 若路径包含 `hdfs://cluster-name/...` 格式，CLI 会自动从 schema 提取集群名

**路径提取技巧**：
- 写入失败的路径通常包含 `.hive-staging` 或 `_temporary` 等临时目录
- `do-bigdata hdfs storage-full` 命令支持直接传入完整报错日志（CLI 内部会自动抽取 `Source file "..."` 内的路径），也支持直接传入路径

### 第 2 步：执行存储满诊断（一条命令完成）

直接调用 CLI 命令，CLI 会自动完成：识别报错 → 提取路径 → 查询集群（自动截取表级路径重试）→ 查询使用率趋势 → 输出诊断结论：

```bash
# 方式 1：传入完整报错日志片段（CLI 自动抽取 Source file "..." 内的路径）
do-bigdata hdfs storage-full \
  --path 'Could not get block locations. Source file "/user/tdw/warehouse/sz1_mvideo.db/.../part-00000.gz" - Aborting...' \
  --query "<用户原始问题>"

# 方式 2：直接传入 HDFS 路径
do-bigdata hdfs storage-full --path <HDFS路径> --query "<用户原始问题>"

# 方式 3：已知集群名，显式指定
do-bigdata hdfs storage-full --path <路径> --cluster <集群名> --query "<用户原始问题>"

# 方式 4：路径含 hdfs:// schema（CLI 自动提取集群名）
do-bigdata hdfs storage-full --path hdfs://<集群>/<路径> --query "<用户原始问题>"
```

**参数说明**：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--path` / `-p` | HDFS 文件路径或包含 `Source file "..."` 的报错日志片段（必选） | — |
| `--cluster` / `-c` | HDFS 集群名（可选，不提供则自动查询） | — |
| `--query` / `-q` | 用户原始问题（由 AI Agent 自动传入） | — |
| `--output` / `-o` | 输出格式：`text`（默认） / `json` | `text` |

**命令输出**：CLI 输出的诊断报告包含：
- 报错类型、所属集群、写入失败的文件路径
- 存储使用率汇总（平均/最高/最低使用率、趋势方向）
- 使用率趋势采样点（5 分钟粒度）
- 诊断结论、原因分析、处理建议

### 第 3 步：结合使用率趋势给出结论

CLI 输出已包含结论模板，AI 按以下逻辑补充措辞：

- **trend_direction = decreasing（下降中）**：平台正在执行清理操作，建议稍等片刻后直接重试任务
- **trend_direction = increasing（上升中）**：清理可能尚未开始或数据写入速度超过清理速度，建议联系 HDFS 运维 [axljiang、donnychen、colinhhfan] 确认处理进度
- **trend_direction = stable（平稳）**：可能清理量较小或刚开始处理，建议稍等后重试，若仍失败请联系 HDFS 运维确认

**注意**：如果使用率查询失败（如集群名无监控数据），CLI 会输出警告但继续给出存储满结论；此时直接按固定结论模板告知用户"集群存储满，平台正在处理，任务直接重试"即可。

**诊断报告格式**（AI 基于 CLI 输出整理）：

```
## HDFS 集群存储满诊断报告

### 基础信息
- 报错类型: java.io.IOException: Could not get block locations / Unable to close file because the last
- 写入失败文件: {file_path}
- 所属集群: {cluster_name}

### 存储使用率
- 当前使用率: {avg_percent_used}%
- 最高使用率: {max_percent_used}%
- 最低使用率: {min_percent_used}%
- 趋势方向: {trend_direction}（下降中=正在清理 / 上升中=持续增长 / 平稳=无明显变化）

### 诊断结论
{cluster_name} 集群存储空间已满，导致部分数据写入失败。平台已关注到该问题并正在处理（或已处理完成）。

### 原因分析
该报错（`Could not get block locations` 或 `Unable to close file because the last`）表示：
1. HDFS 集群 {cluster_name} 的存储空间已达到上限
2. NameNode 无法为新的数据写入分配 Block
3. 因此写入操作失败并抛出 IOException

### 影响范围
- 集群内所有新数据写入操作均会受到影响
- 已有数据的读取不受影响
- 写入到临时目录（staging/_temporary）的任务中间结果会失败

### 处理建议
1. **直接重试任务** — 平台已关注并处理集群存储满的问题（清理过期数据/扩容），任务直接重试即可
2. **若重试仍失败** — 说明存储空间尚未释放完毕，可稍等片刻后再次重试
3. **若持续失败** — 联系 HDFS 运维 [axljiang、donnychen、colinhhfan] 确认集群存储清理进度
```

## 执行流程举例

### 示例 1：用户贴了 Hive/Spark 写入失败的报错日志

**用户输入**：

```
Caused by: java.io.IOException: Could not get block locations. Source file "/user/tdw/warehouse/sz1_mvideo.db/t_sd_mvideo_profile_interest_aggmix2/.hive-staging_hive_2026-01-04_09-15-34_879_2088087324657590595-1/-ext-10000/_temporary/0/_temporary/attempt_202601040953417391802688068430289_0019_m_000863_26487/bucket=12/part-00863-813c33cc-a7b8-454f-bdb5-8c6f90c53b3f.c000.gz" - Aborting...
```

**执行流程**：

1. **识别报错特征**：日志包含 `Could not get block locations`，确认为 HDFS 集群存储满问题。

2. **一条命令完成诊断**（直接把整段日志作为 `--path` 传入，CLI 自动抽取 `Source file "..."` 内的路径）：
   ```bash
   do-bigdata hdfs storage-full \
     --path 'Caused by: java.io.IOException: Could not get block locations. Source file "/user/tdw/warehouse/sz1_mvideo.db/.../part-00863....c000.gz" - Aborting...' \
     --query "任务报错 Could not get block locations 帮我看看哪个集群存储满了"
   ```

3. **CLI 自动完成**：截取表级别路径 `/user/tdw/warehouse/sz1_mvideo.db/t_sd_mvideo_profile_interest_aggmix2` 反查集群 → 查询使用率趋势 → 输出诊断结论。

4. **整理结论输出给用户**（告知具体集群名 + 平台正在处理 + 建议重试）。

### 示例 2：用户提供了包含 hdfs schema 的路径

**用户输入**：

```
Could not get block locations. Source file "hdfs://ss-pcg-13-v3/user/tdw/warehouse/mydb.db/mytable/_temporary/part-00000.gz" - Aborting...
```

**执行流程**：

1. **识别报错特征**：确认为存储满报错。

2. **执行 CLI 命令**：
   ```bash
   do-bigdata hdfs storage-full \
     --path 'Could not get block locations. Source file "hdfs://ss-pcg-13-v3/user/tdw/warehouse/mydb.db/mytable/_temporary/part-00000.gz" - Aborting...' \
     --query "集群存储满了吗？"
   ```

3. **CLI 自动完成**：抽取路径 + 从 `hdfs://` schema 识别集群名 `ss-pcg-13-v3` + 查询存储使用率。

### 示例 3：用户描述写入失败但未贴完整日志

**用户输入**：

```
我的任务写入 /user/tdw/warehouse/mydb.db/mytable 失败了，报错 Could not get block locations
```

**执行流程**：

```bash
do-bigdata hdfs storage-full \
  --path /user/tdw/warehouse/mydb.db/mytable \
  --query "我的任务写入 /user/tdw/warehouse/mydb.db/mytable 失败了，报错 Could not get block locations"
```

### 示例 4：用户报错 Unable to close file（存储满的另一种表现）

**用户输入**：

```
Caused by: java.io.IOException: Unable to close file because the last block BP-1234567890-10.0.0.1-1609459200000 does not have enough number of replicas.
```

**执行流程**：

1. **识别报错特征**：`Unable to close file because the last block`，确认为 HDFS 集群存储满问题（Block 副本不足是因为没有可用的 DataNode 存储空间）。

2. **提取路径**：从日志上下文中提取正在写入的 HDFS 文件路径（该报错本身可能不含路径，需要结合用户提供的上下文）。

3. **执行 CLI 命令**：
   ```bash
   do-bigdata hdfs storage-full --path <从上下文提取的路径> --query "<用户原始问题>"
   ```

4. **根据 CLI 输出给出结论**：集群存储满，结合使用率趋势给出是否正在清理的判断。

### 关键提示

- **报错特征是关键**：`Could not get block locations` 和 `Unable to close file because the last` 都是 HDFS 存储满的典型标志，只要日志中出现其中之一就可以确认是存储满问题
- **路径提取注意**：写入失败的路径通常包含 `.hive-staging`、`_temporary`、`attempt_xxx` 等临时目录；CLI 会自动尝试截取到库表级别反查集群
- **结论模板固定**：存储满问题的结论和建议是固定的 — 告知用户是哪个集群存储满，平台正在处理，直接重试即可

## 原子化命令（按需使用）

场景化命令 `storage-full` 已封装了完整流程；如需单独调用某一步 API，使用原子化命令：

```bash
# 查询文件所属集群
do-bigdata hdfs file-location --path <文件路径> --query "<用户问题>"

# 查询集群存储使用率趋势
do-bigdata hdfs cluster-storage --cluster <集群名> --query "<用户问题>"
```

> [WARN] **铁律**：严禁通过 `curl`、`web_fetch`、`urllib.request` 等方式直接请求 `http://do-mcp.server.woa.com:8080/api/hdfs/...`。所有数据获取必须通过 `do-bigdata` CLI 命令完成，否则认证将失效。

## 参考文档

```bash
# 列出本 Skill 的所有参考文档
do-bigdata docs list --skill hdfs-storage-full-diagnose

# 查看存储满诊断指南（报错特征、典型用例、处理方案）
do-bigdata docs show --skill hdfs-storage-full-diagnose --file hdfs_storage_full_guide.md
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
