---
name: query-my-instances
description: |
  汇金工作流 — 查询我发起的流程单技能。获取当前用户创建的流程单列表。
  触发词：我发起的、我创建的流程单、我提交的、我的申请、我申请的流程、我的审批单、我发起的审批单
---

# query-my-instances — 查询我发起的流程单

## 功能说明

获取当前用户创建/发起的流程单列表，属于**展示类操作**。

## MCP 工具

| MCP Server | 工具名 |
|------------|--------|
| `huijin-workflow` | `ListApplyWorkflowInstance` |

> ⚠️ 调用前必须先 `mcp_get_tool_description` 获取参数 schema。

---

## 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Limit | integer | 否 | 分页大小，默认 20 |
| Offset | integer | 否 | 分页偏移，默认 0 |
| Status | array | 否 | 状态筛选：`["Running"]` / `["Succeed"]` / `["Failed"]` / `["Revoked"]` |
| Keyword | string | 否 | 标题关键字搜索 |

---

## 我发起的流程单展示字段

每条流程单需展示以下信息：

| 序号 | 字段 | 说明 |
|------|------|------|
| 1 | 流程单名称 / 流程单ID | 标题 + T 开头 ID |
| 2 | 发起时间 | 创建时间 |
| 3 | 流程耗时 | 从发起到当前的耗时（CostTime） |
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
| 其他 | ⚠️ 异常 |

---

## 场景化调用流程

### 场景一：模糊查询（默认场景）

**触发条件**：用户说「帮我看看我发起的流程单」「我提交的申请」等模糊请求。

```
Step 1: mcp_get_tool_description → [["huijin-workflow", "ListApplyWorkflowInstance"]]
Step 2: mcp_call_tool ListApplyWorkflowInstance → { "Limit": 10, "Offset": 0 }
Step 3: 以 Markdown 表格格式输出最近 10 条流程单
Step 4: 主动推荐用户进一步操作
```

**输出格式**：使用 @templates/my-instance-list.md 模板渲染。

**输出后追加引导推荐**：

```markdown
---

💡 **还可以帮你做更多**：
- 📋 **更全/筛选**：需要查看全量列表吗？或按状态、时间范围筛选？
- 📊 **导出表格**：需要我将流程单信息导出为 Excel 表格吗？
- 📈 **统计分析**：需要我统计我发起的流程单情况，并生成统计简报吗？
```

---

### 场景二：导出为 Excel 表格

**触发条件**：用户明确表示需要将流程单信息导出为表格/Excel。

```
Step 1: mcp_get_tool_description → [["huijin-workflow", "ListApplyWorkflowInstance"]]
Step 2: mcp_call_tool ListApplyWorkflowInstance → { "Limit": 200, "Offset": 0 }
       （全量获取，分批拉取直到全部获取完毕）
Step 3: 使用 xlsx skill 生成 Excel 表格文件
Step 4: 输出表格文件路径，告知用户已生成
```

**Excel 表格列**：流程单名称、流程单ID、发起时间、流程耗时、流程单状态、当前节点、当前处理人

---

### 场景三：带明确筛选条件

**触发条件**：用户的请求中包含明确的限定词（如状态、关键字、时间范围等）。

```
Step 1: 解析用户的筛选条件，映射为 MCP 参数
Step 2: mcp_get_tool_description → [["huijin-workflow", "ListApplyWorkflowInstance"]]
Step 3: mcp_call_tool ListApplyWorkflowInstance → { "Limit": 100, "Offset": 0, ...筛选参数 }
Step 4: 以 Markdown 表格格式输出**所有**符合筛选条件的流程单
```

**筛选参数映射示例**：
- 「进行中的流程单」→ `"Status": ["Running"]`
- 「已完成的」→ `"Status": ["Succeed"]`
- 「已驳回的」→ `"Status": ["Failed"]`
- 「已撤单的」→ `"Status": ["Revoked"]`
- 「关键字 xxx」→ `"Keyword": "xxx"`

---

### 场景四：统计分析

**触发条件**：用户明确要求统计流程单情况 / 生成报告。

```
Step 1: mcp_get_tool_description → [["huijin-workflow", "ListApplyWorkflowInstance"]]
Step 2: mcp_call_tool ListApplyWorkflowInstance → { "Limit": 200, "Offset": 0 }
       （获取全量数据）
Step 3: 对返回数据进行统计分析：
        - 总流程单数量
        - 各状态分布（进行中/已结束/已撤单/已驳回）
        - 平均流程耗时
        - 耗时最长的 Top 排行
        - 按时间维度的发起趋势
Step 4: 以 HTML 简报形式输出统计报告
        参考 @templates/my-apply-flow-briefing.html 的格式和样式
Step 5: 在 HTML 简报前附上"报告内容速览"摘要（Markdown 格式）
```

---

## 展示模板

- Markdown 表格输出：使用 @templates/my-instance-list.md
- HTML 统计简报：参考 @templates/my-apply-flow-briefing.html 格式

---

## 输出规范

所有回答的**最后**均附上数据来源声明，链接精准到我发起的列表页：

```markdown
> 以上数据均来自流程平台（https://huijin.woa.com/flow/apply/mine）
```

列表中的每个流程单 ID（T 开头），可通过以下链接查看详情：
- 流程单详情页：`https://huijin.woa.com/flow/apply/detail/{InstanceId}`

---

## 空结果处理

当查询无结果时，提示用户：
- 当前暂无您发起的流程单
- 确认筛选条件（状态/关键字）是否合适
- 尝试不带筛选条件查询全部

---

## 参考资料

- 状态枚举说明：参考 @references/status-enum.md
