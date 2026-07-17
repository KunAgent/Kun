---
name: sql-execute-analyze
description: "当用户需要提交并执行 SQL 查询、查看任务执行状态和查询结果、获取集群和资源池信息时使用此技能。核心能力包括：CMK 凭证管理、集群/资源池查询、SQL 任务提交、状态轮询、结果链接生成。本 Skill 只负责 SQL 的提交执行和结果获取，不诊断 SQL 报错原因、不分析异常堆栈、不检索故障知识库。如果执行失败需要根因分析，请使用 supersql-job-analyzer。"
---

# WeData SQL 执行与分析

## 概述

通过 WeData 数据探索 执行 SQL 查询，获取查询结果。WeData 是腾讯内部的大数据开发治理平台（https://wedata.woa.com），数据探索模块支持在线 SQL 查询 TDW 数据仓库。

本 Skill 通过 `do-bigdata wedata <command>` CLI 调用，底层由 `@skill_command` 装饰器统一处理凭证加载、tauth-proxy 两步鉴权、使用回传与错误格式化，业务代码只负责调用 WeData 数据探索服务。

## 执行规则

- **隐藏所有执行细节**：整个过程中，不要向用户暴露任何底层操作痕迹：
  - 回复文本中**不要提及或展示**任何命令行指令（如 `do-bigdata wedata run-task ...` 等）
  - 调用 `execute_command` 工具时，`explanation` 字段使用简短的中文描述（如「提交SQL查询」「获取任务状态」），**不要包含具体命令内容**
  - **不要展示原始 JSON 输出**，只提取关键信息以结构化方式呈现
  - 配置凭证时：收到用户的用户名和 CMK 后，静默完成配置，只告知「凭证配置成功」
- **用户视角**：用户应只看到简洁的进度状态和最终结果，看不到任何中间的技术细节。
- **关键链接必须着重展示**：以下两个链接是用户最关心的核心信息，**必须在最终回复中醒目展示**，不得遗漏或弱化：
  - **任务日志链接（log_url）**：来自 `run-task` 提交任务时返回的 `log_url` 字段。展示时标注为「[LIST] 任务日志」，让用户可以在浏览器中查看任务执行状态和排查问题
  - **结果查看链接（result_url）**：来自 `query-result-url` 返回的 `result_url` 字段。展示时标注为「[CHART] 查询结果」，让用户可以在线查看数据结果
- **关键 ID 结构化输出规范**（[WARN] 强制要求）：每次 SQL 执行完成的回复**末尾**，必须以固定的结构化格式输出当前持有的所有关键 ID，确保这些 ID 在对话历史被摘要压缩后仍能被检索到。**禁止**将这些 ID 仅嵌入表格或自然语言句子中，而必须在回复末尾**额外追加**下方固定格式的输出块：

  ```
  ---
  **[KEY] 当前查询关键信息**
  - **task_id**: `<task_id值>`
  - **sql_id**: `<sql_id值>`
  ```

  **规则说明**：
  - 上述 key 名称（`task_id`、`sql_id`）为固定标识符，**不得翻译、不得改写、不得省略**
  - 如果一次提交了多条 SQL（多个 sql_id），全部列出
  - 此输出块的目的是让后续 ChatBI 分析时能**精确匹配**到这些 ID 值，实现跨技能串联
- **分步进度反馈**：操作过程中必须让用户感知到进展，不能只说一句话就沉默到出结果。由于 `execute_command` 是阻塞式的（用户在命令执行期间无法看到脚本的实时输出），**必须将操作拆分为多步调用**，每步完成后给出进度反馈。例如 SQL 查询流程：
  1. 凭证检查阶段 → 回复「正在验证凭证...」，完成后 → 「凭证验证通过 ✓」
  2. 资源查询阶段 → 回复「正在获取集群和资源池信息...」，使用 `execute_command` **并行调用** `query-clusters` 和 `query-pools` 两个命令，完成后 → 「集群和资源池信息已获取 ✓」
  3. 任务提交阶段 → 回复「正在提交 SQL 查询...」，使用 `execute_command` 调用 `run-task`，完成后 → 「SQL 已提交 ✓ 正在等待执行...」
  4. 状态轮询阶段 → 使用 `query-status` 轮询直到进入终态，完成后 → 「查询执行完成 ✓」或「查询执行失败 ✗」
  5. 结果获取阶段 → 使用 `query-result-url` 生成结果链接
  6. 最终结果展示 → **必须着重展示**以下关键链接（使用 Markdown 链接格式，醒目呈现）：
     - [LIST] **任务日志**：`log_url`（来自 run-task 返回）
     - [CHART] **查询结果**：`result_url`（来自 query-result-url 返回）

  **重要**：每步内的多个 `execute_command` 调用应在同一个 tool call batch 中并行发出。

## 工作流程

### 前置步骤：凭证检查与配置

本 Skill 的所有命令均已通过 `@auth_required` 装饰器内置凭证检查。**无需再手动读取 `security_file/config.json`**：

- **凭证已配置且有效时**：命令正常执行。
- **凭证缺失或无效时**：命令会自动输出引导文案（含 CMK 下载地址、配置命令），**直接将该引导文案转述给用户**，并引导用户通过 `do-bigdata auth init` 进行配置。**禁止**将 CLI 的原始报错堆栈暴露给用户。
- 凭证存储与加载采用三级 fallback：环境变量 → 加密文件 `security_file/config.json.enc` → 明文文件 `security_file/config.json`（向后兼容），由中间件自动处理。

**用户提供 CMK 文件内容的处理**：当用户粘贴 CMK JSON 文件（含 `subject`、`key`、`id` 字段）时，静默执行：

```
do-bigdata auth init --from-json '<CMK JSON 文件内容>'
```

配置成功后只告知「凭证配置成功」，然后继续处理用户原始问题。

**引导文案**（仅在凭证缺失/失效时使用，不要暴露命令细节）：

> 需要先配置 CMK 凭证才能使用数据探索功能：
>
> **CMK 密钥获取方式：**
> 1. 访问 https://wedata.woa.com/security/user/keys 下载个人 CMK 文件
> 2. 打开下载的文件，找到 `"key"` 字段的值即为 CMK
>    文件格式示例: `{"id":...,"subject":"xxx","key":"这里就是CMK","type":"cmk",...}`
>
> 请直接在对话中回复您的 CMK 文件内容（或单独提供 RTX 和 CMK），我会自动帮您完成配置。

如果用户的问题**不需要调用工具**（如纯概念性咨询等），则跳过此检查，直接回答。

### SQL 查询执行流程

1. **确定集群和资源池**：如果用户未指定，先通过 `query-clusters` 和 `query-pools` 查询可用资源（可并行调用）
2. **提交任务**：使用 `run-task` 提交 SQL
3. **轮询状态**：使用 `query-status` 轮询任务状态，直到进入终态（success / failure / abortion）
4. **获取结果**：**必须确认任务状态为 `success` 后**，才能使用 `query-result-url` 生成在线查看链接。如果任务尚未成功就调用，生成的链接将无法正常查看结果数据。
5. **结果展示**：查询完成后，**必须在回复中着重展示以下关键链接**，让用户能快速访问：
   - [LIST] **任务日志（`log_url`）**：从 `run-task` 返回的 `log_url` 字段中提取，用于在浏览器中查看任务执行状态和排查问题
   - [CHART] **查询结果**（`result_url`）：从 `query-result-url` 返回的 `result_url` 中提取，用于在线查看数据
   - 展示格式示例：
     ```
     [OK] SQL 查询执行完成！

     [CHART] **查询结果**：[点击查看在线结果](result_url链接)
     [LIST] **任务日志**：[点击查看执行日志](log_url链接)
     ```

> [NO] **严禁手动拼接结果 URL**：结果查看链接包含时间戳、分页参数、状态标识等必要组成部分，格式复杂。**必须且只能通过 `query-result-url` 命令生成**，绝对不允许根据 task_id 和 sql_id 自行拼接 URL。手动拼接的 URL 将无法正常工作。

**并行调用策略**：
- **第一步**（并行）：`query-clusters` + `query-pools` — 获取集群和资源池信息
- **第二步**（顺序）：`run-task` — 提交 SQL 任务
- **第三步**（轮询）：`query-status` — 轮询直到终态
- **第四步**（顺序）：`query-result-url` — 仅在任务状态为 success 时生成结果链接

> [WARN] **重要约束**：`query-result-url` 依赖任务处于 `success` 状态。如果任务状态不是 `success`（如 `running`、`failure`、`abortion`），获取的结果链接将无效。**请务必先通过 `query-status` 轮询确认任务成功后，再调用该命令。**
>
> [NO] **严禁手动拼接结果 URL**：结果链接的格式为 `https://wedata.woa.com/explore/sql/result/{task_id}/{sql_id}/{timestamp}/10/true/success/openapi`，包含时间戳等动态参数，**只能通过 `query-result-url` 命令生成**。任何手动拼接的 URL（如直接将 task_id 和 sql_id 拼入 URL）都将导致链接无效或格式错误。

## CLI 命令

本 Skill 通过 `do-bigdata wedata <command>` 统一调用，所有命令会自动完成凭证加载、tauth 鉴权、使用回传。

**支持的 6 个原子命令**:

| 命令 | 功能 | 示例 |
|------|------|------|
| `query-clusters` | 获取集群列表 | `do-bigdata wedata query-clusters --query "<用户原始问题>"` |
| `query-pools` | 获取资源池列表 | `do-bigdata wedata query-pools --cluster-id tl --query "<用户原始问题>"` |
| `run-task` | 提交 SQL 任务 | `do-bigdata wedata run-task --statements "SELECT 1" --database db --cluster-id tl --pool-id pool --gaia-id 1 --query "<用户原始问题>"` |
| `query-status` | 获取任务状态 | `do-bigdata wedata query-status --task-id <ID> --query "<用户原始问题>"` |
| `query-result-url` | 生成结果查看链接（**唯一合法方式，严禁手动拼接 URL**） | `do-bigdata wedata query-result-url --task-id <ID> --sql-id <SQL_ID> --query "<用户原始问题>"` |
| `cancel-task` | 取消/停止正在运行的 SQL 任务 | `do-bigdata wedata cancel-task --task-id <ID> --query "<用户原始问题>"` |

**在工作流中的使用**：执行 SQL 查询时，将操作分为多步并行调用，每步完成后给用户进度反馈：
1. **第一步**（并行）：`query-clusters` + `query-pools` — 获取集群和资源池信息
2. **第二步**（顺序）：`run-task` — 提交 SQL 任务
3. **第三步**（轮询）：`query-status` — 轮询直到终态（success / failure / abortion）
4. **第四步**（顺序）：`query-result-url` — **仅在 `query-status` 确认任务状态为 success 后**才能调用，否则生成的链接无效。**严禁手动拼接结果 URL，必须调用此命令生成**

**通用参数**（所有命令均支持）：

| 参数 | 说明 |
|------|------|
| `--query` / `-q` | 用户原始问题（AI 必传，用于使用回传） |
| `--output` / `-o` | 输出格式（`text` / `json` / `markdown`，默认 `text`） |

**命令参数详细说明**：

`run-task` 参数：

| 参数 | 必填 | 默认值 | 说明 |
|------|:--:|:------:|------|
| `--statements` | 是  | — | SQL 语句，如果多条 SQL 语句以分号(`;`)拼接，例如: `'SELECT 1; SELECT 2'` |
| `--database` | 是  | — | 默认数据库名 |
| `--cluster-id` | 是  | — | 集群 ID（如 `tl`, `hk`, `cft`），可通过 `query-clusters` 获取 |
| `--pool-id` | 是  | — | 资源池 ID，可通过 `query-pools` 获取 |
| `--gaia-id` | 是  | — | Yarn 集群 ID，可通过 `query-pools` 获取 |
| `--module` | 是  | `normal` | 下载数据模式。`normal`: 查询小结果集，最多下载 2 万条数据；`full`: 查询大结果集，最多下载 1 亿条数据，耗时较长 |

`query-pools` 参数：

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|:------:|------|
| `--cluster-id` | 是 | — | 元数据集群 ID（如 `tl`, `hk`, `cft`），可通过 `query-clusters` 获取 |
| `--enable-filter` | 否 | 关闭 | 启用后仅返回满足条件（UsedCores >= MinCores && UsedMemory >= MinMemory && RunningApps >= MaxApps）的资源池；不启用则返回所有资源池 |

`query-status` 参数：

> 说明：查询任务状态及详细信息（SQL ID、日志链接、引擎、起止时间等）。由于任务执行需要时间，CLI 内部已内置 10 秒等待，模型层轮询间隔仍**建议 10 秒以上**。

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|:------:|------|
| `--task-id` | 是 | — | 任务 ID，由 `run-task` 返回 |
| `--sql-id` | 否 | — | 子任务 ID，指定后可查询该子任务的详细状态及明细信息 |

`query-result-url` 参数：

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|:------:|------|
| `--task-id` | 是 | — | 任务 ID，由 `run-task` 返回 |
| `--sql-id` | 是 | — | SQL 子任务 ID，由 `query-status` 返回 |

`cancel-task` 参数：

> 说明：调用 WeData `CancelTask` 接口将指定的正在运行中的任务置为 `abortion` 终态。

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|:------:|------|
| `--task-id` | 是 | — | 任务 ID，由 `run-task` 返回 |

**使用场景**：
- 用户主动要求取消任务（如「停掉/取消刚才的 SQL」）
- SQL 已运行过长时间（如长期处于 `running` 不推进），Agent 可在征得用户同意后主动取消
- 误提交的 SQL（如漏写 WHERE 条件的全表扫描）需要即时停止释放资源

**调用建议**：
- 取消成功后，建议再调用一次 `query-status` 确认任务已进入 `abortion` 状态再向用户汇报
- 若接口返回业务错误（如任务已结束、task_id 不存在），**不要重复取消**，应先用 `query-status` 查当前状态并向用户解释

### 凭证配置

- 统一通过 `do-bigdata auth init` 进行配置，由 CLI 中间件按"环境变量 → 加密文件 → 明文文件"三级 fallback 加载
- 多个 skill 共享同一份凭证，**无需为 chatbi / sql-execute-analyze 分别配置**

## 参考文档

本 Skill 使用 `do-bigdata wedata` CLI 命令完成所有数据探索操作，**当前不含额外的参考文档文件**。如后续补充 references，可通过以下命令查阅：

```bash
do-bigdata docs list --skill sql-execute-analyze
do-bigdata docs show --skill sql-execute-analyze --file <guide文件名>.md
```

## 关键参考链接

| 资源 | URL |
|------|-----|
| WeData 数据探索 | https://wedata.woa.com/explore |
| CMK 密钥下载 | https://wedata.woa.com/security/user/keys |
| 天穹安全中心 | https://security.tianqiong.woa.com/user/keys |

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
