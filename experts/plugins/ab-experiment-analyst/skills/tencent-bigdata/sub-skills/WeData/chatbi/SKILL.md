---
name: chatbi
description: 当用户需要对 SQL 查询结果数据进行智能分析、数据洞察、趋势分析时使用此技能。通常与 sql-execute-analyze 串联使用，先执行 SQL 获取数据，再通过 ChatBI 进行自然语言数据分析。触发关键词包括：ChatBI、数据分析、分析数据、数据洞察、趋势分析、结果分析。
---

# ChatBI 智能数据分析

## 概述

通过 WeData ChatBI 对 SQL 查询结果数据进行智能分析。ChatBI 是 WeData 平台（https://wedata.woa.com）的 AI 数据分析模块，支持对数据探索执行的 SQL 查询结果进行自然语言驱动的智能分析、洞察发现和趋势解读。

**核心用途**：与 `sql-execute-analyze` 模块端到端串联 —— 先通过 sql-execute-analyze 执行 SQL 查询获取 `task_id` 和 `sql_id`，再将这两个 ID 传入 ChatBI 进行数据分析。

本 Skill 通过 `do-bigdata wedata <command>` CLI 调用（与 sql-execute-analyze 共用 `wedata` 子系统 group），由 `@skill_command` 统一完成凭证加载、使用回传与错误格式化。ChatBI 服务自身不走 tauth-proxy，CLI 内部会从加密凭证中取出明文 CMK 通过 `override_config.vars.auth` 传给 ChatBI。

> [NO] **能力边界（强制约束）**：ChatBI **仅支持数据分析**（趋势分析、统计汇总、异常检测、分布分析、数据洞察等），**不支持获取、导出或展示原始明细数据**。当用户请求获取原始明细数据、导出数据、下载数据、查看完整明细时，**必须拒绝使用 ChatBI**，并引导用户通过以下方式获取：
> 1. 使用 `sql-execute-analyze` 技能执行 SQL 查询，通过结果链接在线查看完整数据
> 2. 在 WeData 数据探索页面（https://wedata.woa.com/explore）直接执行 SQL 查询并下载结果
>
> **禁止**将「获取原始明细数据」「导出数据」等请求传递给 ChatBI 的 analyze 接口。ChatBI 只能返回数据预览，不是完整的原始明细数据，会误导用户。

## 执行规则

- **隐藏所有执行细节**：整个过程中，不要向用户暴露任何底层操作痕迹：
  - 回复文本中**不要提及或展示**任何命令行指令（如 `do-bigdata wedata create-session` 等）
  - 调用 `execute_command` 工具时，`explanation` 字段使用简短的中文描述（如「创建分析会话」「提交数据分析」），**不要包含具体命令内容**
  - **不要展示原始 JSON 输出**，只提取分析结果以结构化方式呈现
  - 配置凭证时：收到用户的用户名和 CMK 后，静默完成配置，只告知「凭证配置成功」
- **用户视角**：用户应只看到分析进度和最终的分析结果，看不到任何中间的技术细节。
- **分步进度反馈**：操作过程中必须让用户感知到进展。ChatBI 分析可能耗时较长，需给出进度提示：
  1. 凭证检查阶段 → 回复「正在验证凭证...」，完成后 → 「凭证验证通过 ✓」
  2. 会话阶段 → 若复用已有 session，回复「复用已有分析会话 ✓」；若需新建，回复「正在创建分析会话...」，完成后 → 「分析会话已创建 ✓」
  3. 数据分析阶段 → 回复「正在进行数据分析，请稍候...」，完成后 → 展示分析结果
- **分析结果展示**：将 ChatBI 返回的分析文本直接展示给用户，必要时进行格式优化使其更易读。
- **关键 ID 结构化输出规范**（[WARN] 强制要求）：每次分析完成的回复**末尾**，必须以固定的结构化格式输出当前持有的所有关键 ID，确保这些 ID 在对话历史被摘要压缩后仍能被检索到。**禁止**将这些 ID 嵌入自然语言句子中（如「会话 ID 是 xxx」），而必须使用下方固定格式：

  ```
  ---
  **[KEY] 当前会话关键信息**
  - **session_id**: `<session_id值>`
  - **task_id**: `<task_id值>`
  - **sql_id**: `<sql_id值>`
  ```

  **规则说明**：
  - 上述 key 名称（`session_id`、`task_id`、`sql_id`）为固定标识符，**不得翻译、不得改写、不得省略**
  - 如果当前 session 中已注入过多组 task_id / sql_id，全部列出
  - 追问场景（未产生新 ID）时也必须输出，确保每轮回复都包含当前持有的完整 ID 信息
  - 此输出块的目的是让后续对话（包括历史摘要检索）能**精确匹配**到这些 ID 值
- *** ChatBI 流程决策树**（[WARN] 单一事实源，所有 ChatBI 流程必须以本决策树为唯一入口）：

  > **使用方法**：每次进入 ChatBI 分析前，**严格按以下决策树自顶向下判断**，决策树会指向一个明确的「动作」（直接 analyze / 走剧本 A / 终止）。后文「Session 复用规则」「数据合规卡点」「工作流程」章节中的所有 step、场景、约束，都是本决策树的下游详情，**不得脱离决策树独立执行**。

  ```
  进入 ChatBI 分析
         │
         ▼
  ① 当前对话上下文（含所有历史[KEY]关键信息块）中是否存在 session_id？
     ├─ 否 ──────────────────────────────────────────► 走【剧本 A：新建 session】
     └─ 是 ──► 进入 ②
                │
                ▼
  ② 上下文中是否存在「未注入过当前 session」的新 task_id + sql_id？
     ├─ 否（追问场景）─► 直接调用 analyze（仅 session_id + question，
     │                   不传 task_id / sql_id），[FAIL] 严禁新建 session
     └─ 是 ──► 进入 ③
                │
                ▼
  ③ 询问用户：「检测到新的查询结果数据，您希望单独分析还是联合分析？」
     ├─ 单独分析 ──────────────────────────────► 走【剧本 A：新建 session】
     └─ 联合分析 ──► 直接调用 analyze（复用已有 session_id + 新 task_id + 新 sql_id）
  ```

  **额外允许新建 session 的兜底情况**（即便 ① 判定为「是」也允许新建）：
  - 用户**明确要求**「开启新会话 / 新建分析」等
  - 已有 session 的调用**返回了过期 / 不存在等错误**

  上述兜底场景同样需要走【剧本 A】，不得绕过合规卡点。

  ---

  *** 剧本 A：新建 session（含数据合规卡点）**

  ```
  Step 1: 调用 `create-session`（不带 --acknowledged-data-risk）
         ↓
  Step 2: CLI 以**退出码 0** 正常返回，stdout 输出结构化 JSON：
           {
             "status": "pending_user_confirmation",
             "operation_type": "DATA_COMPLIANCE_ACK",
             "session_id": null,
             "user_message": "[WARN] 即将创建 ChatBI 智能分析会话……（合规话术原文）",
             "ai_action_required": { "instruction": ..., "rerun_hint": ..., "forbidden": [...] }
           }
         （此时 langdata 后端零调用，不会产生空 session；这是业务状态而非错误）
         ↓
  Step 3: AI 解析 stdout JSON，依据 `status` 字段分支：
         - status == "pending_user_confirmation" → 把 `user_message` 字段
           **原样转述**给用户，等待显式确认
         - status == "session_created" → 直接进入 Step 7（不会出现在本步骤）
         ↓
  Step 4: 判定用户回复：
         ├─ 显式肯定（「确认」「同意」「我已知晓」「继续」等明确字眼）
         │     └─► 进入 Step 5
         ├─ 模糊回复（「嗯」「好」「可以」「OK」等）
         │     └─► 再次澄清，回到 Step 3 等待
         └─ 取消 / 拒绝 / 回避（转移话题）
               └─► [FAIL] 立即终止整条 ChatBI 流程，不要重跑 create-session，
                    更不要调用 analyze
         ↓
  Step 5: 在原 `create-session` 命令末尾追加 `--acknowledged-data-risk`（无值 flag）重跑
         ↓
  Step 6: CLI 放行，stdout 返回 `status: "session_created"` + 真实 session_id
         ↓
  Step 7: 继续调用 analyze（带 session_id + task_id + sql_id + question）
  ```

  **剧本 A 的硬性约束**（必须严格遵守，不得为了省事而违反）：
  1. **原样转述**：stdout JSON 的 `user_message` 字段是给用户看的合规话术，**必须原样转述**，不得改写、精简、合并、翻译或替换措辞。
  2. **禁止替代确认**：仅用户**显式肯定回复**才算确认；模糊回复需再次澄清。**严禁** AI 自行替用户回答、伪造确认状态或在用户尚未回复时直接追加 flag。
  3. **取消即终止**：用户取消、拒绝、回避确认 → 立即终止整条 ChatBI 流程。
  4. **每次新建都需重新确认**：合规卡点**只在 `create-session` 触发**，但每次新建 session 都要走一遍剧本 A，不会因为之前确认过就免除。同一 session 内的所有后续 `analyze` 调用（首次分析、追问、引入新数据）**不会再卡点**。
  5. **不得为绕过合规而错误复用 session**：必须严格按决策树判定是否新建；既不允许「为了少弹一次卡点而错误复用过期/不属于本次场景的 session_id」，也不允许「为了让用户再确认一次而违反决策树强行新建 session」。
  6. **必须按 `status` 字段分支**：解析 `create-session` 的 stdout JSON 时，唯一可信的判定依据是 `status` 字段（`pending_user_confirmation` / `session_created`）。**禁止**依赖退出码区分卡点与成功（卡点退出码也是 0），更**禁止**通过解析 stderr 文本来判定状态。

  **`--acknowledged-data-risk` flag 说明**：
  - 该 flag 仅供 AI 在用户**显式确认后**追加，是 AI 与 CLI 之间的内部协议位，**不向用户暴露**（不要在回复里向用户提及该 flag 名称或让用户「自己加上 flag」）。
  - 该 flag 不持久化、不缓存、不写入任何文件；每次新建 session 都需要一次新的用户确认。
- **Session 复用规则**（决策树 ① ② ③ 的脚注详情，仅作为补充说明）：

  本节列出的所有判定都已被上文【* ChatBI 流程决策树】统一收编，此处仅给出场景与决策树节点的对应关系，便于排查与回溯，**实际执行时一律以决策树为准**。

  | 上下文情况 | 对应决策树节点 | 动作 |
  |---|---|---|
  | 之前没有 session，新拿到 task_id + sql_id | ① 否 | 走剧本 A 新建 session |
  | 之前已有 session，没有新 task_id + sql_id（纯追问） | ② 否 | 直接 analyze（仅 session_id + question），[FAIL] 严禁新建 |
  | 之前已有 session，又拿到新 task_id + sql_id | ③ 询问用户 | 单独分析 → 剧本 A；联合分析 → 直接 analyze 复用 |
  | 用户明确要求「开新会话」 | 兜底允许新建 | 走剧本 A |
  | 已有 session 调用返回过期 / 不存在错误 | 兜底允许新建 | 走剧本 A |

  > **核心原则**：决策树是唯一入口；上表只用于人和 AI 在排查时核对场景，不构成绕过决策树的依据。
- **Session 数据上下文机制**（核心概念）：
  - **一份 task_id + sql_id 对应一份数据**。不同的 task_id / sql_id 可以传入同一个 session_id，ChatBI 会在该 session 的上下文中积累所有传入过的数据，支持跨数据源的联合分析与对比
  - **追问场景无需重复传入 task_id / sql_id**：当某组 task_id / sql_id 已经通过 `analyze` 命令传入过某个 session 后，该 session 已持有这份数据的上下文。后续在同一个 session 内进行追问时，**只需传入 session_id + question 即可**，不需要再次传入 task_id / sql_id（例如用户先请求「数据概要分析」，再追问「按某维度做深入分析」，ChatBI 会自动结合之前的数据上下文）
  - **分析新数据时必须传入新的 task_id / sql_id**：如果通过 sql-execute-analyze 执行了新的 SQL 查询并产出了新的 task_id / sql_id，且用户需要对这份新数据进行分析，则必须在 `analyze` 命令中带上新的 task_id / sql_id，将新数据注入到 session 上下文中。传入后，该 session 就同时持有新旧数据，支持后续的联合分析或单独追问

## 工作流程

### 前置步骤：凭证检查与配置

本 Skill 的所有命令均已通过 `@auth_required` 装饰器内置凭证检查。**无需再手动读取 `security_file/config.json`**：

- **凭证已配置且有效时**：命令正常执行。
- **凭证缺失或无效时**：命令会自动输出引导文案（含 CMK 下载地址），**直接将该引导文案转述给用户**，并引导用户通过 `do-bigdata auth init` 进行配置。**禁止**将 CLI 的原始报错堆栈暴露给用户。
- 凭证存储与加载采用三级 fallback（环境变量 → 加密文件 → 明文文件），由中间件自动处理。**ChatBI 与 sql-execute-analyze 共享同一份凭证，配置一次即可两个技能通用。**

**用户提供 CMK 文件内容的处理**：当用户粘贴 CMK JSON 文件（含 `subject`、`key`、`id` 字段）时，静默执行：

```
do-bigdata auth init --from-json '<CMK JSON 文件内容>'
```

配置成功后只告知「凭证配置成功」，然后继续处理用户原始问题。

**引导文案**（仅在凭证缺失/失效时使用，不要暴露命令细节）：

> 需要先配置 CMK 凭证才能使用 ChatBI 数据分析功能：
>
> **CMK 密钥获取方式：**
> 1. 访问 https://wedata.woa.com/security/user/keys 下载个人 CMK 文件
> 2. 打开下载的文件，找到 `"key"` 字段的值即为 CMK
>    文件格式示例: `{"id":...,"subject":"xxx","key":"这里就是CMK","type":"cmk",...}`
>
> 请直接在对话中回复您的 CMK 文件内容（或单独提供 RTX 和 CMK），我会自动帮您完成配置。

如果用户的问题**不需要调用工具**（如纯概念性咨询等），则跳过此检查，直接回答。

### 端到端数据分析流程（与 sql-execute-analyze 串联）

当用户需要"执行 SQL 并分析结果"时：

1. **执行 SQL**（使用 sql-execute-analyze 技能）：提交 SQL → 轮询状态 → 任务成功 → 拿到 `task_id` + `sql_id`
2. **进入 ChatBI**：[WARN] **严格按上文【* ChatBI 流程决策树】判定动作**（直接 analyze / 走剧本 A / 终止），不要在此处自行复述判定逻辑
3. **展示结果**：将 ChatBI 返回的分析结果以结构化方式展示给用户，并在末尾输出[KEY]关键信息块
4. **后续追问 / 引入新数据**：每一轮都重新走一次决策树（绝大多数追问会落到 ② 否，直接 analyze；引入新数据会落到 ③）

### 仅数据分析流程（已有 task_id 和 sql_id）

当用户已有 SQL 查询结果（直接提供了 `task_id` 和 `sql_id`）时：

1. **进入 ChatBI**：[WARN] **严格按上文【* ChatBI 流程决策树】判定动作**
2. **展示结果 + 输出[KEY]关键信息块**
3. **后续追问 / 引入新数据**：每一轮都重新走一次决策树

> [WARN] **重要约束**：`analyze` 命令中的 `--task-id` 和 `--sql-id` 对应的 SQL 任务**必须是 success 状态**的。如果 SQL 任务尚未成功，ChatBI 将无法读取到结果数据。请务必先通过 sql-execute-analyze 的 `query-status` 确认任务成功后，再使用 ChatBI 进行分析。

## CLI 命令

本 Skill 与 sql-execute-analyze 共用 `do-bigdata wedata` 子系统 group，所有命令会自动完成凭证加载、使用回传。

**支持的 2 个原子命令**:

| 命令 | 功能 | 示例 |
|------|------|------|
| `create-session` | 创建分析会话 | `do-bigdata wedata create-session --query "<用户原始问题>"` |
| `analyze` | 数据分析 | `do-bigdata wedata analyze --session-id <ID> --question "分析趋势" --task-id <TASK_ID> --sql-id <SQL_ID> --query "<用户原始问题>"` |

**在工作流中的使用**：[WARN] 一律以上文【* ChatBI 流程决策树】为准。决策树会将本轮指向以下三种动作之一，AI 据此发起对应命令并给出进度反馈：

| 决策树指向 | 实际命令 | 进度文案示例 |
|---|---|---|
| 直接 analyze（追问 / 联合分析） | `analyze`（仅 session_id + question，或带新 task_id + sql_id） | 「正在进行数据分析，请稍候...」 |
| 走剧本 A | `create-session` → 收到 `pending_user_confirmation` JSON → 原样转述 user_message 给用户 → 用户确认 → 追加 flag 重跑收到 `session_created` → `analyze` | 「正在创建分析会话...」→（合规确认）→「分析会话已创建 ✓」→「正在进行数据分析，请稍候...」 |
| 终止 | 不发起任何命令 | 直接终止，不调用 analyze |

**通用参数**（所有命令均支持）：

| 参数 | 说明 |
|------|------|
| `--query` / `-q` | 用户原始问题（AI 必传，用于使用回传） |
| `--output` / `-o` | 输出格式（`text` / `json` / `markdown`，默认 `text`） |

**命令参数详细说明**：

`analyze` 参数：

| 参数 | 必填 | 默认值 | 说明 |
|------|:--:|:------:|------|
| `--session-id` | 是 | — | 会话 ID，由 `create-session` 返回 |
| `--question` | 是 | — | 分析问题或提示，如「分析这份数据的趋势」「找出异常值」。[WARN] **禁止传入原始明细数据获取类问题**（如「获取原始明细数据」「导出数据」等），此类请求会被工具拦截拒绝 |
| `--task-id` | 否 | — | SQL 任务 ID，由 sql-execute-analyze 的 `run-task` 返回。**必须与 `--sql-id` 成对使用** |
| `--sql-id` | 否 | — | SQL 子任务 ID，由 sql-execute-analyze 的 `query-status` 返回。**必须与 `--task-id` 成对使用** |
| `--deep-thinking` | 否 | 关闭 | 启用深度思考模式。开启后分析更详细，但耗时显著增加 |

> [TIP] **提示**：`--task-id` 和 `--sql-id` 必须成对使用。当同时提供时，ChatBI 会读取对应的 SQL 查询结果数据并注入到 session 上下文中进行分析。不提供时，ChatBI 会基于当前 session 已有的数据上下文进行追问分析（适用于多轮追问场景），或进入纯对话模式回答通用问题。仅提供一个将会报错。

### 凭证配置

- 统一通过 `do-bigdata auth init` 配置，与 sql-execute-analyze 共享同一份凭证
- 三级 fallback 加载：环境变量 → 加密文件 `security_file/config.json.enc` → 明文文件 `security_file/config.json`

## 参考文档

本 Skill 使用 `do-bigdata wedata` CLI 命令完成所有 ChatBI 操作，**当前不含额外的参考文档文件**。如后续补充 references，可通过以下命令查阅：

```bash
do-bigdata docs list --skill chatbi
do-bigdata docs show --skill chatbi --file <guide文件名>.md
```

## 关键参考链接

| 资源 | URL |
|------|-----|
| WeData 平台 | https://wedata.woa.com |
| WeData 数据探索 | https://wedata.woa.com/explore |
| CMK 密钥下载 | https://wedata.woa.com/security/user/keys |

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
