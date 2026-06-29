# Kun v0.2.17

这一版的主角是子代理系统。Kun 开始支持更完整的子代理 profile、按 profile 路由模型、独立子会话、实时子任务展示，以及 `.kun/agents/*.md` 这样的项目级代理定义。同时，Skill/MCP、文档附件、Agents 设置和上下文压缩也完成了一轮系统升级。

### 子代理系统成型

- 子代理支持按 profile 配置模型供应商、模式、系统提示词、允许工具、名称、描述和颜色。
- 设置中新增 Subagents 管理视图，可以创建、编辑、删除子代理，并把配置桥接到运行时。
- 线程支持 `agentId` 与 persona，composer 新增代理选择器，子代理运行状态可以实时显示。
- 支持 `.kun/agents/*.md` 覆盖项目代理定义，并提供 AI 草稿、detach 与 abort 能力。
- 子代理可以配置独立压缩模型，并内置 General / Explore 等预设。
- 委派链路补齐被禁止工具、被禁止服务器和 profile 合并逻辑，子代理权限边界更清晰。

### Skill、MCP 与附件

- 聊天支持作用域 Skill 和文档附件，Skill 可以按项目/全局来源加载并标记来源。
- Tool runtime 支持全局 Skill 加载、深路径文件搜索，以及从设置传入全局 Skill roots。
- 已停用 Skill 会在运行时生效，Codex 插件缓存目录也可以开关。
- MCP stdio server 支持配置 `cwd`，远程 MCP 继续强化 HTTPS 约束。
- 新增进程类工具图标，纯文本代码块也会显示更清楚的 chrome。

### Agents 设置与模型行为

- Agents 配置界面重写，整合模型配置、完整管理、动画 Kun 与 i18n。
- 内置 endpoint format 会标注供应商协议类型，例如 OpenAI 与 Anthropic。
- 上下文压缩摘要改为更接近 opencode 的 compaction 模式，长会话阅读和续跑更自然。
- Anthropic 并行 `tool_result` 会合并为一个 user message，避免协议不兼容。
- 视觉模型到文本模型的锁定只在确实有图片时触发。

### 会话、侧栏与启动体验

- 侧栏会话操作更完整，长分支名、完整工作区路径和聊天跳转栏都做了展示修复。
- 新用户引导中加入默认 Agent 权限配置。
- 设置里新增 Git checkpoint 清理间隔，并保持 opt-in。
- ask-user 提示面板上移到输入框上方，减少长对话中被忽略的概率。
- Loop 编辑器在 Windows 标题栏下方正确偏移。

### 稳定性与安全修复

- Git checkpoint restore 会读取 `thread.status` busy guard，并加强路径穿越防护。
- IM 权限透传、workspace symlink escape、MCP HTTPS 等安全边界继续收紧。
- 运行时启动必须通过 health probe 后才宣告 ready。
- 上游模型列表 `fetch_failed` 与本地 runtime failure 会区分展示，排障信息更准确。
- 修复流式模型客户端丢失/截断 tool calls 的问题。

### 升级说明

- 从 `v0.2.16` 升级可直接通过 GUI 更新。
- 如果你想使用子代理，可以在 Agents 设置中配置 profile；项目内也可以用 `.kun/agents/*.md` 保存团队共享代理定义。
- 如果之前手动维护过 Skill 目录，升级后建议检查全局和项目 Skill roots 的开关状态。

### 总结

v0.2.17 让 Kun 的“多代理协作”正式成型：子代理不再只是一次工具调用，而是有 profile、有模型、有权限、有 UI、有项目定义的独立工作单元。配合全局 Skill、MCP `cwd`、文档附件和设置重写，这一版把 Agent 生态往可管理、可复用的方向推进了一大步。
