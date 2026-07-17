---
name: hdfs-basic-operations
description: 当用户需要执行 HDFS 基础操作时使用此 skill，包括查看目录内容（ls）、路径统计（count）、磁盘空间（du）、文件状态（stat）、路径检测（test）、文件上传（put），通过 do-bigdata CLI 调用 do_mcp API 服务执行 HDFS 命令，每个操作对应独立的 CLI 子命令。
---

## 概述

执行 HDFS 基础操作。通过 `do-bigdata` CLI 工具调用 do_mcp API 服务的 HDFS 独立接口，支持 `ls`、`du`、`stat`、`count`、`test` 共 5 种只读查询操作，以及 `put` 文件上传操作（[WARN] 写操作）。自动处理路径解析和集群名查询。**所有接口均需 user + cmk 鉴权参数，由 CLI 的 `@auth_required` 装饰器从本机加密凭证文件自动注入，命令内无需感知。**

## 适用场景

- 用户想查看某个 HDFS 目录下有哪些文件或子目录（分区列表等）
- 用户想查看目录/文件的磁盘空间使用情况
- 用户想统计某个 HDFS 路径的目录数、文件数、存储大小
- 用户想检测某个路径是否存在
- 用户想查看文件/目录的状态信息
- 用户提到 `hdfs dfs -ls`、`-du`、`-stat`、`-count`、`-test` 等基础查询命令
- 用户需要上传文件到 HDFS（`put` / `copyFromLocal`）
- 用户需要创建 HDFS 目录（`mkdir`）

**不适用场景（不支持的写操作 / 直接数据查询等）**：
- 文件下载（get / copyToLocal）
- 文件/目录删除（rm / rmdir）
- 创建空文件（touchz）
- 移动/重命名（mv）或复制（cp）
- 修改权限（chmod）或修改所有者（chown）
- 查看文件内容（cat）— 直接读取文件数据，存在安全和性能风险，不通过本 Skill 执行
- 查看文件末尾（tail）— 同上

**当用户需要执行上述不支持的写操作时，必须按以下方式引导用户**（直接输出，不调用任何命令）：

> 本 Skill 目前支持 HDFS **只读元数据查询**（ls、du、stat、count、test）、**文件上传**（put）和**创建目录**（mkdir），暂不支持下载get、删除rm、cat、tail、mv、cp、chmod、chown 等操作。
>
> 如需执行其他 HDFS 操作，请按以下步骤操作：
>
> 1. **安装 IDC 环境 HDFS 客户端**：参考 [HDFS 客户端安装指引](https://iwiki.woa.com/p/4020371171?from=recent_view) 在 IDC 环境安装 hadoop 客户端；
> 2. **查看和申请 HDFS 权限**：访问 [WeData 权限管理](https://wedata.woa.com/security/myAuth) 查看当前权限或申请所需目录的读写权限；
> 3. **权限问题排查**：如遇到权限相关报错，可参考 [HDFS 权限问题汇总](https://iwiki.woa.com/p/717928594) 获取常见问题及解决方案

**当接口执行报错或使用中遇到问题时，引导用户联系支持**：

> 如在使用过程中遇到接口报错或其他问题，请直接联系 **大数据 Skills 助手** 进行解疑。

## 前置条件

- 已知 HDFS 路径（如 `/user/tdw/warehouse/db.db/table/` 或 `hdfs://cluster-name/path/`）
- 已安装 `do-bigdata` CLI 工具
- 已执行 `do-bigdata auth init` 完成 CMK 凭证配置（CLI 自动加密存储并注入，命令无需显式传入 user/cmk）

## 支持的操作

| 操作 | 等效命令 | CLI 命令 | 说明 |
|------|----------|----------|------|
| `ls` | `hdfs dfs -ls <path>` | `do-bigdata hdfs ls` | 列出目录下的文件和子目录 |
| `du` | `hdfs dfs -du -h <path>` | `do-bigdata hdfs du` | 查看目录/文件磁盘空间使用（人类可读格式） |
| `stat` | `hdfs dfs -stat [fmt] <path>` | `do-bigdata hdfs stat` | 查看文件/目录状态信息 |
| `count` | `hdfs dfs -count <path>` | `do-bigdata hdfs count` | 统计路径的目录数、文件数、总字节数 |
| `test` | `hdfs dfs -test -e <path>` | `do-bigdata hdfs test` | 检测路径是否存在 |
| `mkdir` | `hdfs dfs -mkdir -p <path>` | `do-bigdata hdfs mkdir` | 递归创建目录 |
| `put` | `hdfs dfs -put <local> <hdfs>` | `do-bigdata hdfs put` | **写操作**：上传本地文件到 HDFS |

**底层执行链路**：skill 识别用户问题 → 选择对应 `do-bigdata hdfs <op>` 命令 → CLI 内部自动注入 user/cmk 鉴权并调用 `/api/hdfs/<op>` 接口 → do_mcp service 层拼接 hadoop 命令（`env TQ_USER_NAME=xxx TQ_USER_TOKEN='base64(cmk)' /.../tdwdfsclient/.../bin/hadoop dfs -ls hdfs://<cluster>/<path>`）并通过 subprocess 执行 → 返回结果。

**鉴权参数说明**（用户无感知，CLI 自动处理）：

| 参数 | 说明 |
|------|------|
| `user` | 用户名（RTX），API 层会将其设置为 `TQ_USER_NAME` 环境变量传递给 HDFS 客户端 |
| `cmk` | CMK 密钥，API 层会将其进行 base64 编码后设置为 `TQ_USER_TOKEN` 环境变量传递给 HDFS 客户端 |

## 路径访问限制（强制校验）

所有 HDFS 基础查询操作均受标准目录规范限制，**不符合规范的路径一律拒绝访问**。校验在 CLI 客户端和 API 服务端均强制执行，无法绕过。

### 标准路径前缀

仅允许以下前缀开头的路径：

| 标准前缀 | 示例 |
|----------|------|
| `/stage/interface/{BG}/{xxx}/` | `/stage/interface/TEG/appgroup_name/` |
| `/stage/outface/{BG}/{xxx}/` | `/stage/outface/PCG/myapp/` |
| `/data/MAPREDUCE/{BG}/{xxx}/` | `/data/MAPREDUCE/TEG/job_output/` |
| `/data/SPARK/{BG}/{xxx}/` | `/data/SPARK/CSIG/spark_data/` |
| `/data/tianqiong/{BG}/{xxx}/` | `/data/tianqiong/IEG/pipeline/` |
| `/data/cluster/{BG}/{xxx}/` | `/data/cluster/PCG/cluster_data/` |
| `/user/cluster/{BG}/{xxx}/` | `/user/cluster/PCG/user_data/` |

### 校验规则

1. **四级目录以上**：访问路径必须是集群名之后的四级目录以上。例如：
   - `hdfs://yz-teg-hunyuan-v3/stage/interface/TEG/appgroup_name/` → **允许**（四级）
   - `hdfs://yz-teg-hunyuan-v3/stage/interface/TEG/` → **拒绝**（仅三级）
   - `hdfs://yz-teg-hunyuan-v3/stage/interface/` → **拒绝**（仅二级）

2. **BG 名称限制**：第三级目录必须是合法 BG，允许的值（**不区分大小写**）：
   - `WXG`、`TEG`、`PCG`、`CSIG`、`CDG`、`IEG`、`OMG`、`SNG`、`MIG`、`OTHER`

3. **拒绝提示**：不满足上述任一条件时，CLI 会直接返回拒绝提示：
   > 访问的路径为非标准目录规范路径，权限管控不可直接访问，请迁移到标准目录后访问，具体包含：
   > /stage/interface/BG/groupname/xxx
   > /stage/outface/BG/groupname/xxx
   > /data/MAPREDUCE/BG/groupname/xxx
   > /data/SPARK/BG/groupname/xxx
   > /data/tianqiong/BG/groupname/xxx
   > /data/cluster/PCG/groupname  ##PCG独有目录
   > /user/cluster/PCG/groupname  ##PCG独有目录

**重要**：识别用户路径后，**AI 必须先做此校验**。如果用户提供的路径不符合规范，**立即停止**，直接输出上述拒绝提示，不再调用任何 HDFS 操作命令。

## 工作流

当用户请求执行 HDFS 基础查询操作时，按以下步骤执行：

### 第 1 步：识别操作类型并提取路径

从用户输入中识别要执行的操作以及 HDFS 路径：

**操作识别**：
- "看看目录下有什么"、"列出文件"、"查看分区" → `ls`
- "占多大空间"、"目录大小"、"du" → `du`
- "文件状态"、"stat" → `stat`
- "有多少文件"、"统计"、"count" → `count`
- "路径是否存在"、"test" → `test`

**路径提取**：
- 若路径包含 `hdfs://cluster-name/...` 格式，CLI 会自动提取集群名和文件路径
- 若用户同时提供了集群名和文件路径（如"集群 ss-pcg-13-v3 的 /user/tdw/"），使用 `--cluster` 显式指定
- 若只有文件路径无集群名，直接传 `--path`，CLI 自动查询所属集群

### 第 2 步：校验路径规范（见上方"路径访问限制"）

如果用户提供的路径不满足标准目录规范，立即停止并输出拒绝提示。

### 第 3 步：执行对应 CLI 命令

每个操作对应一条 CLI 命令，CLI 内部完成：路径规范校验 → 集群名解析/查询 → 注入认证 → 调用 `/api/hdfs/<op>` 接口 → 格式化输出。

```bash
# 列出目录内容
do-bigdata hdfs ls --path <路径> [--cluster <集群名>] --query "<用户原始问题>"

# 查看磁盘空间使用
do-bigdata hdfs du --path <路径> [--cluster <集群名>] --query "<用户原始问题>"

# 查看文件/目录状态（可指定 --fmt）
do-bigdata hdfs stat --path <路径> [--fmt "%n %y %r"] [--cluster <集群名>] --query "<用户原始问题>"

# 统计路径信息
do-bigdata hdfs count --path <路径> [--cluster <集群名>] --query "<用户原始问题>"

# 检测路径是否存在
do-bigdata hdfs test --path <路径> [--cluster <集群名>] --query "<用户原始问题>"

# 创建目录（递归）
do-bigdata hdfs mkdir --path <路径> [--cluster <集群名>] --query "<用户原始问题>"
```

### 第 3-A 步：[WARN] put 上传文件到 HDFS（写操作，需二次确认）

put 是**写操作**，比只读查询多出以下安全步骤：

**AI 必须在调用 put 命令之前做以下确认**：
1. **确认本地文件存在且非空** — 上传前检查本地文件是否存在
2. **标准路径校验** — put 的目标路径同样受标准目录规范限制

**安全保障（7 层防线，CLI + 服务端自动执行）**：
1. 标准路径校验（CLI + 服务端双重校验）
2. 覆盖保护：目标路径已存在则**拒绝上传**（不可覆盖）
3. 文件大小限制：单次上传最大 1GB（环境变量 `HDFS_PUT_MAX_SIZE_BYTES` 可调）
4. 并发限制：同一用户同一时间只允许 1 个 put 操作
5. 临时文件隔离：文件先存到 `/tmp/hdfs_upload_xxx/`，put 执行完立即删除
6. 上传后自动 `ls` 验证文件是否真正写入成功
7. 审计日志：每次 put 记录 `user / file_size / dest / success / elapsed`

```bash
# [WARN] 上传文件到 HDFS
do-bigdata hdfs put \
  --local <本地文件路径> \
  --path <HDFS目标路径> \
  [--cluster <集群名>] \
  --query "<用户原始问题>"
```

**参数说明**：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--local` / `-l` | 本地文件路径（必选） | — |
| `--path` / `-p` | HDFS 目标路径（必选），如 `hdfs://cluster/stage/interface/TEG/mygroup/data.csv` | — |
| `--cluster` / `-c` | HDFS 集群名（可选，不提供则自动查询） | — |
| `--query` / `-q` | 用户原始问题（由 AI Agent 自动传入） | — |
| `--output` / `-o` | 输出格式：`text`（默认） / `json` | `text` |

**put 完整执行流程**：

```
1. CLI 端校验：标准路径校验 + 本地文件存在性检查
2. CLI 将文件通过 multipart POST 上传到 do_mcp /api/hdfs/put
3. 服务端校验：鉴权 → 路径校验 → 大小校验 → 覆盖检查（目标已存在则拒绝）
4. 服务端落盘到 /tmp/hdfs_upload_xxx/ 临时目录
5. 服务端执行 hadoop dfs -put <临时文件> <HDFS目标路径>
6. put 执行完毕后立刻清理临时文件（不等待函数返回）
7. CLI 收到上传结果后，自动执行 ls 验证文件是否存在于 HDFS
8. 输出最终结果（上传成功/失败 + 验证结果）
```

**put 报错处理**：

| 报错 | 原因 | 处理 |
|------|------|------|
| "目标路径已存在...已拒绝上传" | 覆盖保护触发 | 告知用户目标路径已有同名文件，如确需覆盖请先手动删除 |
| "文件大小 xxx MB 超过单次上传限制" | 超过 1GB 限制 | 告知用户拆分文件或联系管理员调整限制 |
| "用户 xxx 当前已有一个上传任务正在执行" | 并发限制 | 告知用户等待当前上传完成后重试 |
| "访问的路径为非标准目录规范路径" | 标准路径校验失败 | 同只读操作的拒绝提示 |
| 权限相关报错 | HDFS 写权限不足 | 引导用户到 WeData 申请写权限 |

**参数说明**：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--path` / `-p` | HDFS 路径（必选），支持 `/path` 或 `hdfs://cluster/path` | — |
| `--cluster` / `-c` | HDFS 集群名（可选，不提供则自动查询） | — |
| `--fmt` | `stat` 专用，输出格式（如 `%n %y %r`） | — |
| `--query` / `-q` | 用户原始问题（由 AI Agent 自动传入） | — |
| `--output` / `-o` | 输出格式：`text`（默认） / `json` | `text` |

### 第 4 步：格式化输出结果

CLI 会根据操作类型输出结构化结果，AI 按需整理呈现给用户：

- **ls 结果**：展示文件/目录列表（权限、大小、修改时间、路径）。对于目录（`d` 开头），可以提示用户进一步查看
- **du 结果**：展示每个子目录/文件的空间使用大小（人类可读格式），方便用户快速定位大文件/大目录
- **stat 结果**：展示文件/目录的状态信息（如修改时间、副本数等）
- **count 结果**：CLI 已自动解析四列数据（目录数、文件数、字节数、路径），字节数可按需转换为 KB/MB/GB/TB
- **test 结果**：告知用户路径是否存在

### 第 5 步：接口报错处理（关键规则）

当 CLI 命令返回错误或 API 调用失败时，按以下规则处理：

**[WARN] 核心原则：默认用户提供的 CMK 是正确的。遇到任何访问类报错（包括但不限于 `there is no proper master key`、`Permission denied`、`AccessControlException` 等），都应判定为用户对目标路径没有访问权限，而不是 CMK 有问题。绝对不要引导用户重新配置 CMK。**

**访问类报错（权限不足）的统一引导文案**：

> 当前账号对该路径没有访问权限，请按以下方式处理：
>
> 1. **查看和申请权限**：访问 [WeData 权限管理](https://wedata.woa.com/security/myAuth) 查看当前权限或申请所需目录的读权限
> 2. **权限问题排查**：可参考 [HDFS 权限问题汇总](https://iwiki.woa.com/p/717928594) 获取常见报错的原因分析及解决方案
> 3. 如仍有疑问，请联系 **大数据 Skills 助手** 进行解疑

**路径/集群问题**（`No such file or directory`、`Name or service not known`、`Command timed out`）：提示用户检查路径和集群名是否正确。

**CMK 未配置的报错**：CLI 会提示 `缺少认证信息，请先执行 do-bigdata auth init 配置凭证`，此时引导用户：

> 需要先配置 CMK 凭证才能执行 HDFS 操作：
>
> **CMK 密钥获取方式：**
> 1. 访问 https://wedata.woa.com/security/user/keys 下载个人 CMK 文件
> 2. 打开下载的文件，找到 `"key"` 字段的值即为 CMK
>    文件格式示例: `{"id":...,"subject":"xxx","key":"这里就是CMK","type":"cmk",...}`
>
> 请直接在对话中回复您的 CMK 文件内容（或单独提供 RTX 和 CMK），我会自动帮您完成配置。

**重要**：当用户提供了 CMK 文件内容（JSON 格式，包含 `subject` 和 `key` 字段）时，静默执行 `do-bigdata auth init --from-json '<JSON内容>'` 完成配置，只告知"凭证配置成功"，然后继续处理用户原始问题。

## 执行流程举例

### 示例 1：用户查看目录内容（带 hdfs schema）

**用户输入**：

```
帮我看下 hdfs://ss-pcg-13-v3/stage/interface/TEG/mygroup/mydb.db/ 下面有哪些表
```

**执行流程**：

1. **识别操作**：查看目录 → `ls`
2. **路径校验**：`/stage/interface/TEG/mygroup/mydb.db/` 符合标准规范（四级 + 合法 BG）
3. **执行命令**：
   ```bash
   do-bigdata hdfs ls \
     --path hdfs://ss-pcg-13-v3/stage/interface/TEG/mygroup/mydb.db/ \
     --query "帮我看下 hdfs://ss-pcg-13-v3/stage/interface/TEG/mygroup/mydb.db/ 下面有哪些表"
   ```
4. **格式化输出**：列出所有子目录（即表目录），展示关键信息

### 示例 2：用户统计路径（不带集群名）

**用户输入**：

```
/stage/interface/TEG/mygroup/mydb.db/ 这个库占了多大空间
```

**执行流程**：

1. **识别操作**：统计空间 → `count`
2. **路径校验**：符合标准规范
3. **执行命令**（CLI 自动查询集群）：
   ```bash
   do-bigdata hdfs count \
     --path /stage/interface/TEG/mygroup/mydb.db/ \
     --query "/stage/interface/TEG/mygroup/mydb.db/ 这个库占了多大空间"
   ```
4. **格式化输出**：展示目录数、文件数、总大小

### 示例 3：拒绝非标准路径

**用户输入**：

```
ls hdfs://ss-pcg-13-v3/tmp/
```

**执行流程**：

1. **识别操作**：`ls`
2. **路径校验失败**：`/tmp/` 不在标准前缀列表中
3. **立即停止**，输出拒绝提示（不调用任何 CLI 命令）。

## 原子化命令（辅助）

```bash
# 查询文件所属 HDFS 集群（无需 CMK 鉴权）
do-bigdata hdfs file-location --path <HDFS路径> --query "<用户问题>"
```

> [WARN] **铁律**：严禁通过 `curl`、`web_fetch`、`urllib.request` 等方式直接请求 `http://do-mcp.server.woa.com:8080/api/hdfs/...`。所有数据获取必须通过 `do-bigdata` CLI 命令完成，否则认证将失效。

## 参考文档

```bash
# 列出本 Skill 的所有参考文档
do-bigdata docs list --skill hdfs-basic-operations

# 查看基础操作参考文档（操作说明、API 接口、路径格式、典型用例、常见错误处理）
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
