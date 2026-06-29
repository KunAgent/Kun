# Kun v0.2.20

这一版是 v0.2.19 之后的一次稳定性与性能补强。主线是新增后台 shell 会话，让长时间命令可以脱离当前回合继续运行并持久化输出；同时修复 MCP streamable-http 断线导致运行时不稳、跨回合编辑误拦截、前端首屏包体偏大等问题，并补上 Agent replay benchmark，方便后续用回放方式观察运行时表现。

### 后台 Shell 会话

- 新增 `background_shell` 能力，长时间运行的 shell 命令可以在后台继续执行，不必阻塞当前对话回合。
- 后台命令输出会按线程持久化到 runtime data 目录，并保留输出摘要与完整日志路径，便于后续查看和审计。
- 运行结束后会向 Agent 发送完成通知，GUI 会把这类通知识别为后台 shell 事件，避免覆盖原始用户提示。
- 后台 shell 支持列出会话、查看详情、停止运行中的会话，并默认隐藏已结束会话以减少噪音。
- 修复后台输出目录使用错误，统一改走 `options.dataDir`，保证开发与打包环境都能找到正确位置。

### MCP 与运行时可靠性

- 修复 streamable-http MCP server 断开连接时可能把 Kun runtime 一起带崩的问题（#639）。
- 加固 MCP runtime reconnect 生命周期：断线后按需重连，多个并发工具调用共享同一次重连，生命周期关闭会正确标记为离线。
- 运行时 crash handler 会把可恢复的 MCP 后台拒绝视作可恢复错误，避免因为外部 MCP 抖动导致本地会话中断。
- 修复 stale reconnect、诊断状态和重试时机相关问题，让外部工具服务恢复后能继续调用。

### 文件编辑与对话体验

- 修复跨回合编辑时 read tracker 过度保守的问题：只要旧文本仍在最近读取内容中，就允许后续回合继续编辑（#640）。
- 记忆注入 chip hover 时显示记忆摘要，便于确认当前对话使用了哪些长期记忆。
- 设置中新增对话文字宽度配置，可以调整消息正文和输入框正文的显示宽度。
- 思考过程文字做了降噪处理，界面左侧边框也进一步简化。

### 性能与可维护性

- 设置页和时间线相关代码拆分为独立 bundle，减少主工作台首屏负担。
- 新增 Agent replay benchmark，可用只读 HTTP/SSE 回放套件重复跑核心场景，方便比较运行时性能和稳定性。
- replay benchmark 的清理逻辑与测试期望得到加固，减少基准测试自身的误报。
- 清理 agent loop 中不再使用的 `MAX_TURN_MODEL_STEPS` 及相关逻辑。

### 测试与回归修复

- 修复后台 shell 回调 UI、工具摘要、runtime-client import 等 renderer 问题。
- 修复批量 PR 合入后的类型、mock、timeline chip 回归。
- 补充后台 shell、MCP reconnect、read tracker 和 replay benchmark 相关测试覆盖。

### 升级说明

- 从 `v0.2.19` 升级可直接通过 GUI 更新。
- 后台 shell 输出会写入 Kun runtime data 目录；如果你在只读沙箱中查看输出，Kun 会允许读取这些后台日志文件。
- 如果你依赖远程 MCP server，这一版会明显改善断线和恢复时的稳定性。

### 总结

v0.2.20 把 Kun 的长命令执行和外部工具恢复能力往前推进了一步：后台 shell 让耗时任务不再绑死对话回合，MCP reconnect 修复让 runtime 更抗抖，前端拆包和 replay benchmark 则让性能优化有了更清晰的落点。
