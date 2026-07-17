# otl.insert_content

## 1. otl.insert_content

#### 功能说明

向智能文档写入 Markdown 或 HTML 内容。支持从文档开头插入、末尾追加或替换全部内容，写入时系统自动转换为智能文档富文本格式。

> ⚠️ **仅支持 .otl 文件**：传 `.docx`/`.ksheet`/`.dbt`/`.pdf` 等其他格式的 `file_id` 会返回 `InvalidFileKind` 错误，无法通过重试解决。
>
> ⚠️ **`content` 使用 CommonMark 子集**：Unicode 制表图必须用围栏代码块包裹（见下方 param_detail）。
>
> ⚠️ **Markdown 图片要求**：Markdown 内图片请使用 base64 数据 URI 或公网可访问的直链 URL。



#### 操作约束

- **前置检查**：先 otl.block_query 读取现有内容，了解文档当前状态
- **提示**：支持三种写入模式：prepend（开头插入）、append（末尾追加）、replace（替换全部内容）
- **提示**：参数规则：优先使用 format + mode；若不传 pos，则 format 与 mode 必须同时传入；pos 与 format/mode 互斥，不可同时传入
- **提示**：**写入新建/空白文档时必须拆分 title 和 content**：① 从待写入的 Markdown 中提取开头一级标题（`# xxx`）的文字部分作为 `title` 参数；② 将该一级标题行从 `content` 中删除，`content` 从正文或二级标题开始。若 `content` 开头没有一级标题，则自行拟定一个 `title`。**禁止**将一级标题留在 `content` 里而不传 `title`——这会导致文档标题空缺、一级标题错误地出现在正文中
- **提示**：返回 `InvalidArgument` 时不得原样重试；须重构 `content`（检查 Markdown 合法性）或改用 `otl.block_delete` + `otl.block_insert` 精准操作

**幂等性**：否 — 非幂等操作，重复调用会导致内容重复插入；失败后应先用 otl.block_query 确认文档当前状态，再决定是否重新插入

#### 调用示例

新建文档首次写入（title 从一级标题提取，content 从正文开始）：

```json
{
  "file_id": "string",
  "title": "项目周报",
  "content": "## 本周进展\n\n- 完成需求评审\n- 启动开发任务",
  "format": "markdown",
  "mode": "prepend"
}
```

在已有文档末尾追加内容：

```json
{
  "file_id": "string",
  "content": "## 补充说明\n\n以上数据截至本周五。",
  "format": "markdown",
  "mode": "append"
}
```

插入 Mermaid 图（围栏代码块）：

```json
{
  "file_id": "string",
  "content": "## 架构图\n\n```mermaid\ngraph TD\n  A[客户端] --> B[服务端]\n  B --> C[数据库]\n```",
  "format": "markdown",
  "mode": "append"
}
```

替换文档全部内容：

```json
{
  "file_id": "string",
  "content": "## 全新内容\n\n替换后的文档正文。",
  "format": "markdown",
  "mode": "replace"
}
```


#### 参数说明

- `file_id` (string, 必填): 智能文档文件 ID
- `title` (string, 可选): 文档标题
- `content` (string, 必填): 写入内容，支持 Markdown 或 HTML
- `format` (string, 可选): content 字段的格式，markdown 或 html；当不传 pos 时必填，且需与 mode 同时传入。可选值：`markdown` / `html`
- `mode` (string, 可选): 插入位置，prepend=从文档开头插入，append=在文档末尾追加，replace=替换全部内容；当不传 pos 时必填，且需与 format 同时传入。可选值：`prepend` / `append` / `replace`
- `pos` (string, 可选): 已废弃；仅用于兼容历史调用。与 format/mode 互斥，不可同时传入。可选值：`begin` / `end`；默认值：`begin`

#### Unicode 制表图（架构图、数据流等）

**现象**：若 `content` 里用 `┌` `─` `│` `┐` `└` `┘` `┼` 等 Unicode 制表字符画的架构图、数据流、框图等**落在普通段落或列表里**，智能文档会按富文本渲染（比例字体、空白与换行处理），容易出现**线条错位、框线对不齐**。

**原则**：只对**改写前**的源 Markdown 判断一次——这段制表内容**是否已经**在 Markdown **围栏代码块**里。

| 源内容状态 | 写入 `content` 时怎么做 |
| :--- | :--- |
| **尚未**在围栏代码块里（制表字符裸露在段落、列表等中） | 把**整段**制表内容用围栏代码块包裹再写入；**只包裹图，不包裹全部Markdown内容**；语言标签推荐 `text` 或 `plain`。写入后，该段在文档中一般为 **Plain Text** 代码块，等宽显示，对齐可保留。 |
| **已经**在围栏代码块里（含 `text` / `plain` 或未标注语言的代码块） | **原样写入**，勿再套一层围栏。 |

**示例**：下列片段表示写入 `content` 时，**制表段已被围栏代码块包裹**的推荐形态。

````markdown
## 4.1 整体架构

```text
┌──────────────┐     ┌──────────────┐
│  用户交互层   │────▶│   智能体层    │
└──────────────┘     └──────────────┘
```
````

> **说明**：此处仅针对**纯文本 Unicode/ASCII 制表图**。


#### 返回值说明

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "result": "ok"
  }
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.result` | string | ok 表示成功 |


---

