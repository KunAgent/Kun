# Work 单视图 Markdown 编辑器：实现细节

> 配套方案：[work-markdown-optimization-plan.zh-CN.md](work-markdown-optimization-plan.zh-CN.md)（目标、阶段、验收）。
> 本文按实现模块组织，章节号与方案中的引用一致。代码是示意，以落地时的类型检查为准。
> 路径默认相对 `src/renderer/src/`，`src/shared`、`src/main` 写全路径。

## 1. 模块布局

| 路径 | 职责 | 阶段 |
|---|---|---|
| `write/markdown/remark-pipeline.ts` | unified 解析器（remark-parse + gfm + math + frontmatter + 自研插件） | S1 |
| `write/markdown/mdast-to-pm.ts` | mdast → ProseMirror 节点，登记原文片段 | S1 |
| `write/markdown/pm-to-mdast.ts` | ProseMirror 节点 → mdast | S1 |
| `write/markdown/to-markdown.ts` | mdast-util-to-markdown 配置、风格探测、自研节点的输出处理 | S1 |
| `write/markdown/source-map.ts` | 原文片段登记、原样写回、节点级序列化缓存 | S1 |
| `write/markdown/block-fidelity.ts` | 每块保真判定、mdast 语义签名 | S1 |
| `write/markdown/document-codec.ts` | 门面：`parseWorkDocument` / `serializeWorkDocument`；兼容旧的 `parseWriteMarkdown` / `serializeWriteMarkdown` | S1 |
| `src/shared/markdown/frontmatter.ts` | frontmatter 拆分/拼接/简单属性解析（渲染进程与主进程共用） | S1 |
| `src/shared/markdown/work-profile.ts` | Callout 类型表、HTML 允许标签/属性、行内公式规则 | S1/S3 |
| `src/shared/markdown/remark-work-plugins.ts` | `remarkCallout`、`remarkWikiLink`、`remarkInlineMathPandoc`（渲染进程与主进程共用） | S1 |
| `src/shared/markdown/render-html.ts` | 同一管线输出 HTML（源码块预览、导出） | S1/S6 |
| `write/tiptap/nodes/*.ts` | `rawMarkdownBlock`、`callout`、`htmlBlock`、`htmlInline`、`wikiLink`、`footnoteRef` 节点与 NodeView | S1/S3 |
| `write/tiptap/review/*.ts` | 块对齐、审阅插件、审阅句柄 | S2 |
| `write/tiptap/blocks/*.ts` | 块手柄、块菜单、多块选择、拖拽、`/` 命令 | S5 |
| `components/write/WritePropertiesPanel.tsx` | 属性面板 | S1 |
| `components/write/WriteDocumentReviewBar.tsx` | 审阅顶部条 | S2 |
| `components/write/WriteOutlineRail.tsx`、`WriteFindBar.tsx` | 目录、查找替换浮条 | S5 |
| `lib/mermaid-render.ts` | mermaid 懒加载、串行渲染、缓存 | S3 |

NodeView 一律用原生 DOM（与现有 `write/tiptap/local-image.ts` 一致）。编辑器是 `new Editor({ element })`
创建的，没有 `<EditorContent>`，`ReactNodeViewRenderer` 用不了；需要 React 的浮层用独立的 `createRoot`。

## 2. S0 止血

### 2.1 构造清单检查

新文件 `write/tiptap/markdown-construct-gate.ts`，在 `auditWriteMarkdownFidelity`（`markdown-manager.ts:169`）开头调用：

```ts
const CONSTRUCTS: Array<[code: string, re: RegExp]> = [
  ['block-math', /^ {0,3}\$\$/m],
  ['escaped-dollar', /\\\$/],
  ['wikilink', /!?\[\[[^\]\n]+\]\]/],
  ['callout', /^ {0,3}>[ \t]*\[![A-Za-z0-9_-]+\]/m],
  ['footnote', /\[\^[^\]\s]+\]/],
  ['html', /<(?:[A-Za-z][\w-]*[\s/>]|\/[A-Za-z]|!--)/],   // p<0.05 不命中
  ['reference-definition', /^ {0,3}\[[^\]]+\]:[ \t]*\S/m]
]
export function findUnsupportedConstructs(markdown: string): string[] {
  const codes: string[] = []
  if (/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.test(markdown)) codes.push('frontmatter')
  const prose = stripCode(markdown)          // 去掉围栏代码块与行内代码，保留行结构
  for (const [code, re] of CONSTRUCTS) if (re.test(prose)) codes.push(code)
  return codes
}
```

- `stripCode` 复用 `write/markdown-live-widgets.ts` 的 `openingFence` / `closingFencePattern`（S4 删除该文件前先把这两个函数移到
  `write/markdown/fences.ts`）；行内代码用 `` /(`+)[^`]*?\1/g `` 替换为等长空格。
- `WriteRichFidelity.reason` 增加 `'unsupported-construct'`，`detail` 为逗号分隔的代码；横幅 `writeRichFallbackNotice`
  后追加 `t('writeRichFallbackReason.<code>')`。
- 测试 `markdown-construct-gate.test.ts`：方案 1.2 表的每个样例；代码块里的 `$$`、`<div>` 不命中；`p<0.05` 不命中。
- **当前合并状态**：S1 编解码器落地后整篇门禁已退役——`resolveWriteEditorSurface` 只按 `.mdx`/非 Markdown/
  截断/超上限/手动 viewMode 路由纯文本；不支持的构造在文档内落成 `rawMarkdownBlock` 而非把整篇挡在富文本外。
  文档不会再因为含 `<br>` 而整体降级。
- **影响面提示**：LLM 生成的 Markdown 常见 `<br>`、`<sup>` 等行内 HTML——按构造清单它们命中 `html`，
  S0 会把文档挡在富文本外；S1 起这类行内 HTML 由 `inlineHtml` 原子节点承载（逐字保存、可显示），
  只有无法安全映射的块级构造才落成 `rawMarkdownBlock`。实际拦截率以埋点为准。

### 2.2 列表解析热修与扩展列表统一

```ts
// write/tiptap/markdown-manager.ts
function guardFirstLine(tokenizer: MarkdownTokenizer, firstLine: RegExp): MarkdownTokenizer {
  return {
    ...tokenizer,
    tokenize(src, tokens, lexer) {
      const nl = src.indexOf('\n')
      if (!firstLine.test(nl < 0 ? src : src.slice(0, nl))) return undefined
      return tokenizer.tokenize(src, tokens, lexer)
    }
  }
}
export const WriteOrderedList = OrderedList.extend({
  markdownTokenizer: guardFirstLine(OrderedList.config.markdownTokenizer!, /^(\s*)(\d+)\.\s+/)
})
export const WriteTaskList = TaskList.extend({
  markdownTokenizer: guardFirstLine(TaskList.config.markdownTokenizer!, /^\s*[-+*]\s+\[([ xX])\]\s+/)
})
```

- 守卫正则与各解析器自身的首行要求一致，语义等价（实测输出逐字相同）。
- `buildWriteRichExtensions(runtime?: WriteRichRuntimeOptions)`：`StarterKit.configure({ orderedList: false, codeBlock: false, … })`
  + `WriteOrderedList` + `WriteTaskList` + 其余；`runtime` 存在时追加补全、粘贴图片、术语传播、模板快捷键、保存快捷键、
  SDD 标签。`WriteRichEditor.tsx:368` 改为调用它。
- 测试：守卫前后对语料解析结果 `toEqual`。S1 切到 remark 后这段代码随 `@tiptap/markdown` 一起退役。

### 2.3 字数统计

- `computeWriteDocumentStats`（`components/write/write-workspace-view-utils.ts:162`）不再在渲染期同步解析：
  - 富文本打开时，编辑器在 `onUpdate` 里用 `doc.textBetween(0, size, '\n', '\n')` 算字数（原子节点按其文本长度计），
    经 `onStatsChange` 回传，节流 300ms。
  - 其它情况用 `requestIdleCallback` 计算，按 `content` 做单项缓存（上一次内容相同直接返回）。
- `WriteWorkspaceView.tsx:264` 的 `useMemo` 改为读取上述结果。

### 2.4 `.mdx`

`write-editor-layout.ts` 新建标签时：`/\.mdx$/i` → `viewMode: 'source'`（S4 后为 `'plain'`）；
`WriteEditorGroupContent.tsx:136` 与 `WriteWorkspaceView.tsx:223` 的 `richModeActive` 排除 `.mdx`。

## 3. S1 remark 转换层

### 3.1 解析管线

```ts
// shared/markdown/parse-mdast.ts
const processor = unified()
  .use(remarkParse)
  .use(remarkGfmWork)                        // gfm 子扩展单独注册（比 combineExtensions 快 ~20%）
  .use(remarkFrontmatter, ['yaml'])          // 正文里一般不会再有，防御用
  .use(remarkMath, { singleDollarTextMath: true })
  .use(remarkDemoteFalseMath)                // Pandoc 规则后过滤（见下）
  .use(remarkCallout)                        // blockquote 首段首行 [!type] title → callout 节点
  .use(remarkWorkInline)                     // 在 text 节点上切出 [[target#heading|alias]] / ![[…]]
export function parseWorkMdast(body: string): Root {
  const { text, inserts } = escapeUnclosedBlockMath(body)   // 未闭合 `$$` → `\$\$`
  const tree = processor.runSync(processor.parse(new VFile(text))) as Root
  if (inserts.length) remapPositions(tree, inserts)        // 位置回映到原文坐标
  return tree
}
```

- **未闭合 `$$` 的预处理带位置回映**：奇数 `$$` 围栏会把后面内容全吞进公式，预处理在最后一个围栏前
  插入 `\`；但这会让之后所有节点的 `position` 偏移 +1，拿错位位置切原文会让原样写回全废——
  所以 `remapPositions` 把插入点之后的偏移减回去，受影响那一块的原文用未插 `\` 的版本。

- **行内公式必须在 micromark 层识别，不能在解码后的 text 节点上找**（修正：原方案先关 `$…$` 再在
  text 上匹配会把 `\{`→`{`、`\,`→`,`，正是要修的丢反斜杠 bug；且 `$a*b$ c $d*e$` 会被斜体拆开）。
  现方案：`singleDollarTextMath: true` 让 micromark 在原文上完整切出公式；再由 `remarkDemoteFalseMath`
  按 Pandoc 规则回退误判——值首尾含空白、或闭 `$` 紧跟数字（`$5 and $6`）的节点还原为普通 text，
  内容取 `position` 切回的原文片段。
- `remarkWorkInline`（`findAndReplace`）只切双链；随后 `anchorWikiLinks` 在父节点原文片段上重跑
  `[[…]]` 匹配，数量一致时按序回写每个 `wikiLink` 节点的 `raw` 与 `position`——`[[x\_y]]` 这类
  带转义的目标因此保留逐字原文。
- `remarkCallout` 规则同 Agentero：`^\[!([A-Za-z0-9_-]+)\](?:[ \t]+(.*?))?[ \t]*$`；`\[!x]` 已转义的不识别；
  节点 `{ type: 'callout', calloutType, typeRaw, title?, children }`。
- 依赖：把 `unified`、`remark-parse`、`remark-gfm`、`remark-math`、`remark-frontmatter`、`mdast-util-to-markdown`、
  `mdast-util-gfm`、`mdast-util-math`、`mdast-util-frontmatter` 声明为直接依赖（版本对齐树中已有的
  unified 11 / remark-parse 11 / mdast-util-to-markdown 2.1）。

### 3.2 mdast → ProseMirror 映射

| mdast | ProseMirror | 属性 / 说明 |
|---|---|---|
| `paragraph` | `paragraph` | |
| `heading` | `heading` | `level = depth` |
| `blockquote` | `blockquote` | |
| `callout` | `callout` | `type`、`typeRaw`、`title` |
| `list` + `listItem`（`checked` 全为 null） | `bulletList` / `orderedList` + `listItem` | `start`；`spread` 存为 `writeSpread` 属性 |
| `list`（所有项 `checked` 非 null） | `taskList` + `taskItem` | `checked` |
| `list`（勾选项与普通项混合） | `rawMarkdownBlock` | TipTap 不能混排 |
| `code` | `codeBlock` | `language = lang`；`meta`、围栏字符与长度存为隐藏属性 |
| `math` | `blockMath` | `latex = value` |
| `thematicBreak` | `horizontalRule` | |
| `table` / `tableRow` / `tableCell` | `table` / `tableRow` / `tableHeader`（首行）或 `tableCell` | `align` 来自 `table.align[i]`（扩展单元格属性） |
| `html`（块级） | `rawMarkdownBlock` | `raw` 逐字；`<div>` 包装由 `mergeHtmlWrappers` 合并 |
| `html`（行内） | `inlineHtml` | `raw = 原文片段` |
| `image` / `imageReference` | `image`（**inline**） | `src`、`alt`、`title`；引用式额外存 `identifier`/`label`/`reference`；段落中间夹图因此可表示 |
| `definition`、`footnoteDefinition`、其它未知块 | `rawMarkdownBlock` | `raw` 为原文片段 |
| `text` | text | |
| `emphasis` / `strong` / `delete` / `inlineCode` | `italic` / `bold` / `strike` / `code` 标记 | |
| `link` / `linkReference` | `link` 标记 | `href`、`title`；引用式额外存 `identifier`/`label`/`reference`，写回时仍输出引用式（气泡改址后清空转内联） |
| `break` | `hardBreak` | |
| `inlineMath` | `inlineMath` | `latex` |
| `wikiLink` | `wikiLink` | `raw`、`target`、`heading`、`alias`、`embed` |
| `footnoteReference` | `footnoteReference` | `identifier`、`label` |
| 其它未知行内节点 | `inlineHtml` | `raw` 为该节点原文片段（逐字） |

实现方式：`mdast-to-pm.ts` 导出 `mdastToPm(root, { body, sourceMap, onTopBlock })`——顶层严格
一个 mdast 块对一个 PM 节点（产出空内容的未知块落成 `rawMarkdownBlock`，不会消失）；
行内内容用递归 `phrasing(children, marks)` 摊平成带标记的文本节点。
节点一律用**编辑器自己的** `editor.schema` 构造（不同 `Schema` 实例的节点不能混用），并在装入前经
`applySafeBlocks`（`schema.nodeFromJSON().check()`）校验；单元测试用 `getSchema(buildWriteRichExtensions())`。

### 3.3 ProseMirror → mdast 与输出

`pm-to-mdast.ts` 是 3.2 的逆映射：行内文本按标记区间重新嵌套成 `emphasis` / `strong` / `link` 等（相邻同标记合并）。
输出用 `mdast-util-to-markdown`：

```ts
// write/markdown/to-markdown.ts
export function blockToMarkdown(node: PMNode, style: MarkdownStyle): string {
  const tree: Root = { type: 'root', children: pmBlockToMdast(node) }
  return toMarkdown(tree, {
    extensions: [gfmToMarkdown(), mathToMarkdown(), workToMarkdown()],
    bullet: style.bullet, bulletOther: style.bullet === '-' ? '*' : '-',
    emphasis: style.emphasis, strong: style.strong, fence: style.fence,
    rule: '-', fences: true, listItemIndent: 'one', incrementListMarker: true
  }).replace(/\n+$/, '')
}
```

- `workToMarkdown()` 为自研节点提供 handlers：`callout`（首行 `> [!${typeRaw}] ${title}`，子内容按 blockquote 方式加 `> ` 前缀）、
  `wikiLink` / `htmlInline` / `html` 直接返回 `raw` / `value`；并在 `unsafe` 中加入
  `{ character: '$', inConstruct: 'phrasing' }`，保证普通文本里的 `$` 输出为 `\$`。
- mdast-util-to-markdown 的转义比 `@tiptap/markdown` 克制，但**不是**"词内不转义"：实测 `a_b_c` 会输出
  `a\_b\_c`、`[x]` 会输出 `\[x]`，`p<0.05` 保持不转义。这只影响**被编辑过/新建的块**（未编辑块原样写回），
  语义等价；如需更干净可在 `unsafe` 上再做规则裁剪。
- **风格探测** `detectMarkdownStyle(body, tree)`：遍历 mdast，用 `position` 回看原文第一个字符统计列表符（`-`/`*`/`+`）、
  强调符（`*`/`_`）、加粗符、围栏（`` ` ``/`~`）的多数派，存入文档上下文；新建文档默认 `- * ** \``。

### 3.4 顶层分块

顶层块按 mdast `position` 切分，块的 verbatim 原文就是 `body.slice(start, end)`（**不含**其后空行）；
两块之间的分隔符（含多余空行）记入 `ctx.separators['idA\0idB']`：

- **"每多一个空行就是一个空段落"**：相邻块间隔里超过分隔所需（`\n\n`）的每个换行都单独生成一个空
  `paragraph` 块，登记原文 `\n`——`a\n\n\n\nb` 解析为 `a`、空、空、`b` 四个块，多余空行不再藏进
  前一块的原文，编辑器里可见、可编辑。
- 文档**开头/结尾**的空白仍是 `ctx.leading` / `ctx.trailing`（Markdown 无法表达首/尾空段落）。
- 序列化时跳过文首/文末的空段落（编辑器可能自动补尾段）；中间的空段落各输出一个换行，配合
  分隔符规则还原：空段落前补 `\n`、空段落后接实块时不再补分隔符（空段落自带换行），
  两个实块之间按前块末尾换行数补齐到 `\n\n`。
- 空文档/纯空白文档 `ctx.leading = body`，序列化原样输出。
- HTML 包裹块：`<div align="center">` 开标签 + 中间块 + `</div>` 闭标签在转换前合并成一个 `html`
  节点（micromark 会按空行拆成三块），整体成为 `rawMarkdownBlock`，居中效果不丢。

### 3.5 原文登记与原样写回

```ts
// write/markdown/source-map.ts
export type WorkDocContext = {
  frontmatter: string                       // 原样，含 BOM/--- 与换行
  eol: '\n' | '\r\n'                        // 文档主导换行符；新块、粘贴内容都按它输出
  leading: string                           // 首块前的空白/注释
  trailing: string                          // 末块后的空白
  firstBlockId / lastBlockId                // 原首/末块的 blockId（决定 leading/trailing 是否接回）
  separators: Map<string, string>           // 原始相邻块之间的逐字分隔符（`\n`、`\n\n\n`…）
  sourceMap: WorkSourceMap                  // blockId → { source, signature }，另建 signature → source 索引
}
```

- 每块登记 `{ source, signature }`；序列化时按 `blockId + signature` 命中原文逐字输出，否则走
  mdast-util-to-markdown 生成。
- **签名回退**：`blockId` 查不到时按 `signature` 再查一次——撤销（PM 恢复旧内容但可能带新身份）、
  粘贴回原处、AI 审阅"拒绝"还原块，都靠这一步保证写回原样。
- **分隔符安全**：原始相邻且未变的块用登记的逐字分隔符（`b\n- x` 的 `\n` 保留）；只要任一块是
  新生成的，就保证至少一个空行——前块原文以 `\n` 结尾时只补 `\n`，否则补 `\n\n`，新插入的块永远不会
  "粘"进上一块（`b`+`c` 不会变成 `b\nc`）。
- **CRLF**：读入时记 `ctx.eol`；未变块的原文逐字（自带 `\r\n`），新生成的块、新分隔符、frontmatter
  拼接全部 `toEol` 转换，输出不混用换行。
- **校验降级**：转换出的每个顶层块经 `schema.nodeFromJSON(node).check()` 校验；违反内容表达式的
  （如 listItem 首子块非段落——已先用 `workAuto` 空段落归一化——或行内夹块级构造）降级为
  `rawMarkdownBlock` 携带原文，不抛异常。
- **每键只重序列化被改块**：`serializeCache` 按 `blockId+signature` 命中；保真判定是纯结构比较
  （`semanticSignature` 忽略 position/data），不做"序列化→再解析"的字符串往返。

### 3.6 插入 Markdown 片段

`write/tiptap/markdown-insert.ts` 的 `replaceRangeWithMarkdown`（行内编辑、信息图占位替换）改为：
`parseWorkDocument(markdown)` 得到节点与登记。**整块**插入/替换时这些节点带原文登记，AI 原文逐字落盘；
行内编辑则不同——替换的是段落里的一段文字，插入后与原段落合并成一个新节点，该节点不登记原文、
保存时重新序列化（内容不变、个别转义可能重写），只有块级替换才保证逐字。

### 3.7 每块保真判定

实现里不是"序列化→再解析→比字符串"（大文档上太贵），而是两道静态检查，见
`write/markdown/schema-check.ts` 与 `write/markdown/block-fidelity.ts`：

```ts
// schema-check.ts —— 结构合法性
export function applySafeBlocks(schema, json, ctx): JSONContent
//   每个顶层块 schema.nodeFromJSON(node).check()；失败的替换为
//   rawMarkdownBlock{ raw: 原文, reason } 并以原文登记。

// block-fidelity.ts —— 语义签名
export function semanticSignature(node: UnistNode): string
//   去掉 position/data，保留 type、value、depth、ordered、start、checked、
//   align、url、lang、identifier 等后 JSON.stringify。
```

- 序列化侧：`sourceFor(blockId, signature)` 先按 blockId 查原文，查不到再按签名查（撤销/粘贴回原处
  命中签名回退）；签名一致即"语义未变"，直接用登记的原文输出，不再生成字符串比对。
- 列表符、强调符、setext/ATX 本来就不在 mdast 里，差异自然被忽略。
- 转换期不合规的块（内容表达式违反、未知构造）在 `applySafeBlocks`/`mdastToPm` 里落成
  `rawMarkdownBlock`，不存在"判不过就丢"的路径。

### 3.8 外部同步（Agent 写盘、文件被外部修改）

`write/tiptap/markdown-sync.ts` 的 `applyExternalMarkdownToEditor` 改为：

1. 用 `parseWorkDocument`（≥5 万字符走 `parseWorkDocumentAsync` → Web Worker，§11）解析新内容；新值到达时取消
   在途的旧解析，Agent 流式改写天然只应用最新一版。
2. 对新旧顶层块对齐，相等的块**直接复用旧节点对象**（连带原文登记），变化区间交给现有
   `computeBlockSyncReplacement` 生成一次 `replaceWith`——不重灌整篇文档。
3. frontmatter 单独比较，变化只通知属性面板。

#### 3.8.1 Agent 上下文的真实行号

`quoted-selection.ts` 的"第 X 行"原先来自纯文本投影的行号，frontmatter 移出编辑器后还会整体偏移。
改为：`rich-selection-state.ts` 的 `selectionStateFromEditor` 接收 `WorkDocContext`，用各块的
`blockId → source` 原文长度 + `ctx.separators` 逐字分隔符 + `ctx.frontmatter`/`ctx.leading` 行数，
算出每个顶层块在**源文件**里的真实起始行；选区行号 = 块真实起始行 + 块内偏移。

### 3.9 两天验证（决定是否采用 remark）

- 语料：方案附录样例 + 真实文档 20 份以上。
- 通过条件：① 所有文件"解析 → 不编辑 → 序列化"逐字节一致；② 每份文件随机改一个段落，diff 只落在该段；
  ③ 保真判定为纯结构比较（无序列化/再解析往返）；④ 现有 `markdown-manager.test.ts` 的往返用例语义不变。
- 性能实测（修正原目标——裸 micromark 解析 30 万字符就要 ~460ms，remark 全管线 ~950ms，
  10 万字符 ~400ms；原"10 万 <150ms、30 万 <500ms"达不到）：仍用 remark——逐字保真靠它；
  代价用工程手段消化（§11：>5 万字符 Web Worker 异步解析 + 外部同步增量化 + 签名缓存）。
- 验证代码就是 3.1–3.5 的最小实现，不接 UI，只写测试。

### 3.10 备选方案（remark 不过关时）

保留 `@tiptap/markdown`：用纯 marked `Lexer`（实测 10 万字符 13.5ms）做顶层分块，逐块交给 TipTap 解析；
3.5 的原样写回与 3.7 的判定照用（语义签名仍用 remark 计算）；文本转义问题通过覆盖实例方法
`escapeMarkdownSyntax`（`@tiptap/markdown/dist/index.js:944`）缓解：`$` 一律转义、词内 `_` 不转义、`[` 仅在会构成链接时转义。

## 4. frontmatter 与属性面板

- `src/shared/markdown/frontmatter.ts` 移植 Agentero：
  `splitFrontmatter(md) → { frontmatter, body }`（正则 `^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)`，原样保留）、
  `joinFrontmatter`、`frontmatterInterior`、`parseFrontmatterProperties`（文本、列表、复选、日期；`aliases/tags/cssclasses`
  视为列表；嵌套映射、多行标量返回 `{ ok:false }`）、`serializeFrontmatterProperties`。YAML 合法性用已安装的 `yaml` 包校验。
  **单项修改不重写整块**：`patchFrontmatterInterior(interior, previous, next)` 对每个属性算出行区间，
  面板只做单点改/删/增，未动的行逐字保留（注释、引号风格、键写法不变）；对不齐时回退整体序列化。
- `WritePropertiesPanel.tsx`（放在文档编辑器顶部，默认折叠为"属性 · N 项"）：
  - 表单模式：每行"类型图标 + 键 + 值"，图标切换类型；列表为标签输入；复选为开关；日期为 `YYYY-MM-DD` 输入。
  - 源码模式：不含 `---` 的 YAML 文本框，失焦时校验，不合法显示错误但不丢内容。
  - 修改后更新 `ctx.frontmatter`，调用 `onChange(serializeWorkDocument(...))`，与正文共用脏状态与自动保存。
- 没有 frontmatter 时，面板收起为一个"添加属性"小按钮（悬停文档顶部才显示）。

## 5. 源码块 `rawMarkdownBlock`

```ts
export const RawMarkdownBlock = Node.create({
  name: 'rawMarkdownBlock', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes: () => ({ raw: { default: '' }, reason: { default: '' } }),
  parseHTML: () => [{ tag: 'div[data-raw-markdown]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', { 'data-raw-markdown': '', ...HTMLAttributes }],
  addNodeView: () => (props) => createRawBlockView(props)
})
```

- `createRawBlockView`：外层 `div.write-raw-block`；内容区 `innerHTML = renderWorkMarkdownToHtml(raw)`（§10 的共享管线，
  已净化）；悬停时右上角显示"源码"标记，`title` 为原因。单击打开源码浮层：小型 CodeMirror
  （`@codemirror/lang-markdown`，无实时预览），⌘Enter 保存、Esc 取消。
- **空渲染回退**：净化后没有可见载荷的构造（HTML 注释、`[d]: url` 引用定义、脚注定义、孤立闭标签）
  渲染结果为零高度——显示淡色等宽字体的原文源码兜底（Agentero 同款），块始终可点可悬停。
- **本地图片**：预览里的 `img` 不直接用文件路径，逐个走 `loadWriteMarkdownImage`（IPC 读工作区文件）；
  NodeView 经 `getFilePath` 选项拿到当前文件绝对路径。
- 保存：`parseWorkDocument(newRaw)` 得到节点（能识别的变成原生节点），`tr.replaceWith(pos, pos + node.nodeSize, nodes)`，
  新节点登记新原文。
- 投影（`write/tiptap/markdown-projection.ts` 的 `visitBlock`）：源码块输出 `raw` 文本并标为不可编辑区间；
  行内编辑、行内补全命中该区间时放弃。`richSelectionBlockType` 返回 `'paragraph'`。

## 6. S2 富文本 AI 审阅

### 6.1 统一句柄

```ts
// components/write/write-document-editor-handle.ts
export type WriteDocumentEditorHandle = WriteRichEditorHandle & {
  beginDiffReview(params: { original: string; nextDoc: string }): boolean
  isDiffReviewActive(): boolean
  acceptAllDiff(): void
  rejectAllDiff(): void
}
```

纯文本编辑器（CodeMirror）继续实现后四个方法。`use-write-workspace-lifecycle.ts:84`、
`write-workspace-inline-actions.ts:253` 改为调用 `documentHandleRef.current?.beginDiffReview(...)`，不再依赖 `markdownHandleRef`。

### 6.2 块对齐

```ts
// write/tiptap/review/align-blocks.ts
export type ReviewChunk =
  | { kind: 'added'; next: number[] }
  | { kind: 'removed'; prev: number[]; anchorNext: number }
  | { kind: 'modified'; prev: number; next: number }
export function alignBlocks(prev: string[], next: string[]): ReviewChunk[]
```

1. 两边都用 `parseWorkDocument` 解析，块键为各块原文 `raw.trimEnd()`。
2. 用 `diff` 包（v8 已在树中，改为直接依赖）的 `diffArrays(prev, next)` 得到相等/删除/新增的连续段。
3. 同一位置"删除 k 块 + 新增 m 块"时，按顺序两两配对，字符相似度（`diffChars` 公共部分占比）≥0.5 的配成 `modified`，
   其余保持 `removed` / `added`。

### 6.3 审阅插件

```ts
type ReviewState = {
  active: boolean
  chunks: Array<{ id: string; kind: ReviewChunk['kind']; from: number; to: number; original: PMNode[] }>
  // from/to 是当前文档（即 AI 版本）中的位置；removed 的 from===to 为插入点
}
```

- `beginDiffReview({ original, nextDoc })`：
  1. 解析 `nextDoc` 得到节点（带原文登记），以一次 `addToHistory:false` 的外部同步事务整篇替换为 AI 版本；
  2. 解析 `original` 得到原文节点（带原文登记），按 6.2 生成块区间；
  3. `setMeta(reviewKey, { type: 'start', chunks })`；`editor.setEditable(false)`；`onReviewStateChange(true)`。
  4. 已在审阅中再次调用（Agent 同一轮又改了文件）：以同一个 `original` 重新计算，与 CodeMirror 版本行为一致。
- 插件 `apply`：每个事务用 `tr.mapping` 映射 `from/to`；处理 `accept` / `reject` / `clear` 元信息。
- 装饰：
  - `added` / `modified`：`Decoration.node(from, to, { class: 'write-diff-added' | 'write-diff-modified' })`；
  - `removed`：`Decoration.widget(from, () => renderRemoved(original), { side: -1, ignoreSelection: true })`，
    `renderRemoved` 优先用块的**原文 Markdown**（`chunk.originalRaw`）走 §10 共享管线渲染——
    `DOMSerializer` 对公式/源码块/HTML 块只产出空占位 `div`，会显示成空白；
    渲染结果为空时同样回退为淡色等宽源码，本地图片走 `loadWriteMarkdownImage`；
    无原文可拿时才用 `DOMSerializer` 序列化 `chunk.original` 兜底；
  - `modified` 且两边都是单个纯文本块（段落、标题）：`diffWordsWithSpace(旧文本, 新文本)`，
    新增词用 `Decoration.inline` 绿色下划线，删除词用 `Decoration.widget` 插入带删除线的红字；
    表格、列表、代码等复杂块只做块级高亮。
  - 每个块起点一个操作部件（"接受 / 拒绝"两个按钮），`stopEvent` 返回 true。

### 6.4 接受与拒绝

- 接受：只从插件状态删掉该块，内容已是 AI 版本。
- 拒绝：`added` → `tr.delete(from, to)`；`removed` → `tr.insert(from, original)`；`modified` → `tr.replaceWith(from, to, original)`。
  这些事务 `addToHistory:false`，且带外部同步标记（不触发 `onChange`）。
- 顶部条 `WriteDocumentReviewBar.tsx`（React，替代 CodeMirror 的面板）：文案复用已有 i18n 键
  `writeDiffReviewing` / `writeDiffAcceptAll` / `writeDiffRejectAll`，另加"第 i / n 处"与上一处/下一处跳转。

### 6.5 审阅期间

- 编辑器只读（**v1 有意为之**：审阅期间禁止用户编辑，避免与块对齐状态打架；这与旧 CodeMirror
  合并视图"边审边改"的行为不同，属于有意的行为收窄而非疏漏）；自动保存暂停（沿用 store 的
  `reviewActive`）；文件监听到新快照时按 6.3 第 4 条重算。
- 行内补全、选区工具条、块手柄在审阅期间隐藏。

### 6.6 结束审阅

1. 所有块处理完（或全部接受/拒绝）后：记下最终文档 `finalDoc`；
2. 先把文档无历史地换回审阅前的原文节点，再用**一步可撤销**事务 `replaceWith` 换成 `finalDoc` 的顶层节点
   （复用同一批对象，原文登记仍有效），这样 ⌘Z 能撤回整次 AI 修改；
3. `setEditable(true)`，`onChange(serializeWorkDocument(doc))`，`onReviewStateChange(false)`。
- **最小替换**（修正原"整篇替换"）：`begin` 与 `finish` 都通过
  `swapToTopNodes` → `topNodesEqual`/`computeBlockSyncReplacement` 求公共前缀+后缀，
  未变的顶层块直接复用原对象，只有变化区间进入事务——光标、滚动位置、装饰与撤销历史不被整体重置；
  `parseSide` 走 `applySafeBlocks`（schema 校验降级），AI 产出里不合规的块在审阅前就落成
  `rawMarkdownBlock` 而不是抛异常。
- 因为被拒绝的块带着原文的原文登记（含签名回退）、被接受的块带着 AI 版本的原文登记，全部拒绝时
  保存结果逐字节等于原文，全部接受时逐字节等于 AI 版本。
- 选区 AI 改写沿用现有 `createWriteRecentEdit` 记录，放在第 3 步之后。

### 6.7 测试

- `align-blocks.test.ts`：纯函数用例（插入、删除、修改、移动、空文档）。
- `review-plugin.test.ts`：无视图的 `EditorState` 上模拟 start → accept/reject → finish，断言最终 Markdown 逐字节。
- 调用方测试：`use-write-workspace-lifecycle.test.ts`、`write-workspace-inline-actions.test.ts` 在富文本句柄下进入审阅。

## 7. S3 内容块

### 7.1 公式

- 采用 `@tiptap/extension-mathematics@3.26`（MIT，`katex` 已提为直接依赖 ^0.16.46）：`BlockMath` / `InlineMath` 节点，
  属性 `latex`，命令 `insertBlockMath` / `updateBlockMath` / `insertInlineMath` / `updateInlineMath`，选项 `onClick(node, pos)`。
  节点类型名 `blockMath` / `inlineMath` 与映射表（§3.2）一致。
- `onClick` 打开编辑浮层：多行文本框 + 下方 KaTeX 实时预览（`throwOnError:false`，错误显示为灰字），
  ⌘Enter 或失焦调用 `update*Math`，Esc 取消。
- 输入规则由 `WriteMathInput`（`write/tiptap/math-edit.ts`）统一负责：空段落 `$$` 回车 → `insertBlockMath`；
  行内闭合 `$` 按 §3.1 的 Pandoc 规则判断（货币 `$5 and $6`、转义 `\$`、代码内不转换）。
  **`InlineMath` 自带的 `$$x$$`→行内公式输入规则被 `extend` 覆盖为空**——它会产出序列化为 `$x$` 的节点，
  与"`$$` 建块公式"的约定冲突；自带的 Markdown 解析也不启用（解析统一走 remark）。
- KaTeX CSS 在 `WriteRichEditor.tsx` 顶部引入（不依赖将被删除的预览组件）。
- 包自带的 `mathMigrationRegex` 迁移功能不启用，避免自动把 `$5 和 $6` 当公式。

### 7.2 Mermaid

- `lib/mermaid-render.ts`：

```ts
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null
let queue = Promise.resolve()
const cache = new Map<string, string>()                 // LRU 64
export function renderMermaid(code: string, theme: 'light' | 'dark'): Promise<{ ok: true; svg: string } | { ok: false; message: string }> {
  const key = `${theme}\0${code}`
  const hit = cache.get(key); if (hit) return Promise.resolve({ ok: true, svg: hit })
  const task = queue.then(async () => {
    const mermaid = await (mermaidPromise ??= import('mermaid').then((m) => m.default))
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'default' })
    const { svg } = await mermaid.render(`kun-mmd-${crypto.randomUUID()}`, code)
    cache.set(key, svg); return { ok: true as const, svg }
  }).catch((error) => ({ ok: false as const, message: String(error?.message ?? error) }))
  queue = task.then(() => undefined)
  return task
}
```

- `mermaid` 目前只是 `streamdown` 的传递依赖（v11.15；excalidraw 另带 v10），要声明为直接依赖并确认解析到 v11。
- 代码块 NodeView（§7.3）在 `language === 'mermaid'` 时：选区不在块内 → 隐藏代码、显示图；选区进入 → 显示代码，
  图在代码下方随输入防抖 300ms 刷新；渲染失败显示源码与一行错误提示。

### 7.3 代码块

- NodeView：顶部条（语言选择器：可搜索列表，选"纯文本"时清空 `language`；复制按钮），`contentDOM = pre > code`。
- 高亮：`prosemirror-highlight`（MIT）+ shiki 解析器，懒加载，主题与 `lib/code-highlighting` 一致；超过 2000 行的代码块不高亮。
- 围栏字符、长度、`meta` 存为隐藏属性，写回时保持（例如 ```` ```ts title="a.ts" ````）。

### 7.4 Callout

- 节点 `callout`：`group: 'block'`，`content: 'block+'`，属性 `type`、`typeRaw`、`title`。
- NodeView：头部为图标按钮（弹出类型列表）+ 标题输入框（透明无边框，Enter/失焦保存）；`contentDOM` 放正文。
- 类型表（`src/shared/markdown/work-profile.ts`）：GitHub 的 note / tip / important / warning / caution，
  加 Obsidian 的 info、todo、abstract/summary/tldr、success/check/done、question/help/faq、failure/fail/missing、
  danger/error、bug、example、quote/cite；未知但合法的类型用通用样式并保留原大小写。
- 行为：正文首段为空时按 Backspace 把内容提出 Callout；Enter 只在 Callout 内拆段（参考 Agentero）。

### 7.5 HTML

- 行内 HTML → `inlineHtml` 原子节点（属性 `raw`），块级 HTML → `rawMarkdownBlock`；序列化逐字输出。
- `<div align="center">…</div>` 这类跨空行的包装在 `mdastToPm` 的 `mergeHtmlWrappers` 里合并成一个
  源码块（开标签 + 中间块 + 闭标签），不再拆成三个孤立块。
- 渲染：`DOMPurify.sanitize(html, WORK_HTML_PURIFY_CONFIG)`，配置来自 `work-profile.ts`：
  允许 `div/center/p[align]/span/img[src,alt,width,height]/br/kbd/sub/sup/u/mark/details/summary`；
  禁止 `script/style/form/iframe` 与全部 `on*` 属性；链接强制 `rel="noopener noreferrer"`。
  `img` 的相对路径走 `loadWriteMarkdownImage` IPC 加载（§5 同一兜底）。
  **渲染为空的块（注释、定义、闭标签）显示淡色等宽源码**，不再折叠为零高度。
- 单击打开源码浮层（同 §5），保存后重新解析。
- 行内成对标签（`<kbd>Ctrl</kbd>`）在 mdast 里是"开标签 + 文本 + 闭标签"三个节点，v1 各自成为 `inlineHtml`；
  NodeView 对开闭标签显示为淡色小标记。以后可合并成 kbd/sub/sup 标记。

### 7.6 双链与脚注

- `wikiLink`：行内原子节点，显示为链接样式的 `alias || target`；⌘/Ctrl+单击 → §7.7 的解析器，按路径、文件名在工作区查找
  （多命中时弹出选择）。`embed`（`![[…]]`）v1 显示为链接卡片，不做嵌入渲染。
- `footnoteRef`：上标原子节点；悬停时在文档中查找 `[^id]:` 定义（在源码块的 `raw` 里匹配）并显示内容。

### 7.7 链接

- `write/work-link.ts`：

```ts
export type WorkLinkTarget =
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; slug: string }
  | { kind: 'workspace-file'; path: string; slug?: string; line?: number }
  | { kind: 'invalid'; reason: string }
export function resolveWorkLinkTarget(href: string, filePath: string, workspaceRoot: string): WorkLinkTarget
```

- 相对路径用 `src/shared/write-markdown-resource.ts` 解析并做工作区越界检查；标题 slug 与 GitHub 兼容
  （小写、去标点、空格转 `-`、重名加 `-1`）。
- 编辑器行为：普通单击链接文字 → 链接气泡（显示文字、地址输入框、打开、复制、取消链接）；⌘/Ctrl+单击或中键直接打开；
  外链 `window.kunGui.openExternal`；锚点滚动到对应标题；工作区文件走 Work 现有的打开文件动作，打开后定位标题或行号。
- 输入 `[文字](地址)` 自动转成链接；⌘K 打开气泡。

### 7.8 表格

- 扩展 `tableCell` / `tableHeader` 增加 `align` 属性（`left|center|right|null`），渲染为 `style="text-align:…"`，
  与 mdast `table.align` 双向映射；工具条见 §9.10。

## 8. S4 单视图

### 8.1 视图状态迁移

- `write/write-workspace-store-types.ts:13`：`WritePreviewMode` 改为 `'rich' | 'plain'`。
- `write/write-editor-layout.ts:305` 的 `validMode` 改为 `normalizeWriteViewMode(value)`：
  `'rich' | 'live' | 'source' | 'preview'` → `'rich'`，`'plain'` → `'plain'`，其它 → `'rich'`。旧布局读入时即迁移，无需版本号。

### 8.2 选择编辑器

```ts
export type WriteEditorSurface = 'document' | 'plain'
export function resolveWriteEditorSurface(input: {
  path: string; viewMode: WritePreviewMode; contentLength: number; truncated: boolean
  isMarkdown?: boolean; documentEditorV2?: boolean
}): { surface: WriteEditorSurface; notice?: 'large-file' | 'mdx' | 'truncated' }
```

规则：非 Markdown 文本 → `plain`；`.mdx` → `plain` + 提示；截断或超过上限 → `plain` + 提示；
`write.documentEditorV2 === false`（rollout 逃生门，`normalizeWriteSettings` 注册，默认开）→ `plain`；
`viewMode === 'plain'` → `plain`；其余 → `document`。两个调用点（`WriteWorkspaceView`、
`WriteEditorGroupContent`）从 `useWriteWorkspaceStore` 读该字段传入。
`write/write-render-safety.ts` 只保留 `readOnly` 与 `notice`，删掉预览相关字段。

### 8.3 界面

- 删除 `WriteWorkspaceView.tsx:481-509` 的 `modeMenuItems` 与相关状态，`WriteWorkspaceToolbar.tsx` 的模式按钮与菜单（约第 225–261 行）。
- "更多"菜单新增"以纯文本打开"（`document` 时）或"以文档打开"（`plain` 且文件是 Markdown 时），写入标签的 `viewMode`。
- `WriteWorkspaceDocumentPane.tsx`：删掉 `previewVisible` 分支和 `fallback` 属性；`document` → `WriteRichEditor`（S4 后改名
  `WriteDocumentEditor`），`plain` → `WriteMarkdownEditor`（改名 `WritePlainTextEditor`，只保留源码外观）。

### 8.4 其它使用方

- 移动端 `mobile/work/MobileWorkResourceScreen.tsx:90`：`viewMode` 固定 `'rich'`，`view !== 'edit'` 时给
  `WriteEditorGroupContent` 传 `readOnly`（新增透传属性）。
- `components/plan/PlanPanel.tsx:450-481`、`components/sdd/SddDraftEditorContent.tsx:257-290`：去掉实时预览兜底，
  只在超上限时用纯文本编辑器。
- SDD 需求标签扩展 `SddRequirementBadges` 随 `buildWriteRichExtensions` 的 runtime 选项传入。
- 补全文件清单（原清单漏项，均已实际改动）：`write/write-workspace-file-actions.ts`（打开/新建文件的
  viewMode 写入）、`write/write-editor-group-actions.ts`（分屏/复制标签的 viewMode 映射）、
  `write/work-whiteboard.ts`（白板节点类型）、`WriteWorkspaceView.tsx` 的 `reviewSurfaceKey`
  （`document`/`plain` 分键，审阅期间切换 surface 重建编辑器）。

### 8.5 删除清单（开关默认开并内测一周后）

| 文件 | 行数 |
|---|---|
| `write/markdown-live-preview.ts`（及 `.test.ts`） | 693 + 194 |
| `write/markdown-live-widgets.ts` | 561 |
| `write/markdown-live-preview-theme.ts` | 61 |
| `components/write/WriteMarkdownPreview.tsx` | 577 |
| `components/write/use-write-split-scroll-sync.ts` | 约 70 |
| `write/tiptap/markdown-manager.ts` 中 `auditWriteMarkdownFidelity`、`getWriteMarkdownManager` 及构造清单检查 | — |
| `WriteMarkdownEditor.tsx` 中 `appearance='live'` 分支与 `livePreviewCompartment` | — |
| `write-workspace-view-utils.ts` 中 `writePreviewDebounceMs`、`useDebouncedValue` 的预览用法 | — |
| i18n：`writeModeRich`、`writeModeSource`、`writeModePreview`、`writeRichFallbackNotice`、`writePreviewErrorFallback` | — |

`fences.ts`（§2.1）与 `@codemirror/merge`（纯文本审阅）保留。

## 9. S5 Notion 式块体验

### 9.1 块手柄

插件 `write/tiptap/blocks/block-handle.ts`（`Extension.create` + ProseMirror `Plugin`）：

- 在编辑器宿主上监听 `mousemove`（`requestAnimationFrame` 节流）：
  `view.posAtCoords({ left: contentRect.left + 24, top: event.clientY })` → `doc.resolve(pos)` →
  取最近的"可拖块"：列表项（`listItem` / `taskItem`）优先，否则深度 1 的顶层块 → `view.nodeDOM(blockPos)` 取矩形。
- 手柄 DOM 挂在宿主内的绝对定位层，放在内容左侧 48px 留白里（`write-rich-editor.css` 为内容区加 `padding-left: 56px`）：
  `+` 按钮与 `⋮⋮` 按钮，垂直对齐块首行（标题按行高居中）。
- 空段落也显示手柄（`+` 的主要入口）；只读、审阅中、选区拖动中隐藏；指针离开编辑区 300ms 后隐藏。
- **触屏**：无悬停环境改用长按——在块上按住 500ms（移动 >10px 取消）直接弹出块菜单；
  `+` 仍可用 `/` 命令触达。
- `+`：在块后插入空段落并放入光标，再插入 `/` 触发 §9.5 的菜单。

### 9.2 块菜单

点击 `⋮⋮` 弹出（`@floating-ui/dom`，已是直接依赖），菜单项：

| 项 | 实现 |
|---|---|
| 转换为 段落 / H1–H3 / 无序 / 有序 / 待办 / 引用 / 代码 / Callout | 先 `NodeSelection` 选中块，再调用对应 `setNode` / `toggleList` / `wrapIn` |
| 复制为 Markdown | `blockToMarkdown(node)`（有原文登记时直接用原文）写入剪贴板 |
| 创建副本 | `tr.insert(pos + node.nodeSize, node.copy(node.content))`（副本是新对象，会重新序列化） |
| 删除 | `tr.delete(pos, pos + node.nodeSize)` |
| AI 改写此块 | 以块的投影区间作为选区，调用现有行内编辑入口 |
| 上移 / 下移 | 与相邻兄弟交换；快捷键 Alt+Shift+↑/↓ |
| 复制块链接（仅标题） | `相对路径#slug` |

多块选中时菜单作用于整组（§9.4）。

### 9.3 拖拽换位

- `⋮⋮` 设 `draggable=true`；`dragstart` 时：
  1. 选中目标（单块 `NodeSelection.create(doc, pos)`；已有多块选区则沿用）并 dispatch；
  2. `const slice = view.state.selection.content()`；
  3. 用 `view.serializeForClipboard(slice)`（ProseMirror 1.3x 公开方法）写入 `text/html` 与 `text/plain`；
  4. `event.dataTransfer.setDragImage(blockDom, 0, 0)`；
  5. `view.dragging = { slice, move: true }`。
- 之后由 ProseMirror 内置的 drop 处理完成"删除原位置 + 插入新位置"，StarterKit 自带的 dropcursor 显示落点。
- 被移动的节点对象不变，原文登记随之生效，只有位置变化的块在保存时仍是原文。
- 拖拽中给宿主加 `data-dragging` 属性，CSS 禁止文本选择。
- `dragend` 无条件清 `view.dragging`：在编辑器外松手不会触发 PM 的 drop 清理，
  残留的 `dragging` 会把下一次外部拖入误判为"移动块"并删掉选中块。

### 9.4 多块选择

- 引入 `@tiptap/extension-node-range@3.26`（MIT，peer 只有 core/pm），提供跨多个兄弟块的节点区间选区；
  具体 API（选区类名、键盘行为）以包内类型定义为准，不满足时自写 `BlockRangeSelection`（继承 `Selection`，
  `content()` 返回区间内顶层块，配合块级高亮装饰）。
- 键盘：光标在块内按 Esc → 选中当前块；Shift+↑/↓ 扩展；⌘A 第一次选当前块、第二次选全文（Agentero 同款）；
  Backspace/Delete 删除选中块；⌘C/⌘X 以 Markdown 文本 + HTML 写入剪贴板。
- 框选：在内容左侧留白或块间空白处按下并拖动 → 绘制半透明矩形 → 与矩形相交的顶层块组成区间选区；文字上拖动仍是普通划词。

### 9.5 `/` 命令

- `@tiptap/suggestion@3.26`：`char: '/'`，`startOfLine: false`，
  `allow: ({ state, range }) => 行首或前一字符为空白 && 父节点不是 codeBlock && 不在公式内 && 可编辑`。
- **中文输入法**：中文标点下 `/` 键产出 `、`（或全角 `／`）——`appendTransaction` 插件把合法触发位上的
  `、`/`／` 原地换成 `/`，菜单照常打开；命令执行时 `deleteRange` 一并删掉该字符。
- 条目（图标 + 本地化名称 + 中英关键词，如 `h1 / 标题 / bt`）：正文、H1–H3、无序/有序/待办列表、引用、代码块、Mermaid、
  块公式、表格（3×3）、Callout、分隔线、图片（打开文件选择并走现有粘贴图片保存逻辑）、链接。
- 执行前核对 `state.doc.textBetween(range.from, range.to)` 仍等于 `'/' + query`，否则放弃（Agentero 的防过期检查）。
- 列表用原生 DOM 渲染、`@floating-ui/dom` 定位，↑/↓ 选择、Enter 执行、Esc 关闭，滚动编辑器时关闭。

### 9.6 页面式排版

- `write-rich-editor.css`：内容最大宽度 760px 居中；正文 16px/1.75；H1 30px、H2 24px、H3 20px，段前距按层级固定
  （参考 Agentero：H1–H3 `mt-6`、H4–H6 `mt-4`，首块不加段前距）；块间距 4px；行内代码、表格、引用样式统一使用 `ds-` 令牌。
- 文件名大标题：编辑器上方显示文件名（去扩展名），只读；若文档首块是与文件名相同的 H1 则不显示，避免重复。
- 占位提示：`@tiptap/extensions` 的 `Placeholder`，空文档显示"开始写作，输入 / 插入块"，聚焦的空段落显示"输入 / 唤起命令"。

### 9.7 目录

- 数据：遍历顶层节点取 `heading`，按节点对象 `WeakMap` 缓存（每次按键只让一个块失效）；标题 id 用 §7.7 的 slug。
- `WriteOutlineRail.tsx`：编辑区右侧刻度条，至少 3 个标题才显示；悬停或键盘聚焦展开标题列表；
  `IntersectionObserver` 高亮当前标题；点击 `scrollIntoView({ block: 'start', behavior: 'smooth' })` 并短暂高亮；
  编辑区宽度 <18rem 时隐藏。命令面板增加"跳转到标题"。

### 9.8 查找替换

- `prosemirror-search@1.1`（MIT）：`search()` 插件、`SearchQuery`（大小写、正则、全词）、`findNext`、`findPrev`、`replaceNext`、`replaceAll`，
  匹配高亮由插件装饰完成。
- `WriteFindBar.tsx`：⌘/Ctrl+F 打开（⌘/Ctrl+Alt+F 展开替换），显示"第 i / n 个"，匹配超过 1000 显示"1000+"；
  不与专注模式的 ⌘⇧F 冲突。源码块、公式等原子节点内的文字不参与匹配（在说明里注明）。

### 9.9 粘贴

`handlePaste`：剪贴板有 `text/plain` 且没有 `text/html`（或 html 来自 VS Code、终端），且文本像 Markdown
（`/^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^```|^\|.*\|\s*$|^>\s|\$\$/m`）时，用 `parseWorkDocument` 解析后插入；
单段无块语法的文本粘贴进标题时按行内插入，保持标题级别；⌘⇧V 永远按纯文本；图片粘贴仍走 `WritePasteImage`。

### 9.10 表格工具条

光标在表格内时，在表格上方浮出：上/下插入行、左/右插入列、删除行/列、列对齐（左/中/右）、删除表格，
全部调用 TableKit 已有命令（`addRowBefore`、`addColumnAfter`、`deleteRow`、`deleteTable` 等）；对齐写 §7.8 的 `align` 属性。

### 9.11 快捷键

⌘⌥1/2/3 标题、⌘⌥0 正文、⌘⇧7 有序、⌘⇧8 无序、⌘⇧9 待办、⌘E 行内代码、⌘⌥C 代码块、⌘K 链接、
⌘D 复制块、Alt+Shift+↑/↓ 移动块、Esc 选中块。与现有 ⌘S 保存、⌘⇧F 专注模式、行内补全 Tab 接受不冲突。

## 10. 导出与共享渲染

- `src/shared/markdown/render-html.ts`：

```ts
export function renderWorkMarkdownToHtml(markdown: string, options: {
  math: 'html' | 'mathml'; renderedDiagrams?: Record<string, string>; resolveResource?: (src: string) => string
}): string
```

  管线：`splitFrontmatter` → remark（§3.1 同一组插件）→ `remark-rehype`（`allowDangerousHtml`）→ `rehype-raw` →
  `rehype-sanitize`（允许列表来自 `work-profile.ts`，与 DOMPurify 配置同源）→ `rehype-katex`（`output` 由参数决定）→
  代码块替换（mermaid 用 `renderedDiagrams[sha1(code)]`，其余交给调用方高亮）→ `hast-util-to-html`。
- 渲染进程用于源码块预览（`math: 'html'`）；主进程 `write-export-service.ts` 的 `renderMarkdownFragment` 调用它。
  文档导出（HTML/PDF）用 `mathmlDual`——MathML 给支持的环境，并列输出 KaTeX span 兜底缺数学字体的 Linux，
  同时把 `katex.min.css` 内联进导出 HTML；**剪贴板/X 文章片段保持纯 MathML，不注入 `<style>`**；
  代码块用 shiki 的 `codeToHtml`。
- 导出契约：`src/shared/write-export.ts` 的 `WriteExportPayload` 增加 `renderedDiagrams?: Record<string, string>`；
  按顺序改 preload、main handler、渲染进程调用方（导出前对文档中的 mermaid 代码块逐个 `renderMermaid`）。
- DOCX（`html-to-docx`）不支持 MathML 时，公式输出为等宽样式的 LaTeX 源码。
- 依赖：`remark-rehype`、`rehype-sanitize`、`rehype-katex`、`hast-util-to-html`、`dompurify` 改为直接依赖（均已在树中）。

## 11. 性能

| 项 | 做法 |
|---|---|
| 解析 | remark 线性但慢（实测：3 万 ~100ms、10 万 ~400ms、30 万 ~950ms，裸 micromark 30 万 ~460ms 已是地板）。**超过 `WORK_PARSE_WORKER_THRESHOLD`（5 万）字符的文档解析放进 Web Worker**（`write/markdown/parse-worker.ts` + `parse-work-async.ts`，`new Worker(new URL(...), import.meta.url)` 免装配；ctx 经 `serializeWorkContext`/`deserializeWorkContext` 跨线程还原），主线程 await 期间不阻塞；worker 失败回退主线程同步解析 |
| 按键 | 节点级序列化缓存（`blockId+signature` 命中），每键只序列化被改的块；字数统计节流（§2.3）；投影已有 `WeakMap` 缓存 |
| 外部同步 | `parseDocSync`（Worker 同源，小文档直接同步解析）+ `computeBlockSyncReplacement` 复用未变顶层块；`WriteRichEditor` 的 value 分支在新值到达时**立即取消**在途的旧解析，Agent 流式改写只保留最新一版 |
| 重资源 | KaTeX、mermaid、shiki 全部动态 `import()`，结果缓存 |
| 基准 | `write/markdown/document-codec.bench.ts`（`vitest bench`，不进 CI）：3/10/30 万字符的打开、单键序列化、外部同步 |
