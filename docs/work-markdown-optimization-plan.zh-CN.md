# Work 模式 Markdown 单视图编辑器方案（参考 Agentero）

> 日期：2026-09-23（修订版：改为"单一编辑视图 + Notion 式块"路线）
> 范围：Work（代码内部名 `write`）工作区里的 `.md` / `.markdown` 文件
> 参考项目：`/Users/zxy/codeproject/ds_project/Agentero`（Tauri + React 19 + Plate）
> 实现细节（数据结构、算法、代码示意、文件清单、测试）见
> [work-markdown-implementation.zh-CN.md](work-markdown-implementation.zh-CN.md)。
> 本文"实测"数据来自本仓库 vitest 临时探针，复现方法见附录。

## 0. 结论

**目标**：Work 里打开 Markdown 只有一个编辑视图——像网页文档一样的所见即所得编辑器，带 Notion 式的块
（左侧六点手柄、拖拽换位、`/` 命令、多块选择），公式、Mermaid、Callout 直接在编辑器里渲染；
去掉现在的"富文本 / 实时预览 / 源码 / 预览"切换。磁盘上始终是标准 Markdown。

**现在为什么有四种视图**（和用什么编辑器关系不大，是三个缺口加一个性能问题）：

1. 富文本读写 Markdown 不可靠，要靠 CodeMirror 兜底（见 1.2）。
2. AI 改稿的红绿审阅只在 CodeMirror 上做了；富文本下 AI 修改直接应用或报冲突
   （`use-write-workspace-lifecycle.ts` 注释 "Rich mode has no line-diff surface"）。
3. 富文本不渲染公式、Mermaid、Callout，要另开预览。
4. 大文档在富文本里解析很慢（10 万字符 0.9–2.6s），且有 30 万字符上限。

**关键决定**

| 编号 | 决定 | 理由 |
|---|---|---|
| D1 | 继续用 TipTap v3（ProseMirror），不迁 Plate | 行内补全、行内编辑、投影坐标、信息图占位、术语传播、SDD 标签都建在 ProseMirror 上；ProseMirror 处理长文档更好；Plate 的优势（块拖拽、块选择）在 TipTap 上可补齐 |
| D2 | Markdown 读写从 `@tiptap/markdown`（marked）换成 remark / mdast | remark 生态成熟、每个节点带原文位置、转义比 marked 克制（但 `a_b_c`→`a\_b\_c`、`[x]`→`\[x]` 仍会转义，只影响被编辑块）；`unified`、`remark-parse`、`remark-gfm`、`remark-math`、`remark-frontmatter`、`mdast-util-to-markdown` 已在 `node_modules`（需改为直接依赖）。代价是解析慢（实测 10 万字符 ~400ms、30 万 ~950ms），用 Web Worker（>5 万字符）+ 增量同步消化。先做 2 天验证，不过关则退回"marked + 分块"备选方案 |
| D3 | 没改动的块原样写回，改动的块才重新生成 Markdown；做不到无损的内容变成"源码块" | 用户不编辑就永不改写文件；不再整篇退出富文本 |
| D4 | AI 改稿审阅搬进富文本：按块红绿对比，每块可接受/拒绝 | 这是去掉源码视图的前提；接口与现有 `beginDiffReview` 相同，调用方不改逻辑 |
| D5 | 只保留"以纯文本打开"一个逃生口（超大文件、`.mdx`、用户手动选择），CodeMirror 只作纯文本编辑器 | 满足"一个视图"，同时不丢极端情况的可用性 |
| D6 | 块手柄自己实现，基于 `@tiptap/extension-node-range`（MIT，只依赖 core/pm） | 官方 `@tiptap/extension-drag-handle@3.26` 的 peer 依赖要求 `@tiptap/extension-collaboration` 和 `@tiptap/y-tiptap`（Yjs），对单机编辑器过重 |

**路线图**（总计约 5–6 周，每个阶段可单独合并）

| 阶段 | 内容 | 预估 | 发布方式 |
|---|---|---|---|
| S0 止血 | 收紧保真检查；列表解析 O(n²) 热修；字数统计不再每键全文解析；`.mdx` 走纯文本 | 1–2 天 | 直接发布 |
| S1 读写层 | remark 转换层、原样写回、每块保真判定、源码块、frontmatter 属性面板 | 5–6 天 | 开关 `write.documentEditorV2`，默认关（字段在 `src/shared/app-settings-write.ts` 的 `normalizeWriteSettings` 注册；S4 单视图落地后开关移除、恒为开） |
| S2 AI 审阅 | 富文本块级红绿审阅，替代 CodeMirror 合并视图 | 3–4 天 | 同上开关 |
| S3 内容块 | 公式、Mermaid、Callout、HTML、双链/脚注、代码高亮、链接气泡与跳转 | 5–6 天 | 同上开关 |
| S4 单视图 | 去掉视图切换、视图状态迁移、移动端/计划面板/SDD 适配、删除实时预览与预览代码 | 2–3 天 | 开关默认开，内测一周后删除旧路径 |
| S5 块体验 | 六点手柄与块菜单、拖拽、多块选择、`/` 命令、页面式排版、目录、查找替换、粘贴、表格工具条 | 6–8 天 | 按项发布 |
| S6 收尾 | 导出与编辑器同一套渲染、增量序列化、性能基准 | 2–3 天 | 直接发布 |

---

## 1. 现状

### 1.1 视图与渲染管线

| 视图 | 组件 | 引擎 | 备注 |
|---|---|---|---|
| 富文本（默认） | `write/tiptap/WriteRichEditor.tsx` | TipTap v3 + `@tiptap/markdown`（marked） | 默认值 `write/write-editor-layout.ts:159`；保真检查不过时整篇退到实时预览 |
| 实时预览（菜单不可选，仅兜底） | `components/write/WriteMarkdownEditor.tsx` + `write/markdown-live-preview.ts` | CodeMirror 6 装饰 | 光标行显示源码 |
| 源码 | 同上，`appearance='source'` | CodeMirror 6 | 红绿审阅只在这里 |
| 预览 | `components/write/WriteMarkdownPreview.tsx` | react-markdown + remark-gfm + `@streamdown/math` | 行内 `$…$` 关闭 |
| 导出 / 复制富文本 | `src/main/services/write-export-service.ts:322` | 主进程 react-markdown + remark-gfm | 无公式、无高亮、HTML 显示为文本 |

其它使用方（S4 要一起改）：
- 移动端 `mobile/work/MobileWorkResourceScreen.tsx:90`：编辑用源码视图，查看用预览视图。
- `components/plan/PlanPanel.tsx:450-481` 与 `components/sdd/SddDraftEditorContent.tsx:257-290`：
  都用 `WriteRichEditor`，兜底是实时预览。

### 1.2 富文本读写实测（`parse → serialize`，`@tiptap/markdown` 3.26.0）

保真检查 `auditWriteMarkdownFidelity`（`markdown-manager.ts:169`）只看"两轮结果是否一样"，不看"和原文是否一样"。
下表中标粗的样例都能通过检查进入富文本，用户敲任意一个字后整篇被改写并自动保存：

| 样例 | 能否进入富文本 | 现象 |
|---|---|---|
| frontmatter | 否 | `---` 变分隔线，`title:` 变二级标题 |
| **块公式** | 是 | `\int_0^1 x\,dx` → `\\int\_0^1 x,dx` |
| **Callout** | 是 | `> [!NOTE]` → `> \[!NOTE\]` |
| **双链** | 是 | `[[Other Note]]` → `\[\[Other Note\]\]` |
| **HTML 块 / 行内 HTML** | 是 | `<div align="center">` → `&lt;div align="center"&gt;` |
| **HTML 注释** | 是 | `<!-- hidden -->` 变成可见文本 |
| **脚注** | 是 | `[^1]` → `\[^1\]` |
| **引用式链接** | 是 | 定义行被删，改为内联链接 |
| **`\$` 转义** | 是 | `\$5` → `$5` |
| 表格对齐、`_em_`、`*` 列表、setext 标题 | 是 | 被规范化（语义不变，产生 diff 噪声） |
| 普通 LLM 输出、嵌套列表、有序列表起始号、多空行、`==高亮==` | 是 | 与原文一致 |

### 1.3 性能实测（Apple Silicon，vitest / node）

| 文档大小 | TipTap 全文解析 | 保真检查 | 纯 marked 词法分析 | 按顶层块分片解析 |
|---|---|---|---|---|
| 3 万字符 | 93–298ms | 168ms | 5ms | 6ms |
| 10 万字符 | 0.9–2.6s | 1.96s | 13.5ms | 19ms |
| 30 万字符 | 约 10s | 超上限跳过 | — | — |

- 根因：`@tiptap/extension-list` 的有序列表和待办列表解析器在每个块起点对剩余整篇文档做
  `src.split("\n")`（`node_modules/@tiptap/extension-list/dist/index.js:852`）。
  加"先看首行是不是列表"的判断后，10 万字符从 2607ms 降到 361ms，输出逐字相同。
- 另一个每键触发的热点：底部字数统计 `computeWriteDocumentStats`
  （`WriteWorkspaceView.tsx:264` 的 `useMemo` 依赖 `fileContent`）每次内容变化都用这个慢解析器解析全文。

### 1.4 其它缺口

- 无查找替换、目录、`/` 命令、Mermaid；富文本里链接点不开（`openOnClick:false` 且无其它处理）；
  预览里所有链接都走 `openExternal`，相对 `.md` 链接和 `#锚点` 失效。
- `WriteRichEditor.tsx:368` 与 `markdown-manager.ts` 各拼一份扩展列表，存在 schema 不一致风险。
- `components/write/use-write-split-scroll-sync.ts` 无引用，是死代码。
- 700 行门禁：`markdown-live-preview.ts` 693 行、`WriteMarkdownEditor.tsx` 657 行、`WriteRichEditor.tsx` 628 行、
  `WriteWorkspaceView.tsx` 623 行。单视图路线下前两个文件会被删除或大幅瘦身。

---

## 2. 从 Agentero 借鉴什么

| Agentero 做法 | 位置 | 在本方案中的落点 |
|---|---|---|
| 只有一个 WYSIWYG 编辑器，编辑期以编辑器文档为准、保存时序列化 | `docs/frontend/markdown.md` | 整体目标；S1 |
| frontmatter 放在编辑器文档之外，字节级保留；属性面板（文本/列表/复选/日期，复杂 YAML 回退源码） | `src/lib/markdown/frontmatter.ts`、`overlays/frontmatter-panel.tsx` | S1 属性面板 |
| 用 remark 插件 + 规则表承载公式、Callout、双链、HTML、脚注 | `plugins/markdown-kit.tsx` | D2、S1、S3 |
| 解析前预处理：未闭合 `$$`、正文里的 `<` | `src/lib/markdown/deserialize.ts` | S1 转换层 |
| HTML 按原文位置切片逐字保存，渲染前用 DOMPurify 净化，iframe 强制 sandbox | `src/lib/markdown/html.ts`、`html-sanitize.ts` | S3 HTML 块 |
| Callout 标记解析，保留原始大小写 | `src/lib/markdown/callout.ts` | S3 |
| 代码块语言选择 + 复制 + Mermaid 源码下方实时预览 | `nodes/block/code-block-node.tsx` | S3 |
| 六点手柄、悬停菜单、拖拽换位、左侧框选多块、⌘A 先选当前块再选全部 | `nodes/block/block-draggable.tsx`、`plugins/dnd-kit.tsx`、`block-selection-kit.tsx` | S5 |
| `/` 命令：只在行首或空白后触发，执行前核对查询文本未变 | `src/lib/markdown/slash-command.ts` | S5 |
| 悬浮目录：≥3 个标题才显示，按顶层节点缓存标题 | `overlays/toc-sidebar.tsx` | S5 |
| 查找替换浮条、Markdown 粘贴、链接气泡、状态栏按宽度降级 | `find-replace-bar.tsx`、`markdown-paste-plugin.ts`、`external-link-popover.tsx`、`editor-status-bar.tsx` | S5 |

Agentero 也有取舍：多余空行以零宽空格写回磁盘、`<img>` 被规范成 `<img />`。
本方案的"原样写回"在保真上要求更高：没改动的块一个字节都不变。

---

## 3. 目标形态

**用户看到的**

- 打开 `.md`：一个居中、约 760px 宽的文档页面。顶部是文件名大标题（只显示，不写入文件）和可折叠的属性面板，
  下面是正文块。
- 悬停任意块，左侧出现 `+` 与六点手柄：`+` 在下方插入并打开 `/` 菜单；六点可拖拽换位，点击打开块菜单。
- 公式、Mermaid、Callout、HTML、表格都直接渲染；点击进入编辑。
- 右侧悬浮目录；底部状态栏显示字数、字符数、阅读时长。
- 没有视图切换按钮。"更多"菜单里有"以纯文本打开"、"复制为 Markdown"、导出。
- AI 改稿后，编辑器里直接出现红绿对比的块，顶部条有"全部接受 / 全部拒绝"，每块右侧有"接受 / 拒绝"。
- 实在识别不了的语法，显示为"源码块"：外观是渲染结果，点击后编辑这一块的 Markdown。

**数据流**

```text
读：磁盘 Markdown
  → 拆出 frontmatter（原样保存，交给属性面板）
  → remark 解析正文得到 mdast（带原文位置）
  → 逐个顶层块转成 ProseMirror 节点，同时登记"节点 → 原文片段"
  → 每块保真判定，不合格的块改成源码块
  → TipTap 文档

写：TipTap 文档
  → 逐个顶层块：节点未变 → 输出登记的原文片段；节点变了 → 转 mdast → mdast-util-to-markdown
  → 拼回 frontmatter
  → 保存队列（沿用 write-save-coordinator.ts）

导出：同一套 remark 管线 → HTML → 主进程 HTML / PDF / DOCX
```

---

## 4. 分阶段计划

每项的数据结构、算法、代码示意和测试见实现细节文档对应章节（括号内为章节号）。

### S0 止血（1–2 天，直接发布）

| 任务 | 说明 |
|---|---|
| 收紧保真检查（实现 §2.1） | 在现有检查前加"构造清单"：剔除代码后，命中块公式、`\$`、双链、Callout、脚注、HTML/注释、引用定义、frontmatter 任一项就不进富文本，横幅写明原因 |
| 列表解析热修（§2.2） | 给有序列表、待办列表的解析器加首行判断，并把 `WriteRichEditor` 的扩展列表统一成 `buildWriteRichExtensions()` |
| 字数统计降频（§2.3） | 不再每键全文解析：富文本下直接从编辑器文档取文本；其它情况空闲时计算，并对相同内容缓存 |
| `.mdx` 走纯文本（§2.4） | 新标签页对 `.mdx` 使用纯文本编辑 |

验收：附录样例中不再有"能进富文本且被改写"的情况；10 万字符文档打开阻塞 ≤0.5s；连续输入时主线程无长任务（>50ms）。

### S1 读写层（5–6 天）

| 任务 | 说明 |
|---|---|
| 2 天验证（§3.9） | 在语料库上验证 remark 转换层：未编辑文档原样输出、编辑单块只改该块、10 万字符解析+转换 <150ms。不过关则改走"marked + 分块 + 原样写回"备选（§3.10） |
| 转换层（§3.1–3.4） | mdast ↔ ProseMirror 双向映射表；风格探测（列表符、强调符、围栏符沿用原文多数派） |
| 原样写回（§3.5–3.6） | `WeakMap<节点, 原文片段>`；序列化只处理改动块并缓存结果 |
| 每块保真判定与源码块（§3.7、§5） | 逐字一致直接通过；否则比较 mdast 语义签名，不一致的块变成源码块 |
| frontmatter 属性面板（§4） | 移植 Agentero 的拆分/拼接与简单属性解析 |
| 外部同步（§3.8） | Agent 写盘后只替换变化的块，未变块保持原对象与原文 |
| 门面不变 | `parseWriteMarkdown` / `serializeWriteMarkdown` 的调用方（`markdown-sync.ts`、`markdown-insert.ts`、字数统计）只换内部实现 |

验收：语料库全部文件"打开 → 不编辑 → 保存"逐字节一致；"只改一个块"磁盘 diff 只落在该块；
开关打开时不再出现"切换到源码编辑"横幅。

### S2 富文本 AI 审阅（3–4 天）

| 任务 | 说明 |
|---|---|
| 统一编辑器句柄（§6.1） | 新类型 `WriteDocumentEditorHandle`，富文本和纯文本编辑器都实现 `beginDiffReview` 等四个方法；`use-write-workspace-lifecycle.ts:84`、`write-workspace-inline-actions.ts:253` 改用统一句柄 |
| 块对齐算法（§6.2） | 两边按顶层块做序列对比，再把相邻的删除+新增配对成"修改" |
| 展示与操作（§6.3–6.5） | 新增块绿底、删除块以只读红底插件部件显示、修改块内做词级高亮；每块接受/拒绝；顶部条全部接受/拒绝；审阅期间只读 |
| 落地与撤销（§6.6） | 结束审阅时以一步可撤销事务落地；拒绝的块带着原文片段登记，保存结果逐字节回到原文 |

验收：Agent 改稿、选区 AI 改写在富文本里都进入审阅；全部拒绝后文件与改稿前逐字节一致；⌘Z 能撤回整次 AI 修改。

### S3 内容块（5–6 天）

| 任务 | 说明 |
|---|---|
| 公式（§7.1） | 采用 `@tiptap/extension-mathematics@3.26`（MIT，peer 只需 katex，已安装）的块/行内公式节点；点击弹出编辑框带实时预览；`$$` 回车、`$…$` 输入规则 |
| Mermaid（§7.2） | 代码块语言为 mermaid 时，失焦显示图、聚焦显示源码；懒加载 mermaid、串行渲染、结果缓存 |
| 代码块（§7.3） | 语言选择、复制按钮；`prosemirror-highlight`（MIT）+ shiki 高亮 |
| Callout（§7.4） | 容器节点，类型表兼容 GitHub 与 Obsidian；点击图标换类型，标题可编辑 |
| HTML（§7.5） | HTML 块/行内 HTML 逐字保存，DOMPurify 净化后渲染，点击编辑源码 |
| 双链、脚注（§7.6） | 行内原子节点逐字保存；⌘+单击打开目标文件；悬停显示脚注内容 |
| 链接（§7.7） | 链接气泡（改文字/地址、打开、复制、取消链接）；统一解析外链、锚点、工作区文件 |
| 表格（§7.8） | 单元格对齐属性与 mdast 对齐互转 |

验收：语料库中公式、Mermaid、Callout、HTML、双链、脚注都以渲染形态显示且可编辑，保存后语义不变。

### S4 单视图（2–3 天）

| 任务 | 说明 |
|---|---|
| 视图状态迁移（§8.1） | 标签页 `viewMode` 旧值 `rich/live/source/preview` 一律迁移为 `rich`，新增 `plain` 表示"以纯文本打开" |
| 选择编辑器（§8.2） | `resolveWriteEditorSurface()`：非 Markdown 文本、`.mdx`、超上限、用户选纯文本 → 纯文本编辑器；其余 → 文档编辑器 |
| 去掉切换 UI（§8.3） | 删掉 `WriteWorkspaceView.tsx:487` 的视图菜单与工具栏模式按钮；"更多"菜单加"以纯文本打开 / 以文档打开" |
| 其它使用方（§8.4） | 移动端查看=只读文档编辑器、编辑=可编辑；计划面板与 SDD 去掉实时预览兜底 |
| 删除旧代码（§8.5） | 实时预览三件套、预览组件、死代码、渲染安全里的预览开关等，约 2500 行 |

验收：Work、移动端、计划面板、SDD 都只有一个编辑视图；旧会话恢复的标签页正常打开；`npm run check:file-lines` 通过。

### S5 Notion 式块体验（6–8 天，按项发布）

| 任务 | 说明 |
|---|---|
| 六点手柄与块菜单（§9.1–9.2） | 悬停定位顶层块或列表项；`+` 插入；块菜单：转换为、复制为 Markdown、创建副本、删除、AI 改写此块、上移/下移 |
| 拖拽换位（§9.3） | 借助 ProseMirror 自带拖放：选中块 → 设置 `view.dragging` → 由内置 drop 完成移动，dropcursor 显示落点 |
| 多块选择（§9.4） | `@tiptap/extension-node-range`；Esc 选中当前块、Shift+↑/↓ 扩选、左侧空白处拖出选框；⌘A 先选当前块再选全文 |
| `/` 命令（§9.5） | `@tiptap/suggestion`；标题、列表、待办、引用、代码、Mermaid、公式、表格、Callout、分隔线、图片、链接 |
| 页面式排版（§9.6） | 居中宽度、文件名大标题、空块占位提示（`@tiptap/extensions` 的 Placeholder） |
| 目录、查找替换、粘贴、表格工具条、快捷键（§9.7–9.11） | 目录 ≥3 个标题显示；`prosemirror-search`；粘贴像 Markdown 的纯文本时解析成块；表格增删行列；Notion 常用快捷键 |

### S6 收尾（2–3 天）

| 任务 | 说明 |
|---|---|
| 导出一致（§10） | 主进程导出改用共享 remark 管线：公式输出 MathML（Chromium 原生渲染）、shiki 高亮、Callout 样式、HTML 净化；Mermaid 由渲染进程预渲染 SVG 随导出请求传入 |
| 性能（§11） | 节点级序列化缓存、外部同步块缓存、`vitest bench` 基准；视测量结果再决定是否上调 30 万字符上限 |

---

## 5. 测试策略

- 语料库 `src/renderer/src/write/__fixtures__/markdown-corpus/`：附录全部样例，外加 Obsidian 笔记、GitHub README、
  学术笔记（大量公式）、LLM 输出、中英混排、带引用定义和脚注的长文。
- 核心断言：未编辑逐字节一致；编辑单块 diff 只落在该块；语义签名在编辑前后按预期变化；
  AI 审阅全部拒绝逐字节回到原文、全部接受逐字节等于 AI 版本。
- 回归面：行内补全与行内编辑的投影坐标、选区工具条、信息图占位 `replaceImageBySrc`、术语传播、
  SDD 需求标签、计划面板、移动端 Work。
- 每阶段必跑：

```bash
npx vitest run src/renderer/src/write src/renderer/src/components/write src/renderer/src/components/sdd src/renderer/src/components/plan
```

```bash
npm run typecheck && npm run lint && npm run check:file-lines && npm run build
```

- 手工：`npm run dev` 打开语料文件，浅色/深色、专注模式、窄面板各看一遍；导出 HTML/PDF/DOCX 各一份；
  打包后在 `dist/Kun-*-mac-arm64-unzipped/Kun.app` 复测。

### 5.1 新增测试文件、i18n 与文件行数（实现细节文档中各节对应）

**新增测试文件**

| 文件 | 覆盖 |
|---|---|
| `write/tiptap/markdown-construct-gate.test.ts` | §2.1 |
| `write/markdown/document-codec.test.ts` | 语料逐字节往返；编辑单块只改该块；风格探测；相邻列表；空文档与文末空白 |
| `write/markdown/block-fidelity.test.ts` | 快路径；语义不一致转源码块；引用定义上下文 |
| `write/markdown/mdast-to-pm.test.ts` | §3.2 映射表逐行 |
| `src/shared/markdown/frontmatter.test.ts` | 拆分/拼接字节级；属性解析与回退 |
| `write/tiptap/review/*.test.ts` | §6.7 |
| `write/work-link.test.ts` | 外链、锚点、相对文件、越界、不存在 |
| `lib/mermaid-render.test.ts` | 队列串行、缓存、失败返回（mock mermaid） |
| `write/tiptap/blocks/*.test.ts` | 手柄定位的块解析、`/` 命令 allow 与防过期、块移动 |

**回归**：`markdown-projection.test.ts`、`inline-edit.test.ts`、`write-selection.test.ts`、`infographic-pending.test.ts`、
`term-propagation.test.ts`、`WriteAssistantPanel.test.ts`、SDD 与计划面板相关测试、`write-export-service.test.ts`。

**i18n**：新文案放 `locales/{en,zh}/common/work-document.json` 并在 `locales/*/common.ts` 注册，其它语言走现有回退；
能用图标表达的不加文案。主要键：属性面板（添加属性、类型名、源码模式）、源码块（标记、原因）、审阅（第 i/n 处）、
块菜单各项、`/` 命令各项、查找替换、链接气泡、以纯文本打开/以文档打开、构造清单原因。

**文件行数**：`WriteRichEditor.tsx` 在 S1 前先拆出 `rich-selection-state.ts`（`selectionStateFromEditor`）与
`rich-editor-handle.ts`（句柄构造），新增模块各自控制在 400 行以内；每阶段跑 `npm run check:file-lines`。

---

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| remark 转换层工作量或保真不达标 | S1 先做 2 天验证，不过关走备选方案（§3.10），后续阶段不受影响 |
| "节点未变"判断失效（某插件整体重建节点） | 只影响能否原样复用，不影响正确性；"未编辑逐字节一致"测试兜底 |
| 富文本审阅复杂度 | v1 审阅期间只读；表格、列表等复杂块只做块级对比，不做词级 |
| 大文档性能 | S0 热修 + remark 线性解析；仍超上限的文件自动以纯文本打开并提示 |
| 移动端 contenteditable 体验 | 查看模式只读；编辑模式真机验证输入法与选区；有问题时移动端编辑保留纯文本 |
| 新依赖 | 均为 MIT：`@tiptap/extension-mathematics`、`@tiptap/extension-node-range`、`@tiptap/suggestion`、`prosemirror-search`、`prosemirror-highlight`、`mermaid`、`dompurify`、remark 系列（已在树中）；改依赖后用 `npx npm@10 install` 重生成 lockfile |
| 整体回退 | S1–S4 在开关 `write.documentEditorV2` 后面；S4 内测一周后才删除旧代码 |

---

## 7. 里程碑

| 周 | 里程碑 | 交付 |
|---|---|---|
| 第 1 周 | S0 + S1 验证 | 不再改写源码；大文档不卡；remark 方案定案 |
| 第 2 周 | S1 + S2 | 原样写回、属性面板、富文本内 AI 审阅（开关后） |
| 第 3 周 | S3 | 公式、Mermaid、Callout、HTML、链接可在编辑器内渲染和编辑 |
| 第 4 周 | S4 + S5 前半 | 单视图上线内测；六点手柄、拖拽、`/` 命令 |
| 第 5–6 周 | S5 后半 + S6 | 多块选择、目录、查找替换；导出一致；删除旧代码 |

---

## 附录：复现实测

- 保真：在 `src/renderer/src/write/tiptap/` 下临时建测试，对 1.2 表中样例调用 `auditWriteMarkdownFidelity`
  与 `serializeWriteMarkdown(parseWriteMarkdown(md))`，结果写到临时文件后删除测试文件。
- 性能：同目录临时测试，生成 3 万 / 10 万 / 30 万字符的典型文档，分别计时 `parseWriteMarkdown`、
  `manager.createLexer().lex`、`new Lexer({ gfm: true }).lex`（marked）与按顶层 token 分片解析；
  守卫对比时包装 `markedInstance.defaults.extensions.block` 中的解析函数。
