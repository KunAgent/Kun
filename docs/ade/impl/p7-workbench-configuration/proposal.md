## Why

用户已决定将 ADE 与 Code 融合到同一页面。现有 agent 接入、派工、工作区和审查需要进入 Code 已有交互，减少模式选择和重复面板，并明确设置归属、执行授权及历史迁移。

## What Changes

- 移除独立 ADE 模式与展示外壳，统一到 Code 路由、项目列表、新建任务和搜索归档。
- 复用输入框原 Code/设计入口选择 Kun 模式或其他 Agent，输入框“＋”按需允许协作，实际派工后出现摘要；审查扩展现有改动面板。
- Agent 接入和协作默认进入现有助手设置，模型来源与 Worktrees 使用既有入口，不新增 ADE 配置类别。
- 明确全局默认、项目本机覆盖、当前任务快照、下一轮临时选项的字段白名单，显示来源、生效时机、保存和应用状态。
- 将 Agent 管理收敛为列表和详情，提供添加、连接、检查、默认值流程；模型来源与账号维护复用已有入口。
- 整合已有 ADE 草稿和工作区选择改动，统一新建任务入口，保留发送快照、附件和工作区准备的幂等性。
- 分离主任务、worker 预览和审查目标，支持在主任务内查看 worker，再显式接管或完整打开。
- 区分执行、控制权、阅读、验收、工作区状态，提供一致的待处理投影和针对性操作。
- 将成果版本纳入审查与验收有效性，连接批量批注、返工、复查和明确目标的合入操作。
- 补齐迁移、旧入口重定向、功能开关、窄布局、键盘、多端展示与真实 agent 验收。
- 将截图中的接入故障列为前置修复：统一程序发现、effective transport、探测与实际启动环境，逐 Agent 核验到真实轮次。
- 统一 Agent 品牌图标、本地离线资源和状态槽，移除原始 credentialMode 文案，未就绪条目保留修复操作。
- 工具审批、执行权限变更和通用业务提示采用 Kun 自有弹窗，保留独立宿主授权边界、取消语义和最终内容重验。

不增加第二个宿主 runtime，不重写已有适配器。Code 常规操作保持直接，复杂能力按需展开；历史 `workspaceMode` 与显式协作授权解耦。实现与验收进度见 implementation-status.md；最新入口修订见 Code 融合设计。

## Capabilities

### New Capabilities

- `ade-configuration-navigation`: 统一配置入口、页面结构、作用域标识和返回上下文。
- `ade-scoped-execution-settings`: 字段归属、覆盖解析、任务快照、并发保存、生效回执和迁移。
- `ade-agent-onboarding`: Agent 列表详情、添加连接流程、模型来源、能力和状态提示。
- `ade-task-workbench`: 新建任务、工作区准备、主任务与 worker 视图、输入和控制权。
- `ade-attention-review-lifecycle`: 待处理、已读、验收、成果版本、批注和合入生命周期。
- `ade-agent-connectivity`: Agent 启动计划、分阶段就绪、路由一致性和真实接入验证。
- `ade-agent-branding`: Agent 品牌资源、共享图标、语义文案和未就绪条目可达性。
- `unified-code-workbench`: Code 单页面、渐进呈现、联合历史、协作授权及单一工作区归属。

### Modified Capabilities

无。当前 `openspec/specs/` 没有上述 ADE 能力的主规格；已有 ADE 文档和代码作为实现基线，本变更补充其交互契约。

## Impact

- Renderer：ADE、Settings、workbench、composer、workers、review、mission-control、相关 stores 和中英文文案。
- Shared / Main：设置类型与规范化、严格 IPC、模型来源引用、项目身份、设置保存与 runtime 应用回执。
- Kun：可选设置快照契约、有效值解析、线程和团队设置操作、活动投影、验收版本及集成预检。
- 存储：通过现有 SettingsStore / Service Manager 写入通道增量扩展；线程和团队记录使用向后兼容字段，保留全部历史数据。
- API：优先扩展现有 harness、thread、team、review、task-workspace 接口；确需新增的接口在 [contracts.md](contracts.md) 中明确标为提案。
- 文档：最新决策见 [Code 融合设计](../../14-code-workbench-integration.md)，取代旧独立页面方案；P4-P6 底座继续复用。
- 完整执行导航：[implementation-plan.md](implementation-plan.md)；界面细则：[configuration-ui.md](configuration-ui.md)；验收：[acceptance.md](acceptance.md)。
- 接入问题和图标的源码证据、逐 Agent 修复及 B01-B04 前置批次见 [agent-connectivity.md](agent-connectivity.md)。
