# conference +search

> **前置条件：** 先阅读 [`../../ihr-shared/SKILL.md`](../../ihr-shared/SKILL.md) 了解共享运行规则、时间处理方式和 JSON 协议。

搜索历史面谈记录，支持文本搜索、状态过滤、开始/结束时间范围、创建时间范围和首轮预览。只读操作，不修改任何会议数据。

当前动作入口：

```bash
ihr-cli conference +search
```

## 典型触发表达

以下问题通常优先使用 `+search`：

- 最近开过哪些面谈
- 上周聊过预算评审的会
- 3 月已经结束的绩效面谈
- 最近 30 天和渠道拓展有关的面谈
- 先帮我找几条香港出海相关的历史面谈

## 命令

```bash
# 关键词搜索
ihr-cli conference +search --queryText "绩效面谈"

# 按时间范围搜索
ihr-cli conference +search --startTimeFrom "2026-03-01 00:00:00" --startTimeTo "2026-03-31 23:59:59"

# 按创建时间范围搜索
ihr-cli conference +search --createdAtFrom "2026-03-01 00:00:00" --createdAtTo "2026-03-31 23:59:59"

# 关键词 + 状态 + 预览
ihr-cli conference +search --queryText "渠道拓展" --statuses "READY,STARTED,COMPLETED" --previewLimit 5

# 时间范围 + 排序
ihr-cli conference +search --startTimeFrom "2026-03-01 00:00:00" --startTimeTo "2026-03-31 23:59:59" --sortField START_TIME --sortOrder DESC

# JSON 输入（调试用）
ihr-cli conference +search --json '{"queryText":"预算评审","previewLimit":3}'

# 写入输出文件
ihr-cli conference +search --queryText "香港出海" --output-file /tmp/ihr_conference_search.json
```

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--queryText <text>` | 否 | 搜索关键词 |
| `--statuses <values>` | 否 | 状态列表，逗号分隔，可选值：`CANCELLED`、`READY`、`STARTED`、`EXPIRED`、`COMPLETED` |
| `--startTimeFrom <time>` | 否 | 开始时间下界 |
| `--startTimeTo <time>` | 否 | 开始时间上界 |
| `--endTimeFrom <time>` | 否 | 结束时间下界 |
| `--endTimeTo <time>` | 否 | 结束时间上界 |
| `--createdAtFrom <time>` | 否 | 创建时间下界 |
| `--createdAtTo <time>` | 否 | 创建时间上界 |
| `--sortField <field>` | 否 | 排序字段，取值：`START_TIME`、`END_TIME`；当存在 `queryText` 时，默认按相关性排序，显式指定时间字段后改为“先过相关性门槛，再按时间排序” |
| `--sortOrder <order>` | 否 | 排序方向，取值：`ASC`、`DESC`；仅在显式指定时间排序时影响最终结果顺序 |
| `--previewLimit <n>` | 否 | 预览数量，范围 `0-10` |
| `--json <json>` | 否 | 直接传入 JSON 字符串，调试用 |
| `--stdin` | 否 | 从标准输入读取 JSON 字符串，调试用 |
| `--output-file <file>` | 否 | 将结果额外写入文件 |

## 核心约束

### 1. 至少提供一个有效查询条件

必须至少提供一个有效查询条件，例如：

1. `queryText`
2. `statuses`
3. 任一时间范围字段
4. 任一排序参数（`sortField` 或 `sortOrder`）
5. `previewLimit > 0`

### 2. 默认面向历史面谈

本动作的定位是历史记录检索，不应被用作未来日程或发起动作入口。

### 3. 预览数量上限为 10

`previewLimit` 取值范围固定为 `0-10`。  
当结果很多时，应优先返回少量 `previewItems`，再决定是否继续进入 `+documents`。

### 4. 相对时间先换算

遇到“今天、上周、最近 30 天、最近两个月”之类表达，先换算成绝对日期，再传入命令。

### 5. `queryText` 场景下的排序规则

当传入 `queryText` 时：

1. 默认按相关性排序。
2. 如果显式指定 `--sortField START_TIME` 或 `--sortField END_TIME`，则先过滤掉相关性不足的结果，再按时间排序。
3. `previewItems[].finalScore` 仍然表示 `0-1` 的相关性分数，可用于辅助判断结果质量。

### 6. `statuses` 使用搜索态，不是底层原始状态直出

`--statuses` 当前收敛为五种搜索态：

1. `CANCELLED`
2. `READY`
3. `STARTED`
4. `EXPIRED`
5. `COMPLETED`

补充说明：

1. `COMPLETED` 表示“面谈已完成且派生结果也已完成”，不是单纯底层会话结束。
2. `STARTED` 是搜索态，会归并多种进行中语义。
3. 未知或空白状态字面量会按当前兼容口径归一化为 `CANCELLED`。

### 7. `previewItems` 会受权限过滤

当前 controller 会先按当前用户权限过滤 `previewItems`，再用过滤后的结果重建：

1. `response.data.returnedCount`
2. `response.data.conferenceSessionIds`
3. `response.data.previewItems`

因此：

1. `previewItems` 中某些文本字段可能被裁剪为空。
2. `currentQueryUserIdentity` 用于表达当前查询用户在该会话中的身份信息。

### 8. 默认先搜索，再读文档

除非用户明确要求内容详情，否则不要在首轮搜索后自动对所有命中会话执行 `+documents`。

## 时间格式

推荐时间字符串格式：

| 格式 | 示例 |
|------|------|
| 日期时间 | `2026-03-10 14:00:00` |
| 仅日期 | `2026-03-10` |

## 输出结果

CLI 统一输出：

```json
{"success":true,"command":"queryConference","request":{},"response":{}}
```

业务字段从 `response.data` 读取，重点包括：

| 字段 | 说明 |
|------|------|
| `response.data.returnedCount` | 本次返回的候选会话数 |
| `response.data.truncated` | 是否可能还有更多结果未返回 |
| `response.data.previewLimit` | 预览上限 |
| `response.data.conferenceSessionIds[]` | 候选会话 ID 列表 |
| `response.data.previewItems[]` | 首轮预览项，受权限过滤影响 |
| `response.data.previewItems[].conferenceSessionId` | 会话 ID |
| `response.data.previewItems[].status` | 搜索态：`CANCELLED`、`READY`、`STARTED`、`EXPIRED`、`COMPLETED` |
| `response.data.previewItems[].startTime` | 开始时间 |
| `response.data.previewItems[].endTime` | 结束时间 |
| `response.data.previewItems[].createTime` | 创建时间 |
| `response.data.previewItems[].finalScore` | 相关性分数，范围 `0-1`，仅搜索预览中有 |
| `response.data.previewItems[].basicText` | 面谈基础信息文本 |
| `response.data.previewItems[].outlineText` | 面谈大纲文本 |
| `response.data.previewItems[].smartMinutesText` | 面谈智能纪要文本 |
| `response.data.previewItems[].topicText` | 面谈主题文本 |
| `response.data.previewItems[].summaryText` | 摘要文本 |
| `response.data.previewItems[].todoText` | 待办文本 |
| `response.data.previewItems[].transcriptSummaryText` | 转写摘要文本 |
| `response.data.previewItems[].currentQueryUserIdentity` | 当前查询用户在该会话中的身份信息；未解析到时可能为空 |
| `response.data.previewItems[].currentQueryUserIdentity.userId` | 当前发起搜索的用户 ID |
| `response.data.previewItems[].currentQueryUserIdentity.searchRole` | 搜索视角角色；当前固定为 `CURRENT_USER` |
| `response.data.previewItems[].currentQueryUserIdentity.participantNames` | 当前用户在该会话中的名称聚合，多个名称用 `|` 分隔 |
| `response.data.previewItems[].currentQueryUserIdentity.roleName` | 当前用户在该会话中的角色名称 |

补充说明：

1. 请求里的时间筛选字段使用 `yyyy-MM-dd` 或 `yyyy-MM-dd HH:mm:ss`。
2. 响应里的 `startTime`、`endTime`、`createTime` 来自服务端响应模型，格式为 ISO-8601 offset datetime。
3. `queryText` 默认按相关性排序；若显式指定时间排序，则结果是在通过相关性门槛后，再按时间字段排序。
4. 当前 controller 会用过滤后的 `previewItems` 重建 `returnedCount` 与 `conferenceSessionIds`，三者语义保持一致。
5. 文本字段属于权限敏感输出；`currentQueryUserIdentity` 只有在服务端成功解析“当前查询用户在该会话中的 participant 身份”时才返回，未解析到时可能为 `null`。

## 搜索结果中的下一步

当用户明确需要查看具体内容时，从 `response.data.conferenceSessionIds[]` 中选择目标会话，继续执行：

```bash
ihr-cli conference +documents --conferenceSessionIds "<conferenceSessionId>"
```

## 常见错误与排查

| 错误现象 | 根本原因 | 解决方案 |
|---------|---------|---------|
| 缺少输入参数 | 没有传任何有效条件 | 至少补一个查询条件 |
| `previewLimit 取值范围必须为 0-10` | 预览数量越界 | 改为 `0-10` |
| 无结果 | 条件过窄 | 先只保留关键词或缩小过滤条件 |
| 配置错误 | 尚未初始化 CLI 配置 | 先执行 `ihr-cli config init --base-url <url>` |
| 未登录 | 当前 profile 没有 token | 先执行 `ihr-cli auth login --api-token-stdin` |
| 网络请求失败 | 服务不可达 | 检查服务地址与网络连通性 |

## 提示

- 默认优先输出少量 preview，而不是一开始就拉所有文档。
- `truncated=true` 时，应优先缩小查询范围，而不是盲目继续放大返回量。
- 调试输入结构时，优先使用 `--json` 或 `--stdin`。
