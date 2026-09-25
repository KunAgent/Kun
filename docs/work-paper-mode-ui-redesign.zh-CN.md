# Work 论文模式：UI 设计审查与改版方案

> 日期：2026-09-25。基线：`develop` @ `c6b688082`（已含 `8e2956ef0` 论文库菜单/元数据/分组/图表/补 PDF）。
> 参考：Agentero 截图 `../Agentero/docs/assets/agent.png`、`coolpaper.png`、`translate.png`，文档 `docs/frontend/shell.md`、`pdf.md`、`vault-tree.md`、`library.md`。
> 结论先说：功能点已经接近，**"不像 Agentero"主要是信息架构和阅读界面的 chrome 问题**，不是缺哪个按钮。本文件只谈 UI。

---

## 1. Agentero 的"那种感觉"是什么

从截图和文档归纳出 6 个设计原则：

| # | 原则 | Agentero 的做法 |
|---|---|---|
| A | **论文就在侧栏里** | 左栏是文件树：`论文库 / 回收站 / 广场 / papers/分组/论文行`。论文行显示**标题**（不是目录名），行尾有 ⚡ 精读按钮。点论文 = 打开阅读。 |
| B | **选中即有上下文** | 左栏底部常驻「信息」面板：标题、作者、年份、会议、标签输入、外链图标（arXiv / 解读 / alphaXiv）、「修改元信息」。换到非论文文档也保留最近一篇。 |
| C | **PDF 占满，控件浮动** | 阅读区只有一条文档 tab 条。缩放、框选、全文翻译是右上角**浮动小胶囊**；页码/主题/适应宽度是底部居中**浮动胶囊**；"翻译页面"是贴在纸边的竖向页签。没有固定工具栏压在 PDF 上方。 |
| D | **交互贴着原文发生** | 划词 → 选区旁小工具条（色点、翻译、快速对话、加入对话）。翻译结果、快速问答都是**贴着选区的浮动卡**（截图里"讲解一下这一段"就是页内对话卡）。批注卡挂在页右缘。 |
| E | **三栏固定分工** | 左：库与信息；中：PDF \| NOTES 分屏（dock 标签）；右：Agent 面板（带建议问题 chip：总结当前论文 / 就我的文献库提问 / 列出关键论点与证据 / 撰写相关工作；composer 自动带上"论文 · 页码"chip）。 |
| F | **发现 = 真实站点 + 入库按钮** | Cool Papers 在中栏以网页形式浏览（带后退/前进/地址栏），每篇论文标题旁多一个 `[入库]`。 |

## 2. Kun 现状对照（问题清单）

| # | 问题 | 位置 | 对应原则 |
|---|---|---|---|
| P1 | **侧栏里看不到论文**。侧栏是：文献库列表 → 搜索框 → 状态 chip → 两个 `<select>` 下拉（标签/分组）→「论文库」「发现」两个命令行 →「文件」树。论文只能在中栏表格里找，侧栏像设置面板而不是书架。 | `components/paper/PaperSidebar.tsx` L243–445 | A |
| P2 | **没有常驻的论文信息面板**。元数据只能通过表格右键 →「编辑元数据」弹窗看和改；阅读时要看作者/会议/标签只能看论文条那一行小字。 | `PaperSidebar.tsx`、`library/PaperMetaEditDialog.tsx` | B |
| P3 | **阅读区上方叠了 4 层 chrome**：Work 编辑器 tab 条（显示 `2506.11060.pdf` 这种文件名）→ 52px 的 PDF 顶栏（文件图标+文件名+路径，`WriteWorkspaceToolbar.tsx` L110 起）→ 论文条（标题+5 个文字按钮，`write/paper/WritePaperBar.tsx`）→ 阅读器工具栏（返回/抽屉/翻页/搜索/缩放，`reader/PaperReaderToolbar.tsx`）；底部还有一条底栏（`reader/PaperReaderBottomBar.tsx`）。估算 170px+ 固定高度，PDF 可视区明显变小，而且层层都是"工具感"。 | `WriteEditorGroups.tsx` L227/L261/L262、`PaperPdfReader.tsx` | C |
| P4 | **结果不贴原文**：划词翻译的结果只写进 marks，在左侧抽屉「批注」列表里显示（`PaperReaderDrawer.tsx` L170–209），选区旁没有翻译卡；「问」直接把选区扔到右侧助手，没有页内快速问答卡；批注只能点高亮后看一个小弹层，没有页边批注列。 | `paper/paper-translate-actions.ts`、`reader/PaperSelectionMenu.tsx`、`reader/PaperPageMarksLayer.tsx` | D |
| P5 | **视图切换是"整页替换"**：论文库 / 发现 / 阅读三种视图互相覆盖（`PaperWorkspaceView.tsx` 的 `view`），阅读时看不到库，回库要点「← 论文库」。Agentero 里论文库是一个常驻标签，和已打开的论文并排。 | `PaperWorkspaceView.tsx`、`paper-mode-store.view` | A、E |
| P6 | **右侧助手没有论文语境**：面板和日常 Work 一模一样，没有建议问题，composer 不显示"当前论文 · 页码"。 | `WriteAssistantPanel.tsx`、`paper-conversation-scope.ts` | E |
| P7 | **论文库表格是"管理后台"风格**：小号灰字、列多、状态 chip 彩色块，没有论文感（封面缩略、摘要预览、阅读进度都弱）。Agentero 的表格也朴素，但主入口是侧栏树，表格是次要。 | `PaperLibraryView.tsx` | A |
| P8 | **发现页是自绘列表**，和 papers.cool 的阅读体验差距大；没有地址栏/前进后退，也没有站点原生的分区导航。 | `PaperDiscoverView.tsx` | F（受安全策略限制，见 §4.6） |
| P9 | **图标与密度**：侧栏行高、字号与 Work 一致（偏大、偏松）；论文相关图标混用（GraduationCap / BookOpen / LibraryBig）。Agentero 的树行是 28px、13px、图标统一的"文档"样式。 | 多处 | — |

## 3. 目标布局

### 3.1 整体三栏

```text
┌ 左栏 280px ─────────┬ 中栏（文档标签） ───────────────────────────────┬ 右栏 360px ────────┐
│ Work ˅              │ [论文库] [Cool Papers] [AOSpec: Action… ×]      │ 论文助手 ˅    ＋ ⟲ │
│ 🎓 论文模式    ●━━  │                                                │                    │
│ ✨ 导入论文    ⌘⇧I  │        （PDF 占满，控件全部浮动，见 3.3）         │  建议问题 chip ×4   │
│ 🔍 搜索…            │                                                │                    │
│ 📚 论文库       128 │                                                │                    │
│ 🗑 回收站           │                                                │                    │
│ ▸ 🌐 发现           │                                                │                    │
│ ▾ 📁 papers         │                                                │                    │
│   ▾ 📁 agents       │                                                │                    │
│      📄 AOSpec…  ⚡ │                                                │ ┌────────────────┐ │
│      📄 B-PASTE… ⚡ │                                                │ │📄2608.00881·p.1│ │
│ ▸ 📁 notes          │                                                │ │今天想做些什么？ │ │
│ ─ 信息 ──── 2608.. ─│                                                │ └────────────────┘ │
│ 📖 AOSpec: Action…  │                                                │                    │
│ 👥 Hao Chen, …      │                                                │                    │
│ 📅 2026 · arXiv     │                                                │                    │
│ 🏷 [+标签]          │                                                │                    │
│ [arXiv][解读][Cool] │                                                │                    │
│ ✎ 修改元信息        │                                                │                    │
└─────────────────────┴────────────────────────────────────────────────┴────────────────────┘
```

### 3.2 左栏（替换 `PaperSidebar.tsx` 主体）

从上到下：

1. **固定头**：`WorkspaceModeTabs` + `PaperModeToggle` + 「导入论文」accent 行（保留现状）。文献库切换改成头部一个小下拉（`文献库名 ˅`，参考截图左上角 `paper ⇕`），不再占一整段列表。
2. **搜索框**（保留），下面去掉状态 chip 和两个 `<select>`：状态/标签筛选移到中栏论文库标签页的工具栏里。
3. **虚拟节点**（固定三行）：`📚 论文库 128`（打开/激活「论文库」中栏标签）、`🗑 回收站`（P2，可先不做）、`🌐 发现 ▸`（展开后是 `arXiv 今日 / 订阅 / 会议论文`，每个打开一个中栏标签）。
4. **论文树**：`papers/` 下的分组文件夹 + **论文行**。论文行：
   - 图标：统一的"论文"图标（单页带折角，不用 GraduationCap）；
   - 文字：`meta.title`（KaTeX 渲染，截断），hover 显示「标题 · 作者 · 年份」；
   - 右侧：未精读时显示 ⚡（一键解读），缺 PDF 时显示下载图标；
   - 当前打开的论文高亮；状态用行首一个 6px 小圆点（未读 空心 / 在读 半实 / 已读 实心），不用彩色 chip；
   - 右键：沿用 `library/PaperRowMenu.tsx`；可拖拽到分组（见 todo P1-1）。
   - 数据来源：`usePaperModeStore.entries` 按 `group` 建树（不用 `WriteFileTree`，避免把 `paper.md`、`figures/` 暴露出来）。
5. **其他文件**：`notes/` 等根目录文件夹继续用 `WriteFileTree`，但放在论文树下方、默认折叠。
6. **信息面板**（新，底部，可折叠、可拖动高度，默认 220px）：显示"最近选中/打开"的论文（切到 NOTES 或其它文件时保留）。内容：标题（2 行）、作者（2 行截断）、年份 · 会议、标签（行内 chip + 输入框，回车添加，调 `updatePaperEntryMeta`）、状态三段切换、外链图标行（arXiv / papers.cool / DOI / 打开解读 / Cool 笔记）、「修改元信息」按钮（打开现有 `PaperMetaEditDialog`）。
   - 新组件：`components/paper/sidebar/PaperTree.tsx`、`PaperTreeRow.tsx`、`PaperInfoPanel.tsx`、`PaperLibrarySwitcher.tsx`。
   - 行高 28px、字号 13px、次要信息 11.5px；与 Work 侧栏共用颜色 token，但密度更紧。

### 3.3 中栏阅读区（最关键）

**去掉 4 层 chrome，只留一条 tab 条 + 浮动控件：**

| 现有 | 改为 |
|---|---|
| Work tab 条显示文件名 `2506.11060.pdf` | 论文模式下 tab 标题用 `meta.title`（截断），PDF 与 NOTES 标签用小图标区分（📄 / 📝）。`WriteEditorTabBar` 加 `titleForPath` 注入（经 context，文件不超行）。 |
| 52px PDF 顶栏（文件名+路径） | 论文模式下**不渲染**。在 `WriteEditorGroups` 渲染 `focusedToolbar` 处加表面判断；或 `WriteWorkspaceView` 在 `surface="papers"` 且当前是论文 PDF 时传 `null`。 |
| 论文条（标题 + 5 个文字按钮） | 删掉整条。标题/作者已在信息面板；动作移到：⚡ 一键解读 → 左栏论文行 + 信息面板；Cool 笔记、抽取图表、打开解读 → 信息面板外链行；进度与取消 → 左下角**后台任务圆环**（新组件，汇总 `usePaperStore.busy`）。 |
| 阅读器顶部工具栏（返回/抽屉/翻页/搜索/缩放） | 右上角浮动胶囊：`− 97% + │ ⛶框选 │ 文A全文翻译`；左上角浮动胶囊：`☰ 目录/图表/参考/批注`（点开是左侧浮层，不挤占 PDF 宽度）。搜索改为 ⌘F 弹出的右上角浮层。「返回论文库」不需要了（论文库是常驻标签）。胶囊在滚动时淡出、鼠标靠近顶部或停止滚动时出现（参考 Agentero `use-pdf-chrome-visibility`）。 |
| 底栏（纸色、全文翻译、导出批注） | 底部居中浮动小胶囊：`12 / 34 │ ◐纸色 │ ↔适应宽度`。全文翻译进右上胶囊；导出批注进批注浮层。 |
| PDF 背景 `bg-ds-main/55` + 每页下方"第 N 页"文字 | 背景用中性灰（浅色 `#e9eaee`、深色 `#1b1c1f`），页间距 12px，去掉页下文字（页码看底部胶囊）。默认适应宽度打开。 |

新组件：`reader/PaperFloatingControls.tsx`（右上 + 底部胶囊）、`reader/PaperSidePopover.tsx`（左侧浮层，复用 `PaperReaderDrawer` 的四个 pane）、`components/paper/PaperTaskRing.tsx`（左下任务圆环）。`PaperReaderToolbar.tsx`、`PaperReaderBottomBar.tsx` 最终删除。

### 3.4 贴着原文的交互

1. **划词工具条**（改 `PaperSelectionMenu.tsx`）：一行小工具条贴在选区上方右端对齐：`●●●●（叠放，hover 展开）│ 翻译 │ 快速对话 ⌘K │ 加入对话 ⌘L`。批注不放工具条里，改成页右缘"评论入口"（见 3）。
2. **翻译卡**（新 `reader/PaperTranslateCard.tsx`）：点翻译后在选区旁弹出卡片，流式显示译文；卡片可「复制」「保存为批注」；鼠标离开 700ms 自动收起，之后可从页边小图标重新打开。现在的 `paper-translate-actions.ts` 已产出 card 数据，只差渲染位置（选区 rects → 页面坐标，参考 `PaperPageMarksLayer` 的坐标换算）。
3. **页边批注列**（新 `reader/PaperCommentGutter.tsx`）：在每页右侧预留 220px（窄于 900px 时回退为页边小图标），带批注的高亮在对应高度显示卡片，卡片之间纵向避让；hover 卡片时原文高亮加深并画一条细线连到卡片；点击卡片就地编辑。
4. **快速对话卡**（新 `reader/PaperAskPopover.tsx`）：`⌘K` 或工具条「快速对话」在选区旁打开一个小对话卡（截图里"讲解一下这一段"），输入问题后流式回答，不打开右栏；卡片右上角「在助手中继续」把这段转到右侧对话。实现上复用当前论文线程发送（`writeConversationResourcePath` 已按论文目录分线程），卡片只显示本次问答。
5. **加入对话**：选区变成右侧 composer 里的 chip（`📄 标题 · p.N`），光标聚焦 composer。

### 3.5 右栏助手（论文语境）

- 标题：`论文助手`（仍是 Work 助手线程，只换标题与空态）。
- 空态：4 个建议问题 chip（按钮样式，参考截图）：**总结当前论文 / 就我的文献库提问 / 列出关键论点与证据 / 撰写相关工作（Related Work）**。点击直接发送（分别对应：当前论文作用域 prompt、库级线程 + `$paper-library`、当前论文 prompt、`paper-multi-prompt.ts` 的 related-work，论文取当前打开的或论文库多选）。
- composer 上方常驻上下文 chip：`📄 <论文短标题> · p.<当前页>`，可点 × 去掉。页码来自阅读器当前页（`paper-reader-actions` 已记录 lastPage，改为同时写进一个轻量 store）。
- 放在 `WriteAssistantPanel.tsx`（591 行）里只加接线：空态和 chip 做成 `components/paper/assistant/PaperAssistantEmptyState.tsx`、`PaperContextChip.tsx`，由 surface 判断注入。

### 3.6 论文库与发现变成"标签页"

- `PaperWorkspaceView` 的三视图切换改成：中栏始终是编辑器组，**「论文库」和各个「发现」来源是固定的虚拟标签**（不能关闭的「论文库」标签在最左，参考截图 `论文库 / Cool Papers` 标签）。
- 实现路线（二选一，推荐 A）：
  - A：在 `write-editor-layout` 增加虚拟 tab 类型 `kind: 'paper-view'`，`id: 'library' | 'discover:arxiv' | 'discover:feeds' | 'discover:venue'`，与现有 `whiteboard` tab 同样的处理方式（`isWriteWhiteboardTab` 旁加 `isPaperViewTab`，渲染分支放在 `WriteEditorGroupContent`）。持久化走现有布局 key（papers 命名空间）。
  - B：保留 `view` 状态，但在编辑器 tab 条左侧画两个"伪标签"。实现快但交互不一致，不推荐。
- 论文库标签内：顶部工具栏放搜索、状态/标签/分组/年份筛选（从侧栏搬过来）、导入、导出 BibTeX、补全 PDF；表格行高 44px，标题 13.5px 半粗、第二行作者 · 年份 · 会议 11.5px，左侧 6px 状态点，右侧阅读进度细条；去掉彩色状态 chip。

### 3.7 发现页

- **近期（不改安全策略）**：把现有原生列表做成"站点感"：顶部 `← → ⟳ 地址` 伪导航条（记录 arXiv 分类/会议的浏览历史），卡片样式参考 papers.cool：大号标题、橙色作者、摘要 5 行可展开、标题尾部 `[PDF] [Kimi] [入库]` 文字按钮（入库后变 `[已入库]`）。
- **远期**：内嵌 papers.cool 需要新增受控 webview 类别（见 todo P3-1），做完安全评审再上。

## 4. 实施顺序（UI 部分）

| 步 | 内容 | 主要文件 | 估时 |
|---|---|---|---|
| U1 | 阅读区去 chrome：隐藏 PDF 顶栏和论文条、tab 显示论文标题、浮动胶囊替换顶部/底部栏、左侧浮层替换抽屉 | `WriteEditorGroups.tsx`（接线）、`reader/PaperFloatingControls.tsx`、`reader/PaperSidePopover.tsx`、`PaperPdfReader.tsx` | 2 天 |
| U2 | 翻译卡 + 快速对话卡 + 页边批注列 + 划词工具条重做 | `reader/PaperTranslateCard.tsx`、`PaperAskPopover.tsx`、`PaperCommentGutter.tsx`、`PaperSelectionMenu.tsx` | 3 天 |
| U3 | 左栏：论文树 + 信息面板 + 文献库下拉；筛选移出侧栏 | `sidebar/PaperTree.tsx`、`PaperTreeRow.tsx`、`PaperInfoPanel.tsx`、`PaperLibrarySwitcher.tsx`、`PaperSidebar.tsx` | 2.5 天 |
| U4 | 论文库/发现改为固定虚拟标签（方案 A） | `write-editor-layout.ts`、`WriteEditorGroupContent.tsx`、`PaperWorkspaceView.tsx`、`paper-mode-store.ts` | 2 天 |
| U5 | 右栏论文语境：建议问题、上下文 chip | `assistant/PaperAssistantEmptyState.tsx`、`PaperContextChip.tsx`、`WriteAssistantPanel.tsx`（接线） | 1 天 |
| U6 | 后台任务圆环（导入/解读/预处理/补 PDF 进度） | `PaperTaskRing.tsx`、`paper-store.ts` | 1 天 |
| U7 | 论文库表格与发现卡片视觉重做；统一论文图标和侧栏密度 | `PaperLibraryView.tsx`、`PaperDiscoverView.tsx` | 1.5 天 |

U1、U2 做完"阅读感"就会接近截图；U3、U4 做完"书架感"就出来了。

## 5. 设计约束

- 颜色、圆角、阴影用现有 `--ds-*` token；不要在 `var()` 颜色上用 `/NN` 透明度（Tailwind 会静默丢掉整条规则），浮层需要不透明底色。
- 浮动控件在 `prefers-reduced-motion` 下只做淡入淡出；滚动时自动隐藏的胶囊在键盘聚焦时保持可见。
- 所有浮层用 `ds-no-drag`，不遮挡 macOS 红绿灯区域。
- 新组件放 `components/paper/**`，保持每个文件 < 700 行；临界文件（`WriteSidebar.tsx`、`WriteWorkspaceView.tsx`、`WriteAssistantPanel.tsx`、`preload/index.ts`、`kun-gui-api-surface.ts`）只加接线。
- 源码、类名、注释、文案不出现参考产品名。
- 验证：`npm run dev` 实机走查浅色/深色两套；每步完成截图对比本文 §3 的线框。
