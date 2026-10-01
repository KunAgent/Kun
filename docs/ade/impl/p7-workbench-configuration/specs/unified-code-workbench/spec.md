## ADDED Requirements

### Requirement: One Code workbench
系统 SHALL 将 Agent、协作和审查能力融合到现有 Code 页面，复用侧栏、会话、输入框、工具面板和终端，不提供独立 ADE 模式入口。

#### Scenario: Start ordinary work
- **WHEN** 用户进入 Code 并新建任务
- **THEN** 可以直接选项目和输入发送，不需要先选择一对一/总管/Agent 团队或经过配置向导

### Requirement: Progressive capability presentation
协作 SHALL 通过已有加号菜单/任务设置按需允许，实际派工后才显示进度摘要，不自动展开空团队面板。

#### Scenario: First worker is created
- **WHEN** 允许协作的任务产生第一个 worker
- **THEN** 出现紧凑摘要，用户当前文件、焦点和面板不被抢占

### Requirement: Agent selection reuses the mode entry
Agent 选择 SHALL 使用输入框原 Code/设计入口。Kun 分组提供 Code 和设计，外部 Agent 直接显示自身名称与品牌。供应商/模型菜单 SHALL 保留原结构且不重复 Agent 选择。

#### Scenario: Switch from Kun Design to Devin
- **WHEN** 用户已有草稿和附件，选择 Devin
- **THEN** 草稿、附件、项目保留，退出 Kun 设计/计划/Graph 意图，下一条普通输入由 Devin 执行

#### Scenario: Keep a frozen queued Design turn
- **WHEN** Kun Design 消息已排队，用户改选外部 Agent
- **THEN** 队列仍按原 Kun/Design 快照执行，当前选择只影响后续输入

#### Scenario: Select models in an existing Agent conversation
- **WHEN** 用户打开右侧模型/供应商菜单
- **THEN** 沿用原菜单结构，只显示选中执行者兼容的来源，不以模型选择悄悄更换 Agent

### Requirement: Kun authoring capabilities are enforced by the host
Kun 设计、画布、计划和 Graph lead 意图 SHALL 仅在有效 Kun 路由执行。外部普通编码及既有 Graph worker 能力边界 SHALL 保留。

#### Scenario: An older client submits external Design intent
- **WHEN** 旧客户端或直接 API 请求把 Devin 与 Kun Design 标志组合
- **THEN** 宿主在创建执行副作用前明确拒绝，不能仅靠新 UI 隐藏入口

### Requirement: Unified history preserves identity and complete pagination
统一 Code 列表、搜索、归档、fork 和通知 SHALL 覆盖旧 Code/ADE 会话并保留原 ID、消息和父子关系，使用一致分类和分页。

#### Scenario: Open an old ADE notification
- **WHEN** 用户点击旧 ADE 会话通知
- **THEN** 在统一 Code 页打开原线程，而非创建副本或跳转到独立页面

#### Scenario: Search across more than one page
- **WHEN** 项目同时包含超过一页的旧 Code 和 ADE 会话
- **THEN** 排序和 cursor 覆盖完整联合结果，不漏项或重复拼接第一页

### Requirement: Collaboration authorization is independent of page identity
持久团队的工具广告和执行 SHALL 共同检查显式策略、有效 Kun harness、工作表面、角色及宿主权限，不由页面 route 或历史 workspaceMode 单独授予。

#### Scenario: Open an ordinary Code thread after upgrade
- **WHEN** 用户打开未允许持久协作的旧 Code 任务
- **THEN** 页面融合不自动赋予新团队派工权限，已有普通子代理行为保持

#### Scenario: Managed worker attempts manager tools
- **WHEN** 被管理 worker 或 Rooms agent 位于可查看的 Code 表面
- **THEN** 仍不能因统一页面而获得不合法的 Manager 工具

### Requirement: Explicit coordination handoff
外部主 Agent 的任务启用 Kun 协作 SHALL 使用明确交接，运行团队切换主 Agent 时必须维持明确管理归属。

#### Scenario: Enable collaboration in a Codex conversation
- **WHEN** 用户请求在 Codex 主会话使用由 Kun 协调的团队
- **THEN** 系统解释并执行明确交接，不能静默替换 Agent 或使已有团队失去管理者

### Requirement: One workspace owner per execution unit
统一输入与计划执行 SHALL 为每个执行单元解析一个工作区创建/生命周期 owner，不能同时启动两套 worktree 流程。

#### Scenario: Build inside a host-managed task workspace
- **WHEN** 已绑定宿主任务工作区的任务开始计划构建
- **THEN** 不再次注入同一执行单元的工作区创建协议，Graph/Code 原有隔离归属不被混用

### Requirement: Existing changes and collaboration surfaces absorb enhancements
审查 SHALL 扩展现有改动入口，协作 SHALL 使用现有右面板并按对象类型呈现能力，不新增功能重复的常驻顶层面板。

#### Scenario: Review an ordinary directory task
- **WHEN** 没有团队工作区的 Code 任务打开改动
- **THEN** 沿用当前目录 diff，只有真实存在检查/批注/工作区目标时才显示对应增强

### Requirement: Feature disablement preserves safe access
关闭高级协作 SHALL 限制新准入但保留历史和已产生请求的必要控制，不隐藏任务或强杀现有执行。

#### Scenario: Disable collaboration with workers in flight
- **WHEN** 已有团队执行期间关闭新协作能力
- **THEN** 用户仍可查看、停止、审批和回答现有请求，新的不允许派工被拒绝

### Requirement: Existing settings remain the canonical entry
配置 SHALL 进入现有助手/模型来源/Worktrees/项目设置，取消单独 ADE 配置类别，同时保持字段作用域与快照契约。

#### Scenario: Manage Agents from the composer
- **WHEN** 用户在 输入框 Agent/模式菜单选择管理 Agents
- **THEN** 打开现有助手的 Agent 接入页并可返回原草稿，不出现第二个 ADE 设置中心
