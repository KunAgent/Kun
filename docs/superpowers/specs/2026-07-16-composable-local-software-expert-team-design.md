# Kun 组合式本地软件专家团设计

- 状态：待书面评审
- 日期：2026-07-16
- 目标项目：`D:\soft\Kun`
- 设计范围：专家团内容包、Capability Fabric、软件适配器、跨平台桌面驱动、授权与审计
- 来源工作流：《多 Agent 对证循环协作架构：Hermes + Claude Code + Codex 三角色工作流实战》

## 1. 摘要

本方案把已经沉淀的 `orchestrating-kun-evidence-loops` Skill 迁移为 Kun 中一个可实际运行的专家团，并把原工作流中的 Hermes 替换为 Kun。Kun 负责规划、状态裁决、证据验证和归档；Claude Code 负责实现或修复；Codex CLI 负责对固定候选 SHA 进行独立审查。

这不是三个内部提示词角色的模拟。Claude Code、Codex CLI 以及未来接入的本机软件必须通过独立软件适配器真实调用。专家团只声明角色、流程和 capability ID，不携带任意脚本、二进制或具体可执行文件路径。

总体架构采用 **Capability Fabric + 可插拔驱动宿主**：

- 专家团内容插件定义“由谁、按什么流程、需要什么能力”；
- Kun 协作编排器定义“当前处于什么状态、下一步是否允许流转”；
- Capability Fabric 定义“如何选择、授权、调用和审计能力”；
- 软件适配器定义“由哪个本机软件、通过什么传输方式执行”；
- 平台 Sidecar 只承载必须依赖原生桌面权限的驱动，不承担总编排职责。

该能力通过 `kun/src/seam/` Extension Seam 一次接入。以后新增专家团只增加内容目录，新增软件支持只安装适配器包，不继续修改 Kun 上游运行时文件。

## 2. 背景与现状

### 2.1 已有资产

项目已经存在以下资产：

- `.agents/skills/orchestrating-kun-evidence-loops/SKILL.md`；
- `.agents/skills/orchestrating-kun-evidence-loops/references/protocol.md`；
- `experts/plugins/<plugin-id>/` 专家和专家团内容目录；
- `kun/src/experts/` 专家解析、profile 映射和服务；
- `kun/src/seam/` Extension Seam；
- `kun/src/moa/`、`kun/src/automation/` 等正在迁移的扩展模块。

现有专家团 manifest 使用 `.codebuddy-plugin/plugin.json`，其中 `expertType: "team"`、`teamInfo.leadAgent` 和 `teamInfo.memberAgents` 描述成员。当前 `expert-profile-mapper.ts` 只把成员映射为 Kun 内部 primary/subagent profile，不会启动 Claude Code 或 Codex CLI。因此，单纯新增三个 agent markdown 不能满足“真实调用本机软件”的目标。

### 2.2 必须保留的 Kun 边界

- Kun 仍是产品中唯一 live Agent runtime。
- 不恢复 AgentSwitcher、第二 AgentLoop、旧 provider 或 RPC bridge。
- Renderer 不直接启动 CLI、Sidecar 或 Computer Use。
- GUI 只展示和提交状态、授权与审批，不裁决协作状态。
- 新功能通过 Extension Seam 注册，不向运行时主路径持续增加集成点。
- 当前工作区中的 experts、seam、MoA 和 automation 改动属于正在开发的项目资产，实现时必须增量接入，不能覆盖或重构这些改动。

## 3. 目标与非目标

### 3.1 目标

1. 新增“Kun 多 Agent 对证专家团”，真实调用 Claude Code 和 Codex CLI。
2. 把对证循环变为确定性、可恢复、可审计的产品工作流。
3. 允许未来创建其他专家团，并复用同一批本地软件能力。
4. 同时定义 Windows、macOS、Linux 能力契约和驱动策略。
5. 支持 API、MCP、CLI、CDP、可访问性接口和 Computer Use 等组合式驱动。
6. 在专家团启动时提供多级授权选择，并对高风险动作保留即时确认。
7. 将新增专家团和新增软件适配器的日常扩展控制在自有目录内，降低上游合并冲突。

### 3.2 非目标

- 不把任意 shell 脚本包装成专家团能力。
- 不允许专家团内容包自行提升权限或选择可执行文件路径。
- 不承诺用一套 GUI 自动化库覆盖三个操作系统。
- 不把 Computer Use 作为所有软件的默认驱动。
- 不在首个实现里一次性交付所有平台和所有软件适配器。
- 不自动 push、merge、发布、付款、安装软件或修改权限。

## 4. 架构决策

### 4.1 已比较方案

| 方案 | 优点 | 主要问题 | 结论 |
| --- | --- | --- | --- |
| Capability Fabric + 可插拔驱动宿主 | 内容、编排、能力和平台实现完全解耦；可组合；便于测试和降级 | 需要定义稳定契约和适配器认证套件 | 采用 |
| MCP 统一总线 | 协议统一，已有生态可复用 | 桌面观察、窗口身份、审批和部分副作用恢复难以全部映射到 MCP | MCP 作为一种适配器传输 |
| 全平台 Sidecar Broker | 原生控制能力强 | 容易形成集中式巨型模块，第三方扩展和独立升级成本高 | Sidecar 只作为平台驱动宿主 |

### 4.2 总体结构

```text
专家团内容插件
  -> Kun 协作编排器
    -> Capability Fabric
      -> 软件适配器插件
        -> API / MCP / CLI / HTTP
        -> CDP / Playwright
        -> Windows UIA / macOS AX / Linux AT-SPI
        -> Computer Use
        -> 图像匹配与坐标输入（最后兜底）
```

### 4.3 模块职责

#### 专家团内容插件

负责角色、工作流、交付物和 capability 声明。它可以表达“实现者需要 `coding.workspace.implement`”，但不能表达“执行 `C:\...\claude.exe --flag`”。

#### Kun 协作编排器

负责创建 run/workspace、状态转换、角色派发、证据门禁、失败修复循环、预算控制和归档。编排器不直接操作窗口或子进程。

#### Capability Fabric

负责适配器发现、能力匹配、运行时授权、驱动选择、软件会话、幂等、风险分类、动作审批、执行轨迹和恢复对账。

#### 软件适配器插件

负责将标准 Observation/Action 契约转换为具体软件调用。Claude Code CLI、Codex CLI、MCP 服务、浏览器、Office 或桌面软件各有独立适配器。

#### 平台 Sidecar

负责必须在原生权限上下文中完成的窗口发现、控件树、截图和输入。Sidecar 不读取专家团工作流，不决定下一个角色。

#### Kun GUI

负责专家团选择、授权等级、授权摘要、进度、风险动作确认、暂停/接管/撤销和审计回放。

## 5. 目录与所有权

目标目录如下：

```text
experts/plugins/kun-evidence-council/
├─ .codebuddy-plugin/plugin.json
├─ agents/
│  ├─ kun-coordinator.md
│  ├─ claude-implementer.md
│  └─ codex-reviewer.md
├─ workflow/
│  └─ workflow.json
└─ skills/
   └─ orchestrating-kun-evidence-loops/
      ├─ SKILL.md
      └─ references/protocol.md

kun/src/local-capabilities/
├─ contracts/
├─ registry/
├─ policy/
├─ sessions/
├─ traces/
├─ recovery/
├─ adapters/
└─ routes/

kun/src/seam/features/
└─ local-capabilities.feature.ts

local-software-adapters/
├─ claude-code/
├─ codex-cli/
├─ computer-use-mcp/
└─ platform-desktop/

src/main/seam/features/
src/shared/seam/features/
src/renderer/src/seam/features/
```

`experts/plugins/kun-evidence-council/skills/` 是协议内容的产品内规范来源。项目级 `.agents/skills/orchestrating-kun-evidence-loops/` 保留为 Codex/开发场景的薄入口，引用同一协议来源，不再维护第二份会漂移的状态机定义。

`local-software-adapters/` 保存随产品发布的受信适配器。用户或第三方安装的适配器放在 Kun data dir 下的独立 adapter root，不写入业务仓库。

## 6. 双插件契约

### 6.1 专家团内容包

现有 `.codebuddy-plugin/plugin.json` 使用严格 Schema。为避免破坏现有 300 多个插件的兼容性，不向该文件直接加入工作流字段，而是在插件内增加 `workflow/workflow.json`。

示例：

```json
{
  "schemaVersion": 1,
  "id": "kun-evidence-loop",
  "teamId": "kun-evidence-council",
  "roles": {
    "coordinator": {
      "agentName": "kun-coordinator",
      "executionMode": "kun-internal",
      "capabilities": ["workflow.evidence.arbitrate"]
    },
    "implementer": {
      "agentName": "claude-implementer",
      "executionMode": "external-capability",
      "capabilities": ["coding.workspace.implement"],
      "softwareSelector": { "kind": "claude-code" },
      "substitution": "require-user-approval"
    },
    "reviewer": {
      "agentName": "codex-reviewer",
      "executionMode": "external-capability",
      "capabilities": ["coding.diff.review"],
      "softwareSelector": { "kind": "codex-cli" },
      "substitution": "require-user-approval"
    }
  },
  "steps": [
    "prepare",
    "implement",
    "verify-evidence",
    "review",
    "reconcile",
    "archive"
  ],
  "minimumGrant": "observe-only",
  "recommendedGrant": "workflow"
}
```

`softwareSelector.kind` 是软件种类约束，不是适配器 ID 或可执行文件路径。多个适配器可以声明支持同一种软件，Capability Fabric 根据平台、版本、健康状态、授权和可靠度选择实现。

### 6.2 软件适配器包

适配器包具有独立 `adapter.json`：

```json
{
  "contractVersion": 1,
  "id": "builtin.codex-cli",
  "version": "1.0.0",
  "software": { "kind": "codex-cli", "minVersion": "0.1.0" },
  "platforms": ["windows-x64", "macos-arm64", "macos-x64", "linux-x64"],
  "transport": "jsonrpc-stdio",
  "capabilities": [
    {
      "id": "coding.diff.review",
      "actions": ["open-session", "submit-task", "poll", "cancel", "close"],
      "supportsIdempotency": true,
      "supportsResume": true
    }
  ],
  "permissions": ["process.spawn", "workspace.read"],
  "entrypoint": "dist/host.js",
  "integrity": { "algorithm": "sha256", "digestFile": "adapter.sha256" },
  "signature": {
    "scheme": "ed25519",
    "keyId": "kun-builtin-v1",
    "signatureFile": "adapter.sig"
  }
}
```

摘要和签名文件由打包流程生成。安装器先验证包内容摘要，再用受信 keyring 验证签名；manifest、入口文件或任一受保护资源变化都会使安装失败。

### 6.3 稳定运行时接口

```typescript
interface AdapterRegistry {
  discover(roots: string[]): Promise<AdapterDescriptor[]>
  resolve(request: CapabilityRequest, grant: WorkflowGrant): Promise<AdapterSelection>
  health(adapterId: string): Promise<AdapterHealth>
}

interface SoftwareAdapter {
  descriptor: AdapterDescriptor
  openSession(request: OpenSessionRequest): Promise<SoftwareSession>
}

interface SoftwareSession {
  observe(request: ObserveRequest): Promise<Observation>
  act(action: Action): Promise<ActionReceipt>
  reconcile(request: ReconcileRequest): Promise<ReconcileResult>
  cancel(reason: string): Promise<void>
  close(): Promise<void>
}
```

关键数据类型包括：

- `LocalCapabilityManifest`：适配器提供的能力、平台和限制；
- `CapabilityRequest`：专家团角色请求的抽象能力；
- `WorkflowGrant`：本次运行的授权边界；
- `Observation`：结构化状态、文本、截图、控件树或进程输出；
- `Action`：带幂等键、前置状态、目标和风险标签的动作；
- `ActionReceipt`：结果、副作用、证据和后置状态；
- `ExecutionTrace`：只追加的授权、观察、动作、审批和恢复记录。

所有公开契约携带整数 `contractVersion`。同一主版本内只允许向后兼容的可选字段扩展；破坏性变化通过新主版本和显式协商处理。

AdapterRegistry 只在 Kun 进程内解析和校验 manifest，不动态导入第三方适配器代码。适配器实现运行在独立宿主进程，通过带长度边界、消息大小限制、超时和会话身份校验的 JSON-RPC、MCP 或 HTTP 传输通信。即使是内置适配器，也使用相同宿主契约，避免形成只有内置实现才能依赖的隐式接口。

## 7. 适配器选择与跨平台驱动

### 7.1 选择顺序

```text
目标软件原生 API / MCP
  -> CLI / stdio / HTTP
  -> CDP / Playwright
  -> 系统可访问性驱动
  -> Computer Use
  -> 图像匹配与坐标输入
```

选择器依次检查：

1. capability 和 contractVersion 是否匹配；
2. 当前平台、架构和目标软件版本是否支持；
3. 适配器包是否可信且健康；
4. 当前 WorkflowGrant 是否覆盖所需资源和副作用；
5. 驱动是否能提供必要观察和幂等保证；
6. 可靠度、可恢复性和历史失败率；
7. 用户是否允许软件替代或驱动降级。

### 7.2 平台策略

| 平台 | 主桌面驱动 | 辅助机制 |
| --- | --- | --- |
| Windows | UI Automation，优先 AutomationId | pywinauto/FlaUI、SendInput、Windows Graphics Capture |
| macOS | Accessibility/AX | Apple Events、Appium Mac2、系统屏幕捕获 |
| Linux | AT-SPI2 | X11；Wayland 下使用 Portal/libei 等受控接口 |

Electron/WebView 软件优先通过 CDP 或 Playwright 操作。只有目标能力未通过 DOM/CDP 暴露时，才降级到原生桌面驱动。

### 7.3 观察、动作和验证

每个有副作用的动作执行：

```text
observe
  -> validate precondition
  -> act
  -> verify postcondition
  -> issue ActionReceipt
```

约束如下：

- 使用规范化 `appHandle`、`windowHandle` 和 `sessionId`；
- 不把窗口标题或屏幕坐标作为持久身份；
- 使用条件等待和超时，不使用固定长时间休眠；
- 坐标动作要求窗口身份、尺寸、缩放和截图摘要全部匹配；
- 用户接管鼠标键盘时暂停，重新观察后才能恢复；
- Computer Use MCP 必须经过同一授权、风险和审计管线；
- 目标软件屏幕、网页和文档内容一律视为不可信数据。

### 7.4 降级限制

只有尚未产生副作用时才能自动尝试下一候选驱动。动作超时、返回未知或已经产生部分副作用时，软件会话进入 reconciliation。系统必须先查询回执并观察目标状态，不能换驱动重复执行同一动作。

## 8. 运行时授权模型

### 8.1 授权等级

运行专家团时必须让用户选择授权等级：

| 等级 | 自动允许 | 仍需确认 |
| --- | --- | --- |
| 只读观察 `observe-only` | R0 读取、截图、检查状态和生成方案 | 所有写入与软件动作 |
| 逐步确认 `step-by-step` | R0 | 每个 R1、R2、R3 动作 |
| 工作流整体授权 `workflow` | R0、R1 和启动前列明的 R2 | 所有 R3 和授权范围变化 |
| 自定义授权 `custom` | 用户逐项勾选的软件、能力、资源和副作用 | 未勾选动作与所有 R3 |

专家团只能声明最低等级和建议等级。最终授权等级必须由用户在启动时选择，默认推荐 `workflow`，但不得预选最高权限。

### 8.2 风险分类

| 风险 | 示例 | 规则 |
| --- | --- | --- |
| R0 观察 | 控件树、日志、Git diff、只读查询 | 可由相应授权等级覆盖 |
| R1 本地可逆 | 编辑授权工作区、运行测试、创建临时文件 | `workflow` 可覆盖 |
| R2 有限副作用 | 启动软件、已声明 CLI、本地提交 | 必须在授权摘要明确列出 |
| R3 高风险 | 删除、付款、发送/发布、push/merge、权限变更、安装软件、凭据操作、敏感数据外传 | 动作发生时再次确认 |

### 8.3 WorkflowGrant

`WorkflowGrant` 至少绑定：

- run ID、用户和创建时间；
- 专家团 ID 与版本；
- 适配器 ID、版本和包摘要；
- 软件、capability 和动作集合；
- 允许的目录、仓库、窗口、站点和服务；
- 可读取、写入和传输的数据类别；
- 允许的副作用类型；
- 有效期、最大动作数、费用和时间预算；
- 风险策略版本和授权摘要哈希。

执行中允许降级、暂停和撤销。升级必须重新确认。记住授权时必须同时绑定专家团版本、适配器摘要、能力集合和资源范围，任一变化都使旧授权失效。R3 不得被“记住选择”覆盖。

## 9. Kun 多 Agent 对证专家团

### 9.1 角色

| 角色 | 职责 | 执行方式 |
| --- | --- | --- |
| Kun 协调者 | 拆分工作间、裁决状态、核验证据、路由和归档 | Kun 内部确定性服务 |
| Claude 实现者 | 按验收标准实现/修复并返回候选证据 | Claude Code 软件适配器 |
| Codex 审查者 | 对固定候选 SHA 独立审查并返回 PASS/FAIL | Codex CLI 软件适配器 |

Kun 不代替实现者编写业务代码，也不代替审查者给出 PASS。Codex 默认不修改候选实现。Claude Code 的自审不能通过审查门禁。

### 9.2 规范状态

```text
created -> implementing -> waiting-review -> reviewing
reviewing -> waiting-fix -> implementing
reviewing -> completed -> archived
任意非终态 -> blocked | failed | cancelled
```

reconciliation 是软件会话的恢复阶段，不增加新的顶层协作状态同义词。对账不能确定结果时，顶层工作流进入 `blocked` 或 `failed`，并保存恢复条件。

### 9.3 流转门禁

1. Kun 固定 `base_sha`、工作目录、允许路径、验收标准和验证命令。
2. 只有 `created` 或 `waiting-fix` 可以派发实现者。
3. Claude Code 返回候选 SHA、变更文件、测试结果和结构化回执。
4. Kun 验证提交存在、基线正确、文件未越界、工作树可解释且必跑测试有证据。
5. 只有证据有效时进入 `waiting-review`。
6. Codex 只接收任务契约、验收标准、`base_sha..candidate_sha` 和仓库规则，不接收实现者自我评价。
7. 任一阻断 finding 都是 FAIL，进入 `waiting-fix`。
8. candidate SHA 变化后，旧审查结论立即失效。
9. 只有 `reviewed_sha == candidate_sha` 且全部门禁通过，才能进入 `completed`。
10. Kun 生成归档清单和内容哈希后进入 `archived`。

循环次数不固定。达到用户选择的时间、费用或迭代预算时暂停并请求决策。只有依赖和文件范围不重叠的工作间可以并行；同一工作间的实现和审查必须串行。

首选 Claude Code 或 Codex 软件不可用时进入 `blocked`。替换为声明同一 capability 的其他软件必须取得用户明确批准，并在审计中标记角色替代，不能伪称原软件已经运行。

## 10. 数据流与运行时 API

### 10.1 数据流

```text
Kun GUI
  -> preload / Electron main 受约束桥接
    -> kun serve HTTP API
      -> 专家团协作编排器
        -> Capability Fabric
          -> 独立适配器宿主
            -> 本机软件或平台 Sidecar
```

进度、审批请求、动作回执和状态转换通过现有 SSE 方向回到 GUI。Renderer 不持有权威状态，也不直接连接适配器宿主。

### 10.2 建议 API

所有路由通过 Extension Seam 的自定义 Router 注册：

```text
GET  /v1/local-capabilities
GET  /v1/local-capabilities/adapters
POST /v1/expert-workflows/grants/preview
POST /v1/expert-workflows/runs
GET  /v1/expert-workflows/runs/:runId
POST /v1/expert-workflows/runs/:runId/pause
POST /v1/expert-workflows/runs/:runId/resume
POST /v1/expert-workflows/runs/:runId/cancel
POST /v1/expert-workflows/runs/:runId/approvals/:approvalId
GET  /v1/expert-workflows/runs/:runId/trace
```

创建 run 采用两阶段流程：先 preview grant，再由用户提交选定等级和签名后的授权摘要。服务端重新计算摘要并拒绝客户端扩大范围。

### 10.3 持久化

- 协作状态复用 Kun collaboration store，并使用 revision/CAS 防止并发覆盖；
- grant、dispatch、session、action 和 receipt 使用稳定 ID 与幂等键；
- 大型证据按内容哈希存储，状态只保存引用、类型和摘要；
- 运行数据写入 Kun data dir，不写入目标业务仓库；
- 事件日志只追加；快照只是加速读取，不能覆盖历史真源；
- 密钥、令牌、剪贴板和敏感输入不进入持久日志；
- 截图遵守敏感区域遮盖、访问控制和保留期限。

## 11. 故障恢复

| 故障 | 处理 |
| --- | --- |
| 适配器不可用 | 未产生副作用时选择下一候选；否则 `blocked` |
| 超时或结果未知 | 按幂等键查回执，观察软件和 Git 状态，完成前不重放 |
| 适配器崩溃 | 隔离终止宿主；支持恢复则重连，否则保存 checkpoint |
| 窗口或控件漂移 | 暂停，重新发现规范窗口和控件，禁止使用过期坐标 |
| 外部输出无法解析 | 先核对进程、文件和提交，再决定格式修复或阻塞 |
| candidate SHA 漂移 | 当前审查作废，固定新候选后重新审查 |
| 授权撤销 | 停止新动作，取消可取消操作，保留对账和清理能力 |
| Kun 重启 | 从快照和事件恢复；窗口句柄重新发现，不直接复用 |
| 用户接管 | 暂停输入，重新 observe 并确认状态后恢复 |

所有自动重试受次数、时间和费用预算限制。重试必须复用幂等语义，不能通过生成新动作 ID 绕开重复检测。

## 12. 安全与隔离

### 12.1 内容包与执行包隔离

- 专家团内容包不得包含程序、二进制、命令模板或安装器；
- 适配器包必须校验来源、版本、摘要和签名；
- 开发模式加载未签名适配器时必须显示持续警告并记录审计；
- 可执行文件使用规范化绝对路径和摘要绑定，禁止依赖可劫持的 `PATH` 搜索；
- Sidecar 和适配器宿主以满足功能的最小权限运行；
- 单个适配器崩溃、超时或越界不得拖垮 Kun runtime。

### 12.2 数据与提示注入防护

- 软件屏幕、网页、文档和终端输出是数据，不是授权指令；
- 外部内容不能修改 grant、风险等级、allowlist 或目标软件；
- 敏感数据传输必须有明确目标和 R3 确认；
- 日志默认遮盖凭据、令牌、个人数据和敏感输入；
- 审批必须绑定精确动作、目标、数据摘要和过期时间；
- 用户确认界面显示实际目标与副作用，不只显示模型生成的解释。

### 12.3 审计

ExecutionTrace 至少记录：

- 授权等级、范围、版本和摘要；
- 适配器发现、选择、拒绝和降级原因；
- observation 摘要及证据引用；
- action、风险分类、幂等键和前置状态；
- receipt、副作用和后置状态；
- 用户审批、暂停、接管和撤销；
- 异常、重试、对账和恢复；
- candidate/reviewed SHA、最终状态和归档哈希。

## 13. Extension Seam 与上游合并策略

### 13.1 一次性接入

新增 `local-capabilities.feature.ts`，通过现有 Seam 注册 routes 和 services。专家协作模块只通过稳定服务接口请求 capability，不直接导入具体适配器。

Capability Fabric 接入后：

- 新专家团由 `experts/plugins/` 扫描发现；
- 新工作流由插件内 `workflow/workflow.json` 扫描发现；
- 新适配器由内置 root 和 Kun data dir adapter root 扫描发现；
- 新平台 helper 由相应适配器包选择，不进入专家团内容；
- GUI 扩展只通过 renderer/main/shared Seam 聚合点接入。

### 13.2 冲突控制

- 不修改 `kun/src/extensions/` MCP ExtensionManager 的既有职责；
- 不继续向 `runtime-factory.ts`、主 routes、AgentLoop 或 provider 文件增加新软件分支；
- 不在专家团 manifest 中硬编码适配器导入；
- 不复制上游文件到自有目录长期维护 patch；
- 对 Seam 的依赖通过契约测试固定，而不是依赖上游文件内部实现；
- 上游合并后先运行 Seam smoke test 和 adapter contract test，再处理真实冲突。

现有 `kun/src/seam/features/index.ts` 仍是自有聚合点。本功能只增加一次 feature 注册；后续专家团和适配器扩展不再修改该列表。

## 14. 测试与验收

### 14.1 契约测试

- expert workflow manifest 解析和旧插件兼容；
- adapter manifest、版本协商和平台匹配；
- capability 选择、健康检查和降级限制；
- Observation、Action、Receipt 和 Trace 序列化；
- 未知字段、破坏性版本和伪造摘要拒绝。

### 14.2 编排与安全测试

- 对证状态机所有合法和非法转换；
- revision/CAS、重复派发和候选 SHA 漂移；
- PASS/FAIL、FAIL/FIX 循环和归档门禁；
- 四种授权等级、升级、降级、过期和撤销；
- R3 永远动作时确认；
- 路径穿越、可执行文件劫持、伪造 manifest 和提示注入；
- 敏感日志与截图遮盖。

### 14.3 适配器认证套件

所有适配器必须通过同一套认证用例：

- discovery、health、open/close session；
- observe-act-verify；
- cancel、timeout 和 crash；
- 幂等重投与 reconciliation；
- 用户接管和目标窗口漂移；
- 部分副作用后禁止自动降级；
- 权限不足和软件版本不兼容。

### 14.4 集成与 E2E

- Fake CLI、Fake MCP、Fake Sidecar 的确定性集成测试；
- Claude Code CLI 与 Codex CLI 的本机可选 smoke test；
- Windows UIA、macOS AX、Linux AT-SPI 平台测试；
- Electron 授权页、审批、暂停、撤销、进度和审计回放 E2E；
- Kun 重启后的状态恢复和窗口重新发现；
- `npm run typecheck`、相关 Vitest、`npm run build:kun` 和跨层变更所需构建。

真实 Claude Code/Codex smoke test 不在无凭据 CI 中伪造通过；不可用时应明确标记为 skipped，并由 Fake Adapter 契约测试提供确定性覆盖。

## 15. 分阶段交付

本设计是完整目标架构，实现必须拆成独立里程碑：

### 里程碑 1：Capability Fabric 基础

- 核心契约、registry、grant、risk policy 和 trace；
- Fake Adapter 与契约测试；
- Extension Seam 服务和路由注册。

### 里程碑 2：对证专家团

- 迁移 Skill 到专家团内容包；
- workflow resolver；
- Claude Code CLI 与 Codex CLI 适配器；
- 对证状态机、证据门禁和本机 smoke test。

### 里程碑 3：GUI 授权与审计

- 四级授权选择；
- 授权摘要、R3 动作确认；
- 进度、暂停、撤销和审计回放。

### 里程碑 4：Windows 桌面驱动

- UIA、规范窗口句柄和控件定位；
- Windows Graphics Capture；
- SendInput 兜底与 Windows E2E 认证。

### 里程碑 5：macOS 与 Linux 桌面驱动

- macOS AX 与必要的 Apple Events；
- Linux AT-SPI2、X11 和 Wayland 受控接口；
- 与 Windows 相同的适配器认证套件。

### 里程碑 6：生态扩展

- Computer Use MCP 适配器；
- 适配器 SDK、模板和第三方签名流程；
- 至少一个非编码软件专家团示例，验证 capability 可复用性。

每个里程碑独立启用、验收和回滚。后续实现计划应先覆盖里程碑 1，不把三个操作系统的原生驱动放在同一个实现批次中。

## 16. 成功标准

满足以下条件时，本能力视为达到目标：

1. Kun 能从专家广场启动对证专家团，并在运行前选择授权等级。
2. 运行记录能证明实际调用了 Claude Code 和 Codex CLI，而不是内部角色模拟。
3. Codex 审查绑定准确 candidate SHA，FAIL 必然回到实现修复。
4. 高风险动作即使在工作流整体授权下仍会即时确认。
5. 适配器超时、崩溃和结果未知不会造成盲目重复副作用。
6. 新增第二个专家团时无需修改 Capability Fabric 或 Kun 主运行时文件。
7. 新增第二个软件适配器时无需修改专家团内容或 Kun 主运行时文件。
8. Windows、macOS、Linux 适配器通过同一套契约认证测试。
9. 合并新一版上游 Kun 时，冲突被限制在一次性 Extension Seam 聚合点或打包资源清单。

## 17. 参考资料

- CSDN：《多 Agent 对证循环协作架构：Hermes + Claude Code + Codex 三角色工作流实战》：<https://blog.csdn.net/qq_36710118/article/details/161525417>
- 现有迁移设计：`docs/superpowers/specs/2026-07-15-experts-moa-automation-migration-design.md`
- 项目 Skill：`.agents/skills/orchestrating-kun-evidence-loops/`
- Windows 桌面 E2E Skill：`C:\Users\xuchu\.codex\skills\windows-desktop-e2e\SKILL.md`
- 本机 OpenAI Computer Use 插件：`C:\Users\xuchu\.codex\.tmp\bundled-marketplaces\openai-bundled\plugins\computer-use\`
- OpenAI Computer Use 指南：<https://developers.openai.com/api/docs/guides/tools-computer-use>
- pywinauto：<https://pywinauto.readthedocs.io/>
- FlaUI：<https://github.com/FlaUI/FlaUI>
- Appium Mac2 Driver：<https://github.com/appium/appium-mac2-driver>
- GNOME Accessibility / AT-SPI：<https://gitlab.gnome.org/GNOME/at-spi2-core>
