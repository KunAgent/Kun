# ADE 设置与工作台契约

本文定义拟新增或扩展的数据契约。带“提案”的名称均尚未实现，最终导出名可按仓库约定调整，字段语义和单一写入边界必须保留。

最新产品表面是 Code 单页面，原 ADE 命名仅为兼容的内部名称。页面归属、联合历史、协作授权及工作区归属以 [融合决策](../../14-code-workbench-integration.md) 为准。

## 1 字段归属与生效矩阵

| 字段 | 正本 | 项目覆盖 | 任务覆盖 | 下一轮覆盖 | 生效时机 |
| --- | --- | --- | --- | --- | --- |
| Agent 程序路径、参数、环境引用 | `agents.kun.harnesses` | 否 | 否 | 否 | 新建原生会话；运行中会话不被重启 |
| 已添加 Agent 的可见列表 | harness settings 新增可选目录元数据 | 否 | 否 | 否 | 当前界面 |
| Agent 停用 | `disabledIds` / 对应 custom 条目准入 | 否 | 否 | 否 | 阻止新的准入；不强杀正在运行的轮次 |
| Agent 默认来源和模型 | `defaults[harnessId]` | 是，完整 route | 是 | 是 | 新任务 / 任务明确更新后下一轮 |
| 推理强度 | 使用现有执行设置字段和能力范围 | 是 | 是 | 是 | 下一轮；缺能力不传 |
| Agent 自动选择偏好 | `agentOrder` 与新增选择策略 | 是 | 是，团队快照 | 否 | 下次派工 |
| 默认权限 | 现有授权与 harness default | 只允许收紧 | 依现有宿主授权 | 依现有授权 | 新准入，不能改正在执行的安全快照 |
| 总管模型 | `ade.managerModel` | 是 | 是 | 是 | 下一轮总管执行 |
| 允许持久协作 | 任务设置快照的 `collaboration.enabled`（提案） | 可设新任务默认 | 是，显式更新 | 不靠任意 prompt 隐式改写 | 下一次 Manager 准入 |
| worker 建议数量与活跃上限 | `ade.limits` | 是 | 是 | 否 | 后续创建/派工准入 |
| 团队 token 提醒/上限 | `ade.budget` | 是 | 是 | 否 | 累计团队用量，后续受控操作检查 |
| 一对一隔离默认与起点 | harness default / 新增 ADE workspace defaults | 是 | 创建后只读 | 创建前可改 | 新建工作区 |
| 本机共享路径 | `agents.kun.worktrees.sharedPaths` | 该记录本身按项目 | 否 | 否 | 新建工作区准备 |
| 仓库 setup/checks/共享声明 | `.kun/project.json` + digest/grant | 仓库声明本身 | 否 | 否 | 获准且用户请求对应动作时 |
| 通知、声音 | 现有通知偏好 | 否 | 复用已有静音能力 | 否 | 当前设备展示 |
| 休眠与无进度阈值 | `ade.hibernation`、`ade.stall` | 首版不开放 | 首版不开放 | 否 | 保持既有 runtime 语义 |

`softWorkers` 不是强制创建数量，`hardWorkers` 不是实际运行并发上限。默认值保留当前 4/8；原型中的 3/6 只是示例，不进入迁移默认值。新增并行调度器不在本轮范围。

预算以 token 表达，不能标成美元或人民币。预算拒绝以现有受控操作为边界，不宣称能够精确切断已在生成的一轮 token。

## 2 项目身份

提案 `AdeProjectIdentity`：

```ts
type AdeProjectIdentity = {
  projectId: string
  canonicalRoot: string
  displayName: string
  kind: 'git' | 'directory'
  sourceRoot?: string
}
```

- 由宿主 canonical path / Git common directory / task-workspace source 解析，renderer 不自行拼接身份。
- worktree 使用来源项目身份，实际执行 path 独立保留。
- 同名不同路径不合并；符号链接等价性按宿主解析处理；Windows 路径由平台服务规范化。
- 本轮只编辑当前宿主项目配置。未来远程身份需含宿主维度；当前不可把远程路径当作本地目录。
- 目录迁移或身份无法确认时标记需要重新关联，不靠 basename 自动套用旧配置。

## 3 普通覆盖与删除

提案 `AdeSettingsOverrides` 只允许矩阵中的普通字段，不允许任意深层 JSON patch。

```ts
type AdeSettingsMutation = {
  requestId: string
  object: AdeSettingsObject
  expectedRevision: string
  set: AdeSettingsOverrides
  unset: AdeSettingsField[]
}
```

- `unset` 表示恢复继承；`undefined` 不表示删除；`null` 只用于已有契约明确支持清空的字段。
- 一个字段不能同时 set/unset；禁止设置未列入白名单的路径。
- route 为原子组合：`harnessId/providerId/model/credentialMode/accountId?`；实际 account 字段复用现有类型。
- harness 不兼容、来源不存在、模型不可用时返回字段级错误，不偷偷换 provider 或收费渠道。
- 推理强度由选中 route 的能力校验；允许的回落必须显示给用户并等待完整配置回执。
- 不进行纯前端权限比较，继续调用已有宿主授权校验与运行时上限计算。

## 4 默认值、快照与来源

提案 `AdeExecutionSettingsSnapshot` 保存在线程/团队正本，不仅在 localStorage：

```ts
type AdeExecutionSettingsSnapshot = {
  version: 1
  revision: string
  projectId?: string
  capturedAt: string
  resolved: AdeResolvedExecutionSettings
  origins: Partial<Record<AdeSettingsField, AdeSettingOrigin>>
}
```

`AdeSettingOrigin` 取 `system/agent/project/task/turn/legacy` 并可关联 source revision。不得记录明文凭据、原生登录文件、gateway token。

解析顺序：系统值 → 选中 Agent 默认 → 项目本机覆盖 → 新建任务显式选择。之后任务使用保存快照，临时轮次选择覆盖该次输入。

“继承自项目”表示快照的来源，不表示运行期间自动跟随；UI 同时展示“创建时继承”或“已恢复为当前项目默认”。

安全权限单独按既有 authority/profile/harness 取交集，来源优先级不能绕过该交集。

### 首条消息与排队

1. Renderer 冻结完整 draft intent：项目、workspace、起点、route、执行选项、附件引用和 requestId。
2. 宿主解析有效设置并返回 snapshot revision；创建线程/工作区使用同一 intent。
3. 工作区未就绪时保存排队意图；ready 只放行匹配 workspace generation 的消息。
4. 队列项引用冻结配置版本。用户修改后续默认不重写已有排队项；修改队列项是单独动作。
5. 导航只影响视图，不能把异步结果套给另一个项目或线程。

## 5 持久化和版本

- 全局配置与项目本机覆盖沿用 SettingsStore / Service Manager 原有写入链。
- 新增项目映射拟放 `agents.kun.ade.projectDefaults`，条目包含 canonical identity 与 overrides；不存 API Key。
- Agent UI 目录元数据拟放 `agents.kun.harnesses.catalogSelection`，未设置时使用兼容投影；它不替代 enabled/admission。
- 线程快照通过现有 ThreadStore 写入，团队规模与预算仍由 TeamStore 持有；两者只引用相同 snapshot revision，不出现两个互相竞争的生效值。
- 必须由单一业务写入者执行条件更新；renderer 或 Main 不另开正本文件 writer。
- 对象 revision 是持久值内容的版本；runtime `generation` 是应用顺序号，两者同时返回。
- 旧记录缺 revision 时读取计算稳定初始版本，第一次显式更新时原子落盘；不扫描所有历史会话。

## 6 保存事务

### 本机配置

提案新增受限 IPC `settings:apply-ade-patch`，现有 `settings:set` 完全兼容。仅当 A03 确认现有入口能原生接受条件更新时，才改为扩展现有入口而不再增加 channel。

两种落地方式都必须满足：

1. 严格解析 `AdeSettingsMutation`，验证对象、字段和可信调用者。
2. 在现有串行持久化临界区内读取最新值并核对 expectedRevision。
3. 只更新目标对象的 set/unset 字段，执行已有保护设置授权。
4. 保存成功后返回 revision；通过现有 intent sequencer 申请 runtime generation。
5. 应用结果携带 generation、section、appliedRevision；旧回执不得覆盖新状态。

提案回执：`savedRevision`、`runtimeGeneration?`、`application: applied|pending|failed|not-required`、`fieldErrors?`。

保存成功而 runtime 不在线时显示“已保存，连接后应用”。应用失败时保留已保存的意图与失败详情；重试应用不会重新保存旧快照。

并发冲突返回 `settings_conflict` 和最新摘要；表单显示差异，保留用户草稿，禁止自动以整份旧设置覆盖新值。

### 当前任务

提案 `GET/PATCH /v1/threads/:threadId/ade-settings`，内部 URL 可保留，但适用于统一 Code 工作台的合法线程。PATCH 使用 requestId、expectedRevision、set/unset；可编辑协作策略不代表所有 Code 线程都自动获得 Manager 权限。

返回 `effectiveNow`、`pendingSettings?`、`applyAt`、`revision`。模型类配置在下轮准入原子消费；团队上限在下一次受控创建/派工准入使用，不取消已接受的执行。

busy 状态下不允许变更绑定工作区或直接销毁原生会话。用户选择不支持热变更的配置时，返回明确边界与原因。

## 7 API 复用和新增清单

所有提案 API 均需要正式 strict schema、授权、可重试边界和能力协商；下面不是已存在接口清单。

| 状态 | 接口/通道 | 处理 |
| --- | --- | --- |
| 已有 | harness 列表、models、provider groups、probe、test | 复用并归一化 reasonCode 与操作状态 |
| 已有 | thread 创建、发送、SSE、队列、历史 | 加可选 settings revision，不改旧请求默认解释 |
| 已有 | team overview、worker controls、questions、verdict、checks | 显式按 ID 使用，回执带最新目标版本 |
| 已有 | task-workspaces diff、comments、integrate-preview、integrate | 加可选成果版本/预检令牌 |
| 提案 | `settings:apply-ade-patch` | 本机配置的条件保存外壳 |
| 提案 | `GET /v1/ade/settings/effective` | 给定已验证 project/thread 上下文读取脱敏值、来源和字段能力 |
| 提案 | `GET/PATCH /v1/threads/:threadId/ade-settings` | 任务配置与生效边界 |
| 提案 | `GET /v1/ade/attention` | 有界活动与验收联合摘要；可先复用已有 snapshot transport 返回同样投影 |
| 提案 | 审查 revision 字段与 preview token | 优先增量扩展已有 review/workspace endpoint |

不要同时实现两份语义相同的 attention API。A13 选择现有快照扩展或单一新读接口，桌面/手机共享客户端解析器。

新写接口在旧 runtime 缺能力时禁用对应新编辑入口并说明版本原因；旧任务查看和原有操作继续可用。

## 8 视图上下文与会话隔离

提案 renderer `AdeViewContext`：

```ts
type AdeViewContext = {
  taskThreadId: string | null
  inspectedWorkerId: string | null
  reviewTarget: AdeReviewTarget | null
  rightPanel: 'workers' | 'review' | 'settings' | 'tools' | null
  returnContext?: AdeReturnContext
}
```

- 只保存导航与展示，执行事实仍来自现有 stores。
- `ConversationScope` 使用 threadId + execution generation，持有自身 transcript cursor、draft、attachments、queue 和 abort 生命周期。
- 子视图不能写入全局 activeThreadId 的 blocks/input；共用纯时间线组件和按线程读取控制器。
- 返回上下文包含模式、主任务、选中 worker、面板、滚动锚点、草稿 key；不放令牌或复制整段消息。
- 数据更新到达已卸载视图时可以更新缓存，但不能抢焦点或改变当前任务。

## 9 注意事项联合投影

提案 `AdeAttentionItem` 含稳定 `attentionId`、thread/worker/workspace/request ID、`kind`、summary、状态版本及允许的 actions。

- kind：approval、question、user-input、failure、workspace-conflict、review-required。
- approval/request 已解决时，重复点击返回当前结果；过期请求不能重新执行。
- unread/ack 与 resolution 分开。标已读不修改问题状态或 verdict。
- cancelled 是用户停止的结果，不能通用投影成失败；是否还要处理由残留请求/改动决定。
- 数据过期或恢复未确认时标“正在同步/尚未确认”，不能当作 failed/done。
- parent rollup 统计子项，列表默认不把全部 worker 重复铺成根任务。

## 10 审查对象、版本与集成

提案：

```ts
type AdeReviewTarget = {
  ownerThreadId: string
  workerId?: string
  dispatchId?: string
  workspaceId: string
  scope: 'dispatch' | 'workspace'
}
type ReviewRevision = {
  version: 1
  baseRevision?: string
  headRevision?: string
  contentDigest?: string
  completeness: 'complete' | 'incomplete'
}
```

当前结果 validity 为 `current/stale/unknown`，由目标与 revision 匹配得出。非 Git 目录不能伪造 head/base，使用有界成果清单和内容指纹，UI 隐藏分支合入操作。

批注、检查、独立审查和人工裁决关联目标版本。旧用户 verdict 的锁只保护对应版本的历史记录，不能使新版本继承通过，也不能被总管覆盖。

文件变动时已有批注重新定位或标为 outdated；不确定位置禁止静默贴到新行。批量发送引用固定批注集合和 requestId。

集成预检提案返回 `previewToken`，绑定 source snapshot、target HEAD、target 工作区摘要和 integration mode。提交时验证 token 并重检；过期返回 `review_revision_changed` 或 `integration_target_changed`，要求刷新预检，不自动重放合并。

有工作区写入租约时复用它；没有覆盖外部写入的能力时，检查前后指纹并明确可验证范围。不得声称通过 UI 冻结了用户或外部进程。

## 11 迁移规则

- 旧 ADE 4/8 worker 默认、预算、权限、Agent route 原样保留，不应用原型示例数字。
- 已添加列表迁移保留有显式配置、历史引用或就绪检测的 Agent；探测不能作为“已登录”的确定证据。
- 原生登录文件只由相应 CLI/既有认证服务维护，添加向导不复制这些凭据。
- 旧 `agentsHarnesses`、实验室配置入口重定向；API key 始终留在现有来源管理链。
- 缺设置来源的线程标 `legacy`。不虚构“来自项目”，不回填全部历史。
- 旧 verdict 没有版本时显示历史/待重新确认；不当成当前成果通过。
- 移除自定义 Agent 前查询引用并显示后续影响；历史仍可读，记录保留稳定 ID/显示名，不能级联删会话。
- 仅关闭新 UI 的回退保留新数据；旧二进制保存会丢字段的风险必须在 A18 兼容测试中揭示并提供恢复步骤。

## 12 统一错误码提案

`settings_conflict`、`settings_apply_failed`、`project_identity_unavailable`、`route_unavailable`、`capability_unsupported`、`pending_execution_boundary`、`request_already_resolved`、`review_revision_changed`、`review_revision_incomplete`、`integration_target_changed`。

错误响应包含稳定 code、局部 field/target、可重试动作；原始诊断收进详情并脱敏。UI 不通过匹配英文异常字符串决定授权或重试行为。

## 13 Code 单页面的兼容契约

- 新增联合 Code 工作台列表/搜索范围（提案 `workbench_scope=code`），覆盖历史 Code 分类和旧 ADE 线程，排除 Work/Rooms；旧 `workspace_mode` 语义不变。
- 统一排序、搜索、归档和 cursor，由服务端共享分类器实现。不能拼两份第一页冒充完整列表。
- 原始 `workspaceMode` 不批量重写，新任务写 code；fork 保留历史元数据，仍出现在统一 Code 列表。
- `collaboration.enabled` 缺失时，旧 Code 保持原委派语义；旧 ADE 根据原角色/team/准入规则解析。不是所有旧 ADE 子线程都能成为总管。
- Manager 广告/执行共同判断策略、实际 Kun harness、工作表面、worker/Rooms 身份和宿主权限，禁止由 UI route 单独授权。
- 功能关闭不隐藏历史，不禁止停止/处理在途请求；新协作准入关闭且不自动扩权。
- 新 UI 先依赖 runtime 联合查询能力，兼容层保证旧历史可达；缺能力不宣称列表完整。
- workspace intent 包含明确 owner：现有当前目录、Code 计划 agent-managed、host task-workspace 或 Graph；同一执行单元只允许一个创建者。
