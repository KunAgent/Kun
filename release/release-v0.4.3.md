# Kun 0.4.3

0.4.3 让计划执行与多 Agent 协作更顺手：在计划卡片中选择执行 Agent，为任务分派填写 Agent 与模型偏好，并在侧栏查看工作 Agent。账户与设置入口进一步整合，新增会员兑换与状态刷新，支持 MiniMax-M3.1-Flash，同时减少计划工作区的磁盘占用，改善工具调用、审批和历史会话的稳定性。

## ✨ 新功能

- **计划执行 Agent 选择**：在计划卡片中选择负责执行的 Agent，让计划交给合适的引擎完成。
- **任务分派与协作**：支持填写 Agent 与模型分派偏好，侧栏在父会话下展示工作 Agent，方便查看协作进展。改进中断子任务的续接；调整分派选择时暂停倒计时，切换的 Agent 会正确应用。
- **账户与会员入口**：账户卡片与设置整合到侧栏底部的统一入口，支持会员兑换与会员状态刷新。回到应用时会重新获取会员权益信息。
- **更轻量的计划工作区**：计划构建工作树通过写时复制复用已有依赖，减少重复安装与磁盘占用。增加已合并空闲工作树的自动清理，并在可用磁盘空间不足 5 GB 时阻止新建计划构建工作树。
- **MiniMax-M3.1-Flash**：MiniMax 官方 API 与 Token Plan 模型目录新增 MiniMax-M3.1-Flash。同步适配推理强度选项与用量计价。

## 🐛 修复与改进

- **工具调用稳定性**：阻止反复执行相同失败工具调用的循环，避免任务持续重复无效操作。
- **大型会话历史**：修复大型持久化事件的回放，改善重新打开历史会话时的数据恢复。
- **外部 Agent 分派**：补齐 Codex 与 Pi 工作 Agent 的传输注册，并修正 Qoder ACP 权限协商与启动时的权限设置。
- **审批流程**：提交工具审批选择时不再重复弹出确认对话框，并避免第三方 Agent 模型参与自动审批审查。
- **附件与实时引导**：向 ACP Agent 传递文档附件中的文本，并在实时引导未被接受时保留引导内容。
- **计划执行边界**：没有生成计划文件时，不再继续自动构建，避免普通问答触发计划执行。
- **协作与对话显示**：默认保留协作历史的查看入口，侧栏工作 Agent 使用对应标志而非首字母。窄面板中的回复统计与操作支持换行。

---

## English

Kun 0.4.3 makes plan execution and multi-agent collaboration easier: choose an Agent on the plan card, write Agent and model preferences for dispatch, and find workers under their parent conversation in the sidebar. Account and Settings now share one entry area, with membership redemption and refreshed entitlement status. This release also adds MiniMax-M3.1-Flash, reduces plan-worktree disk use, and improves tool calls, approvals, and conversation history.

### Features

- **Choose the plan execution Agent**: Choose the Agent that executes a plan directly on its card.
- **Task dispatch and collaboration**: Write Agent and model preferences for dispatch and find workers under their parent conversation in the sidebar. Interrupted child tasks resume more reliably; adjusting a dispatch pauses its countdown, and Agent changes are applied correctly.
- **Account and membership access**: Account and Settings share a unified sidebar footer, with membership redemption and status refresh. Entitlements refresh when you return to the app.
- **Lighter plan worktrees**: Plan-build worktrees reuse existing dependencies through copy-on-write cloning to reduce repeated installs and disk use. Merged idle worktrees are cleaned up automatically, and new plan-build worktrees are blocked when less than 5 GB is available.
- **MiniMax-M3.1-Flash**: Added MiniMax-M3.1-Flash to the official MiniMax API and Token Plan catalogs, with matching reasoning-effort options and usage pricing.

### Fixes and improvements

- **Tool-call stability**: Stop loops that repeatedly make the same failed tool call instead of progressing.
- **Large conversation history**: Fixed replay of large persisted events to improve recovery when reopening conversation history.
- **External Agent dispatch**: Registered Codex and Pi worker transports and corrected Qoder ACP permission negotiation and startup permissions.
- **Approval flow**: Submitting a tool approval choice no longer opens a second confirmation dialog, and third-party Agent models are excluded from automatic approval review.
- **Attachments and live guidance**: Pass document attachment text to ACP Agents and preserve guidance that is not accepted during a live turn.
- **Plan execution boundaries**: Automatic builds no longer proceed when no plan file was written, keeping ordinary answers from triggering plan execution.
- **Collaboration and chat display**: Keep collaboration history accessible by default and show worker Agent logos instead of initials in the sidebar. Response metrics and actions wrap in narrow panes.

[Full changelog](https://github.com/KunAgent/Kun/compare/v0.4.2...v0.4.3)
