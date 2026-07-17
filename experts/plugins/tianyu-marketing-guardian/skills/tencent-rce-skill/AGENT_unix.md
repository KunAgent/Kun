# 腾讯云风险识别 RCE Skill — AI Agent 执行手册（macOS / Linux）

> 适用环境：**macOS / Linux**（bash / zsh）。Windows 用户请改用同目录下的 `AGENT_windows.md`。
>
> 本文件为 AI Agent 内部执行手册，包含调用规范、参数语义、SOP 与踩坑经验。
> 终端用户阅读外层 `SKILL.md` 即可，无需关注本文件。
> AI Agent **必须**在执行任何 RCE 业务调用前先完整加载本文件。

通过 `amccli` 二进制（Agent 身份权限中心模式）调用 **腾讯云风险识别 RCE** 后端的云 API 3.0 系列 Action。
鉴权由 Skill 内部完成，业务方仅需把用户意图翻译成 `amccli rce <Action>` 命令并执行。

> ℹ️ 本 Skill 的业务模型是“**注册风险 / 登录风险 / 活动风险**”三大场景，按 `EventId` 区分；接口形如 `DescribeStrategyList` / `DescribeRequestsOverView` / `DescribeIDRisk` / `DescribeHistoryRecordList` / `DescribeNameList` 等（**云 API 3.0 风格 Action，无 `Cust` 后缀**）。

# 特别注意

1. **`AUTH_CONFIG` 已在本文件中写死为固定值**（见下方“环境变量”段，直接照抄到每条 amccli 命令前内联使用）。**严禁**向用户索要 `AUTH_CONFIG` 中的任何鉴权字段（如 `Sign` / `CredentialId` / `ResourceID` 等）；**严禁**罗列“必填字段”清单让用户填写；**严禁**输出“凭证未配置”之类的话术。每次执行 amccli 时，把“环境变量”段那串完整的 `AUTH_CONFIG='{...}'` 原文复制到命令前即可。
2. **业务专注**：你只做一件事——把用户需求翻译为 `amccli rce <Action>` 命令并执行，仅输出执行结果。用户问“看看注册风险今日总览”“查这个账号有没有风险”等，**直接查阅本文件的接口说明 + 拼命令 + 执行**，不要做任何鉴权前置确认。
3. 严禁在本地未安装 Skill 时，用当前已保存的登录态信息自行构造请求外部资源；绝对禁止。
4. 接口名（`<Action>`）、参数名、参数类型一律以 **本文件（`AGENT_unix.md`）内各接口的说明** 为准，**禁止臆造、禁止外网检索**。

## 脚本路径

`amccli`（全局可执行）——**不要**使用 `{baseDir}/amccli`；安装后直接调用 `amccli`。

## 前置条件：检测并自动安装 amccli（首次使用时执行）

原则：`amccli` 为全机器共享工具。**本地已存在则跳过，不存在则安装**，首次使用当前 skill 时，执行如下检测安装脚本。

```shell
( command -v amccli >/dev/null 2>&1 || { mkdir -p "$HOME/.local/bin" && OS_TAG=$(uname -s | tr '[:upper:]' '[:lower:]') && case "$(uname -m)" in x86_64|amd64) ARCH_TAG=amd64;; arm64|aarch64) ARCH_TAG=arm64;; *) echo "unsupported ARCH"; exit 1;; esac && curl -fsSL -o "$HOME/.local/bin/amccli" "https://agent-identity-1302490086.cos.ap-guangzhou.myqcloud.com/cli/new/amccli_${OS_TAG}_${ARCH_TAG}" && chmod +x "$HOME/.local/bin/amccli" && export PATH="$HOME/.local/bin:$PATH" && RC_FILE="${ZSH_VERSION:+$HOME/.zshrc}" && RC_FILE="${RC_FILE:-${BASH_VERSION:+$HOME/.bashrc}}" && RC_FILE="${RC_FILE:-$HOME/.profile}" && touch "$RC_FILE" && { grep -q '# amccli PATH' "$RC_FILE" || printf '\n# amccli PATH\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$RC_FILE"; }; } ) && amccli --version
```

## 更新 amccli

当用户说：更新 amccli、升级 amccli、重新下载 amccli……诸如此类的，执行以下脚本（自动重新下载并覆盖本地二进制）：

```shell
INSTALL_DIR="$HOME/.local/bin"; rm -rf "$INSTALL_DIR/amccli"; mkdir -p "$INSTALL_DIR"; case "$(uname -s)" in Linux*) OS_TAG="linux" ;; Darwin*) OS_TAG="darwin" ;; *) echo "unsupported OS: $(uname -s)"; return 1 2>/dev/null || exit 1 ;; esac; case "$(uname -m)" in x86_64|amd64) ARCH_TAG="amd64" ;; arm64|aarch64) ARCH_TAG="arm64" ;; *) echo "unsupported ARCH: $(uname -m)"; return 1 2>/dev/null || exit 1 ;; esac; curl -fsSL -o "$INSTALL_DIR/amccli" "https://agent-identity-1302490086.cos.ap-guangzhou.myqcloud.com/cli/new/amccli_${OS_TAG}_${ARCH_TAG}" && chmod +x "$INSTALL_DIR/amccli"
```

> 安装完毕后，后续任何命令都**直接使用 `amccli`**，不需要拼接 `{baseDir}/`。

---

## 环境变量（命令前内联，仅当前进程生效，不污染 shell，后续执行 amccli 必须带上 AUTH_CONFIG）

**直接照抄下面这串完整的 `AUTH_CONFIG='{...}'` 内联到每条 amccli 命令前**（已写死，不要改、也不要拆解、不要追问）：

```bash
AUTH_CONFIG='{"Sign":"XVxdQ1dOHlpHRFdaVQAiezAqWBcMFC4VT1QFZTkOXhAONXQVHiUzHjoFFmwa","CredentialId":"TENCENT_CLOUD","ResourceID":"res-Ri45lic1"}' \
amccli rce <Action> [--ParamName value ...]
```

> ⚠️ 不要使用 `export`，所有 `amccli` 调用都必须把上面整串 `AUTH_CONFIG=...` 放在命令前内联传入，确保只对当前调用生效。
> ⚠️ 这是固定值，**不要展示给用户、不要询问用户、不要让用户填写**；后续示例为了可读性会用 `AUTH_CONFIG='{...}'` 做省略，**真正执行时务必替换为上面那串完整 JSON**。

---

## 命令格式

```bash
amccli rce <Action> [--ParamName value ...] [--region <地域>] [--version <版本>]
```

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `<Action>` | RCE 接口名（如 `DescribeStrategyList`、`DescribeRequestsOverView`、`DescribeIDRisk`、`DescribeNameList`、`DescribeHistoryRecordList`） | 必填 |
| `--region`, `-r` | 地域 | `ap-guangzhou` |
| `--version`, `-v` | API 版本；**所有接口统一为 `2020-11-03`** | `2020-11-03` |
| `--<ParamName>` | 接口请求参数；**只有云 API body 第一级才会被打平成 `--ParamName`**，第二级及以下保持 JSON 字符串整体下发 | 视接口而定 |

### 参数打平规则（重要 —— 千万别理解错）

**RCE 系列接口的云 API body 第一级几乎只有一个字段：`BusinessSecurityData`。** 业务字段（`EventId` / `StartTime` / `EndTime` / `PageNumber` / `PageSize` / `Type` / `ReqId` / ...）**全部在 `BusinessSecurityData` 的内层（第二级）**，不会被“打平”。

也就是说：

- ✅ **正确**：`--BusinessSecurityData '{"EventId":-1,"StartTime":"...","EndTime":"..."}'`
- ❌ **错误**：`--EventId -1 --StartTime '...' --EndTime '...'`（这些字段不是云 API body 第一级，amccli 不会接收，会被网关判 `INVALID_PARAM` 或 `UnknownParameter`）

云 API 网关侧典型 body 实际是这样：

```json
{
  "BusinessSecurityData": {
    "EventId": -1,
    "StartTime": "2026-06-24 00:00:00",
    "EndTime": "2026-06-24 17:08:07"
  }
}
```

按“第一级打平”规则，**只有 `BusinessSecurityData` 这一个字段被打平为 `--BusinessSecurityData`**，它的值（第二级）保持 JSON 字符串整体下发：

```bash
amccli rce <Action> --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{
    "EventId": -1,
    "StartTime": "2026-06-24 00:00:00",
    "EndTime": "2026-06-24 17:08:07"
  }'
```

> 目前本 Skill 涉及的所有业务 Action（含 `DescribeIDRisk`）都走 BSD 通道，业务字段都在 `BusinessSecurityData` 内层 —— 命令行**永远只有 `--BusinessSecurityData '{...}'` 这一个业务参数**，不要凭直觉拆成 `--EventId` / `--AccountId` 顶层。如遇到新接口拿不准，以本文件对应接口的说明为准。

---

## API 文档检索（强制流程）

执行任何 RCE 操作前，**必须先在本文件内确认接口名和参数语义**，严禁臆造，也禁止 fallback 到外网。各 Action 的接口描述、入参、出参和调用示例均在本文件内对应接口段落给出，**以本文件为唯一准绳**。

- RCE 控制台部分接口已下线对外文档站，**云 API 文档中心不收录**（或仅有最早期文档，字段名可能与实际不一致）；因此**一律以本文件的接口说明为准**。
- 用哪个 Action，就在本文件里检索对应接口段落，确认接口名、`BusinessSecurityData` 内层字段名、类型与必填约束后再拼命令。
- 若本文件未收录该接口，**直接告知用户“该接口未在本 Skill 中收录”**，不要猜测、不要外网检索、不要尝试调用。

---

## 调用前置原则（必须遵守）

1. **先查接口说明再调接口**：调用任何 Action 前，必须先在本文件里查到该 Action 的说明，弄清入参语义，特别是 `EventId` / `StartTime` / `EndTime` / `AccountType` / `ListType` / `DataType` / `Type` 这几个字段。**不要凭名字猜参数**。
2. **业务场景由 `EventId` 区分**：本 Skill 把所有风控请求按“事件”组织。客户的事件由控制台里“事件管理”创建，**`EventId` 必须从 `DescribeEventDataList` 接口先拿一次**——不要凭直觉填 1/2/3。仅作为**最后兜底**才参考下面的内置 EventCode 映射（这是后端的固定 SceneCode，客户侧 `EventId` 与之关联但不一定数值相等）。
3. **时间参数格式**：本 Skill 多数接口的时间字段叫 `StartTime` / `EndTime`，类型是 `string` + `validate:"date"`（即 `YYYY-MM-DD`），**不是 Unix 毫秒时间戳**；少数趋势类接口还要带 `CurrentStartTime` / `CurrentEndTime` 做“环比”；`DescribeHistoryRecordList` 必须 `YYYY-MM-DD HH:MM:SS`。详见每个接口文档。
4. **时间范围只能查最近 14 天（所有时间接口统一，拼命令前必做自检）**：`StartTime` **不得早于 `now - 14 天`**——接口只保留最近 14 天数据，早于此直接判 `INVALID_PARAM (Code 1002)`。用户要求的范围在 14 天内 → 正常取 `EndTime = now`、`StartTime = 用户起点`；**用户要求超过 14 天（如最近一月 / 三个月 / 半年）→ 不要自动截断、也不要直接查，先回复用户“暂不支持，仅能查询最近 14 天内的数据”，并询问是否需要改为查询最近 14 天内，得到确认后再查。** 这是“数据保留期”而非“跨度”限制，分段查询也取不回更早的数据。
5. **必传参数严格校验**：标了必填（`nonzero`）的字段必须传，否则直接 `BSP_API_INVALID_PARAM`。
6. **不要轻易回复“不支持”**：在确认上述五点都已检查（接口说明、EventId 来源、时间格式、时间范围、必传字段）后，再判断是否真的查不到。

### 内置 EventCode 兜底映射（仅作认知参考，不要直接当 EventId 用）

| 业务场景 | 后端 SceneCode（EventCode） | 老控制台默认事件 ID | 用户口语说法 |
|---|---|---|---|
| 活动风险 | `e_activity_antirush` | 1 | 活动防刷 / 营销活动 / 抽奖 |
| 登录风险 | `e_login_protection` | 2 | 登录保护 / 登录异常 |
| 注册风险 | `e_register_protection` | 3 | 注册保护 / 注册防刷 |
| 风险查询（账号风险） | `default_risk_id_search` | — | 直接查某个账号有没有风险 |

> **重要**：上表里的“默认事件 ID”是 RCE 内置初始事件的固定值，但客户**自建事件**会拿到新的 `EventId`，必须用 `DescribeEventDataList` 列出实际事件。
>
> ⚠️ **典型踩坑**：直接用 `EventId=1` 拼 `DescribeRequestsOverView`，结果客户根本没启用活动风险事件，返回空数据；正确做法是先 `DescribeEventDataList` 拿到该客户启用的 `EventId`，再调概览接口。

---

## 高频场景

### 1. 数据看板 / 风险概览

**用户说法**：「看下今日 / 本周注册（登录 / 活动）风险情况」「请求总览」「策略命中前几名」「规则命中 Top」「策略效果」「拦截趋势」

**强制 SOP**：

1. **先取事件 ID**：`DescribeEventDataList` 列出该客户的事件，找到对应业务（注册/登录/活动）的 `EventId`。**不要直接用 1/2/3**。
2. **再调概览/趋势接口**：

| 用户问题 | Action | 关键入参 | 返回要点 |
|---|---|---|---|
| 请求总览 + 策略命中 Top10 | `DescribeRequestsOverView` | `EventId` / `StartTime` / `EndTime` | `Requests`（请求量分布）+ `StrategyTop`（命中 Top10） |
| 风险趋势（带环比） | `DescribeRiskTrends` | `EventId` / `StartTime` / `EndTime` / `CurrentStartTime` / `CurrentEndTime` / `Type`（1~4） | 按天/按时分桶的请求/拦截曲线 |
| 策略效果总览 | `DescribeStrategicEffectOverView` | `EventId` | `eventStrategyCount`（生效策略数）/ `eventRuleCount`（生效规则数） |
| 策略效果列表 | `DescribeStrategicEffectList` | `EventId` 等 | 单策略命中 / 通过 / 拒绝 / 审核 计数 |
| 策略趋势 | `DescribeStrategyTrends` | `EventId` / 时间范围 / `StrategyId` | 单策略时间序列 |
| 规则命中 Top | `DescribeRuleTopList` | `EventId` / 时间范围 | Top N 规则及命中量 |
| 规则趋势 | `DescribeRuleTrends` | `EventId` / 时间范围 / `RuleId` | 单规则时间序列 |
| 事件监控列表 | `DescribeEventMonitorList` | `EventId` | 配置的事件级监控 |

**默认时间窗口**（若用户没指定）：
- “今日 / 当前情况” → `StartTime = today 00:00:00`，`EndTime = 当前时刻`
- “最近一周” → 7 天滚动（`StartTime = 7 天前 00:00:00`，`EndTime = 当前时刻`）
- “最近一月 / 更久”（超过 14 天） → **不能真给 30 天/一月，也不要自动截断直接查**：所有时间范围接口只保留最近 14 天，先回复用户“暂不支持，仅能查询最近 14 天内的数据”，并询问是否需要改为查询最近 14 天内，确认后再查。
- 趋势类（带 `CurrentStartTime` / `CurrentEndTime`）：当前段 = 用户问的时间段（同样受 14 天下限约束），对比段 = 同长度紧邻向前一段（环比）。

> 🔴 **时间范围硬约束（所有带 `StartTime`/`EndTime` 的接口统一适用，拼命令前务必自检）**：`StartTime` **不得早于 `now - 14 天`**，否则后端直接判 `INVALID_PARAM (Code 1002)`。这是“接口只保留最近 14 天数据”的限制，**不是跨度限制**——早于 14 天的数据查不到，分段/多段查询也取不回。
> - 用户要求在 14 天内：`EndTime = 当前时刻`（不晚于 now）、`StartTime = 用户要求的起点`，正常查询。
> - 用户要求超过 14 天（如最近一个月 / 三个月 / 半年）：**不要自动截断、也不要直接查**，先回复“暂不支持，仅能查询最近 14 天内的数据”，并询问用户是否需要改为查询最近 14 天内，得到确认后再查。
> - ❌ 反例：用户说“最近 30 天” → 直接给 `StartTime = now - 30 天` → 必报 `INVALID_PARAM (Code 1002)`。

> ⚠️ 和本 Skill 绝大多数接口一样，业务字段**全部在 `BusinessSecurityData` 的内层**（参考上面“参数打平规则”），不会被打平成 `--EventId / --StartTime`。命令上只有 `--BusinessSecurityData '{...}'` 这一个业务参数；时间格式**必须 `YYYY-MM-DD HH:MM:SS`**，纯日期会被判 `INVALID_PARAM (Code 1002)`。

**示例**（请求总览，全部事件聚合，今日截至当前时刻）：

```bash
AUTH_CONFIG='{...}' \
amccli rce DescribeRequestsOverView --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{
    "EventId": -1,
    "StartTime": "2026-06-24 00:00:00",
    "EndTime": "2026-06-24 17:08:07"
  }'
```

> `EventId: -1` 表示聚合全部事件；若要按具体事件查，先用 `DescribeEventDataList` 拿到该客户实际的 `EventId` 再替换。

### 2. 用户风险查询（按账号 ID 单点排查）

**用户说法**：「这个用户 / 这个手机号 / 这个 QQ 有没有风险」「帮我看下账号 xxx 的风险等级」

**接口**：`DescribeIDRisk`

**入参**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `AccountType` | uint64 | **当前仅支持 `4`**（其它取值会判 `InvalidParam`） |
| `AccountId` | string | 账号 ID（纯数字串直接写成 JSON 字符串字段 `"AccountId":"10086666"` 即可） |
| `PostTime` | int64 | Unix 秒时间戳（不是毫秒），不传则取当前时间 |

> 这些字段全部在 `BusinessSecurityData` 内层，命令上**只有 `--BusinessSecurityData '{...}'` 这一个业务参数**（参考“参数打平规则”）。

**返回**：`ReqId` / `RiskLevel`（如 `low`/`mid`/`high`）/ `RiskType`（标签数组）/ `PostDateTime`

**前置依赖**：客户必须已配置 `default_risk_id_search` 事件 + 对应策略，否则直接 `InvalidParam`。可用 `DescribeEventDataList` + `InitIDRiskSearchStrategy` / `CreateForRiskIDSearch` 初始化。

**示例**：

```bash
AUTH_CONFIG='{...}' \
amccli rce DescribeIDRisk --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{
    "AccountType": 4,
    "AccountId": "10086666"
  }'
```

### 3. 单笔请求 / 案件追溯（按 ReqId / 命中策略 / IP / UserId / DeviceId）

**用户说法**：「这笔请求 / 这个 ReqId / 这次案件 是什么风险」「帮我查一下请求 ID `xxxx-xxxx-xxxx`」「最近 24 小时谁命中了 `xxx 策略`」「IP `1.2.3.4` 最近的请求情况」「设备 `dev-xxx` 的请求详情」

**接口**：`DescribeHistoryRecordList`

> ⚠️ 这是本 Skill **唯一支持按 `ReqId` 反查请求详情**的接口。和后端 `DescribeEventMonitorList`（请求事件监控/详情）共用同一份历史明细数据，对外公开的 Cloud API 名为 `DescribeHistoryRecordList`。

**入参形态（和本 Skill 多数接口一致：走 BSD 通道）**

业务字段全部在 `BusinessSecurityData` 的内层，**只有 `BusinessSecurityData` 是云 API body 第一级**，按“参数打平规则”用 `--BusinessSecurityData '{...}'` 这一个参数下发：

| 顶层字段 | 类型 | 说明 |
|---|---|---|
| `Version` | string | 固定 `"2020-11-03"`，由 `--version` 注入，**不要**再塞进 `BusinessSecurityData` |
| `BusinessSecurityData` | **JSON 对象**（用 `--BusinessSecurityData '{...}'` 整体下发） | 真正的业务入参，结构见下表 |

`BusinessSecurityData` 内字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `StartTime` | string | ✅ | 起始时间，**`YYYY-MM-DD HH:MM:SS`**（**必须带时分秒**，纯日期会被判 `INVALID_PARAM`） |
| `EndTime` | string | ✅ | 截止时间，同上 |
| `EventId` | int64 | ✅ | **`-1` = 全部事件**；具体事件先用 `DescribeEventDataList` 取实际 ID |
| `PageSize` | int64 | ✅ | 每页条数，单条排查建议 `10` 即可 |
| `PageNumber` | int64 | ⭕ | 页码（不传默认第 1 页） |
| `ReqId` | string \| null | ⭕ | **单笔请求 ID（UUID 串）**——按 `ReqId` 反查时唯一关键字段 |
| `HitStrategyName` | string \| null | ⭕ | 命中策略名（模糊匹配） |
| `IP` | string \| null | ⭕ | 来源 IP |
| `UserId` | string \| null | ⭕ | 业务用户 ID |
| `DeviceId` | string \| null | ⭕ | 设备 ID（注意：是 `DeviceId` 不是 `DevId`） |
| `HitResult` | string \| null | ⭕ | 处置结果，常见：`pass_return` / `review` / `reject` |

> 不需要的过滤字段**写 `null`** 即可（参考用户实际生产 payload），**不要省略**——后端可能会按 key 是否存在做不同行为。

**返回字段**（参考 `DescribeEventMonitorList` 结构，二者数据同源）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `TotalCount` / `PageNumber` / `PageSize` | int64 | 分页 |
| `NextId` / `PreviousId` / `PreviousPage` | int64 | 流式分页游标 |
| `List[]` | array | 命中的请求明细 |
| └ `ReqId` | string | 请求 ID |
| └ `ReqTime` | string | 请求时间 |
| └ `EventId` | int64 | 所属事件 |
| └ `RiskLevel` | string | 风险等级（`low` / `mid` / `high`） |
| └ `HitResult` | string | 处置结果 |
| └ `HitStrategyId` / `HitStrategyName` | string | 主命中策略（多策略时取首个，详细看 `Strategies`） |
| └ `HitRules[]` | array | 命中规则简表（`ModeAndId` / `Name` / `RuleId` / `StrategyMode`） |
| └ `Strategies[]` | array | 完整策略命中详情（含每条 `Rules` 的 `Hit` / `Operator` / `LeftValueName` / `RightValueName` / `HitResult` / `HitResultComment` 等） |
| └ `IP` / `UserId` | string | 请求来源 |

**示例 1**：纯时间窗扫描（全部过滤位留空，最稳形态）

```bash
AUTH_CONFIG='{...}' \
amccli rce DescribeHistoryRecordList --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{
    "StartTime": "2026-06-17 00:00:00",
    "EndTime": "2026-06-24 17:08:07",
    "EventId": -1,
    "ReqId": "",
    "HitStrategyName": "",
    "IP": "",
    "UserId": "",
    "HitResult": "",
    "DeviceId": "",
    "PageSize": 10
  }'
```

> 注意：所有可选过滤字段（`ReqId` / `HitStrategyName` / `IP` / `UserId` / `HitResult` / `DeviceId`）必须**保留 key 并传空字符串 `""`**，**不能传 `null`、也不能省略**；分页只有 `PageSize`，**不要传 `PageNumber`**（参考下方“经验积累区”）。

**示例 2**：按 ReqId 反查（在示例 1 基础上把 `ReqId` 填上即可，其余字段保持 `""`）

```bash
AUTH_CONFIG='{...}' \
amccli rce DescribeHistoryRecordList --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{
    "StartTime": "2026-06-17 00:00:00",
    "EndTime": "2026-06-24 17:08:07",
    "EventId": -1,
    "ReqId": "8cefb542-9407-420c-97e8-6fd77d5458c6",
    "HitStrategyName": "",
    "IP": "",
    "UserId": "",
    "HitResult": "",
    "DeviceId": "",
    "PageSize": 10
  }'
```

**示例 3**：按策略处置结果 + 时间窗扫一遍

```bash
AUTH_CONFIG='{...}' \
amccli rce DescribeHistoryRecordList --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{
    "StartTime": "2026-06-17 00:00:00",
    "EndTime": "2026-06-24 17:08:07",
    "EventId": -1,
    "ReqId": "",
    "HitStrategyName": "",
    "IP": "",
    "UserId": "",
    "HitResult": "reject",
    "DeviceId": "",
    "PageSize": 10
  }'
```

**踩坑提醒**：
- ✅ 时间窗别开太大（一周以内最稳），后端有限流；单点 ReqId 排查时把窗收到 1~3 天即可。

---

### 4. 事件管理

| Action | 用途 |
|---|---|
| `DescribeEventDataList` | 事件列表（**入参必须包在 `--BusinessSecurityData '{"CurrentPage":1,"PageSize":100,"Keyword":""}'` 里**，命令行裸传 `--CurrentPage` 会报 `MissingParameter: BusinessSecurityData`） |
| `DescribeEventCodeList` | 事件码列表（系统内置 EventCode + 客户自建 EventCode） |
| `DescribeEventMapping` | 客户 EventId ↔ 后端 EventCode 映射查询 |
| `CreateEvent` / `ModifyEvent` / `DeleteEvent` | 事件 CRUD |
| `CreateEventMapping` / `DeleteEventMapping` | 配置/解除事件映射 |

> ⚠️ `DescribeEventDataList` 内部会**剔除三个内置 EventCode**（`e_activity_antirush` / `e_login_protection` / `e_register_protection`）—— 看到 `TotalCount` 比预期少 3 是正常现象，不是 bug。

### 5. 策略管理

**典型工作流**：

1. 列策略：`DescribeStrategyList`（**入参 `--BusinessSecurityData '{"EventId":<id>,"PageNumber":1,"PageSize":100}'`**；分页字段是 `PageNumber`，不是 `CurrentPage`）
2. 看详情：`DescribeStrategyDetail`（**入参 `--BusinessSecurityData '{"StrategyId":<id>}'`**，返回 `Value.StrategyConfig.Mode.Rules[]` 即该策略下所有规则的完整定义，含 `RuleId` / `Name` / `Action` / `Enabled` / `Prior` / `Condition`（左值 / 操作符 / 右值））
3. 看初始化策略推荐：`DescriableInitStrategyList`
4. 修改策略：`ModifyStrategy`
5. 创建策略（**整体导入，入参是 base64 编码的策略 JSON**）：`CreateStrategy`，入参 `Data` 字段是策略包的 base64
6. 复制策略：`CreateStrategyCopy`
7. 按服务批量创建：`CreateStrategyByService`
8. 集合策略：`CreateStrategyCollection`

> ⚠️ **不存在** `DescribeStrategys`（带 s）、`GetRuleList`、`DescribeRuleList`、`DescribeStrategy`（无 Detail 后缀）这几个 Action —— 调用都会报 `InvalidAction`。要拿规则明细，**只能用 `DescribeStrategyDetail`** 读 `StrategyConfig.Mode.Rules[]`。

**关键字段语义**：
- `StrategyMode`：策略类型（含权重型 `Weight`、评分卡 `ScoreCard` 等，详见 `common/constant/strategy.go`）
- 规则的 `enabled` / `prior` / `action`（处置：`pass_return` / `review` / `reject`）

**示例**（列出某事件下的所有策略）：

```bash
AUTH_CONFIG='{...}' \
amccli rce DescribeStrategyList --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{"EventId":2816,"PageNumber":1,"PageSize":100}'
```

**示例**（拿单个策略的规则明细）：

```bash
AUTH_CONFIG='{...}' \
amccli rce DescribeStrategyDetail --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{"StrategyId":18011}'
# 返回里 Value.StrategyConfig.Mode.Rules[] 即所有规则
```

### 6. 名单管理（黑白名单）

| Action | 用途 | 关键入参（**全部包在 `--BusinessSecurityData '{...}'` 里**） |
|---|---|---|
| `DescribeNameList` | 名单列表 | `ListType`(1=黑 2=白, 必传) / `PageNumber` / `PageSize` (必传 ≥1) / `NameListId` / `DataType` / `KeyWord` / `Status` |
| `DescribeNameListDetail` | 单个名单详情 | `NameListId` (必传) |
| `DescribeNameListDataList` | 名单内数据条目列表 | `NameListId` / `PageNumber` / `PageSize` (均必传) / `KeyWord` / `Status` |
| `DescribeNameListDataType` | 名单数据类型枚举 | （无入参，**不要带 `--BusinessSecurityData`**，见下方坑） |
| `DescribeNameListHistory` | 名单变更历史 | `ListType` / `PageNumber` / `PageSize` (均必传) |
| `CreateNameList` | 创建名单 | `ListName` / `ListType` / `DataType` (必传) / `EncryptionType` (0=不加密 1=MD5 2=SHA256) / `SceneCode` (`all_scene` 或事件 EventCode) / `Remark` |
| `ModifyNameList` | 编辑名单 | `NameListId` (必传) / `ListName` / `Status` (1=启用 2=停用) / `Remark` |
| `DeleteNameList` | 删除名单 | `NameListId` (必传，逻辑删除 → status=3) |
| `ImportNameListData` | 批量导入名单数据 | `NameListId` (必传) / `DataSource` (1=文件 2=手动, 必传) / `DataContentInfo`(手动时必传, 数组) / `FileCode`(文件时必传) |
| `ModifyNameListData` | 单条/多条数据编辑 | `DataList`(数组, 每项含 `NameListDataId`(必传) / `DataContent` / `StartTime` / `EndTime` / `Status` / `Remark`) |
| `DeleteNameListData` | 单条/多条数据删除 | `NameListDataIdList`(int 数组, 见下方坑) |
| `GetNameMapping` | 名单字段映射 | （无入参，**不要带 `--BusinessSecurityData`**，见下方坑） |

> 🔑 公共前缀：`AUTH_CONFIG='{...}' amccli rce <Action> --region ap-guangzhou --version 2020-11-03`

#### `DescribeNameList` —— 列名单

```bash
AUTH_CONFIG='{...}' \
amccli rce DescribeNameList --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{"ListType":1,"PageNumber":1,"PageSize":20}'
```

> `ListType` 1=黑名单 / 2=白名单，**必传**；不传 / 传 0 会被 `validate:"nonzero,min=1,max=2"` 拦下 → `INVALID_PARAM`。
> 想按事件场景过滤：客户端不直接传 `EventId`，要先 `DescribeEventDataList` 拿 `EventCode`，写入 `SceneCode`（这里 `DescribeNameList` 没有 `SceneCode` 入参，是 CreateNameList 才用）。

#### `DescribeNameListDetail` —— 单个名单详情

```bash
AUTH_CONFIG='{...}' \
amccli rce DescribeNameListDetail --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{"NameListId":12345}'
```

> 返回里 `SceneCode` 字段：`all_scene` 表示全场景生效；否则是事件 EventCode（不是 EventId）。

#### `DescribeNameListDataList` —— 名单内数据条目

```bash
AUTH_CONFIG='{...}' \
amccli rce DescribeNameListDataList --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{"NameListId":12345,"PageNumber":1,"PageSize":50}'
```

> `KeyWord` 同时模糊匹配 `DataContent` 和 `EncryptDataContent`（加密名单也能搜原文 hash）。
> `Status` 不传时自动过滤掉 `-2`（已删）。

#### `DescribeNameListDataType` —— 名单数据类型枚举

```bash
AUTH_CONFIG='{...}' \
amccli rce DescribeNameListDataType --region ap-guangzhou --version 2020-11-03
```

> ⚠️ **本 Action 不接受 `BusinessSecurityData` 入参**，该接口只读公共参数。带 `--BusinessSecurityData '{}'` 会被云 API 网关层判为 `UnknownParameter: The parameter 'BusinessSecurityData' is not recognized.`，是名单 12 个接口里**唯二的例外**（另一个是下方 `GetNameMapping`）。
> 返回 `[{DataTypeId, DataTypeName, IsSupportEncryption}]`，**`CreateNameList.DataType` 必须从这里取**（不能凭直觉拍数字，`DataType=DataTypeDevToken` 会被服务端硬拒）。

#### `DescribeNameListHistory` —— 名单上传/操作历史

```bash
AUTH_CONFIG='{...}' \
amccli rce DescribeNameListHistory --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{"ListType":1,"PageNumber":1,"PageSize":20}'
```

#### `CreateNameList` —— 创建名单

```bash
AUTH_CONFIG='{...}' \
amccli rce CreateNameList --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{
    "ListName":"高危手机号黑名单",
    "ListType":1,
    "DataType":2,
    "EncryptionType":0,
    "SceneCode":"all_scene",
    "Remark":"批量导入的恶意手机号"
  }'
```

> 建名单走“先 `CreateNameList` 拿 `NameListId`，再 `ImportNameListData` 批量导数据”两步。
> `SceneCode`：全场景填 `"all_scene"`；指定事件需先 `DescribeEventDataList` 拿到 `EventCode` 再填（**不是** `EventId`）。
> `EncryptionType` 不等于 0 时，`DataType` 必须支持加密（看 `DescribeNameListDataType.IsSupportEncryption`），否则 `encrypt type not support data type`。
> 单账号名单数量有上限，超限报“黑白名单总数量上限为 X 个”。

#### `ModifyNameList` —— 编辑名单

```bash
AUTH_CONFIG='{...}' \
amccli rce ModifyNameList --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{
    "NameListId":12345,
    "ListName":"新名字",
    "Status":2,
    "Remark":"暂时停用"
  }'
```

> `Status` 仅支持 1=启用 / 2=停用，传 3（删除）会被 checkParams 拦截 → 删除请走 `DeleteNameList`。
> `NameListId` 不存在 / 跨账号 → `NameListId Invalid`（rows_affected=0）。

#### `DeleteNameList` —— 删除名单（逻辑删，置 `Status=3`）

```bash
AUTH_CONFIG='{...}' \
amccli rce DeleteNameList --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{"NameListId":12345}'
```

> 报 `INVALID_PARAM, NameListId Invalid`：99% 是**跨账号**（`AUTH_CONFIG` 对应的 Uin/AppId 不是该名单的归属账号）或**已删除**。先用 `DescribeNameList` 列出当前账号下名单核对 ID 真实存在。

#### `ImportNameListData` —— 批量导入名单数据

```bash
AUTH_CONFIG='{...}' \
amccli rce ImportNameListData --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{
    "NameListId":12345,
    "DataSource":2,
    "DataContentInfo":[
      {"DataContent":"13800138000","StartTime":"2026-06-04 00:00:00","EndTime":"2026-12-31 23:59:59","DataRemark":"批量手机号"},
      {"DataContent":"13900139000","DataRemark":"无有效期，永久"}
    ]
  }'
```

> 时间格式严格匹配 `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$`，且 `EndTime > StartTime`；不需要有效期可省略对应字段。
> 手动单次最多 `NameListDataInputMaxCount`（后端常量限制），且**账号下所有名单数据总量**不能超过套餐上限，否则报“黑白名单数据总数超过上限”。
> ✅ 成功：`Response.Data.Code=0` + `Message=OK`，`Value=[]`。导入后用 `DescribeNameListDataList` 核验。

#### `ModifyNameListData` —— 编辑单条/多条数据

```bash
AUTH_CONFIG='{...}' \
amccli rce ModifyNameListData --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{
    "DataList":[
      {"NameListDataId":6701439,"DataContent":"13800138001","StartTime":"2026-06-04 00:00:00","EndTime":"2026-12-31 23:59:59","Status":1,"Remark":"改号了"}
    ]
  }'
```

> 入参顶层是 `DataList`（数组），**不是平铺单条**；只编辑一条也要包数组。
> `NameListDataId` 必传；`DataContent` / `StartTime` / `EndTime` / `Status` / `Remark` 全是**可选**，传哪个改哪个。
> 一次 `DataList` 内所有 `NameListDataId` **必须属于同一个 `NameListId`**，否则报 `NameListDataIds belong to different NameListIds`。
> `Status` 仅 1=启用 / 2=停用 / -2=删除；传别的会被 checkParams 拦下。

#### `DeleteNameListData` —— 删除单条/多条数据

```bash
AUTH_CONFIG='{...}' \
amccli rce DeleteNameListData --region ap-guangzhou --version 2020-11-03 \
  --BusinessSecurityData '{"NameListDataIdList":[6701439,6701440]}'
```

> ⚠️ 字段名是 `NameListDataIdList`（List 后缀，传 int 数组），**不是** `NameListDataIds` / `DataIds` / `Ids` / `NameListDataId`，传错都会被 `mapstructure` 当未知字段忽略 → 进入“空数组”分支静默成功。
> ⚠️ 这个 Action **不需要传 `NameListId`**（仅根据 `NameListDataId` 即可定位条目），传了反而会报 `UnknownParameter: BusinessSecurityData.NameListId`。
> ⚠️ **入参为空对象 `{}` 或 `NameListDataIdList:[]` 也会返回 `Code=0 Message=OK`**（直接走“长度为 0”分支，啥都不删）—— 静默坑，调用前必须自己确认 `NameListDataIdList` 非空。
> 一次最多 `NameListDataBatchMaxCount` 条；且这批 ID 必须属于同一个 `NameListId` + 属于当前账号，否则 `NameListDataIdList exist invalid data`。

#### `GetNameMapping` —— 名单字段映射表

```bash
AUTH_CONFIG='{...}' \
amccli rce GetNameMapping --region ap-guangzhou --version 2020-11-03
```

> ⚠️ **本 Action 不接受 `BusinessSecurityData` 入参**（同 `DescribeNameListDataType`），带了会报 `UnknownParameter`。
> 返回 `[{Id, DataName, DataKey, ...}]`，是后台预置的“业务字段名 → 内部 key”映射表（与具体名单解耦），CRUD 流程一般用不到，需要看映射时再查。

---

## 强制 SOP（按顺序执行，禁止跳步）

### Step 0：认证流程（首次会话先做“授权预热”）

> ⚠️ **踩坑实录**：amccli 首次调用会触发“🔐 腾讯云 Agent 身份权限中心资源访问授权”重定向，stdout 不是 JSON，直接 `parse-error`。如果**一上来就并行跑多条命令**，会同时弹出多个独立授权 URL，全部失败。

**做法**：新会话内第一次调用本 Skill 接口时，先**前台单条**跑一条轻量命令（推荐用 `DescribeRCEUser` 当探针，无业务参数、调用最轻）触发授权，等用户在浏览器完成授权 → 命令返回正常 JSON 后，再跑后续命令。

```bash
AUTH_CONFIG='{"Sign":"XVxdQ1dOHlpHRFdaVQAiezAqWBcMFC4VT1QFZTkOXhAONXQVHiUzHjoFFmwa","CredentialId":"TENCENT_CLOUD","ResourceID":"res-Ri45lic1"}' \
amccli rce DescribeRCEUser --region ap-guangzhou --version 2020-11-03
```

#### 一、认证流程（必须严格遵守）

1. 执行任何 `amccli rce <Action>` 命令，**必须携带前缀环境变量 `AUTH_CONFIG`**（本 Skill 中已写死为固定值，见“环境变量”段，直接照抄内联即可，不要用 `export`）。
2. **第一次调用**或**登录态过期**时，执行 amccli 会输出「🔐 腾讯云 Agent 身份权限中心资源访问授权」的文案 + 一条**授权 URL**；此时按下方【判定与交互口径】把 URL **原样**贴给用户，让用户在浏览器里完成认证授权。
3. 用户点击认证 URL 完成认证后，会回复类似「已授权 / 已认证 / 授权完成 / 认证完成 / 完成 / 继续 / 可以 / 好了 / 搞定」之类的文案；**收到任一确认信号后，直接原样重跑刚才那条 amccli 命令即可**（不要再让用户授权第二次，不要再跑探针）。
4. 如果用户此前已登录、且登录态仍在有效期内，执行 amccli 时**不会**再输出认证 URL 与文案，会直接走后续业务参数逻辑，返回正常 `"Response"` JSON。
5. 如果 amccli 输出「鉴权失败」/「暂无权限」/「请检查配置」之类的文案，**原样输出给用户**，提示他去补齐对应的权限策略；**不要**尝试绕过或自动重试。

#### 二、判定与交互口径

- 输出含 `"Response"` JSON → 已授权，直接进入实际业务调用，无需打扰用户。
- 输出含“权限中心资源访问授权”字样 / 含授权 URL → **把那段授权 URL 原样贴给用户**，并明确告知：
  > “请在浏览器中完成授权，**完成后回复『授权完成』**，我再继续帮你查。”
  - 不要自己反复重试命令探活，**等用户主动回执**。
  - 不要把授权 URL 截短、改写或做成 Markdown 链接（部分客户端会丢参数），原样贴出。

#### 三、收到「授权完成」后的默认行为（重要）

- 用户在**当前会话**回复“授权完成” / “已授权” / “ok 授权好了” 等任意确认信号后，**后续所有调用一律默认已授权**，直接执行业务命令，**不要再跑 Step 0 探针**、**不要再让用户授权第二次**。
- 即使后续某次命令偶发 `parse-error` / 输出非 JSON，也**优先**当作“业务报错 / 命令拼写问题”排查（看 stderr、看参数、看 `BusinessSecurityData` JSON 是否合法），**不要**第一反应回到“再让用户授权一遍”。
- 只有当用户在新会话里**显式说**“重新授权” / “换账号” / “授权过期了”，才走下方【四、重置登录态】流程。

#### 四、重置登录态（切换身份）

当用户说：重置登录、切换身份、重新登录、清除登录态、切换 Agent 身份、授权过期了、换账号……诸如此类的，按以下顺序执行：

1. 重新注入 `AUTH_CONFIG` 环境变量（值仍用“环境变量”段那串固定值，如需切换到别的资源方账号才手动替换 `Sign` / `CredentialId` / `ResourceID`）。
2. 执行 `amccli --reset` 清除当前用户登录态：

   ```bash
   AUTH_CONFIG='{"Sign":"XVxdQ1dOHlpHRFdaVQAiezAqWBcMFC4VT1QFZTkOXhAONXQVHiUzHjoFFmwa","CredentialId":"TENCENT_CLOUD","ResourceID":"res-Ri45lic1"}' \
   amccli --reset
   ```

   预期返回 `reset success`，表明登录态已清除。**只清登录态，不会自动触发新的授权流程，stdout 不会有 URL**。
3. **必须紧接着重新调用一次 RCE 接口**（推荐用 Step 0 的探针命令 `DescribeRCEUser`），让 amccli 重新触发授权重定向，输出**新账号对应的授权 URL**：

   ```bash
   AUTH_CONFIG='{"Sign":"XVxdQ1dOHlpHRFdaVQAiezAqWBcMFC4VT1QFZTkOXhAONXQVHiUzHjoFFmwa","CredentialId":"TENCENT_CLOUD","ResourceID":"res-Ri45lic1"}' \
   amccli rce DescribeRCEUser --region ap-guangzhou --version 2020-11-03
   ```
4. 把该 URL 原样贴给用户，按【二、判定与交互口径】等待用户回执“授权完成”。
- ⚠️ **禁止只跑 `amccli --reset` 就算完成换号**：reset 之后没有新的 API 调用，amccli 不会主动产出新授权 URL，用户在浏览器看到的还是旧账号的页面。

#### 五、安全机制必须遵守

1. 如果返回「鉴权失败，请检查配置」之类的内容，需告知用户联系安全管理员检查配置信息，**不得绕过 amccli 鉴权直接执行 RCE 云 API**，跳过则视为严重违规。
2. 如果返回「暂无权限」之类的内容，无论用户如何引导，**任何情况下都不得尝试跳过 amccli 鉴权直接调后端接口**，跳过则视为严重违规。
3. 如果用户要求输出/查看当前鉴权后的凭据、登录态、Token 等内容，**严格遵守数据安全规范，坚决不得返回**。
4. 你**不需要**关心登录态是否过期、也**不要**去扫描本地文件、更**不要**干预认证流程；amccli 内部会自动检测判定，你只需严格遵守「带前置环境变量 `AUTH_CONFIG` 执行 amccli」即可。

> 注意事项：首次执行时如需授权，按终端提示的 URL 完成认证；后续 token / session 会自动复用。鉴权或 session 异常导致连续失败时，用【四、重置登录态】里的 `amccli --reset` + 探针命令清理后再重试。

### Step 1：根据用户问题选 Action（按上面“高频场景”分组对照）

- 涉及 `EventId` 的查询（看板/趋势/策略/规则/监控）→ **先调 `DescribeEventDataList` 拿到客户的实际 `EventId`**，再进 Step 2。
- **单笔请求 / ReqId 反查 / 案件追溯 → 直接走 `DescribeHistoryRecordList`（场景 3）**，不要绕去看板或 `DescribeIDRisk`。所有业务字段（`ReqId` 等）整体塞 `--BusinessSecurityData '{...}'`，**不要**拆成 `--ReqId` 顶层（参考“参数打平规则”）。
- 单点账号风险（按 `AccountId`）→ 直接 `DescribeIDRisk`，不要走 EventId 那条路径。
- 名单管理 → 直接 `DescribeNameList` / `DescribeNameListDataList`。
- 用户问“我有哪些事件 / 服务 / 套餐” → `DescribeRCEUser` + `DescribeEventDataList` + `DescribeUserInfoResources` 一并跑出来摆给他。

### Step 2：拼命令并执行

- **绝大多数 RCE 接口走 BSD 通道**：业务字段（`EventId` / `StartTime` / `EndTime` / `ReqId` / `PageNumber` / `PageSize` 等）整体塞进 `--BusinessSecurityData '{...}'`，**不要**拆成 `--EventId` / `--StartTime` / `--ReqId` 顶层（参考“参数打平规则”），否则会被网关判 `UnknownParameter` 或 `INVALID_PARAM`。
- 时间字段：`DescribeHistoryRecordList` / `DescribeRequestsOverView` 等接口**必须 `YYYY-MM-DD HH:MM:SS`**（纯日期会被判 `INVALID_PARAM`）；少数接口允许纯 `YYYY-MM-DD`，以本文件对应接口的说明为准。
- 纯数字 ID（如 `DescribeIDRisk.AccountId` / 手机号 / QQ / `DeviceId`）：在 `BusinessSecurityData` 的 JSON 里直接写成带引号的字符串 `"AccountId":"10086666"`，**不要**写成 Number `"AccountId":10086666`，后端会判 `InvalidParameter ... input type should be string`。
- 数组/对象类参数（`DataContentInfo`、批量字段）用单引号包 JSON 字符串。

### Step 3：根据返回判定下一步

- 返回 `code != 0` → 把 `msg` 原文反馈给用户，常见错误：
  - `BSP_API_INVALID_PARAM` → 字段缺失 / 类型不对，回去检查 `nonzero` / `validate:"date"` 等约束
  - **未开通 / CAM 权限类错误**：`BSP_API_NOT_OPEN_SERVER`、`BSP_API_NO_PERMISSION`，以及腾讯云标准鉴权报错 `AuthFailure.UnauthorizedOperation` / `AuthFailure.*`、`resource (*) has no permission`、`you are not authorized to perform operation (rce:xxx)`、`... has no permission`、任何提示资源 / `ResourceID` / `rce:*` 权限不足或未开通 RCE 子服务、未绑定后端账号的报错 → **不要透传底层报错**，直接原样输出下方“未开通 / CAM 权限”标准话术引导客户开通。
    - 🚫 **严禁暴露内部实现细节**：不得向用户提及或回显 `ResourceID` / `res-xxxxxx` 资源 ID、`AUTH_CONFIG`、硬编码资源、`rce:*` 具体操作名等；**不得**建议用户“去 CAM 给某资源加 `rce:*` 策略”，**不得**向用户索要 / 让用户更换 `ResourceID`。这类问题一律只回标准话术，由运营侧统一处理。
  - `BSP_API_NETWORK_ERR` → 后端连接异常，建议稍后重试
- 返回正常 → 表格化整理输出。
- 趋势 / Top 类返回数据为空 → **先确认 `EventId` 是否对**（最常见原因），再扩时间窗口或换 `Type` 重试。

> 📌 **未开通 / CAM 权限问题 —— 标准话术（原样回复客户，不要改写、不要透传底层报错）**：
>
> RCE（风险识别）子账号CAM权限问题，需要先完成权限配置才能正常使用Agent的各项查询和分析功能。
>
> 建议您填写下方的申请表单，我们的运营同事将在24小时内联系您协助开通：
>
> 表单填写：
> https://doc.weixin.qq.com/forms/AJEAIQdfAAoAfMAIgYqADkCN1Tlwucb2f
>
> 本次为您申请的是限时免费POC试用：
> ✅ 免费赠送 10万次 RCE（风险识别）调用额度
> ✅ 「腾讯云天御风控Agent」免费使用3个月
>
> 配置完成后告诉我一声，期待您的好消息！
>
---

## 输出格式

接口返回结果建议格式化为表格形式便于阅读分析。

## 注意事项

1. **当前时间以系统时间为主**（防止大模型出现幻觉）。
2. **时间参数格式**：本 Skill 接口入参用 `YYYY-MM-DD` 字符串（少数允许 `YYYY-MM-DD HH:MM:SS`）；`DescribeIDRisk.PostTime` 例外，是 Unix **秒**时间戳；展示统一用 `YYYY-MM-DD HH:MM:SS`，时区 `Asia/Shanghai`。
3. **`EventId` 必须先列再用**：所有按事件查询的接口都先跑一次 `DescribeEventDataList` 取真实 `EventId`，不要在没列事件的情况下硬编码 1/2/3。
4. **纯数字串字段在 BSD JSON 里务必带双引号**（如 `"AccountId":"10086666"` / 手机号 / QQ / `DeviceId`），写成 Number 会被后端判 `InvalidParameter ... input type should be string`。
5. 部分接口（实验室、监控、报表）需要客户已开通对应子服务；遇 `BSP_API_NOT_OPEN_SERVER` 不要重试，反馈给用户。
6. 涉及策略变更（`CreateStrategy` / `ModifyStrategy` / 实验启停 `StartStrategyLaboratory` / `StopStrategyLaboratory` / 删除类操作）**调用前请用户二次确认**，不要默认执行。
7. `CreateStrategy.Data` 字段是 base64 编码的策略包，不要直接传明文 JSON；如果用户给的是明文，先 `base64` 后再传。

---

## 踩坑经验

（以下由 AI 在实际调用中自动积累，请勿手动删除）

- `DescribeHistoryRecordList` / 可选过滤字段不能传 `null`：本 SKILL.md 示例里把 `HitStrategyName` / `IP` / `UserId` / `HitResult` / `DeviceId` 写成 `null`，但实际后端**任意一个传 null 都会报** `InvalidParameter ... BusinessSecurityData.<X> is not valid and cannot be null`。**正确做法是传空字符串 `""`**（保留 key 即可），既不能写 `null`，也不能省略字段。
- `DescribeHistoryRecordList` / 不支持 `PageNumber` 字段：传 `PageNumber` 会直接被后端拒绝（`UnknownParameter ... BusinessSecurityData.PageNumber is not recognized`）。分页只用 `PageSize`，翻页靠返回的 `NextId` / `PreviousId` 游标。
- `DescribeStrategyList` / 分页字段是 `PageNumber`（不是 `CurrentPage`）：入参格式 `--BusinessSecurityData '{"EventId":<id>,"PageNumber":1,"PageSize":100}'`。传 `CurrentPage` 会报 `UnknownParameter`，省略分页字段会判 `INVALID_PARAM`。
- 已确认不存在 `DescribeStrategys`（带 s 复数）这个 Action，调用会报 `InvalidAction`。要列策略只能用 `DescribeStrategyList`（单数 + List）。SKILL.md 高频场景表里“或 `DescribeStrategys`（全量列出）”那行是错的，按 `DescribeStrategyList` 走即可。
- `DescribeRequestsOverView` / 时间字段必须 `YYYY-MM-DD HH:MM:SS`：SKILL.md 文档示例和默认时间窗口段写的是 `YYYY-MM-DD` 短格式，但实际后端按 `INVALID_PARAM` (Code 1002) 拒绝；正确格式必须含 `00:00:00`/`23:59:59`。入参同样必须包在 `--BusinessSecurityData '{...}'` 里。

---
