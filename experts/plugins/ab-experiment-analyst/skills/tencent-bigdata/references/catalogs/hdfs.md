# HDFS 子系统 Skill 明细

> [WARN] **使用本 catalog 内任何子 skill 前，必须先读取该子 skill 的 `SKILL.md`**
>
> 本文档仅用于 **路由发现**：根据触发场景 / 关键词定位到目标子 skill 后，**必须再加载** `sub-skills/<子系统>/<skill-name>/SKILL.md`，了解完整的执行步骤、参数约束、两阶段流程与边界条件，再调用 CLI 命令或脚本。
>
> [FAIL] 严禁仅凭本文档列出的命令清单直接执行；catalog 描述通常省略关键参数与前置依赖，跳读会导致执行路径不准确。

### hdfs-miss-block-diagnose

- **目录**: `HDFS/hdfs-miss-block-diagnose/`
- **触发场景**: 用户咨询 HDFS `BlockMissingException`、确认文件丢块是否恢复、排查读取失败（疑似丢块）。
- **触发关键词**: HDFS丢块、BlockMissingException、Could not obtain block、Block丢失、副本丢失、HDFS读取失败
- **包含资源**:
  - CLI 命令：`do-bigdata hdfs miss-block` — 丢块诊断
  - 参考文档：`do-bigdata docs show --skill hdfs-miss-block-diagnose --file hdfs_miss_block_guide.md`

---

### hdfs-cluster-load-diagnose

- **目录**: `HDFS/hdfs-cluster-load-diagnose/`
- **触发场景**: HDFS 集群负载问题，包括 DataNode Xceiver 连接数过高、NameNode RPC CallQueueLength 请求堆积、集群读写性能下降、负载不均。
- **触发关键词**: HDFS负载、Xceiver、连接数过高、DataNode负载、NameNode RPC、CallQueueLength、HDFS性能、读写慢、负载不均
- **包含资源**:
  - CLI 命令：`do-bigdata hdfs cluster-load` — 集群负载诊断
  - 参考文档：`do-bigdata docs show --skill hdfs-cluster-load-diagnose --file hdfs_cluster_load_guide.md`

---

### hdfs-storage-full-diagnose

- **目录**: `HDFS/hdfs-storage-full-diagnose/`
- **触发场景**: 用户遇到 `Could not get block locations` 或 `Unable to close file because the last` 报错，表示 HDFS 集群存储空间已满导致写入失败。包括 Hive/Spark 写入任务失败、写入中间结果失败等场景。
- **触发关键词**: Could not get block locations、Unable to close file、存储满、写入失败、Aborting
- **不触发场景**: `BlockMissingException` / `Could not obtain block`（丢块问题）→ hdfs-miss-block-diagnose
- **核心能力**:
  - 报错特征识别（区分存储满与丢块）
  - 路径解析与集群定位（调 API 查文件所属集群）
  - 存储使用率趋势查询（PercentUsed）
  - 结论与建议（告知集群名 + 重试建议）
- **包含资源**:
  - CLI 命令：`do-bigdata hdfs storage-full` — 存储满诊断
  - 参考文档：`do-bigdata docs show --skill hdfs-storage-full-diagnose --file hdfs_storage_full_guide.md`

---

### hdfs-basic-operations

- **目录**: `HDFS/hdfs-basic-operations/`
- **触发场景**: 用户需要执行 HDFS 基础操作（ls、du、stat、count、test 只读查询 + mkdir 创建目录 + put 文件上传），通过 CLI 调用 API 执行 HDFS 命令。
- **触发关键词**: ls、du、stat、count、test、mkdir、put、查看目录、列出文件、查看分区、目录大小、文件状态、路径是否存在、创建目录、上传文件
- **不触发场景**: 下载（get）、删除（rm）、查看文件内容（cat/tail）、移动（mv）、复制（cp）、修改权限（chmod/chown）等
- **核心能力**:
  - 支持 5 种只读 HDFS 查询操作（ls/du/stat/count/test）
  - 支持创建目录（mkdir -p 递归创建）
  - 支持文件上传（put，含覆盖保护 + 大小限制 1GB + 上传后自动 ls 验证）
  - 自动路径解析和集群名查询
  - 标准目录规范路径校验（客户端 + 服务端双重校验）
- **包含资源**:
  - CLI 命令：`do-bigdata hdfs ls/du/stat/count/test/mkdir/put` — HDFS 基础操作
  - 参考文档：`do-bigdata docs show --skill hdfs-basic-operations --file hdfs_basic_ops_guide.md`
