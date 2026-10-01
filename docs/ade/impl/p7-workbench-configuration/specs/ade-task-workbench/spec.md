## ADDED Requirements

### Requirement: One Code task draft
新建任务 SHALL 沿用 Code 草稿，无需先选择一对一/总管；调整模式入口中的 Agent 或按需允许协作时保留输入、项目和附件。

#### Scenario: Select another Agent
- **WHEN** 用户输入目标并添加图片后在输入框 Agent/模式菜单中选择另一 Agent
- **THEN** 草稿和文件引用不丢失，计划/执行及项目选择保持原语义

### Requirement: Frozen creation and preparation intent
任务创建 SHALL 冻结项目、起点、route、执行选项及附件，准备就绪后只投递匹配意图一次。

#### Scenario: Navigate while preparing
- **WHEN** 工作区准备期间用户切换到另一个项目
- **THEN** 原任务仍在原冻结目录准备，迟到事件不改新页面或产生重复消息

#### Scenario: Retry after preparation failure
- **WHEN** 用户重试失败的工作区准备
- **THEN** 原草稿和附件保留，宿主以 requestId/workspace generation 防重复创建和投递

### Requirement: Independent task inspector and review target
主任务、worker 预览和审查目标 SHALL 使用显式且相互独立的上下文。

#### Scenario: Open worker preview
- **WHEN** 用户单击 Workers 面板中的 worker
- **THEN** 在侧面查看该 worker，主任务 threadId、输入草稿和滚动位置不变

### Requirement: Explicit full navigation and return
完整打开 worker SHALL 记录父任务与面板上下文并提供返回。

#### Scenario: Return to the manager
- **WHEN** 用户完整打开 worker 后返回父任务
- **THEN** 恢复父任务原面板、选中对象和滚动锚点，不重新清空输入

### Requirement: Thread-scoped composers and queues
每个可输入会话 SHALL 独立持有草稿、附件、队列和发送目标，并显示接收者与生效时机。

#### Scenario: Compose in manager and worker
- **WHEN** 用户分别在总管和 worker 输入不同内容并切换
- **THEN** 两份草稿和队列各归原线程，右侧选中变化不修改主输入收件人

### Requirement: Host-confirmed control transitions
查看、接管、停止、交还 SHALL 是不同动作，UI 只能依据宿主匹配回执更新权威状态。

#### Scenario: Take over a running worker
- **WHEN** 用户接管正在执行的 worker
- **THEN** 接管不会隐式停止当前轮，后续发送依能力插话或排队，经理派工遵循接管限制

### Requirement: Capability-specific running input
运行中的输入 SHALL 按实际 capability 显示队列、插话和停止，不支持的操作说明原因。

#### Scenario: Agent cannot steer
- **WHEN** 用户在不支持 same-turn steer 的 Agent 执行时输入
- **THEN** 可排队并管理队列，系统不能假装已插入当前轮

### Requirement: Closed views do not own execution lifetime
关闭面板 SHALL 只释放对应视图资源，不停止会话执行；应用退出继续遵循既有进程生命周期。

#### Scenario: Hide a worker panel
- **WHEN** 用户切换工具面板
- **THEN** 隐藏 worker 的重型渲染暂停，执行及必要状态继续，草稿和游标保留
