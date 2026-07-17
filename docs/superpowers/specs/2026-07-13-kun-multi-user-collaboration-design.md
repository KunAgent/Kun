# Kun 多用户协作模块完整设计方案

**日期**：2026-07-13

**状态**：设计评审修订稿（二次优化），已闭环 9 项 P0 + 16 项 P1，补充状态机精度、跨平台安全、客户端恢复与可观测性

**替代对象**：`2026-07-10-kun-multi-user-collaboration-design.md`

**评审依据**：`deliverables/gstack/design-review-kun-collaboration-2026-07-13.md` + `docs/superpowers/specs/2026-07-10-kun-multi-user-collaboration-design-REVIEW.md`

**二次优化依据**：代码库独立核查（9 项事实声明验证）+ 状态机/边界条件/可观测性/可访问性补强

## 1. 执行摘要

Kun 将新增顶层 **Collaboration（异步协作）** 模块，通过用户自行部署的 Kun Collaboration Server，为不超过 20 人的团队提供持久会议空间、结构化协作任务、本地 Agent 协作、接待员工调用和加密产物交付。

本方案的核心边界是：

1. 会议协调是共享的，包括成员、消息、角色、任务请求、参与决策、进度、接待调用状态、交付和审计事件。
2. Agent 执行始终在成员本机完成。每位成员保留自己的 Kun Runtime、项目目录、模型凭据、专家、Skills、MCP 凭据和工具权限。
3. Collaboration Server 只负责身份认证、服务端可见 RBAC、事件排序、密文转发和加密产物存储，绝不成为第二个 Agent Runtime，也不持有 MLS 解密能力。

评审结论为 **有条件通过**。在进入功能实现前，Phase 0 必须完成三项平台技术关卡和一项三客户端协议原型：MLS 选型与客户端跨平台打包、设备私钥安全存储与口令兜底、原生服务端跨平台打包，以及 Add/Remove/重连/篡改拒绝的协议验证。TaskKey 保管权、Outbox 跨 epoch 重加密、任务双维状态 UI、Reception Employee 前置入口和 Phase 2 最小价值闭环属于方案内强制规格，不得在实现时降级或延后。

第一完整版本使用单独安装的原生 `kun-collab-server`。Docker、官方 Kun 云中继、P2P/NAT 穿透、实时共同编辑和远程直接写入工作区不在本期范围内。

## 2. 决策与准入条件

### 2.1 已确定决策

- 新增 `Workbench | Automation | Collaboration` 三个同级工作模式。
- 人类协作使用独立的 `Meeting`、`HumanCollaborationTask` 和 `ReceptionEmployee` 领域，不复用本地专家团队的 `CollaborationPlan`、`CollaborationTask` 或 `collaboration_*` 事件。
- 一个会议对应一个 MLS 群组；任务私密空间另用随机 `TaskKey`；接待调用正文使用调用双方点对点加密。
- `kun serve` 继续保持 loopback-only。远端成员不能直接访问另一个成员的 Kun HTTP/SSE、MCP、工具或工作区。
- 服务端只存储密文及授权必需的最少元数据，不解析或验证 MLS Commit；客户端 MLS 状态机负责群组密码学正确性和前向保密。
- 交付物必须先在接收方本地预览，再由用户显式应用；不存在远程自动写入。
- 权威协议 schema 只定义一次，Renderer 可用类型必须由生成或机械校验保持一致。

### 2.2 Go / No-Go 条件

以下任一条件不成立，停止后续功能实现并回到设计阶段：

- 没有 MLS 候选实现通过官方向量、离线 epoch 追赶和全部 Electron Main 目标平台打包。
- 设备私钥在任一支持平台上只能以明文保存，或 Linux 无钥匙环路径不可用。
- `kun-collab-server` 无法作为独立原生服务在目标平台安装、启动和完成基础握手。
- 三客户端协议原型不能证明 Add、Remove、重连、去重、篡改拒绝和 removed-member 前向保密。

## 3. 现有系统约束

- 本仓库是 `Electron + React + TypeScript` 桌面应用，唯一活动 Agent Runtime 是 `kun/` 中的 Kun。
- Renderer 通过 `window.kunGui` 访问受约束的 preload IPC；长期凭据、网络连接和加密密钥属于 Electron Main，不进入 Renderer。
- `kun serve` 是单用户本地 HTTP/SSE Runtime，不暴露到局域网或互联网。
- `FloatingComposerModePicker.tsx` 当前模式为 `chat | knowledge_qa | task`。`meeting_collaboration` 是新增的上下文模式；`'auto'` 属于 `ExpertTeamCollaborationMode`，不是现有 `ConversationMode` 成员。
- Automation V1 当前是包含可选 `mail` / `social` 字段的单一结构，不是判别联合。V2 必须执行显式归一化迁移，支持按 ID 保存多个员工实例。
- `ToolHostContext` 已支持 `allowedToolNames`、`blockedToolNames`、`sandboxMode`、`approvalPolicy` 和审批回调。接待会话复用这些能力，但使用独立 `receptionSessionContext`，不复用专家团语义的 `collaborationContext`。
- 当前侧边栏只在 Workbench 与 Automation 间切换。新增三模式切换应建立顶层 `SidebarModeSwitch`，不继续扩展 `AutomationSidebarModeSwitch`。
- GUI 内不得新增第二个 Agent Runtime、provider switcher、runtime diagnostics、旧 CodeWhale/Reasonix 路径或第二套设计生成 Runtime。

## 4. 目标与非目标

### 4.1 产品目标

- 用户可在自托管服务端创建持久异步协作主题，并生成可导入的连接凭据。
- 成员可导入凭据、建立设备身份、编辑会议显示名、选择本地项目目录并发布一个会议接待员工。
- 成员可通过结构化 mention 向一个或多个成员发起协作请求。
- 全体会议成员可见每个目标的接受或拒绝状态，但只有目标本人可以决策。
- 所有已接受目标进入同一任务室，同时各自的本地 Kun 历史、工作区和模型执行保持隔离。
- 目标接受任务后，可创建绑定到会议任务的本地 Kun 线程并进入 `meeting_collaboration` 模式。
- 任务参与者可以调用彼此公开的接待员工，但不会获得对方的模型、凭据、MCP 地址、工具 schema 或本地权限。
- 参与者可以手动发布进度，并提交端到端加密的交付包；发起人审阅全部贡献后完成任务。
- 系统支持加密历史、离线重连、可恢复产物上传、自定义会议角色、原生服务备份与恢复。

### 4.2 非目标

- 不提供官方 Kun 托管服务或云中继。
- 第一完整版本不要求或分发 Docker。
- 不实现 P2P、局域网发现、NAT 穿透或成员间直接 socket。
- 不实现实时共同编辑、共享光标、屏幕共享、终端共享或音视频。
- 不允许直接写入其他成员的工作区。
- 不提供企业 OIDC/SSO。
- 一个成员身份不支持多设备。
- 不提供服务端私钥托管或设备密钥恢复。
- 不提供多节点集群或水平扩容。
- 单会议不超过 20 人，单服务端同时在线成员目标不超过 100 人。
- 不复用专家团队协作实体来表达多人会议协作。

## 5. 产品信息架构与交互规格

### 5.1 顶层导航

侧边栏顶层模式为：

```text
Workbench | Automation | Collaboration
```

- 使用新的 `SidebarModeSwitch` 作为三模式共同容器。
- 三项等宽，使用明确图标区分领域；激活态规则一致，不依赖不同颜色表达模式。
- Collaboration 首次进入时明确标注“异步协作”，避免 `Meeting` 被理解为实时会议。
- 人类协作与本地 AI 专家团队使用不同图标和命名，不让用户把两种“协作”混为一谈。

### 5.2 Collaboration 子导航

子导航按用途分组：

```text
会议
  Active meetings（含 Active / Closed 切换）
  Timeline
  Pending invitations

设置
  Server profiles
  Roles
  My Employees
  Notifications
```

- `Create topic` 是 Active meetings 空状态和列表工具栏中的主要命令，不作为常驻子导航。
- `Import credential` 是首次进入 Collaboration 的空状态 CTA；已有配置后，收纳到 `Server profiles > 加入新会议`。
- `My Employees` 与 `Automation > Reception Employees` 使用同一数据源。前者提供会议上下文入口，完整编辑仍落在 Automation。
- Server profiles 属于设置区，不与会议业务视图混排。

### 5.3 双工作面

会议空间与本地 Agent 线程是两个相连但不混合的工作面：

```text
Collaboration
  共享会议时间线
  共享任务室
  成员 / 角色 / 任务状态 / 交付 / 审计
            |
            | 打开我的协作线程
            v
Workbench
  绑定 meetingId + taskId 的本地 Kun 线程
  meeting_collaboration 模式
  本地专家或专家团队
  可调用的远端接待员工
  本地模型、工具、工作区、推理和日志
```

本地协作线程顶部始终显示：

```text
返回会议 > 会议 {名称} > 任务 {摘要} > 我的协作线程
```

任一层级可点击回跳。任务级操作位于线程工具栏末端：`返回会议` 与 `提交协作结果` 成组；模型选择器留在对话配置区，不与任务提交混排。

会议只接收用户显式发布的进度和交付事件。本地模型推理、工具调用、文件读取、草稿和完整 Agent 日志不会自动进入会议。

### 5.4 上下文模式可见性

`meeting_collaboration` 不是普通线程的全局选项。只有同时满足以下条件才可用：

- 线程具有有效 `LocalTaskThreadBinding`。
- 对应参与者仍为 accepted 且未被移除。
- 本地设备持有并验证了所需 `TaskKey`。
- 会议和任务未进入禁止写入的安全恢复状态。

模式入口不得静默消失：

- 普通线程显示不可用原因，例如“此线程未绑定协作任务”。
- 会议关闭、参与资格失效或进入安全恢复时，显示对应 tooltip 和只读状态。
- 已接受但处于 `WAITING_TASK_KEY` 时，Workbench 线程列表显示占位卡片、已等待时长和“重试获取密钥”按钮。
- 重试按钮触发 `task_key_request`，不能创建第二个任务或重复参与者记录。

### 5.5 任务双维状态呈现

任务级 `status` 表示整体流程，参与者级 `contributionStatus` 表示个人贡献。两者必须同时呈现，不把最多 20 余种组合折叠为一个含糊状态。

| 任务状态 | 用户文案 | 视觉语义 |
| --- | --- | --- |
| `proposed` | 待响应 | 中性灰徽章 |
| `active` | 进行中 | 信息蓝徽章 |
| `on_hold` | 已阻塞 | 警示黄徽章，并显示阻塞原因 |
| `review_pending` | 待审阅 | 警示橙徽章 |
| `completed` | 已完成 | 成功绿徽章 |
| `cancelled` | 已取消 | 危险红徽章 |

| 贡献状态 | 用户文案 | 图标语义 |
| --- | --- | --- |
| `not_started` | 未开始 | 时钟 |
| `working` | 进行中 | 旋转进度 |
| `submitted` | 已提交 | 完成勾选 |
| `revision_requested` | 需修改 | 回退箭头 |
| `waived` | 已豁免 | 禁用圆环，并解释“由发起人主动豁免，非参与者责任” |

任务室顶部使用横向 stepper 表达任务级进度，并显示各参与者贡献缩略状态。列表使用紧凑状态列，组合展示任务徽章及 accepted、submitted、waived 数量。所有状态色必须在明暗主题下满足可读对比度，颜色不是唯一信息载体。

**可访问性补充**：

- 会议时间线、任务室、参与者列表和 breadcrumb 全部支持键盘导航（Tab/Shift+Tab/Enter/Escape），不依赖鼠标操作。
- 任务状态变更（accept、decline、submit、key received、security sync required）通过 ARIA live region 向屏幕阅读器播报。
- 状态徽章和图标同时携带 `aria-label` 文本描述，不依赖颜色或纯图标传达语义。
- 双工作面切换（会议 <-> 本地协作线程）时管理焦点：返回会议时焦点回到任务室入口，进入线程时焦点落到消息输入区。

### 5.6 Reception Employee 前置入口

加入会议的流程内必须完成接待员工绑定：

- 已有已发布员工时，选择一个版本绑定到会议。
- 没有员工时，就地显示最小创建表单：名称、专家/专家团队、工作边界。创建后自动绑定。
- 用户可跳转 Automation 完成模型、Skills、MCP、预算等高级配置。
- Active meetings 成员卡片对未配置者显示“配置接待员工”CTA，并预填会议上下文。
- 缺少接待员工不能以无法解释的后端错误阻断用户；界面必须给出可完成的前置路径。

### 5.7 通知

通知覆盖 mention/协作请求、接受/拒绝、加入审批、离线接待调用、调用完成/拒绝、新贡献、修改请求和任务完成。

- 同类通知在 30 秒窗口内合并为摘要，避免多目标同时接受产生通知风暴。
- 优先级为：加入审批 > 离线调用待确认 > 协作请求 > 接受/拒绝 > 产物/完成 > mention。
- 通知深链到准确的会议、任务、调用审批或本地协作线程。
- 锁屏状态只显示通用文本。明文预览是 Server profiles 中按会议独立配置的本地 opt-in，永不进入服务端推送载荷。

### 5.8 国际化与文案

所有用户可见文案（状态徽章、错误提示、tooltip、通知摘要、breadcrumb、诊断面板）通过 i18n 资源键管理，不硬编码字符串。错误码到用户可读消息的映射在 Renderer 侧本地化，不依赖服务端返回文案。会议标题、消息和任务正文等用户生成内容不经过 i18n 管道。

## 6. 系统架构

```text
Renderer
  Collaboration UI + Zustand store
        |
        | Zod 校验的 preload IPC
        v
Electron Main
  CollaborationClient
    IdentityVault
    CryptoEnvelope / MLS Adapter
    MeetingSyncEngine + encrypted Outbox
    ArtifactPackager
    ReceptionGateway
    NotificationBridge
        |                         |
        | TLS + WSS / HTTPS      | loopback HTTP/SSE
        v                         v
Kun Collaboration Server       Local Kun Runtime
  身份与邀请                    HumanTaskContextAdapter
  Meeting + RBAC policy         ReceptionEmployeeExecutor
  Event sequencer               Local AgentLoop
  Presence + routing            Experts / expert teams
  Encrypted blob store          Skills / MCP / ToolHost
  SQLite WAL                    Local project directory
```

### 6.1 Collaboration Server 职责

- 终止 TLS 并维护设备认证的 WebSocket 会话。
- 注册设备公钥，签发绑定设备的短期访问凭证。
- 兑换一次性或团队邀请。
- 存储成员关系、角色、权限键和生命周期元数据。
- 根据认证 actor、会议角色、任务参与者和 expected version 授权命令。
- 为已接受事件分配单调递增 `meetingSeq`。
- 使用稳定 idempotency key 去重事件和命令。
- 存储 MLS 密文及加密产物分块。
- 路由在线接待调用，将离线调用保留为待确认请求。
- 维护 presence、配额、速率和不敏感健康信息。
- 提供原生服务安装、备份、恢复、状态和诊断命令。
- 按 membership 状态和服务端记录的 epoch 执行投递门禁。

服务端不运行模型、Skills、MCP、专家团队或工作区操作，不解密会议正文，也不解析或验证 MLS Commit 签名。客户端必须自行拒绝无效的 MLS 状态转换；服务端的 epoch 门禁不能替代客户端密码学验证。

### 6.2 Electron Main 职责

- 使用 Electron `safeStorage` 保存设备私钥；安全钥匙环不可用时使用口令加密文件。
- 拒绝保存明文身份私钥和长期网络凭据。
- 固定邀请中的 server instance 和 TLS SPKI 指纹。
- 加解密会议、任务、调用和产物载荷。
- 维护已验证事件游标、本地投影和持久化加密 Outbox。
- 通过窄且有 schema 校验的 IPC 向 Renderer 提供协作能力。
- 将已接受任务绑定到本地 Kun 线程。
- 在远端请求进入 Kun 前执行本地接待员工策略。
- 本地构建和检查交付包，用户确认前不上传。

### 6.3 Local Kun 职责

- 创建或恢复绑定 `meetingId` 与 `taskId` 的本地线程。
- 将远端任务文本视为不可信动态上下文，不加入 immutable system prefix。
- 运行用户选择的本地专家或专家团队。
- 用受限 ToolHost 和本地模型运行 ReceptionSession。
- 保持现有审批、sandbox、模型历史、缓存和 tool-result 不变量。
- 将经过脱敏的接待结果交给 Electron Main 加密和传输。

### 6.4 仓库归属边界

- `collaboration-server/`：独立服务端、权威协议、持久化、认证、RBAC、sequencer 和 CLI。
- `src/shared/`：Renderer-safe DTO 镜像、IPC 输入输出、会议模式元数据和 Automation V2 类型。
- `src/main/collaboration/`：identity vault、transport、MLS adapter、sync engine、artifact packager、reception gateway、server profiles。
- `src/preload/`：受限协作桥。
- `src/renderer/src/components/collaboration/`：协作模块 UI。
- `src/renderer/src/store/`：会议/任务 store 与导航动作。
- `src/renderer/src/components/automation/`：接待员工列表和编辑器。
- `kun/src/`：本地协作线程上下文和接待员工执行，不承载共享会议状态机。

`LocalTaskThreadBinding` 持久化在 Electron Main 的协作本地存储中，Renderer 只持投影；Kun 线程 metadata 同步保存 `meetingId`、`taskId` 和绑定版本用于恢复校验。`ConversationMode` 的联合类型、picker、store 和 shared metadata 必须在同一个变更中更新。

### 6.5 协议和事件命名

- 人类会议事件使用 `meeting_*`。
- 人类任务事件使用 `human_task_*`。
- 接待调用事件使用 `employee_invocation_*`。
- 本地专家团继续使用既有 `collaboration_*`，两者不得混用。
- 服务端授权入口可读取具体 command type；持久化事件日志的 `kind` 使用粗粒度类别。两者是不同字段，不能为了隐藏 event kind 而削弱命令授权。
- 服务端与客户端握手交换 `protocolVersion`、`minSupportedVersion` 和 capability flags；不兼容时阻止连接并给出升级指引。

## 7. 数据可见性与威胁模型

### 7.1 服务端可读元数据

服务端仅可读授权和运行必需的数据：

- server instance ID、TLS identity、协议版本。
- 设备公钥和不透明 member ID。
- meeting ID、生命周期、epoch 编号和成员状态。
- 角色分配及固定 permission keys。
- task initiator/participant IDs、参与决策、贡献状态和版本。
- event ID、sequence、timestamp、粗粒度 kind、ciphertext hash 和 size。
- artifact size、chunk count、ciphertext hash、quota 和 transfer state。
- presence、rate、retry metadata 和 request ID。

事件类型在不影响服务端授权的前提下采用 `meeting_event`、`task_event`、`invocation_event` 等粗粒度分类，降低由 kind + actorId 推断协作关系的风险。细粒度语义放在密文内。

### 7.2 端到端加密数据

服务端不能读取：

- 会议标题、描述、显示名、消息和附件。
- 任务正文、任务室讨论、进度详情和交付摘要。
- 项目路径、代码、patch、新文件、测试输出和二进制内容。
- 接待员工 prompt、专家配置、Skill 细节、MCP 地址、工具 schema 和工作区路径。
- 模型与 MCP 凭据。
- 接待调用请求和响应正文。

### 7.3 受保护威胁

- 网络窃听和错误 server identity。
- 数据库、事件日志、备份或产物目录泄露。
- 邀请重放、命令重放和事件重放。
- 未授权参与决策、角色操作和接待调用。
- 服务端修改密文、回滚 sequence 或制造历史分叉。
- 已移除成员解密后续 MLS epoch。
- 远端 prompt injection 直接触发本地高风险工具。

### 7.4 明确限制

- 被攻陷的参与者设备可以泄露该设备已获得的明文和密钥。
- 合法接收者可以复制、导出或录制其有权解密的内容。
- 服务端可观察时序、不透明成员关系、粗粒度事件类别和密文大小。
- 恶意服务端可以延迟、隐藏或删除数据。它不能伪造有效参与者签名，但备份之外不保证可用性。
- 成员移除前已解密的内容无法远程撤销。
- 恶意服务端永久隔离两个客户端群体时，checkpoint 交叉验证只能在两个视图重新汇合后发现分叉。

## 8. 领域模型

### 8.1 核心实体

`ServerInstance`

- `instanceId`
- 公开签名身份、TLS SPKI 指纹
- server limits、retention policy、protocol version、meeting creation policy

`ServerPrincipal`

- 设备绑定的服务端 enrollment，与 meeting membership 分离
- `role: operator | creator`
- 可创建会议或签发 creator enrollment
- 未按正常流程加入会议时，不能解密任何会议内容

`DeviceIdentity`

- `deviceId`
- Ed25519 signing key 与 MLS KeyPackage 公钥
- 私有材料只保存在本地 IdentityVault

`Invitation`

- `inviteId`、`meetingId`
- `kind: single_use | team`
- 服务端 token hash
- expiry、maximum uses、current uses、preassigned roles、approval requirement
- `status: active | exhausted | expired | revoked`

`Meeting`

- `meetingId`、`meetingOwnerMemberId`
- `status: active | closed | purged`
- 当前 MLS epoch 与 protocol version
- maximum members 与 retention policy
- 加密 title 和 description

`Membership`

- `memberId`、`deviceId`、`meetingId`
- 设备绑定的短期访问凭证
- `status: pending_approval | active | suspended | removed`
- role IDs、当前 MLS leaf/epoch、加密 display profile

`RoleDefinition`

- `roleId`、加密 display name、version
- 固定 permission keys 集合

`MeetingEvent`

- `eventId`、`meetingId`、`meetingSeq`、`actorId`、粗粒度 `kind`
- `idempotencyKey`、expected entity version、ciphertext hash、previous checkpoint hash
- encrypted payload 与 server-signed receipt

`MeetingMessage`

- 引用稳定 member ID 的结构化 mention token
- encrypted body 和 attachment references
- 可选 `sourceTaskId`

`MeetingReceptionBinding`

- `meetingId`、`memberId`、`employeeId`、`employeeVersionId`
- 加密且签名的 capability manifest
- availability state

`HumanCollaborationTask`

- `taskId`、`meetingId`、`sourceMessageId`、`initiatorId`
- target member IDs、encrypted task content
- `status: proposed | active | on_hold | review_pending | completed | cancelled`
- `holdReasonCiphertext`、optimistic version
- 当前 `taskKeyGeneration` 和 sponsor member IDs

`TaskParticipant`

- 稳定 participant record ID 和 member ID
- `decisionStatus: pending | accepted | declined | removed`
- `contributionStatus: not_started | working | submitted | revision_requested | waived`
- pinned reception employee version、artifact IDs、version
- sponsor eligibility 与 last key acknowledgement

`EmployeeInvocation`

- `invocationId`、`taskId`、`callerId`、`employeeOwnerMemberId`、`employeeVersionId`
- `status: created | routed | waiting_owner | approved | running | completed | denied | expired | revoked`
- 点对点加密 request/response
- 任务可见的加密 audit summary

`ArtifactPackage`

- `artifactId`、`taskId`、`contributorId`
- chunk metadata、ciphertext hash、加密 manifest 内的 plaintext hash、size、signature
- manifest 含 repository fingerprint、base commit、changed files、patch、new files、binary metadata 和 verification summary

### 8.2 本地专有绑定

- `WorkspaceBinding`：meeting/task ID 到本地项目路径。
- `LocalTaskThreadBinding`：task ID 到本地 Kun thread ID、模式设置和绑定版本。
- `ReceptionEmployeeVersion`：完整本地接待配置。
- `DeliveryDraft`：加密上传前的本地预览包。
- `IdentityVaultRecord`：设备私钥密文、格式版本和 KDF 参数。

### 8.3 术语约束

- `meetingOwner`：会议所有者。
- `employeeOwner`：接待员工所在设备成员。
- `serverOperator`：服务端运维主体。
- `taskInitiator`：协作任务发起人。

代码、协议和文案不得使用无上下文的 `owner` 指代以上多个角色。

## 9. RBAC

每个会议拥有由固定原子权限组成的可编辑角色。一个成员可持有多个角色，有效权限是各角色权限的并集。第一完整版本有意不提供 deny、角色优先级或 per-member override；这是已接受的范围取舍，不代表缺失实现。

Permission keys：

- `meeting.view`、`meeting.manage`、`meeting.close`
- `invite.create`、`invite.revoke`
- `member.approve`、`member.remove`、`member.assign_role`
- `message.post`、`message.moderate`
- `task.create`、`task.manage`、`task.review`
- `employee.publish`、`employee.invoke`
- `artifact.upload`、`artifact.download`
- `history.share`
- `audit.view`、`audit.export`

服务端预建 Owner、Administrator 和 Member 模板。模板可复制和编辑，但以下不变量不可配置：

- 只有目标成员本人可以接受或拒绝自己的参与。
- 只有当前 meetingOwner 可以转移所有权或发起会议凭据完全重置。
- `member.assign_role` 不能给 actor 自己分配角色，meetingOwner 的所有权转移走独立命令。
- 同时拥有 `audit.export` 与 `member.assign_role` 的主体进行敏感角色变更时，记录 `privilege_escalation_suspected` 审计告警。

正常成员 Add/Remove 导致的 MLS epoch 变化不要求 meetingOwner 在线，但必须由有权限且在线的活跃成员提交合法 MLS Commit。

## 10. 状态机

### 10.1 Meeting

```text
ACTIVE -> CLOSED -> PURGED
```

- `CLOSED` 只读，在保留期结束或 owner 授权 purge 前仍可导出。
- Archive 是本地视图偏好，不是共享生命周期状态。
- 创建者离线不影响 active meeting 持久存在。

`SECURITY_SYNC_REQUIRED` 不是生命周期状态，而是 active meeting 上的客户端侧操作覆盖层。当客户端检测到 gap、rollback、checkpoint fork 或无效 MLS transition 时，本地投影进入只读模式，直至可信 resync 完成。该覆盖层不影响服务端的 `ACTIVE`/`CLOSED` 状态，也不阻止其他成员继续写入；仅限制检测到不一致的客户端的本地写入能力。多个客户端可能独立进入和退出该状态。

### 10.2 Membership

```text
PENDING_APPROVAL -> ACTIVE -> SUSPENDED | REMOVED
```

- removed credential 立即拒绝。
- membership 变化产生 MLS Commit 和新 epoch。
- 新成员 Welcome 由服务端按 meeting ID 暂存密文，目标设备认证后拉取；超时后需重新发起 Add。

### 10.3 HumanCollaborationTask

```text
PROPOSED
  -> ACTIVE             首个目标接受
  -> CANCELLED          发起人取消，或所有目标拒绝

ACTIVE
  -> ON_HOLD            发起人标记阻塞
  -> REVIEW_PENDING     所有 accepted 参与者已提交或被豁免
  -> CANCELLED

ON_HOLD
  -> ACTIVE             发起人解除阻塞
  -> REVIEW_PENDING     阻塞解除且贡献已全部解决
  -> CANCELLED

REVIEW_PENDING
  -> ACTIVE             发起人显式重新开放整个任务
  -> COMPLETED          发起人接受全部已解决贡献
  -> CANCELLED
```

`ON_HOLD` 是项目管理信号。发起人必须提供加密阻塞原因，参与者收到通知，但系统不强制暂停参与者本地工作。

**会议关闭时的任务生命周期**：

- meeting 进入 `CLOSED` 时，未到达终态的任务（`proposed`、`active`、`on_hold`、`review_pending`）不自动取消，但不能再创建新任务。
- `review_pending` 任务允许 taskInitiator 在 meeting 保留期内完成审阅并 `complete`。
- `active` 和 `on_hold` 任务允许已 accepted 参与者继续提交贡献，taskInitiator 可推进到 `review_pending` 并完成。
- `proposed` 任务中仍为 `pending` 的参与决策锁定为终态不可再 accept；已 accepted 参与者的贡献可继续提交。
- meeting 被 purge 后所有任务数据不可恢复；UI 应在 purge 前提示未完成任务。

### 10.4 参与决策与贡献

- decision 与 contribution 是正交状态。
- `declined` 和 `accepted` 对一个 participant record 是终态；改变决定需要发起人重新 mention，产生新的 participant record 和审计事件。
- decline 原因可选、端到端加密且仅 taskInitiator 可读。
- 在任务进入 review 前，taskInitiator 可追加邀请；已 declined 成员不会自动恢复 accept 按钮。
- revision 是 per-participant 操作。要求某人修改时，该参与者变为 `revision_requested`，确认开始修改后变为 `working`，任务保持 `review_pending`。
- 其他已提交成员不受 revision 影响。只有发起人显式执行 `reopen_task` 才让整个任务回到 `active`。
- 目标成员可以长期保持 pending；第一完整版本不自动过期。发起人可取消任务或追加/重发邀请。

### 10.5 EmployeeInvocation

```text
CREATED
  -> ROUTED
  -> EXPIRED | REVOKED                        (超时或紧急撤销)

ROUTED
  -> APPROVED                                 (owner 在线且立即批准)
  -> WAITING_OWNER                            (owner 离线，等待确认)
  -> DENIED                                   (owner 在线且拒绝)
  -> EXPIRED | REVOKED                        (超时或紧急撤销)

WAITING_OWNER
  -> APPROVED | DENIED                        (owner 重连后决策)
  -> EXPIRED | REVOKED                        (超时或紧急撤销)

APPROVED
  -> RUNNING                                  (本地 ReceptionSession 启动)
  -> EXPIRED | REVOKED                        (启动前超时或紧急撤销)

RUNNING
  -> COMPLETED                                (执行正常结束)
  -> REVOKED                                  (emergency revocation 中断运行中调用)
  -> EXPIRED                                  (执行超时)
```

- `CREATED` 必须先进入 `ROUTED`，不能跳过路由直接进入 `WAITING_OWNER`。
- `RUNNING` 状态下由 emergency revocation 中断的调用记录为 `REVOKED`，不使用 `DENIED`；`DENIED` 仅表示 owner 在执行启动前主动拒绝。
- 在线路由等待确认默认 5 分钟。
- `waiting_owner` 默认保留 24 小时，随后进入 `expired`。
- 本地执行默认超时 15 分钟；员工版本可设置更短值，不能超过服务端上限。
- emergency revocation 使未开始调用进入 `revoked`；已运行调用由本地策略中断并记录最终状态。
- 状态转换由服务端元数据门禁和 employeeOwner 客户端签名共同验证。

## 11. 传输、身份与加密

### 11.1 Transport 与证书固定

- HTTPS/WSS 只允许 TLS 1.3。
- 邀请固定 `serverInstanceId` 和 TLS SPKI fingerprint。
- fingerprint mismatch 必须阻止连接，客户端不静默接受替换。
- 公网部署无 `insecure` 模式。

证书迁移证明由旧实例 Ed25519 签名密钥签名，至少包含：

- `instanceId`
- old/new SPKI fingerprint
- 签发时间、过期时间和随机 nonce

客户端先用旧实例公钥验证证明，再接受新指纹。旧实例私钥丢失时只能由所有客户端手动重信任；UI 使用 danger 级二次确认，不能用快捷键跳过，并明确这是一条身份连续性降级路径。

### 11.2 Server Enrollment

`kun-collab-server init` 生成一次性 server-operator enrollment bundle。首个兑换设备成为绑定设备的 `ServerPrincipal(role=operator)`。

operator 可签发 creator enrollment，并选择会议创建策略：

- `operator_only`：只有 operator 设备可创建会议。
- `enrolled_creators`：operator 和 creator 设备可创建会议，作为默认值。

加入会议不会获得服务端级创建权限。serverOperator 未按正常 membership 流程加入会议时，不能解密会议。

### 11.3 Device Keys 与 IdentityVault

- Ed25519 signing identity。
- 支持 X25519 的 MLS KeyPackage。
- 一份 membership 映射一个设备；设备丢失后必须 revoke 并重新邀请。
- 安全钥匙环可用时，通过 Electron `safeStorage` 保护私钥。
- 安全钥匙环不可用时，强制使用用户口令，不允许明文落盘或静默关闭协作安全。

口令兜底格式是版本化二进制：

```text
magic | formatVersion | Argon2id parameters | salt | nonce | ciphertext | authTag
```

- KDF 使用 Argon2id：`m=256 MB, t=3, p=4`。
- 数据目录权限为 0700，密钥文件权限为 0600；Windows 使用等价 ACL，只允许当前用户。
- 修改口令时重新加密同一私钥，不更换公钥或设备身份。
- 参数不满足设备资源条件时不得静默降低；Phase 0 应失败并重新评审支持矩阵。
- Linux headless、无 gnome-keyring/kwallet 的 CI 必须覆盖创建、重启解锁、错误口令、修改口令和恢复后连接。

### 11.4 MLS 规格与服务端边界

一个 meeting 对应一个 RFC 9420 MLS group，密码套件等价于 X25519、HKDF-SHA-256、AES-GCM 和 Ed25519。

- 首选候选：OpenMLS。
- 备选候选：libsignal 相关实现，但只有在支持所需 MLS 语义并通过官方 MLS vectors 后才可进入打包评估；不满足即淘汰。
- 禁止自研 MLS 作为降级方案。

候选必须支持 persisted group state、KeyPackage、Welcome、Add、Remove、Commit 和 offline epoch catch-up，并通过：

- Electron Main 的 N-API 绑定：Windows x64、macOS x64/arm64、Linux x64 glibc/musl。
- `electron-rebuild` 对目标 Electron headers 构建。
- macOS arm64 codesign/notarization。
- `kun-collab-server` 不链接 MLS 库；其跨平台打包属于独立关卡，用依赖扫描证明服务端未意外获得 MLS 解密能力。

服务端明确不做 MLS 签名或 Commit 语义验证，只存密文、撤销 access credential，并根据 membership/epoch 元数据限制投递。前向保密完全由客户端 MLS 状态机保证。客户端不得因为服务端接受了事件就跳过 MLS 验证。

### 11.5 可见性作用域

- **Meeting scope**：公共 timeline、任务请求、成员决策和任务状态使用 meeting MLS group，全体 active member 可见。
- **Task scope**：私密任务室、任务附件和 delivery-key 事件使用随机 `TaskKey`，仅 taskInitiator 和 accepted participant 持有。
- **Invocation scope**：接待请求和响应仅 caller 与 employeeOwner 可解密；任务参与者只看到状态和审计摘要。

### 11.6 TaskKey 保管权与重发

taskInitiator 创建随机 `TaskKey`，但不是永久单点：

- taskInitiator 初始为 sponsor。
- 首个接受任务的参与者在拿到并确认 TaskKey 后自动成为 sponsor。
- 此后每个成功确认当前 TaskKey generation 的 accepted participant 都是 sponsor-eligible；服务端只维护在线路由优先级，不授予其生成密钥的能力。
- 任意在线 sponsor 都可用 HPKE 将 TaskKey 包裹给新 accepted participant。
- pending/declined target 永不预先获得 TaskKey。

`WAITING_TASK_KEY` 重连流程：

1. 客户端发现 accepted 但无有效 TaskKey，向任一在线 sponsor 发送 `task_key_request`，包含 task ID、设备公钥、request ID 和原参与 idempotency key。
2. sponsor 验证当前 membership、participant record 和 taskKeyGeneration。
3. sponsor 用目标设备公钥 HPKE-wrap TaskKey，并签名 envelope。
4. 等待方校验签名、generation 和 TaskKey，持久化后激活任务室及本地线程。

**并发请求去重**：等待方以 request ID 为键去重。若多个在线 sponsor 同时响应同一 `task_key_request`，等待方只接受第一个通过校验的 envelope，后续相同 request ID 的响应静默丢弃并记审计。sponsor 端不缓存已发出的 envelope；每次请求独立处理。

保管权规则：

- primary sponsor 离线超过 `T_sponsor_idle=24h` 后，服务端把路由优先级转给最近活跃且已提交 TaskKey acknowledgement 的 sponsor-eligible participant；这是路由职责转移，不生成或恢复密钥。
- taskInitiator 被移除时发布 `human_task_key_custody_transfer`，已持有 TaskKey 的 sponsor 继续服务。
- 至少一个 sponsor 在线时，`WAITING_TASK_KEY` 不应持续超过 `T_key_wait=5m`；超时进入可重试故障并上报审计。
- 若最后一个 TaskKey 持有者永久丢失设备，任务私密历史无法恢复。系统必须明确提示并允许取消/重建任务，不能伪造恢复。

TaskKey 必须在以下情况轮换 generation：accepted participant 被移出任务、其设备身份被 revoke，taskInitiator 发起任务级安全重置，或 accepted participant 因 meeting 级别移除而丧失 membership。meeting 级别移除隐含任务级移除：当成员被移出 meeting 时，服务端在该成员参与的每个 active 任务中标记其 participant 为 `removed`，触发对应 TaskKey generation 轮换。任一 sponsor 生成新随机 key，并以带 `expectedVersion` 的 `human_task_key_rotate` 命令提交；服务端 sequencer 只接受第一个合法版本，其他并发轮换返回 `conflict`。新 key 只 wrap 给当前 accepted participants。被移除者即使仍是 meeting member，也不能解密新 generation 的任务事件。

### 11.7 History Access

加入审批选择：

- `none`：只接收新 MLS epoch 之后的内容。
- `task_context`：由具有 `history.share` 的成员导出选定任务上下文、相关消息、当前状态和必要 artifact keys。
- `full`：导出截至 `snapshotSeq` 的不可变快照及重新包裹的 artifact keys。

所有具有 `history.share` 且在线的成员都可成为 history sponsor，不使用单一固定 sponsor。快照含 event digest、cutoff sequence 和 sponsor signature；新成员至少向另一个在线 sponsor 交叉验证 digest。没有可交叉验证的 sponsor 时审批保持 pending，不静默降级 history policy。

历史 sponsor 在本地解密和重建快照，仅上传给新设备的密文。新成员导入后从 `snapshotSeq + 1` 同步。

### 11.8 Artifact Key 生命周期

- 每个 artifact 使用随机 content key，只 wrap 给当前授权 task participants。
- 成员移除后创建的新 artifact 不得再向其 wrap content key。
- 服务端依据当前 membership 和 participant 元数据校验 wrap recipient 列表，但不接触明文 key。
- 已发布 artifact 的权限撤回不承诺销毁接收者已获得的 key；UI 和审计应明确这一限制。

## 12. 邀请与加入流程

`.kuncollab` 文件及可选 QR 包含：

- protocol version
- server URL、server instance ID、TLS SPKI fingerprint
- meeting ID、invitation ID
- one-time invitation secret
- invitation kind、expiry、maximum uses、inviter signature

流程：

1. 导入并校验 bundle 结构和签名。
2. 仅在 TLS identity 与 pinned instance 匹配时连接。
3. 需要审批时，token 验证后获取 server-signed 的 active approver encryption keys。
4. 提交 device public keys 与 MLS KeyPackage。display profile 分别用 eligible approver 的 HPKE key 包裹，服务端不可读。
5. 团队邀请由授权成员审批、分配角色并选择 history scope。
6. 授权在线成员提交 MLS Add，服务端暂存目标设备可拉取的 Welcome 密文。
7. 新成员导入可选历史和当前 MLS state。
8. 选择本地项目目录，并选择或就地创建 reception employee。
9. 发布签名加密 capability manifest，membership 变为 active。

没有可用 approver key 时，join request 保持本地 draft 并重试，不能以服务端可读明文发送 display name。兑换后 invitation secret 永不作为 session credential。

默认限制：single-use 24 小时过期；team invitation 7 天过期；team use cap 不超过 meeting member cap。

## 13. 事件同步、并发与 Outbox

### 13.1 命令信封

每个客户端命令包含：

- `requestId`
- `eventId`
- `idempotencyKey`
- 状态变更时的 `expectedVersion`
- authenticated actor/meeting IDs
- payload ciphertext 与生成它的 MLS epoch 或 TaskKey generation

服务端分配 `meetingSeq`、保存 ciphertext hash，并返回与前一 checkpoint 链接的 signed receipt。重复命令返回原始结果。

### 13.2 客户端持久化

- last verified meeting sequence 与 checkpoint hash
- 未确认的 encrypted Outbox commands
- local materialized meeting projection
- MLS state、TaskKey generation 与本地绑定版本

### 13.3 重连顺序

1. 认证 device-bound session。
2. 分页请求 `lastVerifiedSeq` 之后的事件。
3. 验证 receipt、signature、hash、checkpoint 和 MLS epoch。
4. 更新到当前 MLS state 并重建 projection。
5. 处理 Outbox epoch/generation 迁移。
6. 使用原 idempotency key 重发仍然有效的命令。

Outbox 重加密规则：

- meeting scope 命令若在离线期间发生 epoch 变化，先解密本地 Outbox，再用当前 epoch group key 重加密。
- task scope 命令若 TaskKey generation 变化，先确认当前参与资格并用当前 TaskKey 重加密。
- 原始 idempotency key、request intent 和 expected entity identity 保持不变。
- 命令在新状态下已无语义，例如针对 removed member 或已撤销 employee version，则静默不发送并记录 `outbox_command_dropped` 审计事件。
- 禁止用明文、旧 epoch key 或“服务端兼容模式”降级重发。

gap、rollback、checkpoint fork 或无效 MLS transition 使 meeting 进入 `SECURITY_SYNC_REQUIRED`。UI 只读，直至可信 resync 成功。

客户端周期性把最后接受的 server checkpoint 放入加密 meeting event。分离视图重新汇合时可发现服务端历史不一致，但不能解决永久分区造成的可用性问题。

### 13.4 写入串行化与失活边界

- 单实例 sequencer 是第一版本的明确设计，所有 meeting event 写入串行分配 sequence。
- server process 不提供多写者或 leader election；同一 data directory 不允许两个进程同时 serve。
- 进程失活期间客户端只写本地 Outbox；恢复后按上述顺序同步和重放。
- SQLite transaction 必须同时提交 event、entity version、idempotency record 和 receipt metadata，避免 durable partial accept。

### 13.5 传输帧、背压与客户端重启恢复

**WebSocket 帧**：

- 传输层使用 WSS 文本帧承载 JSON 信封；加密 payload 以 base64 编码的 ciphertext 字段传递。
- 单帧最大 1 MB；超过此限制的 artifact 上传/下载走独立 HTTPS 分块端点，不在 WebSocket 帧内传递。
- 心跳间隔 30 秒（client ping），server 60 秒无 pong 视为连接失活。

**背压**：

- 客户端按 `meetingSeq` 顺序应用事件。若本地 projection 处理速度落后（如大批量历史回放），客户端向 server 发送 `flow_control` 消息携带当前已应用游标，server 暂停该会话的新事件推送直到游标推进。
- server 对单个客户端维护发送窗口（默认 256 条未确认事件）；窗口耗尽时暂停推送，不丢弃。
- 本地 Outbox 积压超过阈值时，UI 显示同步积压提示，但不阻塞本地 Agent 线程工作。

**客户端重启恢复**：

- Electron 应用启动时，CollaborationClient 从本地持久化恢复 last verified sequence、MLS state、TaskKey generation、Outbox 和本地 projection。
- 对每个已配置的 server profile，按 13.3 重连顺序自动恢复连接。用户可在 Server profiles 中关闭自动重连。
- 重启前处于 `SECURITY_SYNC_REQUIRED` 的 meeting，重启后仍保持只读，不自动退出该状态；需用户手动触发 resync 或等待可信 sponsor 可用。
- 重启前未确认的 Outbox 命令在重连后按重加密规则重发。
- 本地 Kun 协作线程的 `LocalTaskThreadBinding` 恢复后重新校验 meeting/task 有效性；若 task 或 membership 已失效，线程降级为只读并显示原因。

## 14. 协作任务用户流程

### 14.1 创建请求

- composer 使用稳定 member ID 创建结构化 mention token。
- 显示名重复时展示 device short code 消歧。
- 一次协作请求创建一条公共 message 和一个 `HumanCollaborationTask`。
- target rows 与 accept/decline 控件对全会议可见。
- Renderer 对 non-target 禁用控件，服务端独立拒绝 non-target actor。

### 14.2 接受或拒绝

目标接受时：

1. 用幂等命令将 participant record 变为 accepted。
2. 将当前 meeting reception binding version 固定到 participant。
3. 显示不可变 source message 和 shared task context。
4. 确认或更换本地项目目录。
5. 选择本地专家/专家团队和模型。
6. 创建带签名 collaboration context 的本地 Kun thread。
7. 获取并验证 TaskKey；完成前保持 `WAITING_TASK_KEY`。
8. 激活 `meeting_collaboration`。

目标拒绝时可填写仅 taskInitiator 可读的加密原因。部分目标拒绝不会阻止其他已接受成员工作；review 前发起人可追加邀请。

导入任务正文显示为自动填充内容，但传给 Kun 时始终是不可信动态 task context，不是 system message。

### 14.3 共享工作与 Phase 2 最小闭环

- 首个接受目标将任务推进到 active。
- review 开始前，后续目标仍可接受或拒绝。
- accepted members 共享同一 task room。
- 成员可在本地协作线程中手动发布文本进度到任务室；发布动作显式、可预览且默认不附带本地日志。
- Phase 2 必须能完整演示：接受任务 -> 本地工作 -> 手动发布进度 -> taskInitiator 在任务室看到进度。
- 接待调用通过显式 `call_reception_employee` capability 发起，不能把他人的 MCP server 挂载为本地工具。

### 14.4 提交与完成

`提交协作结果` 打开本地审阅对话框：

- summary 与 verification results
- repository fingerprint、base commit、branch、file hashes
- 可用时的 Git patch
- new files 和用户选择的 binaries
- secret scan、path safety、size results

用户确认后才加密、上传并发布 submission event。taskInitiator 可：

- preview/download 每个包
- 对单个参与者 request revision
- 将参与者标记 waived
- 在最终 review 前移除参与者
- 接受全部 resolved contributions 并 complete

任何交付都不会自动应用到 taskInitiator workspace。

## 15. Reception Employees

### 15.1 Automation Settings V2 与迁移

V2 使用带 `kind` 的版本化 employee collection：

- `MailDigitalEmployee`
- `SocialDigitalEmployee`
- `ReceptionDigitalEmployee`

共享基类包含 ID、name、status、profile、approval policy、created/updated time；各 subtype 拥有专属配置。存储和 Renderer state 按 employee ID 索引，更新只替换同 ID 项，不能按 type 过滤掉同类其他实例。

V1 归一化迁移必须：

- 读取现有单一结构中的可选 `mail` / `social`，分别生成稳定 ID 的 V2 项。
- 保留既有行为、状态和有效字段。
- reception collection 初始为空。
- 仅在通过 schema 时保留 future-safe unknown fields。
- 不复制 provider secret 或 MCP credentials 到 Automation settings。
- 覆盖 create、update、restart、delete 及多同类员工不互相删除的回归测试。

### 15.2 ReceptionEmployeeVersion

每个不可变版本包含：

- name、description、greeting、role、work boundary、tone、output format
- 一个 selected expert 或 expert team
- optional knowledge-base scope
- Skill allowlist
- MCP references 与 per-tool allowlist
- provider、model、reasoning effort
- workspace access：none/read-only/workspace-write
- shell、network、external-send 和 high-risk action policies，默认 deny 或本地审批
- per-task calls、token/cost budget、hourly rate、concurrency、timeout
- public capability labels 与 optional model-name disclosure

保存产生新 immutable version，并更新 profile 的 current-version pointer。

### 15.3 会议和任务版本规则

- 加入会议绑定一个 current reception version。
- 接受任务时将该版本固定到 participant。
- 普通编辑和 meeting-level switch 只影响新任务。
- emergency revocation 立即拒绝该版本的未来调用。
- 活跃任务显示 revoked，直到 employeeOwner 显式绑定 replacement version 并发布变更。

### 15.4 Capability Manifest

加密签名 manifest 可包含 employee ID/version、name/description、request categories、capability labels、permission summary、availability、budget availability 和可选 public model name。

不得包含 system prompt、role instructions、MCP address、tool schema、credentials、provider secret、project path 或内部 expert-team workflow。

### 15.5 Invocation Pipeline

1. caller 在本地协作线程调用 `call_reception_employee`。
2. server 验证双方均为 accepted participant、caller 有 `employee.invoke`、version 属于 employeeOwner 且未超 rate limit。
3. employeeOwner client 解密并检查 version、capability、caller、task、budget、workspace policy、tool risk 和 approval policy。
4. owner offline 时进入 `waiting_owner`；重连后由 owner review/edit/approve/deny，绝不自动执行。
5. approved work 进入以 meeting/task/employeeVersion 为键的本地 ReceptionSession。
6. ToolHost 只注册配置允许的 Skills、MCP tools 和 built-ins。
7. remote text 作为不可信 user context；本地 write/shell/network/external-send 审批继续生效。
8. response 去除本地路径和 secret 后，加密给 caller 与 employeeOwner。
9. task-visible status summary 只记录 outcome，不暴露 request/response 正文。

ReceptionSession 强制配置：

- `sandboxMode` 只能为 `read-only` 或 `workspace-write`，禁止 `danger-full-access`。
- `allowedToolNames` 只能来自 employee version 的 Skill/MCP/built-in allowlist。
- `blockedToolNames` 继续执行本地全局拒绝策略。
- `approvalPolicy` 不得低于 `on-request`；高风险工具必须本地逐次确认。
- 使用独立 `receptionSessionContext`，不复用专家团 `collaborationContext`。

## 16. 加密产物交付

每个 artifact 使用随机 content key 和 authenticated chunk encryption。服务端仅保存加密 chunks 和配额/传输元数据。

默认限制：单包最大 100 MB；单 meeting 累计 ciphertext 最大 2 GB。服务端可在部署策略范围内配置。

上传：

- 记录 `uploadId`、chunk index、size 和 ciphertext hash。
- 中断后只续传缺失 chunk。
- 所有 chunk 与 manifest 验证成功前不发布 artifact event。

下载与应用：

- 验证 server receipt、contributor signature、manifest integrity、chunk hash 和 decrypted content hash。
- 拒绝 absolute path、`..`、device file、out-of-root symlink、oversized expansion 和 executable auto-launch。
- 跨平台路径安全：manifest 中的路径统一使用正斜杠 `/` 规范化；应用时按本地 OS 转换。Windows 上额外拒绝保留名（`CON`、`PRN`、`AUX`、`NUL`、`COM1-9`、`LPT1-9`）和超过 `MAX_PATH`（260 字符）的路径；Linux/macOS 上拒绝含 null byte 的路径。路径比较在 Windows 上大小写不敏感、在 Linux/macOS 上大小写敏感，manifest hash 始终基于规范化后的路径计算。
- 比较 repository fingerprint、base commit 和 file hashes。
- clean baseline 仅在预览后允许手动 apply。
- baseline 不同进入本地 merge/save-as，不静默应用。
- binary 只展示 name/type/size/hash，不由协作流程执行。

## 17. 错误处理与恢复

### 17.1 与 Kun 现有错误契约对齐

扩展现有 `KunErrorBody`，不建立第二套错误信封：

```ts
interface KunErrorBody {
  code: KunErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
  requestId?: string;
  currentVersion?: number;
  retryAfterMs?: number;
}
```

- 版本冲突复用 `conflict`，不新增 `VERSION_CONFLICT`。
- 新增 `task_key_unavailable`、`mls_epoch_mismatch`、`reception_unauthorized`、`meeting_not_found`、`invitation_expired`、`security_sync_required` 等稳定 code。
- `conflict`：`retryable=false`，携带 `currentVersion`，刷新实体并保留用户 draft。
- `rate_limited`：`retryable=true`，必须携带 `retryAfterMs`。
- `task_key_unavailable`：`retryable=true`，等待 sponsor 或由用户触发 retry。
- `forbidden`、`security_sync_required`：自动重试为 false。
- 只有语义安全的读操作或幂等重连可自动重试；角色编辑、移除成员、task review 和 ownership change 必须刷新后重新确认。

### 17.2 故障行为

| 故障 | 行为 |
| --- | --- |
| WebSocket 中断 | 显示协作局部离线；本地 Agent 继续可用；退避重连、验证缺失事件、重加密并重放有效 Outbox。 |
| TLS 指纹改变 | 阻止连接，只接受有效迁移证明或显式手动重信任。 |
| 邀请无效 | 区分 expired/revoked/exhausted/signature/instance，不创建半成品成员。 |
| MLS gap/checkpoint fork | 进入只读 `SECURITY_SYNC_REQUIRED`，不在未验证历史上继续。 |
| optimistic conflict | 返回 current version，刷新实体，保留用户 draft。 |
| TaskKey 不可用 | 显示 WAITING 卡片、sponsor 状态、已等待时间和 retry。 |
| reception owner offline | 保持待确认，不阻塞任务，不在上线后自动运行。 |
| reception version revoked | 拒绝调用，要求显式 replacement binding。 |
| artifact interrupted | 只续传缺失 chunks，不发布不完整包。 |
| device private key loss | 阻止连接，revoke 并重新邀请；不承诺密钥恢复。 |
| disk full/quota exceeded | durable event 接受前拒绝，返回不可重试或延后重试错误。 |

### 17.3 恢复界面

- `SECURITY_SYNC_REQUIRED`：全屏安全提示、只读内容、可信重同步入口。
- `conflict`：保留 draft，展示远端新版本与重新应用选择。
- TLS 手动重信任：danger 二次确认，展示 old/new fingerprint 和身份连续性风险。
- 私钥丢失：引导 revoke/re-invite，不提供虚假的“恢复”按钮。
- 暗色主题下 danger/warning/status 均需通过对比度和非颜色提示验证。

## 18. 原生服务端部署与运维

第一完整版本提供 Windows x64、macOS x64/arm64、Linux x64 glibc/musl 原生包。

CLI：

- `kun-collab-server init`
- `kun-collab-server serve`
- `kun-collab-server install-service`
- `kun-collab-server uninstall-service`
- `kun-collab-server status`
- `kun-collab-server doctor`
- `kun-collab-server backup`
- `kun-collab-server restore`

`init` 创建受限权限 data directory、server signing key、TLS certificate/引用、SQLite、加密 recovery material 和一次性 operator enrollment bundle。公网 `serve` 必须配置 TLS 与 explicit public URL。

持久化：

- SQLite WAL 保存 membership、RBAC、sequencing、receipt、quota 和 artifact index。
- 加密 chunks 按 meeting 分区存储。
- schema migration 事务化。
- active meeting 持续保留；closed meeting 默认保留 30 天，可在服务端允许范围内由 meetingOwner 选择。

备份包含 SQLite、加密 blobs、instance keys、certificate/引用和配置，并支持口令加密。restore 必须保留 instance identity；丢失 instance key 等于新信任身份，所有客户端必须重信任。

health 不暴露 meeting/member 数据。日志只记录 request ID、匿名 member ID、粗粒度 event kind、size、timing 和 error code；禁止 invitation secret、正文、ciphertext dump、本地路径和 credential。

### 18.1 客户端诊断与可观测性

客户端侧提供受限诊断面板（Settings > Collaboration > Diagnostics），用于排查同步、密钥和连接问题：

- **连接状态**：每个 server profile 的 WebSocket 连接状态、last verified sequence、本地/服务端 epoch、重连次数和上次错误码。
- **密钥状态**：当前设备 IdentityVault 格式版本、MLS group epoch、TaskKey generation（按任务，不展示 key 本身）、sponsor 资格和 WAITING_TASK_KEY 等待时长。
- **Outbox 状态**：待发命令数量、最早命令时间、重加密次数和 dropped 计数。
- **安全状态**：是否处于 `SECURITY_SYNC_REQUIRED`、checkpoint fork 检测结果和 resync 进度。

诊断面板只展示状态指标和匿名 ID，不暴露私钥、明文 payload、TaskKey、MLS group key 或设备路径。诊断日志本地存储，用户可导出脱敏诊断包（不含密文正文）用于问题报告。

### 18.2 双二进制兼容矩阵

`kun serve` 与 `kun-collab-server` 独立发布，通过协议版本而非相同应用版本耦合：

| 组件 | 必须声明 | 不兼容行为 |
| --- | --- | --- |
| Kun GUI / Electron Main | supported protocol range、client capabilities | 阻止连接并提示升级 GUI |
| `kun serve` | local collaboration adapter version | 禁用本地协作线程/接待执行，不影响普通本地线程 |
| `kun-collab-server` | protocol range、schema version、feature flags | 拒绝不支持的写命令，允许兼容只读同步时明确标记 |

端口、证书和服务安装由 Collaboration profile 独立管理，不占用 Kun loopback runtime 端口。升级演练必须覆盖 server-first 和 client-first 两个顺序。

## 19. 容量目标

- 单 meeting 最大 20 members。
- 单 server instance 最大 100 simultaneously online members。
- 100 WebSocket clients 持续 30 分钟，accepted event 零丢失、零重复。
- 20-member meeting 以 20 events/s burst 时 server acknowledgement p95 <= 500 ms。
- LAN reference environment 中 10,000-event backlog 在 30 秒内验证并应用。
- 100 MB artifact 在 50% 中断后只续传缺失 chunks，并验证 ciphertext/plaintext hashes。

## 20. 分阶段实施与退出门禁

每个 Phase 同时定义技术门禁和可演示的用户价值。未通过当前 Phase 不进入下一 Phase。

### Phase 0：技术关卡（建议两周时间盒并行验证）

**关卡 A：MLS**

- OpenMLS 首选，备选实现按同一标准评估。
- official vectors、Add/Remove/Commit、persist/restore、offline catch-up、tamper/replay/stale epoch 全部通过。
- Electron Main N-API 打包覆盖全部客户端目标架构；独立 server 不链接 MLS 库。

**关卡 B：IdentityVault**

- 验证 `safeStorage` 路径。
- 验证 Argon2id 口令文件、权限、错误口令、口令轮换、Linux 无钥匙环 headless CI。

**关卡 C：原生 server**

- 所有目标平台原生包可启动、安装服务并完成协议握手。
- 依赖扫描和服务端密文 canary 测试证明其不链接 MLS 库、不持 MLS 解密能力。

**关卡 D：三客户端协议原型**

- 单机 A/B/C 三隔离进程、不同本地 Kun 端口、共享测试 server。
- 验证邀请、Add/Remove、离线重连、TaskKey sponsor、Outbox 重加密、篡改拒绝。

技术退出：四关全部通过。失败即停止实现并回到设计。

UX 出口：内部诊断工具可清楚展示三客户端建群、加人、移除和安全失败，不作为正式产品 UI。

### Phase 1：Meeting Foundation

- native server、TLS、identity、invitation、custom RBAC、MLS、event sync、presence、history snapshot 和基础 Collaboration UI。
- 支持 create/join/chat/rename/manage roles/close/reconnect。
- 完成 Automation V2 归一化迁移、最小 Reception profile 存储/版本/会议绑定，以及 inline 创建入口；本 Phase 不开放远端调用执行。
- 完成三 peer 导航、子导航分组和空状态 CTA。

技术退出：A/B/C 在 restart/reconnect 后维持同一持久加密 meeting，无明文泄漏和 sequence 分叉。

UX 出口：用户可全程通过 UI 创建会议、邀请成员、发消息、管理角色并查看明确的连接/安全状态。

### Phase 2：Shared Human Tasks

- structured mentions、task/participant 状态、target-only decisions、task room、notifications、contextual local Kun threads。
- TaskKey sponsor/重发、WAITING UI、breadcrumb、双维状态呈现。
- 手动发布进度消息是本 Phase 强制范围。

技术退出：仅 target 可决策；accepted targets 共享一个 task；本地 Agent logs 保持本地；跨 epoch 重连不重复命令。

UX 出口：发起请求 -> 接受/拒绝 -> 打开本地线程 -> 发布进度 -> 发起人在任务室看到进度，形成无需 Phase 3/4 的最小价值闭环。

### Phase 3：Reception Employees

- 在 Phase 1 的 V2 存储与最小 profile 上补齐完整编辑、multiple reception profiles、manifest、scoped local execution、budgets、approval 和 offline confirmation。
- ReceptionSession 强制 ToolHost 限制和独立 context。

技术退出：远端调用只在 employeeOwner device 执行，不暴露内部工具/凭据，`danger-full-access` 不可达。

UX 出口：用户可配置员工、从协作线程发起调用、在 owner device 审批并查看脱敏结果。

### Phase 4：Delivery and Review

- encrypted resumable artifacts、local preview、baseline checks、submit、per-participant revision、waive、final review。

技术退出：100 MB interrupted transfer 正确续传；未经显式 preview/apply 不修改任何 workspace。

UX 出口：参与者可打包提交；发起人可预览、要求单人修改、豁免并完成审阅。

### Phase 5：Production Hardening

- service install/upgrade、backup/restore、doctor、retention、quota、rate limit、客户端加密会议快照导出、automated fault injection、load/security review、cross-platform packages 和运维文档。

技术退出：全部 release gates 和真三设备验收通过。

UX 出口：三台真实设备完整演示创建、加入、任务、接待调用、交付、完成和故障恢复。

## 21. 测试策略

### 21.1 Unit 与 Contract

- Zod schema、protocol negotiation、IPC 输入边界。
- 每个 role permission 的 allow/deny 分支。
- invitation、membership、task、participant、invocation、artifact 的每个合法/非法转换。
- optimistic version 与 idempotency。
- 新模块 line/branch coverage >= 80%；permission 与 state transition branch coverage = 100%。
- 事件 namespace 不与既有 `collaboration_*` 混用。

### 21.2 Cryptographic Conformance

- official MLS vectors。
- KeyPackage、Welcome、Add、Remove、Commit、offline epochs。
- tamper、replay、wrong signer、removed member、stale epoch。
- TaskKey sponsor transfer、重发、错误 generation 和最后持有人丢失。
- task participant removal 后的 TaskKey generation rotation 与旧 key 拒绝。
- history snapshot digest 交叉验证。
- artifact key wrapping/rewrapping 和 removed-member recipient filter。

### 21.3 Multi-Client Integration

CI 使用一个真实测试 server 和 A/B/C 三个隔离 client process：

- 不同 `kun serve` loopback ports 和独立 data directory。
- one-time/team invitation、editable display name、stable member ID。
- custom roles、permission union、自我赋权拒绝。
- multi-target request、target-only decisions、partial decline。
- 一个 shared task room 与多个 local Kun threads。
- TaskKey WAITING/retry/custody transfer。
- task-scoped reception 和 offline owner confirmation。
- submissions、per-participant revision、waiver、completion。

真三设备测试用于跨平台原生网络和安装验收，不替代 CI harness。

### 21.4 Electron 与 Kun

- preload IPC 拒绝 malformed/over-broad input。
- Renderer 无法读取长期 key/raw credential。
- 普通线程不出现可用的 meeting mode，并显示合理原因。
- imported task text 是 dynamic untrusted context。
- ReceptionSession 只注册 configured tool catalog，`danger-full-access` 不可达。
- existing approvals、workspace sandbox、fork/resume/user input/usage 不回归。

### 21.5 Migration 与 Regression

- mail/social V1 normalization 后行为不变。
- multiple reception profiles 在 create/update/restart/delete 后保持。
- existing expert-team contracts/events 不变。
- existing local Kun chat、approval、user input、fork、resume、usage 不变。

### 21.6 Artifact Security

- interrupted/duplicate chunks、wrong hashes/signatures、quota。
- absolute path、traversal、symlink escape、device file、oversized extraction。
- Windows 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）和 MAX_PATH 超长路径拒绝。
- 跨平台路径规范化一致性（正斜杠统一、Windows 大小写不敏感、Linux/macOS 大小写敏感）。
- Git/non-Git baseline mismatch。
- binary preview without execution。

### 21.7 自动化 Fault Injection

以下进入 CI 的可重复故障矩阵：

- drop、delay、duplicate、reorder transport frames。
- server restart/client crash around Outbox acknowledgement。
- offline epoch Add/Remove 后 Outbox 重加密。
- disk full/read-only data directory。
- certificate replacement/migration proof。
- MLS checkpoint gap/server history fork。
- client full restart 后协作状态恢复（MLS state、Outbox、TaskKey、projection）。
- 并发 `task_key_request` 多 sponsor 响应去重。
- meeting 级别移除 accepted participant 后 TaskKey generation 轮换与旧 key 拒绝。

### 21.8 Security Validation

- 用已知 plaintext canary 扫描 server SQLite、blob、backup 和 logs。
- fuzz invitation 与 artifact manifest parser。
- 使用 unauthorized actor 穷举 RBAC matrix。
- 验证 removed member 不能解密 later epoch。
- dependency audit 和专门 threat-model review。

## 22. 发布门禁

完整版本发布前必须通过：

- top-level typecheck、unit/integration tests、`build:kun` 和 full build。
- Collaboration Server 在每个目标 OS/architecture 的构建与原生包 smoke。
- Electron E2E 覆盖 create、join、task、call、delivery、completion。
- native service install/upgrade/backup/restore/certificate renewal drill。
- capacity/reconnect targets。
- 新依赖无未解决 Critical/High issue。
- 真三设备端到端验收。

出现以下任一情况阻止发布：

- server disk、backup 或 logs 存在 meeting plaintext、credentials 或 project content。
- non-target 能 accept/decline。
- non-participant 能 invoke reception employee。
- removed member 能解密 later epoch。
- removed task participant 能解密 later TaskKey generation。
- meeting 级别移除的 accepted participant 能解密后续 TaskKey generation。
- reconnect 产生 duplicate task/decision/call/delivery。
- Outbox 以 plaintext/old epoch 降级发送。
- TaskKey 有在线 sponsor 时仍无法恢复 WAITING client。
- 并发 task_key_request 响应导致等待方激活多个冲突 TaskKey。
- delivery 未经本地 preview/apply 就修改 workspace。
- artifact apply 逃逸目标目录或在 Windows 上写入保留名/超长路径。
- 诊断面板泄露私钥、明文 payload、TaskKey 或 MLS group key。

## 23. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| MLS 无法在 Electron 或 server 目标稳定打包 | Phase 0 硬门禁；禁止自研 crypto fallback。 |
| safeStorage 在 Linux 无钥匙环环境不可用 | Argon2id 口令兜底和 headless CI；失败则收缩支持矩阵并重新评审。 |
| TaskKey sponsor 全部永久丢失 | 多 sponsor、主动重发、明确不可恢复边界；取消并重建任务，不伪造密钥恢复。 |
| Automation V1 -> V2 丢失同类型 profile | ID-keyed collection、显式 normalization、restart/delete 回归。 |
| 人类协作与专家团协作混淆 | 独立实体、事件 namespace、图标和文案。 |
| remote prompt injection 触发本地工具 | untrusted dynamic context、scoped ToolHost、本地审批、高风险默认 deny。 |
| server 制造 history fork | signed receipt/checkpoint chain、加密 checkpoint 交换、分叉汇合后进入只读安全恢复。 |
| artifact 逃逸 selected directory | path/symlink/size/base/signature/hash 校验和手动 apply；跨平台路径规范化与 Windows 保留名/超长路径拒绝。 |
| 双二进制版本错配 | protocol range negotiation、兼容矩阵、server-first/client-first upgrade drill。 |
| 客户端重启后协作状态不一致 | 本地持久化 last verified seq/MLS state/Outbox/projection；重启自动按重连顺序恢复；SECURITY_SYNC_REQUIRED 保持只读不自动退出。 |
| meeting 移除未触发 TaskKey 轮换 | meeting 级移除隐含任务级移除，服务端标记 participant removed 并触发 generation 轮换；发布门禁覆盖。 |
| scope 变成不可评审的大改动 | 六 Phase 独立退出门禁，不把 server/task/employee/artifact/hardening 合并为单一落地单元。 |

## 24. 评审问题闭环矩阵

### 24.1 P0 / Blocker

| # | 评审问题 | 本方案落点 | 验收证据 |
| --- | --- | --- | --- |
| 1 | TaskKey 分发死锁 | 11.6、20 Phase 0/2 | sponsor/retry/custody transfer 集成测试 |
| 2 | MLS 选型和服务端职责不清 | 6.1、11.4、20 Phase 0 | vectors、客户端原生绑定打包、server no-MLS 依赖验证 |
| 3 | safeStorage 口令兜底未定义 | 11.3、20 Phase 0 | Linux headless E2E、权限/轮换测试 |
| 4 | Import credential 常驻导航错误 | 5.2 | 空状态与已配置 IA 交互验收 |
| 5 | contextual mode/WAITING 不可见 | 5.4、17 | tooltip、占位卡、retry E2E |
| 6 | 任务双维状态缺 UI 规格 | 5.5、10 | 状态组合、明暗主题和可访问性验收 |
| 7 | Reception 前置入口缺失 | 5.6、12 | 无 employee 用户完成 join E2E |
| 8 | Phase 2 价值真空 | 14.3、20 Phase 2 | 接受 -> 本地工作 -> 发布进度演示 |
| 9 | Outbox 跨 epoch 未重加密 | 13.3、21.7 | Add/Remove 离线重放与降级拒绝测试 |

### 24.2 P1 / Major

| 主题 | 本方案落点 |
| --- | --- |
| RBAC 权限累积、自我赋权 | 9 |
| TLS 迁移证明 | 11.1、17 |
| Reception ToolHost 约束 | 15.5、21.4 |
| `ON_HOLD` 与 per-participant revision | 5.5、10.3/10.4、14.4 |
| 双工作面 breadcrumb 与按钮位置 | 5.3 |
| partial decline | 10.4、14.2 |
| 三 peer 导航与子导航分组 | 5.1/5.2 |
| 通知合并、优先级和隐私 | 5.7 |
| Phase UX 演示出口 | 20 |
| KunErrorBody/KunErrorCode 对齐 | 17.1 |
| EmployeeInvocation 状态和超时 | 10.5 |
| LocalTaskThreadBinding/ConversationMode 落点 | 6.4 |
| 双二进制兼容 | 6.5、18.2 |
| history sponsor 单点 | 11.7 |

### 24.3 已修正事实

- `ConversationMode`（`src/renderer/src/components/chat/FloatingComposerModePicker.tsx:17`）目前为 `chat | knowledge_qa | task`，没有 `'auto'`。`'auto'` 属于 `ExpertTeamCollaborationMode`（`src/shared/kun-experts-api.ts:9`），不是 `ConversationMode` 成员。新增的是 `meeting_collaboration`，需同步修改 picker/store/shared union。注意 `src/shared/automation-digital-employees.ts:96` 另有一个同名异体类型 `ExpertCollaborationMode`（无 "Team"），字面值相同但属不同声明，不混淆。
- `KunErrorCode` 与 `KunErrorBody` 当前为 Zod schema（`kun/src/contracts/errors.ts`），非 TS enum/interface。`conflict` 已存在（第 16 项），当前 `KunErrorBody` 仅有 `code`/`message`/`details?`，新增 `retryable`/`requestId`/`currentVersion`/`retryAfterMs` 为可选扩展字段。
- ToolHost 已有 per-turn 裁剪与审批能力（`kun/src/ports/tool-host.ts:57-118`）。本方案只新增正确的 ReceptionSession context 和强制配置，不重复建设 ToolHost 基础设施。
- Automation V1 是可选字段结构（`src/shared/automation-digital-employees.ts:65-80`，`mail?`/`social?`），V2 迁移按归一化流程设计，不假设已有判别联合。
- 人类协作事件使用独立 namespace，不扩展既有专家团 `collaboration_*` 语义（`kun/src/contracts/events.ts:58-70`，13 个 `collaboration_*` 事件全部绑定专家团队委派）。

## 25. 最终设计不变量

1. Collaboration Server 永不成为 Agent Runtime。
2. 本地 Kun 永不暴露到 LAN 或互联网。
3. Renderer 永不持有长期 identity key 或 network credential。
4. meeting content、task content 和 artifact 保持端到端加密。
5. 授权只依赖稳定 member ID，不依赖可编辑 display name。
6. 只有 task target 可以决定自己的参与。
7. accepted targets 共享一个 task room，但保留各自独立的 local Agent thread 和 workspace。
8. Reception Employee 只在 employeeOwner device 执行。
9. 远端成员不能直接访问另一个成员的 MCP、工具或本地权限。
10. `meeting_collaboration` 只在有效 meeting-task thread 上可用，并对不可用原因可解释。
11. TaskKey 不以 taskInitiator 为永久单点；服务端永不生成或恢复 TaskKey。
12. Outbox 跨 epoch/generation 必须重加密，禁止明文或旧密钥降级。
13. delivery 必须加密、预览并手动应用。
14. meeting 级别成员移除隐含任务级移除并触发 TaskKey generation 轮换。
15. 诊断面板永不暴露私钥、明文 payload、TaskKey 或 MLS group key。
16. Docker、cloud relay、P2P、live editing、SSO、key escrow 和 clustering 不属于第一完整版本。
