---
name: us
description: >
  US（统一调度）平台相关技能集合，覆盖任务失败诊断、慢任务耗时分析、任务/实例操作、日志查询与脚本管理四大能力。
  包含子技能：us-fail-task-diagnose（任务失败/出库入库失败/脏数据/权限错误/SQL报错/告警查询等诊断）、
  us-slow-task-diagnose（任务慢/耗时异常/超时/等待下发/调度延迟/队列排队等慢任务诊断）、
  us-operate-diagnose（创建任务/上传脚本/创建依赖/冻结解冻/复制任务/补录/回溯/重跑/终止/强制成功等操作）、
  us-log-analyzer（下载脚本/批量下载/WeData开发态日志/US平台使用咨询/封闭域/任务类型配置等）。
  触发关键词：US任务、统一调度、任务失败、任务慢、耗时长、创建任务、复制任务、补录、回溯、重跑、下载脚本、告警查询、US视图、视图ID、视图详情、查询视图、任务所属视图、任务列表查询。
---

# US（统一调度）技能集

## 概述

US（Unified Scheduler / 统一调度）是腾讯内部的分布式任务调度平台（https://us.woa.com），每天管理数百万个任务实例。本目录包含与 US 平台相关的所有技能。

## 可用技能

### 1. us-fail-task-diagnose — US 失败任务诊断

- **路径**: `us-fail-task-diagnose/`
- **用途**: 分析 US 任务实例日志，自动诊断任务失败原因，提取错误特征，提供针对性解决方案
- **触发场景**:
  - 用户提供 US 任务日志链接、日志内容或任务 ID，需要诊断任务失败原因
  - 用户遇到任务失败、出库失败、入库失败、脏数据、权限错误、SQL 报错、连接超时等问题
  - 用户咨询 US 平台使用问题：权限管理、任务配置、调度依赖、告警配置、时间变量、任务补录、系统冻结、封闭域等
- **核心能力**:
  - 通过 US API 自动采集任务配置、实例状态、执行日志、依赖关系
  - 查询告警记录（延迟告警、失败告警），支持按任务ID和时间范围筛选
  - 11 大类错误模式扫描（出库脏数据、入库分区、权限连接、资源超时、SQL 脚本、HDFS 文件、Shell、封闭域等）
  - 失败任务自动调用平台智能分析接口
  - 内置排障指南、错误码索引、平台使用手册、封闭域指南等参考资料
- **触发关键词**: US任务、统一调度、任务日志、实例日志、任务失败、出库失败、入库失败、脏数据、权限错误、SQL报错、连接失败、脚本错误、OOM、Permission denied、告警配置、告警记录、告警查询、延迟告警、失败告警、权限申请、任务依赖、任务补录、时间变量、系统冻结、封闭域

### 2. us-slow-task-diagnose — US 慢任务诊断

- **路径**: `us-slow-task-diagnose/`
- **用途**: 分析 US 任务实例日志，自动诊断任务耗时异常原因，拆解全生命周期各阶段耗时，定位性能瓶颈
- **触发场景**:
  - 用户反映任务跑得慢、耗时变长、等待下发时间过长
  - 用户需要分析任务各阶段耗时、定位性能瓶颈
  - 任务超时、运行时间异常增长的排查
- **核心能力**:
  - 通过 US API 自动采集任务配置、实例状态、阶段日志
  - 6 阶段全生命周期耗时拆解（US 调度等待 → 提交引擎 → Runner 准备 → 引擎提交 → Application 运行 → 收尾）
  - 自动获取上一运行周期日志进行耗时对比分析
  - 自动标注占比 >30% 的瓶颈阶段
  - 耗时增幅 >50% 时联动失败诊断和队列资源分析
- **触发关键词**: 任务慢、执行慢、耗时长、耗时异常、跑得慢、超时、等待下发、运行时间长、调度延迟、队列排队、资源等待、任务超时

### 3. us-operate-diagnose — US 任务/实例操作工具

- **路径**: `us-operate-diagnose/`
- **用途**: 提供 US 平台的任务级别和实例级别操作能力，支持任务全生命周期管理和实例运维操作
- **触发场景**:
  - 用户需要创建任务、批量创建任务、修改任务配置
  - 用户需要上传脚本、创建任务依赖关系
  - 用户需要冻结/解冻任务、复制任务
  - 用户需要补录实例、重跑实例、终止实例、强制成功实例
- **核心能力**:
  - 任务管理：创建任务、批量创建任务、修改任务、复制任务（支持批量、自动分批）、上传脚本（四道门禁流程）、创建依赖、冻结/解冻任务
  - 实例运维：补录实例（自动分批）、重跑实例（自动分批+异步轮询结果）、终止实例、强制成功
  - 查询辅助：查询任务类型、查询扩展参数列表、校验上传参数、检查脚本是否存在
- **触发关键词**: 创建任务、上传脚本、创建依赖、冻结任务、解冻任务、修改任务、复制任务、任务补录、重跑实例、终止实例、kill实例、强制成功

### 4. us-log-analyzer — US 日志查询与脚本管理（共享资源库）

- **路径**: `us-log-analyzer/`
- **说明**: 作为 us-fail-task-diagnose 和 us-slow-task-diagnose 的**共享脚本和参考文档库**，提供底层 CLI 查询命令和平台参考资料
- **核心能力**:
  - **US API 查询命令**（`do-bigdata us`）：任务查询、实例状态查询、执行日志获取、阶段日志获取、依赖关系查询、变更记录查询、重跑明细查询、脚本版本查询
  - **脚本下载与管理**：单个脚本下载（`do-bigdata us download-script`）、批量下载应用组脚本（`do-bigdata us batch-download`，内置限流保护）、脚本元数据查询（`do-bigdata us script-view`）
  - **WeData API 查询命令**（`do-bigdata us`）：调度态日志查询（`do-bigdata us describe-log`）、开发态执行记录查询（`do-bigdata us describe-execution-records`）、开发态执行日志查询（`do-bigdata us describe-execution-log`）
  - **参考文档库**（`do-bigdata docs list --skill us-log-analyzer`）：排障指南、错误码索引、US 平台使用指南、任务类型配置指南、封闭域指南、Gaia 集群映射表、FAQ 等
- **触发场景**:
  - 用户需要下载 US 脚本、批量下载应用组脚本、查询脚本版本/元数据
  - 用户需要查询 WeData 开发态的执行记录或执行日志
  - 用户咨询 US 平台使用问题（权限、配置、封闭域、任务类型等）→ 通过参考文档回答
  - 失败/慢任务诊断场景由 us-fail-task-diagnose / us-slow-task-diagnose 调用其脚本工具
- **触发关键词**: 下载脚本、批量下载、脚本版本、脚本查询、应用组脚本、WeData日志、开发态日志、执行记录、US使用指南、封闭域、任务类型配置、Gaia集群、查询视图、视图ID、视图详情、任务所属视图、视图任务列表、任务列表查询

## 强制输出规则（铁律）

> **[WARN] 每次给用户输出方案、诊断结果、操作结果、回答咨询后，回复的最末尾必须附加以下内容（加粗高亮，不可省略）：**
>
> **[WARN] 如果US或WeData使用上有任何问题，可以直接联系 kimlinlin**
>
> 此规则适用于所有 US 子技能的输出，无论是诊断报告、操作结果、咨询回复还是任何其他形式的回复。

## 多地域（Namespace）支持

US 平台支持多地域部署，当前已支持的地域：

| 环境 | namespace | US 网页端 | WeData 网页端 | US OpenAPI 域名 |
|------|-----------|----------|--------------|----------------|
| **国内（默认）** | `default` | `us.woa.com` | `wedata.woa.com` | `tdwopen.oa.com` |
| **新加坡** | `sg` | `us-sg.woa.com` | `wedata-sg.woa.com` | `tdwopen.sgwoa.com` |

### * Namespace 自动识别规则（铁律）

**规则 1：从用户提供的链接中自动识别 namespace**

当用户提供的 US/WeData 链接包含以下域名时，**必须自动切换到对应 namespace**：
- 链接包含 `us-sg.woa.com` → namespace = `sg`（新加坡）
- 链接包含 `wedata-sg.woa.com` → namespace = `sg`（新加坡）
- 其他域名（`us.woa.com`、`wedata.woa.com`）→ namespace = `default`（国内）

**规则 2：用户明确声明新加坡环境时，即使未提供 SG 域名链接也按 SG 处理**

如果用户在请求中明确声明这是**新加坡环境**的任务（例如"这是新加坡的任务"、"SG 环境"、"新加坡环境的任务 ID 是 xxx"等），**即使未提供包含 `us-sg.woa.com` 或 `wedata-sg.woa.com` 的链接，也应将 namespace 设为 `sg`**。

> [WARN] **冲突优先级**：如果用户声明 SG 但同时提供了国内域名链接（`us.woa.com` / `wedata.woa.com`），优先以链接域名为准并明确提示用户："您提供的链接是国内环境域名，但声明为新加坡环境，请确认任务实际所在环境"，等待用户澄清后再执行。

**规则 3：运行前环境声明**

每次执行诊断/查询/操作前，必须在进度消息中说明当前使用的环境：
- 国内环境：`* 当前环境：国内（default）`
- 新加坡环境：`* 当前环境：新加坡（sg）`

**规则 4：namespace 参数传递**

当识别到非 default 的 namespace 时，所有 `do-bigdata us` 命令必须附加 `--skill-namespace sg` 参数：
```bash
# 国内（默认，无需额外参数）
do-bigdata us query-task --task-id 12345 --query "查询任务"

# 新加坡（必须附加 --skill-namespace sg）
do-bigdata us query-task --task-id 12345 --skill-namespace sg --query "查询任务"
```

## 执行流程

收到用户请求后，按以下步骤执行：

1. **环境识别**：从用户提供的链接中识别 namespace（参见上方「Namespace 自动识别规则」）
2. **意图识别**：分析用户请求，确定属于哪类场景（失败诊断 / 慢任务 / 操作 / 日志查询）
3. **路由分发**：根据下方路由规则表选择合适的子技能
4. **执行子技能**：跳转到对应子技能的 SKILL.md，按其定义的流程执行（传递 namespace 上下文）
5. **结果输出**：将子技能执行结果整理后返回给用户

> **默认路径**：当用户意图不明确时，优先推荐 `us-fail-task-diagnose`（覆盖面最广，兼具诊断和咨询能力）。

## 路由规则

收到用户请求后，根据以下规则选择合适的技能：

| 用户意图 | 推荐技能 |
|---------|---------|
| 任务失败 / 报错 / 诊断失败原因 | us-fail-task-diagnose |
| 出库入库失败 / 脏数据 / 权限错误 | us-fail-task-diagnose |
| 查询告警记录（延迟/失败告警） | us-fail-task-diagnose |
| 任务慢 / 耗时异常 / 超时 | us-slow-task-diagnose |
| 等待下发 / 调度延迟 / 队列排队 | us-slow-task-diagnose |
| 任务各阶段耗时分析 / 性能瓶颈定位 | us-slow-task-diagnose |
| 创建任务 / 修改任务 / 复制任务 | us-operate-diagnose |
| 上传脚本 / 创建依赖 | us-operate-diagnose |
| 冻结/解冻任务 | us-operate-diagnose |
| 任务补录 | us-operate-diagnose |
| 任务回溯 | us-operate-diagnose |
| 重跑/终止/强制成功实例 | us-operate-diagnose |
| 下载脚本 / 批量下载应用组脚本 / 查询脚本版本 | us-log-analyzer |
| 查询任务所属视图 / 视图ID / 视图详情 / 视图中的任务列表 | us-log-analyzer（`list-view` / `view-detail`） |
| 查询任务列表（按负责人/应用组/视图ID等条件筛选） | us-log-analyzer（`task-list`） |
| 查询 WeData 开发态执行记录 / 开发态日志 | us-log-analyzer |
| US 平台使用咨询（权限、配置、调度、任务类型等） | us-log-analyzer（参考文档） |
| 封闭域相关问题 / Gaia 集群查询 | us-log-analyzer（参考文档） |
| **库表权限查询** / 检查表权限 / 数据表访问权限 | **→ 跨模块路由到 [`Authentication`](../Authentication/SKILL.md)**（`table-permission-check`） |

### [WARN] 视图查询属于 US 平台（不要误路由到 WeData）

**US 视图（View）** 是 US 统一调度平台的概念，用于将一组有依赖关系的任务组织到一起管理。以下场景**必须路由到 `us-log-analyzer`**，而不是 WeData 相关技能：

- 用户提到"视图ID"、"视图详情"、"任务所属视图"、"查询视图"等
- 用户想查某个任务属于哪个视图 → `do-bigdata us list-view --task-id <ID>`
- 用户想查某个视图包含哪些任务、依赖关系 → `do-bigdata us view-detail --view-id <ViewID>`
- 用户想按视图ID筛选任务列表 → `do-bigdata us task-list --view-id <ViewID>`

### [WARN] 库表权限问题跨模块引导

在 US 任务诊断过程中，如果发现失败原因涉及 **库表权限问题**（如 `Permission denied`、`Access denied`、无权限访问某个数据库/表、select/update/alter/create 权限不足等），**不要仅在 US 侧给出建议，应主动引导用户使用 [`Authentication/table-permission-check`](../Authentication/SKILL.md) 技能进行精确的权限检查**。

典型场景包括但不限于：
- 任务日志中出现 `Permission denied`、`Access denied`、`No privilege`、`Authorization failed` 等权限相关错误
- 用户主动询问"某个库表是否有权限"、"为什么没有权限"
- 诊断结论为权限不足导致任务失败

引导方式：告知用户可以通过 `Authentication/table-permission-check` 技能直接检查具体库表的权限状态（支持 select/update/alter/create 四种权限类型），并提供权限申请链接。

> 如果用户的问题不属于以上任何场景，可尝试基于通用知识回答，或建议用户查阅 [US 使用指南](https://iwiki.woa.com/p/188168765)。

> **[WARN] 如果US或WeData使用上有任何问题，可以直接联系 kimlinlin**

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
