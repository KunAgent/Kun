# Work 论文模式：剩余工作计划（交接文档）

> 日期：2026-09-25。前序：`docs/work-paper-mode-plan.zh-CN.md`（总体设计）。
> 参考：Agentero（`/Users/zxy/codeproject/ds_project/Agentero`，commit `35e154c1`），尤其是 `docs/usage/read-and-organize.md`、`docs/frontend/pdf.md`、`docs/frontend/library.md`、`docs/development/plaza*.md`、`docs/backend/citation-parsing.md`。
> 读者：接手继续实现的人或 Agent。先读 §0、§1，再按 §3 的顺序做。

---

## 0. 当前状态

### 0.1 代码位置

| 项 | 值 |
|---|---|
| worktree | `/Users/zxy/codeproject/ds_project/DeepSeek-GUI-paper-polish` |
| 分支 | `codex/paper-mode-polish`，基于本地 `develop` @ `5cd0a2848` |
| 依赖 | `node_modules`、`kun/node_modules` 是指向主仓库的软链接（已被 gitignore） |
| 已提交 | `6005225cc fix(paper): close paper-mode review findings` |
| 未提交 | 见 §0.3（类型检查已通过，需提交） |

### 0.2 已完成（`6005225cc`，上次审查的 10 条）

1. 切换论文时 flush 待保存标注（`use-paper-marks.ts` 的 `flushPaperMarks`）。
2. 翻译选了别的供应商时不再借用运行时供应商的 key/model/baseUrl（`paper-translate-service.ts`）。
3. 论文提示统一由 `components/paper/PaperNoticeToast.tsx` 渲染，挂在 `WorkbenchStageRouter` 的 Work 分支，两个表面都可见；论文条里的内联提示已删。
4. 本机阅读状态读写统一用 `canonicalPath`（`register-app-paper-library-ipc-handlers.ts` 的 `libraryStateKey`）。
5. `loadWriteSettings`：切换表面前先 `prepareActiveWriteFileForNavigation`，用户拒绝则回滚 `paperMode.enabled`；加载中的调用排队共享一次后续加载（`write-workspace-settings-actions.ts`）。
6. 移到废纸篓前关闭该论文已打开的标签页、报告失败（`paper/paper-unit-ops.ts`）。
7. 废纸篓 / 移动分组 IPC 只接受真正的论文单元（有 `paper.json`，且不是库根）。
8. 开关统一在「Work ˅」正下方，远程手机端隐藏（`PaperModeToggle.tsx`、`WriteSidebar.tsx`）。
9. 快捷键先切到 Work 路由再切论文模式（`paper-mode-actions.ts` 的 `runPaperModeShortcut`）。
10. 分组内论文（`papers/<group>/<id>`）能被论文条和对话作用域识别（`paper-mode-store.setEntriesResult` → `usePaperStore.rememberUnits`）。

### 0.3 已写完但未提交（worktree 工作区）

| 功能 | 文件 |
|---|---|
| 阅读器抽屉「图表」tab | `components/paper/reader/PaperFiguresPane.tsx`，接入 `PaperReaderDrawer.tsx` |
| 论文库行菜单（右键 / ⋯） | `components/paper/library/PaperRowMenu.tsx` |
| 元数据编辑（标题/作者/年份/会议/DOI/arXiv/摘要/标签/状态/评分，DOI 刷新只填表单） | `components/paper/library/PaperMetaEditDialog.tsx` |
| 移动到分组（选已有 / 输入新名，重开已打开标签） | `components/paper/library/PaperMoveGroupDialog.tsx`、`paper/paper-unit-ops.ts` |
| 行操作（改元数据、复制 BibTeX、访达显示、补 PDF） | `paper/paper-library-row-actions.ts` |
| 表格新增「进度」「添加时间」列，标题 KaTeX 渲染 | `PaperLibraryView.tsx`、`components/paper/PaperTitleText.tsx`（+test） |
| 补下载缺失 PDF（arXiv id → `pdfUrl`） | `main/services/paper/paper-pdf-backfill.ts`，IPC `paper-library:download-pdf`（schema `paper-library.ts`、类型 `PaperDownloadPdfResult`、preload `paper-api.ts`、API `PaperLibraryApi.paperDownloadPdf`） |
| 多选「对比阅读」「写相关工作」 | `paper/paper-multi-prompt.ts`（+test），`PaperLibraryView` 批量条，`PaperWorkspaceView` 传 `onSubmitPrompt` |
| 内置 skill `paper-library` | `resources/bundled-skills/paper-library/`；`scripts/check-bundled-skills.mjs` 的 `expectedCount` 37 → 38 |
| 7 种语言文案 | `src/renderer/src/locales/*/common/paper.json`（键按字母排序） |

### 0.4 基线失败（develop 上本来就失败，不是论文模式造成）

- `npx tsc -p tsconfig.web.json`：`src/renderer/src/components/rooms/AgentModelSettings.tsx(34,…)` 两条类型错误。
- vitest 7 条：`src/shared/model-provider-presets.test.ts`、`src/renderer/src/locales/i18n-usage.test.ts`（rooms 文案键缺失）、`src/renderer/src/locales/locale-resources.test.ts`（ja/ko/ru/th/hi 的 settings 命名空间缺 provider 相关键）。
- `npm run check:file-lines`：`docs/remote-mobile-ui-layout-plan.zh-CN.md`、`register-app-file-ipc-handlers.ts`、`kun-runtime-services.ts`、`chat-store-navigation-workspace-actions.ts` 超 700 行。

判断新改动是否引入失败：同一命令在主仓库 develop 上对比跑一次。

---

## 1. 收尾：提交、合并、删 worktree（先做）

```bash
cd /Users/zxy/codeproject/ds_project/DeepSeek-GUI-paper-polish
npx tsc --noEmit -p tsconfig.web.json   # 只允许 §0.4 的基线错误
npx tsc --noEmit -p tsconfig.node.json
npx vitest run src/renderer/src/paper src/renderer/src/components/paper src/renderer/src/write src/main/services/paper src/shared/paper
npx eslint $(git diff --name-only HEAD | grep -E '\.(ts|tsx)$') $(git ls-files --others --exclude-standard | grep -E '\.(ts|tsx)$')
npm run build:kun && node scripts/check-bundled-skills.mjs   # 验证新 skill，期望 38
git add -A && git commit -m "feat(paper): library menus, metadata editor, groups, figures, pdf backfill, multi-paper tasks"
```

合并回本地 develop：

```bash
cd /Users/zxy/codeproject/ds_project/DeepSeek-GUI
git status --short          # 暂存区里的 docs/ade/* 属于别的会话，不要动、不要提交进合并
git merge --no-ff codex/paper-mode-polish
```

冲突处理原则：
- 以 develop 的新改动为主，把本分支的论文相关改动叠上去；冲突文件改完跑对应测试。
- `src/renderer/src/locales/*/common/paper.json`：两边都加键时合并键集合，保持字母序（可用 `python3` 读 JSON、`sorted` 后写回，`indent=2`、`ensure_ascii=False`、末尾换行）。
- `scripts/check-bundled-skills.mjs`：`expectedCount` 取两边新增 skill 后的实际目录数。

删除 worktree：

```bash
rm /Users/zxy/codeproject/ds_project/DeepSeek-GUI-paper-polish/node_modules \
   /Users/zxy/codeproject/ds_project/DeepSeek-GUI-paper-polish/kun/node_modules
git worktree remove /Users/zxy/codeproject/ds_project/DeepSeek-GUI-paper-polish
git branch -d codex/paper-mode-polish
```

之后的工作直接在 develop 上开新分支（`codex/paper-mode-<主题>`）或新 worktree。

---

## 2. 通用约定（每项都要遵守）

- **700 行门禁**：新逻辑放新文件。临界文件只加接线：`src/preload/index.ts`（700，禁止改，桥接加到 `src/preload/paper-api.ts`）、`src/shared/kun-gui-api-surface.ts`（697，禁止改，类型加到 `src/shared/paper/kun-gui-api-paper.ts`）、`WriteSidebar.tsx`、`WriteWorkspaceView.tsx`、`settings-section-write.tsx`、`chat-store-thread-send.ts`、`quoted-selection.ts`、`write-workspace-store.ts`。`PaperLibraryView.tsx` 已 ~600 行，新增 UI 放 `components/paper/library/`。
- **新 IPC 四件套**：`src/main/ipc/app-ipc-schemas/paper-*.ts`（zod `.strict()`）→ handler（`register-app-paper-library-ipc-handlers.ts` 或 `register-app-paper-reader-ipc-handlers.ts`，开头 `assertTrustedWorkbenchSender` + `parseIpcPayload`，路径用 `canonicalPath` + `resolveTargetPathWithinWorkspace`，涉及单元的先 `readPaperUnitMetaV2` 校验）→ `src/preload/paper-api.ts` → `src/shared/paper/kun-gui-api-paper.ts`。
- **设置字段**：改 `write.paperMode` 要同时改 `app-settings-types-paper-mode.ts`、`app-settings-paper-mode.ts`（normalize/merge）、`src/main/ipc/app-ipc-schemas/settings-paper-mode.ts`，并补 round-trip 测试（`app-settings-paper-mode.test.ts`）。
- **文案**：7 种语言（en/zh/ja/ko/ru/th/hi）同时加，`common/paper.json` 键保持字母序。
- **提示**：用户可见的结果/错误用 `usePaperStore.getState().setNotice(...)`，由 `PaperNoticeToast` 显示；不要吞错误。
- **源码不写参考产品名**（文件名、类名、注释、文案都不出现 Agentero）；只有真正移植的代码按 MIT 在文件头保留来源。
- **外部请求**只在用户操作时发，走 `paper-http.ts`；新主机加进白名单或用只读 `allowAnyHost`。
- **UI 验证**：`npm run dev` 手动走查；或建临时 Vite harness 页验证组件，结束后删除。
- 每项完成跑：相关 vitest、`tsc`（web + node）、eslint、`npm run check:file-lines`。

---

## 3. 剩余工作（按优先级）

### P1-1 侧栏分组管理（1 天）

**现状**：分组只能在「移动到分组」对话框里输入新名称隐式创建；侧栏分组是一个下拉筛选（`PaperSidebar.tsx` ~L380）。
**目标**（对应 Agentero 的组织文件夹）：
- 侧栏「分组」改成可展开的列表：每行显示分组名和论文数，点击 = 按该分组过滤（`filter.group`）。
- 分组行右键：新建子分组、重命名、删除（仅空分组）。
- 论文库行可拖到分组行上（多选时拖整组）→ 调 `movePaperUnitsToGroup`。
- 外部 PDF 拖到分组行 → 导入到该分组（`paperImport` 的 `parentDir` = `<papersDir>/<group>`）。

**实现**：
- 新 IPC `paper-library:create-group` / `rename-group` / `delete-group`（只允许 `<papersDir>` 内、非论文单元目录；删除要求目录为空或只有空子目录）。`listPaperGroups` 已在 `paper-library-service.ts`。
- 重命名分组时，该分组下已打开的标签：复用 `paper-unit-ops.ts` 的「记录 → 关闭 → 移动 → 重开」模式，抽成 `reopenTabsUnder(prefixBefore, prefixAfter)`。
- 组件：`components/paper/sidebar/PaperGroupList.tsx`（新），`PaperSidebar.tsx` 只替换下拉那段。
- 分组计数：`paper-library:list` 已返回 `groups`，计数在渲染端按 `entry.group` 前缀统计（子分组计入父分组）。

**验收**：新建 `nlp/agents` 后出现在树里；拖 3 篇论文进去，已打开的 PDF/NOTES 标签路径更新；重命名后过滤和标签仍正确；非空分组不能删。

### P1-2 论文库表格完善（1.5 天）

- **列设置**：表头右键选择显示哪些列、拖动排序；按文献库存 localStorage（key `kun.paper.library.columns:<libraryRoot>`，读写包 try/catch）。标题列不可隐藏。
- **虚拟滚动**：`@tanstack/react-virtual`（已是依赖），行高固定 ~52px；500+ 篇时启用。验收：用脚本生成 1000 个假 `paper.json`，滚动流畅、搜索 <100ms。
- **筛选**：工具栏加「标签 / 年份 / 来源」下拉（`PaperLibraryFilter` 已有 `tag/year/source` 字段，`paper-library-filter.ts` 已支持），和侧栏过滤同步。
- **行内编辑**：状态 chip 点击循环切换；标签 chip 旁「+」快速加标签（调 `updatePaperEntryMeta`）。
- **标签颜色**：按标签名哈希到 8 色（不存盘），`src/renderer/src/paper/paper-tag-color.ts`。
- **单击/双击**：单击选中并在右侧显示「论文信息」小卡（标题、作者、摘要、外链、操作按钮），双击或回车打开阅读。若嫌改动大，保持单击打开。

### P1-3 阅读器高亮交互（2 天）

对应 Agentero `docs/frontend/pdf.md`「划词菜单」「批注」。
- 点击已有高亮 → 浮动小菜单：换颜色（4 色）、编辑批注、复制原文、加入对话、删除。组件 `reader/PaperHighlightPopover.tsx`；数据走 `paper-marks-store`（`upsertPaperHighlight` / `setPaperHighlightComment` / `removePaperHighlight`）。
- 带批注的高亮在页右侧显示批注卡（窄屏回退成页边小图标）；卡片 hover 时原文高亮加深。组件 `reader/PaperCommentGutter.tsx`，挂在 `PaperPageMarksLayer.tsx` 旁。
- 「加入对话」：把高亮原文 + 页码作为选区引用发到助手（复用 `quoteSelectionToAssistant` 的格式 `Selected text from <pdf> (page N)`）。
- 验收：缩放 50%–300% 卡片位置正确；删除后刷新不再出现；Agent 写入的高亮也能点开编辑。

### P1-4 标注外部变更实时刷新（0.5 天）

**现状**：`use-paper-marks.ts` 只在窗口 `focus` 时重读。
**做法**：用现有工作区文件监听（`src/main/services/workspace-file-watcher.ts` 与渲染端 `use-write-editor-group-file-watches.ts` 的机制）订阅 `<unit>/marks/annotations.json`；变更且本地不 dirty 时重读，dirty 时合并（`mergePaperHighlights`）。跳过自己写入产生的回声（记录最近一次写入的 mtime/内容哈希）。
**验收**：Agent 在对话里追加一条高亮，1 秒内出现在阅读器；本地未保存的高亮不丢。

### P1-5 阅读布局预设（0.5 天）

阅读器工具栏加布局菜单：
- 「阅读」：只显示 PDF（关右侧 NOTES 组、收起助手）。
- 「笔记」：PDF + NOTES（默认）。
- 「助手」：PDF + 助手面板（关 NOTES 组，`setAssistantOpen(true)`）。
用 `splitEditorGroup` / `closeEditorGroup` / `setSplitRatio`（`write-editor-group-actions.ts`）。记住最近一次选择（localStorage）。

### P1-6 BibTeX 导出改保存对话框（0.5 天）

**现状**：`PaperLibraryView.exportBibtex` 写到库根 `library-<日期>.bib`。
**做法**：主进程新增 `paper-library:save-bibtex`，用 `dialog.showSaveDialog`，默认 `<libraryRoot>/references.bib`；有选中时只导出选中的（`paperExportBibtex` 支持单篇，批量需加 `unitDirs: string[]` 参数）。批量条加「导出 BibTeX」。

### P1-7 文档与清单（0.5 天）

- `AGENTS.md`「Providers And Model Requests」的消费方清单加 `src/main/services/paper/paper-translate-service.ts` 和 `src/main/services/one-shot-model-request.ts`。
- 更新用户文档 `docs/work-paper-reading.zh-CN.md` / `.en.md`：论文模式开关、文献库、论文库操作、阅读器、发现、多篇任务、补 PDF。

---

### P2-1 PDF 内引用悬停与跳转（2 天）

对应 Agentero `docs/backend/citation-parsing.md` §4。
- pdf.js 读取每页 `getAnnotations()` 的 Link 注释：内部跳转（`dest`）点击跳页；URI 用系统浏览器打开（`window.kunGui` 现有打开外链接口）。
- 引用悬停：对 `cite.*` 命名目标或编号引用（`[12]`、`[3, 7]`、`14-18` 展开），匹配 `references.json` 的第 n 条，显示卡片（标题、作者·年份·会议、已入库/导入按钮）。匹配不上就只保留跳转。
- 图表交叉引用（`Fig. 3`、`Table 1`）悬停：用 `figures/index.json` 显示缩略图。
- 组件 `reader/PaperLinkLayer.tsx`、`reader/PaperCitationCard.tsx`；解析逻辑放 `paper/pdf-link-index.ts`（纯函数 + 测试）。
- 拖选文本时不弹卡片；与划词菜单互斥。

### P2-2 框选区域批注（1.5 天）

- 工具栏按钮或 `⌘.` 进入框选；在页面上拖出矩形 → 用 pdf.js 按区域渲染截图（最长边 1600px）→ 存 `marks/assets/<id>.png`，mark 写 `marks/<id>.json`（`kind: 'visual'`，含 page、归一化 rect、comment、image.path）。
- 需要在 `paper-marks-types.ts` 增加 visual schema，`paper-marks-service.ts` 支持写图片（新 IPC 传 base64，校验 PNG 魔数和大小）。
- 批注卡上「加入对话」把图片作为附件发给助手（沿用现有图片附件通道）。模型不支持视觉时只发备注和页码。

### P2-3 译文对照视图（1 天）

**现状**：整篇翻译输出 `<slug>-译文.md`（按页 `<!-- page N -->`）。
**做法**：阅读器加「对照」开关：右组打开译文 md，并按 PDF 当前页滚动到译文对应的 `page N` 标记（反向亦可）。页码映射从 md 里的标记解析；滚动同步用节流。

### P2-4 谁引用了本库论文（1 天）

- 论文库工具栏「发现引用本库的新论文」：对每篇有 arXiv/DOI 的论文调 S2 citations（已有 `scholar-client.ts`），限速 1 req/s，可取消、显示进度。
- 汇总去重后排除已入库的，按引用本库论文的数量排序，展示候选列表（勾选入库）。结果缓存到 `<userData>/paper-discover/citing-<libraryHash>.json`。

### P2-5 推荐排序可选 embedding（1 天）

- 设置 `discover.rankMode = 'embedding'` 时，用 `discover.embedding`（OpenAI 兼容 `POST {baseUrl}/embeddings`）给库内摘要和候选摘要算向量；向量缓存到 `<userData>/paper-discover/embed-<model>.json`（key = sha256(title+abstract)）。
- 打分：余弦相似度，库内语料按加入时间加权（越新越高）。
- 设置页开启时明确提示「摘要会发送到该端点」。未配置时回落 BM25（`src/shared/paper/paper-recommend.ts`）。

### P2-6 订阅 OPML 导入导出（0.5 天）

发现页订阅列表加「导入 OPML / 导出 OPML」；解析 `<outline xmlUrl>`，去重后写入 `discover.feeds`（受 `PAPER_MODE_MAX_FEEDS` 限制）。

### P2-7 阅读热力条（1 天）

论文库行标题左侧的小条：按 `marks/annotations.json` 每页高亮数 + 本机 `lastPage/pageCount` 聚合。主进程新 IPC `paper-library:reading-activity`（批量读取所有单元的 marks，只返回每页计数），避免渲染端逐篇读。

### P2-8 查重与合并（1 天）

- 主进程扫描：arXiv id → DOI → 规范化标题+年份 相同的单元。
- 论文库「查重」入口展示重复组，选择保留哪一个；合并时把另一方的 NOTES 追加进来、marks 合并、PDF 缺的补上，另一方进废纸篓。

---

### P3-1 应用内浏览 Cool Papers / ModelScope（2–3 天，需安全评审）

参考 Agentero `docs/development/plaza.md` §3.2/§3.5。Kun 的 webview 安全策略（`src/main/extensions/extension-webview-security.ts`）只放行扩展、dev-preview、授权原型文件，并删除非扩展 webview 的 preload。要做需：
- 新增受控类别：独立分区 `persist:kun-paper-browse`，`will-navigate` 只放行 `papers.cool` / `modelscope.cn/papers*`，其它链接用系统浏览器打开，禁弹窗。
- 页面注入「入库」按钮：由主进程在 `did-finish-load` 后 `executeJavaScript` 注入（不开 preload），通过 `console-message` 或受控 IPC 回传 `{branch, id, url, title}`，走现有 `paperImport`。
- 先写安全设计评审，再实现。

### P3-2 Zotero 迁移、RIS 导入（2 天）

- RIS：`src/shared/paper/paper-ris.ts` 解析，复用 `importPaperBibtex` 的建单元与去重逻辑（抽出公共 `importPaperRecords`）。
- Zotero：选择 Zotero 数据目录，只读打开 `zotero.sqlite`（需要 SQLite 依赖，先确认主进程是否已有可用的 sqlite 库；没有则放弃，改为引导用户从 Zotero 导出 BibTeX + 文件）。
- Connector（23119 端口）不做。

### P3-3 Agent 工具（1.5 天）

kun 工具 `paper_library_search`（按标题/标签/摘要搜索当前文献库）和 `paper_import`（导入 arXiv/DOI/URL）。按 `design_apply_excalidraw` 的渲染端路由模式实现（参考 `kun/src/adapters/tool/design-excalidraw-tool.ts` 与 `useWorkbenchExcalidrawRouter.ts`），渲染端调用 `window.kunGui.paperImport` / 读取 `usePaperModeStore.entries`。只在 Work 论文模式线程启用。改 `kun/` 后要 `npm run build:kun`。

### P3-4 日常 Work 文档引用论文（1.5 天）

- Work 编辑器输入 `@` 时增加「论文」分组，候选来自当前文献库（论文模式的 `activeLibrary`，即使在日常模式也可读 `paper-library:list`）。
- 选中插入 `[@citeKey]`；同时在当前办公空间维护 `references.bib`（追加缺失条目，已有 key 不覆盖）。

### P3-5 移植 research-paper-writing skill（0.5 天）

来源 `Agentero/templates/vault/.agents/skills/research-paper-writing/`（MIT，作者 Master-cai）。整目录复制到 `resources/bundled-skills/research-paper-writing/`，保留 LICENSE，补 `skill.json`（参考 `paper-library/skill.json`），更新 `check-bundled-skills.mjs` 的数量。检查 SKILL.md 里有没有依赖 Agentero CLI 的步骤，有则删掉。

### P3-6 远程手机端论文模式（待定）

目前开关在远程手机布局隐藏。若要支持：手机端只做「论文库列表 + 阅读 NOTES + 解读结果」，不做 PDF 标注。另行出计划。

---

## 4. 建议顺序

1. §1 收尾（必须先做）。
2. P1-7 文档清单（小，顺手）。
3. P1-1 → P1-2 → P1-6（论文库管理闭环）。
4. P1-3 → P1-4 → P1-5（阅读体验）。
5. P2-1、P2-3、P2-7（阅读增强），再 P2-4、P2-5、P2-6、P2-8（发现与整理）。
6. P3 按需。

每完成一组就在 develop 上提交一次（Angular 风格：`feat(paper): ...` / `fix(paper): ...`），提交信息写清楚做了什么和测试。
