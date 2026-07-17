---
name: query-workflow-list
description: |
  汇金工作流 — 查询流程列表技能。支持查询「我的流程」和「公开流程」两种列表。
  触发词：查流程、流程列表、有哪些流程、我的流程、公开流程、流程管理
---

# query-workflow-list — 查询流程列表

## 功能说明

查询流程图纸列表，属于**展示类操作**。分为两种场景：

| 场景 | 说明 | ListType |
|------|------|----------|
| 我的流程 | 查询当前用户管理/创建的流程列表 | `2` |
| 公开流程 | 查询平台上所有公开可见的流程列表 | `0` |

**默认规则**：当用户说「帮我查流程」「我的流程」等未明确指定公开时，默认按「我的流程」处理（ListType=2）。

## MCP 工具

| MCP Server | 工具名 |
|------------|--------|
| `huijin-workflow` | `ListWorkflow` |

> ⚠️ 调用前必须先 `mcp_get_tool_description` 获取参数 schema。

---

## 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Limit | number | 否 | 每页数量，默认 20 |
| Offset | number | 否 | 偏移量，默认 0 |
| ListType | number | ✅ | 列表类型：`0`=公开流程，`2`=我的流程 |
| Keyword | string | 否 | 流程名称关键字搜索 |
| Status | string | 否 | 状态筛选 |
| Category | string | 否 | 分类筛选 |

### ListType 判断规则

| 用户表达 | ListType |
|---------|----------|
| 我的流程、帮我查流程、我管理的流程 | `2` |
| 公开流程、平台流程、所有流程 | `0` |

---

## 场景化调用流程

### 场景一：模糊查询（默认场景）

**触发条件**：用户说「帮我查查我的流程」「看看我有哪些流程」等模糊请求。

```
Step 1: mcp_get_tool_description → [["huijin-workflow", "ListWorkflow"]]
Step 2: mcp_call_tool ListWorkflow → { "Limit": 10, "Offset": 0, "ListType": 2 }
Step 3: 以 Markdown 表格格式输出最近 10 条流程信息
Step 4: 主动推荐用户进一步操作
```

**输出格式**：使用 @templates/workflow-list.md 模板渲染。

**输出后追加引导推荐**：

```markdown
---

💡 **还可以帮你做更多**：
- 📋 **更全/筛选**：需要查看全量流程列表吗？或按状态、分类等条件筛选？
- 📊 **格式化输出**：需要我将流程信息整理成 Excel 表格吗？
- 📈 **统计分析**：需要我统计流程发起情况，并生成统计报告吗？
```

---

### 场景二：整理为表格

**触发条件**：用户明确表示需要将流程信息整理成表格/Excel。

```
Step 1: mcp_get_tool_description → [["huijin-workflow", "ListWorkflow"]]
Step 2: mcp_call_tool ListWorkflow → { "Limit": 100, "Offset": 0, "ListType": 2 }
       （根据上下文决定全量获取或带筛选条件）
Step 3: 使用 xlsx skill 生成 Excel 表格文件
Step 4: 输出表格文件路径，告知用户已生成
```

**Excel 表格列**：流程名称、流程ID、分类、状态、公开/内部、发起量、创建时间、最近更新时间

---

### 场景三：带明确筛选条件

**触发条件**：用户的查找请求中包含明确的限定词（如状态、分类、时间范围、是否公开等）。

```
Step 1: 解析用户的筛选条件，映射为 MCP 参数
Step 2: mcp_get_tool_description → [["huijin-workflow", "ListWorkflow"]]
Step 3: mcp_call_tool ListWorkflow → { "Limit": 100, "Offset": 0, "ListType": 2, ...筛选参数 }
Step 4: 以 Markdown 表格格式输出**所有**符合筛选条件的流程信息
```

**筛选参数映射示例**：
- 「已启用的流程」→ Status 筛选
- 「产商品库的流程」→ Category 筛选
- 「公开流程」→ ListType=0

---

### 场景四：统计分析

**触发条件**：用户明确要求统计流程信息 / 生成报告 / 数据汇总。

```
Step 1: mcp_get_tool_description → [["huijin-workflow", "ListWorkflow"]]
Step 2: mcp_call_tool ListWorkflow → { "Limit": 100, "Offset": 0, "ListType": 2 }
       （获取全量流程数据）
Step 3: 对返回数据进行统计分析：
        - 各状态流程数量（已启用/未发布/已停用）
        - 各分类分布
        - 发起量 Top 排行
        - 本月新增/变化趋势
Step 4: 以 HTML 简报形式输出统计报告
        参考 @templates/my-flows-briefing.html 的格式和样式
Step 5: 在 HTML 简报前附上"报告内容速览"摘要（Markdown 格式）
```

**HTML 简报内容结构**（参考 @templates/my-flows-briefing.html）：
1. 页头：标题 + 数据更新时间
2. 概览卡片：流程总数、已启用、未发布、累计发起量
3. 统计面板：分类饼图 + 发起量 TOP 5
4. 分组流程卡片列表（按状态分组）

---

## 展示模板

- Markdown 表格输出：使用 @templates/workflow-list.md
- HTML 统计简报：参考 @templates/my-flows-briefing.html 格式

---

## 输出规范

所有回答的**最后**均附上数据来源声明，并附精准链接：

- **我的流程**场景 → `> 以上数据均来自流程平台（https://huijin.woa.com/flow）`
- **公开流程**场景 → `> 以上数据均来自流程平台（https://huijin.woa.com/flow/public）`

列表中的每个流程 ID（P 开头），可通过以下链接查看详情：
- 流程详情页：`https://huijin.woa.com/flow/detail/{WorkflowId}`
- 流程编辑页（仅管理员）：`https://huijin.woa.com/flow/edit/{WorkflowId}`

---

## 空结果处理

当查询无结果时，提示用户：
- 检查关键字拼写是否正确
- 确认当前账号是否有流程查看权限
- 尝试不带关键字查询全部流程
- 切换 ListType（我的流程 ↔ 公开流程）试试
