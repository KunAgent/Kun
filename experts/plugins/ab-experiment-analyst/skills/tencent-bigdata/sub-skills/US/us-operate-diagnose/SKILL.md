---
name: us-operate-diagnose
description: US（统一调度）任务和实例操作工具。任务类操作：创建任务、上传脚本、创建依赖、冻结任务、解冻任务、修改任务、复制任务。实例类操作：补录（自动分批）、回溯（自动路由WeData/US接口）、重跑（自动分批+异步轮询结果）、终止实例、强制成功。触发关键词：创建任务、上传脚本、创建依赖、冻结任务、解冻任务、修改任务、复制任务、任务补录、任务回溯、重跑实例、终止实例、kill实例、强制成功。
---

# US 任务/实例操作工具

## 概述

提供 US（统一调度/Unified-Scheduler）平台的任务级别和实例级别操作能力。通过封装 US API，支持任务全生命周期管理和实例运维操作。

**适用场景**：
- 任务管理：创建任务、上传脚本、创建依赖、冻结/解冻、修改任务、复制任务
- 实例运维：补录实例、回溯任务、重跑实例、终止实例、强制成功

## 强制输出规则（铁律）

> **[WARN] 每次给用户输出操作结果、回答咨询、给出方案后，回复的最末尾必须附加以下内容（加粗高亮，不可省略）：**
>
> **[WARN] 如果US或WeData使用上有任何问题，可以直接联系 kimlinlin**
>
> 无论操作成功还是失败，无论是完整报告还是简短回复，都必须在最后一行输出此提示。

## 执行规则

> ### * 多地域（Namespace）规则
>
> **环境识别**：执行任何操作前，必须先识别 namespace：
> - 链接含 `us-sg.woa.com` 或 `wedata-sg.woa.com` → namespace=sg（新加坡）
> - 用户明确声明"新加坡环境/SG 环境"等（即使未提供 SG 域名链接） → namespace=sg（新加坡）
> - 其他 → namespace=default（国内）
> - 若链接域名与用户声明冲突（如声明 SG 但提供国内域名链接），以链接为准并提示用户确认
>
> **运行前声明**：识别完毕后输出环境声明：`* 当前环境：国内（default）` 或 `* 当前环境：新加坡（sg）`
>
> **参数传递**：当 namespace=sg 时，**所有** `do-bigdata us` 命令**必须**附加 `--skill-namespace sg` 参数，**包括 `execute-*` 命令**。
>
> [WARN] **易错点**：`execute-freeze`、`execute-unfreeze`、`execute-redo` 等 execute 阶段的命令也**必须**带 `--skill-namespace sg`，不能因为 `--prepared-data` 中已有 namespace 字段就省略。缺少该参数会导致认证走错环境（国内 token 打到海外 API），最终报 CMK 密钥无效或认证失败。
>
> **示例**：
> ```
> # [OK] 正确：execute 也带了 --skill-namespace sg
> do-bigdata us execute-freeze --prepared-data '{"namespace":"sg",...}' --skill-namespace sg --query "冻结任务"
>
> # [FAIL] 错误：execute 缺少 --skill-namespace sg，认证会失败
> do-bigdata us execute-freeze --prepared-data '{"namespace":"sg",...}' --query "冻结任务"
> ```

> ### [ALERT] 安全规则（违反任何一条视为执行失败）
>
> **规则 1：操作前必须确认** — 所有写操作在执行前**必须向用户确认操作参数和影响范围**，得到用户明确确认后才能执行。
>
> [WARN] **强制约束：`prepare-*` 和 `execute-*` 禁止出现在同一轮 AI 回复中。** AI 调用 `prepare-*` 展示确认表格后，必须结束本轮回复并等待用户在下一条消息中确认。"用户意图明确"、"只有1个实例"、"参数简单" 等都不是跳过确认的理由。
>
> **规则 1.0：`requires_user_confirmation` 程序级确认拦截** — 所有 `prepare-*` 命令的返回值中包含以下三个确认拦截字段：
>
> | 字段 | 类型 | 说明 |
> |------|------|------|
> | `requires_user_confirmation` | `bool` | **始终为 `true`** — 表示 AI 必须停止本轮操作，等待用户确认 |
> | `risk_level` | `str` | 风险等级：`"high"` (≥100个) / `"medium"` (≥10个) / `"low"` (<10个) |
> | `affected_count` | `int` | 预估受影响的实例/任务数量 |
>
> **AI 处理规则**：
> - 当返回值中 `requires_user_confirmation == true` 时，**必须立即停止本轮回复**，将确认信息展示给用户
> - 当 `risk_level == "high"` 时，必须在确认信息中**突出显示高风险警告**和影响数量
> - **绝对禁止**在收到 `requires_user_confirmation: true` 后继续调用 `execute-*` 命令
>
> **规则 1.1：创建任务 — 渐进式参数收集与硬卡点确认流程**
>
> * 完整的创建任务流程规则（跨流程隔离、三道门禁、必填参数清单、执行流程、结果展示规范）请参阅：`do-bigdata docs show --skill us-operate-diagnose --file create-task-flow.md`
>
> ---
>
> **规则 1.2：上传脚本 — 渐进式参数收集与四步确认流程**
>
> * 完整的上传脚本流程规则（跨流程隔离、四道门禁、必填参数清单、执行流程、结果展示规范）请参阅：`do-bigdata docs show --skill us-operate-diagnose --file upload-script-flow.md`
>
> * **fileType 选择铁律**：必须根据**任务类型（taskType）**选择 fileType，**严禁**根据上传文件的扩展名推断。典型陷阱：PySpark 任务的脚本文件是 `.py`，但 fileType 必须是 `jar`（不是 `pysql`）。详见 `upload-script-flow.md` 中的映射表。
>
> ---
>
> **规则 2：隐藏执行细节** — 不向用户暴露底层命令行、原始 JSON 响应等技术细节，只展示结构化的操作结果。
>
> **规则 3：凭证前置检查** — 执行任何操作前，必须先验证 CMK 凭证有效。凭证检查失败时，引导用户配置凭证（CMK 获取地址：https://wedata.woa.com/security/user/keys）。
>
> **规则 4：重跑方式确认** — 执行重跑操作前，必须向用户展示以下 5 个重跑方式选项，让用户选择（默认 `11`）：
>
> | param | 含义 |
> |-------|------|
> | `11` | 仅重跑当前任务，检查父任务状态（**默认**） |
> | `12` | 仅重跑当前任务，不检查父任务状态（直接调起） |
> | `21` | 重跑当前任务及其子任务，检查父任务状态 |
> | `22` | 重跑当前任务及其子任务，不检查父任务状态 |
> | `31` | 仅重跑子任务，检查父实例状态 |
>
> [WARN] **禁止**将 `param` 简化为"1/2/3"或"是否重跑下游"这样的简化问题——必须完整展示 5 个选项，因为"是否检查父任务"是独立维度，不可省略。
>
> **展示话术**（直接使用，禁止简化）：
> ```
> 请选择重跑方式：
> - 11（默认）：仅当前任务，检查父任务状态
> - 12：仅当前任务，不检查父任务（直接调起）
> - 21：当前任务 + 子任务，检查父任务状态
> - 22：当前任务 + 子任务，不检查父任务（直接调起）
> - 31：仅重跑子任务，检查父实例状态
> ```
>
> **规则 4.1：回溯方式确认** — 执行回溯（backtrack）操作前，必须向用户展示以下 4 个回溯方式选项，让用户选择（默认 `11`）：
>
> | param | 含义 |
> |-------|------|
> | `11` | 仅回溯当前任务，检查父任务状态（**默认**） |
> | `12` | 仅回溯当前任务，不检查父任务状态（直接调起） |
> | `21` | 回溯当前任务及其下游，检查父任务状态 |
> | `22` | 回溯当前任务及其下游，不检查父任务状态（直接调起） |
>
> [WARN] **禁止**将 `param` 简化为"是否回溯下游"这样的 Yes/No 问题——必须完整展示 4 个选项，因为"是否检查父任务"是独立维度，不可省略。
>
> **展示话术**（直接使用，禁止简化）：
> ```
> 请选择回溯方式：
> - 11（默认）：仅当前任务，检查父任务状态
> - 12：仅当前任务，不检查父任务（直接调起）
> - 21：当前任务 + 下游任务，检查父任务状态
> - 22：当前任务 + 下游任务，不检查父任务（直接调起）
> ```
>
> **规则 5：必须通过 do-bigdata CLI 执行操作** — 所有任务和实例操作**必须通过 `do-bigdata us` CLI 命令执行**（如 `do-bigdata us create-task --config xxx --query "..."`），**严禁使用 `python3 -c` 内联代码直接 import 函数调用，也严禁直接 `python3 xxx.py` 执行脚本**。CLI 入口已封装了完整的参数校验、认证流程和使用回传。
>
> **典型场景**：
> - [FAIL] 错误：`python3 -c "from us_task_operate_api import create_task; ..."`
> - [FAIL] 错误：`python3 us_task_operate_api.py create-task --config xxx`
> - [OK] 正确：`do-bigdata us create-task --config xxx --query "创建任务"`
> - [FAIL] 错误：通过 `-c` 拼接任意 Python 代码调用底层 API 函数
> - [OK] 正确：始终使用 `do-bigdata us` 提供的 CLI 子命令和参数

- **隐藏所有执行细节**：整个操作过程中，不要向用户暴露任何底层操作痕迹：
  - 回复文本中**不要提及或展示**任何命令行指令
  - 调用 `execute_command` 工具时，`explanation` 字段使用简短的中文描述
  - **不要展示原始 JSON 输出**，只提取关键信息以结构化方式呈现

> **规则 6：实例操作前置查询任务信息** — 执行补录、重跑、终止、强制成功等实例级操作时，在收集参数**之前**必须先调用 `query-task` 查询任务信息，获取调度周期、负责人、生效日期等，然后：
>
> 1. **根据调度周期给出合理的时间范围示例**（如小时任务示例按天、天任务示例按天/周、周任务示例按周/月等）
> 2. **根据任务特征提供更有针对性的建议**（如生效日期、任务状态等，帮助用户确定合理的操作范围）
>
> **前置查询步骤**（在各流程 Step 1 之前执行）：
>
> | 序号 | 动作 | 说明 |
> |------|------|------|
> | 0.1 | 调用 `query-task --task-id <taskId>` | 获取任务详情（调度周期、负责人、生效日期、任务状态等） |
> | 0.2 | 展示任务基本信息 | 以表格形式展示关键字段：任务名、任务类型、调度周期、负责人、生效日期、任务状态。若展示上游/下游依赖关系，只展示「任务ID、任务名、负责人、依赖类型」，**不要展示偏移量（offset）** |
> | 0.3 | 基于任务信息智能提示 | 给出时间范围示例、提示生效日期约束等 |
>
> **操作人自动获取规则**：所有需要「操作人/操作者」参数的场景（如重跑的 `--user`、强制成功的 `--user`、创建依赖的 `--in-charge`、上传脚本的 `rtxName`、创建任务的 `creater`、修改任务的 `modifier`），**一律直接使用当前 CMK 凭证中的用户名**（即 `security_file/config.json` 中的 `user` 字段），无需向用户询问或要求用户提供。
>
> **智能提示规则**：
>
> | 调度周期 | 时间范围示例格式 | 说明 |
> |---------|----------------|------|
> | 分钟 (I) | `2026-04-16 00:00:00 ~ 2026-04-16 23:00:00` | 分钟任务需精确到小时，格式 `YYYY-MM-DD HH:00:00` |
> | 小时 (H) | `2026-04-16 00:00:00 ~ 2026-04-16 23:00:00` | 小时任务需精确到小时，格式 `YYYY-MM-DD HH:00:00` |
> | 天 (D) | `2026-04-10 ~ 2026-04-16` | 天任务可按天或按周指定 |
> | 周 (W) | `2026-04-06 ~ 2026-04-13` | 周任务按周指定 |
> | 月 (M) | `2026-03-01 ~ 2026-04-01` | 月任务按月指定 |
>
> *注：示例中的日期应根据当前日期和任务生效日期动态生成，不使用硬编码日期。*
>
> **补录操作的生效日期约束（[WARN] 易错点，仅限补录）**：
>
> 补录的目的是为**早于生效日期**的历史时间段生成实例。补录 = 补历史数据，所以时间范围一定在生效日期**之前**。
> - [OK] 正确理解：补录的时间范围必须**早于**生效日期（即 from_date < startDate 且 to_date < startDate）
> - [FAIL] **绝对禁止**：提示用户"补录日期必须 ≥ 生效日期"——这完全是反的！补录是补**过去**的数据，不是未来的
> - 如果用户提供的补录范围包含了 ≥ 生效日期的日期，**静默自动**将结束日期调整为**生效日期前一天**（剔除 ≥ 生效日期的部分），这是正常的历史数据补录场景，**不需要告警、不需要提示用户确认**
> - [FAIL] **错误话术举例（全部禁止）**：
>   - ~~补录日期必须 ≥ 生效日期~~ ← 完全反了
>   - ~~补录日期不能早于生效日期~~ ← 完全反了
>   - ~~开始日期必须 ≥ 生效日期~~ ← 完全反了
>
> **[WARN] 重要：生效日期约束仅适用于「补录」操作！重跑、终止、强制成功等操作的时间范围不受任务生效日期限制，用户指定什么范围就用什么范围，禁止基于生效日期自动调整。**
>
> **小时/分钟任务时间格式补齐规则**：
>
> 当任务调度周期为 **小时 (H)** 或 **分钟 (I)** 时，实例时间必须精确到小时（`YYYY-MM-DD HH:00:00`）。具体处理：
>
> 1. **用户提供精确时间**（如 `2026-04-16 08:00:00 ~ 2026-04-16 12:00:00`）→ 直接使用
> 2. **用户仅提供日期**（如 `2026-04-16`）→ AI 自动补齐为该天的全时间范围 `2026-04-16 00:00:00 ~ 2026-04-16 23:00:00`，并在参数确认阶段展示给用户确认，**不可直接执行**
> 3. **用户提供日期范围**（如 `2026-04-15 ~ 2026-04-16`）→ AI 自动补齐为 `2026-04-15 00:00:00 ~ 2026-04-16 23:00:00`，并展示给用户确认
>
> **确认话术示例**：
> > 该任务为小时级调度，时间需精确到小时。已将您提供的日期自动补齐为：
> > - **开始时间**: `2026-04-16 00:00:00`
> > - **结束时间**: `2026-04-16 23:00:00`
> >
> > 请确认以上时间范围，或提供更精确的小时范围（如 `2026-04-16 08:00:00 ~ 2026-04-16 12:00:00`）。

## 操作能力

### 任务级操作（us_task_operate_api.py）

| 操作 | 函数 | API 接口 | 功能说明 |
|------|------|---------|---------|
| 创建任务 | `prepare_create_task` + `execute_create_task` | `LhotseTask` (POST) | 两阶段操作：prepare 校验参数并展示确认表格，execute 执行创建 |
| 校验上传参数 | `validate_upload_params` | — | 校验上传脚本的参数完整性和合法性 |
| 检查脚本存在 | `check_script_exist` | `script/exist` (GET) | 检查指定脚本是否已存在于 US 平台 |
| 上传脚本 | `upload_script` | `UserUpLoad` (POST multipart) | 上传脚本文件到 US 平台 |
| 创建依赖 | `create_dependency` | `AddOrUpdateLink` (POST) | 在两个任务间建立父子依赖关系 |
| 冻结/解冻任务 | `prepare_freeze/unfreeze` + `execute_freeze/unfreeze` | `task/freeze` / `task/unfreeze` (PUT) + `QueryTask` (GET) | 两阶段操作：冻结时自动查询每个任务的 ID/名称/负责人 并展示给用户确认；超过 10 个任务自动分批执行（每批最多10个）；执行完成后汇总展示成功/失败任务数。详见流程规则 |
| 修改任务 | `prepare_modify_task` + `execute_modify_task` | `LhotseUpdate` (POST) | 两阶段操作，详见流程规则。**告警自动补全**: 当任务已有告警配置且用户只修改部分告警参数时，自动查询当前配置并补全未提供的必填参数，避免校验失败；参数确认表格区分「用户修改」和「自动保持」；更新成功后仅展示用户修改字段的前后对比 |
| 复制任务 | `prepare_copy_task` + `execute_copy_task` | `task/copy` (PUT) | 两阶段操作：prepare 校验参数、查询任务信息并展示确认表格，execute 执行复制；支持批量（超过 10 个自动分批）；**必须先询问用户是否复制依赖关系**（addlink），用户明确回复后再调用 prepare；返回 `{原任务ID → 新任务ID}` 映射 |
| 查询任务类型 | `query_task_type` | `QueryTask` (GET) | 通过任务ID查询任务的 taskType |
| 查询告警配置 | `query_task_alert_config` | `QueryTask` (GET) | 查询任务的告警配置（超时告警/错误告警），返回当前配置状态和格式化展示表格 |
| 获取扩展参数列表 | `get_task_ext_params` | — (本地查询) | 根据 taskType 返回可修改的扩展参数 |

* 冻结/解冻、修改任务、复制任务的完整调用流程（两阶段调用、参数记忆规则、taskExt 扩展参数处理、分批执行规则）请参阅：`do-bigdata docs show --skill us-operate-diagnose --file task-modify-freeze-flow.md`

### 实例级操作（do-bigdata us instance）

| 操作 | 函数 | API 接口 | 功能说明 |
|------|------|---------|---------|
| **路由预判断** | `determine_backtrack_route` | `QueryTask` (GET) | 根据任务 ID 判断走 register 还是 backtrack，**必须在收集参数前调用** |
| 补录实例 | `prepare_register` + `execute_register` | `task/do` (PUT) | 两阶段操作，自动按周期类型分批 |
| 回溯任务 | `prepare_backtrack` + `execute_backtrack` | WeData `BacktrackTask` (POST) | 两阶段操作，自动路由（见下方路由规则） |
| 重跑实例 | `prepare_redo` + `execute_redo` | WeData `RedoInstances` (POST) | 两阶段操作，使用 WeData OpenAPI v2 同步接口 |
| 终止实例 | `prepare_kill` + `execute_kill` | `taskrun/kill` (POST) | 两阶段操作 |
| 强制成功 | `prepare_force_success` + `execute_force_success` | `LetTaskInstances` (POST) | 两阶段操作 |

> **回溯/补录统一路由规则**（由 `determine_backtrack_route` 自动判断）：
>
> [WARN] **补录和回溯含义相同**，无论用户说"补录"还是"回溯"，系统都会根据任务 ID 长度和 projectId 自动路由到对应接口：
>
> | 任务类型 | 任务 ID 长度 | projectId | 使用接口 |
> |---------|------------|-----------|----------|
> | 纯 WeData 任务 | **17 位** | 用户必须提供 | WeData 回溯接口 (`prepare_backtrack`) |
> | US 任务 + 有项目 ID | **18 位** | [OK] 自动从 QueryTask 查询 | WeData 回溯接口 (`prepare_backtrack`) |
> | US 任务 + 无项目 ID | **18 位** | [FAIL] 查不到 | US 补录接口 (`prepare_register`) |
>
> [PIN] **先路由、再收参数**（[WARN] 必须遵守的流程顺序）：
>
> 补录和回溯的**参数格式不同**（补录用 `reg_children`/`check_parent` 布尔值，回溯用 `param` "11"/"12"/"21"/"22"），
> 因此 AI 必须在**向用户收集操作参数之前**先完成路由判断，才能按正确的参数格式引导用户：
>
> | 步骤 | 动作 | 说明 |
> |------|------|------|
> | **Step 0** | 调用 `do-bigdata us determine-route --task-id <id>` | 预判断走 register 还是 backtrack |
> | **Step 1** | 根据路由结果向用户收集参数 | register → 询问 `reg_children`/`check_parent`；backtrack → **必须展示 param 四选一选项**(11/12/21/22)，见规则 4.1 |
> | **Step 2** | 调用对应的 `prepare-register` 或 `prepare-backtrack` | 参数直接对应，无需格式转换 |
> | **Step 3** | 展示确认表格，等待用户确认后调用 execute | 按 `operation` 字段调用对应的 execute 命令 |
>
> [WARN] **禁止反过来**：不要先按某种格式问用户参数，然后在 prepare 内部路由转发时强行转换参数——这会导致语义丢失（如回溯支持 param="31" 仅子任务，补录参数无法表达）。
>
> [PIN] **兜底自动转发**（防御性编程，正常流程不应触发）：
> - `prepare_backtrack` 内部仍保留：如果路由判断为 register，自动转发到 `prepare_register`
> - `prepare_register` 内部仍保留：如果路由判断为 backtrack，自动转发到 `prepare_backtrack`
> - 转发后的返回值包含 `auto_routed_from` 字段标记来源，以及实际 `operation` 字段标记最终使用的接口

> **[WARN] 执行任何实例级操作前，AI 必须先加载 `instance-operate-flow.md` 文档，严格按其 Step 0 ~ Step 5 流程执行，不可仅依赖 SKILL.md 主文件中的摘要描述。**

* 补录、回溯、重跑、终止、强制成功的完整调用流程（两阶段调用、参数记忆规则）请参阅：`do-bigdata docs show --skill us-operate-diagnose --file instance-operate-flow.md`

* **【必读】** 各操作的详细注意事项（终止轮询策略、强制成功轮询策略、重跑方式选项、分批限制）请参阅：`do-bigdata docs show --skill us-operate-diagnose --file operation-notes.md`

## CLI 命令

* CLI 命令完整参考（任务级/实例级命令列表、参数说明、调用示例）请参阅：`do-bigdata docs show --skill us-operate-diagnose --file cli-reference.md`

### 共享依赖

所有命令通过 `do-bigdata us` 命令组统一入口执行，凭证由 `@auth_required` 装饰器自动管理。

### 凭证配置

凭证由 CLI 的 `@auth_required` 装饰器自动管理。首次使用通过 `do-bigdata auth init` 配置，支持三级 fallback（环境变量 → 加密文件 → 明文文件）。

CMK 密钥获取：https://wedata.woa.com/security/user/keys


## 关键参考链接

| 资源 | URL |
|------|-----|
| US 平台 | https://us.woa.com |
| US API 文档 | https://iwiki.woa.com/p/195788408 |
| US API 鉴权指南 | https://iwiki.woa.com/p/195788180 |
| 任务管理 | https://iwiki.woa.com/p/188168816 |
| 任务补录 | https://iwiki.woa.com/p/1099375777 |
| 实例重跑 | https://iwiki.woa.com/p/188168816 |
| 系统冻结 | https://iwiki.woa.com/p/1172633957 |
| 冻结/解冻接口 | https://iwiki.woa.com/p/871785594 |
| 创建/修改任务接口 | https://iwiki.woa.com/p/195788429 |
| 复制任务接口 | https://iwiki.woa.com/p/1971587540 |
| 告警参数说明 | https://iwiki.woa.com/p/352545625 |

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
