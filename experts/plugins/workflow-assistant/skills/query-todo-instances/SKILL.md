---
name: query-todo-instances
description: |
  汇金工作流 — 查询待办流程单技能。获取当前用户待处理的流程单列表。
  触发词：待办、我的待办、待处理、待处理流程单、待审批、需要我处理的、待办审批单、我的审批
---

# query-todo-instances — 查询待办流程单

## 功能说明

获取当前用户参与（作为审批人）的待办流程单列表，属于**展示类操作**。

## MCP 工具

| MCP Server | 工具名 |
|------------|--------|
| `huijin-workflow` | `ListParticipateWorkflowInstance` |

> ⚠️ 调用前必须先 `mcp_get_tool_description` 获取参数 schema。

---

## 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Limit | integer | 否 | 分页大小，默认 20 |
| Offset | integer | 否 | 分页偏移，默认 0 |
| NeedDeal | boolean | **✅ 必须** | **必须传 `true`**。筛选需要当前用户处理的待办单据。不传或传 false 只会返回参与过的单据（非真正待办） |
| Status | array | 否 | 状态筛选：`["Running"]` / `["Succeed"]` / `["Failed"]` / `["Revoked"]` |
| Keyword | string | 否 | 标题关键字搜索 |

> ⚠️ **关键参数**：`NeedDeal=true` 是查询待办的核心参数，不带此参数会导致返回结果不完整（只返回部分参与过的单据，而非真正需要你处理的待办）。

---

## 待办流程单展示字段

每条待办流程单需展示以下信息：

| 序号 | 字段 | 说明 |
|------|------|------|
| 1 | 流程单名称 / 流程单ID | 标题 + T 开头 ID |
| 2 | 发起人 | 创建人 RTX |
| 3 | 处理节点 | 当前需要你处理的节点名称 |
| 4 | 节点开始时间 | 该节点激活/到达你的时间 |

---

## 场景化调用流程

### 场景一：模糊查询（默认场景）

**触发条件**：用户说「帮我看看我的待办」「有什么待处理的」等模糊请求。

```
Step 1: mcp_get_tool_description → [["huijin-workflow", "ListParticipateWorkflowInstance"]]
Step 2: mcp_call_tool ListParticipateWorkflowInstance → { "Limit": 10, "Offset": 0, "Status": ["Running"], "NeedDeal": true }
Step 3: 以 Markdown 表格格式输出最近 10 条待办流程单
Step 4: 主动推荐用户进一步操作
```

**输出格式**：使用 @templates/todo-instance-list.md 模板渲染。

**输出后追加引导推荐**：

```markdown
---

💡 **还可以帮你做更多**：
- 📋 **更全/筛选**：需要查看全量待办列表吗？或按关键字、时间范围筛选？
- 📊 **导出表格**：需要我将待办信息导出为 Excel 表格吗？
- 📈 **统计分析**：需要我统计待办情况（如按处理节点分布），并生成统计简报吗？
```

---

### 场景二：导出为 Excel 表格

**触发条件**：用户明确表示需要将待办信息导出为表格/Excel。

```
Step 1: mcp_get_tool_description → [["huijin-workflow", "ListParticipateWorkflowInstance"]]
Step 2: mcp_call_tool ListParticipateWorkflowInstance → { "Limit": 200, "Offset": 0, "Status": ["Running"], "NeedDeal": true }
       （全量获取，分批拉取直到全部获取完毕）
Step 3: 使用 xlsx skill 生成 Excel 表格文件
Step 4: 输出表格文件路径，告知用户已生成
```

**Excel 表格列**：流程单名称、流程单ID、发起人、处理节点、节点开始时间

---

### 场景三：带明确筛选条件

**触发条件**：用户的请求中包含明确的限定词（如状态、关键字、时间范围等）。

```
Step 1: 解析用户的筛选条件，映射为 MCP 参数
Step 2: mcp_get_tool_description → [["huijin-workflow", "ListParticipateWorkflowInstance"]]
Step 3: mcp_call_tool ListParticipateWorkflowInstance → { "Limit": 100, "Offset": 0, "NeedDeal": true, ...筛选参数 }
Step 4: 以 Markdown 表格格式输出**所有**符合筛选条件的待办流程单
```

**筛选参数映射示例**：
- 「进行中的待办」→ `"Status": ["Running"]`
- 「已完成的」→ `"Status": ["Succeed"]`
- 「关键字 xxx」→ `"Keyword": "xxx"`

---

### 场景四：统计分析

**触发条件**：用户明确要求统计待办情况 / 生成报告。

```
Step 1: mcp_get_tool_description → [["huijin-workflow", "ListParticipateWorkflowInstance"]]
Step 2: mcp_call_tool ListParticipateWorkflowInstance → { "Limit": 200, "Offset": 0, "Status": ["Running"], "NeedDeal": true }
       （获取全量待办数据）
Step 3: 对返回数据进行统计分析：
        - 总待办数量
        - 按处理节点分布
        - 按发起人分布
        - 等待时间排行（节点开始时间距今最久的 Top）
Step 4: 以 HTML 简报形式输出统计报告
        参考 @templates/my-todo-briefing.html 的格式和样式
Step 5: 在 HTML 简报前附上"报告内容速览"摘要（Markdown 格式）
```

---

## 展示模板

- Markdown 表格输出：使用 @templates/todo-instance-list.md
- HTML 统计简报：参考 @templates/my-todo-briefing.html 格式

---

## 输出规范

所有回答的**最后**均附上数据来源声明，链接精准到待办列表页：

```markdown
> 以上数据均来自流程平台（https://huijin.woa.com/flow/apply/todo）
```

列表中的每个流程单 ID（T 开头），可通过以下链接查看详情：
- 流程单详情页：`https://huijin.woa.com/flow/apply/detail/{InstanceId}`

---

## 空结果处理

当查询无结果时，提示用户：
- 当前暂无待办流程单
- 确认筛选条件（状态/关键字）是否合适
- 尝试不带筛选条件查询全部

---

## 参考资料

- 状态枚举说明：参考 @references/status-enum.md
