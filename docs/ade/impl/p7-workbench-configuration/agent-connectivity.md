# Agent 接入修复与品牌图标实施计划

用户补充反馈：当前 Agent 列表不能正常接入，截图显示 Codex 缺 ACP 适配器、OpenCode 握手失败、Antigravity 未安装，同时所有条目使用通用机器人图标，并直接显示 `native-login/provider/kun-gateway`。

本补充与配置计划一起实施。接入修复是发布前置条件，不能以完成设置页面替代真实 Agent 可用性。当前是源码调研和实施安排，没有执行用户账号登录、安装或付费模型试运行，也没有宣称这些故障已经修复。

## 1 已确认事实与仍需复现的问题

| 证据 | 当前代码事实 | 可以得出的结论 | 仍需验证 |
| --- | --- | --- | --- |
| 截图 Codex 提示缺适配器 | `builtin-harnesses.ts` 默认 `codex` transport 是 `acp`，detect 为 `codex-acp`；另有 app-server variant | 原生适配器存在，但默认路径仍要求额外 ACP 程序 | 当前运行构建、effective catalog、原生端到端能力和默认切换迁移 |
| Catalog override | `applyTransportOverride` 替换 launch/detect/capabilities，但保留其余 definition | 需要一起检查 setup/adapter 提示、权限和模型探测是否仍携带旧 transport 元数据 | 原生路径能否错误显示安装 ACP 的修复入口 |
| Codex 配置注释 | config schema 注释称默认原生，但 builtin 仍默认 ACP | 文档/注释不能当实际默认值 | P6 接入与 GUI config 生成的最终事实 |
| OpenCode 握手失败 | launch 为 `opencode acp`，readiness 在临时 cwd 无选中凭据模式下启动 | 当前握手结果不能解释为所有来源和环境都不可用 | 实际 binary/version/argv/cwd/env 分类、退出码、协议与插件影响 |
| Antigravity 未安装 | Kun 检测命令为 `antigravity`，参考项目目录使用 `agy` | 发现命令存在差异，是待验证的误报候选 | 本机命令、别名版本、实际协议；不能仅凭差异认定已安装 |
| Cursor 看似可选 | Kun 使用 bundled Cursor SDK，凭据来自 provider；参考项目 CLI 为 `cursor-agent` | 两种接入语义不同 | UI 是否把 SDK API 路径错误解释为本机 CLI 登录路径 |
| Claude 可选 | Agent SDK 与 CLI/Keychain 检测并存 | 安装、账号确认、模型路由需分别验证 | bundled 与 override 的实际一致性、native-login/gateway 两条路径 |
| Gemini 可选 | 使用 `gemini --acp`，readiness 已放宽到 30s，timeout 返回 unknown | 不能继续按旧 10s 超时诊断，也不能只加超时声称修好 | 当前版本参数、认证、新会话与模型列表 |
| 灰色条目无操作 | picker 整行 `disabled={code != null}` | 用户无法在原位点击修复动作 | 改造后键盘和点击修复的可达性 |
| 图标与术语 | picker 每行/触发器用 Bot，副标题 join credentialModes | 品牌和用户文案缺失已由源码确认 | 其他面板是否也有重复映射 |

实现证据入口：

- `kun/src/harness/builtin-harnesses.ts`、`harness-catalog.ts`、`harness-runtime.ts`、`build-harness-runtimes.ts`。
- `kun/src/harness/harness-detector.ts`、`acp-readiness-probe.ts`、`harness-login-probes.ts`。
- `src/renderer/src/store/harness-store.ts`、`components/chat/FloatingComposerHarnessPicker.tsx`。
- `src/renderer/src/components/provider-icon.tsx` 与 `assets/provider-icons/`。

## 2 从参考实现吸收的机制

参考本地终端编排项目的实现，而非照搬其所有终端模式：

| 机制 | 已核对的参考入口 | Kun 的落点 |
| --- | --- | --- |
| GUI 启动 PATH 补齐和安装目录发现 | `src/main/preflight/agent-detection.ts`、`ipc/agent-detection-shell-path.ts` | 复用 Kun 已有 shell/path resolver，缺口再补；不另起无界扫描 |
| 命令与依赖来自同一目录定义 | `src/shared/tui-agent-detection-commands.ts` | detect/launch/setup/probe 从同一 effective harness 定义推导 |
| 探测和执行同一 binary/env | `src/main/codex/codex-structured-launch-resolution.ts` | 统一 HarnessInvocationResolver 与启动指纹 |
| 结构化与终端接入明确分开 | `src/shared/structured-native-chat-launch-route.ts` | 分别给出一对一、worker、终端准入结果，不伪装协议能力 |
| 宿主拥有状态与刷新代次 | preflight generation/cache 与 status store | probe generation 防止旧回执覆盖新配置 |
| 集中 AgentIcon 和本地图标 | `src/renderer/src/lib/agent-catalog.tsx` | Kun 自己的 AgentBrand/AgentIcon，共享已有本地资源 |

不直接复制源码或资源，也不引入参考产品名到新文件、类型、CSS/i18n 命名。参考项目的远程与常驻进程模型不改变 Kun 的应用生命周期约束。

## 3 统一启动计划

提案 `HarnessInvocationPlan` 由 Kun 宿主解析：

```ts
type HarnessInvocationPlan = {
  harnessId: string
  transport: HarnessTransport
  executable: string
  args: string[]
  cwd: string
  environmentIdentity: string
  accountIdentity?: string
  configurationRevision: string
  fingerprint: string
}
```

这是内部计划，不能把完整 env、凭据或账号目录内容传回 renderer。公开诊断只给安全的路径、版本、transport、阶段和脱敏摘要。

- 优先级沿用现有显式路径 > bundled > 环境发现，并为 aliases 记录选择来源。
- 检测、模型探测、连接测试和实际 turn 都基于相同 resolver；无工作区探测必须标为通用安装检查，不能泛化为所有项目可执行。
- 解析并传递受控 args 数组，不能把路径与命令拼成随意 shell 字符串。
- GUI sparse PATH、Homebrew/npm/版本管理目录、Windows `.cmd`/空格路径通过现有跨平台受管启动器处理。
- 解析结果绑定 transport、命令、版本、参数、配置代次和账户身份；任何一项改变都使旧 probe/cache 失效。
- 环境值不入日志，不通过完整 `env`/凭据文件输出做诊断。

## 4 检测不是一次布尔值

分阶段记录结果：发现程序 → 版本/启动条件 → 协议握手 → 账号/来源 → 模型目录 → 实际轮次。

每个阶段含 `unknown/checking/passed/failed`、reasonCode、checkedAt、invocation fingerprint 和可用恢复动作。

- 文件存在只证明存在，不能证明账号有效。
- handshake 通过只证明该协议可连接，不证明模型请求一定成功。
- 超时显示“暂未确认”，保留重试；已知协议错误显示明确失败。
- 401、模型 404、来源配置错误、网络错误不能都写成 `handshake_failed` 并永久封禁整个 Agent。
- native-login、provider、gateway 是不同 route，单个来源失败不污染另一条来源的准入。
- 一对一可用不等于可作 worker/Graph 节点。按 usage 和权限能力计算准入。
- 原生 Agent 不可用时不能静默替换为 Kun，也不能静默把结构化聊天变成终端。

UI 摘要示例：“可用 · 本机账号”“需登录”“未找到程序”“连接超时 · 重试”“模型来源配置有误”。原始协议名放高级详情。

## 5 按 Agent 的修复与验收策略

### Codex

1. 完整追踪 GUI settings → 生成 Kun config → effective catalog → detector → runtime map。
2. 完成已有 app-server 适配器的真实验证后，将新的默认连接选择指向原生路径；缺 `codex-acp` 不能阻断已支持的原生路径。
3. transport variant 同步 detect、launch、capabilities、permissionModes、模型探测、setup/adapter 提示；不保留过期安装提示。
4. 保留显式 ACP 选择作为兼容路径，不在原生失败时偷偷切换；旧原生 session 按既定绑定续接，跨 transport 走交接。
5. 测试 native-login、gateway、启动/流式/停止/问题/审批/恢复；支持与否按真实能力展示。

### Claude Code

1. 核对 bundled SDK、显式 CLI override、版本及模型探测使用同一选择。
2. 登录 unknown 与 signed-out 分开，本机登录和 gateway 单独测试。
3. 不复制或重写第三方凭据，不通过读出 Keychain secret 来做 UI 状态。
4. 验证一对一与 worker 都有流式、取消和审批结果，附件通过原契约。

### Cursor

1. 明确当前是 Cursor SDK/provider 路径，文案写明所需来源配置。
2. 本机存在 `cursor-agent` 不自动等价于 SDK provider 已就绪。
3. 核对 SDK 的连接、模型列表、权限与停止；未提供的能力不显示假控件。
4. 如最终需要新增 CLI 原生接入，应作为独立适配器提案；本轮先修好并如实呈现既有支持路径。

### Gemini CLI

1. 在实施日根据已安装版本/官方协议核对 ACP 参数与认证方式；记录版本，不复制记忆中的参数。
2. 分开冷启动、超时、未授权和协议错误；不同工作区不能共用错误的就绪缓存。
3. 验证首次登录到 model/session/prompt，不能只停在 initialize。

### OpenCode

1. 复现实际启动计划；采集有界、脱敏的退出码、stderr 和协议帧，不立即定性为上游崩溃。
2. 对比用户原环境、隔离配置和 Kun 生成 gateway 配置，识别插件、cwd、版本、参数或 provider 的影响。
3. 逐项修复可确认的 Kun 差异，再验证会话创建、模型选择和首轮请求。
4. 若特定版本确实不支持结构化路径，说明验证过的版本范围及升级/显式终端操作；不得把终端可用标为 ACP 修复成功。

### Antigravity

1. 核对 `antigravity` 与 `agy` 的身份、安装方式和支持参数，避免误认 IDE 启动器为可执行 Agent 协议。
2. 增加经验证的命令别名/位置，保持实际协议能力限制。
3. 验证本机来源与 CLI 能力，缺少程序时给有效安装或路径选择，不把真实未安装改成绿色。

Kun 自身需验证所选 provider/model 能完成请求；不能只因 native-loop 内置就显示模型连接已验证。Pi 按现有 prerelease 准入，规范化 ID 列表需与目录一致，未通过既定验收不强制公开。

## 6 图标和选择器行为

### 品牌正本

- 新增中性命名的 `agent-brand.ts` 和 `AgentIcon.tsx`（建议名），按稳定 harness ID 解析。
- Kun 使用已有 Kun 本地资源；Claude、Codex、Cursor、Gemini、Antigravity 优先复用已有正确品牌 SVG。
- OpenCode Agent 与 OpenCode Go 供应商品牌不得混同；缺正确资产时补有来源记录的本地图标，不能直接借用 `opencodego.svg`。
- Pi 与自定义 Agent 只在对应对象出现时提供正确图标；未知身份使用中性占位，不默认冒充 Kun/Claude。
- renderer 品牌 key 是白名单；不要直接注入任意 Agent 返回的 SVG/远程 URL。
- 资源随包提供，离线必须可见；不通过在线 favicon 服务补关键图标。

### 全部消费点

composer trigger、Agent menu、AgentCenter、one-on-one picker、worker 行、MissionCard、侧栏、接管横幅、终端 tab、手机列表必须使用同一解析器。

Agent 图标代表执行引擎；模型来源图标代表供应商。两者可以同时出现，但不可根据模型名猜 Agent 品牌。

### 布局与可达性

- 支持 14/16/20/24px 场景和 1x/2x 屏幕，SVG 清晰；必须使用位图时有足够分辨率和统一视觉内边距。
- loading 不替换品牌图标，使用独立状态槽；状态颜色不重涂品牌身份。
- 未就绪条目的名称和原因保持可读，只禁用“选择使用”，独立的“登录/修复/安装”按钮仍可点击和键盘访问。
- 不在一个 disabled button 内嵌修复按钮；使用行容器、选择区域和独立动作，保持正确菜单语义。
- 删除 UI 中的 credentialModes join，统一为本地化来源/状态摘要。
- 图片加载失败有稳定中性回退，不改变条目身份、行高或可操作性。

## 7 新增修复批次

### B01 启动定义和路由一致性

依赖 A01。修复 effective catalog、Codex 原生默认的条件、variant 元数据、命令别名及 GUI config 桥；提取共用 invocation resolver，模型探测和真实执行复用。A05/A06/A10 以其能力和定义为基础。

测试：Codex 未装 ACP 但原生满足条件、显式 ACP、路径有空格、变更 override 后缓存失效、未知 variant、原生 session 绑定不漂移。

### B02 分阶段连接和逐 Agent 修复

依赖 B01。逐个复现上节路径，建立 route-scoped 状态与错误分类，修复发现、握手、认证、模型、首次 turn 的实际缺口。禁止通过降低能力门槛或忽略错误让列表变绿。

测试：离线、超时、协议崩溃、未登录、401、404、来源变更、迟到探测、真实启动失败、取消清理、无付费的检查路径。

### B03 品牌资源与可操作的选择器

依赖 A01，可独立于 B02；最终状态文案依赖 B02 输出。实现共享 AgentIcon、全部消费点、本地化摘要、未就绪行的修复操作以及明暗/Retina/离线验证。

### B04 接入实机证据与发布门槛

依赖 B02、B03，完整 UI 场景依赖 A06/A10/A12。对截图所列每个 Agent 逐项记录可用路径、安装版本、来源、执行、停止、恢复、审批及 worker 准入结果。

缺本机程序/账号的条目标未验证，不能标通过；对应功能不作为已验证支持发布。安装/登录和真实请求在实施任务中按用户授权与既有流程进行，不从打开 picker 自动发起。

## 8 证据记录模板

每行包含：Agent ID、应用 commit/包路径、CLI 版本、effective transport、解析来源、credential mode（无秘密）、工作区、验证阶段、结果、错误码、脱敏日志路径、截图和复测记录。

结果只能为通过、失败、未执行、能力不支持。握手通过与真实 turn 通过分别记录。终端验证与结构化验证分别记录。

截图列出的可公开结构化 Agent 必须至少通过首轮输入、流式/最终输出、停止及下一轮；worker 宣称还要覆盖派工和回报。能力不支持时 UI 正确降级，也是独立验收项，不等于该能力已实现。

## 9 对整体计划的调整

- B01/B02 是功能性前置修复，优先于配置美化；B03 可与状态/入口改造独立安排。
- A06 复用 B 系列诊断/修复动作，不能重新实现探测状态机。
- A17 总验收必须包含 B04，每个 Agent 的失败或未验证项单列。
- 接入专项约 6-10 工程日，取决于问题复现和既有适配器覆盖。Code 融合后总体按 U01 的实际复用/迁移范围重新估算，不能把接入缺陷计作纯 UI 工作。
