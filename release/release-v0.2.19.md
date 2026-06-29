# Kun v0.2.19

这一版的核心是 Claude Pro/Max 订阅接入：Kun 通过内置 Claude Agent SDK 路径，把完整回合委托给订阅模型，同时继续注入 Kun 的历史、Skill、模式上下文、权限和工具桥。除此之外，这一版还加入了 Conversations 标签、对话本地附件、自动验收、目标续跑增强，并修复了一批运行时与设置稳定性问题。

### Claude Pro/Max 订阅接入

- 新增 `Claude (Pro/Max 订阅)` 供应商预设，通过 Claude Agent SDK 使用订阅额度，而不是普通 HTTP API 计费路径。
- Kun 会把完整回合路由到 SDK runtime，并把 Kun 专属工具桥接为 in-process MCP，让订阅路径也能使用 Kun 的工具、权限和上下文。
- 新增 Claude 订阅登录 UI，可以检测本机 Claude Code 登录，也支持通过 SDK 获取可用模型。
- Claude Code binary 改为按需下载，并提供后台下载进度；不再要求用户提前单独安装 CLI。
- 支持从 `supportedModels()` 获取模型并自动填充，模型 id、视觉能力和上下文长度会跟随 SDK 返回值校准。
- 图片附件会转发给 SDK，交互式输入会走 Kun 的 `user_input` 面板，plan 回合也会向 SDK 暴露 `create_plan`。

### 对话工作区、附件与 Composer

- 侧栏新增 Conversations 标签，并可自动创建带时间戳的对话工作区。
- 对话支持添加本地文件附件，composer 也新增文件和文件夹入口。
- 项目选择器会排除 conversation workspace，避免临时对话空间干扰真实项目列表。
- 会话置顶切换、线程预览锚点、会话动作弹窗遮罩和 timeline 置底行为都做了修复。
- 重新打开已结束线程时，不会再重复弹出过期的 `user_input` 提示。

### 运行时可靠性与自动验收

- 运行时会重试 stale managed endpoints，并加强 endpoint health recovery。
- 子代理运行时卡住时可以恢复，并新增 event-loop stall 日志用于诊断 runtime hang。
- 新增自动验收验证，代码模式下 `verify_changes` 变为可选建议，减少对非代码任务的干扰。
- 目标续跑逻辑增强，可以更好处理未完成目标对应的回合。
- Write 与 SDD 工作台改为懒加载，降低首屏渲染和设置切换成本。

### 设置、MCP 与权限

- 设置里可以看到 MCP 与 Skill 权限来源，权限预览也不再直接回显原始 MCP 解析错误。
- MCP 服务器按 workspace roots 作用域管理，并移除不安全的 repo-local `.kun/mcp.json` 自动导入。
- 修复模型请求代理 URL 输入时被清空的问题，设置卸载时会 flush 待保存的供应商编辑。
- Provider stale proxy 诊断更明确，连接测试的长错误消息也会正确换行。

### 平台与工作区体验

- Linux 下 Wayland IME flags 会按平台门控，减少输入法相关副作用。
- Windows shell 通过绝对路径启动，并正确尊重 `danger-full-access` 文件工具权限。
- 原生右键菜单和若干标签文案更清楚。
- Worktree 支持重复 checkout 同一分支，并隐藏内部 worktree projects；undefined workspace 与 `.kun/worktrees` 锚点检测也做了防护。
- 内部拆分了 main 桌面行为、路径 helper、聊天 store 初始状态与线程 action，为后续维护降低复杂度。

### 本版合入的修复

- 修复 Claude SDK 路径下的文本/推理重复流式渲染、非 Anthropic 线程模型回落、`canUseTool` 输入更新和订阅状态识别。
- 修复设置代理、侧栏预览、composer 背景、目标面板背景、纯文本 chip 背景等 UI 问题。
- 修复构建中缺失的 `@emnapi` lockfile 记录。
- 补充 worktree 分组测试覆盖，并增加 runtime stall 诊断日志。

### 升级说明

- 从 `v0.2.18` 升级可直接通过 GUI 更新。
- 如果要使用 Claude Pro/Max 订阅路径，可以在供应商中选择 `Claude (Pro/Max 订阅)`，按提示登录或下载所需 SDK binary。
- 如果你依赖 repo-local `.kun/mcp.json` 自动导入，升级后需要改为在设置中显式配置 MCP，以避免不安全的隐式导入。

### 总结

v0.2.19 把 Kun 接到 Claude 订阅模型路径上，同时没有放弃 Kun 自己的工具、Skill、权限和上下文治理。这让订阅模型可以真正参与 Kun 的本地工作流；配合 Conversations、附件、自动验收、目标续跑和运行时修复，它也是 v0.2 后段非常关键的一次整合版本。
