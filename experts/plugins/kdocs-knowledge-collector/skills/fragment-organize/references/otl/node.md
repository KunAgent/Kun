# 智能文档节点层级结构、类型、属性参考

## 类型速查

**IInline**（行内节点）：`text`、`emoji`、`br`、`latex`、`linkView`、`schedule`、`staticTime`、`WPSUser`、`WPSDocument`

**IBlock**（块级节点）：`title`、`codeBlock`、`paragraph`、`heading`、`blockQuote`、`highLightBlock`、`lockBlock`、`table`、`column`、`pictureColumn`、`picture`、`blockAnchor`、`hr`、`countdown`、`dbsheet`、`spreadsheet`、`groupCard`、`appComponent`、`processon`

**doc**（文档块）： 全局唯一

**rangeMark**(区间标记)： `rangeMarkBegin`, `rangeMarkEnd` 仅作为区间的起始结束位置标记，不是真实的节点，index计算时需要忽略

## 每个节点可容纳的子节点

| 节点 | 子节点 | 备注 |
|------|--------|------|
| `doc` | IBlock， 排除 `tableRow`、`tableCell`、`columnItem` | 首个子节点必须是 `title`，且唯一 |
| `title` | text | — |
| `codeBlock` | IInline | 仅代码块中的text节点内容可包含换行符 |
| `paragraph` | IInline，排除 `br` | — |
| `heading` | IInline，排除 `br` | — |
| `blockQuote` | IInline | — |
| `highLightBlock` | IBlock，排除 `title` `table` `column` `highLightBlock` `lockBlock` | 递归容器 |
| `lockBlock` | IBlock，排除 `title` `lockBlock` | 递归容器 |
| `table` | `tableRow` | — |
| `tableRow` | `tableCell` | 仅作为table的子节点 |
| `tableCell` | IBlock，排除 `title` `lockBlock` `table` `column` | 仅作为tableRow的子节点 |
| `column` | `columnItem` | 1–10 个 |
| `columnItem` | IBlock，排除 `title` `lockBlock` `table` `column` | 仅作为column的子节点 |
| `pictureColumn` | `picture` | 2–5 个 |
| 其余 IBlock | 无 | 叶子节点 |
| 全部 IInline | 无 | 叶子节点 |

## 共用属性定义

**listAttrs** (object)：列表属性，用于 `paragraph` 和 `heading`

| 属性 | 类型 | 说明 |
|------|------|------|
| `listAttrs.id` | string | 编号树 id |
| `listAttrs.type` | integer | `1`=无序列表, `2`=有序列表, `3`=任务列表 |
| `listAttrs.level` | integer ≥0 | 列表级别 |
| `listAttrs.styleType` | integer | type=1 时：`1`=实心点, `2`=空心点, `3`=方块；type=2 时：`4`=阿拉伯数字, `5`=字母, `6`=罗马数字, `9`=大写字母, `10`=大写罗马, `11`=圆圈数字, `12`=中文数字, `13`=大写中文数字；type=3 时：`7`=未勾选, `8`=勾选 |
| `listAttrs.styleFormat` | integer | 分隔符：`1`={0}. `2`={0}、 `3`={0}] `4`={0}】 `5`={0}) `6`=({0}) `7`=【{0}】 `8`=[{0}] `9`={0} |

---

## Block 节点属性

### doc — 文档块

全局唯一根节点。查询时通过 `otl.block_query`（`params: { blockIds: ["doc"] }`）获取。

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cover` | object | 否 | 文档封面图，无封面时为 `{}`。子字段见下方 |
| ↳ `sourceKey` | string | **是** | 图片资源 id（为空字符串表示无封面图）；可通过 `upload_attachment` 上传图片获得（返回值 `object_id`）；可通过 `download_attachment` 下载对应资源 |
| ↳ `offsetX` | integer | 否 | 封面图 X 轴偏移，范围 `-5000`–`5000`，默认 `0` |
| ↳ `offsetY` | integer | 否 | 封面图 Y 轴偏移，范围 `-5000`–`5000`，默认 `0` |

设置/清除封面图：通过 `otl.block_update`（`update_attrs`，`blockId` 设为 `"doc"`）。传入 `cover: {}` 清除封面图。

### title — 文档标题

全文档唯一，必须为 doc 的第一个子块。title中的 text 节点不支持 Inline 通用属性, 不可包含换行符。

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `align` | integer | 否 | 水平对齐 — `1`=左对齐, `2`=居中, `3`=右对齐，默认 `1` |

### paragraph — 段落

包含普通段落、有序列表、无序列表和任务列表。

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `indent` | integer | 否 | 首行缩进：`0`=无, `1`=缩进，默认 `0` |
| `contentIndent` | integer ≥0 | 否 | 内容缩进，默认 `0` |
| `align` | integer | 否 | 水平对齐 — `1`=左对齐, `2`=居中, `3`=右对齐，默认 `1` |
| `listAttrs` | object | 否 | 列表属性（见共用定义） |

另外可在段落上设置通用属性，通用属性会传递给段落的子节点。

### heading — 标题（1–6 级）

非文档标题，属性与 paragraph 相同，增加 level。

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `level` | integer | 否 | 标题级别：`1`–`6`，默认 `1` |
| `indent` | integer | 否 | 首行缩进：`0`/`1`，默认 `0` |
| `contentIndent` | integer ≥0 | 否 | 内容缩进，默认 `0` |
| `align` | integer | 否 | 水平对齐 — `1`=左对齐, `2`=居中, `3`=右对齐，默认 `1` |
| `listAttrs` | object | 否 | 列表属性（同 paragraph） |

另外可在标题上设置通用属性，通用属性会传递给标题的子节点。

### blockQuote — 引用

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `indent` | integer | 否 | 首行缩进：`0`/`1`，默认 `0` |
| `contentIndent` | integer ≥0 | 否 | 内容缩进，默认 `0` |
| `align` | integer | 否 | 水平对齐 — `1`=左对齐, `2`=居中, `3`=右对齐，默认 `1` |

另外可在引用上设置通用属性，通用属性会传递给引用的子节点。

### codeBlock — 代码块

codeBlock 中的 text 节点不支持 Inline 通用属性， 可包含换行符。

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `lang` | integer | 否 | 语言类型，默认 `1`。`1`=plaintext, `2`=css, `3`=go, `4`=python, `5`=shell, `6`=objectivec, `7`=markdown, `8`=lua, `9`=scss, `10`=less, `11`=swift, `12`=typescript, `13`=sql, `14`=ruby, `15`=http, `16`=java, `17`=json, `18`=php, `19`=javascript, `20`=c-like, `21`=xml, `22`=fortran, `23`=r, `24`=cmake, `25`=bash, `26`=csharp, `27`=dockerfile, `28`=julia, `29`=latex, `30`=makefile, `31`=matlab, `32`=rust, `33`=nginx, `34`=dart, `35`=erlang, `36`=groovy, `37`=haskell, `38`=kotlin, `39`=lisp, `40`=perl, `41`=scala, `42`=scheme, `43`=yaml, `44`=mermaid |
| `autoWrap` | boolean | 否 | 自动换行，默认 `true` |
| `theme` | integer | 否 | 主题：`1`=亮色, `2`=暗色，默认 `1` |

### highLightBlock — 高亮块

用于美化文档结构或突出重要内容。

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `emoji` | string，单个emoji表情 | **是** | 表情 |
| `style` | object | 否 | 高亮块样式，包含以下子字段 |
| ↳ `fontColor` | integer | 否 | 字体颜色：`1`=黑, `2`=灰, `3`=红, `4`=粉, `5`=橙, `6`=黄, `7`=绿1, `8`=绿2, `9`=绿3, `10`=蓝1, `11`=蓝2, `12`=紫 |
| ↳ `backgroundColor` | integer | 否 | 背景颜色：`1`=灰, `2`=粉, `3`=橙, `4`=绿, `5`=蓝, `6`=紫 |
| ↳ `borderColor` | string | 否 | 边框颜色，rgba 十六进制，如 `"#112233"` |

### lockBlock — 内容保护区

区域中的内容仅文件创建者可编辑。**无属性。**

### table — 表格

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `borderStyle` | integer | 否 | 边框样式：`1`=无边框, `2`=实线 |

### tableRow — 表格行

**无属性。**

### tableCell — 单元格

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `width` | number | 否 | 宽度（同列需一致） |
| `height` | number | 否 | 高度（同行需一致） |
| `colspan` | integer ≥1 | 否 | 合并列数，默认 `1` |
| `rowspan` | integer ≥1 | 否 | 合并行数，默认 `1` |
| `verticalAlign` | integer | 否 | 垂直对齐：`1`=顶端, `2`=居中, `3`=底端，默认 `1` |

### column — 分栏

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `backgroundColor` | integer | 否 | 背景颜色 `1`–`12`（作为未设置背景的分栏列默认色；1–6 单色，7–12 多色） |

### columnItem — 分栏列

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `width` | string | 是 | 宽度（百分比字符串，至多两位小数，如 `"33.33%"`) |
| `backgroundColor` | integer | 否 | 背景颜色 `1`–`42`（1–6 单色，7–42 为 6 组多色，每组 6 种） |

### pictureColumn — 并排图

支持 2–5 张图片并排展示。

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `width` | number | 否 | 宽度（百分比，0–100） |
| `align` | integer | 否 | 水平对齐，默认 `1` |

### picture — 图片

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sourceKey` | string | **是** | 图片资源 id；可通过 `upload_attachment` 上传图片获得（返回值 `object_id`，宽高取 `extra_info.width`、`extra_info.height`）；可通过 `download_attachment` 下载对应资源 |
| `width` | number | **是** | 图片原始宽度 |
| `height` | number | **是** | 图片原始高度 |
| `renderWidth` | number | 否 | 图片渲染宽度 |
| `caption` | string | 否 | 图片描述 |
| `rotate` | integer | 否 | 旋转角度：`0`, `-90`, `-180`, `-270` |
| `borderType` | integer | 否 | 边框：`0`=无, `1`=灰色 1px，默认 `0` |
| `align` | integer | 否 | 水平对齐，默认 `1` |

### blockAnchor — 占位节点

前端显示为 loading 样式，调用 ReplaceAnchor 替换为目标节点。可放置的容器取决于 `aimType`。

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | **是** | 占位 id（用于替换的标识） |
| `aimType` | string | **是** | 目标类型：`picture`、`video`、`processon`、`spreadsheet` |
| `width` | number | **是** | 占位宽度 |
| `height` | number | **是** | 占位高度 |

### hr — 分隔线

**无属性。**

### countdown — 倒计时

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | integer | **是** | 模式：`1`=日期, `2`=时间 |
| `duration` | integer | 否 | 时长（毫秒，0–86399999000），默认 `0` |

### dbsheet — 多维表

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sourceId` | string | **是** | 多维表 id，可查询当前文档获取已有id |
| `width` | number | 否 | 宽度 |
| `height` | number | 否 | 高度 |

### spreadsheet — 电子表格

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sourceId` | string | **是** | 电子表格 id，可查询当前文档获取已有id |
| `sheetId` | integer | 否 | 表格索引 id，默认 `0` |

### groupCard — 群名片

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | **是** | 群名片 id |
| `name` | string | **是** | 群名 |
| `masterName` | string | **是** | 群主名 |

### appComponent — 应用组件

只读块，当前无法通过接口新建

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | integer | 否 | 插件类型：`1`=投票, `2`=视频号, `3`=关注文档更新, `4`=内部特定插件, `5`=数据联动, `6`=金山待办, `7`=文档数据看板, `8`=画板，默认 `1` |

### processon — 流程图/思维导图

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | integer | **是** | `1`=流程图, `2`=思维导图 |
| `sourceId` | string | **是** | 元数据 id，可查询当前文档获取已有id |
| `sourceKey` | string | **是** | 预览图 id， 可查询当前文档获取已有id；可通过 `download_attachment` 下载对应资源 |
| `width` | number | **是** | 原始宽度 |
| `height` | number | **是** | 原始高度 |
| `caption` | string | 否 | 描述 |
| `rotate` | integer | 否 | 旋转角度：`0`, `-90`, `-180`, `-270`，默认 `0` |
| `renderWidth` | number | 否 | 渲染宽度 |
| `borderType` | integer | 否 | 边框：`0`=无, `1`=灰色，默认 `0` |
| `align` | integer | 否 | 水平对齐，默认 `1` |

---

## Inline 节点属性

### text — 文本

`content` 字段为非空字符串。仅 codeBlock 内的 text 可包含 `\n`。title 和 codeBlock 内的 text 不支持通用属性。

无专属属性，仅使用通用属性。

### emoji — 表情符号

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `emoji` | string | **是** | 单个 emoji 表情（不支持的 emoji 回落为 text） |

另外可使用通用属性

### br — 引用换行

仅用于 blockQuote 中的换行。**无属性。**

### latex — 公式

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `width` | number | **是** | 宽度 |
| `height` | number | **是** | 高度 |
| `latexStr` | string | **是** | LaTeX 公式字符串 |

另外可使用除code、link之外的通用属性

### linkView — 超链接视图

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | **是** | 标题 |
| `url` | string | **是** | 超链接（http(s):// 开头） |
| `viewType` | integer | **是** | `1`=标题视图, `2`=卡片视图（父块须为 paragraph 且无兄弟节点） |
| `sourceKey` | string | **是** | 图标 id；可通过 `upload_attachment` 上传获得（返回值 `object_id`）；可通过 `download_attachment` 下载对应资源 |
| `description` | string | **是** | 超链接描述 |

### schedule — 日程

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | **是** | 日程组合 id（taskId\|sid\|teamId） |
| `name` | string | **是** | 日程名字 |
| `startTime` | number | **是** | 开始时间（unix 毫秒时间戳） |
| `endTime` | number | **是** | 结束时间（unix 毫秒时间戳） |
| `actionType` | integer | 否 | `1`=非全天, `2`=全天，默认 `1` |

另外可使用除code、link之外的通用属性

### staticTime — 日期

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `time` | number | **是** | 时间（unix 毫秒时间戳） |
| `timeType` | integer | 否 | `1`=日期, `2`=日期时间，默认 `1` |

另外可使用除code、link之外的通用属性

### WPSUser — @人

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | string | **是** | 用户 id |
| `name` | string | **是** | 用户名 |
| `avatar` | string | 否 | 头像地址 |

另外可使用除code、link之外的通用属性

### WPSDocument — 云文档/本地文件

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `wpsDocumentId` | string | **是** | 文档/文件 id；当 `viewType=4`（附件视图）时，可通过 `upload_attachment` 上传获得（返回值 `object_id`），可通过 `download_attachment` 下载对应附件 |
| `wpsDocumentName` | string | **是** | 文档/文件名 |
| `wpsDocumentType` | string | **是** | 文档/文件类型 |
| `wpsDocumentLink` | string | 云文档必填 | 云文档链接（http(s):// 开头，本地文件无此属性） |
| `viewType` | integer | 否 | `1`=标题视图, `2`=预览视图, `3`=卡片视图, `4`=附件视图（本地文件用 4）；viewType=2/3/4 时父块须为 paragraph 且无兄弟节点，默认 `1` |
| `size` | integer >0 | 本地文件必填 | 文件大小（Byte，云文档无此属性） |
| `width` | number | 否 | 预览视图窗口宽度（推荐 400–800） |
| `height` | number | 否 | 预览视图窗口高度（推荐 400–800） |
| `align` | integer | 否 | 预览视图水平对齐 — `1`=左对齐, `2`=居中, `3`=右对齐，默认 `1` |

另外可使用除code、link之外的通用属性

---

## Inline 通用属性

适用于大部分 Inline 节点，具体见Inline节点各自说明。**title 和 codeBlock 中的 text 节点不支持通用属性。** 在内联容器上设置通用属性等价于为其中每个 Inline 节点设置。

| 属性 | 类型 | 说明 |
|------|------|------|
| `bold` | boolean | 加粗，默认 `false` |
| `italic` | boolean | 斜体，默认 `false` |
| `underline` | boolean | 下划线，默认 `false` |
| `strike` | boolean | 删除线，默认 `false` |
| `sup` | boolean | 上标，默认 `false` |
| `sub` | boolean | 下标，默认 `false` |
| `fontSize` | object | 字号对象，包含以下子字段 |
| ↳ `fontSize` | number | 字号（pt）：`9`, `11`, `13`, `15`, `16`, `19`, `22`，默认 `11` |
| `color` | object | 颜色对象，包含以下子字段 |
| ↳ `fontColor` | string | 字体颜色：`#080F17`, `#C21C13`, `#DB7800`, `#078654`, `#0E52D4`, `#0080A0`, `#757575`, `#DA326B`, `#D1A300`, `#58A401`, `#116AF0`, `#A639D7` |
| ↳ `backgroundColor` | string | 背景颜色：`#FBF5B3`, `#F8D7B7`, `#F7C7D3`, `#DFF0C4`, `#C6EADD`, `#D9EEFB`, `#D5DCF7`, `#E6D6F0`, `#E6E6E6` |
| ↳ `fontGradientColor` | integer | 渐变色：`1`=殷红琥珀, `2`=浅烙翡翠, `3`=海涛魏紫, `4`=金盏糖蓝, `5`=蔚蓝桃红, `6`=梦幻极光 |

> `fontColor`、`backgroundColor` 请勿使用取值范围外的值，否则可能不生效。

---

## 区间标记（虚拟节点）

不是真实节点，调用 API 若涉及 index 需忽略虚拟节点。以 `id` 配对使用。

### rangeMarkBegin

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | **是** | 配对标识 |
| `data` | array | **是** | 区间数据，每项含 `type`（如 `"comment"`）和 `ids`（对应评论 id 数组） |

### rangeMarkEnd

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | **是** | 配对标识（与 rangeMarkBegin 匹配） |
