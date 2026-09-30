## ADDED Requirements

### Requirement: Application-styled protected approval
工具审批 SHALL 使用 Kun 自有受控窗口，与产品主题和语言一致，不调用操作系统 MessageBox。
宿主 SHALL 提供真实审批内容，保留单次授权边界，扩展 Webview 和主工作台 DOM 不能代替受控窗口作出确认。

#### Scenario: Review a file operation
- **WHEN** 用户请求允许待处理文件操作
- **THEN** 窗口展示工具/会话、完整文件目标、作用目录与仅本次授权说明；哈希编号和实现术语不占主要内容

#### Scenario: Cancel or close
- **WHEN** 用户取消、关闭或按 Escape
- **THEN** 审批继续待处理，不隐式拒绝或批准，不修改未来权限

#### Scenario: Approval changes while open
- **WHEN** 确认窗口打开后审批已处理、动作内容变化或来源页面失效
- **THEN** 旧窗口不能授权新动作，宿主重新校验内容、来源与运行时会话后才可提交

#### Scenario: Untrusted content attempts approval
- **WHEN** 扩展内容、子 frame 或其他窗口尝试伪造确认
- **THEN** 宿主拒绝不匹配的窗口/frame/nonce，不生成有效授权 token

### Requirement: Distinct execution reading and acceptance facts
系统 SHALL 分别保留执行、阅读、控制权、验收和工作区状态；展示分组由共同投影产生，不能改写 runtime 事实。

#### Scenario: Read an unreviewed result
- **WHEN** 用户读过已结束但未验收的成果，且经过原完成项衰减时间
- **THEN** 未读提示可消失，待验收事项仍保留

### Requirement: Actionable attention items
待处理事项 SHALL 使用稳定请求身份、真实原因和匹配操作，未读消息不得单独成为必须处理的事项。

#### Scenario: Failed Agent launch
- **WHEN** Agent 启动失败
- **THEN** 卡片显示查看错误或修复连接，不使用“去审批”冒充失败恢复

#### Scenario: Concurrent question answers
- **WHEN** 桌面和手机尝试回答同一已解决问题
- **THEN** 返回当前已解决结果或过期冲突，不投递第二份答案

### Requirement: Review target is explicit
审查视图 SHALL 明确 workspace、可选 worker/dispatch、范围和成果版本，不由全局活动会话隐式推断。

#### Scenario: Inspect another worker while reviewing
- **WHEN** 用户改变 worker 预览选择但没有改变审查目标
- **THEN** 当前 diff 和批注仍绑定原目标，不能悄悄切到另一工作区

### Requirement: Evidence-bound verdict validity
检查、审查发现和验收 SHALL 绑定成果版本；新内容使旧结论失去当前有效性，历史裁决保持可读。

#### Scenario: Working tree changes without a commit
- **WHEN** 验收通过后文件发生 staged、unstaged 或 untracked 变化而 HEAD 不变
- **THEN** 旧结论标为过期，不能继续代表当前成果

#### Scenario: Incomplete fingerprint
- **WHEN** 文件扫描超时、超限或无法稳定读取成果
- **THEN** 当前有效性为未知，保留历史证据且不宣称当前通过

### Requirement: Batch revision requests preserve anchors
用户批注 SHALL 保存目标与版本，修改后重新定位或明确过期；批量发送携带收件人、固定批注集合和幂等键。

#### Scenario: Retry sending review notes
- **WHEN** 批注发送回执丢失后用户重试
- **THEN** 同一请求不会重复派工，发送结果仍关联原批注集合

### Requirement: Integration checks the selected source and destination
合入 SHALL 基于当前目标和版本预检，在执行时重检 source/target，保持用户源目录未提交内容不变。

#### Scenario: Target branch changes after preview
- **WHEN** 预检后目标 HEAD 或工作目录状态发生变化
- **THEN** 旧预检失效，系统要求刷新并展示差异，不自动重放合入

### Requirement: Team summaries are not synthetic merge workspaces
团队结果汇总 SHALL 清楚区分多个 worker 工作区与实际存在的集成结果。

#### Scenario: No integration workspace exists
- **WHEN** 多个 worker 均有改动但尚未生成集成结果
- **THEN** UI 展示分别审查入口和统计，不把拼接 diff 当作可一键合入的成果

### Requirement: Restored and paginated state remains truthful
恢复未确认的活动及未加载的历史 SHALL 明确标记，摘要接口的截断不能被解释为事项已完成。

#### Scenario: Old pending dispatch is outside recent overview
- **WHEN** 待验收 dispatch 不在最近 overview 返回范围
- **THEN** 系统通过有界待办投影或分页保留其可见性，不因缺失而清除
