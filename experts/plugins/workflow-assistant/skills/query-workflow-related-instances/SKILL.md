---
name: query-workflow-related-instances
description: |
  汇金工作流 — 查询流程相关单据技能。查看某个流程下所有相关的流程单列表。
  触发词：流程的单据、流程相关的流程单、这个流程有哪些申请、流程下的流程单、P开头ID的流程单、某流程的申请记录
---

# query-workflow-related-instances — 查询流程相关单据

## 功能说明

查询指定流程（WorkflowId）下方所有相关的流程单列表，属于**展示类操作**。

**典型场景**：用户想知道某个流程被使用了多少次、有哪些申请单、某个流程下流程单的审批状态等。

## MCP 工具

| MCP Server | 工具名 |
|------------|--------|
| `huijin-workflow` | `ListWorkflowInstance` |

> ⚠️ 调用前必须先 `mcp_get_tool_description` 获取参数 schema。

---

## 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| WorkflowId | string | ✅ | 工作流ID（以 P 开头），指定查询哪个流程下的流程单 |
| Limit | integer | 否 | 分页大小，默认 20 |
| Offset | integer | 否 | 分页偏移，默认 0 |
| Status | array | 否 | 状态列表，如 `["Running"]`、`["Succeed", "Failed"]` |
| Keyword | string | 否 | 关键字搜索 |
| InstanceIds | array | 否 | 实例ID列表，按指定 ID 精确查询 |
| StartCreateTime | string | 否 | 开始创建时间，按时间范围筛选 |
| SortBy | string | 否 | 排序字段 |
| SortOrder | string | 否 | 排序方式（`asc` / `desc`） |
| SearchFields | array | 否 | 搜索字段 |
| NeedFollow | boolean | 否 | 是否需要关注 |

---

## 流程单列表展示字段

每条流程单需展示以下信息：

| 序号 | 字段 | 说明 |
|------|------|------|
| 1 | 流程单名称 / 流程单ID | 标题 + T 开头 ID |
| 2 | 发起人 | 创建人 RTX |
| 3 | 发起时间 | 创建时间 |
| 4 | 流程单状态 | 进行中/已结束/已撤单/已驳回/异常 |
| 5 | 当前节点 | 当前所在节点名称 |
| 6 | 当前处理人 | 当前节点的处理人 |

### 状态映射

| 状态值 | 展示 |
|--------|------|
| `Running` | 🔄 进行中 |
| `Succeed` | ✅ 已结束 |
| `Revoked` | ↩️ 已撤单 |
| `Failed` | ❌ 已驳回 |
| 其他异常 | ⚠️ 异常 |

---

## 场景化调用流程

### 场景一：模糊查询（默认场景）

**触发条件**：用户说「帮我看看这个流程有哪些申请」「P2026051400000274 的流程单」等模糊请求。

```
Step 1: 确认 WorkflowId（P 开头）
        - 如未提供，先调用 query-workflow-list 让用户选择一个流程
Step 2: mcp_get_tool_description → [["huijin-workflow", "ListWorkflowInstance"]]
Step 3: mcp_call_tool ListWorkflowInstance → { "WorkflowId": "P...", "Limit": 10, "Offset": 0 }
Step 4: 以 Markdown 表格格式输出最近 10 条流程单信息
Step 5: 主动推荐用户进一步操作
```

**输出格式**：使用 @templates/related-instance-list.md 模板渲染。

**输出后追加引导推荐**：

```markdown
---

💡 **还可以帮你做更多**：
- 📋 **更全/筛选**：需要查看全量流程单吗？或按状态、发起人、时间范围筛选？
- 📊 **导出表格**：需要我将流程单信息导出为 Excel 表格吗？
- 📈 **统计分析**：需要我统计该流程的使用情况，并生成统计简报吗？
```

---

### 场景二：导出为 Excel 表格

**触发条件**：用户明确表示需要将流程单信息导出为表格/Excel。

```
Step 1: 确认 WorkflowId
Step 2: mcp_get_tool_description → [["huijin-workflow", "ListWorkflowInstance"]]
Step 3: mcp_call_tool ListWorkflowInstance → { "WorkflowId": "P...", "Limit": 200, "Offset": 0 }
       （全量获取，或根据上下文带筛选条件）
       如数据超出 200 条，分批获取直到全部拉取完毕
Step 4: 使用 xlsx skill 生成 Excel 表格文件
Step 5: 输出表格文件路径，告知用户已生成
```

**Excel 表格列**：

| 列名 | 来源字段 |
|------|---------|
| 流程单名称 | Title |
| 流程单ID | Id |
| 发起人 | Creator |
| 发起时间 | CreateTime |
| 流程单状态 | Status（转中文） |
| 当前节点 | CurrentTaskName |
| 当前处理人 | CurrentHandler |
| 更新时间 | UpdateTime |

---

### 场景三：带明确筛选条件

**触发条件**：用户的请求中包含明确的限定词（如状态、发起人、时间范围等）。

```
Step 1: 确认 WorkflowId + 解析用户筛选条件
Step 2: mcp_get_tool_description → [["huijin-workflow", "ListWorkflowInstance"]]
Step 3: mcp_call_tool ListWorkflowInstance → { "WorkflowId": "P...", "Limit": 100, "Offset": 0, ...筛选参数 }
Step 4: 以 Markdown 表格格式输出**所有**符合筛选条件的流程单
```

**筛选参数映射示例**：

| 用户表达 | 映射参数 |
|---------|---------|
| 「进行中的流程单」 | `"Status": ["Running"]` |
| 「已完成的」 | `"Status": ["Succeed"]` |
| 「已驳回的」 | `"Status": ["Failed"]` |
| 「已撤单的」 | `"Status": ["Revoked"]` |
| 「最近一周的」 | `"StartCreateTime": "7天前的日期"` |
| 「关键字 xxx」 | `"Keyword": "xxx"` |
| 「按时间倒序」 | `"SortBy": "CreateTime", "SortOrder": "desc"` |

---

### 场景四：统计分析

**触发条件**：用户明确要求统计该流程的使用情况 / 生成报告 / 数据汇总。

```
Step 1: 确认 WorkflowId
Step 2: mcp_get_tool_description → [["huijin-workflow", "ListWorkflowInstance"]]
Step 3: mcp_call_tool ListWorkflowInstance → { "WorkflowId": "P...", "Limit": 200, "Offset": 0 }
       （获取全量数据，分批拉取）
Step 4: 对返回数据进行统计分析：
        - 总流程单数量
        - 各状态分布（进行中/已结束/已撤单/已驳回/异常）
        - 发起人分布 Top 排行
        - 按时间维度的发起趋势（日/周/月）
        - 平均处理时长
Step 5: 以 HTML 简报形式输出统计报告
Step 6: 在 HTML 简报前附上"报告内容速览"摘要（Markdown 格式）
```

**HTML 简报内容结构**：
1. 页头：流程名称 + 数据更新时间
2. 概览卡片：流程单总数、进行中、已结束、已驳回/撤单
3. 统计面板：状态饼图 + 发起人 TOP 5 + 时间趋势折线图
4. 流程单列表（按状态分组展示）

---

## 展示模板

- Markdown 表格输出：使用 @templates/related-instance-list.md
- HTML 统计简报：参考 query-workflow-list 中 @templates/my-flows-briefing.html 的格式和样式

---

## 输出规范

所有回答的**最后**均附上数据来源声明，链接精准到当前流程的详情页：

```markdown
> 以上数据均来自流程平台（https://huijin.woa.com/flow/detail/{WorkflowId}）
```

例如：`> 以上数据均来自流程平台（https://huijin.woa.com/flow/detail/P2025122400000848）`

列表中的每个流程单 ID（T 开头），可通过以下链接查看详情：
- 流程单详情页：`https://huijin.woa.com/flow/apply/detail/{InstanceId}`

---

## 空结果处理

当查询无结果时，提示用户：
- 确认流程 ID（P 开头）是否正确
- 该流程可能尚未有人发起申请
- 尝试调整筛选条件（如去掉状态限制）
- 确认是否有查看该流程流程单的权限

---

## 注意事项

- **WorkflowId 是必填参数**：如果用户没有明确给出，需引导其先通过 `query-workflow-list` 查询流程列表再选择
- 返回的流程单 ID 以 T 开头，可进一步调用 `query-instance-detail` 查看详情
- 支持分页，如结果超出 Limit 数量，提示用户是否查看下一页或导出全量
- 统计分析场景需要全量数据，必要时分批拉取（每次 200 条，循环获取直到 Offset >= Total）
