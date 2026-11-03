# Kun 0.4.1

0.4.1 是 0.4.0 之后的增量更新，集中改善 Code 首页与 Focus 模式、Agent 与模型选择、审批交互，以及长会话和第三方 Agent 的稳定性。

> **上线状态**：Gmail 连接与 App / 移动端相关能力仍在预览和内部验证阶段，尚未正式上线。本版本不将其作为正式功能发布，实际入口和可用范围以应用内提示为准。

## ✨ 新功能与体验改进

- **Code 首页与 Focus 模式**：Code 新任务首页加入点击涟漪与漂移字场；中文界面使用《庄子·逍遥游》中的汉字，其他语言使用拉丁字符。动画在空闲时停止，并遵循“减少动态效果”设置。Focus 模式改为带文字的开关，开启后隐藏账号卡、会话头像和 Kun 动画。设置 > 外观新增“首页点击涟漪”开关。
- **首条消息更顺滑**：从 Code 首页发送第一条消息时，欢迎标题、输入框和消息气泡的切换更连贯，减少创建会话往返造成的布局跳动。
- **Agent 与模型选择**：模型选择器按 Agent 提供的分组展示模型，修复同名模型分组丢失的问题。第三方 Agent 版本页新增“让 Kun 更新”，只生成更新请求并填入默认对话，需用户确认后才执行。
- **上下文与用量**：Cursor 上下文弹层展示 Cursor 自己的分类；Devin 与 Cursor 的用量按实际模型调用记录，展示方式与 Codex 一致。
- **审批交互**：待处理审批以编号选项显示在输入框上方，支持数字键选择、展开查看完整内容、拒绝时附加说明，并可直接停止当前回合。
- **账号头像**：侧栏账号卡会记住本机使用的头像，重启后不再回到默认 Kun；退出登录或切换账号后清除本机记录。

## 🐛 修复与改进

- **长会话与任务恢复**：大历史不再写入线程元数据，归档、恢复、删除和结算不再因历史过大而受阻；修复私聊回复在收尾后再次校验失败的问题。
- **Worker 与协作**：未启动的 worker 会明确报告失败或取消，并保留在面板中；运行中的 worker 在执行工具或等待审批时仍显示“查看过程”；重启后 Worker 面板可从团队记录恢复；超出步数或时间预算时显示真实原因和用量。
- **模型路由与网关**：本地网关开关热应用时同步路由与网关全局配置，不再停在“等待同步”；多供应商和路由池在流式请求、重试与切换时校验路由代次，失败信息区分请求是否已发出；运行时覆盖凭据随供应商切换重新迁移。
- **运行时与协议兼容**：修复代理返回 204 或无 body 时 kun serve 崩溃的问题；Anthropic 格式网关可通过 `/mcp/kun` 接受包含 `browser_use` 等工具的 schema；打包版补齐 kun-remote 协议依赖。
- **第三方 Agent 连接**：DeepSeek Harness 改为最低版本校验，较新的版本不会再被误判为过旧；ACP Agent 输出非 JSON 诊断日志时不再断开连接，模型目录探测更稳定。
- **论文阅读**：从侧栏打开论文时先只打开 PDF，由阅读布局决定是否加入 Notes，避免默认出现两个编辑器分组。

## 预览与未上线功能

Gmail 连接、App / 移动端配对以及依赖它们的远程访问能力仍在预览和内部验证阶段，尚未正式上线。本版本不将这些能力列为正式发布功能；相关入口、权限和可用范围可能随版本调整。

## 更新方式与兼容说明

通过应用内更新入口下载并重启安装。Kun Runtime 和终端命令随桌面应用一同更新。

本版本为 0.4.x 增量更新，未引入新的手动迁移步骤。预览能力可能随版本调整，请勿将其视为稳定接口或正式上线承诺。

---

## English

Kun 0.4.1 is an incremental update following 0.4.0, focused on the Code home and Focus mode, Agent and model selection, approvals, and the reliability of long conversations and third-party Agents.

> **Availability**: Gmail connections and App / mobile capabilities remain in preview and internal validation. They are not generally available in this release; this note does not announce them as shipped features.

### Features and improvements

- **Code home and Focus mode**: The Code new-task home gains a click ripple and drifting glyph field. Chinese UIs use characters from the opening of Zhuangzi's *Free and Easy Wandering*; other languages use Latin characters. Animation stops while idle and respects reduced motion. Focus mode is now a labeled switch that hides the account card, conversation avatars, and Kun animations. Settings > Appearance adds a Home click ripples toggle.
- **Smoother first message**: Sending the first message from the Code home now transitions the welcome title, composer, and message bubble more smoothly, with less layout jumping while a conversation is created.
- **Agent and model selection**: Model pickers show models under the groups supplied by each Agent, fixing lost groups for models with duplicate names. A third-party Agent's Version tab gains Ask Kun to update it, which only drafts an update request into the default chat and waits for confirmation.
- **Context and usage**: The Cursor context popover shows Cursor's own categories, and Devin and Cursor usage follows actual model calls with the same presentation as Codex.
- **Approvals**: Pending approvals appear as numbered choices above the composer, with number-key selection, expandable details, an optional note when declining, and a direct way to stop the current turn.
- **Account avatar**: The sidebar account card remembers the locally used avatar across launches instead of falling back to the default Kun; signing out or switching accounts clears the local record.

### Fixes and improvements

- **Long conversations and task recovery**: Large histories are no longer written into thread metadata, so archiving, recovery, deletion, and settlement are not blocked by history size. Private replies no longer fail a post-final re-check.
- **Workers and collaboration**: Workers that never start now report failure or cancellation and stay visible in the panel. Running workers keep their View process view while executing tools or waiting for approval, the Workers panel is restored from the team record after restart, and step or time-budget stops show their actual cause and usage.
- **Model routing and gateway**: Hot-applying the local gateway now syncs routes and gateway globals instead of remaining stuck on waiting for sync. Multi-provider and route-pool clients validate routing generations across streaming, retries, and switches, and failure metadata records whether a request was sent. Runtime override credentials are re-migrated when their provider changes.
- **Runtime and protocol compatibility**: Fixed a kun serve crash on proxied 204 or bodiless responses. Anthropic-format gateways can now accept tools such as `browser_use` through `/mcp/kun`, and packaged builds include the kun-remote protocol dependency.
- **Third-party Agent connectivity**: DeepSeek Harness now uses a minimum-version check, so newer releases are no longer mistaken for versions that are too old. ACP Agents that print non-JSON diagnostic lines no longer lose their connection, and model-catalog probes are more reliable.
- **Paper reading**: Opening a paper from the sidebar now opens the PDF first and lets the reading layout decide whether to add Notes, avoiding two editor groups by default.

### Preview and not-yet-launched features

Gmail connections, App / mobile pairing, and remote-access capabilities that depend on them remain in preview and internal validation. They are not generally available in this release, are not part of the official feature list, and may change without notice.

### How to update and compatibility

Download the update from Kun and restart to install. The bundled runtime and terminal commands update with the desktop application.

This is an incremental 0.4.x update with no new manual migration step. Preview capabilities may change between releases and should not be treated as stable interfaces or general-availability commitments.

[Full changelog](https://github.com/KunAgent/Kun/compare/v0.4.0...v0.4.1)
