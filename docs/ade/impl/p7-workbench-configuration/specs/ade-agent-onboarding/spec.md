## ADDED Requirements

### Requirement: Agent list and detail identity
Agent 管理 SHALL 使用稳定 harness ID 关联列表、详情、模型和连接操作；已添加列表可见性不得替代执行准入。

#### Scenario: Reorganize the visible list
- **WHEN** 用户调整已添加 Agent 的显示或排序
- **THEN** 历史线程和已有 route 保持身份不变，不能因隐藏而停用

### Requirement: Capability-aware model source selection
模型菜单 SHALL 仅展示当前 Agent 的合法来源组合，选择后原子保存完整 route。

#### Scenario: Same model from two sources
- **WHEN** 两个来源提供同名模型
- **THEN** 它们分别标注来源，保存后的实际 route 与选中项一致

### Requirement: Three-step onboarding with recoverable context
添加 Agent SHALL 提供选择、连接、检查完成流程；去终端或来源配置后保留步骤、非敏感输入和返回位置。

#### Scenario: Return from installation terminal
- **WHEN** 用户从向导进入预填安装命令的终端后返回
- **THEN** 向导继续针对原 Agent 重新检查，不能仅因终端已打开就标安装成功

### Requirement: Credential ownership
向导 SHALL 复用既有账号、凭据与认证能力，API Key 在模型来源维护，CLI 登录由对应认证流程完成。

#### Scenario: Native login is selected
- **WHEN** 用户选择支持的本机账号路径
- **THEN** 不要求配置无关 gateway，不复制或输出第三方登录秘密

### Requirement: Distinct connection and trial checks
安装检测、协议握手和模型试运行 SHALL 分别记录；非试运行检测不得自动产生模型请求。

#### Scenario: Handshake succeeds
- **WHEN** Agent 完成协议握手但未发真实模型输入
- **THEN** UI 只声明连接已确认，真实试运行是独立操作

### Requirement: Versioned operations and stale test results
探测/认证操作 SHALL 关联对象、连接指纹和操作代次；配置变化或取消后迟到结果不得覆盖当前状态。

#### Scenario: Edit command during a probe
- **WHEN** 旧命令探测未完成时用户保存新命令
- **THEN** 旧结果不把新命令标为可用，测试状态标记需要重新检查

### Requirement: Save unavailable custom Agents without false readiness
允许保存未就绪条目时系统 SHALL 明示未就绪状态，重复完成不得创建重复条目，终端 Agent 不得获得不具备的结构化能力。

#### Scenario: Save a terminal-only Agent
- **WHEN** 用户添加仅支持终端的命令
- **THEN** 可在终端入口使用，结构化 worker/聊天入口显示其真实限制

### Requirement: Disable and remove preserve history
停用或移除 SHALL 说明对后续执行的影响并保留历史身份；这些操作不得隐式停止已接受轮次或删除会话。

#### Scenario: Remove a referenced custom definition
- **WHEN** 用户移除仍被历史线程引用的自定义 Agent
- **THEN** 历史仍可查看，继续执行显示明确配置缺失，不能回落到另一 Agent 冒充续接
