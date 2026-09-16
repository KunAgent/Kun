## Why

Kun 当前以摘要和保留尾部历史控制上下文大小，长任务中的早期细节需要经过摘要转述。增加可选的窗口式上下文管理，让模型感知剩余空间、主动保存工作笔记并切换窗口，再按需检索历史，为长任务提供另一种连续工作方式。

## What Changes

- 设置增加“窗口式上下文（实验性）”独立开关，`agents.kun.contextCompaction.windowModeEnabled` 默认 `false`；旧配置和升级用户保持现有摘要路径。
- 开启后提供窗口预算提示、`new_context`、历史查询和持久笔记工具；切换窗口不调用摘要模型，不自动携带旧对话全文或旧摘要。
- 历史和笔记由本地 Service Manager 管理，保留完整可见对话并支持重启、恢复和分叉；不依赖 Codex 私有后端。
- 保留现有摘要配置、手动 `/compact` 和关闭开关后的摘要路径；开启期间自动上下文压力使用窗口策略，硬容量检查继续生效。
- 在现有时间线呈现窗口切换，避免与摘要压缩混淆。

## Capabilities

### New Capabilities

- `opt-in-context-windows`: 默认关闭的设置、预算提示、无摘要窗口切换、恢复和摘要兼容策略。
- `context-history-notes`: 按窗口访问本地历史及线程隔离的持久工作笔记，包含容量、授权和生命周期规则。

### Modified Capabilities

无。当前正式规格仅覆盖长期记忆等能力；工作笔记不修改或替代长期记忆。

## Impact

- Shared settings、Main runtime config 映射、Kun config/turn contracts、工具注册和执行、模型请求预检、上下文投影与溢出恢复。
- Service Manager 标准数据与 SessionStore、历史提交协调器、fork/resume、事件契约与 Renderer 时间线和设置。
- 不新增运行时、供应商依赖或远端服务；不更改 provider URL/endpoint 行为。
- 参考：[预算提示 PR #27438](https://github.com/openai/codex/pull/27438)、[无摘要窗口 PR #27488](https://github.com/openai/codex/pull/27488)、[历史与笔记 PR #39827](https://github.com/openai/codex/pull/39827)。具体本地适配决策见 design.md。
