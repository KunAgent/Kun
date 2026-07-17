# conference +documents

> **前置条件：** 先阅读 [`../../ihr-shared/SKILL.md`](../../ihr-shared/SKILL.md) 了解共享运行规则和 JSON 协议。

按会话 ID 读取会话文档化预览结果。只读操作，通常作为 `+search` 的第二步动作使用。

当前动作入口：

```bash
ihr-cli conference +documents
```

## 典型触发表达

以下问题通常应进入 `+documents`：

- 把这几个会话的详情给我看一下
- 读取这条面谈的摘要和待办
- 我想看这个会话的转写摘要
- 根据刚才搜到的结果，展开第一个会话

## 命令

```bash
# 单个会话
ihr-cli conference +documents --conferenceSessionIds "4ddbc43b-f289-c897-b306-2750c8c361f4"

# 多个会话
ihr-cli conference +documents --conferenceSessionIds "id1,id2,id3"

# JSON 输入（调试用）
ihr-cli conference +documents --json '{"conferenceSessionIds":["id1","id2"]}'

# 写入输出文件
ihr-cli conference +documents --conferenceSessionIds "id1,id2" --output-file /tmp/ihr_conference_documents.json
```

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--conferenceSessionIds <ids>` | 是 | 会话 ID 列表，逗号分隔 |
| `--json <json>` | 否 | 直接传入 JSON 字符串，调试用 |
| `--stdin` | 否 | 从标准输入读取 JSON 字符串，调试用 |
| `--output-file <file>` | 否 | 将结果额外写入文件 |

## 核心约束

### 1. 必须提供会话 ID

`conferenceSessionIds` 为必填，且每个元素都必须是非空字符串。

### 2. 默认作为第二步动作

如果用户还没有明确目标会话，应先执行 `+search`，不要跳过候选筛选直接读文档。

### 3. 优先读取用户关心的小批量会话

虽然接口支持批量读取，但在交互式场景中，建议优先读取用户当前真正关心的一小批 `conferenceSessionIds`，避免输出过大。

## 输出结果

CLI 统一输出：

```json
{"success":true,"command":"genConferenceSessionDocuments","request":{},"response":{}}
```

业务字段从 `response.data` 读取，重点包括：

| 字段 | 说明 |
|------|------|
| `response.data.requestedCount` | 请求的会话 ID 数量 |
| `response.data.returnedCount` | 实际返回的会话数量，受权限过滤影响 |
| `response.data.previewItems[]` | 文档化预览项，受权限过滤影响 |
| `response.data.previewItems[].conferenceSessionId` | 会话 ID |
| `response.data.previewItems[].status` | 搜索态：`CANCELLED`、`READY`、`STARTED`、`EXPIRED`、`COMPLETED` |
| `response.data.previewItems[].startTime` | 开始时间 |
| `response.data.previewItems[].endTime` | 结束时间 |
| `response.data.previewItems[].createTime` | 创建时间 |
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

1. `startTime`、`endTime`、`createTime` 来自服务端响应模型，格式为 ISO-8601 offset datetime。
2. 本动作不接受时间筛选参数，输入只关注 `conferenceSessionIds`。
3. 当前 controller 会先按权限过滤 `previewItems`，再回填 `returnedCount`；因此返回数量可能小于请求数量。
4. 文本字段属于权限敏感输出；`currentQueryUserIdentity` 只有在服务端成功解析“当前查询用户在该会话中的 participant 身份”时才返回，未解析到时可能为 `null`。

## 如何获取输入参数

最常见路径：

1. 先执行 `+search`
2. 从 `response.data.conferenceSessionIds[]` 选择一个或多个会话
3. 再执行 `+documents`

## 常见错误与排查

| 错误现象 | 根本原因 | 解决方案 |
|---------|---------|---------|
| `conferenceSessionIds 不能为空` | 未传会话 ID | 至少传一个会话 ID |
| `conferenceSessionIds[i] 不能为空` | 列表里存在空字符串 | 清理无效 ID |
| 返回数量少于请求数量 | 部分会话不存在，或当前用户对部分会话无读取权限 | 先核对 ID 是否来自本次搜索结果，并确认当前用户权限 |
| 配置错误 | 尚未初始化 CLI 配置 | 先执行 `ihr-cli config init --base-url <url>` |
| 未登录 | 当前 profile 没有 token | 先执行 `ihr-cli auth login --api-token-stdin` |
| 网络请求失败 | 服务不可达 | 检查服务地址与网络连通性 |

## 提示

- 如果用户只需要候选和少量预览，停留在 `+search` 即可，不必总是进入 `+documents`。
- 如果用户需要对比多个会话，先返回小批量文档预览，再决定是否继续细化。
