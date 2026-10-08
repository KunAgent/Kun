# Work 助手 = Code 的 Agent + 当前文档

- 日期：2026-10-09
- 来源：用户反馈 Work 办公助手「输入框发送弹出窗口询问」「识别不了我的模型」「单独一套」，要求它和 Code 模式的 Agent 一样、可以切第三方 Agent，只多带当前查看的文档信息，工作目录是当前空间。
- 状态：已实现（本分支）。

## 1 问题

| 现象 | 原因 |
| --- | --- |
| 打开论文后，输入框发送弹出「按目的阅读」对话框 | `WriteAssistantPanel`、`WorkPaperHost` 把论文内的发送改道到 `openBoundedPaperReading`，再由 `PaperReadingDialog` 要求选目的、勾「发送给模型」、固定模型后才发送 |
| 「识别不了我的模型」 | 对话框读的是 Code 的 `composerModel/composerProviderId`，而 Work 输入框显示和发送的是 Work 专属的 `assistantModel`；两者不一致，`auto`、外部 Agent 或未固定的模型都被判定为「需要固定模型」，按钮不可用 |
| 单独一套、不能切第三方 Agent | Work 有自己的模型状态和发送路径；`sendMessage` 只在 `route === 'chat' / 'ade'` 时采用输入框的 Agent（`adeEligible`），Work 输入框也没有 Agent 菜单 |

## 2 设计

一句话：**Work 助手就是 Code 的 Agent，只是每轮带上当前空间里打开的东西。**

- **同一个选择**：Work 输入框读写 Code 的 `composerModel / composerProviderId / composerHarnessId / composerCredentialMode / composerGatewayBinding`、推理强度和权限（`composerExecutionSettings`）。每个会话仍按线程记住自己的选择，和 Code 一样。
- **同一个输入框**：`FloatingComposer` 新增 `agentSwitcher`，在 Work 助手面板和论文检索舞台打开 Code 的工具栏：`＋`（图片/文件）、Agent 菜单、权限、模型·推理。窄面板沿用 Code 输入框已有的容器查询（<640px 时工具栏分两行，权限收成图标）。
- **Agent 菜单**：`FloatingComposerAgentModePicker` 支持 `write` 表面：Kun 分组只有一项「Kun · Work」，其他 Agent 列表、就绪状态、切换确认与 Code 完全相同。
- **同一条发送路径**：`sendWritePrompt` 不再覆盖模型，改为 `sendMessage(…, { agentSurface: 'write', useComposerAgent: true, … })`；`sendFollowsComposerAgent(route, overrides)` 让 Work 助手的发送采用输入框的 Agent。Work 自己的 Kun 流程（批量解读、移动端）不带该标记，仍走 Kun。
- **工作目录**：会话线程的 `workspace` 就是当前空间（`createWriteThread(space)`）。从助手发送新建的会话会像 Code 新任务一样钉住所选外部 Agent（`workAssistantThreadRoute`）；Kun 会话保持原来的默认值。
- **文档上下文**（每轮，Agent 无关）：当前资源（`work-reference-resource`）、引用片段、检索片段、Office 摘录、白板快照，以及新增的 **当前论文**（`work-reference-paper`：标题、作者、年份、arXiv/DOI、`unitLocator`、`paper.md` 的 `textLocator`、`NOTES.md`、PDF、阅读器页码）。外部 Agent 运行时会把这些上下文拼进用户消息（ACP / Claude SDK / Cursor / Antigravity 都用 `userMessageTextWithComposerContexts`），Kun 工具（含 `paper_*`）经 Kun tool bridge 提供给外部 Agent。
- **外部 Agent 的边界**：计划模式是 Kun 流程，外部 Agent 发送一律为 `agent`；白板画布工具只属于 Kun，外部 Agent 不带 `guiDesignCanvas/guiExcalidrawCanvas`，但仍收到白板快照作为参考。Work 里隐藏「目标」菜单项（Work 草稿没有 Kun 线程可挂目标，原实现会新建 Code 任务）。
- **头部**：助手面板头像显示当前作答的 Agent（Kun 头像或外部 Agent 图标）。

## 3 论文入口：全部直接发送，不再弹窗

| 入口 | 之前 | 现在 |
| --- | --- | --- |
| 论文内输入框发送 / 编辑器快问 | 按目的阅读对话框 | 普通 Work 发送，论文作为上下文 |
| 阅读器选区「加入对话」 | 对话框 | 选区成为输入框引用（带页码），面板打开 |
| 阅读器选区快问 | 对话框 | 引用选区并立即发送问题 |
| 阅读器工具栏「阅读目的」 | 对话框 | 「按目的阅读 ▾」菜单，四个目的各一键发送 |
| 区域标注「加入对话」 | 只发批注文字的对话框 | 能看图的模型附上截图后发送，否则说明后发文字 |
| 文献库 / 行菜单「解读」 | 对话框 | 一键解读（生成 `-解读.md`，`interpretPaperWithAssistant`） |
| 多选「对比 / 相关工作」 | 综合对话框 | 直接发送多论文任务，写入 `notes/` |
| 批量解读 | 批量确认对话框 | 不变（批量后台任务需要选目的与范围） |

删除：`PaperReadingDialog`、`PaperSynthesisDialog`、`paper-reading-entry`、`usePaperReadingRequest` 及只服务于它们的文案。`paper-reading-request.ts` 只保留目的列表和批量解读的说明文本。

## 4 主要文件

- 选择与发送：`store/chat-store-send-composer-selection.ts`（`sendFollowsComposerAgent`）、`store/chat-store-thread-send.ts`、`components/workbench/useWorkbenchComposerSubmitController.ts`、`write/work-assistant-agent.ts`、`write/work-session-actions.ts`（`submitWorkAssistantPrompt`）、`store/chat-store-navigation-mode-actions.ts`（`createWriteThread` 的 `route`）。
- 输入框：`chat/FloatingComposer.tsx`、`chat/FloatingComposerSurfaceView.tsx`、`chat/FloatingComposerAgentModePicker.tsx`、`chat/floating-composer-policy.ts`。
- Work 面板：`write/WriteAssistantPanel.tsx`、`workbench/useWorkbenchShellRuntime.tsx`、`workbench/useWorkbenchComposerCapabilities.ts`、`paper/research/PaperResearchStage.tsx`、`PaperResearchComposer.tsx`。
- 论文：`write/write-paper-reference.ts`、`write/write-turn-reference-context.ts`、`paper/paper-assistant-ask.ts`、`components/paper/reader/PaperReadingPurposeMenu.tsx`、`use-paper-selection.ts`、`PaperVisualMarkCard.tsx`、`write/paper/paper-actions.ts`、`PaperLibraryView.tsx`、`use-paper-row-menu.tsx`、`WorkPaperHost.tsx`。

## 5 未做 / 后续

- Work 输入框的 `@` 文件引用（Code 的文件引用控制器绑定 Code 工作区，Work 目前依靠当前文档上下文）。
- 移动端 Work 助手与 SDD 助手仍使用 Work 专属模型（`assistantModel`）。
- 批量解读仍是有界单次请求（`paperContext`），未改成 Agent 回合。
