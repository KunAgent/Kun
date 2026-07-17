# HTML 报告渲染规范（html-report-spec）

`generate-verification-html.mjs` 把任务级虚拟记忆库的全部产物，渲染进单文件模板 `templates/verification-report.html`，输出到 `manifest.outputHtml` 指定的路径（默认 `output/<标题>.html`）。该文件**完全离线、零依赖、双击即可打开**，**就是承载核验的那份最终报告**——正文是定稿意见，核验是其上可一键关闭的内嵌高亮层。

> **核验内嵌在这份报告里，不另起独立文件。** 它的使命是**帮用户溯源、不替用户判对错**：把 AI 回答里关联的法律依据原文一键定位给用户看，由用户自己核验。报告标题取自 `manifest.reportTitle`（通过 `--title` 按场景命名，如《合规分析报告》）；未指定时退化为通用的「法律依据溯源辅助报告」。核验**不另出第二份"溯源辅助报告"**——但这不意味着整个任务只能交一份文件，任务整体的产物数量由场景/系统/用户需求决定。

## 设计原则

1. **单文件、可离线**：所有数据、样式、脚本都内联在一个 `.html` 里，不引用任何外部 CSS/JS/字体/图片，断网也能用。**Markdown 渲染、导出 Word/Excel/PDF 全部用零依赖的内置实现**，不引入 marked.js、docx 等任何外部库。
2. **数据与渲染分离**：动态数据以 JSON 形式嵌入 `<script type="application/json" id="verification-data">`，页面加载后由客户端脚本读取并构建 DOM。模板里只有占位符，不在服务端拼接 HTML 片段。
3. **正文即原始意见，核验是叠加层**：`answerText` 是专家成稿的 Markdown，客户端**先完整渲染成 HTML**（标题/列表/表格/加粗/引用/代码等），**再在渲染结果上叠加核验高亮**——核验不改变正文的内容与格式。提供"关闭高亮"按钮，一键还原成无核验的纯净阅读态。
4. **两栏各自独立滚动**：左栏（回答）与右栏（核验侧边栏）是两个独立的 `overflow:auto` 滚动容器，**滚动条互不影响**；拖动左栏看下文时，右栏核验内容始终留在视野内。点击核验点后右栏自动回到顶部，确保新卡片可见。
5. **来源原文只读展示**：来源段落原文照搬展示，不做模型再加工。
6. **客观呈现、不下结论**：页面用「已关联/弱关联/待核验」三个客观标签，不出现"已验证/正确/无误"等价值判断词。
7. **注入安全**：嵌入 JSON 时 `<`/`>`/`U+2028`/`U+2029` 全部转义（`safeJsonForScript`），客户端渲染任何文本前一律 `esc()`；Markdown 渲染器对所有文本节点先转义再处理标记，URL 仅放行 `http(s)/mailto/file/#//`，杜绝 `javascript:` 注入。

## 模板占位符

`generate-verification-html.mjs` 用字符串替换填充以下 4 个占位符：

| 占位符 | 含义 | 填充方式 |
|---|---|---|
| `__TITLE__` | 报告标题，取自 `manifest.reportTitle`（如《合规分析报告》，未指定时为「法律依据溯源辅助报告」；出现 2 次：`<title>` 与 `<h1>`） | `replaceAll`，属性转义 |
| `__SUBTITLE__` | 副标题：生成时间 · 问题前 60 字（不含任务号） | `replace`，属性转义 |
| `__FOOTER__` | 底部声明（一句话：不构成正式法律意见、重大决策咨询执业律师；标签含义指向顶部说明，不再重复展开） | `replace`，属性转义 |
| `__DATA__` | 整个数据负载 JSON | `safeJsonForScript` 序列化 |

> `__TITLE__` 必须用 `replaceAll`（出现两次），其余三个用 `replace`（各一次）。新增占位符时务必同步本表。

## 嵌入数据契约（`payload`）

```jsonc
{
  "taskId": "20260620-121431-0c8cac",
  "query": "用户的原始问题",
  "generatedAt": "2026-06-20T12:14:31.000Z",
  "answerText": "专家最终回答的完整 Markdown 文本",
  "points":  [ /* verification_points.json 的 points 数组，含 declared 字段 */ ],
  "matches": [ /* evidence_matches.json 的 matches 数组，含 label/candidates */ ],
  "sources": [
    {
      "sourceId": "ab12cd34ef56",
      "title": "《个人信息保护法》",
      "sourceType": "law",
      "status": "现行有效",
      "url": "https://...",
      "paragraphs": [ { "paragraphIndex": 0, "text": "..." }, ... ]
    }
  ],
  "stats": { "points": 112, "associated": 55, "weak": 51, "unverified": 6, "statuteHits": 60, "caseHits": 0 }
}
```

- `points` / `matches` 直接取自 `verification/` 下的两个 JSON，字段定义见 `@references/verification-point-spec.md` 与 `@references/evidence-matching-spec.md`。`matches[].label` 取 `associated|weak|unverified`，`matches[].candidates` 是相似度推荐段落。
- `sources[].paragraphs` 只保留 `paragraphIndex` 与 `text` 两个字段（从 `sources/{id}.json` 精简而来），用于右栏来源库渲染与跳转高亮。
- `stats` 缺字段时由脚本回退计算（如 `points` 回退为 `points.length`，其余回退为 0）。

## 页面结构与交互

- **整页 Flexbox 布局**：`body` 为 `height:100vh` 的纵向 flex；头部/说明/工具栏/统计条/底部为固定高度（`flex:0 0 auto`），中间 `.layout` 占满剩余空间（`flex:1 1 auto;min-height:0`）。
- **顶部说明横幅（`.notice`）**：用简洁、对用户友好的一段话告知——核验标签用于把报告内容与检索到的法律依据原文建立关联、便于用户核验，但不代表 AI 输出与核验结果 100% 准确；随后说明三个标签含义（已关联/弱关联/待核验）与用法（点击正文高亮处查看关联依据原文）。说明只在此处出现一次，正文标题、底部声明都不再重复展开。
- **工具栏（`.toolbar`）** 分两组：
  - 高亮筛选：全部 / 仅已关联 / 仅弱关联 / 仅待核验（调 `opacity`，不删节点）+ **关闭/开启高亮**按钮（`#toggle-hl`，一键切换原始纯净阅读态）。
  - 导出：**导出 Word（不含标签）**（`#exp-word`）/ **导出 Excel（依据清单）**（`#exp-excel`）/ **导出 PDF / 打印**（`#exp-pdf`）。工具栏不再额外显示“导出说明”文字，避免占用界面。
- **顶部统计条**：关联语句 / 已关联 / 弱关联 / 待核验 / 法条溯源 / 案例溯源 + 来源资料数。统计口径必须以页面实际渲染出的 `.vp` 高亮为准，而不是后端内部 `verification_points` 原始数量；未成功落到正文的内部点不得进入用户可见统计。
- **左栏（答案，独立滚动）**：不显示“报告正文”小标题，直接展示报告内容。`answerText` 经内置 Markdown 渲染器转为 HTML（见下），再由 `wrapNeedle` 遍历文本节点把核验点片段包成 `<span class="vp {label}" data-point-id>` + `.badge` 角标。同一答案行多个核验点按片段长度降序注入，避免短串先占位。snippet 含 `**`/`*` 等 Markdown 标记时用 `stripMd` 清洗后再匹配渲染后的纯文本。
- **右栏（核验侧边栏，独立滚动，固定宽 420px）**：Tab 一「关联依据」、Tab 二「来源资料库」。侧栏自身不留顶部 padding（`.col.side{padding:0 26px 20px}`），Tab 头 `position:sticky;top:0` 吸顶，并用左右负 margin 抵消侧栏内边距；sticky 条从顶部覆盖后方内容，但按钮在该条高度内垂直居中（如 `min-height:64px;align-items:center`），避免“顶格到顶”也避免透明/镂空露底。点击核验点后侧栏 `scrollTop=0`，保证卡片在视野内。最终用户界面不展示 P1/P2/[P1] 等内部段落号；段落号只作为 DOM id / data-jump 内部跳转依据。证据卡片只展示状态、原句、来源标题、原文内容和操作按钮，不展示 `statute_article`、`回答声明依据`、风险等级、匹配 reason 等内部调试信息。
- **跳转高亮**（移植自 LawBuddy `citation-highlight`）：点击证据卡片标题 / 跳转按钮 / 候选段落 → 切到来源 Tab → `scrollIntoView({block:'center'})` → 加 `.citation-highlight-active`（黄底），3s 后 `.citation-highlight-fading`，5.2s 后清除。
- **窄屏（≤900px）**：两栏改为纵向堆叠，整页恢复单一滚动。

## 内置 Markdown 渲染器（`renderMarkdown` / `inlineMd`）

零依赖、离线安全。块级支持：ATX 标题 `#`~`######`、围栏代码 ```、引用块 `>`（递归渲染）、`---/***/___` 分隔线、**GFM 管道表格**（表头 + `|---|` 分隔行 + 若干数据行）、有序/无序列表（2 空格缩进识别一级嵌套）、段落（连续非空行合并）。行内支持：`` `代码` ``（先抽出保护）、`**粗**`/`__粗__`、`*斜*`/`_斜_`、`~~删除~~`、`[文本](url)`（URL 白名单校验）。所有文本先 `esc()` 再处理标记。

> 渲染产物即"干净正文 HTML"（`cleanAnswerHTML`），既用于左栏展示（之上再叠加高亮），也作为 Word 导出与打印附录的正文来源。

## 导出能力（导出内容不含核验标签，附引用依据清单）

`buildReferences()` 从 `points + matches + sources` 提炼**引用依据清单**：只收法规条文/案例/监管文件类（`statute_article`/`case_ref`/`regulatory_doc`）且有来源名的点，按"名称+条款/案号"去重，字段含 类型 / 名称 / 条款·案号 / 效力状态 / 关联论断 / 来源链接。

| 按钮 | 实现 | 产物 |
|---|---|---|
| 导出 Word（不含标签） | `cleanAnswerHTML` + 引用依据清单表格，包成 Office Word 命名空间 HTML，Blob 下载 | `法律意见 - <query>.doc` |
| 导出 Excel | 仅引用依据清单，包成 Office Excel 命名空间 HTML（带 `<x:Name>` 工作表名），Blob 下载 | `引用依据清单.xls` |
| 导出 PDF | `window.print()`，打印 CSS（`@media print`）隐藏头部/工具栏/侧栏/高亮与角标，仅留干净正文 + `#print-appendix` 清单 | 由用户在打印对话框存为 PDF |

> 三种导出全部为纯前端、离线可用。导出的正文是"无核验标签的原始意见"，核验高亮只存在于屏幕交互态。

## 客户端标签映射

```js
const STATUS_LABEL = { associated: '已关联', weak: '弱关联', unverified: '待核验' };
function labelOf(m) { return m.label || /* 兼容旧 status 字段 */ m.status; }
```

`labelOf` 兼容历史数据里残留的 `status` 字段，但新数据一律用 `label`。

## 颜色语义（务必与匹配标签一致）

| 标签 | 含义 | 主色 | CSS 类 |
|---|---|---|---|
| associated（已关联） | AI 声明依据且来源真实存在，点击查看原文自行核验 | 蓝青 `#2563b0`（`--assoc`） | `.vp.associated` / `.badge.associated` / `.ev-status.associated` |
| weak（弱关联） | 语义相关或条号待核对，请重点核对 | 黄 `#c98a00`（`--warn`） | `.vp.weak` / `.badge.weak` |
| unverified（待核验） | 未提供可溯源依据，请自行查证（≠错） | 灰 `#6b7787`（`--todo`） | `.vp.unverified` / `.badge.unverified` |

> 法律行业为浅色科技风：浅灰底 `#f5f7fa`、深蓝品牌色 `#2b4a6f`。不要使用绿"已验证"或红"未匹配"这类价值判断配色；三个标签全部使用中性/提示色，传达"客观溯源"而非"对错裁决"。注意：本报告配色与股市涨跌红绿无关。

## 修改模板时的注意事项

- 新增占位符 → 同步更新"模板占位符"表与 `generate-verification-html.mjs` 的替换逻辑。
- 改动 `payload` 字段 → 同步本文件"嵌入数据契约"与生成脚本的 `payload` 组装。
- **任何措辞都不得回退到"已验证/正确/无误/未匹配"等价值判断或精确匹配语义**；标签只能是已关联/弱关联/待核验。
- **核验必须是叠加层，不得改变正文内容**：高亮、角标、筛选都只在渲染后的正文之上操作；"关闭高亮"要能还原纯净阅读态；导出/打印的正文必须不含核验标签。
- **两栏独立滚动是硬性要求**：`.col` 必须各自 `overflow-y:auto`，`.layout` 用 flex 且 `min-height:0`；不要回退成整页单滚动（窄屏除外）。
- Markdown 渲染器扩展语法时，务必保持"先 `esc()` 再处理标记"和 URL 白名单，防注入。
- 客户端任何拼接 HTML 处都必须先 `esc()`；新增 DOM 注入点必须同样处理。
- DOM 的 `id` / `data-*` 命名（`source-{sourceId}-P{n}`、`data-paragraph`）是跳转定位约定，改名需同时改 `jumpTo` 与段落渲染两处。
