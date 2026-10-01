## ADDED Requirements

### Requirement: Canonical configuration in existing settings
系统 SHALL 复用 Code 现有设置壳和助手/模型来源/Worktrees 入口，Agent 接入和协作使用同一对象与保存协议，不新增独立 ADE 配置导航。

#### Scenario: Open from either entry
- **WHEN** 用户从 Code 输入框原模式菜单或现有助手设置进入同一 Agent
- **THEN** 页面展示同一已保存配置和同一作用域，而非两个独立副本

### Requirement: Contextual deep links
系统 SHALL 支持 Agent 选择器、项目菜单、任务标题栏和故障恢复动作的精确设置目标，并保存返回上下文。

#### Scenario: Return after managing a model source
- **WHEN** 用户从 Agent 详情打开模型来源并返回
- **THEN** 返回原 Agent，保留未保存字段、原任务草稿、附件和面板位置

#### Scenario: Legacy settings link
- **WHEN** 旧 `agentsHarnesses` 入口被打开
- **THEN** 重定向到统一 Agents 页签且保留原返回目标

### Requirement: Explicit scope and application boundary
系统 SHALL 在全局、项目和任务配置容器中显示对象身份、作用域及生效边界。

#### Scenario: Inspect worker while editing task settings
- **WHEN** 主任务内正在预览 worker，用户打开主任务设置
- **THEN** 编辑目标仍为明确标识的主任务，不能由预览选择隐式改变

### Requirement: Draft persistence and deliberate save
ADE 配置 SHALL 使用对象级编辑草稿，只有明确保存才提交；内部导航不得触发旧的自动保存或 unmount flush。

#### Scenario: Switch Agent objects
- **WHEN** 用户修改 Agent A 的路径后查看 Agent B 再返回
- **THEN** A 的草稿保留，runtime 未因该编辑重启或重新探测

#### Scenario: Leave the configuration workspace
- **WHEN** 用户关闭含未保存草稿的配置工作区
- **THEN** 系统提供保存、放弃和继续编辑，只有被选择的操作生效

### Requirement: Local project preferences and repository declarations
项目设置 SHALL 分开展示和保存本机覆盖与 `.kun/project.json` 仓库声明，并保持既有批准边界。

#### Scenario: Save local model preference
- **WHEN** 用户保存项目本机模型默认值
- **THEN** 只更新本机项目记录，仓库文件、MCP、Skills 和 grants 不变

### Requirement: Responsive and accessible configuration
配置页面 SHALL 在窄布局下重排对象列表和详情，支持键盘、焦点返回、IME、明暗主题及中英文。

#### Scenario: Narrow display and long content
- **WHEN** 页面宽度为 320px 且字段含长模型名、路径和错误
- **THEN** 无页面横向溢出，保存与恢复动作可达，完整字段内容可查看

### Requirement: Existing mode compatibility
配置导航 SHALL 保持普通 Code、Work、Design 的能力边界，新增协作开关不成为历史会话可见性的条件。

#### Scenario: ADE is disabled
- **WHEN** 新协作能力关闭
- **THEN** 所有历史 Code/ADE 会话仍在统一 Code 页可访问，普通发送及在途请求必要控制可用
