## ADDED Requirements

### Requirement: Shared invocation resolution
发现、模型探测、连接测试和真实执行 SHALL 使用同一宿主程序与环境解析规则，并关联有效 transport 和连接指纹。

#### Scenario: GUI has a sparse PATH
- **WHEN** GUI 初始 PATH 不包含用户已安装的 Agent
- **THEN** 使用既有受控 shell/path 和安装位置发现机制，明确实际程序来源，不把暂未发现当成协议失败

#### Scenario: Binary override changes
- **WHEN** 用户保存新的程序路径
- **THEN** 模型探测与下次启动均使用新路径，旧就绪缓存不能证明新程序可用

### Requirement: Effective transport metadata is coherent
transport 选择 SHALL 同时决定检测、启动、模型探测、权限、能力及安装修复提示。

#### Scenario: Codex native path without an ACP adapter
- **WHEN** Codex 原生 app-server 路径满足版本与准入且用户未显式固定 ACP
- **THEN** 新任务使用经过验证的原生默认路径，不因缺少 codex-acp 阻断或提示安装无关适配器

#### Scenario: Explicit ACP compatibility route
- **WHEN** 用户显式选择仍受支持的 ACP 兼容路径
- **THEN** 系统保持该路径并显示匹配要求，不静默换成原生会话或丢失旧 session 绑定

### Requirement: Stage-specific and route-scoped readiness
系统 SHALL 分开记录程序、版本、握手、账号、模型与真实轮次结果；单个来源失败不得把其他来源的 Agent 路径一起禁用。

#### Scenario: Gateway model returns an error
- **WHEN** 某 gateway route 返回 401 或模型 404
- **THEN** 错误归到对应来源/模型并提供修复动作，不统一记成握手失败或静默切换计费渠道

### Requirement: Unknown state does not imply confirmed failure or success
探测超时或账号状态不明 SHALL 显示未确认和可恢复操作，不能推导为已登录、未安装或不可恢复失败。

#### Scenario: Slow cold startup
- **WHEN** 安装已确认但协议冷启动超出探测时间
- **THEN** 显示连接暂未确认及重试，保留已有数据，不无限转圈

### Requirement: Generation-fenced connection operations
probe、认证和启动结果 SHALL 关联 invocation fingerprint 与操作代次，旧回执不得覆盖新配置或取消结果。

#### Scenario: Authentication result arrives after cancellation
- **WHEN** 用户取消旧登录并开始新的连接流程
- **THEN** 旧结果只可更新其自身审计记录，不能完成新流程或改变当前 Agent 选择

### Requirement: Structured and terminal support remain distinct
Agent 可用性 SHALL 分别表达一对一、worker、Graph 和终端用途，不以终端能启动证明结构化协议已经接通。

#### Scenario: Only terminal operation works
- **WHEN** 某 Agent 当前只验证了终端路径
- **THEN** UI 提供明确的终端入口，结构化能力保持未支持或未验证，不能把它作为自动降级冒充原任务成功

### Requirement: No silent Agent or credential fallback
连接失败 SHALL 保留用户选定的 Agent 和来源，任何切换必须通过既有明确选择/交接流程。

#### Scenario: Native login fails
- **WHEN** 本机账号请求失败但存在可用 gateway
- **THEN** 提示可选择的恢复路径，不自动改用 gateway 或 Kun 执行原输入

### Requirement: Real connection acceptance per public Agent
每个公开支持的 Agent 路径 SHALL 有版本明确的真实首轮、输出、停止和下一轮证据；宣称 worker 支持还需真实派工与回报验证。

#### Scenario: Missing local account during acceptance
- **WHEN** 某路径缺少所需账号而无法测试
- **THEN** 记录未执行及条件，不能以 fixture 或握手通过标为真实端到端通过
