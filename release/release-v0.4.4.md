# Kun 0.4.4

0.4.4 让资料、对话与产物更紧密地连在一起：Work 用标签页和分屏串起会话与文件，论文库整合为独立空间；Design 支持分区多画板，数据报告可以直接呈现在对话里并保存到产物库。同时带来工作台新版引导、统一应用连接入口、个人助理任务工作流与存储管理，并改善计划交接、并行任务恢复和 Windows 启动稳定性。

## ✨ 新功能

- **Work 标签页与论文空间**：会话与文件共用标签栏，支持并排对照和会话内预览，论文库统一为独立的检索、阅读与笔记空间。文档选区可直接交给 Kun 改写、扩写或引用，表格选区可查看统计并发起分析。
- **分区多画板设计**：同一个 Design 画布可以按分区组织多个页面、状态与方案，继续对话即可追加或修改画板。Claude Code、Codex 及受支持的 ACP Agent 也能在 Code 对话中打开设计，确认方案后再进入代码实现。
- **数据报告与产物预览**：对话中可直接展示包含指标、图表和说明的数据报告，并保存到产物库中重新打开和更新。产物卡片增加真实缩略图，查找已有成果更直观。
- **工作台与新版引导**：更新圆角工作区、模式切换和可收起的右侧工具条，macOS 侧栏支持通透的玻璃效果。首次使用或从旧版本跨越 0.4.4 升级时提供可跳过的工作台介绍，并可从帮助入口重看各模式引导。
- **统一应用连接入口**：在“设置 → 连接”集中查看和管理应用连接。GitHub 与 Gmail 可用；Notion、Figma 预设已列入目录，但尚未开放连接。
- **个人助理任务工作流（Lab）**：向已连接的个人助理派发任务，查看送达状态、进度与结果，支持历史恢复、追问和取消。功能默认关闭，需在“设置 → Lab”启用，并由服务端开放；助理回传不会替代你的敏感操作授权。
- **存储管理与清理**：在设置中查看缓存、会话、工作树和附件等分类占用，预览清理范围并回收空间。自动清理旧内容需先授权规则，扩大清理范围或缩短保留期限时会重新请求同意。
- **其他**：重新设计启动恢复窗口、编辑重发输入框和回合变更摘要；Work 侧栏与标签页、Code 文件标签页增加右键菜单；支持将未读会话标为已读。

## 🐛 修复与改进

- **计划交接与分派结果**：修复计划交给其他 Agent 执行、卡片上切换 Agent 及导航后续接的问题。分派卡片支持展开 Markdown 结果，父会话接收工作 Agent 的实际结论，而不再只有任务标题。
- **任务恢复与并行执行**：改善瞬时停顿、Manager 数据传输超时及委托会话续接失败后的恢复。保留可续接的会话，避免重启后重复执行已完成的工作。
- **Work 历史与工作树提交**：恢复较早 Work 会话的访问，并修复切换页面后工作树提交队列未继续处理的问题。
- **权限与隔离**：将输入区权限选择正确保存在当前会话，并在待执行分派卡片切换 Agent 后重新应用隔离要求。
- **Windows 启动与更新**：加强启动恢复、进程归属检查与更新重启保护，减少旧实例和更新切换之间的冲突。
- **记忆提取**：规范提取分数与诊断信息，候选比较关系异常时转入复核而不是直接丢弃，并保持群聊中的记忆工具可用。
- **OAuth 与存储安全**：改善 MCP 加密凭据与令牌刷新的生命周期，避免旧授权失败误清除新凭据。清理过程中设置发生变化时会重新检查授权边界。
- **界面、预览与 Linux 重启**：避免无关操作误开浏览器或 Design 侧栏，设计预览校验保持在 Kun 内完成，并改善深色主题、窄面板和通知展示。AppImage 和 deb 版本在恢复或迁移后重新进入正确的启动入口，并保留启动参数。

## Linux 安装提示

Ubuntu 24.04 及其他限制非特权用户命名空间的系统上，AppImage 可能需要管理员配置 AppArmor；建议优先使用 deb 包。Linux ARM64 暂不包含部分计算机控制后端。

## 更新后介绍

从 0.4.4 之前的版本升级，且尚未看过新版工作台介绍时，会先展示引导，而不是同时弹出更新说明。引导末屏可打开本说明；也可之后在“设置 → 更新”中重新查看。引导可以跳过，不影响继续使用。

---

## English

Kun 0.4.4 brings sources, conversations, and artifacts closer together. Work connects sessions and files with tabs and split views, papers move into one independent library, Design gains sectioned multi-board canvases, and data reports render in conversations and remain available in the artifacts library. This release also adds a workbench tour, a unified app-connections entry, personal-assistant task workflows, and storage management, with improvements to plan handoffs, parallel-task recovery, and Windows startup.

### Features

- **Work tabs and paper space**: Sessions and files share a tab strip, with side-by-side comparison and in-session previews. Papers have one independent space for discovery, reading, and notes. Send document selections to Kun for rewriting, expansion, or quoting, and inspect or analyze selected spreadsheet cells.
- **Sectioned multi-board designs**: Organize pages, states, and alternatives into sections on one Design canvas, then add or revise boards through the conversation. Claude Code, Codex, and supported ACP Agents can also open designs from Code conversations, with implementation following your approval.
- **Data reports and artifact previews**: Display reports combining metrics, charts, and explanations directly in conversations, then reopen and update them from the artifacts library. Artifact cards now show real thumbnails to make existing work easier to find.
- **Workbench and guided tours**: Updated the rounded workspace, mode switcher, and collapsible right tool rail, with a translucent glass sidebar on macOS. First-time users and upgrades crossing 0.4.4 receive a skippable workbench overview; mode tours can be replayed from Help.
- **Unified app connections**: View and manage app connections under Settings → Connections. GitHub and Gmail are available; Notion and Figma presets are listed but are not yet open for connection.
- **Personal-assistant task workflows (Lab)**: Assign tasks to connected personal assistants and follow delivery, progress, and results, with history recovery, follow-ups, and cancellation. Off by default, requiring both Settings → Lab and server-side availability. Assistant replies do not replace your authorization for sensitive actions.
- **Storage management and cleanup**: Inspect storage used by caches, conversations, worktrees, and attachments, preview cleanup candidates, and reclaim space. Automatic cleanup of old content requires consent to its rules; broader rules or shorter retention require renewed consent.
- **Other**: Redesigned startup recovery, edit-and-resend, and turn-change summaries. Added context menus to the Work sidebar and tabs and to Code file tabs, plus an action to mark unread conversations as read.

### Fixes and improvements

- **Plan handoffs and dispatch results**: Fixed handing plans to another Agent, switching Agents on dispatch cards, and continuing handoffs after navigation. Cards can expand Markdown results, and parent conversations receive actual worker findings rather than task titles alone.
- **Task recovery and parallel execution**: Improved recovery from transient stalls, Manager data-plane timeouts, and delegated-session resume errors. Preserve resumable sessions and avoid replaying completed work after a restart.
- **Work history and worktree submissions**: Restored access to older Work sessions and resumed queued worktree submissions after navigating away and back.
- **Permissions and isolation**: Persist composer permission choices on the active conversation and reapply isolation requirements when switching Agents on pending dispatch cards.
- **Windows startup and updates**: Hardened startup recovery, process ownership checks, and update relaunch protection to reduce conflicts with old instances during update cutover.
- **Memory extraction**: Normalized extraction scores and diagnostics, routed candidates with invalid comparison relations to review instead of dropping them, and kept memory tools available in group conversations.
- **OAuth and storage safety**: Improved encrypted MCP credential and token-refresh lifecycles so failures from an old grant do not clear fresh credentials. Cleanup rechecks consent boundaries when settings change mid-run.
- **Interface, previews, and Linux relaunch**: Avoid opening the Browser or Design sidebar from unrelated actions, keep design preview validation inside Kun, and improve dark themes, narrow panes, and notifications. AppImage and deb builds return to the correct launcher after recovery or migration, retaining their startup arguments.

### Linux installation notes

On Ubuntu 24.04 and other systems that restrict unprivileged user namespaces, AppImage may require administrator-configured AppArmor permissions; the deb package is recommended. Some computer-control backends are not included on Linux ARM64.

### After updating

When upgrading from a version before 0.4.4, users who have not seen the new workbench overview receive the tour instead of a second update dialog. Open these notes from its last screen or revisit them under Settings → Updates. The tour is skippable and does not block normal use.

[Full changelog](https://github.com/KunAgent/Kun/compare/v0.4.3...v0.4.4)
