## ADDED Requirements

### Requirement: Field ownership and allowed overrides
系统 SHALL 使用明确字段白名单解析 Agent 默认、项目覆盖、任务快照和下一轮选择；凭据、程序路径及全局准入不得被项目文本覆盖。

#### Scenario: Reject an unsupported project field
- **WHEN** 项目覆盖请求包含 Agent 可执行路径或明文凭据
- **THEN** 宿主拒绝该字段并保留当前配置，不能把它带入启动环境

### Requirement: Canonical project identity
项目默认值 SHALL 按宿主确认的项目身份保存，worktree 关联来源项目，目录显示名称不得作为唯一 key。

#### Scenario: Equal names with different paths
- **WHEN** 两个项目目录末级名称相同
- **THEN** 两组设置相互独立，界面显示可区分的路径

#### Scenario: Multiple worktrees
- **WHEN** 用户查看同一仓库的两个受管 worktree
- **THEN** 它们使用同一来源项目默认，并各自保留实际执行路径

### Requirement: Immutable execution snapshots
系统 SHALL 在任务/轮次准入时保存有效配置及来源；后续全局更改不得改写已接受轮次或队列项。

#### Scenario: Change global model during a running task
- **WHEN** 用户在任务执行和消息排队期间更改全局默认模型
- **THEN** 当前轮次及既有队列使用原快照，新任务使用新默认

### Requirement: Restore inheritance explicitly
恢复继承 SHALL 删除覆盖字段并由宿主解析当前上层值，返回新快照和生效边界。

#### Scenario: Restore project default on an existing task
- **WHEN** 用户对任务模型选择恢复项目默认并保存
- **THEN** 系统为下一轮建立匹配当前项目默认的快照，旧轮次记录保持原值

### Requirement: Conditional persistence and application receipts
设置写入 SHALL 校验对象 revision；runtime 应用结果 SHALL 关联 generation 和配置 revision，持久化成功与应用成功分别呈现。

#### Scenario: Concurrent edits
- **WHEN** 两个窗口基于同一 revision 修改同一 Agent
- **THEN** 首个有效提交成功，迟到提交返回冲突及最新摘要，并保留本地草稿

#### Scenario: Runtime is offline after save
- **WHEN** 设置已持久化但 runtime 无法应用
- **THEN** UI 显示已保存待应用，重试应用不再次覆盖已保存的新值

### Requirement: Permission ceilings remain authoritative
有效权限 SHALL 继续由宿主授权及 worker/profile/harness 上限决定，设置继承不得绕过既有升级确认或无人值守限制。

#### Scenario: Wider global permission after worker creation
- **WHEN** 已有 worker 执行期间全局权限放宽
- **THEN** worker 已冻结权限不扩大，后续请求仍按其合法快照准入

### Requirement: Team limits reflect actual semantics
系统 SHALL 将 `hardWorkers` 表达为活跃 worker 上限，并按既有受控操作执行 token 预算检查。

#### Scenario: Reduce a team limit
- **WHEN** 用户把上限降低到当前活跃数量以下
- **THEN** 现有 worker 不被删除或强停，后续创建被限制，UI 不宣称已降低正在运行数量

### Requirement: Legacy data remains readable
缺少来源或快照字段的历史线程 SHALL 保留原执行语义并标为历史配置，迁移只在明确修改或新建时发生。

#### Scenario: Open a historical thread
- **WHEN** 用户打开没有新设置字段的旧 ADE 线程
- **THEN** 可读取历史和继续兼容操作，不扫描回填全部线程，不虚构项目来源
