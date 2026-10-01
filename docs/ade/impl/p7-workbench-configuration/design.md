## Context

本计划把 ADE 能力融合进 Code 工作台。最新页面和迁移正本见 [Code 融合设计](../../14-code-workbench-integration.md)。本文、配置和任务清单按用户最新决策修订；实现状态单独记录。

- 核对日期：2026-09-30。
- 初始基线：`e0b93eaff`；融合修订核对基线：`1f7b48968`。
- 工作区：`develop`；先前 renderer 草稿与发送改动已进入后续提交，实施前仍须重新读取状态。
- 已有交互原型只说明布局与入口，不作为 API、默认值、权限或模型兼容性的证据。

### 阅读顺序

1. [实施总计划](implementation-plan.md)：批次、依赖、代码位置、退出标准。
2. [配置 UI](configuration-ui.md)：页面、字段、入口、错误与保存交互。
3. [契约](contracts.md)：设置归属、快照、版本、API 与迁移。
4. 本文：架构决策和风险。
5. [验收](acceptance.md) 与 [任务清单](tasks.md)。
6. [接入与图标专项](agent-connectivity.md)：用户截图新增的功能性 blocker，B01-B04 必须纳入执行顺序。

### 已核对的实现基线

下表中的“已有”指代码存在，不能替代本轮运行验证。路径均相对仓库根目录。

| 区域 | 已有实现 | 本轮处理 |
| --- | --- | --- |
| 独立模式 | `components/ade/AdeStage.tsx`、`workspaceMode` | 归并 Code 展示，旧字段保留兼容 |
| 草稿页 | 已有 `adeDraftOpen`、starter 与 selection | 泛化现有草稿控制器，不再维护模式专属草稿 |
| 发送快照 | `chat-store-ade-send-snapshot.ts`、`chat-store-send-composer-selection.ts` | 保留冻结语义，适用统一 Code 草稿 |
| 工作区 | TaskWorkspaceService、准备事件、Git 起点 picker | 扩展可见状态，不重写创建服务 |
| Agent 管理 | `AgentCenter`、`AgentCenterCard`、custom form、harness store | 迁入列表详情与向导 |
| 配置持久化 | `use-settings-persistence.ts`、SettingsStore、Main intent sequencer | 增加 ADE 显式事务边界，其他设置继续原行为 |
| 协作设置 | `settings-section-lab-ade.tsx` | 日常设置迁出实验室，内部开关不扩大曝光 |
| 项目声明 | `kun/src/config/project-config.ts`、Main project-config service | 保留 `.kun/project.json` digest 与批准链 |
| Workers | `WorkersPanel.tsx` 调用全局 `selectThread` | 增加原地预览和显式完整打开 |
| 控制权 | `kun/src/ade/team-controls.ts`、WorkerControlBanner | 复用接管、交还和排队协议 |
| 验收 | QualityVerdicts、checks、review comments | 增加成果版本有效性并统一显示 |
| 活动分组 | `src/shared/activity-display.ts` | 将已读与必须处理的验收事项分开 |
| 审查目标 | ReviewPanel 通过全局 `activeThreadId` 找 binding | 改为接受显式目标 |

### 与既有计划的关系

- 用户新要求和 `docs/ade/14-code-workbench-integration.md` 取代独立模式目标；00 只作为历史实现记录。
- P0-P4 中已有的 runtime、适配器、准备、派工、通知和审查不重新立项。
- P5 的 Agent 列表详情、来源分组、添加引导纳入 A05-A06；同一能力只保留一份实现和状态记录。
- P5 的在线协议研究、Registry 快照、Terminal Auth 尚未完成时，不阻塞内置 Agent 和手工 ACP 的可用流程；本轮不宣称这些能力存在。
- P6 的原生适配器作为复用基础；B01-B02 修复目录默认、元数据和实际接入缺口，UI 使用实测能力，不重新开发另一套 Codex/Pi 适配器。
- 本计划提出对旧 UI 文档的修订，实施到对应批次时同步更新，不能在实现前把旧功能标为已替换。

## Goals / Non-Goals

**Goals:**

- Code 有唯一工作台，配置复用现有助手/来源/工作区入口，常规用户无需先选择 Agent 组织形式。
- 用户知道一个字段的实际值、来源、修改作用域和生效时机。
- 新任务、准备工作区、观察 worker、处理请求、返工、验收与合入形成连续流程。
- 依赖现有 runtime 事实，支持断线、重启、迟到回执和并发编辑。
- 配置与工作台在明暗主题、中英文、窄屏和键盘操作下可用。

**Non-Goals:**

- 重写 Code、Work、Design 或其设置；恢复旧 runtime/provider 切换器。
- 新增 agent 引擎、托管下载平台、第三方登录凭据存储。
- 建立任意窗格布局引擎、远程 worker 执行平台、Graph 编辑器或新赛马系统。
- 在本轮新增按币种自动限额、精确费用预测或进程跨应用退出常驻。
- 将每项偏好都下放为项目/任务覆盖；只开放契约白名单。

## Decisions

### D1 Code 单页面和既有设置复用

建立带 Agent、作用域和返回上下文的设置 target，旧 `AdeSettingsTarget` 可作为兼容别名。输入框 Agent/模式菜单深链到助手设置的 Agent 接入；不新增独立 ADE 设置类别。

Agent 接入和协作默认复用现有助手页签体系，Providers 和 Worktrees 各保留唯一正本。旧 `agentsHarnesses` 深链可继续解析；高级协作开关不再决定旧会话可见性。

全局连接长表单仍放已有设置页面，当前任务用右侧抽屉；日常 Code 主界面不增加一套配置导航。

### D2 显式草稿保存不接管整个 Settings 自动保存机制

ADE 表单拥有局部草稿，点击保存时才生成字段级 patch。输入命令路径不触发每字一次的检测或 runtime 更新。打开其他配置对象时保留该对象草稿。

提交仍经过既有可信 preload/Main、保护设置校验、SettingsStore 和 Service Manager 写入通道。新增带版本的 ADE 保存外壳只能调用这些通道，不能直写配置文件。

Main 的应用 generation 与配置对象 revision 含义不同：前者抵御迟到应用结果，后者抵御并发编辑。二者不能混用。具体事务见 contracts。

### D3 普通偏好按白名单继承，执行配置按快照冻结

新任务建立时解析系统默认、Agent 默认、项目本机覆盖和用户选择，保存 resolved snapshot 与来源。已建立任务不会在下次打开时重新跟随全局默认。

任务页的“恢复项目默认”是一次明确更新：重新解析当前项目值，在宿主认可的下一生效边界建立新快照。下一轮临时覆盖只进入该次发送及对应队列项，消费后不改任务默认。

权限通过已有授权边界取交集；继承不会扩大权限。程序路径、启动参数、密钥及全局停用不允许被项目文本覆盖。

### D4 项目本机偏好与仓库声明分开保存

项目选择用宿主规范化身份；显示名称不是 key。Git worktree 归回来源仓库身份，普通目录以 canonical root 建立身份。

模型偏好、Agent 选择、起点偏好等本机覆盖放入 `agents.kun.ade` 下的新增项目映射。仓库准备和检查命令继续由 `.kun/project.json` 管理。项目页明确分“本机默认值”和“仓库环境配置”。保存本机值不得写仓库文件；编辑仓库配置保留 digest、差异和既有批准行为。

### D5 选择 Agent 和选择模型来源分别表达

Agent 选择描述执行引擎；模型菜单按可用来源分组，选择后形成完整 route。状态展示来源和实际模型，避免 native-login 与 gateway 悄悄互换。

同一个 Agent 的历史、配置、终端菜单、模型列表引用稳定 ID。已添加列表的可见性不控制准入；停用才影响新执行。旧配置迁移不能仅因列表整理使此前可用的 Agent 消失。

### D6 主任务、预览对象和审查目标相互独立

视图层维护 `taskThreadId`、`inspectedWorkerId`、`reviewTarget`。worker 预览不会调用全局 `selectThread`。完整打开进入 worker 的主会话时，记录父任务及其面板、滚动锚点。

先增加只读预览，随后抽取按 threadId 寻址的会话控制器支持嵌入式输入。不能直接复制 ChatStore，也不能把两个 composer 指向同一份 `input/blocks/queuedMessages`。

### D7 控制权和操作生效由宿主确认

查看不接管；“接管并发送”明确表达控制权动作。接管不会自动停止已经在执行的一轮；不支持 steer 时提供排队或单独停止。

停止、接管、交还分别有 pending、成功和失败状态。用户连续点击、从两个窗口操作或通过手机处理同一请求，宿主都要返回同一权威结果或明确的过期冲突。

### D8 状态分组使用联合投影

保留 ActivityStore 对执行状态的唯一权威。由活动、待处理请求、dispatch verdict、workspace state 和用户阅读事实生成共同的展示投影；不能反向修改活动事实以匹配卡片列。

已读仅影响通知。未验收成果和未处理请求不随 30 分钟衰减消失。父任务允许“进行中 · 1 项待回答”这种聚合，避免一条子状态强行替换整个任务语义。

### D9 审查证据绑定成果版本

`ReviewRevision` 同时包含 base、head 和工作区内容指纹，覆盖 staged、unstaged、untracked、删除、重命名、二进制文件。哈希在宿主执行，设置大小/时间预算，不通过 renderer 读整个仓库。

指纹不完整时标为不可验证，不能宣称当前验收仍有效。外部进程继续写文件时审查可保持只读浏览，接受/合入前重新核验稳定版本。新版本使旧 verdict 的“当前有效性”失效，但保留审计记录和用户历史裁决。

现有 `QualityVerdict.status` 不必增加 `stale`：有效性单独存储/投影，避免把质量结论与证据版本混为一谈。

### D10 交付动作基于能力与真实预检

一个入口“改动与审查”可切换 worker 工作区或已有集成结果。任务汇总是导航和统计，不是未经构造的合并工作区。

主动作随所选目标与状态变化。已有 PR 优先显示查看 PR；存在返工意见时优先发送批注；准备合入时展示目标分支和目录。任何“通过/豁免”都不自动授权合入。

用户显式点击合入与总管请求合入复用现有用户授权机制，不叠加重复确认。合入前重检源/目标版本并保持源目录未提交内容不变。

### D11 保持轻量和按需订阅

侧栏/总览只订阅摘要；选中 worker 才加载 transcript；隐藏重型面板停止消息增量渲染，保留状态、草稿和游标。team overview 请求去重并按团队缓存，关闭界面后清理 watcher。

不为每个不可见任务轮询 Git diff 或加载整段历史。归档、长历史和更多 dispatch 使用分页/按需读取，不把当前 overview 的最近 50 条误当全部历史。

### D12 接入事实先于可选状态，品牌身份统一

用户补充截图确认接入不可用是本轮缺陷范围。默认 Codex 目录仍是 ACP，即使已有 app-server variant；B01 在真实准入验证后修正默认路径及全部 variant 元数据，不通过隐藏提示或放宽检查处理。

发现、模型探测、握手和真实 turn 共用受管 invocation resolver。状态按 Agent、来源和连接指纹区分；401/404 或某个来源失败不能污染整个 Agent。待验证假设见专项文档，不能把 OpenCode 故障直接归咎上游。

AgentIcon 使用稳定 harness ID 和本地资源，模型来源保留独立 ProviderIcon。新代码不复制参考项目命名或在线 favicon 依赖；未知图标采用中性回退。

### D13 页面、协作授权与工作区归属分开

统一 Code 列表包含旧 Code 和 ADE 线程，原 `workspaceMode` 暂不重写。新 `collaboration.enabled` 快照控制持久团队工具，和实际 harness、执行表面及权限共同准入；工具广告与执行使用同一判断。

复用 Code 模型菜单、加号菜单、协作摘要和改动面板。普通任务不出现空团队或四列看板；旧能力开关关闭不隐藏历史、不阻断必要的在途控制。

Code Direct 计划、Graph 与宿主任务工作区各保留明确 owner；同一执行单元只能采用一份 workspace intent，不因两个原 UI 合并创建双重 worktree。

### D14 审批视觉与宿主授权分开

Code 工具审批和执行权限变更使用 Kun 自有弹窗，复用现有 Rooms 的独立受控 BrowserWindow。
窗口采用与工作台相同的明暗中性色和中英文文案，展示操作目标、作用目录、单次范围与可展开参数。
不把授权控件放入可被扩展 DOM 访问的主工作台，也不让 Renderer 传入待批准动作的正文。

宿主使用同一 Runtime lease 读取审批并在最终确认时重验状态和内容。窗口拥有独立临时 session、
最小 preload、nonce 与主 frame 校验；父/子页面失效、崩溃、关闭或超时均不能提交授权。
HMAC token 继续只在 Main 创建；取消保留待处理，明确允许/拒绝才提交对应决定。

## Risks / Trade-offs

- 全局 ChatStore 与嵌入会话耦合 → A11 先验证只读范围，A12 再开放写入；失败时仍可完整打开。
- 代码基线在其他任务持续变化 → A01 重新核对已提交与未提交状态；增量接续，禁止覆盖用户修改。
- 显式保存混入旧自动保存 → ADE 草稿不能进入 `scheduleSave`，离页不能由旧 unmount flush 意外提交。
- scope/revision 增加复杂度 → 每个字段有唯一 owner，按对象提交，禁止 whole-settings 覆盖。
- 旧线程来源不明 → 显示历史配置，首次明确修改时迁移，不全库回填。
- 外部 Agent 能力不一致 → 依据 capability 隐藏/解释不可用动作，终端 Agent 不伪装成结构化 worker。
- 工作区持续变化使 hash 不稳定 → 展示不可验证状态，保留旧审查，不把缺证据视为通过。
- UI 重构带来重复入口 → 旧入口只重定向，组件、草稿和保存协议共用。
- 细化后的任务量超过早期估算 → 以批次退出标准推进，整体工期见实施计划的估算假设。

## Migration Plan

1. 上线兼容读取、字段规范化与能力协商；旧客户端缺少新字段仍按原协议工作。
2. 先上线联合查询与新准入契约，再归并 Code UI；高级协作开关控制新派工，不控制历史可见性。
3. 原值保留，读取时计算列表/有效值；只有用户保存新覆盖或开始新任务时才写新记录。
4. 将旧 ADE route 变成 Code alias，统一列表和草稿；分批接入 Agent 设置、worker 预览和改动增强。
5. 旧深链解析至少保留一个迁移周期；回退新 UI 不能删除或重建历史、worktree、凭据。
6. 回滚首选同版本关闭新 UI；回滚旧二进制前必须测试旧规范化器是否会丢弃新字段，并保留可恢复的原配置备份。
7. 完成 U04 的历史、准入、工作区和低负担验收；默认是否允许持久协作仍保持原有授权，不通过页面融合自动放宽。

## Open Questions

没有需要用户再次选择才能开始的产品问题。下列工程验证是任务，不是无限期的待决定项：

- A01 确认最新草稿/发送代码的接入点与现有失败基线。
- A03 确认 SettingsStore/Manager 可复用的条件更新入口；不存在时增加薄封装，仍经过原写入者。
- A06 核对每种 Agent 的真实认证能力，只启用已测试分支。
- A11 量测独立线程读取控制器的最小抽取面；不能用第二套全局 store 规避。
- A14 给指纹、文件数量和超时确定实测预算；先正确标记 incomplete，再优化性能。
