# 图形化文档（思维导图 / 流程图）参考文档

本文件包含腾讯文档 MCP 中思维导图和流程图的创建工具说明。

---

## 工具列表

| 工具名称 | 功能说明 |
|---------|---------|
| create_mind_by_markdown | 通过 Markdown 创建思维导图 |
| create_flowchart_by_mermaid | 通过 Mermaid 语法创建流程图 |

---

## 工具详细说明

### 1. create_mind_by_markdown

#### 功能说明
通过 Markdown 创建思维导图，使用标题层级和列表嵌套表示结构。

#### 调用示例
```json
{
  "title": "产品功能规划",
  "markdown": "# 产品功能规划\n\n## 核心功能\n\n- 文档管理\n    - 创建文档\n    - 编辑文档\n    - 版本控制\n\n## 协作功能\n\n- 实时协作\n- 评论系统\n- 权限管理",
  "parent_id": "folder_1234567890"
}
```

#### 参数说明
- `title` (string, 必填): 思维导图标题
- `markdown` (string, 必填): 层次化的 Markdown 文本
- `parent_id` (string, 可选): 父节点ID，为空时在空间根目录创建，不为空时在指定节点下创建

#### 返回值说明
```json
{
  "file_id": "mind_1234567890",
  "url": "https://docs.qq.com/mind/DV2h5cWJ0R1lQb0lH",
  "error": "",
  "trace_id": "trace_1234567890"
}
```

---

### 2. create_flowchart_by_mermaid

#### 功能说明
通过 Mermaid 语法创建流程图。

#### 调用示例
```json
{
  "title": "用户登录流程",
  "mermaid": "graph TD\n    A[User Access] --> B{Logged in?}\n    B -->|Yes| C[Go to Home]\n    B -->|No| D[Go to Login Page]\n    D --> E[Enter Username and Password]\n    E --> F{Auth Success?}\n    F -->|Yes| C\n    F -->|No| G[Show Error Message]\n    G --> E",
  "parent_id": "folder_1234567890"
}
```

#### 参数说明
- `title` (string, 必填): 流程图标题
- `mermaid` (string, 必填): Mermaid 语法文本，支持中英文内容
- `parent_id` (string, 可选): 父节点ID，为空时在空间根目录创建，不为空时在指定节点下创建

#### 返回值说明
```json
{
  "file_id": "flow_1234567890",
  "url": "https://docs.qq.com/flow/DV2h5cWJ0R1lQb0lH",
  "error": "",
  "trace_id": "trace_1234567890"
}
```

---

## 注意事项

- 两个工具均支持 `parent_id` 参数，可将文档创建到指定目录；不填则在根目录创建
