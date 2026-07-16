# Kun 组合式能力扩展与协作工作台改造设计

- 日期：2026-07-16
- 状态：设计已分节确认，待书面评审
- 适用范围：Kun 桌面端、内置 `kun serve`、独立 `kun-collab-server`
- 关联规范：`2026-07-13-kun-multi-user-collaboration-design.md`
- 约束基线：`docs/AGENTS.md`、`docs/kun-architecture.md`

## 1. 执行摘要

本次改造在 Kun 单运行时架构上补齐五类能力：

1. 在对话框增加普通模式与专家模式，专家模式可选择已激活专家或专家团。
2. 为专家和专家团提供严格规则执行、并行任务、实时进度、中断、继续与崩溃恢复。
3. 将 MoA 作为普通模型目录中的虚拟模型提供，内部完成多模型并行与聚合。
4. 将迁入的 Design skills、组件库和资源融合到现有“设计 - 设计上下文 - 设计系统”。
5. 新增完整 Collaboration 工作台，支持会议、接待数字员工、联网邀请、端到端加密、跨设备同步和受限远程调用。

实现采用“能力扩展层 + 稳定接缝”的方式。核心只提供版本化契约和注册槽；各领域拥有自己的服务、路由、状态、迁移和 Renderer 贡献。所有 Agent 执行仍通过唯一的 `kun serve`，不创建第二个 Agent Runtime，不在 Renderer 内实现 Agent 编排。

第一实施优先级是修复当前“智能体能力页面无数据”。该问题不是资源本身缺失，而是测试把临时应用路径写入了真实 Kun 配置，持久化的错误路径又在正常启动时覆盖托管资源根；同时安装包没有包含 `experts/` 和 `design/`。本方案以统一资源定位器、测试数据目录隔离和打包回归测试根治该问题。

## 2. 目标与非目标

### 2.1 目标

- 普通对话行为保持不变，新增能力通过明确模式或模型选择进入。
- 专家与专家团分别维护最多 5 个激活项，激活第 6 个时自动剔除最早项。
- 线程固定保存执行规则快照，后续修改专家定义不改变已开始线程的语义。
- 专家团真正并行执行，可观察、可单项控制、可整体控制、可从异常中恢复。
- MoA 对调用方表现为普通模型，复用已有 Provider、账户、模型、流式、工具、用量和中断契约。
- Design 资源成为现有设计上下文的一部分，不再形成独立的智能体能力孤岛。
- Collaboration 提供可自托管的联网异步协作，同时保证本地凭据、工作区和 Agent 权限不外泄。
- 每个阶段可以独立测试、独立合并、独立回滚，降低与后续 Kun 上游更新的冲突。

### 2.2 非目标

- 不恢复 Agent 切换器、旧 Provider、旧 RPC/进程管理器或运行时诊断面板。
- 不让 Renderer 直接执行 Agent loop、持有长期协作密钥或访问远端成员的本地 Kun。
- 不把专家团内部协作与多人会议协作合并为同一领域模型。
- 不为 MoA 重复保存 API key，也不允许 MoA 递归调用 MoA。
- Design 不新增第二套画布、预览、导出或 Code 交付流程。
- Collaboration 第一完整版本不包含官方云、Docker、P2P/NAT 穿透、实时共同编辑、音视频、SSO、多设备身份或远程直接写入工作区。

## 3. 设计原则

### 3.1 单运行时不变量

```text
Renderer
  Code / Write / Design / Collaboration
        |
        | window.kunGui 受约束 IPC
        v
Electron Main
  RuntimeHost + 本机系统服务 + Collaboration Client
        |
        | loopback HTTP + SSE
        v
kun serve
  唯一 Agent Runtime
```

- 所有专家、专家团和 MoA 执行进入同一个 Kun thread/turn/event 体系。
- `kun serve` 继续保持 loopback-only。
- 新能力优先通过 Kun contract、port、adapter、route 和 loop hook 扩展。
- Collaboration Server 只承担协作协议职责，永不成为 Agent Runtime。

### 3.2 可插拔与组合式扩展

能力扩展层提供以下稳定契约：

| 契约 | 职责 |
| --- | --- |
| `KunExtension` | 注册领域服务、路由、loop hook、模型目录和工作台贡献 |
| `ConversationExecutionProfile` | 描述普通、专家、专家团执行方式及不可变规则快照 |
| `ModelCatalogEntry` | 将物理模型与 MoA 虚拟模型统一暴露给模型选择器 |
| `WorkbenchModeContribution` | 注册 Collaboration 等顶级工作模式与导航 |
| `DesignContextContribution` | 向现有 Design Context 注册系统、skill、组件和资源摘要 |

`kun/src/extensions/` 继续专用于现有 MCP 扩展平台；本次能力扩展使用既有 `kun/src/seam/`，不得混用命名空间。

新增功能只能在自有领域目录实现，并通过一个 feature contribution 注册。上游核心文件只保留少量稳定分发点；新增领域不得继续增加零散接入点。

### 3.3 数据所有权

- Kun 线程、事件、用量和 Agent 执行状态继续由 `kun serve` 管理。
- 扩展领域数据写入当前 `agents.kun.dataDir` 下的版本化子目录。
- 工作区设计选择写入 `.kun-design/context.json`。
- 协作身份、MLS 状态、TaskKey、Outbox 和同步投影属于 Electron Main。
- 长期密钥、远端凭据和未脱敏协作正文不得进入 Renderer store、日志或诊断 UI。

## 4. 当前无数据问题与资源定位改造

### 4.1 根因

已确认的失败链路为：

1. `src/main/kun-process.test.ts` 将 `app.getAppPath()` 模拟为 `/tmp/deepseek-gui-test-app`。
2. 测试设置未覆盖 `agents.kun.dataDir`，启动逻辑把测试资源根写入真实 `~/.kun/data/config.json`。
3. `managedExtensionConfig()` 在托管默认值之后展开已保存配置，导致错误的 `pluginRoots`、`librariesRoot` 等继续覆盖正常应用根。
4. 每次启动都复用错误路径，因此专家、专家团、MoA 和 Design 页面得到空数据。
5. `electron-builder.config.cjs` 未将 `experts/` 与 `design/` 放入安装包，已安装版本即使修正配置也无法找到内置资源。

日志中的 `ENOENT` 指向测试目录下的 `design/design_libraries`，与上述链路一致。

### 4.2 `ExtensionResourceLocator`

新增 Electron Main 侧 `ExtensionResourceLocator`，作为冷启动和设置热应用的唯一资源解析入口：

```text
development:
  app/repository root

packaged:
  process.resourcesPath/kun-extensions

user data:
  agents.kun.dataDir/<feature>
```

定位规则：

- 内置专家、Design 库和 Design skills 的托管根由 locator 计算，持久化旧值不能覆盖。
- 用户额外配置的专家根继续保留，并在托管根之后合并、规范化和去重。
- 冷启动与设置热应用必须调用同一 locator，不能分别推导路径。
- 发现旧的测试路径、已不存在的应用路径或旧安装根时自动修复落盘配置，并记录不含敏感内容的迁移日志。
- 单个插件或设计库损坏只隔离该资源并报告验证错误，不阻断其余资源加载。

### 4.3 打包与测试隔离

- 使用 `extraResources` 将 `experts/`、`design/design_libraries/`、`design/runtime-skills/` 和 `design/skills/` 打包到 `kun-extensions/`。
- `kun-process` 测试必须为每个用例创建临时 `dataDir`，禁止访问真实用户目录。
- 测试结束清理自身临时目录，不修改开发者现有配置。
- 增加冷启动修复、热应用一致性、用户额外根保留和打包清单回归测试。

## 5. 对话模式与专家能力

### 5.1 Composer 交互

在对话框底部权限选择器右侧新增“对话模式”分段选择：

```text
权限访问 | 对话模式：普通 / 专家 | 模型
```

- 普通模式沿用现有对话流程和默认模型行为。
- 专家模式显示专家/专家团二级选择器。
- 选择器分别最多展示 5 个已激活专家和 5 个已激活专家团，不从完整资源库临时搜索未激活项。
- 输入框上方展示当前专家或专家团成员图标和运行状态；点击打开无嵌套卡片的进度抽屉。
- 模式、目标和模型在发送前可改；turn 开始后以执行快照为准。

### 5.2 激活队列

专家与专家团使用两个独立、持久化的最近激活队列：

- 每个队列容量为 5。
- 激活新项时追加到队尾；若超过 5，自动移除最早项。
- 已在队列中的项再次激活时移动到队尾，不产生重复项。
- 停用只从激活队列移除，不删除专家定义。
- 删除专家定义时同步清除队列引用，并以可恢复提示处理已存在线程中的历史快照。
- 旧数据首次迁移时按明确的激活时间或更新时间排序；时间相同按稳定 ID 排序，保证结果可重复。

### 5.3 自定义专家与专家团

专家/专家团页面支持创建、编辑、复制、删除、校验和激活：

- 创建专家时可选择一个专家样例提示；创建专家团时可选择一个团队样例提示。
- 样例只负责预填结构和规则说明，保存前必须经过 schema 与规则校验。
- 专家定义包含角色、目标、强制规则、禁止事项、输出格式、工具策略和可选模型偏好。
- 专家团定义包含团队目标、负责人、成员、任务分解策略、依赖、并发上限、汇总规则和失败策略。
- 用户自定义数据与内置只读资源分离，升级时不覆盖用户定义。

### 5.4 不可变执行快照

线程不直接依赖可变专家记录，而是保存版本化执行配置：

```typescript
type ConversationExecutionProfile =
  | { kind: 'normal'; version: 1 }
  | { kind: 'expert'; version: 1; expertId: string; snapshot: ExpertRuleSnapshot; digest: string }
  | { kind: 'expert_team'; version: 1; teamId: string; snapshot: ExpertTeamRuleSnapshot; digest: string }
```

- 发送首个 turn 时固化规则快照与 digest。
- 后续编辑专家定义不改变已开始线程。
- 用户可显式“基于最新版创建新线程”，不能静默替换旧规则。
- 专家规则注入动态上下文区，保持 Kun 稳定系统前缀不变，避免破坏缓存命中。

### 5.5 单专家执行

- 使用当前主 Agent loop，不创建独立运行时。
- 每个 model step 前验证执行快照、规则 digest 和工具策略。
- 规则冲突时按系统安全策略、用户权限、专家强制规则、当前用户请求的优先级处理。
- 专家不得扩大用户选择的 sandbox、approval 或工具权限。

## 6. 专家团并行编排与恢复

### 6.1 编排模型

复用并增强现有 `CollaborationPlan`、`CollaborationTask` 和 orchestrator：

1. 团队负责人把目标分解为带依赖的任务图。
2. 图通过 schema、循环依赖、成员能力、并发和预算校验。
3. 无依赖任务并行派发到各成员的 Kun child turn。
4. 成员事件汇聚到父线程，负责人按团队规则综合结果。
5. 汇总结果仍通过父线程正常流式输出，并记录每项贡献来源。

专家团队事件继续使用现有 `collaboration_*` 命名空间，不与多人会议复用。

### 6.2 状态与控制

任务状态至少包含：

```text
queued -> running -> completed
                 -> failed -> retrying
                 -> paused -> running
                 -> interrupted -> running
                 -> aborted
```

用户可以：

- 查看每个专家的实时摘要、当前步骤、开始时间、耗时和最后事件。
- 暂停、继续、中断或重试某个专家任务。
- 暂停、继续或中断专家团全部任务。
- 对失败任务修改要求后重试；已完成且未受依赖变化影响的任务不重复执行。

### 6.3 真实中断与异常恢复

- 任务控制必须连接到实际 Turn `AbortController`/interrupt API，禁止只更新状态而不停止执行。
- 子任务持久化 `threadId`、`turnId`、依赖版本、输入摘要、最后事件序号和可恢复检查点。
- 应用重启时，遗留 `running` 转为 `interrupted`，由用户选择继续、重试或终止。
- “继续”只在原 turn 可恢复且输入/规则未变化时使用；否则创建新 turn 并关联前一尝试。
- 聚合前检测缺失、失败或过期贡献，根据团队失败策略等待、降级汇总或请求用户处理。
- 重复控制命令必须幂等，网络或 UI 重试不能创建重复子任务。

## 7. MoA 虚拟模型

### 7.1 模型目录契约

MoA 以虚拟 Provider 暴露：

```text
providerId = moa
modelId    = moa:<presetId>
```

- MoA 设置只引用 Settings 中已配置的 Provider、账户和模型 ID。
- 不复制 API key，不产生第二套 Provider 设置。
- 保存并校验成功的预设出现在普通模型选择器的 MoA 分组中。
- 调用方继续使用标准 model client 接口，不感知内部 fan-out。
- 禁止参考模型或聚合模型指向 `moa:*`，从配置和运行时两层阻断递归。

### 7.2 预设配置

每个预设包含：

- 一个聚合模型。
- 一个或多个参考模型槽位。
- 每槽位 reasoning、temperature、输出上限、超时和启用条件。
- 总并发、总预算、参考上限、fan-out 时机和上下文预算。
- 文本、图片、视频等模态处理策略。
- 部分失败策略和聚合提示版本。

保存时验证模型存在、账户可用、模态兼容、上下文上限、预算上限和无递归引用。配置引用使用稳定 ID；显示名称变化不破坏预设。

### 7.3 执行流程

```text
用户请求
  -> 上下文预算与模态规划
  -> 无工具参考模型并行推理
  -> 规范化、裁剪和标注参考结果
  -> 追加到稳定前缀之后的聚合上下文
  -> 聚合模型作为 acting model 正常流式执行和调用工具
```

- 参考模型不调用工具，避免重复副作用和权限放大。
- 聚合模型沿用普通模型的工具、审批、SSE、中断、缓存和用量行为。
- 单个参考失败时标记并继续；全部失败时退化为聚合模型单独执行。
- 上下文不足时按预设优先级裁剪、摘要或跳过参考结果，不能截断系统安全指令和用户最新请求。
- 同一参考请求使用稳定排序，聚合尾部注入保持可复现并减少缓存抖动。

### 7.4 多模态边界

- 聚合模型必须原生支持本次请求要求的最终模态。
- 参考槽位可配置“原生接收”“派生文本”“跳过不兼容模态”。
- 图片可使用受控 OCR/视觉摘要，视频可使用转录、关键帧和时间轴摘要；派生过程计入用量和审计。
- 未配置可靠派生器时显式跳过该参考槽位，不把二进制路径伪装为文本能力。
- 附件的 `localFilePath`/`FilePath` 继续沿现有跨层契约传递，不能只追加到提示文本。

### 7.5 用量、成本与有效性评测

- 记录每个参考槽位与聚合模型的 token、缓存、延迟、失败和估算成本。
- 预设默认标记为“未验证”。
- 使用固定评测集与当前最强单模型做成对 A/B 盲评，覆盖事实性、推理、代码、长上下文和多模态。
- 只有质量提升达到预设统计阈值，且成本和 p95 延迟未超过预算，才标记为“已验证”。
- 评测报告保留样本版本、裁判模型/人工规则、随机顺序、置信区间和共同失败率。

实现参考 Hermes Agent MoA、OpenRouter `openrouter/fusion`、Mixture-of-Agents（arXiv:2406.04692）以及异构集成、置信度路由、推理记忆和轨迹级汇总的后续研究。参考实现仅提供行为依据，不改变 Kun 自身的 Provider、权限和线程契约。

## 8. Design 融合

### 8.1 信息架构

移除“智能体能力”中的独立 Design System、Design Skills 和组件库入口，将后端能力贡献到：

```text
设计
  -> 设计上下文
      -> 设计系统
          系统 / Skills / 组件 / Assets
```

- 保留现有 Design 画布、预览、版本、导出和交付 Code 流程。
- Design 扩展服务继续负责扫描、搜索、校验和详情读取。
- Renderer 使用 `DesignContextContribution` 聚合数据，不直接依赖扩展内部路径。
- 原独立路由保留一个兼容周期，只做重定向和迁移提示，不保留两套可编辑界面。

### 8.2 上下文选择与注入

- 工作区选择写入 `.kun-design/context.json`，包含 schema version、资源 ID、版本和启用状态。
- 默认只向模型注入已选择资源的有界摘要、token 估算和查询句柄。
- 完整组件、skill 或资产详情按需通过工具读取，避免把全部设计库放入稳定系统前缀。
- 资源升级或缺失时保留原 ID，显示迁移/重新选择操作；其他设计功能继续可用。
- 工作区选择可随项目版本控制，用户级自定义资源继续留在 Kun dataDir。

## 9. Collaboration 工作台

本节继承并约束 `2026-07-13-kun-multi-user-collaboration-design.md`。若细节冲突，以该完整协作规范中的安全状态机、TaskKey 保管规则、协议字段和发布门禁为准；本文件定义它与本次能力扩展的组合边界。

### 9.1 工作台布局

主菜单在 Code、写作、设计之外增加“协作”。

```text
左侧上区：会议列表、邀请、连接/同步状态
左侧下区：已发布接待数字员工
右侧：当前会议工作区或数字员工详情
```

- 点击会议显示时间线、成员、角色、任务、进度、调用、交付和审计。
- 点击数字员工显示发布范围、能力摘要、限制、在线状态、调用记录和撤销入口。
- Server profile、TLS/MLS 状态、待处理邀请和加密 Outbox 提供明确状态，但不暴露密钥或正文。
- Collaboration 与专家团队使用不同图标、文案、实体和事件命名，避免两种“协作”混淆。

### 9.2 服务边界

独立原生 `kun-collab-server` 负责：

- 身份认证、服务端可见 RBAC、协议版本协商。
- 单调事件排序、幂等命令、密文中继和密文 blob 存储。
- 邀请、成员关系、在线状态、配额、限流和加密备份。

服务端不运行模型、不访问成员工作区、不连接成员本地 Kun、不持有 MLS 或 TaskKey 解密能力。

Electron Main 负责：

- `IdentityVault`、MLS adapter、TaskKey 保管与轮换。
- TLS 连接、服务器实例/SPKI 校验、同步引擎和加密 Outbox。
- 本地投影、通知、交付物打包/预览/应用。
- 接待数字员工发布和本地受限执行网关。

### 9.3 身份、邀请与端到端加密

- 会议内容使用 RFC 9420 MLS；优先选用 OpenMLS，不手写密码协议。
- 任务正文使用独立、随机、可轮换的 `TaskKey`。
- 接待员工调用正文使用调用方与 employee owner 之间的点对点加密。
- 设备私钥优先使用 Electron `safeStorage`；不可用时使用 Argon2id 加密文件与严格文件权限。
- 传输强制 TLS 1.3，并校验服务器实例身份和 SPKI 指纹。
- 邀请支持一次性凭据、成员审批、角色授权和撤销。
- 第一版本一个成员身份绑定一台设备；显示名称可改，授权永远基于稳定 member ID。
- 移除成员时推进 MLS epoch，并从其参与任务中移除、轮换对应 TaskKey generation。

### 9.4 同步、Outbox 与恢复

- 本阶段的“跨设备同步”指不同成员各自绑定设备之间同步同一会议的加密事件与本地投影；第一版本不提供同一成员身份的多设备漫游。
- 客户端持久化最后验证序号、MLS 状态、TaskKey、加密 Outbox 和本地投影。
- 命令携带稳定 command ID 和 optimistic version，重发不得产生重复任务、决定、调用或交付。
- Outbox 跨 MLS epoch 或 TaskKey generation 时必须用新密钥重加密；禁止明文或旧密钥降级发送。
- 断线、客户端崩溃和服务器重启后从最后验证序号恢复。
- 检测到签名错误、篡改、序号分叉、MLS checkpoint gap 或服务器身份异常时进入只读 `SECURITY_SYNC_REQUIRED`。
- 安全恢复状态禁止发送新消息、调用员工、提交交付或应用产物，直到用户完成受验证恢复。

### 9.5 会议任务与本地线程

- 人类协作使用独立 `Meeting`、`HumanCollaborationTask` 和 `ReceptionEmployee` 领域。
- 事件命名空间为 `meeting_*`、`human_task_*`、`employee_invocation_*`。
- 只有被指定 target 能接受或拒绝自己的任务；接受成员共享一个任务室，但各自拥有独立本地 Kun thread 和 workspace。
- 本地协作线程通过 `LocalTaskThreadBinding` 绑定 meetingId/taskId，并使用 `meeting_collaboration` 上下文模式。
- 本地模型推理、工具日志、文件读取和草稿默认不上传；只有用户显式发布的进度和交付进入会议。

### 9.6 远程接待数字员工调用

- 远程成员只能调用 owner 显式发布到当前会议或任务的接待数字员工。
- 调用只在 owner device 的本地 Kun 执行。
- `ReceptionSession` 使用独立上下文、固定工具白名单、workspace sandbox、预算、超时和本地审批。
- `danger-full-access` 对远程调用不可达；高风险工具默认拒绝。
- 远端不能获知模型凭据、MCP 地址、工具 schema、文件路径或本地权限。
- owner 离线时调用进入加密待确认状态，不转移到服务端执行。
- owner 可暂停发布、撤销范围或中断当前调用；状态通过密文事件同步给调用者。

### 9.7 加密交付与手动应用

- 交付物使用独立内容密钥、签名 manifest、分块上传、双向 hash 和断点续传。
- 接收方先在隔离区预览文本、diff 和安全元数据，二进制不得自动执行。
- 只有用户显式点击应用后才写入选定工作区。
- 应用前拒绝绝对路径、路径穿越、symlink escape、设备文件、Windows 保留名、超长路径和超限解压。
- Git 与非 Git 工作区都校验 baseline；不匹配时进入人工处理，不强行覆盖。

## 10. 统一错误与恢复语义

扩展层统一暴露以下能力状态：

```text
unavailable       依赖或配置不存在
degraded          部分能力失败但核心路径可继续
ready             可正常执行
interrupted       执行中断且存在恢复选择
security_blocked  安全一致性未验证，只读阻断
```

错误响应使用稳定错误码，并包含可选 `retryable`、`requestId`、`currentVersion` 和 `retryAfterMs`。UI 根据错误码显示恢复动作，不能解析英文错误字符串决定行为。

- 专家团：保留任务检查点，提供继续、重试、终止。
- MoA：参考槽位部分失败时降级，全部失败时聚合模型单独执行。
- Design：单资源失效不阻断画布和其他上下文贡献。
- Collaboration：任何密码学或历史一致性异常进入只读安全恢复，不允许静默忽略。
- 所有重试命令必须幂等，且携带原 request/command ID。

## 11. 迁移与兼容

### 11.1 线程执行配置

现有 `expertId`、`expertTeamId`、`conversationMode` 和 `moaPresetId` 只作为迁移输入。读取时归一化为 `ConversationExecutionProfile` 和 `ModelCatalogEntry` 引用；新写入使用当前版本化结构。

迁移规则必须：

- 幂等，可在重复启动时安全执行。
- 保留未知字段的只读备份，不把无效值写回当前 schema。
- 记录迁移版本和摘要，不记录提示正文、密钥或用户内容。
- 遇到歧义时保持普通模式并提示用户确认，不猜测专家或 MoA。

### 11.2 资源和 Design

- 自动修复已持久化的测试路径、旧应用根和不存在的托管根。
- 用户额外专家根、用户自定义专家和团队不随内置资源升级被覆盖。
- Design 选择迁移到 `.kun-design/context.json`。
- 原 Design 独立入口保留一个兼容周期的重定向，之后移除。

### 11.3 Collaboration

- 协作 schema、协议版本和加密状态独立迁移，不混入 Kun thread 数据文件。
- 客户端与服务端使用版本区间协商和兼容矩阵。
- 升级演练同时覆盖 server-first 与 client-first。
- 无法验证旧加密状态时保持只读导出能力，不伪造恢复或清空历史。

## 12. 分阶段实施与发布门禁

### Phase 0：资源与接缝基线

- 完成 `ExtensionResourceLocator`、测试 dataDir 隔离、配置修复和资源打包。
- 收敛 `KunExtension`、execution profile、model catalog、workbench/design contribution 契约。
- 验证未启用能力时普通 Kun 行为与上游一致。

退出条件：开发和打包环境均能加载内置专家与 Design 资源；测试不再污染真实配置；冷启动和热应用使用相同路径。

### Phase 1：专家与专家团

- 激活队列、自定义创建、样例提示、Composer 模式与快照。
- 单专家严格执行、专家团任务图、并发、进度、真实中断和恢复。

退出条件：专家/专家团各 5 项上限和 FIFO 剔除可验证；单项/全局中断真实停止 turn；重启后可恢复。

### Phase 2：MoA

- 预设配置、现有模型引用、虚拟模型目录、并行参考、聚合、多模态和用量。
- 建立固定 A/B eval harness 和“已验证”门禁。

退出条件：调用方与普通模型无差别；无递归；部分失败、全失败、超长上下文和模态不兼容均有确定行为。

### Phase 3：Design 融合

- 将系统、skills、组件、assets 注册到 Design Context。
- 完成工作区选择、按需详情、旧入口重定向。

退出条件：独立能力页不再显示 Design；现有画布、预览、导出和 Code 交付无回归。

### Phase 4：Collaboration 技术关卡

- MLS 候选实现、IdentityVault、原生 server 包和三客户端协议原型。
- 验证 Add/Remove、离线追赶、篡改拒绝、TaskKey sponsor 和 Outbox 重加密。

退出条件：`2026-07-13-kun-multi-user-collaboration-design.md` 的 Phase 0 Go/No-Go 全部通过；失败即停止后续联网功能开发并回到设计。

### Phase 5：Collaboration 产品闭环

按会议基础、共享人类任务、接待数字员工、加密交付、生产加固依次发布。每个子阶段必须同时满足技术门禁和可演示用户闭环，不合并成一次不可审计的大改动。

## 13. 测试与验收策略

### 13.1 基础质量门禁

- 新模块行覆盖率和分支覆盖率不低于 80%。
- 权限、状态迁移、密钥轮换和安全拒绝分支覆盖率为 100%。
- 每阶段运行相关 Vitest、`npm run typecheck`、`npm run build:kun` 和 `npm run build`。
- UI 阶段增加 Playwright/Electron E2E、桌面/移动尺寸截图和控制台错误检查。
- 发布前执行依赖审计；发现 Critical/High 新漏洞时阻断发布。

### 13.2 资源回归

- 测试进程使用独立临时 dataDir，真实 `~/.kun/data/config.json` 内容前后完全一致。
- 错误测试路径、旧安装路径和不存在根可在冷启动自动修复。
- 设置热应用结果与冷启动一致。
- 用户额外专家根在修复后仍保留且顺序稳定。
- 打包产物包含全部托管资源，安装态 locator 能读取。

### 13.3 专家与专家团

- 两个激活队列分别验证新增、重激活、停用、删除、重启和第 6 项 FIFO 剔除。
- 快照验证专家编辑前后旧线程规则不漂移。
- 任务图覆盖并行、依赖、循环拒绝、并发上限和预算。
- 覆盖单任务暂停/中断/继续/重试、全局暂停/中断/继续、父 turn 中断和应用崩溃恢复。
- 验证中断到实际 model stream/turn abort 的端到端传播。

### 13.4 MoA

- 契约测试覆盖预设校验、模型消失、账户失效、递归引用和稳定目录 ID。
- 集成测试覆盖并发限制、超时、部分失败、全部失败、取消、用量和缓存。
- 上下文测试覆盖超限裁剪、最新用户请求保留和参考顺序稳定。
- 多模态测试覆盖原生传递、OCR/转录/关键帧派生和显式跳过。
- A/B 评测对比最强单模型，记录质量、成本、p50/p95 延迟、共同失败率和置信区间。

### 13.5 Design

- 扫描、验证、搜索、选择、缺失资源和版本迁移测试。
- 验证只注入选择项的有界摘要，完整详情按需读取。
- E2E 覆盖设计系统选择、画布迭代、预览、导出和交付 Code。

### 13.6 Collaboration

- 密码学：官方 MLS vectors、Add/Remove/Commit、离线 epoch、tamper、replay、stale epoch、removed member。
- 三客户端：邀请、角色、目标成员决定、部分拒绝、TaskKey 等待/重发、重连去重。
- 接待员工：发布范围、owner 离线确认、工具白名单、本地审批、中断和脱敏结果。
- 交付：100 MB 分块断点续传、hash/signature、路径安全、baseline 不匹配和手动 apply。
- 故障注入：丢包、延迟、重复、乱序、server restart、client crash、磁盘满、证书替换和历史分叉。
- 安全检查：扫描 server 数据库、blob、备份和日志，确认不存在会议明文、密钥、凭据和项目正文。

## 14. 验收场景

1. 全新开发启动和安装包启动均显示专家、专家团、MoA 与 Design 数据。
2. 连续激活 6 个专家时第 1 个自动退出；专家团队列独立执行同样规则。
3. 专家模式创建线程后修改专家规则，旧线程仍使用原快照，新线程使用新版。
4. 专家团并行运行时可查看每项进度，中断一个成员不影响无依赖成员；全局中断停止全部实际 turn；重启后可继续。
5. 保存 MoA 预设后可从普通模型选择器的 MoA 分组选择，流式、工具、审批、中断和用量与普通模型一致。
6. 某个 MoA 参考失败时仍返回聚合结果；全部参考失败时明确显示降级且由聚合模型完成。
7. Design skills 和组件库只出现在“设计上下文 - 设计系统”，选择后参与设计但不撑大稳定系统前缀。
8. 三台隔离客户端通过自托管服务器完成邀请、入会、任务接受、进度发布、接待员工调用和加密交付。
9. 移除成员后该成员不能解密后续会议事件或任务 generation。
10. 任何远程交付未经本地预览和显式应用都不能修改工作区。

## 15. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 扩展接缝继续扩散到核心文件 | 固定注册契约；新增能力只增加 contribution，不增加核心分支 |
| 测试再次污染用户配置 | 强制临时 dataDir、真实配置哨兵测试、禁止隐式用户目录 fallback |
| 专家规则破坏缓存稳定前缀 | 规则快照放动态上下文尾部，稳定系统前缀保持不变 |
| 专家团“取消”只改 UI 状态 | 以 turn abort 端到端测试作为发布门禁 |
| MoA 成本增加但无质量收益 | 未经 A/B 评测的预设标记未验证；设置预算、并发和延迟上限 |
| 多模态参考产生错误暗示 | 能力矩阵预检；不支持时显式派生或跳过 |
| Design 资源一次性注入导致上下文膨胀 | 仅注入选择项摘要，完整内容按需查询 |
| 协作服务器泄露正文 | MLS/TaskKey/点对点密文、明文 canary 扫描、服务端无解密依赖 |
| 远程提示注入扩大本地权限 | untrusted context、ReceptionSession 工具白名单、本地审批、高风险默认拒绝 |
| 协作历史分叉后继续写入 | 强制 `SECURITY_SYNC_REQUIRED` 只读状态 |
| 改造范围过大难以回滚 | Phase 独立门禁、独立 schema、独立 feature flag 和小批次合并 |

## 16. 最终不变量

1. Kun 桌面端只有一个活动 Agent Runtime。
2. 普通模式行为不因专家、MoA、Design 或 Collaboration 未配置而改变。
3. 扩展不能扩大用户选择的模型凭据、sandbox、approval 或工具权限。
4. 托管资源根由应用计算，持久化旧配置不能覆盖。
5. 专家和专家团激活队列各自最多 5 个，第 6 个剔除最早项。
6. 线程执行规则使用不可变快照，规则变更不回写历史线程。
7. 专家团中断必须停止真实 turn，并提供可审计恢复语义。
8. MoA 对调用方是普通模型，内部禁止递归和重复副作用工具调用。
9. Design 能力只融合到现有 Design Context，不形成第二套设计工作流。
10. Collaboration Server 永不运行模型或持有会议/任务解密密钥。
11. 本地 Kun 永不暴露到局域网或互联网。
12. 远程成员只能调用显式发布的接待数字员工，且执行始终发生在 owner device。
13. 协作产物必须端到端加密、本地预览并由用户显式应用。
14. 安全一致性无法验证时系统只读阻断，不静默降级。
