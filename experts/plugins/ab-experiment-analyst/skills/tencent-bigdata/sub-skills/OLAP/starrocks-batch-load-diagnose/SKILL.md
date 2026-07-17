---
name: starrocks-batch-load-diagnose
description: >
  诊断 StarRocks 集群批量（离线）导入作业的问题，覆盖 Broker Load（HDFS/S3/OSS/COS/OBS/GCS/Azure/MinIO）、
  Spark Load、INSERT 三种导入方式。重点处理 CANCELLED 失败（含 ETL_QUALITY_UNSATISFIED / TIMEOUT /
  LOAD_RUN_FAIL 等）、QUEUEING 堆积、LOADING 卡住三大核心场景，并给出参数优化 SQL 建议。
  即使用户没有明确提到 "Broker Load" 字样，只要涉及到 StarRocks 批量导入、离线写入、数据质量不合格、
  导入超时、导入取消、HDFS/S3/OSS/COS 导入、SHOW LOAD、max_filter_ratio 等场景，都应优先触发本 Skill。
  本 Skill 严格遵守只读原则，不执行任何 CANCEL LOAD / ALTER LOAD 等写操作，仅生成 SQL 文本供用户参考。
  触发关键词："Broker Load", "离线写入", "批量导入", "SHOW LOAD", "导入失败", "导入取消",
  "CANCELLED", "ETL_QUALITY_UNSATISFIED", "数据质量不合格", "max_filter_ratio", "TIMEOUT",
  "导入超时", "HDFS 导入", "S3 导入", "OSS 导入", "COS 导入", "INSERT 导入", "Spark Load",
  "脏数据", "dpp.abnorm", "QUEUEING", "LOADING 卡住"
---

## 概述

StarRocks 批量（离线）导入的生产问题主要集中在三类：

1. **CANCELLED 失败**（最高优先级）— `ErrorMsg.type` 会明确指出根因分类
2. **QUEUEING / PENDING 堆积** — 作业创建后迟迟不执行
3. **LOADING 卡住** — 开始导入但进度长时间不变

本 Skill 把这三类场景的诊断链路封装为一组**原子化只读命令**，由 AI 按需编排。

**核心能力**：

1. **作业列表与健康度摘要** — 一键列出指定库的批量导入作业，按状态/类型聚合
2. **作业详情深度解析** — 自动解析 `ErrorMsg`/`TaskInfo`/`EtlInfo`/`JobDetails` 等复合字段，高亮根因
3. **脏数据样本抓取** — 在集群网络可达时自动拉取 `URL` 字段指向的脏数据样本（`ETL_QUALITY_UNSATISFIED` 场景最关键）
4. **information_schema.loads 双轨查询** — 3.1+ 走 information_schema，老版本自动降级 SHOW LOAD
5. **参数调优 SQL 生成**（只生成不执行）— 按根因给出 `ALTER LOAD` / 重建 `LOAD LABEL` 的完整 SQL 文本

## [WARN] 只读原则（重要）

本 Skill 和对应的所有 CLI / API **严格只读**：

- [OK] 允许：`SHOW LOAD` / `SELECT FROM information_schema.loads` / HTTP GET 脏数据样本
- [FAIL] 禁止：自动执行 `CANCEL LOAD` / `ALTER LOAD` / `ADMIN SET FRONTEND CONFIG` 等任何写操作
- [OK] 允许：把建议的 `ALTER LOAD` / 重建 `LOAD LABEL` SQL 以**文本**形式返回给用户，由用户决定是否执行

如果用户明确要求"帮我取消这个作业"/"帮我改这个参数"，**必须拒绝自动执行**，只输出 SQL 文本并提醒用户自己登录 MySQL 客户端执行。

## 前置条件

- 已执行 `do-bigdata auth init` 配置 CMK 凭证
- 知道出问题的 StarRocks 集群名
- 建议知道库名（`--database`），否则只能查默认库
- 作业 **label** 是定位具体作业的最关键线索（label 有保留期，默认 3 天）

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

## 工作流

**重要原则**：下面的步骤是**一个原子命令池**，AI 应根据用户问题**按需选用**，而不是每次都从 Step 1 一路跑到 Step 5。**每一步执行后分析输出再决定下一步参数**。

### Step 1：定位问题作业（用户未指定 label 时）

**目的**：找到用户所说"有问题的导入作业"到底是哪一个。

**推荐**：**先用 information_schema.loads**（字段更全、时间过滤方便）；若返回 `Unknown table loads` 错误说明集群 < 3.1，自动降级到 `SHOW LOAD`。

```bash
# 方式 A：3.1+ 推荐（支持时间过滤和 SCAN_ROWS/FILTERED_ROWS 等丰富字段）
do-bigdata olap load-from-is --cluster <集群名称> --database <库名> \
    --state CANCELLED --hours 24 --query "<用户原始问题>"

# 方式 B：老版本兼容（或 from-is 报错时降级）
do-bigdata olap load-list --cluster <集群名称> --database <库名> \
    --state CANCELLED --limit 50 --query "<用户原始问题>"
```

**可选过滤**：
- `--state CANCELLED` 只看失败作业（最常用）
- `--state LOADING` 看正在跑的作业（诊断"卡住"问题）
- `--state QUEUEING` 看排队作业（诊断堆积问题）
- `--type BROKER/SPARK/INSERT` 按导入方式筛选
- `--label-like '%order%'` label 模糊匹配（SQL LIKE 语法）

**状态优先级**：CANCELLED（最高） > LOADING 卡住 > QUEUEING/PENDING 堆积 > 其他

如果用户已经给了 label，**跳过本步**直接 Step 2。

### Step 2：作业详情 — 核心一步

**目的**：拿到问题作业的完整 `ErrorMsg` / `TaskInfo` / `EtlInfo` / `JobDetails`。

```bash
do-bigdata olap load-detail \
    --cluster <集群名称> \
    --database <库名> \
    --label <作业 label> \
    --query "<用户原始问题>"
```

**输出解读要点**：

| 字段 | 看什么 |
|------|--------|
| `State` | 当前状态，决定下一步走哪个场景 |
| `ErrorMsg.type` | **CANCELLED 时就是根因分类**（对照 references 第三节） |
| `ErrorMsg.msg` | 根因的详细描述（对照 references 第四节关键词表） |
| `URL` | 脏数据样本地址；**非 NULL** 意味着有脏数据，Step 3 可拉 |
| `TaskInfo.timeout` | 作业超时配置（秒），`TIMEOUT` 场景必看 |
| `TaskInfo.max_filter_ratio` | 错误行容忍比例，`ETL_QUALITY_UNSATISFIED` 场景必看 |
| `EtlInfo.dpp.abnorm.ALL` | 被过滤掉的错误行数（数据质量问题必看） |
| `EtlInfo.dpp.norm.ALL` | 实际导入行数 |
| `EtlInfo.unselected.rows` | 被 WHERE 过滤的行数 |
| `JobDetails.FileNumber` / `FileSize` | 源数据量，`TIMEOUT` 场景判断是否超预期 |
| `JobDetails.Unfinished backends` | `LOADING` 卡住时看哪些 BE 没完成 |
| `CreateTime` / `LoadStartTime` / `LoadFinishTime` | 计算实际耗时，`TIMEOUT` 场景必用 |

### Step 3：分场景下钻（按 Step 2 的 ErrorMsg.type 分派）

#### 场景 A：`ErrorMsg.type = ETL_QUALITY_UNSATISFIED`（数据质量不合格）

**最典型**：错误行数比例超过 `max_filter_ratio`。

1. **拉脏数据样本**（服务端会试一把 HEAD 探活，不可达时降级给 URL 让用户手动 curl）：

   ```bash
   do-bigdata olap load-error \
       --cluster <集群名称> \
       --database <库名> \
       --label <作业 label> \
       --query "<用户原始问题>"
   ```

2. 分析脏数据样本的错误原因：列数不匹配 / 类型转换失败 / 空值规范等
3. 计算实际错误比例：`dpp.abnorm.ALL / (dpp.norm.ALL + dpp.abnorm.ALL + unselected.rows)`
4. 给用户建议：
   - 若错误比例可容忍：**生成重建作业的 SQL**，放宽 `max_filter_ratio`
   - 若不可容忍：修源端数据或调整 `COLUMNS` 映射

#### 场景 B：`ErrorMsg.type = TIMEOUT`（超时）

**[WARN] 强制联动 `starrocks-load-analysis`**（见 [[memory:ngecgtey]]）。

1. 从 Step 2 拿到 `CreateTime` / `LoadFinishTime`（若为 NULL 用 `CANCELLED` 的时间）
2. 计算实际耗时 vs `TaskInfo.timeout`
3. **联动 `starrocks-load-analysis` 查同时段的 BE 资源指标**：

   ```bash
   # BE CPU
   do-bigdata olap metric-data --cluster <集群名称> --metric <cpu 相关指标> \
       --start "<CreateTime - 10min>" --end "<FinishTime + 10min>" \
       --query "<用户原始问题>"

   # BE 内存
   do-bigdata olap metric-data --cluster <集群名称> --metric <memory 相关指标> \
       --start "<CreateTime - 10min>" --end "<FinishTime + 10min>" \
       --query "<用户原始问题>"

   # 磁盘 IO / Compaction 积压
   do-bigdata olap metric-data --cluster <集群名称> --metric <io 或 compaction 指标> \
       --start "<CreateTime - 10min>" --end "<FinishTime + 10min>" \
       --query "<用户原始问题>"
   ```

   > **注意**：指标名不要凭空猜，先用 `do-bigdata olap metric-search --keyword cpu/mem/compaction` 搜索再用。

4. 综合给结论：
   - **资源瓶颈型**：BE CPU/IO/内存确实打满 → 建议扩容 BE 或降低导入并发
   - **配置过小型**：BE 资源正常 → **生成重建 SQL 建议调大 `timeout`**
   - **数据量超预期型**：`FileSize` 远大于历史 → 分片或拆分子作业

#### 场景 C：`ErrorMsg.type = LOAD_RUN_FAIL`

1. 看 `ErrorMsg.msg` 关键词（references 第四节对照表）
2. 如 `be is not alive` / `memory limit exceeded` → 联动 `starrocks-cluster-ops` 的 `backends` 查 BE 状态
3. 如 `tablet ... not found` → 联动 `starrocks-schema-change` 看目标表是否有 DDL 变更
4. 如 `Fail to establish connection to HDFS` → 属外部存储连通性问题，**不要**继续下钻集群，提醒用户查外部环境

#### 场景 D：`ErrorMsg.type = ETL_SUBMIT_FAIL` / `ETL_RUN_FAIL`

- Broker Load 的 `ETL_SUBMIT_FAIL`：多为 Broker 连通性或配置错误
- Spark Load 的 `ETL_RUN_FAIL`：指引用户去 Spark Web UI 看 Application 日志（URL 字段通常是 Spark Application URL）
- INSERT 的 `ETL_RUN_FAIL`：SELECT 子句报错，看 `ErrorMsg.msg` 即可定位

#### 场景 E：State = `LOADING` 但长时间无进度（用户抱怨卡住）

1. 重点看 `JobDetails.Unfinished backends`，拿到未完成的 BE ID
2. 联动 `starrocks-cluster-ops` 的 `backends` 核对这些 BE 状态：

   ```bash
   do-bigdata olap backends --cluster <集群名称> --query "<用户原始问题>"
   ```

3. 联动 `starrocks-load-analysis` 看这些 BE 的 CPU/磁盘/Compaction 积压
4. 必要时查 `starrocks-be-crash-diagnose`：若某 BE `LastStartTime` 很近，可能崩过一次

#### 场景 F：State = `QUEUEING` / `PENDING` 堆积

1. `load-list --state QUEUEING` 或 `PENDING` 看堆积数量
2. 看 FE 配置 `max_broker_load_job_concurrency`（通过 `starrocks-cluster-ops` 的 `fe-config` 查）：

   ```bash
   do-bigdata olap fe-config --cluster <集群名称> --keyword max_broker_load \
       --query "<用户原始问题>"
   ```

3. 给用户建议：降低作业创建频率 或 **生成 `ADMIN SET FRONTEND CONFIG` 文本建议**（提醒用户需 Admin 权限）

### Step 4：整合输出诊断结论

按 `references/batch_load_guide.md` 第七节模板输出摘要。**涉及参数调整时，必须以完整 SQL 文本形式给出**，包含：
- 库名、原 label（或新 label）
- 调整后的参数值
- 清晰标注"此 SQL 需要您自行在 MySQL 客户端执行，本工具不会自动执行"

## 典型分析场景

### 场景 1：用户说"xx 集群的 Broker Load 失败了"

1. `load-from-is --cluster xxx --state CANCELLED --hours 24` → 拿到失败作业清单
2. 选最近/最典型的一个作业跑 `load-detail` 看 `ErrorMsg.type`
3. 根据 type 分派到场景 A/B/C/D
4. 按模板输出摘要

### 场景 2：用户给了一个 label 说"这个导入挂了帮我看看"

1. 直接 `load-detail --cluster xxx --database db --label xxx`
2. 按 State + ErrorMsg.type 分派
3. 按需 `load-error`（质量问题）或联动 load-analysis（超时）

### 场景 3：用户问"导入为什么这么慢"（还在 LOADING）

1. `load-detail` 看当前进度和 Unfinished backends
2. 跳转场景 E（LOADING 卡住）

### 场景 4：用户问"这种场景 max_filter_ratio 应该设多少"

- 不用跑命令，直接 `do-bigdata docs show --skill starrocks-batch-load-diagnose --file batch_load_guide.md` 给 references 参考

## Skill 联动关系

- **上游依赖**：无（本 Skill 自身入口就是 load-list / load-from-is）
- **横向联动**：
  - `starrocks-load-analysis`（**TIMEOUT 场景强制联动**，看 BE CPU/IO/内存/Compaction 指标）
  - `starrocks-cluster-ops`（看 BE 存活数、FE 配置 `max_broker_load_job_concurrency` 等）
  - `starrocks-schema-change`（`tablet not found` 时看目标表 DDL 变更）
  - `starrocks-be-crash-diagnose`（LOADING 场景某 BE 异常时可联动）

## 参考文档

```bash
do-bigdata docs list --skill starrocks-batch-load-diagnose
do-bigdata docs show --skill starrocks-batch-load-diagnose --file batch_load_guide.md
```

- `batch_load_guide.md` — 三种导入方式差异、`ErrorMsg.type` 分类与根因对照表、`ErrorMsg.msg` 关键词速查、外部存储 URL 前缀速查、参数调优建议与 SQL 文本模板、诊断结论模板、局限性说明。

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
