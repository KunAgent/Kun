# Work 论文模式：独立开关与学术工作台实现计划

> 日期：2026-09-24。状态：计划，尚未改代码。
> 基线：`develop` @ `a035ab040`，已包含 `c32b1c207 feat(write): paper reading mode…`（上一份计划 P0–P5 的实现）。
> 参考：Agentero（`/Users/zxy/codeproject/ds_project/Agentero`，commit `35e154c1`）的论文库、PDF 标注与翻译、参考文献、广场（发现）等学术功能。
> 前序文档：`docs/work-paper-reading-plan.zh-CN.md`（论文单元、Cool 笔记、一键解读）、`docs/work-paper-reading.zh-CN.md`（用户文档）。
> 目标读者：实现这个功能的人或 Agent。

---

## 0. 一句话目标

在 Work 侧栏顶部「Work ˅」下面加一个 **论文模式** 开关。打开后 Work 整体换成科研工作台：独立的文献库、可搜索筛选的论文库、带高亮批注和翻译的 PDF 阅读器、参考文献、每日论文发现。关闭后回到日常 Work。两边的侧栏、打开的标签页、助手对话互不干扰。

---

## 1. 现状与问题

### 1.1 已上线的部分（c32b1c207）

| 能力 | 位置 |
|---|---|
| 论文单元 `papers/<id>/`，`paper.json` 是标记，无数据库 | `src/main/services/paper/paper-unit-service.ts` |
| 导入 arXiv / papers.cool / 本地 PDF | `WritePaperImportDialog.tsx`、起始页「读论文」卡、文件树「作为论文打开」 |
| 侧栏「论文」分区：平铺列表，每个办公空间都挂一份 | `WritePaperSidebarSection.tsx`，挂在 `WriteSidebar.tsx:617` |
| 阅读布局：左 PDF、右 `NOTES.md`，两组编辑器 0.55 分屏 | `src/renderer/src/write/paper/paper-open-layout.ts` |
| 论文条：Cool 笔记 / 一键解读 / 抽取图表 / 打开解读 | `WritePaperBar.tsx`、`WritePaperStrip.tsx` |
| 预处理：`paper.md` 和 `figures/index.json`（arXiv HTML → TeX → 图注裁剪 → 整页） | `paper-text-service.ts`、`paper-figure-*.ts` |
| 设置：Work → 论文阅读（`write.paperReading`） | `settings-section-write-paper.tsx` |

### 1.2 问题

1. **和日常 Work 混在一起。** 每个办公空间都有「论文」分区（用户截图第二个箭头）；日常文件树里能看到 `paper.md`、`figures/`、`.cache/` 这些派生文件；起始页也有「读论文」。
2. **论文库只是平铺列表。** 没有搜索、排序、标签、阅读状态、分组，论文一多就找不到。
3. **阅读能力薄。** `WritePdfViewer.tsx` 只有翻页、缩放、查找、划词。没有高亮批注持久化，没有目录、图表、参考文献侧栏；划词只有通用 quick actions，没有翻译卡。
4. **入库渠道少。** 没有 DOI、标题搜索、批量粘贴、拖放、BibTeX 导入，也没有每日新论文和订阅。
5. **对话不分论文。** 整个工作区一个助手线程，读第二篇论文时上下文会串。
6. **没有学术出口。** 不能导出 BibTeX，不能顺着参考文献找论文。

---

## 2. 参考：Agentero 学术功能盘点与取舍

「采纳」= 行为照做；「改造」= 目标相同，实现换成 Kun 的方式；「不做」= 本计划不做。阶段编号见 §7。

| Agentero 功能 | 做法要点 | Kun 取舍 | 阶段 |
|---|---|---|---|
| Vault + Library 表格 | `catalog.sqlite` 为权威，`metadata.json` 为投影；表格可排序、选列、搜索 | 改造：文献库 = 普通文件夹，`paper.json` 仍是权威，主进程内存索引；表格照做 | PM2 |
| 标签（8 色）、`is_read`、编辑元数据、DOI 刷新 | patch 语义的 `paper_update_meta` | 采纳；状态扩成 未读/在读/已读，写进 `paper.json` v2 | PM2 |
| 阅读热力条 | 聚合 `marks/` 的逐页活动 | 改造：阅读进度（最后页/总页、最近打开），存本机 | PM2 |
| 组织文件夹 | `papers/nlp/<id>/`，点文件夹 = 表格按路径前缀过滤 | 采纳，侧栏「分组」 | PM2 |
| 回收站 | 删除进 `.agentero/.trash` | 改造：系统废纸篓 `shell.trashItem` | PM2 |
| BibTeX 导出 | 论文库节点右键导出 | 采纳：单篇复制、选中导出、全库导出 | PM2 |
| 魔棒 ⇧⌘I | 批量标识符；标题搜索（S2 + arXiv 并行，5s，Top 3）；Skill 导入 | 采纳前两项；Skill 导入不做（Kun 有 skill 市场） | PM4 |
| 本地 PDF 识别 | liteparse → Zotero recognizer → 标识符，失败回退文件名 | 改造：前两页文本抽 DOI / arXiv id → 标识符管线 → 标题搜索 | PM4 |
| 拖放 PDF 入库 | 拖到 Library 表格或组织文件夹 | 采纳 | PM4 |
| Zotero 迁移 / Connector（23119 端口） | 读 `zotero.sqlite`；浏览器插件保存 | 本期只做 BibTeX 导入；Zotero 迁移可选 | PM4 / PM6 |
| PDF 高亮与批注 | `marks/annotations.json`，归一化坐标，多段矩形；不改 PDF，不写 NOTES | 采纳，JSON 同构 | PM3 |
| 划词菜单 | 高亮色点 / 翻译 / 快速对话 ⌘K / 加入对话 ⌘L；批注走页边 | 采纳：高亮、批注、翻译、解释、加入对话 | PM3 |
| 视觉框选批注 ⌘. | 区域裁剪存 `marks/assets/`，可发给 Agent | 可选 | PM6 |
| 大纲、纸色、沉浸、位置记忆 | 纸色：白、米 `#faf9de`、护眼绿 `#e3edcd`、暗 | 采纳大纲、纸色、位置记忆 | PM3 |
| 版面分析（PP-DocLayoutV3 ONNX）+ 图表浮层 | 本地模型检测图、表、算法、公式 | 不引入模型；图表面板用已有 `figures/index.json` | PM3 |
| 全文翻译覆盖层 | 按版面 bbox 盖译文，缓存 `layout-translate.json` | 改造：整篇翻成 Markdown 对照稿（按页） | PM5 |
| 翻译服务 | 内置网关 / 免费 MT / 商用 BYOK / Agent；学术翻译提示词 | 改造：只走用户自己的模型（可单独选模型）；提示词规则照搬 | PM3 |
| References 面板 | S2/Crossref + 本地 bib/bbl；已入库打开、未入库一键导入；近邻图 | 采纳面板和导入；近邻图不做 | PM5 |
| 文中引用 hover 预览 | PDF Link annotation + dest key | 可选 | PM6 |
| 发现引用本库论文的新论文 | 全库反向引用扫描 | 可选（S2 citations） | PM6 |
| 广场 · Cool Papers | Host 自定义协议代理 + iframe，每行注入 [入库] | 改造：原生会议列表（解析页面）；内嵌网页可选 | PM5 / PM6 |
| 广场 · 订阅 | 本地 RSS / Atom / JSON Feed，论文条目入库 | 采纳 | PM5 |
| 广场 · arXiv Daily | 分类 RSS + embedding 与库相似度排序，Top 20，按天缓存 | 采纳；排序先用本地词法相似度，embedding 可选 | PM5 |
| 精读 paper-reader | 资源齐全后触发，写 NOTES | 已有「一键解读」；补阅读状态联动 | PM3 |
| Agent 伴读 | 划词提问写 marks；PDF 旁的 Agent 面板 | 改造：每篇论文一个对话 + 论文上下文 | PM1 / PM3 |
| CLI / MCP | `agentero mark add` 等 | 改造：可选 kun 工具，渲染端路由 | PM6 |
| 双链 `[[论文@批注]]` | Obsidian 语法 | 不做；改为在日常 Work 文档里插入引用 | PM6 |
| 学术 skills | research-paper-writing、idea-evaluator、deep-research 等 | Kun 已有 `paper-reader`、`scholar-research`、`scientific-problem-selection`；可选移植 research-paper-writing（MIT） | PM6 |
| LaTeX 编译、S3 同步、远程 Vault、移动端 | — | 不做 | — |

---

## 3. 产品设计

### 3.1 开关

位置：`WorkspaceModeTabs`（Work ˅）正下方、「新建文件」之上（用户截图第一个箭头处）。只在 Work 路由显示，Code 和 Rooms 的侧栏不显示。

```text
┌─────────────────────────────┐
│ [💼 Work ˅]                 │
│ [🎓 论文模式          ○━━]  │ ← 新增：整行开关（关）
│ [📄 新建文件]               │
│ [📁 添加办公空间]           │
```

- **样式**：沿用专注开关（`SidebarFocusModeControl`）的 `role="switch"`、轨道和滑块，但做成与 `SidebarCommandRow` 同宽的整行，图标 `GraduationCap`。两个侧栏共用同一个组件，位置不变，切换时不跳动。
- **打开**（`enterPaperMode`）：
  1. 保存所有脏文档（`saveAllDocuments`；失败就不切换并提示原因）。
  2. 写设置 `write.paperMode.enabled = true`，重启后仍在论文模式。
  3. 写 store `workSurface = 'papers'`，`initializeWorkspace(activeLibrary, { force: true })`；编辑器布局按 `papers` 命名空间恢复（`force` 的原因见 §6.1）。
  4. 还没有文献库时，主区域显示引导页（§3.4.1），侧栏只显示开关和「添加文献库」。
- **关闭**（`exitPaperMode`）：同样先保存，然后 `workSurface = 'docs'`，`initializeWorkspace(write.activeWorkspaceRoot, { force: true })`，日常标签页原样恢复。
- **命令与快捷键**：命令面板加「切换论文模式」「导入论文」。在 `src/shared/keyboard-shortcuts.ts` 注册 `toggle-paper-mode`（默认不绑定）和 `paper-import`（macOS 默认 `Meta+Shift+I`，Windows/Linux 默认 `Ctrl+Alt+I`；`Ctrl+Shift+I` 已被 `toggle-devtools` 占用）。
- **远程手机端**（`useRemoteMobileLayout()` 为真）：第一版不显示开关。

### 3.2 两个模式的边界

| 项 | 日常 Work | 论文模式 |
|---|---|---|
| 根目录 | 办公空间（`write.workspaces`） | 文献库（`write.paperMode.libraries`），可以和某个办公空间是同一个文件夹 |
| 侧栏 | 办公空间 + 白板 + 文件树（删掉「论文」分区） | §3.3 |
| 起始页 | 「读论文」卡改成「打开论文模式」 | 论文库表格 |
| PDF | `WritePdfViewer` | 论文单元里的 PDF 用 `PaperPdfReader`（§3.4.3），其他 PDF 仍用 `WritePdfViewer` |
| 文件树 PDF 悬浮操作 | 「作为论文打开」改成「加入论文库」：复制进当前文献库，toast 带「打开」 | — |
| 论文条 | 不显示；文件属于论文单元时只显示一行「在论文模式中打开」 | 显示升级版 |
| 编辑器标签页 | 沿用现有布局 key | `papers` 命名空间的布局 key |
| 助手对话 | 工作区线程 + 文件线程（不变） | 每篇论文一个线程 + 库级线程（§3.5） |
| 设置 | Work 现有各 tab | Work →「论文模式」tab（由「论文阅读」tab 扩展） |

### 3.3 侧栏（论文模式）

```text
┌──────────────────────────────────┐
│ [💼 Work ˅]                      │
│ [🎓 论文模式               ●━━]  │
│ [✨ 导入论文            ⌘⇧I]     │ ← accent 行，打开导入对话框
│ [🔍 搜索标题、作者、标签…     ]  │ ← 过滤论文库；回车打开第一条
│                                  │
│ 文献库  CodeLLMPaper ˅       [+] │ ← 多库切换 / 添加 / 在访达显示
│   📚 全部论文                128 │
│   🕘 最近阅读                    │
│   ◔ 在读 12  ○ 未读 80  ✓ 已读 36 │ ← 三个状态过滤行
│   🏷 标签 ▸                      │
│   📁 分组 ▸                      │ ← papers/ 下的子目录
│ 发现                             │
│   🔭 arXiv 今日                  │
│   📡 订阅                        │
│   🔥 会议论文                    │
│ 文件                             │
│   📝 库根目录文件树（不含 papers/）│
│   🎨 白板                        │
├──────────────────────────────────┤
│ [专注]   ⚙ 设置             📱   │
└──────────────────────────────────┘
```

- 行复用 `SidebarPrimitives`（`SidebarSectionHeader`、`SidebarTreeRow`、`SidebarIconButton`、`SidebarCommandRow`）。
- 「全部 / 最近 / 状态 / 标签 / 分组」只改主区域论文库的过滤条件（`paper-mode-store.filter`），不开新标签页；如果当前在阅读视图，先切回论文库。
- 分组行：新建（在 `papers/` 下建目录）、重命名、把论文行拖进来（移动目录）、把外部 PDF 拖进来（导入到该分组）。
- 「文件」是文献库根目录的 `WriteFileTree`，跳过 `papers/` 和隐藏目录。这样把已有的论文笔记仓库设成文献库时，原来的笔记文件夹仍然可见。综述和对比笔记默认写到 `notes/`。
- 「白板」复用 `WorkWhiteboardSidebarSection`，列出文献库根目录下的白板（一键解读生成的白板也在这里）。

### 3.4 主区域

主区域有三个视图，由 `paper-mode-store.view` 决定：`library`（默认）、`reader`、`discover`。阅读器（编辑器组）一直挂载，切到别的视图时只是隐藏，所以从论文库回来 PDF 位置和 NOTES 都不丢。阅读视图的标签页全部关掉后自动回到论文库。

#### 3.4.1 引导页（没有文献库时）

三张卡：

1. **新建文献库**：默认 `<Documents>/Kun Papers`（主进程 `app.getPath('documents')`），路径可改。
2. **选择已有文件夹**。
3. **使用已有办公空间**：扫描 `write.workspaces`，列出含论文单元（`<papersDir>/*/paper.json`）的空间，一键设为文献库，不移动文件。已经在日常 Work 里导入过论文的用户走这条。

#### 3.4.2 论文库（library）

```text
全部论文 128  [搜索…]  [状态 ▾][标签 ▾][年份 ▾][来源 ▾]      排序: 添加时间 ↓   [列 ⚙]
☐ 标题                                  作者             年份  会议/来源  标签     状态  进度   添加
☐ Code Researcher: Deep Research Agent… R. Singh 等      2025  arXiv      #agent   ◔    11/34  09-20
…（虚拟滚动）
[已选 3 篇]  设标签  设状态  移动到分组  导出 BibTeX  一键解读（排队）  删除
```

- **列**：标题（`$…$` 用 KaTeX 行内渲染）、作者、年份、会议/来源、标签（彩色 chip，颜色由标签名哈希到 8 色，不存颜色）、状态、进度、添加时间。列的显隐和顺序按文献库存在 localStorage。
- **排序**：点表头切换。年份和添加时间默认新到旧，缺失值排最后。
- **搜索**：匹配标题、作者、标签、会议、摘要；不区分大小写和全半角；空格分词，全部命中才算。
- **操作**：单击行打开阅读；⌘/Ctrl 单击、Shift 单击多选。右键菜单：打开、一键解读、获取 Cool 笔记、编辑元数据、复制 BibTeX、复制引用文本、移动到分组、在访达显示、删除（进系统废纸篓）。
- **缺 PDF**：DOI 或 BibTeX 导入的论文可能只有元数据，行上显示「缺 PDF」，菜单有「下载 PDF」「选择本地 PDF」。
- **拖放**：表格区域接收 PDF 拖放（虚线 overlay，只认 PDF）。
- **空库**：两个按钮「导入论文」「去 arXiv 今日挑几篇」。
- 虚拟滚动用已有依赖 `@tanstack/react-virtual`。

#### 3.4.3 阅读（reader）

沿用现有的两组分屏（左 PDF、右 NOTES），增强四处：

```text
┌ 论文条：← 论文库 │ 标题 · 作者 · 2025 · arXiv↗ │ 状态▾ │ 🏷 │ Cool笔记 │ 一键解读 │ 抽取图表 │ 打开解读 │ BibTeX ┐
├──────┬───────────────────────────────────┬───────────────────────┤
│ 目录  │                                   │ NOTES.md（富文本）      │
│ 图表  │   PDF 页面 + 高亮层                 │                       │
│ 参考  │   划词菜单：●●●● 批注 翻译 解释 加入对话 │                       │
│ 批注  │                                   │                       │
├──────┴───────────── 页码 12/34 · 缩放 · 纸色 ┴───────────────────────┤
```

1. **左侧抽屉**（在 PDF 面板内，可收起）：
   - 目录：`pdfDocument.getOutline()`。
   - 图表：读 `figures/index.json`，缩略图加图注，点击跳页。
   - 参考文献：PM5 实现，PM3 先留位置。
   - 批注：本篇所有高亮、批注、翻译，点击跳转；「导出到 NOTES」按钮。
2. **划词菜单**：论文单元里的 PDF 用 `PaperSelectionMenu` 替换通用的 `WriteInlineAgent`。按钮：4 色高亮、批注、翻译（浮动结果卡）、解释（发到本篇对话）、加入对话（选区变成带页码的 chip）。
3. **高亮层**：按归一化坐标绘制；悬停显示批注；点击可以改颜色、改批注、删除、复制原文、加入对话。
4. **底栏**：页码、缩放、纸色（白 / 米 / 护眼绿 / 暗）。关闭时记住最后一页（存本机），下次从这一页打开。

首次打开状态为「未读」的论文时自动改成「在读」（设置里可关）。一键解读完成后，toast 里给一个「标为已读」按钮，不自动改。

#### 3.4.4 发现（discover）

全部是原生列表，不嵌网页（原因见 D6）：

- **arXiv 今日**：顶部分类 chip（默认来自设置 `discover.arxivCategories`）。卡片显示标题、作者、分类、摘要（可展开）、相关度；按钮：入库、Kimi 笔记预览（抽屉里只读，不写盘）、打开 arXiv 页面。排序可切换「相关度 / 公告顺序」。
- **订阅**：左边订阅列表（添加 URL、改名、删除），右边时间线。能识别出 arXiv id 或 DOI 的条目显示「入库」，其他条目显示「打开原文」。
- **会议论文**：选会议和年份（如 `ICLR.2025`），解析 papers.cool 会议列表页；行上「入库」走已有的 venue 导入。

### 3.5 右侧助手：每篇论文一个对话

- **作用域**：阅读视图里，当前文件属于某个论文单元时，对话的资源 key 用**论文目录**，不用 PDF 或 NOTES 文件本身。这样 PDF 和 NOTES 共用一个对话，换一篇论文就换一个对话。论文库和发现视图用库级线程。
- **复用注册表**：`write-thread-registry.ts` 的 `fileThreadIds` / `fileThreadHistoryIds` 用论文目录的绝对路径做 key。`activeWriteThreadForWorkspace(root, threads, registry, unitDir)` 就能取到对应线程。
- **统一映射**：新增 `paperConversationResourcePath(surface, workspaceRoot, activeFilePath, unitDirs)`，以下调用点先经过它：
  - `useWorkbenchWriteAssistantRuntime.ts:114`（切换文件时选线程）；
  - `useWorkbenchComposerSubmitController.ts:373`（组 `writeContext`：新增 `conversationResourcePath` 字段，`chat-store-thread-send.ts:363` 优先用它，只改这一处参数）；
  - `useWorkbenchNavigationController.ts:552`（新对话）；
  - `useWriteResourceConversationHistory.ts`（历史弹层，新增资源类型 `paper`）。
- **对话头**：显示论文标题。
- **上下文**：自动附带「当前论文」引用（`paper.json`、`paper.md`、`NOTES.md`、`marks/annotations.json` 的相对路径）；PDF 选区 chip 带页码，形如 `Selected text from <pdf> (page N)`。
- 多选论文后的「对比阅读」「写相关工作」放在 PM6。

---

## 4. 关键决策

- **D1 论文模式是 Work 的第二个「表面」，不是新路由。** 路由仍是 `write`，新增 `workSurface: 'docs' | 'papers'`。编辑器组、PDF、NOTES 富文本、助手、文件监听、线程注册表全部复用。`WorkbenchLeftSidebar` 和 `WorkbenchStageRouter` 各加一个分支。
- **D2 文献库是独立的根目录列表**（`write.paperMode.libraries` / `activeLibrary`），不混进办公空间列表。同一个文件夹可以同时是办公空间和文献库；编辑器布局 key 按表面区分，日常表面沿用旧 key，不需要迁移。`readWriteEditorLayout` / `persistWriteEditorLayout` 有 13 个调用点，所以不改签名：`layoutStorageKey(root)`（`write-editor-layout.ts:346`）内部读取模块级的当前表面，由 `setWorkSurface` 设置。切换顺序固定为「保存旧表面布局 → 改表面 → `initializeWorkspace`」，避免旧表面的布局写进新 key。
- **D3 仍然不引入数据库。** `paper.json` 是权威，升级到 v2 加标签、状态、评分等（§5.2）。主进程给每个文献库维护内存索引，按 `paper.json` 的 mtime 增量更新，配合文件监听。只在本机有意义的数据（最后页、最近打开）存 app 数据目录，不写进文献库，免得 git 里全是噪音。
- **D4 标注写进 `<unit>/marks/`**，格式和 Agentero 同构；不改 PDF，不自动写 NOTES，提供显式的「导出批注到 NOTES」。
- **D5 翻译只走用户自己的模型。** 从 `prompt-optimization-service.ts` 抽出一次性模型请求 helper（按 endpointFormat 建 URL 和请求体、代理、解析响应），翻译和以后的一次性请求共用。默认继承 Work 助手的模型，可以单独指定。不接免费 MT，也不接内置网关。按 `AGENTS.md`「Providers And Model Requests」一节的要求，把新消费方加进那份清单。
- **D6 发现页全部原生渲染，不嵌网页。** `src/main/extensions/extension-webview-security.ts` 的 `will-attach-webview` 只放行扩展、dev-preview 和授权的原型文件，非扩展 webview 的 preload 会被删掉。为 papers.cool 开一个新类别需要单独做安全评审（独立分区、host 白名单、注入脚本）。原生列表能拿到大部分价值，内嵌浏览放 PM6 可选。
- **D7 推荐排序先用本地词法相似度。** BM25，语料是库内论文的标题和摘要，最近加入的权重更高，不外发任何数据。embedding（OpenAI 兼容 `/embeddings`）作为可选 v1，开启时明确提示摘要会发到该端点。
- **D8 外部学术接口只在用户操作时请求。** 全部走 `paper-http.ts`（固定 UA、超时、体积上限、只允许 https），按来源限速（§8）。
- **D9 700 行门禁优先。** 新代码放新目录，临界文件只加接线（§6.2）。
- **D10 源码不留参考产品名。** 文件名、类名、CSS 类、i18n 文案、注释里都不写 Agentero。只有真正移植过来的代码，按 MIT 许可在文件头保留来源声明（和现有 `coolpapers-client.ts` 一样）。
- **D11 日常 Work 的论文入口在 PM1 一次迁走。** 旧数据不动；首次打开论文模式时，引导用户把含论文单元的办公空间设为文献库。

---

## 5. 数据模型

### 5.1 设置 `write.paperMode`（新 slice，zod `.strict()`）

```ts
type WritePaperModeSettingsV1 = {
  enabled: boolean                     // 开关状态
  libraries: string[]                  // 文献库根目录，规范化规则同 workspaces
  activeLibrary: string                // '' 表示未配置 → 显示引导页
  autoMarkReading: boolean             // 首次打开 unread → reading，默认 true
  translate: {
    targetLanguage: 'zh' | 'en'
    inheritModel: boolean              // 默认 true：跟随 Work 助手模型
    providerId: string
    model: string
    autoTranslateSelection: boolean    // 默认 false
  }
  discover: {
    arxivCategories: string[]          // 默认 ['cs.CL', 'cs.AI', 'cs.LG', 'cs.SE']
    feeds: Array<{ id: string; url: string; title: string }>
    rankMode: 'lexical' | 'embedding' | 'off'
    embedding: { baseUrl: string; apiKey: string; model: string }
  }
  scholar: {
    semanticScholarApiKey: string
    crossrefMailto: string
    onlineReferences: boolean          // 默认 true
  }
  reader: { paperTone: 'white' | 'sepia' | 'green' | 'dark' }
}
```

- `write.paperReading`（`papersDir`、`interpretTemplate` 等）保留不变，作用于每个文献库。
- API key 字段沿用现有 `inlineCompletion.apiKey` 的存储和日志脱敏方式。
- 必须同时改四处，漏一处设置就存不上（参考 `c2f028f09` 修过的同类问题）：
  1. 类型：`src/shared/app-settings-types-paper-mode.ts`（新）；
  2. 默认值和 normalize：`src/shared/app-settings-paper-mode.ts`（新）；
  3. `src/shared/app-settings-write.ts` 的 normalize / merge 接线；
  4. IPC patch schema：`src/main/ipc/app-ipc-schemas/settings.ts`。
  配套写 round-trip 测试。

### 5.2 `paper.json` v2

在 v1 基础上新增字段，全部可选：

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | `2` | 读取时接受 1 和 2；v1 只在内存里升级，**用户改了 v2 字段才回写** |
| `tags` | `string[]` | 最多 32 个，每个最多 40 字符；去重，去首尾空白 |
| `status` | `'unread' \| 'reading' \| 'read'` | 缺省视为 `unread` |
| `readAt` | `string` | 标为已读的时间 |
| `rating` | `1..5` | |
| `citeKey` | `string` | BibTeX key：`<一作姓><年><标题首个实词>`，库内冲突时加 `a` / `b` / `c` |
| `ids` | `{ s2?, openalex?, pmid?, dblp? }` | 外部 id |
| `bibtex` | `string` | 来源自带的条目（Crossref 或导入的 .bib），导出时优先使用 |
| `source` | `'arxiv' \| 'coolpapers' \| 'doi' \| 'local-pdf' \| 'title-search' \| 'feed' \| 'bibtex'` | 入库渠道 |
| `pdfFile` | 改为可选 | 缺失表示只有元数据（DOI / BibTeX 导入），界面显示「缺 PDF」 |
| `needsReview` | `boolean` | 本地 PDF 识别结果不确定时置位，论文库里显示提示 |
| `references` | `{ status, source?, count?, updatedAt? }` | 参考文献的派生状态 |

兼容性：旧版本 App 读到 v2 会判为无效单元（v1 schema 是 `z.literal(1)` 加 `.strict()`）。桌面端以自动更新为主，接受这个代价，在发布说明里写明。

### 5.3 本机阅读状态

`<userData>/paper-library/<sha1(libraryRoot)>.json`：

```json
{ "version": 1, "units": { "papers/2506.11060": { "lastOpenedAt": "…", "lastPage": 11, "pageCount": 34 } } }
```

主进程读写，原子写（复用 `src/main/atomic-json-file.ts`），写入节流 2s。

### 5.4 `marks/`

```text
<unit>/marks/
├── annotations.json   # { version: 1, items: Highlight[] }，按 id 去重
├── <id>.json          # kind: 'translate' | 'ask'
└── assets/            # 预留给 PM6 的框选裁剪图
```

```ts
type Highlight = {
  id: string
  kind: 'highlight'
  color: 'yellow' | 'green' | 'blue' | 'pink'
  page: number                                          // 从 1 开始
  rects: Array<[x: number, y: number, w: number, h: number]>  // 归一化到页面 0..1
  quote: string                                         // 原文，用于重新定位，也给 Agent 看
  comment?: string
  createdAt: string
  updatedAt: string
}
```

- translate mark：`{ id, kind: 'translate', page, rects, quote, translation, targetLanguage, model, createdAt }`。
- 写入：主进程原子替换，渲染端 600ms 防抖。监听外部修改（比如 Agent 写的），按 id 合并，不覆盖本地未保存的改动。

### 5.5 其他派生文件

| 文件 | 内容 | 可重建 |
|---|---|---|
| `<unit>/references.json` | `{ version: 1, source, fetchedAt, items: [{ n, title?, authors?, year?, venue?, doi?, arxivId?, raw? }] }`；「是否已在库中」渲染时现算，不落盘 | 是 |
| `<unit>/source/*.bbl`、`*.bib` | 预处理时从 e-print 顺手保存（现在 `paper-figure-tex.ts` 只在内存里解包） | 是 |
| `<unit>/<slug>-译文.md` | 整篇对照翻译 | 是 |
| `<unit>/.cache/translate-<lang>-<modelHash>.json` | 分块翻译缓存，key 是原文块哈希 | 是 |
| `<userData>/paper-discover/` | arXiv 分类按天缓存、订阅条目缓存、推荐结果 | 是 |

---

## 6. 架构与接线

### 6.1 模式切换数据流

```text
PaperModeToggle
  └─ enterPaperMode()
       ├─ writeStore.saveAllDocuments(root)            失败则中止
       ├─ setSettings({ write: { paperMode: { enabled: true } } })
       ├─ writeStore.setWorkSurface('papers')
       └─ writeStore.initializeWorkspace(activeLibrary, { force: true })
            └─ readWriteEditorLayout(root)   // key 带 papers 命名空间（D2）

WorkbenchLeftSidebar:  route === 'write' ? (surface === 'papers' ? <PaperSidebar/> : <WriteSidebar/>)
WorkbenchStageRouter:  route === 'write' ? (surface === 'papers' ? <PaperWorkspaceView/> : <WriteWorkspaceView/>) + rightPanel
loadWriteSettings():   root = paperMode.enabled ? paperMode.activeLibrary : activeWorkspaceRoot
```

**同根目录的坑**：`initializeWorkspace` 发现根目录没变时只做 `refreshWorkspace` 就返回（`write-workspace-file-actions.ts:123`），不会重新读布局。文献库和办公空间是同一个文件夹时，切换表面必须强制完整初始化：给 `initializeWorkspace` 加 `{ force: true }` 选项，跳过这个短路，但仍然先走 `prepareActiveWriteFileForNavigation`。PM0 spike 要覆盖这个场景。

`PaperWorkspaceView` 的阅读视图里渲染的仍是 `WriteWorkspaceView`（传 `surface="papers"`）。论文专属部分通过两条通道注入，不复制 686 行的编排代码：

- **`paperSlots`**：论文条和导入对话框。把 `WriteWorkspaceView` 里现有的约 30 行论文接线抽到 `use-paper-surface-slots.tsx`，日常表面不再渲染它们。
- **`WritePdfRendererContext`**：`WriteWorkspaceDocumentPane.tsx:253` 渲染 PDF 时先查 context。论文单元里的 PDF 换成 `PaperPdfReader`，其他 PDF 仍是 `WritePdfViewer`。

### 6.2 文件预算（700 行门禁）

| 文件 | 现有行数 | 规则 |
|---|---|---|
| `src/preload/index.ts` | 700 | **不许改**。新 bridge 加到 `src/preload/paper-api.ts`（`...paperApi` 已在第 698 行展开） |
| `src/shared/kun-gui-api-surface.ts` | 697 | **不许改**。在 `src/shared/paper/kun-gui-api-paper.ts` 里把 `KunGuiPaperApi` 组合成几个子接口 |
| `src/renderer/src/components/write/WriteSidebar.tsx` | 693 | 删掉论文分区（约 -25 行），加 `<PaperModeToggle/>`（+1 行） |
| `src/renderer/src/components/write/WriteWorkspaceView.tsx` | 686 | 论文接线抽成 hook，净减少 |
| `src/renderer/src/components/settings-section-write.tsx` | 680 | 只改 tab 文案；内容都放 `settings-section-write-paper*.tsx` |
| `src/renderer/src/store/chat-store-thread-send.ts` | 690 | 只改第 363 行附近一个参数 |
| `src/renderer/src/write/quoted-selection.ts` | 679 | 不改；选区页码拼装放新文件 |
| `src/renderer/src/write/write-workspace-store.ts` | 674 | 只加表面接线（≤5 行），逻辑放 `write-workspace-surface-actions.ts` |
| `src/shared/app-settings-types-product.ts` | 640 | 新类型放 `app-settings-types-paper-mode.ts`，这里只加 1 行引用 |
| `src/renderer/src/write/write-workspace-file-actions.ts` | 636 | 只给 `initializeWorkspace` 加 `force` 选项（§6.1），≤5 行；前缀重映射 helper 抽出后净减少 |
| `src/renderer/src/components/write/WriteAssistantPanel.tsx` | 591 | 论文作用域标题做成小组件，≤10 行 |
| `src/main/ipc/app-ipc-schemas/settings.ts` | 528 | 加 paperMode patch schema；超过 40 行就拆到 `settings-paper-mode.ts` |
| `src/renderer/src/components/write/WritePdfViewer.tsx` | 422 | 先抽出 `use-write-pdf-document.ts`、`use-write-pdf-navigation.ts` 两个 hook 供两个阅读器共用，行为不变 |

### 6.3 shared（`src/shared/paper/` 与设置）

| 文件 | 内容 |
|---|---|
| `paper-meta-v2.ts`（新） | v2 schema、`upgradePaperMeta(v1)`、`paperMetaSchema = v1 \| v2` |
| `paper-library-types.ts`（新） | `PaperLibraryEntry`（meta 加 `hasPdf`、`hasNotes`、`interpretationCount` 和本机状态）、过滤和排序类型、IPC 结果 |
| `paper-library-query.ts`（新，纯函数，带测试） | 搜索归一化、过滤、排序、计数（状态、标签、分组） |
| `paper-marks-types.ts`（新） | §5.4 的 schema |
| `paper-references-types.ts`（新） | §5.5 的 schema |
| `paper-bibtex.ts`（新，带测试） | meta 转 BibTeX（arXiv 用 `@misc` 加 `eprint` / `archivePrefix`，有 DOI 用 `@article` 或 `@inproceedings`）、`citeKey` 生成和去冲突、最小 BibTeX 解析（导入用） |
| `paper-discover-types.ts`（新） | 发现卡片、订阅、推荐结果 |
| `kun-gui-api-paper.ts`（改） | `KunGuiPaperApi = PaperUnitApi & PaperLibraryApi & PaperReaderApi & PaperDiscoverApi` |
| `app-settings-types-paper-mode.ts`、`app-settings-paper-mode.ts`（新） | §5.1 |

### 6.4 main（`src/main/services/paper/`）

| 文件 | 职责 |
|---|---|
| `paper-library-service.ts` | 递归扫描 `<root>/<papersDir>`（深度 ≤3，跳过 `figures/`、`marks/`、`source/`、`assets/`、`.cache/`）；按 mtime 增量索引；`updateMeta`（patch，原子写）；`moveToGroup`；`trash`（`shell.trashItem`）；`detectLibraries(workspaces)`。现有 `paperListUnits` 只读一层目录，分组需要递归 |
| `paper-local-state-store.ts` | §5.3 |
| `paper-marks-service.ts` | 读写 `marks/`，按 id 合并，原子写 |
| `src/main/services/one-shot-model-request.ts` | 从 `prompt-optimization-service.ts` 抽出；两边共用，补 chat completions / messages / responses 三种 endpointFormat 的测试 |
| `paper-translate-service.ts` | 划词翻译（单次请求）；整篇翻译（分块、进度、取消、缓存）；学术翻译提示词：公式、引用、编号原样保留，术语首次出现附原文，不解释，只输出译文 |
| `scholar-client.ts` | Semantic Scholar：标题搜索、按 id 取元数据、references、citations；限速队列 |
| `crossref-client.ts` | DOI 元数据（含 `reference`），可选 `mailto` |
| `paper-identify-service.ts` | 用 `readWritePdfText` 取本地 PDF 前两页文本，抽 DOI / arXiv id；取字号最大的一行作为标题候选 |
| `paper-references-service.ts` | 顺序：本地 `source/*.bbl` / `*.bib` → S2 → Crossref；写 `references.json` |
| `paper-discover-service.ts` | arXiv 分类 RSS（`rss.arxiv.org`）；papers.cool 会议列表解析（走 `coolpapers-client` 现有的串行队列）；用户订阅（RSS 2.0 / Atom / JSON Feed）；按天缓存 |
| `paper-recommend.ts` | BM25 打分（纯函数，带测试）；可选 embedding |
| `paper-http.ts`（改） | 白名单加 `api.semanticscholar.org`、`api.crossref.org`、`rss.arxiv.org`；新增只允许 GET 的任意 https 主机选项，给订阅源和出版商页面用 |
| `paper-figure-tex.ts`（改） | 解包 e-print 时顺手把 `.bbl` / `.bib` 存到 `<unit>/source/`（≤2MB） |

IPC：新建 `src/main/ipc/register-app-paper-library-ipc-handlers.ts` 和 `app-ipc-schemas/paper-library.ts`；所有带 `unitDir` 的调用沿用现有的「必须在根目录内」校验。`register-app-ipc-handlers.ts`（35 行）加一行注册。

### 6.5 renderer

状态和动作放新目录 `src/renderer/src/paper/`：

| 文件 | 职责 |
|---|---|
| `paper-mode-store.ts` | `view`、`filter`（关键词、状态、标签、分组、年份、来源）、`sort`、`selection`、`libraryEntries`、发现页状态 |
| `paper-mode-actions.ts` | `enterPaperMode`、`exitPaperMode`、`switchLibrary`、`addLibrary`、`removeLibrary`（只从列表移除，不删文件） |
| `paper-library-actions.ts` | 刷新索引、改元数据、标签、状态、移动、删除、BibTeX 导出 |
| `paper-reader-actions.ts` | 打开论文（复用 `openPaperUnit`）、位置记忆、状态自动变更 |
| `paper-marks-store.ts`、`use-paper-marks.ts` | 标注加载、防抖保存、外部变更合并 |
| `paper-translate-actions.ts` | 划词翻译、整篇翻译 |
| `paper-conversation-scope.ts` | `paperConversationResourcePath()`；论文上下文引用 |
| `paper-discover-actions.ts` | 拉列表、入库、预览 Kimi 笔记 |
| `src/renderer/src/write/write-workspace-surface-actions.ts` | `workSurface`、`setWorkSurface`（同时设置布局 key 用的模块级表面，见 D2） |

组件放新目录 `src/renderer/src/components/paper/`：

| 组件 | 说明 |
|---|---|
| `PaperModeToggle.tsx` | 开关行，两个侧栏共用 |
| `PaperSidebar.tsx`，`sidebar/` 下的 `PaperLibrarySection.tsx`、`PaperDiscoverSection.tsx`、`PaperFilesSection.tsx`、`PaperLibrarySwitcher.tsx` | §3.3 |
| `PaperWorkspaceView.tsx` | 视图路由：引导 / 论文库 / 阅读 / 发现 |
| `onboarding/PaperLibraryOnboarding.tsx` | §3.4.1 |
| `library/` 下的 `PaperLibraryTable.tsx`、`PaperLibraryToolbar.tsx`、`PaperRowMenu.tsx`、`PaperBulkBar.tsx`、`PaperMetaEditDialog.tsx`、`PaperTagEditor.tsx`、`PaperPdfDropSurface.tsx` | §3.4.2 |
| `reader/` 下的 `PaperPdfReader.tsx`、`PaperHighlightLayer.tsx`、`PaperSelectionMenu.tsx`、`PaperTranslateCard.tsx`、`PaperReaderDrawer.tsx`（目录、图表、参考、批注四个面板各一个文件）、`PaperReaderBottomBar.tsx` | §3.4.3 |
| `discover/` 下的 `PaperDiscoverView.tsx`、`ArxivTodayView.tsx`、`PaperFeedsView.tsx`、`CoolVenueView.tsx`、`DiscoverPaperCard.tsx` | §3.4.4 |
| `import/` 下的 `PaperImportDialog.tsx`、`PaperSearchCandidates.tsx` | PM4，替换 `WritePaperImportDialog` |

已有组件的去向：`WritePaperBar` 升级后移到 `components/paper/reader/`；`WritePaperSidebarSection` 删除；`WritePaperStrip` 在日常表面只剩「在论文模式中打开」这一行。

### 6.6 kun 与 skills

- `resources/bundled-skills/paper-reader/SKILL.md`：补充 `marks/annotations.json`（用户高亮是重点信号）和 `references.json` 的读法。
- 新增内置 skill `paper-library`：文献库目录结构；在 `notes/` 里写对比和综述；引用写成 `[@citeKey]`，文末列参考文献。触发词：「论文库」「综述」「related work」「对比这几篇」。
- 本期不加 kun 工具，Agent 用现有文件工具读文献库。`paper_import`、`paper_library_search` 放 PM6，按 `design_apply_excalidraw` 的渲染端路由模式实现。

---

## 7. 分阶段实施

每个阶段结束都要过：`npm run typecheck`、相关 `npm run test`、`npm run lint`、`npm run check:file-lines`；动到 `kun/` 时加 `npm run build:kun`。每个阶段同步更新 7 种语言的文案（`src/renderer/src/locales/*/common/paper.json`）和用户文档 `docs/work-paper-reading.{zh-CN,en}.md`。

合计约 20 人日（不含 PM6）。PM1+PM2 可以合成「论文模式 v1」先发布，PM3、PM4、PM5 各自可以单独发布。

### PM0 准备（1 天）

- 按 §6.2 做纯重构抽取：`KunGuiPaperApi` 组合类型；`WritePdfViewer` 的两个 hook；`WriteWorkspaceView` 的论文接线 hook；`one-shot-model-request.ts`（`prompt-optimization-service` 行为不变，原有测试全绿）。
- Spike（不合入）：把同一个文件夹同时设为办公空间和文献库，来回切换 10 次。验证：脏文档不丢；两边标签页各自恢复；线程不串。结论补进本文 §10。
- 验收：现有测试全部通过；`check:file-lines` 通过。

### PM1 开关、文献库、侧栏（3 天）

- 设置 `write.paperMode`：先做 `enabled`、`libraries`、`activeLibrary`、`autoMarkReading`，四处接线，round-trip 测试。
- `workSurface` 和命名空间布局 key；`loadWriteSettings` 按表面选根目录。
- `PaperModeToggle`；`PaperSidebar`（文献库区先只有「全部论文」和现有平铺列表，加「文件」「白板」）；`PaperWorkspaceView`（引导 / 论文库占位 / 阅读）。
- `WorkbenchLeftSidebar`、`WorkbenchStageRouter` 加分支。
- 引导页三种方式；`paperDetectLibraries` IPC。
- 日常 Work 清理：删论文分区；起始页卡改成「打开论文模式」；文件树改成「加入论文库」；日常表面的论文条改成一行提示。
- 每篇论文一个对话（§3.5 的四个调用点）。
- 命令面板两条命令；快捷键注册。
- 验收：
  - 开关在「Work ˅」下、「新建文件」上；Code 和 Rooms 不显示。
  - 打开后：没有文献库时显示引导页，有文献库时显示论文库；关闭后日常标签页原样恢复；重启保持上次的模式。
  - 有未保存文档时切换：内容被保存，或者切换被拦下并提示，都不能丢内容。
  - 日常侧栏不再出现「论文」。
  - 同一篇论文的 PDF 和 NOTES 共用一个对话；换一篇论文就换对话。

### PM2 论文库（3 天）

- `paper-meta-v2.ts` 和读写升级；`paper-library-service`（递归扫描、增量索引、监听）；本机状态存储。
- 论文库表格、工具栏、排序、搜索、列设置、虚拟滚动、多选、右键菜单、批量操作条。
- 标签编辑、状态、评分、元数据编辑（DOI / arXiv 旁的「刷新」按钮重新拉元数据，只填进表单，保存才写）。
- 侧栏计数、状态行、标签列表、分组（新建、重命名、拖入移动）。
- 删除进系统废纸篓，并关闭相关标签页。
- BibTeX：`paper-bibtex.ts`；单篇复制、选中导出、全库导出（默认存到 `<library>/references.bib`，保存对话框里可改）。
- 验收：
  - 用脚本生成 500 个假 `paper.json`：首次加载 <1s，滚动不卡，搜索从输入到出结果 <100ms。
  - 改标签或状态后，`paper.json` 只变这些字段，其他键的顺序和内容不变；没改过的 v1 文件不会被重写。
  - 论文移动到分组后，已打开的 PDF / NOTES 标签页路径跟着更新。`renameEntry` 只能改名、不能换父目录，所以移动走新的 `paperMoveToGroup` IPC；把 `renameEntry` 里按路径前缀重映射标签页和文档的那段逻辑抽成 helper，两边共用。
  - 导出的 `.bib` 能被测试里的解析器 round-trip，`citeKey` 不重复。

### PM3 阅读器（5 天）

- `PaperPdfReader`：复用 `WritePdfPage`，加高亮层、左侧抽屉（目录、图表、批注；参考文献先留位置）、底栏（纸色、位置记忆）。
- `PaperSelectionMenu`：高亮、批注、翻译、解释、加入对话；`marks/` 读写和外部变更合并。
- 翻译：`paper-translate-service` 的划词翻译和结果卡（复制、保存为批注）；设置里的翻译模型。
- 导出批注到 NOTES：幂等追加，复用 `paper-notes-append.ts`；每条带 `[p.N](<pdf>#page=N)` 链接。
- 论文条升级：「← 论文库」、状态、标签、BibTeX；首次打开自动改「在读」；解读完成后提示「标为已读」。
- 助手的论文上下文 chip；`paper-reader` skill 补充 marks 说明；`AGENTS.md` 模型请求消费方清单加上 `paper-translate-service`。
- 验收：
  - 在 50%–300% 缩放下和重新打开后，高亮位置不漂；双栏论文的跨栏选区画成多段矩形。
  - 外部（Agent）修改 `annotations.json` 后 1s 内出现在阅读器，本地未保存的高亮不丢。
  - 划词翻译：选区上限 2000 字符；公式和引用编号原样保留；失败时卡片显示原因，不吞错误。
  - 重新打开论文时回到上次的页。

### PM4 入库增强（3 天）

- 导入对话框 v2：多行粘贴，每行单独显示状态。按行识别 arXiv、DOI、papers.cool、其他 URL（抓页面的 `citation_*` meta，取 `citation_pdf_url`），识别不了的当标题搜索。
- 标题搜索：S2 和 arXiv 并行，5s 预算，最多 3 个候选（标题、作者·年份·会议、徽标、被引数）；选中后走正常导入；多个标题排队逐个弹出。
- DOI 导入：Crossref 取元数据；有 arXiv 关联就下载 arXiv PDF，否则建「只有元数据」的单元。
- 本地 PDF 识别（`paper-identify-service`）：识别到 id 就自动补全元数据；不确定时置 `needsReview`。
- 拖放 PDF 到论文库表格或侧栏分组。
- BibTeX 导入：每个条目建一个单元；有 arXiv / DOI 的可以勾选「同时下载 PDF」。
- 去重顺序：arXiv id → DOI → 规范化标题加年份。命中已有单元时：缺 PDF 就补进去，否则提示「已在库中」。
- 队列：并发 2，arXiv 的请求间隔由 `arxiv-client` 的 `ARXIV_EXPORT_API_MIN_GAP_MS` 保证；可以整体取消。
- 验收：粘贴 10 行混合输入，每行都有结果（成功 / 已存在 / 失败原因）；取消后不再发请求；带 DOI 的本地 PDF 样例能自动补全元数据。

### PM5 参考文献、整篇翻译、发现（5 天）

- 参考文献：`paper-references-service` 加抽屉里的「参考文献」面板：过滤、徽标、已入库的直接打开、未入库的导入（单条或勾选批量）；第二个 tab「被引」（S2 citations）。
- 整篇翻译：确认框显示字数和预估 token；按页分块顺序翻译，显示进度，可取消；输出 `<slug>-译文.md`，保留 `<!-- page N -->` 和标题层级；命中缓存的块不重复请求；完成后在右组打开。
- 发现：
  - arXiv 今日：分类 RSS、按天缓存、BM25 相关度、入库、Kimi 笔记预览。
  - 订阅：增删改、条目缓存、入库或打开原文。
  - 会议论文：papers.cool 会议列表解析、入库。
- 验收：
  - 带 `.bbl` 的 arXiv 论文断网也能出参考文献；已入库的条目标「已在库中」。
  - 整篇翻译中途取消后再点继续，只翻剩下的块。
  - arXiv 今日同一天第二次打开不发网络请求；库是空的时按公告顺序排，并提示「导入论文后可以按相关度排序」。
  - 订阅源返回 HTML 或超过 5MB 时给出明确错误。

### PM6 可选扩展（按需排期）

| 项 | 说明 |
|---|---|
| 多篇对比、写相关工作 | 论文库多选 → 对话带上这些论文的 `paper.md`、NOTES、高亮 → 输出到 `notes/`，引用写 `[@citeKey]` |
| 在日常 Work 文档里引用 | 编辑器里用 `@` 选库中论文，插入 `[@citeKey]`，同步工作区的 `references.bib` |
| kun 工具 | `paper_library_search`、`paper_import`，渲染端路由 |
| 框选批注 | 区域裁剪存 `marks/assets/`，可发给有视觉能力的模型 |
| 文中引用 hover 预览 | pdf.js Link annotation 加 `references.json` |
| 找引用本库论文的新论文 | 用 S2 citations 扫全库，候选勾选入库 |
| Cool Papers 内嵌浏览 | `<webview>` 独立分区，只放行 `papers.cool`，受控注入脚本；需要安全评审 |
| embedding 推荐 | OpenAI 兼容 `/embeddings`，向量缓存在 userData |
| Zotero 迁移 | 读 `zotero.sqlite` 和 `storage/` |
| research-paper-writing skill | MIT 许可，连同 LICENSE 移植到 `resources/bundled-skills/` |

---

## 8. 外部接口与限速

| 来源 | 用途 | 接口 | 限速和注意事项 |
|---|---|---|---|
| arXiv export API | 元数据、标题搜索 | `export.arxiv.org/api/query` | 间隔 ≥3.1s（已有 `ARXIV_EXPORT_API_MIN_GAP_MS`） |
| arXiv RSS | 今日列表 | `rss.arxiv.org/rss/<cat>` | 每个分类每天自动拉 1 次，手动刷新另算 |
| Semantic Scholar | 标题搜索、references、citations | `api.semanticscholar.org/graph/v1/...` | 没有 key 时共享池 1 req/s，遇到 429 退避；可以填 key |
| Crossref | DOI 元数据、reference | `api.crossref.org/works/<doi>` | 带 UA 和可选的 `mailto` |
| papers.cool | Kimi 笔记（已有）、会议列表 | `papers.cool/venue/<V>.<Y>` | 全局串行（已有队列），只在用户操作时请求 |
| 出版商页面 | `citation_*` meta | 任意 https | 只 GET，≤5MB，PDF 校验 `%PDF-` 魔数 |
| 用户订阅源 | RSS / Atom / JSON Feed | 任意 https | 只 GET，≤5MB，不带 cookie，条目 HTML 只取纯文本 |

所有请求日志只记 host、状态码、耗时和 body 摘要，不记 API key。

---

## 9. 测试与验证

单测（vitest）：

- 设置：`write.paperMode` 的 normalize、merge、patch schema round-trip。
- `paper.json`：v1 升 v2；v1 没改过不回写；strict 拒绝未知键。
- `paper-library-query`：中英文搜索、全半角、缺失值排序、计数。
- `paper-bibtex`：各类型导出、特殊字符转义、`citeKey` 冲突、解析 round-trip。
- marks：按 id 合并、并发写不丢、坐标归一化。
- 解析器 fixture：arXiv RSS、Atom、JSON Feed、S2 search / references、Crossref works、papers.cool 会议页、`citation_*` meta。
- BM25：固定语料下排序稳定。
- 布局 key：日常表面沿用旧 key，论文表面带命名空间。
- 对话作用域：论文单元里的文件映射到论文目录。

集成：IPC handler 的路径校验（`unitDir` 越界、符号链接）、`shell.trashItem` 调用、`paper-http` 白名单。

手动走查（`npm run dev`；也可以像之前那样用临时 Vite harness 页单独验证组件，结束后删掉）：

1. 开关切换，重启后保持；
2. 引导页三种方式；
3. 导入 arXiv / DOI / 标题 / 本地 PDF / BibTeX；
4. 论文库搜索、排序、标签、拖进分组；
5. 高亮、批注、划词翻译、导出到 NOTES；
6. 从参考文献导入；
7. 从 arXiv 今日入库；
8. 回到日常 Work，标签页完整。

发布前：`npm run build`，并用打包后的 App 再走一遍 1–8。

---

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| 切换表面时丢失未保存内容 | 切换前统一 `saveAllDocuments`，失败就不切并提示；PM0 spike 专门测 |
| 同一文件夹在两种模式下互相干扰 | 布局 key 按表面区分；线程资源 key 不同；日常表面不渲染论文 UI |
| 旧版本读不了 `paper.json` v2 | 发布说明写明；v1 没改过不回写，缩小影响面 |
| 大库性能 | 主进程索引加增量更新；表格虚拟滚动；侧栏计数由索引计算，不逐个读文件 |
| 高亮位置漂移（pdf.js 升级、字体差异） | 同时存归一化矩形和原文 `quote`；矩形失效时用原文在该页文字层重新定位 |
| 翻译费用 | 划词翻译默认手动触发；整篇翻译先确认并显示预估；分块缓存 |
| 外部接口限流或使用条款 | 只在用户操作时请求；按来源限速；429 退避；可以填 key；本地缓存 |
| 订阅源里的恶意内容 | 只取纯文本，不渲染 HTML；限制体积；不自动打开链接 |
| 推荐需要外发数据 | 默认本地词法排序；embedding 需要用户显式开启，并提示会外发摘要 |
| 700 行门禁 | 新目录；§6.2 预算表；每个阶段都跑 `check:file-lines` |
| 新的模型消费方和现有端点约定不一致 | 统一走 `one-shot-model-request.ts`；三种 endpointFormat 都有测试 |
| 老用户已经在日常 Work 里导入过论文 | 引导页「使用已有办公空间」；日常文件树里原文件照常可见，不会丢 |

---

## 11. 待确认（不阻塞 PM0/PM1，先按默认值做）

1. 开关样式：整行开关（默认），还是「日常 | 论文」分段控件。
2. 默认文献库位置：`<Documents>/Kun Papers`（默认），还是 `~/.kun/paper_library`（和日常默认空间 `~/.kun/write_workspace` 对齐，但在访达里是隐藏目录）。
3. 首次打开论文自动改成「在读」：默认开。
4. 解读完成后是否自动标为已读：默认只提示，不自动改。
5. arXiv 今日的默认分类：`cs.CL`、`cs.AI`、`cs.LG`、`cs.SE`。
