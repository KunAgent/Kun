---
name: explore-log-analyzer
description: "WeData 数据探索任务诊断技能。当用户提供一条数据探索任务的日志链接（WeData 控制台日志页 https://wedata.woa.com/explore/task/log/... 或 SuperSQL QE 原始 apilog 链接 https://ss-qe-log.woa.com/v1/session/explore_apilog_...），希望诊断该任务为什么失败、慢或异常时使用此技能。本技能的核心职责是：从日志链接解析出 WeData TaskId → 调用 explore-query-session 接口换取底层 SuperSQL SessionId → 转交给 supersql-job-analyzer 完成根因诊断。本技能本身不做诊断推理，只负责链路串联。"
---

# WeData 数据探索任务日志诊断

## 概述

WeData 数据探索（https://wedata.woa.com/explore）的每个 SQL 任务都会生成一条日志链接。当前支持的两种链接形态：

| 形态 | 示例 | 说明 |
|------|------|------|
| WeData 控制台日志页 | `https://wedata.woa.com/explore/task/log/{TaskId}/{SqlId}/{ts}/sql/{status}/{trigger}` | 用户在 WeData 控制台「查看日志」按钮点击后生成的链接 |
| SuperSQL QE 原始 apilog | `https://ss-qe-log.woa.com/v1/session/explore_apilog_{TaskId}` | QE 后端原始日志页直链，URL 中 `explore_apilog_` 之后整段就是 TaskId |

> 例如 `https://ss-qe-log.woa.com/v1/session/explore_apilog_c07eb766-0d2f-4841-8b1a-65a8c8621702-sQHizu9A` 对应的 TaskId 即为 `c07eb766-0d2f-4841-8b1a-65a8c8621702-sQHizu9A`。

用户拿到的是 WeData 层面的 `TaskId`，但真正能够用于诊断的是底层 SuperSQL 的 `SessionId`（UUID 格式）。本技能负责把日志链接「翻译」为 SuperSQL SessionId，并直接驱动 `supersql-job-analyzer` 完成根因诊断。

## 适用场景

- 用户粘贴一条 `https://wedata.woa.com/explore/task/log/...` 链接，问「这个任务为什么失败 / 为什么慢 / 帮我看下问题」
- 用户粘贴一条 `https://ss-qe-log.woa.com/v1/session/explore_apilog_...` 链接（SuperSQL QE 原始日志页），希望诊断该任务
- 用户已经拿到 WeData TaskId（形如 `0d5004500627d43d9e867e2fa1c5d93d-aAg1gVNO` 或 `c07eb766-0d2f-4841-8b1a-65a8c8621702-sQHizu9A`），希望进一步诊断
- 用户描述「数据探索任务出错」「探索 SQL 跑挂了」等场景但没有手动提取 SessionId

## 不适用场景（请改用其他技能）

| 用户诉求 | 应使用的技能 |
|---------|------------|
| 想执行一条新的 SQL / 看结果 | `sql-execute-analyze` |
| SQL 还没跑，需要事前预检 | `sql-prediagnosis` |
| 已经手里有 SuperSQL SessionId（UUID）且没有 WeData 链接 | 直接走 `supersql-job-analyzer` |
| 想分析查询结果的数据本身 | `chatbi` |

## 工作流程

> [NO] **强制铁律（最高优先级，必须遵守）：**
>
> **只要用户输入命中以下任一 URL 形态，必须先调用本技能（explore-log-analyzer）通过 `do-bigdata wedata explore-query-session` 拿到 UUID 格式的 SessionId，再转交 supersql-job-analyzer。绝对禁止跳过本技能直接把 URL 里的字符串当 SessionId 喂给 supersql-job-analyzer。**
>
> | 输入形态 | URL 路径里那段字符串的真实身份 |
> |---------|---------------------------|
> | `https://wedata.woa.com/explore/task/log/{X}/...` | `{X}` 是 **WeData TaskId**，不是 SessionId |
> | `https://ss-qe-log.woa.com/v1/session/explore_apilog_{X}` | `explore_apilog_` 后的 `{X}` 是 **WeData TaskId**，不是 SessionId |
>
> SuperSQL SessionId 只能是严格 UUID 格式（`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`），上述 URL 中的 TaskId 形如 `c07eb766-0d2f-4841-8b1a-65a8c8621702-sQHizu9A`（带尾缀），**两者长得像但完全不同**，把 TaskId 当 SessionId 用会拉到错误/空日志，浪费一轮诊断。
>
> **唯一正确的链路**：URL → 本技能 `explore-query-session` → SessionId(UUID) → supersql-job-analyzer。

### 步骤 1：识别并提取输入

接受以下任一形式的输入：

1. **WeData 控制台日志链接**：`https://wedata.woa.com/explore/task/log/{TaskId}/...`
2. **SuperSQL QE apilog 链接**：`https://ss-qe-log.woa.com/v1/session/explore_apilog_{TaskId}`
3. **裸 TaskId**：用户直接粘贴 `0d5004500627d43d9e867e2fa1c5d93d-aAg1gVNO` 或 `c07eb766-0d2f-4841-8b1a-65a8c8621702-sQHizu9A` 这种形式

CLI 内部正则会自动从两种 URL 中提取 TaskId（不需要在对话里手工字符串切割）。

如果用户输入既不是合法 URL 也不是 TaskId，向用户索要日志链接。**禁止**让用户去手动找 SessionId（这正是本技能要解决的痛点）。

### 步骤 2：调用 explore-query-session 换取 SessionId

通过 CLI 完成，**不要**使用 `web_fetch` 直接抓取 WeData 页面或 ss-qe-log 页面（需要 OA 登录会失败）：

```bash
# 方式 A：直接给 URL（两种链接形态都支持），CLI 内部解析 TaskId
do-bigdata wedata explore-query-session \
  --url "<用户提供的日志链接>" \
  --query "<用户原始问题>"

# 方式 B：用户已经给了 TaskId
do-bigdata wedata explore-query-session \
  --task-id "<TaskId>" \
  --query "<用户原始问题>"
```

返回示例（JSON 模式）：

```json
{
  "TaskId": "c07eb766-0d2f-4841-8b1a-65a8c8621702-sQHizu9A",
  "SessionId": "df0e3d4f-63f1-421f-a750-fd234c9e9cf9"
}
```

**关键提取**：拿到响应中的 `SessionId` 字段（UUID 格式），它就是后续 `supersql-job-analyzer` 需要的入参。

> 凭证不需要单独配置：本命令复用 `do-bigdata auth init` 配置的 CMK，由 `@auth_required` 中间件自动注入。如果命令报缺凭证，按引导走 `do-bigdata auth init` 即可。

### 步骤 3：转交 supersql-job-analyzer 进行诊断

拿到 `SessionId` 后，**立即按 supersql-job-analyzer 的工作流执行根因诊断**。本技能不做任何诊断推理，全部交给下游技能：

参考 `do_skills/sub-skills/SuperSQL/supersql-job-analyzer/SKILL.md` 的「步骤 2：一键拉取并解析多层日志」开始执行，典型起手命令为：

```bash
do-bigdata supersql slow-query-analyze \
  --session-id "<SessionId>" \
  --summary --pretty \
  --query "<用户原始问题>"
```

如需并行触发外部诊断脚本，按 supersql-job-analyzer 的「步骤 7」并行调用 `do-bigdata supersql job-analyze`。

### 步骤 4：输出最终诊断结论

完全遵循 `supersql-job-analyzer` 的输出规范（异常类型 / 根因 / 解决方案 / 调用链路）。在结论顶部追加一段映射信息，方便用户回溯：

```
[LINK] 链路映射
- WeData TaskId : <TaskId>
- SuperSQL SessionId : <SessionId>
- 原始日志链接 : <用户给的 URL>
```

## 执行规则

- **隐藏底层细节**：调用 `execute_command` 时 `explanation` 用简短中文（如「解析任务日志链接」「拉取 SuperSQL 会话日志」），**不要**把命令行原文展示给用户
- **分步反馈**：拆为至少两个明显阶段——
  1. 「正在解析日志链接，定位底层会话…」 → 完成后回「会话定位完成 ✓ SessionId=…」
  2. 「正在拉取 SuperSQL 多层日志并进行诊断…」 → 由下游 supersql-job-analyzer 接管
- **禁止手动拼 URL**：所有日志/会话 URL 拼装均封装在 CLI 中，不要在对话里 `curl http://bigdataskill-openapi.woa.com/...` 之类
- **禁止用 web_fetch 请求 wedata.woa.com / ss-qe-log.woa.com**：内网域名需 OA 登录，必失败；唯一正确路径是 `do-bigdata wedata explore-query-session` + `do-bigdata supersql ...`
- **凭证策略**：与其他 WeData 子技能共享同一份 CMK，无需为本技能单独配置

## CLI 命令一览

| 命令 | 作用 |
|------|------|
| `do-bigdata wedata explore-query-session --url <log_url> [-o json]` | 解析 WeData 日志链接 / ss-qe-log apilog 链接 → 返回 `{TaskId, SessionId}` |
| `do-bigdata wedata explore-query-session --task-id <TaskId> [-o json]` | 直接用 TaskId 查询 SessionId |
| `do-bigdata supersql slow-query-analyze --session-id <SessionId> --summary --pretty` | 拉取并结构化 SuperSQL/Livy/THive 多层日志（下游技能） |
| `do-bigdata supersql job-analyze --supersql-session-id <SessionId>` | 调用外部诊断脚本（下游技能，可并行） |

## 端到端示例

### 示例 A：WeData 控制台日志链接

用户输入：

> 帮我看下这个任务为什么失败：
> https://wedata.woa.com/explore/task/log/0d5004500627d43d9e867e2fa1c5d93d-aAg1gVNO/3e412305c9fe46ebb25c765d19cb67ef/1778485769/sql/failure/manual

执行流程：

1. 提示「正在解析日志链接，定位底层会话…」
2. `do-bigdata wedata explore-query-session --url "<上述链接>" -o json --query "诊断数据探索任务失败"` → 拿到 `SessionId=df0e3d4f-...`
3. 提示「会话定位完成 ✓ 正在拉取 SuperSQL 多层日志…」
4. 切到 `supersql-job-analyzer` 工作流：`do-bigdata supersql slow-query-analyze --session-id df0e3d4f-... --summary --pretty --query "..."`
5. 按 supersql-job-analyzer 的输出规范汇总诊断结论，并在顶部追加 WeData ↔ SuperSQL 的链路映射

### 示例 B：SuperSQL QE apilog 链接

用户输入：

> 这个探索任务挂了，看下原因：
> https://ss-qe-log.woa.com/v1/session/explore_apilog_c07eb766-0d2f-4841-8b1a-65a8c8621702-sQHizu9A

执行流程：

1. CLI 自动从 URL 中提取 TaskId = `c07eb766-0d2f-4841-8b1a-65a8c8621702-sQHizu9A`（无需手工切割字符串）
2. `do-bigdata wedata explore-query-session --url "<上述链接>" -o json --query "诊断数据探索任务失败"` → 拿到 `SessionId`
3. 后续步骤同示例 A，转交 `supersql-job-analyzer`

## 关键参考链接

| 资源 | URL |
|------|-----|
| WeData 数据探索 | https://wedata.woa.com/explore |
| 下游技能：supersql-job-analyzer | `do_skills/sub-skills/SuperSQL/supersql-job-analyzer/SKILL.md` |
| 平级技能：sql-execute-analyze | `do_skills/sub-skills/WeData/sql-execute-analyze/SKILL.md` |

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
