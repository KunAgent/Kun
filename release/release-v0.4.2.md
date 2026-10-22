# Kun 0.4.2

0.4.2 是 0.4.1 之后的增量更新，新增产物库与幻灯片生成，让 Changes 面板可以直接暂存、提交和推送，回合撤销改为只还原 Kun 改过的文件；Agent 名册统一了各入口的派活角色，协作面板、内置终端、文件树、预览和 Kun TUI 全部重做；同时大幅降低启动和空闲时的资源占用。

> **上线状态**：生成式界面（Gen UI）、MCP Apps 与个人助手仅在“实验功能”中提供，默认关闭；App / 移动端相关能力仍在预览和内部验证阶段，尚未正式上线。本版本不将它们作为正式功能发布。

## ✨ 新功能与体验改进

- **产物库**：侧栏新增“产物”入口，集中展示 Kun 在各个项目里做出的设计稿、文档、幻灯片、表格、白板和生成图片。支持网格与列表视图、按类型和项目筛选、搜索与排序；PDF 和白板可直接预览，详情页可查看版本，或回到原会话让 Kun 继续修改。回合结束和窗口重新聚焦时自动刷新。PPTX、DOCX、XLSX 产物打开后可直接在右侧与 Kun 对话修改：当前页、选中文字或单元格区域会作为上下文随消息发送；Kun 改动文件前自动保存版本快照，支持对比与撤销。
- **幻灯片生成**：让 Kun 做 PPT 时由主 Agent 按内置幻灯片技能完成：先生成可编辑的 PPTD 再逐页渲染预览，离线导出 PPTX 并做几何校验，生成图片仅作为可选素材。对话卡片显示规划、方向、制作、预览、审阅、导出各步进度，白板可逐页审阅并查看图片槽位来源。
- **在 Changes 面板提交与推送**：Changes 面板可切换查看本次会话、上一回合、未暂存、已暂存或整个分支的改动，支持逐个或批量暂存、取消暂存与丢弃（未跟踪文件移入废纸篓）。提交信息留空时由模型生成；“提交并推送”会在首次推送时自动设置上游分支，失败时显示可复制的 git 输出。
- **按文件撤销回合改动**：撤销某一回合时，只还原 Kun 文件工具在该回合改过的文件，不再对整个工作区执行 `git reset --hard`，你自己的未提交修改会被保留。撤销前会检查冲突，任何文件不安全时都不写入；撤销后可一键重新应用。
- **Agent 名册与角色**：内置角色、自定义角色和仓库 `.kun/agents/` 下的角色统一为一份名册：派活卡、任务建议卡、Graph 任务和 `delegate_task` 都可以按角色选人，绑定了引擎的角色会在对应引擎上运行。设置中可查看每个角色的运行位置与状态，Graph Lead 还能选用工作区里学习到的可信角色。
- **协作与建议任务**：协作面板改为成员列表，按“需要你、进行中、已完成”分组，每个成员一个标签页，顶部进度条汇总完成/进行/等待/失败与用量。Kun 可以把后续工作提为建议任务卡，启动后在独立的嵌套会话（通常是隔离 worktree）中运行并回报结果。派活卡里每个 worker 可单独更换 Agent 和模型；卡片在设定时间内无操作会自动开始派发（默认 60 秒，可在设置 > 协作中调整或关闭）。
- **内置终端**：终端重做为可停靠面板：xterm 会话在切换标签和收起面板后保持存活，标签带运行状态点；支持分屏、最大化与右侧停靠；zsh / bash / fish 命令带标记和退出码，失败的命令可一键连同输出发送给 Kun；Kun 的后台 shell 以只读标签出现；支持查找、点击路径与预览链接、拖入文件、重启后恢复，以及主题、字体与行为设置。
- **Code 中直接出设计**：Design 不再是输入框里的单独模式。Code 对话中需要视觉稿时，Agent 会自行打开 Design 画布，在右侧面板完成一轮设计，输入框随后回到 Code。
- **文件树与预览重做**：任何工作区文件都能打开，`.env.local`、`LICENSE`、`.patch` 等不再显示“不支持”；GBK、UTF-16 等编码自动识别并可手动切换。文件树新增 git 状态标记、全仓搜索、仅看改动和键盘导航；预览支持 CSV/TSV 表格、图片像素缩放、二进制十六进制视图，以及视频、音频和 HTML 渲染。
- **引用回复与分支对话**：在 Code 对话中选中一段文字，可直接“回复”或“开启分支对话”。引用会随消息一起发送，点击气泡中的引用即可跳回原文。
- **提示词优化**：输入框的提示词优化按钮默认显示，使用当前选择的模型改写；再次点击或按 Esc 可取消，改写后可撤销（Cmd/Ctrl+Z）。
- **更顺滑的流式回复**：回复按实际到达速度平滑展开，末尾文字淡入，网络卡顿时不再一顿一顿；遵循“减少动态效果”设置。运行中的回合超过两分钟没有输出时会提示“N 分钟无输出”，重新打开的历史也会保留每轮的首字延迟和生成速度。
- **输入与编辑**：中文输入法下输入 `、` 或 `／` 即可打开命令菜单；编辑已发送的消息时也能 @ 文件和使用 / 技能；复制渲染后的公式会得到 LaTeX 源码。
- **Kun TUI 全新界面**：终端界面基于 opentui 重写，改为全屏布局，带会话标签页、可停靠侧栏（上下文、用量、审批、计划和子代理）、折叠的工作记录与主题自适应配色。GUI 已占用同一配置时，`kun tui` 会连接到正在运行的 Runtime，不再直接报冲突。
- **模型供应商**：新增 Magpie 本地网关供应商预设；Cursor 订阅账号的可用模型按凭据动态列出，选择器同步显示各模型的推理档位。
- **其他**：私聊按 Agent 回合分组展示，工具过程折叠为工作记录并以结果卡结尾；应用更新入口移到侧栏“设置”旁，点击后先显示版本和下载进度，再决定是否重启安装。

## 🐛 修复与改进

- **启动与空闲占用**：启动时不再扫描全部会话日志、也不再重复拉起每个已启用的 Agent CLI；空闲时 Runtime 与 Manager 之间的请求和内存分配显著下降。附件清理推迟到启动 5 分钟后并改为每 6 小时一次，Agent 模型目录跨重启保留，重启后打开选择器无需重新探测。大型会话的历史读取改为线性时间，回合结束或中断时不再为检查转向而加载完整历史。
- **回合恢复与运行时稳定性**：被中断的回合会在原来的 Agent 上恢复，不再回落到 Kun 循环；机器负载高导致 Agent 进程启动失败时会自动重试；启动时重新应用相同设置不再让首条消息报“供应商配置已变更”；未声明上下文窗口的模型按 1M 处理，不再每步强制压缩历史；撤销回合的 git 检查不再因管道关闭而崩溃。
- **协作、派活与房间**：批量派活中失败的 worker 会自动改派其他可用路由，后台通知合并为一条；子代理现在会出现在协作面板中；保存设置后派活卡不再丢失工具；模型步骤之间 harness 菜单保持稳定；修复房间内存清理失败导致私聊长期卡在停止中的问题。
- **历史与计划**：工具结果较多时，最新一轮的最终回复仍保留在首页时间线中；计划模式只在 Agent 确实需要时才保存计划，普通提问不再生成计划文件。
- **Work 写作**：排队中的消息可以引导正在运行的回合；修复审阅分块与文档不同步导致应用崩溃的问题；推理强度默认值与选择器显示一致；助手面板以当前会话命名，专注模式下隐藏 Kun 头像，会话列表的状态图标和白板加载动画不再重叠或常驻。
- **输入框与对话显示**：从 Word、PowerPoint、Excel 粘贴时插入文字，而不是附上一张截图；分支选择器不再遮挡相邻控件；助手 Markdown 中引用的工作区图片可以正常显示；Cursor 订阅模型会说明在哪里使用；未上报推理档位的 Codex 模型使用标准档位。
- **设置与外观**：清空某个 Agent 的默认设置后能正确保存、不再被界面刷新还原；补齐所有未定义的 ds-* 颜色名称，修复多处配色缺失；DOCX 与表格预览的滚动与缩放保持同步；幻灯片缩略图栏可以滚动。
- **Windows 安装与更新**：更新、回滚和重试时正确处理超长路径，避免回滚后残留或丢失文件；加强 Windows 进程身份校验与托管进程生命周期，冷启动时身份查询超时会重试一次；修正路径边界与附件缓存的分隔符处理。
- **TUI 与多客户端**：`/model` 会作用于当前打开的会话；会话很多时 TUI 也能在时限内启动共享 Runtime；macOS 上 TUI 的后台进程不再出现在程序坞；原所有者退出后残留进程会被明确指出并能正常退出。
- **浏览器与第三方 Agent 兼容**：Browser Use 支持 TUN 模式代理并走系统代理；Claude Code 的每条助手消息独立显示，长回合不再丢失文字；ACP 会话中切换模型后仍按所选模型运行；每日开发版不再拒绝自带扩展。
- **安全与打包**：升级 MCP SDK、follow-redirects 与 hono，修复新公布的安全公告。MCP client 同步升级，hono 固定到 4.13.11；安装包移除了不会加载的资源，体积更小；依赖缺失的打包运行时会在校验时直接拒绝，不再静默启动。

## 预览与未上线功能

生成式界面（Gen UI）、MCP Apps 与内置可编辑画布需要在设置 > 实验功能中手动开启，默认关闭，行为可能随版本调整。

个人助手同样位于设置 > 实验功能，默认关闭：可把 Manus Cue、Grok Bot 等第三方助手接入对话列表，通过比对验证码完成配对后派发任务，任务与回执经端到端加密邮箱收发。该能力还需服务端同步开放，未开放时相关对话会提示尚未启用。

新增可选的产品体验统计，默认关闭，可在设置 > 基础设置中开启；不上传提示词、代码、回复、路径或密钥，关闭后立即停止采集并清除待上传数据。相关首次任务引导由服务端逐步开放。

App / 移动端配对与依赖它的远程访问能力仍在预览和内部验证阶段，尚未正式上线；本版本改进了 iOS 中继的跨重启记忆和历史增量同步，但不将其列为正式发布功能。

## 更新方式与兼容说明

通过侧栏“设置”旁的更新入口下载并重启安装。Kun Runtime 和终端命令随桌面应用一同更新。

本版本为 0.4.x 增量更新，未引入新的手动迁移步骤。输入框不再提供 Code / Design 模式切换，已绑定 Design 画布的会话仍保留画布并以 Code 回合继续。预览能力可能随版本调整，请勿将其视为稳定接口或正式上线承诺。

---

## English

Kun 0.4.2 adds an Artifacts library and slide-deck generation, commit and push in Changes, per-file turn undo, a shared agent roster, and rebuilt Collaboration, terminal, file tree and TUI surfaces — while cutting launch and idle use.

> **Availability**: Generative UI (Gen UI), MCP Apps and Personal assistants are behind Labs switches that default to off. App / mobile capabilities remain in preview and internal validation. They are not generally available in this release.

### Features and improvements

- **Artifacts library**: A new Artifacts entry in the sidebar collects the design drafts, documents, slides, spreadsheets, whiteboards and generated images Kun has made across your projects. It offers grid and list views, type and project filters, search and sorting. PDFs and whiteboards preview in place, and the details panel shows versions or asks Kun to revise in the original conversation. The library refreshes when a turn finishes and when the window regains focus. PPTX, DOCX and XLSX artifacts open with a conversation beside the file: the slide on screen, selected text or a cell range travels as context, a version snapshot is saved before Kun edits, and you can compare or undo.
- **Slide decks**: Asking Kun for a presentation now runs in the main agent. A bundled slides skill writes an editable PPTD first, renders each page for review, exports PPTX offline with geometry checks, and treats generated images as optional assets. The chat card shows plan, direction, build, preview, review and export progress, and the whiteboard reviews pages one by one.
- **Commit and push from the Changes panel**: The Changes panel can now stage, commit and push. It shows this conversation, the last turn, unstaged, staged or whole-branch changes, with per-file and bulk stage, unstage and discard (untracked files go to the Trash). A blank commit message is written by the model, Commit & push sets the upstream on a branch's first push, and failures show a copyable git output card.
- **Per-file turn undo**: Undoing a turn restores only the files Kun changed, keeping your own uncommitted edits. It no longer runs `git reset --hard` on the whole workspace. Undo checks for conflicts first and writes nothing if any file is unsafe, and the turn can be reapplied afterwards.
- **Agent roster and roles**: Built-in, custom and workspace `.kun/agents/` roles now live in one roster. Dispatch cards, task suggestion cards, Graph tasks and `delegate_task` all pick people by role, and a role bound to an engine runs on that engine. Settings shows where each role can run and its status, and a Graph Lead can also pick trusted roles learned in the workspace.
- **Collaboration and suggested tasks**: The Collaboration panel is now a member list grouped by needs-you, working and finished, one tab per member, with a progress bar counting done, working, waiting and failed plus usage. Kun can propose follow-up work as suggestion cards; started tasks run in their own nested session (usually an isolated worktree) and report back. Each worker in a dispatch card can switch Agent and model, and cards auto-dispatch after a configurable no-response window (60 seconds by default, adjustable or disabled in Settings > Collaboration).
- **Built-in terminal**: The terminal is rebuilt as a dock. xterm sessions stay alive across tab switches and collapse, tabs carry status dots, and panes split, maximize or dock right. zsh, bash and fish commands get marks and exit codes, a failed command can be sent to Kun with its output, and Kun background shells appear as read-only tabs. Find, clickable paths and preview links, file drop, restore after restart, and theme, font and behavior settings are included.
- **Design from Code**: Design is no longer a separate composer mode. When a Code conversation needs a visual draft, the agent opens the Design canvas itself, runs one design pass in the right panel, and returns the composer to Code.
- **Redesigned file tree and preview**: Any workspace file can be opened, so `.env.local`, `LICENSE`, `.patch` and similar files no longer show "not supported". Encodings such as GBK and UTF-16 are detected and can be switched by hand. The tree adds git markers, workspace-wide search, a changed-files view and keyboard navigation; the preview adds CSV/TSV tables, pixel zoom for images, a hex view for binaries, and video, audio and rendered HTML.
- **Reply to or branch from a selection**: Select text in a Code conversation to Reply or Start a branch conversation. The quote travels with the message, and clicking it in the sent bubble scrolls back to the source.
- **Prompt enhancement**: The composer's enhance button now shows by default and rewrites with the selected model. Click again or press Esc to cancel, and undo the rewrite with Cmd/Ctrl+Z.
- **Smoother streaming**: Replies unfold at the measured arrival rate with a fade-in tail instead of jumping chunk by chunk, and respect reduced motion. A running turn that has produced nothing for two minutes says so, and reopened history keeps each turn's time to first token and tokens per second.
- **Typing and editing**: Typing `、` or `／` with a Chinese input method opens the command menu, editing a sent message supports @ files and / skills, and copying a rendered formula copies its LaTeX source.
- **New Kun TUI**: The terminal UI is rebuilt on opentui as a full-screen app with session tabs, a docking sidebar (context, usage, approvals, plan and subagents), folded work trails and a theme that follows the terminal. When the GUI already owns the profile, `kun tui` attaches to the running Runtime instead of failing with a conflict.
- **Model providers**: A new Magpie local-gateway provider preset is available, and Cursor subscription accounts list their usable models dynamically from credentials, with reasoning levels shown in the picker.
- **Other**: Private chats group messages into one turn per Agent run, with tool work folded into a trail and a result card at the end. The app update entry moves beside Settings in the sidebar and shows the version and download progress before you choose to restart.

### Fixes and improvements

- **Launch and idle footprint**: Launch and idle use far less CPU, memory and disk reads. Launch no longer scans every conversation log or re-spawns every enabled Agent CLI, and idle Runtime-to-Manager traffic and memory allocation drop sharply. Attachment pruning waits five minutes after launch and runs every six hours, Agent model catalogs persist across restarts so pickers list models without a fresh probe, large conversation histories now load in linear time, and a finishing or interrupted turn no longer hydrates the whole history to check steering.
- **Turn recovery and runtime reliability**: Interrupted turns resume on their original Agent. They no longer fall back to the Kun loop. Agent launches refused by a loaded machine are retried, re-applying unchanged settings at startup no longer fails the first message with a provider-changed error, models without a declared context window are sized at 1M instead of force-compacting history every step, and the turn-undo git check no longer crashes on a closed stdin pipe.
- **Collaboration, dispatch and rooms**: A failed worker in a batch dispatch is rerouted. Background notices merge into one, child agents appear in the Collaboration panel, dispatch cards keep their tools after settings are saved, the harness menu stays stable across model steps, and a room whose memory scrub fails no longer leaves direct chats stuck stopping.
- **History and plans**: The newest turn's final reply stays on the first page. This holds even when tool results are large, and Plan mode saves a plan only when the agent needs one, so plain questions no longer create plan files.
- **Work**: Queued messages can guide the running turn. Fixed a crash caused by review chunks drifting out of step with the document, the reasoning default now matches the picker, the assistant panel is named after the open session, Focus mode hides the Kun avatar, and session row icons and whiteboard spinners no longer overlap or keep spinning.
- **Composer and conversation display**: Office pastes insert text instead of a picture. Pasting from Word, PowerPoint or Excel no longer attaches a screenshot of the selection. The branch picker no longer overlaps its neighbours, workspace images referenced in assistant Markdown display correctly, Cursor subscription models explain where they are used, and Codex models without reported levels use the standard reasoning levels.
- **Settings and appearance**: Cleared Agent defaults now persist across refreshes. Every previously undefined ds-* color name is defined, fixing missing colors across the UI, DOCX and sheet previews keep scrolling in step with zoom, and the slide thumbnail rail scrolls.
- **Windows install and update**: Updates and rollbacks now handle long install paths. A rollback or retry no longer leaves or loses files. Windows process identity and owned process lifecycle are hardened, a timed-out identity query at cold start is retried once, and path containment and attachment cache boundaries respect Windows separators.
- **TUI and multiple clients**: `/model` now applies to the open session. The TUI starts the shared Runtime within its deadline on large histories, background TUI processes stay out of the macOS Dock, and orphaned owners left behind by an exited session are named and exit cleanly.
- **Browser and third-party Agent compatibility**: Browser Use works with TUN-mode proxies. It now goes through the system proxy. Each Claude Code assistant message gets its own text block, so long turns no longer lose narration, an ACP session that changes model mid-way runs the chosen model, and daily dev builds no longer reject bundled extensions.
- **Security and packaging**: MCP SDK, follow-redirects and hono upgrades fix new advisories. The MCP client is upgraded too and hono is pinned to 4.13.11, packages are slimmer with unused resources removed, and a packaged runtime with missing dependencies is rejected at verification instead of starting silently.

### Preview and not-yet-launched features

Generative UI (Gen UI), MCP Apps and the built-in editable canvas must be turned on in Settings > Labs. They default to off and may change between releases.

Personal assistants also live in Settings > Labs and default to off: assistants such as Manus Cue or Grok Bot can join the conversation list, pair after you compare verification codes, and exchange tasks and reports over an end-to-end encrypted mailbox. The capability also depends on the server opening it; conversations will say so until then.

Optional product analytics are added and default to off; you can turn them on in Settings > Basics. Prompts, code, replies, paths and credentials are never uploaded, and turning analytics off stops collection at once and clears pending data. The related first-task guides are being enabled from the server gradually.

App / mobile pairing and the remote-access capabilities that depend on it remain in preview and internal validation. This release improves remembering the iOS relay across restarts and streams live history deltas, but does not announce these as shipped features.

### How to update and compatibility

Download the update from the entry beside Settings in the sidebar and restart to install. The bundled runtime and terminal commands update with the desktop application.

This is an incremental 0.4.x update with no new manual migration step. The composer no longer offers a Code / Design mode switch; conversations already bound to a Design canvas keep the canvas and continue with Code turns. Preview capabilities may change between releases and should not be treated as stable interfaces or general-availability commitments.

[Full changelog](https://github.com/KunAgent/Kun/compare/v0.4.1...v0.4.2)
