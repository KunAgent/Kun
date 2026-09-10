# Kun 0.3.10

0.3.10 引入本地语音朗读、记忆语义检索与词法弃权门槛，并系统性加固会话队列、更新器与子代理运行时。

## ✨ 新功能

- **本地语音朗读（Speak）**：内置 Kokoro 本地语音合成，答案下方新增 Speak 按钮，逐段连续播放；模型与音色按摘要校验下载，推理在 worker 线程执行不阻塞界面；录音保留在本地并可下载。可在设置 -> 媒体生成中配置本地语音提供方，支持中英文界面 (#1301)。
- **记忆语义检索与词法弃权**：引入语义记忆检索与评估门槛，弱相关的词法命中不再注入上下文，避免误召回；保留中文（CJK）词法检索下限 (#1304, #1307, #1308)。
- **自定义请求头**：供应商支持自定义请求头，自动附加 OpenCode Go 会话头，并区分行操作按钮含义 (#1299)。
- **固定自动审查模型**：审批支持配置固定的自动审查模型。
- **长文本粘贴转附件**：粘贴的超长文本自动转为附件，避免撑爆输入框。

## 🐛 修复与改进

- **会话队列可靠性**：排队消息的准入与投递可恢复，导向（steering）投递持久化并核对队列归属；支持安全撤回排队消息进行编辑，账号会话的排队消息同样可编辑；陈旧导向目标与本地排空加围栏，重排在运行时确认后生效。
- **桌面记忆蒸馏**：允许桌面端发起蒸馏请求，并将蒸馏用量与回合边界隔离。
- **更新器与安装器**：保持升级入口可见并使用已校验的下载源；公开构件下载中断自动重试；不可验证的 current-user 安装源按陈旧处理而非中止，共享路径的次级源不再影响主源校验 (#1289, #1290, #1292, #1293)。
- **运行时稳定性**：子代理的提供方与数据服务失败可恢复；子代理记录原子化持久化；启动时对不可用 Manager 分类并验证重试恢复。
- **用量与模型**：用量按实际使用的模型归因并区分子代理作用域；尊重配置的最大输出 token。
- **界面**：引导式用户输入以回合内气泡渲染；加载页替换为极简呼吸 Kun 标志；归档会话设置区支持归档线程列表。
- **依赖与安全**：更新存在漏洞的生产依赖，升级 electron-builder 至 26.16.1；打包仅随附目标平台所需的 ONNX Runtime 二进制，减小安装体积。

## 更新方式

通过应用内更新入口下载更新，完成后重启 Kun 安装。此更新沿用桌面应用的稳定更新通道，Kun Runtime 和终端命令随桌面应用一同更新。

---

## English

Kun 0.3.10 adds local speech playback, semantic memory retrieval with lexical abstention, and hardens the session queue, updater, and subagent runtime.

- **Local Speak**: bundled Kokoro speech synthesis with a Speak action under each answer, back-to-back chunk playback, digest-verified model/voice downloads, non-blocking worker inference, and downloadable kept recordings; configurable under Settings -> Media Generation (#1301).
- **Memory retrieval**: semantic memory retrieval with evaluation gates; weak lexical matches no longer enter context, with a preserved CJK lexical floor (#1304, #1307, #1308).
- **Providers**: custom request headers, automatic OpenCode Go session headers, and clarified header row actions (#1299); a fixed automatic review model for approvals.
- **Queue**: recoverable admission and delivery, durable steering with ownership reconciliation, safe withdrawal of queued messages for editing (including account-backed threads), and fenced stale steering recovery.
- **Updater/installer**: upgrades stay visible using the checked download source, interrupted artifact downloads retry, and unverifiable installer sources are retired as stale (#1289, #1290, #1292, #1293).
- **Runtime/stability**: subagent provider and data-service failure recovery, atomic child records, classified manager startup failures with verified retry.
- **Usage/UI**: usage attributed to the actual model with subagent scope separated, configured max output tokens honored, guided user inputs rendered as in-turn bubbles, and a minimal breathing Kun loading logo.
- **Dependencies**: vulnerable production dependencies updated, electron-builder 26.16.1, and per-target ONNX Runtime packaging.

Download the update from Kun and restart to install. The bundled runtime and terminal commands update with the desktop application.

[Full changelog](https://github.com/KunAgent/Kun/compare/v0.3.9...v0.3.10)
