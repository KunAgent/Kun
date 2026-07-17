# DOC 编辑引擎 API 参考

本文件包含腾讯文档 DOC 编辑引擎（docengine）的所有工具 API 说明。这些工具专用于 Word 文档的编辑操作，包括用 Markdown 创建文档（create_with_markdown）、插入markdown(一般与创建文档组合使用，1.创建文档 2.插入markdown)，文本插入、替换、查找、段落设置、文本属性修改、任务插入、图片插入、分页符和表格插入等。

> ⚠️ **注意**：本文档中的工具仅适用于 **Word 文档（doc_type: word）** 类型，不适用于智能文档（smartcanvas）等其他类型。

---

## 服务信息

| 项目 | 说明 |
|------|------|
| 服务名 | `tencent-docengine` |
| API 地址 | `https://docs.qq.com/api/v6/doc/mcp` |
| 调用方式 | `mcporter call tencent-docengine <工具名>` |
| Token | 与 tencent-docs **共用同一个 Token**，完成 tencent-docs 授权（`auth.md`）后自动配置，无需单独鉴权 |
| 文档类型 | 仅支持 Word 文档类型 |

> ⚠️ **推荐优先使用 `file_url`（文档链接）而非 `file_id` 来标识文档**，用户通常直接提供文档链接，使用更便捷。
>
> 编辑前推荐先调用 `get_outline` 获取文档大纲结构，了解各标题和正文的可操作位置。
>
> 当用户要求「在文档开头插入」时，需向用户确认是在「文档标题之前」（使用 `HEADING_LEVEL_TITLE` 的 `title_start`）还是「正文开头/标题之后」（使用 `HEADING_LEVEL_TITLE` 的 `content_start`）插入，未明确时应主动询问。
> 
> 当用户要求将结果写入文档时, 推荐使用 `create_with_markdown` 一步创建 Word 文档；也可以与创建文档manage.create_file组合使用，1.创建word文档 2.获取插入位置get_last_operable_pos 3.插入markdown(insert_markdown)

---

## 通用说明

### 文档标识

所有 docengine 工具都支持两种文档标识方式（二选一）：
- `file_url` (string): **⭐ 推荐** 腾讯文档的文档链接（如 `https://docs.qq.com/doc/xxxxxxxx`），直接使用用户提供的文档链接即可
- `file_id` (string): 文档唯一标识符

> 💡 **推荐优先使用 `file_url`**：用户通常会直接提供文档链接，使用 `file_url` 无需额外解析 `file_id`，更加便捷。

### 响应结构

编辑类 API 返回：
- `base_version` (int64): 文档的基准版本号
- `new_version` (int64): 编辑后的文档新版本号
- `err_msg` (string): 错误信息（成功时为空）
- `trace_id` (string): 调用链追踪 ID

查询类 API（如 find）返回：
- `read_result.version` (int64): 文档当前版本号
- `read_result.trace_id` (string): 调用链追踪 ID

---

## 工具列表

| 工具名称 | 功能说明 |
|---------|---------|
| create_with_markdown | 用 Markdown 创建 Word 文档，一步完成文档创建和内容写入 |
| find | 查找文本所在位置，返回匹配位置和上下文 |
| insert_text | 在指定位置插入文本 |
| insert_paragraph | 在指定位置插入段落，支持设置标题级别、编号类别和编号级别 |
| replace_text | 替换指定范围内的文本 |
| find_and_replace_text | 查找并替换文档中所有匹配的文本 |
| update_text_property | 更新指定范围内文本的属性（加粗、斜体、下划线、删除线、颜色等） |
| update_line_spacing | 更新段落行距和段落间距（段前间距、段后间距、行距） |
| insert_task | 在指定位置插入一个或多个任务，支持设置任务状态和内容文本 |
| insert_image | 在指定位置插入图片 |
| insert_page_break | 在指定位置插入分页符 |
| insert_table | 在指定位置插入表格 |
| insert_comment | 在指定范围插入批注 |
| replace_image | 替换文档中的图片 |
| insert_markdown | 在指定位置插入 Markdown 格式内容，引擎自动转换为富文本 |
| get_images | 获取文档中所有图片的信息，包括图片位置（idx）、图片 URL 或附件 ID，可用于后续 replace_image 操作 |
| get_last_operable_pos | 获取文档末尾最后一个可操作位置的索引及前面内容 |
| get_outline | 获取文档大纲结构（标题层级树），包含各标题和正文的可操作起止位置 |
| resolve_document_structure | 获取文档完整结构树，返回所有块级元素（段落、标题、表格、文本框、代码块等）的层级结构和精确位置，可用于定位表格指定行列、文本框内部等复杂位置 |

---

## 工具详细说明

## 0. create_with_markdown

### 功能说明
用 Markdown 内容直接创建一篇新的 Word 文档（DOC）。无需先调用 `manage.create_file` 再 `insert_markdown`，一步完成文档创建和内容写入。适合需要快速将 Markdown 格式内容生成为 Word 文档的场景。

> ⚠️ **推荐使用 `base64_markdown` 参数**：由于 Markdown 内容中可能包含特殊字符（如换行符、引号等），直接传递可能导致 JSON 解析问题。**建议先将 Markdown 内容进行 base64 编码后，通过 `base64_markdown` 参数传递**。

### 调用示例

**使用 base64_markdown（推荐）：**
```json
{
  "base64_markdown": "IyDmoIfpopgKCui/meaYr+S4gOautSoq5Yqg57KXKirmlofmnKzjgIIKCi0g5YiX6KGo6aG5MQotIOWIl+ihqOmhuTIKCnwg5aeT5ZCNIHwg5bm06b6EIHwKfC0tLS0tLXwtLS0tLS18Cnwg5byg5LiJIHwgMjUgfA==",
  "title": "我的文档"
}
```

### 参数说明
- `base64_markdown` (string, ⭐ 推荐): Markdown 内容的 base64 编码字符串。**推荐优先使用此参数**，先将 Markdown 文本进行标准 base64 编码后传入
- `title` (string, 可选): 文档标题。不传时使用 Markdown 内容中的第一个标题，或自动生成

### 返回值说明
```json
{
  "file_id": "doc_1234567890",
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "version": 1,
  "last_index": 100
}
```
- `file_id` (string): 创建的文档唯一标识符
- `file_url` (string): 创建的文档链接，可直接在浏览器中打开
- `version` (int64): 当前文档版本号
- `last_index` (int64): 文档最后一个字符的索引位置，可用于后续在文档末尾追加内容

### 推荐使用流程
1. 准备好 Markdown 格式的文档内容，将其保存为 `<workspace>/.tmp/tencent_docs/<标题>.md` 文件（`<标题>` 为文档标题）
2. 使用系统 `base64` 命令将 Markdown 文件进行 base64 编码，并将结果写入**当前工作区目录下**的文件（确保 agent 可通过 read_file 访问）：
   ```bash
   mkdir -p <workspace>/.tmp/tencent_docs
   # 输入为已保存的 .md 文件，编码后写入工作区目录下的文件
   base64 -w 0 <workspace>/.tmp/tencent_docs/<标题>.md > <workspace>/.tmp/tencent_docs/encoded_<标题>.txt
   # 输入为文本字符串，编码后写入工作区目录下的文件
   echo -n "# 标题\n正文内容" | base64 -w 0 > <workspace>/.tmp/tencent_docs/encoded_<标题>.txt
   ```
   > 💡 macOS 上使用 `base64`（无需 `-w 0` 参数），Linux 上使用 `base64 -w 0` 禁止换行
   > ⚠️ `<workspace>` 为当前项目的工作区根目录绝对路径。文件必须保存在工作区目录下，否则 agent 的 read_file 工具无法读取。首次使用前需确保目录存在（`mkdir -p <workspace>/.tmp/tencent_docs`）
3. 使用 read_file 工具读取工作区下的输出文件（如 `<workspace>/.tmp/tencent_docs/encoded_<标题>.txt`）获取 base64 编码后的 Markdown 内容
4. 调用 `create_with_markdown` 传入读取到的 `base64_markdown` 和可选的 `title`
5. 从返回值中获取 `file_url`，即可访问创建好的 Word 文档
6. 如需继续编辑，可使用返回的 `file_id`/`file_url` 和 `last_index` 调用其他 docengine 工具

---

## 1. find

### 功能说明
在 Word 文档中查找指定文本，返回所有匹配位置及其上下文。如果用户需要替换文本，建议先使用 `find` 查找文本所在的各处位置，让用户确认要替换哪个位置后，再调用 `replace_text` 进行精确替换。

### 调用示例
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "text": "要查找的文本"
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `text` (string, 必填): 要查找的文本内容

### 返回值说明
```json
{
  "text_and_locations": [
    {
      "range": { "begin": 10, "end": 15 },
      "related_text": "...上下文文本..."
    }
  ],
  "read_result": {
    "version": 1,
    "trace_id": "trace_1234567890"
  }
}
```
- `text_and_locations` (array): 匹配到的文本位置列表
  - `range.begin` (uint32): 匹配文本的起始位置
  - `range.end` (uint32): 匹配文本的结束位置
  - `related_text` (string): 匹配位置的上下文文本
- `read_result.version` (int64): 当前文档版本号
- `read_result.trace_id` (string): 调用相关的可追踪链路id

### 推荐使用流程
1. 调用 `find` 查找目标文本，获取所有匹配位置
2. 将匹配结果展示给用户，让用户选择要替换的位置
3. 根据用户选择，调用 `replace_text` 传入对应的 `range` 进行替换

---

## 2. insert_text

### 功能说明
在 Word 文档的指定位置插入文本。

### 调用示例
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "text": "要插入的文本内容",
  "index": 0
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `text` (string, 必填): 要插入的文本内容
- `index` (integer, 必填): 插入位置的索引，从 0 开始，请确认好索引后再操作

### 返回值说明
```json
{
  "base_version": 1,
  "new_version": 2,
  "trace_id": "trace_1234567890",
  "err_msg": ""
}
```

---

## 3. insert_paragraph

### 功能说明
在 Word 文档的指定位置插入段落。支持设置标题级别、编号类别和编号级别，可用于创建标题、有序/无序列表等。

### 调用示例
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "idx": 0,
  "level": "1",
  "type": "1",
  "numbering_lvl": "1",
  "space_cnt": 0
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `idx` (integer, 必填): 插入位置的索引，从 0 开始
- `level` (string, 可选): 标题级别，取值：
  - `"0"`: 未指定（保持原样）
  - `"1"` ~ `"9"`: 一级标题 ~ 九级标题
  - `"10"`: 正文（无标题）
  - `"11"`: 标题
  - `"12"`: 副标题
- `type` (string, 可选): 编号类别，取值：
  - `"0"`: 未知/无编号
  - `"1"`: 圆点列表（无序列表）
  - `"2"`: 数字编号列表（有序列表）
- `numbering_lvl` (string, 可选): 编号级别，取值与 `level` 相同（`"1"` ~ `"9"`）
- `space_cnt` (integer, 可选): 空格数量

### 返回值说明
```json
{
  "base_version": 1,
  "new_version": 2,
  "trace_id": "trace_1234567890",
  "err_msg": ""
}
```

---

## 4. replace_text

### 功能说明
替换 Word 文档中指定范围内的文本为新文本。建议先使用 `find` 工具查找文本位置，让用户确认后再调用此工具进行精确替换。

### 调用示例
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "text": "替换后的文本内容",
  "ranges": [{"start_index": 0, "end_index": 5}]
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `text` (string, 必填): 替换后的文本内容
- `ranges` (array, 必填): 需要替换的文本范围列表，每个范围包含 `start_index` 和 `end_index`

### 返回值说明
```json
{
  "base_version": 1,
  "new_version": 2,
  "trace_id": "trace_1234567890",
  "err_msg": ""
}
```

---

## 5. find_and_replace_text

### 功能说明
在 Word 文档中查找所有匹配的文本并直接替换为新文本。与 `find` + `replace_text` 的组合不同，此工具会直接替换所有匹配项，用户无法选择性地替换某个特定位置。

### 调用示例
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "old_text": "要查找的文本",
  "new_text": "替换后的文本"
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `old_text` (string, 必填): 要查找的原始文本
- `new_text` (string, 必填): 替换后的新文本

### 返回值说明
```json
{
  "base_version": 1,
  "new_version": 2,
  "trace_id": "trace_1234567890",
  "err_msg": ""
}
```

---

## 6. update_text_property

### 功能说明
更新 Word 文档中指定范围内文本的属性，支持设置加粗、斜体、下划线、删除线、小型大写、字体颜色、背景颜色等。建议先使用 `find` 工具查找文本位置，获取 range 后再调用此工具修改文本属性。

### 调用示例
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "ranges": [{"begin": 0, "end": 5}],
  "property": {
    "bold": true,
    "color": "#FF0000"
  }
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `ranges` (array, 必填): 需要更新属性的文本范围列表，每个范围包含 `begin` 和 `end`
- `property` (object, 必填): 要设置的文本属性，支持以下字段：
  - `bold` (bool, 可选): 是否加粗
  - `italic` (bool, 可选): 是否斜体
  - `underline` (bool, 可选): 是否下划线
  - `strikethrough` (bool, 可选): 是否删除线
  - `small_caps` (bool, 可选): 是否小型大写
  - `color` (string, 可选): 字体颜色，如 "#FF0000"
  - `background_color` (string, 可选): 背景颜色，如 "#FFFF00"

### 返回值说明
```json
{
  "base_version": 1,
  "new_version": 2,
  "trace_id": "trace_1234567890",
  "err_msg": ""
}
```

---

## 6.5. update_line_spacing

### 功能说明
更新 Word 文档中指定段落的行距和段落间距。支持设置段前间距、段后间距和行距。建议先使用 `get_outline` 或 `resolve_document_structure` 工具获取段落位置范围，再调用此工具修改行距。

> 💡 **提示**：
> - 可以一次性更新多个段落的行距（通过 `ranges` 数组传入多个范围）
> - `before`、`after`、`line` 三个参数至少需要设置其中一个
> - `line_rule` 决定了 `line` 值的含义：
>   - `"auto"`（默认）：`line` 表示**倍数行距**，如 `1.5` 表示 1.5 倍行距，`2` 表示 2 倍行距
>   - `"exact"`：`line` 表示**固定磅值**，如 `24` 表示固定 24 磅行距
>   - `"atLeast"`：`line` 表示**最小磅值**，如 `20` 表示行距不小于 20 磅

### 调用示例

**设置 1.5 倍行距（默认 auto 模式）：**
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "ranges": [{"begin": 0, "end": 50}],
  "spacing": {
    "line": 1.5
  }
}
```

**设置 2 倍行距和段落间距：**
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "ranges": [{"begin": 0, "end": 50}],
  "spacing": {
    "before": 6,
    "after": 6,
    "line": 2
  }
}
```

**设置固定 24 磅行距：**
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "ranges": [{"begin": 100, "end": 200}],
  "spacing": {
    "line": 24,
    "line_rule": "exact"
  }
}
```

**设置最小 20 磅行距：**
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "ranges": [{"begin": 100, "end": 200}],
  "spacing": {
    "line": 20,
    "line_rule": "atLeast"
  }
}
```

**批量更新多个段落：**
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "ranges": [
    {"begin": 0, "end": 50},
    {"begin": 100, "end": 150},
    {"begin": 200, "end": 300}
  ],
  "spacing": {
    "before": 12,
    "after": 12,
    "line": 1.5
  }
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `ranges` (array, 必填): 需要更新行距的段落范围列表，每个范围包含：
  - `begin` (integer): 段落起始位置索引
  - `end` (integer): 段落结束位置索引
- `spacing` (object, 必填): 行距和段落间距属性，至少需要设置以下字段之一：
  - `before` (number, 可选): 段前间距，单位为磅（pt），如 `6` 表示段前 6 磅间距
  - `after` (number, 可选): 段后间距，单位为磅（pt），如 `6` 表示段后 6 磅间距
  - `line` (number, 可选): 行距数值，含义取决于 `line_rule`：
    - 当 `line_rule` 为 `"auto"`（默认）时：表示**倍数行距**，直接传入倍数值即可。常用值：
      - `1` - 单倍行距
      - `1.15` - 1.15 倍行距
      - `1.5` - 1.5 倍行距
      - `2` - 2 倍行距
      - `2.5` - 2.5 倍行距
      - `3` - 3 倍行距
    - 当 `line_rule` 为 `"exact"` 时：表示**固定磅值**，如 `24` 表示固定 24 磅
    - 当 `line_rule` 为 `"atLeast"` 时：表示**最小磅值**，如 `20` 表示行距不小于 20 磅
  - `line_rule` (string, 可选): 行距规则，默认为 `"auto"`。取值：
    - `"auto"` - 多倍行距（默认值，用户说"几倍行距"时使用此模式）
    - `"exact"` - 固定值（用户说"固定 XX 磅行距"时使用此模式）
    - `"atLeast"` - 最小值（用户说"最小 XX 磅行距"时使用此模式）

### 返回值说明
```json
{
  "base_version": 1,
  "new_version": 2,
  "trace_id": "trace_1234567890",
  "err_msg": ""
}
```

### 使用场景

**场景 1：用户要求「把第一段的行距调成 1.5 倍」**
1. 调用 `get_outline` 或 `resolve_document_structure` 获取第一段的位置范围（如 `begin: 0, end: 50`）
2. 调用 `update_line_spacing`，设置 `line: 1.5`（默认 auto 模式，1.5 倍行距）

**场景 2：用户要求「增加段落间距，让文档看起来更疏松」**
1. 获取需要调整的段落范围
2. 调用 `update_line_spacing`，设置 `before: 12, after: 12`（段前段后各 12 磅）

**场景 3：用户要求「把所有正文段落的行距改成 2 倍行距」**
1. 调用 `get_outline` 获取所有正文段落的范围列表
2. 调用 `update_line_spacing`，在 `ranges` 中传入所有段落范围，设置 `line: 2`

**场景 4：用户要求「把行距设为固定 24 磅」**
1. 获取需要调整的段落范围
2. 调用 `update_line_spacing`，设置 `line: 24, line_rule: "exact"`

**场景 5：用户要求「把行距设为最小 20 磅」**
1. 获取需要调整的段落范围
2. 调用 `update_line_spacing`，设置 `line: 20, line_rule: "atLeast"`

---

## 7. insert_task

### 功能说明
在 Word 文档的指定位置插入一个或多个任务（待办事项）。每个任务支持设置任务状态（待办/已完成）和任务内容文本。

### 调用示例

**插入单个任务：**
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "idx": 0,
  "tasks": [
    {
      "state": 1,
      "content": "完成需求文档编写"
    }
  ]
}
```

**插入多个任务：**
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "idx": 5,
  "tasks": [
    {
      "state": 1,
      "content": "完成需求文档编写"
    },
    {
      "state": 2,
      "content": "完成接口设计"
    },
    {
      "state": 1,
      "content": "编写单元测试"
    }
  ]
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `idx` (integer, 必填): 插入位置的索引，从 0 开始
- `tasks` (array, 必填): 任务列表，支持一次插入多个任务，每个任务包含：
  - `state` (integer, 必填): 任务状态枚举值，不允许传递0值，取值：
    - `1`: 待办（未完成）
    - `2`: 已完成
  - `content` (string, 必填): 任务内容文本

### 返回值说明
```json
{
  "base_version": 1,
  "new_version": 2,
  "trace_id": "trace_1234567890",
  "err_msg": ""
}
```

---

### insert_image

#### 功能说明
在 Word 文档的指定位置插入图片。

#### 调用示例
```json
{
  "file_id": "doc_1234567890",
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "content": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "index": 0,
  "width": 400,
  "height": 300
}
```

#### 参数说明
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `file_url` (string, 可选): 腾讯文档的文档链接，与 `file_id` 二选一
- `content` (string, 可选): 图片的 base64 内容，与 `image_id` 二选一，**适合图片体积较小的场景，若图片过大导致 base64 内容超出传输限制，请改用 `image_id` 方式**
- `image_id` (string, 可选): 图片的 image_id，本质是对图片信息加密后的字符串，与 `content` 二选一。**适合图片体积较大、base64 内容超出传输限制的场景**。获取方式：
  - 通过 `upload_image` MCP 接口上传图片后获取
  - 通过[腾讯文档开放平台 OpenAPI](https://docs.qq.com/open/developers/?nlc=1#/login) 图片上传接口获取（需先完成 OAuth 授权流程获取 `Access-Token`），示例命令：
  ```bash
  curl --location --request POST 'https://docs.qq.com/openapi/resources/v2/images' \
    --header 'Access-Token: ACCESS_TOKEN' \
    --header 'Client-Id: CLIENT_ID' \
    --header 'Open-Id: OPEN_ID' \
    --form 'image=@"/path/to/your/image.png"'
  ```
  上传成功后，取返回结果中的 `imageID` 字段值传入此参数
- `index` (integer, 必填): 插入位置的索引，从 0 开始
- `width` (integer, 可选): 图片宽度，单位为像素（px），例如 400 表示 400px；不传时使用图床上传返回的宽度
- `height` (integer, 可选): 图片高度，单位为像素（px），例如 300 表示 300px；不传时使用图床上传返回的高度

#### 返回值说明
```json
{
  "base_version": 1,
  "new_version": 2,
  "trace_id": "",
  "err_msg": ""
}
```

---

## 9. insert_page_break

### 功能说明
在 Word 文档的指定位置插入分页符。

### 调用示例
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "index": 10
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `index` (integer, 必填): 插入位置的索引，从 0 开始

### 返回值说明
```json
{
  "base_version": 1,
  "new_version": 2,
  "trace_id": "trace_1234567890",
  "err_msg": ""
}
```

---

## 10. insert_table

### 功能说明
在 Word 文档的指定位置插入表格。

### 调用示例
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "index": 0,
  "rows": 3,
  "cols": 4
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `index` (integer, 必填): 插入位置的索引，从 0 开始
- `rows` (integer, 必填): 表格行数
- `cols` (integer, 必填): 表格列数

### 返回值说明
```json
{
  "base_version": 1,
  "new_version": 2,
  "trace_id": "trace_1234567890",
  "err_msg": ""
}
```

---

## 11. insert_comment

### 功能说明
在 Word 文档的指定范围内插入批注（评论）。

### 调用示例
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "text": "这里需要修改措辞",
  "range": {"begin": 5, "end": 15}
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `text` (string, 必填): 批注内容
- `range` (object, 必填): 批注关联的文本范围，包含 `begin` 和 `end`
- `ref_id` (string, 可选): 评论ID，用于回复已有批注

### 返回值说明
```json
{
  "base_version": 1,
  "new_version": 2,
  "trace_id": "trace_1234567890",
  "err_msg": ""
}
```

---

## 12. get_images

#### 功能说明
获取 Word 文档中所有图片的信息，包括每张图片的位置索引（`pos`）、来源类型（URL 图片或附件图片）以及对应的 URL 或附件 ID。通常在调用 `replace_image` 前先调用此接口，获取目标图片的 `pos`（即 `idx`）和 `image_url`/`attachment_id`（即 `old_image_url`/`old_attachment_id`）。

### 调用示例
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx"
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一

### 返回值说明
```json
{
  "images": [
    {
      "source": 1,
      "pos": 42,
      "image_url": "https://docimg8.docs.qq.com/image/AgAABsUhABzwC7ScF1dHP4mZWR9jTQ5i.jpeg"
    },
    {
      "source": 2,
      "pos": 88,
      "attachment_id": "AgAABsUhABzwC7ScF1dHP4mZWR9jTQ5i"
    }
  ],
  "version": 1024
}
```
- `images` (array): 文档中所有图片列表，按位置（`pos`）升序排列
  - `source` (int): 图片来源类型，`1` = URL 图片（`FromLink`），`2` = 附件图片（`FromAttachment`）
  - `pos` (int64): 图片在文档中的位置索引，即 `replace_image` 接口的 `idx` 参数
  - `image_url` (string): 当 `source=1` 时有值，图片的内嵌 URL，即 `replace_image` 接口的 `old_image_url` 参数
  - `attachment_id` (string): 当 `source=2` 时有值，附件图片的 object_key，即 `replace_image` 接口的 `old_attachment_id` 参数
- `version` (int64): 当前文档版本号

### 推荐使用流程
1. 调用 `get_images` 获取文档中所有图片信息
2. 根据返回的 `pos`（作为 `idx`）和 `image_url`/`attachment_id`（作为 `old_image_url`/`old_attachment_id`）定位目标图片
3. 调用 `replace_image` 传入对应参数完成图片替换

---

## 12. replace_image

### 功能说明
替换 Word 文档中的图片。可以通过旧图片的 URL 或 ID 定位要替换的图片，并指定新图片。

### 调用示例
```json
{
  "file_id": "doc_1234567890",
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "idx": 0,
  "old_image_url": "https://example.com/old_image.png",
  "image_id": "eyJVUkwiOiJodHRwczovL2V4YW1wbGUuY29tL25ld19pbWFnZS5wbmcifQ=="
}
```

#### 参数说明
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `file_url` (string, 可选): 腾讯文档的文档链接，与 `file_id` 二选一
- `idx` (integer, 必填): 图片位置索引
- `old_image_url` (string, 可选): 旧图片的 URL，与 `old_attachment_id` 二选一，需搭配 `idx` 一起使用
- `old_attachment_id` (string, 可选): 旧图片的附件 ID，与 `old_image_url` 二选一，需搭配 `idx` 一起使用
- `image_id` (string, 可选): 新图片的 image_id，本质是对图片信息加密后的字符串，与 `content` 二选一。获取方式：
  - 通过 `upload_image` MCP 接口上传图片后获取
  - 通过[腾讯文档开放平台 OpenAPI](https://docs.qq.com/open/developers/?nlc=1#/login) 图片上传接口获取。**注意：调用开放平台接口前，需先完成 OAuth 授权流程获取 `Access-Token`（参考[开放平台登录授权文档](https://docs.qq.com/open/developers/?nlc=1#/login)）**，示例命令：
  ```bash
  curl --location --request POST 'https://docs.qq.com/openapi/resources/v2/images' \
    --header 'Access-Token: ACCESS_TOKEN' \
    --header 'Client-Id: CLIENT_ID' \
    --header 'Open-Id: OPEN_ID' \
    --form 'image=@"/path/to/your/image.png"'
  ```
  上传成功后，取返回结果中的 `imageID` 字段值传入此参数。**注意：调用开放平台接口前，需先完成 OAuth 授权流程获取 `Access-Token`；此方式适合图片体积较大、base64 内容超出传输限制的场景**
- `content` (string, 可选): 新图片的 base64 内容，与 `image_id` 二选一。**适合图片体积较小的场景；若图片过大导致 base64 内容超出限制，请改用 `image_id` 方式**

### 返回值说明
```json
{
  "base_version": 1,
  "new_version": 2,
  "trace_id": "trace_1234567890",
  "err_msg": ""
}
```

---

## 13. insert_markdown

### 功能说明
在 Word 文档的指定位置插入 Markdown 格式内容。引擎会自动将 Markdown 转换为文档富文本格式，支持标题、列表、表格、链接、加粗/斜体等常见 Markdown 语法。适合需要批量插入富文本内容的场景，比直接调用多个 `insert_text`/`insert_paragraph` 更高效。

> ⚠️ **推荐使用 `base64_markdown` 参数**：由于 Markdown 内容中可能包含特殊字符（如换行符、引号等），直接传递 `markdown` 参数容易导致 JSON 解析问题。**建议 agent 先将 Markdown 内容进行 base64 编码后，通过 `base64_markdown` 参数传递**。如果填写了 `base64_markdown`，则无需再填写 `markdown`。

### 调用示例

**使用 base64_markdown（推荐）：**
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "index": 0,
  "base64_markdown": "IyDmoIfpopgKCui/meaYr+S4gOautSoq5Yqg57KXKirmlofmnKzjgIIKCi0g5YiX6KGo6aG5MQotIOWIl+ihqOmhuTIKCnwg5aeT5ZCNIHwg5bm06b6EIHwKfC0tLS0tLXwtLS0tLS18Cnwg5byg5LiJIHwgMjUgfA==",
  "version_info": {
    "base_version": 5,
    "is_latest": false
  }
}
```

**使用 markdown（备选）：**
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx",
  "index": 0,
  "markdown": "# 标题\n\n这是一段**加粗**文本。\n\n- 列表项1\n- 列表项2\n\n| 姓名 | 年龄 |\n|------|------|\n| 张三 | 25 |"
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `index` (integer, 必填): 插入位置的索引，从 0 开始
- `base64_markdown` (string, ⭐ 首选): Markdown 内容的 base64 编码字符串。**推荐优先使用此参数**，agent 需要先将 Markdown 文本进行标准 base64 编码后传入。与 `markdown` 二选一，如果填写了 `base64_markdown` 则无需再填写 `markdown`
- `markdown` (string, 备选): Markdown 格式的原始文本内容，与 `base64_markdown` 二选一。当未提供 `base64_markdown` 时使用此参数。支持以下语法：
  - 标题：`# H1`、`## H2`、`### H3` 等
  - 加粗/斜体：`**加粗**`、`*斜体*`
  - 链接：`[文本](URL)`
  - 无序列表：`- 列表项`
  - 有序列表：`1. 列表项`
  - 表格：使用 `|` 和 `---` 语法
  - 代码块：使用反引号包裹
- `version_info` (object, 可选): 版本控制参数，用于指定基于哪个版本进行编辑。不传时默认基于最新版本操作。包含以下字段：
  - `base_version` (int64, 可选): 基准版本号，通常使用 `get_last_operable_pos`、`get_outline` 或 `resolve_document_structure` 返回的 `version` 值，基于该版本继续编辑，确保编辑操作的连续性。值为 0 表示不指定
  - `is_latest` (bool, 可选): 是否基于最新版本操作。设为 `true` 时忽略 `base_version`，直接在文档最新版本上编辑

> 💡 **version_info 使用场景**：当需要连续执行多步编辑操作时（如先 `get_outline` 获取大纲，再 `insert_markdown` 插入内容），建议将前一步返回的 `version` 传入 `version_info.base_version`，以确保编辑基于同一版本，避免并发冲突。

### 返回值说明
```json
{
  "base_version": 1,
  "new_version": 2,
  "trace_id": "trace_1234567890",
  "err_msg": ""
}
```
- `base_version` (int64): 文档的基准版本号
- `new_version` (int64): 命令执行之后的文档版本
- `trace_id` (string): 本次调用的链路追踪 ID
- `err_msg` (string): 失败信息

---

## 14. get_last_operable_pos

### 功能说明
获取 Word 文档正文（main story）最后一个可操作位置的索引，以及该位置前面最多 10 个字符的内容。在需要向文档末尾追加内容时，可先调用此接口获取末尾可操作位置，再使用 `insert_text`/`insert_image` 等接口在该位置插入内容。

### 调用示例
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx"
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一

### 返回值说明
```json
{
  "position": 100,
  "preceding_text": "...前面内容...",
  "version": 1
}
```
- `position` (int64): 最后一个可操作位置的索引
- `preceding_text` (string): 该位置前面最多 10 个字符的内容
- `version` (int64): 当前文档版本号

---

## 15. get_outline

### 功能说明
获取 Word 文档的完整大纲结构（树形），返回文档标题、各级标题及其下正文的可操作位置范围。可用于：
- 了解文档整体结构和层级关系
- 获取指定标题或正文区域的精确位置（`title_start`/`title_end`、`content_start`/`content_end`），以便在对应位置插入或替换内容
- 在操作前先掌握文档大纲，避免盲目使用 `find` 查找

> ⚠️ **关于「在文档开头插入」的位置说明**：文档大纲的根节点通常是 `HEADING_LEVEL_TITLE`（文档标题），其 `title_start` 表示文档标题之前的位置，`content_start` 表示标题之后、正文开头的位置。当用户要求"在文档开头插入内容"时，需要向用户确认具体含义：
> - **在文档标题之前插入**：使用 `HEADING_LEVEL_TITLE` 节点的 `title_start`
> - **在正文开头插入（标题之后）**：使用 `HEADING_LEVEL_TITLE` 节点的 `content_start`
> 
> 如果用户未明确说明，应主动询问确认。

### 调用示例
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx"
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一

### 返回值说明
```json
{
  "outlines": [
    {
      "title": "文档标题",
      "level": "HEADING_LEVEL_TITLE",
      "title_start": 0,
      "title_end": 5,
      "content_start": 6,
      "content_end": 100,
      "children": [
        {
          "title": "第一章 概述",
          "level": "HEADING_LEVEL_1",
          "title_start": 6,
          "title_end": 12,
          "content_start": 13,
          "content_end": 50,
          "children": [
            {
              "title": "1.1 背景",
              "level": "HEADING_LEVEL_2",
              "title_start": 13,
              "title_end": 18,
              "content_start": 19,
              "content_end": 50,
              "children": []
            }
          ]
        }
      ]
    }
  ],
  "version": 1
}
```

- `outlines` (array): 大纲根节点列表（树形结构），每个节点包含：
  - `title` (string): 标题文本内容
  - `level` (string): 标题级别，取值说明：
    - `HEADING_LEVEL_TITLE` (11): 文档标题
    - `HEADING_LEVEL_1` ~ `HEADING_LEVEL_9` (1~9): 一级标题 ~ 九级标题
    - `HEADING_LEVEL_BODY` (10): 正文（无标题）
  - `title_start` (int64): 标题可操作的起始位置（可在此位置前插入内容）
  - `title_end` (int64): 标题可操作的结束位置
  - `content_start` (int64): 该标题下正文可操作的起始位置（在标题下方插入内容时使用）
  - `content_end` (int64): 该标题下正文可操作的结束位置（在正文末尾追加内容时使用）
  - `children` (array): 子目录项列表（递归结构，构成树形大纲）
- `version` (int64): 当前文档版本号

---

## 16. resolve_document_structure

### 功能说明
获取 Word 文档的完整结构树（DOC），返回 main story 下所有块级元素的层级结构和位置信息。与 `get_outline` 只返回标题层级不同，此接口返回**所有**块级元素，包括：
- **Paragraph**：普通文本段落
- **Heading**：标题段落（含级别）
- **Table**：表格（含每行每列的起止位置）
- **TextBox**：文本框（含内部段落的起止位置）
- **CodeBlock**：代码块（含内部段落的起止位置）

适用场景：
- 需要在**表格指定行列**插入或修改文本（通过 `table_rows[row].cells[col].end_index` 定位单元格末尾）
- 需要在**文本框内部**插入内容（通过 `children` 中的段落位置定位）
- 需要了解文档完整布局后再决定操作位置
- 需要精确获取某个段落、代码块的起止范围

### 调用示例
```json
{
  "file_url": "https://docs.qq.com/doc/xxxxxxxx"
}
```

### 参数说明
- `file_url` (string, 推荐): 腾讯文档的文档链接，与 `file_id` 二选一，**推荐优先使用**
- `file_id` (string, 可选): 文档唯一标识符，与 `file_url` 二选一
- `include_heading` (bool, 可选): 是否将标题也作为独立节点列出，默认 false（标题单独归类为 Heading 类型，不计入普通段落序号）

### 返回值说明
```json
{
  "nodes": [
    {
      "type": "Heading",
      "start_index": 0,
      "end_index": 6,
      "text_preview": "文档标题",
      "heading_level": 1,
      "logical_index": 1,
      "table_rows": [],
      "children": []
    },
    {
      "type": "Paragraph",
      "start_index": 7,
      "end_index": 20,
      "text_preview": "这是第一段正文内容",
      "heading_level": 0,
      "logical_index": 2,
      "table_rows": [],
      "children": []
    },
    {
      "type": "Table",
      "start_index": 21,
      "end_index": 60,
      "text_preview": "",
      "heading_level": 0,
      "logical_index": 3,
      "table_rows": [
        {
          "row": 1,
          "cells": [
            { "row": 1, "col": 1, "start_index": 22, "end_index": 30, "text_preview": "单元格内容" },
            { "row": 1, "col": 2, "start_index": 31, "end_index": 38, "text_preview": "" }
          ]
        },
        {
          "row": 2,
          "cells": [
            { "row": 2, "col": 1, "start_index": 40, "end_index": 48, "text_preview": "" },
            { "row": 2, "col": 2, "start_index": 49, "end_index": 57, "text_preview": "" }
          ]
        }
      ],
      "children": []
    },
    {
      "type": "TextBox",
      "start_index": 61,
      "end_index": 80,
      "text_preview": "文本框内容",
      "heading_level": 0,
      "logical_index": 4,
      "table_rows": [],
      "children": [
        {
          "type": "Paragraph",
          "start_index": 62,
          "end_index": 79,
          "text_preview": "文本框内容",
          "heading_level": 0,
          "logical_index": 1,
          "table_rows": [],
          "children": []
        }
      ]
    },
    {
      "type": "CodeBlock",
      "start_index": 81,
      "end_index": 110,
      "text_preview": "console.log('hello')",
      "heading_level": 0,
      "logical_index": 5,
      "table_rows": [],
      "children": [
        {
          "type": "Paragraph",
          "start_index": 82,
          "end_index": 109,
          "text_preview": "console.log('hello')",
          "heading_level": 0,
          "logical_index": 1,
          "table_rows": [],
          "children": []
        }
      ]
    }
  ],
  "version": 5,
  "total_paragraphs": 3,
  "total_headings": 1,
  "total_tables": 1
}
```

- `nodes` (array): 顶层块级节点列表（main story 直接子节点），按文档顺序排列，每个节点包含：
  - `type` (string): 节点类型，取值：`Paragraph`、`Heading`、`Table`、`TextBox`、`CodeBlock`、`HighlightBlock`
  - `start_index` (uint32): 节点起始位置（inclusive）
  - `end_index` (uint32): 节点结束位置（在此处插入可追加到节点末尾）
  - `text_preview` (string): 文本预览，最多 50 字符，仅 Paragraph/Heading 有值。文本中可能包含以下占位符标记，表示段落内嵌入的非文字元素：
    - `[Image]`：嵌入的图片
    - `[Math]`：数学公式
    - `[TextBox]`：嵌入的文本框/代码块/高亮块锚点（对应的 TextBox/CodeBlock/HighlightBlock 节点会作为独立的顶层节点出现在 `nodes` 中）
    - `[Drawing]`：其他嵌入的图形/形状对象
    - `[Hyperlink]`：超链接（普通链接、文档链接、附件链接等）
    - `[addonHina]`：内嵌插件（流程图、思维导图、白板、内嵌表格等腾讯文档内嵌的第三方插件内容）
  - `heading_level` (int32): 标题级别 1-9，仅 Heading 类型有值，其余为 0
  - `logical_index` (int32): 在同级中的逻辑序号（从 1 开始）
  - `table_rows` (array): 仅 Table 类型有值，包含行列结构：
    - `row` (int32): 行号（从 1 开始）
    - `cells` (array): 该行所有单元格：
      - `row` (int32): 行号（从 1 开始）
      - `col` (int32): 列号（从 1 开始）
      - `start_index` (uint32): 单元格起始位置
      - `end_index` (uint32): 单元格结束位置（在此处插入可追加到单元格末尾）
      - `text_preview` (string): 单元格文本预览，最多 30 字符，可能包含 `[Image]`/`[TextBox]`/`[Drawing]`/`[Hyperlink]`/`[addonHina]` 等占位符标记（含义同上）
  - `children` (array): 子节点列表，TextBox/CodeBlock 内部的段落等
- `version` (int64): 当前文档版本号
- `total_paragraphs` (int32): 正文段落总数（不含标题）
- `total_headings` (int32): 标题总数
- `total_tables` (int32): 表格总数

---

## 典型工作流示例

### 用 Markdown 创建 Word 文档（推荐）

```
1. 准备好 Markdown 格式的文档内容，将其保存为 <workspace>/.tmp/tencent_docs/<标题>.md 文件（<标题> 为文档标题）
2. 使用系统 base64 命令进行编码，并将结果写入工作区目录下的文件（确保 agent 可通过 read_file 访问）：
   mkdir -p <workspace>/.tmp/tencent_docs
   base64 -w 0 <workspace>/.tmp/tencent_docs/<标题>.md > <workspace>/.tmp/tencent_docs/encoded_<标题>.txt
   或：echo -n "Markdown文本" | base64 -w 0 > <workspace>/.tmp/tencent_docs/encoded_<标题>.txt
   （macOS 上无需 -w 0 参数；<workspace> 为当前项目工作区根目录绝对路径）
3. 使用 read_file 工具读取工作区下的输出文件（如 <workspace>/.tmp/tencent_docs/encoded_<标题>.txt），获取 base64 编码后的 Markdown 内容
4. 调用 create_with_markdown 传入 base64_markdown 和可选的 title
5. 从返回值获取 file_url 即可访问文档；如需继续编辑，使用 file_id/file_url 和 last_index 调用其他工具
```

### 编辑已有 Word 文档

```
1. 调用 get_outline 获取文档大纲结构，了解文档的标题层级和各区域的可操作位置
   （如需精确定位表格行列、文本框内部等，改用 resolve_document_structure）
2. 根据大纲定位目标区域，或调用 find 查找具体文本位置
3. 按需调用工具进行编辑：
   - 插入文本：insert_text
   - 插入段落：insert_paragraph
   - 替换文本：replace_text
   - 全文替换：find_and_replace_text
   - 修改文本样式：update_text_property
   - 插入任务：insert_task
   - 插入图片：insert_image
   - 替换图片：replace_image
   - 插入分页符：insert_page_break
   - 插入表格：insert_table
   - 插入批注：insert_comment
   - 获取文档大纲：get_outline
   - 获取完整结构树：resolve_document_structure
```

### 查找并替换文本（精确替换）

```
1. 调用 find 查找目标文本，获取所有匹配位置
2. 将匹配结果展示给用户，让用户选择要替换的位置
3. 调用 replace_text 传入对应的 range 进行精确替换
```

### 查找并替换文本（全部替换）

```
1. 直接调用 find_and_replace_text，一次性替换所有匹配项
```

### 格式化文本

```
1. 调用 find 查找目标文本，获取文本的 range
2. 调用 update_text_property 设置文本属性（加粗、颜色等）
```

### 向文档末尾追加内容

```
1. 调用 get_last_operable_pos 获取文档末尾可操作位置
2. 使用返回的 position 作为 index，调用 insert_text / insert_image / insert_table 等工具追加内容
```

### 在指定标题下插入内容

```
1. 调用 get_outline 获取文档大纲，找到目标标题节点
2. 使用节点的 content_start 作为插入位置（在标题下方开头插入）
   或使用 content_end 作为插入位置（在标题下方正文末尾追加）
3. 调用 insert_text / insert_paragraph / insert_image 等工具在对应位置插入内容
```

### 在文档开头插入内容

```
1. 调用 get_outline 获取文档大纲
2. 明确用户意图——是要在「文档标题前」还是「正文开头」插入：
   - 文档标题前：使用 HEADING_LEVEL_TITLE 节点的 title_start 作为插入位置
   - 正文开头（标题之后）：使用 HEADING_LEVEL_TITLE 节点的 content_start 作为插入位置
3. 如果用户未明确说明，应主动询问用户确认具体插入位置
4. 确认位置后，调用 insert_text / insert_paragraph 等工具在对应位置插入内容
```

### 在表格指定行列插入文本

```
1. 调用 resolve_document_structure 获取文档完整结构树
2. 在返回的 nodes 中找到目标 Table 节点
3. 通过 table_rows[row-1].cells[col-1].end_index 获取目标单元格的末尾位置
4. 调用 insert_text，将 index 设为该 end_index，即可在指定单元格末尾插入文本
```

### 在文本框内部插入内容

```
1. 调用 resolve_document_structure 获取文档完整结构树
2. 在返回的 nodes 中找到目标 TextBox 节点
3. 通过 children 中的段落节点获取内部精确位置
4. 调用 insert_text / insert_paragraph 在对应位置插入内容
```

### 为文本添加批注

```
1. 调用 find 查找目标文本，获取文本的 range（begin/end）
2. 调用 insert_comment 传入 range 和批注内容
```

### 替换文档中的图片

```
1. 调用 get_images 获取文档中所有图片信息，包括图片位置（pos/idx）和 URL/ID
2. 根据返回的 pos（作为 idx）和 url/id（作为 old_url/old_id）定位目标图片
3. 调用 replace_image 传入对应参数完成图片替换
```

---

## 注意事项

- 仅支持 Word 文档类型（doc_type: word）
- `index` / `idx` 参数表示插入位置，从 0 开始计数
- 操作前需确保拥有文档的写入权限
- `replace_text` 的 `ranges` 参数中 `start_index` 和 `end_index` 必须在文档有效范围内
- 替换文本的推荐流程：先调用 `find` 查找定位，让用户确认后再用 `replace_text` 精确替换；如果需要全部替换可直接使用 `find_and_replace_text`
- `file_id` 和 `file_url` 二选一，**推荐优先使用 `file_url`**（直接传入文档链接更便捷），两者都传时优先使用 `file_id`
- `get_last_operable_pos` 返回的 `position` 即为文档末尾可安全插入内容的位置
- `get_outline` 返回树形大纲结构，每个节点的 `content_start`/`content_end` 表示该标题下正文区域的可操作范围，可直接用作 `insert_text` 等工具的 `index` 参数
- **「在文档开头插入」需明确位置**：用户要求在文档开头插入内容时，应先通过 `get_outline` 获取大纲，区分「文档标题前」（`HEADING_LEVEL_TITLE` 的 `title_start`）和「正文开头」（`HEADING_LEVEL_TITLE` 的 `content_start`），并向用户确认具体插入位置
- `resolve_document_structure` 返回所有块级元素的完整结构树，`table_rows[row].cells[col].end_index` 即为对应单元格末尾可插入位置；TextBox/CodeBlock 的内部段落通过 `children` 字段获取；`logical_index` 表示节点在同级中的顺序（从 1 开始）
- `create_with_markdown` 可一步完成 Word 文档的创建和内容写入，无需先 `manage.create_file` 再 `insert_markdown`，适合快速生成 Word 文档的场景
- `insert_comment` 的 `range` 必须在文档有效范围内，建议先用 `find` 获取精确范围
- `replace_image` 需要通过 `old_image_url` 或 `old_attachment_id` 定位旧图片，新图片通过 `image_id` 或 `content`（base64）指定
