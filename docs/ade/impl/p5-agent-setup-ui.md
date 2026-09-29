# Agent 添加与配置界面优化计划（P5）

- 日期：2026-09-29
- 基线：`develop@3093f113b`（P4 已合入）
- 参考：Cindy 客户端（`/Users/zxy/codeproject/ds_project/cindy`）的"模型供应商"与引擎配置界面；ACP 官方的 Registry、Terminal Auth、`auth/status` 三份规范。
- 背景：P4 让 Agent 中心"能用"了，但它仍是一张平铺的卡片清单：未安装的内置 agent 也常驻占行，自定义 ACP 表单一直展开在页底，卡片上直接暴露"接入方式""凭据方式"这类实现概念，添加一个 agent 没有引导流程。本文先总结 Cindy 的做法和 ACP 的新规范，再对照 Kun 现状列出差距，最后给出按 PR 拆分的计划。

## 1. Cindy 的做法（调研）

### 1.1 总体思路：引擎不露面，模型来源露面

Cindy 只有三个引擎（Claude Code、Codex、Pi），界面上几乎不出现"配置引擎"这件事：

- **二进制完全托管**：版本钉在 `tools/<kind>/latest.json`，启动页按 CDN manifest 下载并做 SHA-256 校验，装进 `userData/<kind>/<version>/`，校验通过后写 `.verified` 标记；执行前用 `isVettedAgentBinaryPath` 复核路径必须出自托管模块（`apps/desktop/src/main/agent-binaries/index.ts`）。用户从不安装 CLI，也不填命令路径。
- **用户配置的是"模型供应商"，不是引擎**：每个供应商在 `runtimes.{claude-code,codex,pi}` 里分别声明端点。**鉴权方式由供应商定义决定**（OAuth 浏览器回调或设备码、API Key、无需鉴权），向导里原话是"鉴权方式由供应商定义决定，不让用户猜"（`AddProviderWizard.tsx` 头注）。
- **模型优先的选择器**：用户只选模型；引擎由推荐映射自动选定，并且在每一行上**常驻显示**为 `[引擎图标] 深度 [⚡]`。改引擎只在该行的配置浮层里做，而且只存为覆盖值；"恢复推荐"就是删除覆盖值（`docs/product-rules/model-selector-unified.md`）。

### 1.2 添加流程：三步向导（`components/settings/AddProviderWizard.tsx`）

1. **选择**：顶部是搜索框，下面是单列目录，分组依次为：
   - 推荐：最多 3 条。优先级是本机模型 > 本机已装的 CLI（已登录优先于仅安装）> 第一个未连接的订阅（`wizardRecommend.ts`）。
   - 检测到的本机服务、订阅授权、API Key 预设、更多本机服务。
   - "自定义端点"是一张虚线卡片，**钉在滚动区之外**，目录再长也始终可见。
2. **连接**：
   - OAuth 一键授权，可选浏览器或设备码。设备码卡片显示一次性码、"复制"、"打开验证页"并标出目标域名，另有一句"完成前请保持窗口开启"（`OAuthDeviceCodeCard.tsx`）。
   - 等待授权期间按钮变成"取消"，不做禁用。
   - "改用 API Key 接入"作为并排的次级按钮，而不是一行小灰字（注释里写明：小灰字用户根本注意不到）。
   - 只支持一个引擎的供应商会显示"仅支持 X"。
3. **选择模型**：自动拉取模型列表，推荐模型预先勾选。拉取失败时降级为"只用预设推荐模型"，**不把用户堵死在网络错误上**。

外部入口可以直接深链到第二步，例如 `?tab=providers&connect=<id>`。

### 1.3 管理页：左右双栏（`components/settings/ProvidersSection.tsx`）

- **左栏**：
  - 可拖动排序，只列**已连接或已添加**的来源；未连接的内置渠道不占行，入口在向导里。
  - 本机检测到 CLI 时，左栏多一条"检测建议"。
  - 已停用的来源沉到底部。
  - 底部固定一个"＋ 添加供应商"。
- **右栏**：
  - 顶部是鉴权头部：状态胶囊，以及连接、断开、重新连接按钮。
  - 下面是统一模型列表（`UnifiedModelList.tsx`）：同一来源下所有引擎的模型取并集。一个开关同时控制该模型在所有引擎里是否显示；不一致时出现提示，点开后按引擎分列调整。停用放在"⋯"菜单里，停用的行沉到底部。刷新只追加新模型，不改动已有项。
  - 拉取失败的原因分为 8 类：网络、超时、上游错误、地区限制、未授权、被拒绝、拒绝请求、空列表。每类还有一个"下面是上次的结果"版本。

### 1.4 自定义表单（`components/settings/CustomProviderDialog.tsx`）

- 可以从模板快速填充。
- 每个引擎一个标签页，分别填 baseUrl、协议、密钥和模型。
- "测试连接"会显示耗时；"获取模型列表"后弹出选择器，支持搜索和全选。
- 请求头按"键 / 值"逐行编辑，收在"高级"折叠区里。
- "填充其他 runtime"：先展示字段差异，再逐项确认要不要覆盖；每个引擎的密钥仍然各自独立保存。
- 删除前的确认框会说明后果，例如"正在使用它的任务会回退到默认来源"。

### 1.5 首次引导（`components/onboarding/ConnectProviderCard.tsx` + `hooks/useProviderOnboarding.ts`）

- 只在**一个可用来源都没有**时出现，可以关闭。之后一旦连上任何来源，就清除"已关闭"标记，方便将来再次归零时重新出现。清除逻辑是模块级订阅，不依赖卡片是否挂载。
- 排序：检测到"已安装且已登录"的本机 CLI 置顶（只安装、未登录的不置顶），然后是推荐行、按区域排的主列表，"其他供应商"折叠收起，最后是"我有 API Key"。
- 卡片里每一行都只负责导航，不在卡片里做授权。

### 1.6 本机 CLI 检测（`shared/localCliDetect.ts` + `main/maker-ipc/localCliDetect.ts`）

- 数据驱动的映射表：CLI → 配置目录、登录态探测方式、建议接入的来源。
- 只判断凭据是否**存在**，不把凭据写盘或打进日志。任何一项探测失败都按"未安装"处理。
- `sharedWithCindy` 区分"沿用的是本机那份登录"和"用户在 Cindy 里另行授权"，避免显示错误的文案。
- 例外：macOS 上的 Claude 登录态实际是通过 `security find-generic-password -w` **读出了**钥匙串内容（`claude-credentials-store.ts:69-77`）。Kun 不照搬这一点，见 P5-02。

### 1.7 配置分层（`docs/dev-rules/configuration-and-overrides.md` + `DefaultOverrideControls.tsx`）

- 可见性分四层：常规、高级、隐藏配置、内部常量。不能因为技术上能配，就把它放到设置页外层。
- 有效值 = 系统默认 + 用户覆盖值；持久化**只存覆盖值**。
- "恢复默认"的意思是删除覆盖值，而不是写入一份默认值快照。
- 行内显示"已自定义"徽标和恢复按钮；没有覆盖值时按钮仍占位但置灰，防止行宽跳动。

### 1.8 不能照搬的部分

| Cindy 的做法 | 为什么 Kun 不照搬 |
| --- | --- |
| 随包分发三个引擎的二进制 | Kun 支持 7 个内置 agent，外加任意 ACP agent 和终端 agent；许可、体积、更新节奏都不允许随包分发 |
| 应用内 OAuth 结果写进 CLI 自己的凭据存储 | Kun 不写第三方 CLI 的凭据存储；登录由 agent 自己完成（见 §2 Terminal Auth） |
| 模型优先，引擎自动推导 | ADE 以 agent 为主语：一对一就是"和 Claude Code 对话"，总管派工也按 agent 挑。只借用"来源露面、凭据方式不露面"这一点 |
| 静默下载 | 受 `docs/AGENTS.md` 红线约束：外部 agent 进程只能由 `kun serve` 经 harness runtime 和受管启动器启动；P4-09 也定下了安装命令只预填、不自动执行 |

## 2. ACP 规范的新进展（2026-09-29 核对）

| 规范 | 状态 | 对 Kun 的意义 |
| --- | --- | --- |
| [ACP Registry](https://agentclientprotocol.com/get-started/registry.md)（[RFD](https://agentclientprotocol.com/rfds/acp-agent-registry.md)） | 已稳定。聚合文件 `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` | 一份现成的、有人维护的 agent 目录：`id`、`name`、`version`、`description`、`distribution`（`npx` / `uvx` / `binary`，含 `args`、`env`）、`icon`（16×16 单色 SVG，颜色用 `currentColor`，天然适配深浅色）。收录条件是 agent 必须支持认证：CI 会检查 `initialize` 返回的 `authMethods` 非空。相当于 Cindy 的"供应商预设目录" |
| [Terminal Auth](https://agentclientprotocol.com/rfds/auth-methods.md) | 2026-08-20 完成并稳定 | 客户端声明 `clientCapabilities.auth.terminal: true` 后，agent 可以返回 `type: "terminal"` 的登录方式（只带 `args` 和 `env`，**不能指定命令**）。客户端用**同一个 agent 程序**加上这些参数，在交互式终端里运行；进程退出码为 0 表示成功，随后重连并重新 `initialize`。这与 P4-09"在 Kun 终端里登录"的做法一致，而且是标准协议 |
| [`auth/status`](https://agentclientprotocol.com/rfds/get-auth-state.md) | Draft（2026-07-21） | agent 在 `agentCapabilities.auth.status` 里声明支持后，客户端可以直接查询是否已登录。只能按能力探测后再用，不能依赖 |

另外核对到：注册表里 Codex 适配器的包名是 `@agentclientprotocol/codex-acp@2.0.0`，仓库已迁到 `agentclientprotocol/codex-acp`；而 Kun 内置定义里写的仍是 `npm i -g @zed-industries/codex-acp`（`kun/src/harness/builtin-harnesses.ts:317-319`），需要实机核对后更正（见 P5-01）。更彻底的做法是让 Codex 改走原生 App Server 协议、不再依赖这个适配器，见 [P6](./p6-native-agent-adapters.md)。

## 3. Kun 现状与差距（P4 之后）

| # | 方面 | 现状（代码位置） | 问题 | 可参考 |
| --- | --- | --- | --- | --- |
| 1 | 列表 | `AgentCenter.tsx:103-154` 把目录里的每一行都画成卡片，未安装的 Antigravity 等也常驻；`AgentCenter.tsx:156-159` 的自定义 ACP 表单一直展开 | 噪音大；分不清"已接入"和"可接入" | 1.3 左栏只列已添加的，1.2 目录进向导 |
| 2 | 添加入口 | 没有"添加 agent"流程；自定义 ACP 只能手填命令、参数和环境变量文本框 | 不知道能接哪些 agent；没有模板 | 1.2 向导 + §2 Registry |
| 3 | 卡片层级 | `AgentCenterCard.tsx:225-227` 显示接入方式徽标（Agent SDK / ACP）；`:236-243` 显示凭据方式芯片；命令路径和权限藏在一个只有 aria 标签的折叠箭头后面（`:259-270`、`:307-343`）；P4 §3.2 要求的"默认模型"没有做 | 首屏暴露实现细节，真正要改的默认值反而藏着 | 1.3 右栏：头部 → 模型 → 高级 |
| 4 | 凭据方式 | 一对一对话框单独有"凭据方式"下拉（`AdeOneOnOneDialog.tsx:123-140`），composer 用 `ade-cred:` 哨兵分组（`lib/ade-composer-harness.ts:19-41`） | 用户要先弄懂"原生登录 / Kun 网关 / provider"三个概念 | 1.1：鉴权由来源决定；用户选"用谁的模型" |
| 5 | 登录 | 只能在终端预填内置定义里写死的登录命令；ACP 握手只保留 `authMethods` 的 id 和 name（`acp-handshake-probe.ts:94-101`），丢了 `type`、`args`、`env`、`description`；没有声明 `auth.terminal`（`acp-connection.ts:103-108`） | 自定义 ACP 和注册表里的 agent 没有登录入口 | §2 Terminal Auth |
| 6 | 登录态 | Claude Code 探测会**读取并解析**凭据文件（`harness-login-probes.ts:43-57`），macOS 一律返回 unknown；`requiresAuthentication` 只要看到 `authMethods` 非空就算"需要认证"（`acp-connection.ts:81-84`） | P4 §1.2 里大量"登录状态未知"；而注册表收录的 agent 必然带 `authMethods`，按这条规则会全部被误判为需要登录 | 1.6 只查存在性 + §2 `auth/status` |
| 7 | 安装数据 | 内置 `setup` 是手写命令 | 会过时（Codex 适配器已改名，见 §2） | 注册表快照 + 一致性测试 |
| 8 | 默认值 | `harnesses.defaults[id]` 只存覆盖值（P4-11），但界面上看不出哪些改过，也没有恢复入口 | 用户不知道自己改过什么 | 1.7 |
| 9 | 模型 | Agent 中心看不到 agent 的模型列表，也不能设默认模型；模型探测失败没有原因 | 只能到一对一对话框里才看到模型 | 1.3 统一模型列表（简化版） |
| 10 | 编辑自定义 agent | 保存后只能删除或导出（`AgentCenterCard.tsx:345-366`） | 改一个参数就要删掉重加，还要重新测试 | 1.4 编辑 + 差异确认 |
| 11 | 终端 agent | `terminalAgents[]` 只有设置字段和终端菜单，渲染层没有添加界面（`grep terminalAgents` 只命中 `AgentCenter.tsx:21,122`） | 只能手改设置文件 | 1.4 表单 |
| 12 | 首次引导 | `AdeReadinessCard.tsx:69-77` 每项只有一个通用的"去设置"按钮 | 已装已登录的 agent 没有快捷路径 | 1.5 检测行置顶 |

## 4. 设计原则

1. **来源露面，凭据方式不露面**：在"一对一 / composer / 默认值"里，用户选的是"用谁的模型"（本机账号，或者某个 Kun provider）。`credentialMode` 由选择推导，只在高级信息里出现。
2. **列表只放已接入的**：可接入的 agent 进向导目录；未安装或已停用的沉到左栏底部并默认折叠。
3. **一页一个主操作**：延续 12 §2 与 P4-08 的状态表（`agent-center-actions.ts`），头部只放一个主按钮。
4. **失败要能降级**：握手超时、模型探测失败时，允许先完成添加，标记为"未就绪"并给出重试入口（沿用 P4-12 的"仍然保存"）。
5. **只存覆盖值**：界面上显示"已自定义 · 恢复默认"，恢复就是删除 `defaults[id]` 里对应的键。
6. **命令只能来自可信来源**：可以执行或预填的命令只有三种来源——内置定义、随版本附带的注册表快照、用户亲手填写。agent 声明的 Terminal Auth 只能追加参数，不能换程序。项目文件不能注册任何 agent。

红线不变：不做宿主运行时切换器；所有外部 agent 进程都由 `kun serve` 经 harness runtime 启动；设置只放在 `agents.kun` 下；从注册表添加的 agent 本质上就是一条 `custom[]` 定义。

## 5. 目标设计

### 5.1 信息架构：Agent 中心改为左右双栏

```text
┌ Agent 中心 ───────────────────────────────────────────────────────┐
│ ┌ 左栏（可拖动排序）──────┐ ┌ 右栏：选中 agent 的详情 ──────────────┐ │
│ │ ● Kun          默认    │ │ [图标] Claude Code  2.1.281  ● 就绪    │ │
│ │ ● Claude Code          │ │ 本机已登录 · 上次检测 3 分钟前 [测试连接]│ │
│ │ ● Gemini CLI           │ │──────────────────────────────────────│ │
│ │ ◐ Codex   需装适配器    │ │ 模型来源                              │ │
│ │ ○ Qwen Code 需要登录    │ │  ◉ 本机 Claude 账号                    │ │
│ │ ▸ 未安装（3）           │ │  ○ DeepSeek · 经 Kun 网关             │ │
│ │ ▸ 已停用（1）           │ │ 默认模型   [claude-sonnet-… ▾] 已自定义 ↺│ │
│ │                        │ │ 默认权限   [询问 ▾]                   │ │
│ │                        │ │ 默认隔离   [本地 ▾]                   │ │
│ │ ＋ 添加 Agent           │ │ ▸ 高级：命令路径、接入方式、环境变量    │ │
│ └────────────────────────┘ │ ▸ 移除 / 停用                         │ │
│                            └──────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

- **左栏分组**（纯函数 `agent-list-groups.ts`，不需要新增设置）：
  - "可用"与"需要处理"（`signed_out`、`adapter_missing`、`handshake_failed`、`handshake_timeout`）排在前面，按 `agentOrder` 排序，支持拖动。
  - "未安装"（内置且 `installed: 'no'`）和"已停用"（`disabledIds`）沉底并默认折叠。
  - 自定义 ACP 和终端 agent 与内置 agent 混排，名称旁带"自定义""仅终端"标签。
- **右栏头部**：图标、名称、版本、状态胶囊，下面一行是中文原因（沿用 P4-05 的原因码），右侧是 `agentCardModel` 给出的唯一主操作。原始 message 放进"查看原因"的展开区。
- **窄屏**（设置页内容区宽度 < 720px 时）：双栏退化为"列表 → 详情"两层，详情顶部有返回按钮。
- ADE 侧栏的"Agent"入口和"设置 → Agents → Agent harness"继续复用同一个组件（延续 P4-08）。

### 5.2 详情的各个区块

| 区块 | 内容 | 存储 |
| --- | --- | --- |
| 模型来源 | 列出这个 agent 能用的来源（规则见 5.5），单选默认来源；来源不可用时置灰并写原因，例如"该 provider 未配置密钥" | `defaults[id].credentialMode` + `providerId` |
| 默认模型 | 按当前默认来源列出模型（复用 `loadHarnessModels` 与 `loadHarnessProviderGroups`）；探测失败显示原因和"重新获取" | `defaults[id].model` |
| 默认权限、默认隔离 | 保留现有的权限下拉；新增隔离下拉 | `defaults[id].permissionMode` / `isolation` |
| 高级（默认折叠） | 命令路径（从卡片上的折叠区移到这里）、接入方式（Agent SDK / ACP / 终端）、解析到的命令、自定义 agent 的参数与环境变量编辑（5.6）、导出 JSON | `binaryPaths`、`custom[]`、`terminalAgents[]` |
| 危险区 | 停用（内置）或移除（自定义），都要经过确认对话框，说明"已有会话里的该 agent 会变为不可用" | `disabledIds`、`custom[]` |

每个默认值字段右侧都放 `DefaultOverrideControls` 式的"已自定义 · ↺"控件：点 ↺ 就删除 `defaults[id]` 里的对应键；`defaults[id]` 变成空对象时整项删除（沿用 `AgentCenter.tsx:137-147` 的写法）。

### 5.3 添加 Agent 向导（三步）

**第 1 步：选择**。顶部是搜索框；目录分组如下，单列、可滚动：

| 分组 | 来源 | 行的副标题示例 |
| --- | --- | --- |
| 推荐（最多 3 条） | 已检测到、只差一步的内置 agent（`adapter_missing`、`signed_out`）优先；其次是本机已具备运行条件的注册表 agent（例如有 `npx`） | "检测到 Codex CLI，还差 ACP 适配器" |
| 内置 | 未就绪或未安装的内置定义 | "需要安装 · 官方 CLI" |
| ACP 注册表 | 注册表快照里的条目（去掉与内置重复的，见 P5-01） | "通过 npx 运行 · 无需安装" / "需要下载" |
| 自定义（钉在滚动区外） | 自定义 ACP、自定义终端 agent、从 JSON 导入 | "填写命令并测试连接" |

已经可用的 agent 不出现在目录里，它们已经在左栏了。

**第 2 步：接入**。按条目类型分支：

| 条目 | 界面 |
| --- | --- |
| 内置 · 未安装 / 缺适配器 | 主按钮是"在终端中安装"（沿用 P4-09 预填）；次按钮是"我已安装，重新检测"和"指定命令路径"。终端退出后自动重新检测，状态变化后自动进入下一步 |
| 需要登录 | 按优先级：ACP 的 terminal 登录方式 → ACP 的 agent 登录方式（agent 自己打开浏览器）→ 内置定义里的登录命令。**支持 Kun 网关时，"改用 Kun 的模型"作为并排的次级按钮**（Cindy 1.2 的"改用 API Key"），点击后直接跳到第 3 步，把来源设为网关 |
| 注册表 · `npx` / `uvx` | 展示将要运行的完整命令，例如 `npx -y @agentclientprotocol/codex-acp@2.0.0`，标明版本已固定；检查本机有没有 `npx` 或 `uvx`，没有就给出安装 Node / uv 的说明链接。确认后按 `custom[]` 条目保存（带 `catalog` 来源信息，见 P5-07） |
| 注册表 · `binary` | 默认给出"下载页"链接和"指定命令路径"；托管下载需要先定下 D1 再做（P5-11） |
| 自定义 ACP / 终端 agent | 5.6 的表单 |

**第 3 步：测试与默认值**。
- 自动跑握手级测试（P4-10 的 `POST /v1/harnesses/:id/test`，`level: 'handshake'`），逐级显示检测和握手的耗时与结果。
- 注册表里走 `npx` / `uvx` 的条目第一次启动要下载包，所以握手超时放宽到 120 秒，并提示"首次启动会下载 xxx，可能需要一两分钟"。
- 选默认来源和默认模型（5.5）；"试运行"（`level: 'trial'`，会消耗额度）是一个可选的按钮。
- 失败时可以"仍然完成"，保存后标记为未就绪（延续 P4-12）。
- 完成后左栏选中新添加的 agent。

**深链**：`openSettings({ section: 'agents', panel: 'harnesses', addAgent: '<catalogId>' })` 直接进入第 2 步。composer 选择器与一对一对话框里的"去设置"、首页就绪卡都用这个入口。

### 5.4 登录与登录态

- **Terminal Auth**（P5-03）：
  1. Kun 只对本机 stdio 连接声明 `clientCapabilities.auth.terminal: true`。
  2. 握手结果完整保留 `authMethods`：`type`、`args`、`env`、`description`。
  3. 新接口 `POST /v1/harnesses/:id/auth/terminal-plan { methodId }` 由 kun 生成要运行的命令：解析到的命令 + 启动参数 + agent 声明的参数；环境变量按"启动配置为底、agent 声明的覆盖同名项"合并，`secretEnv` 仍然只在 kun 侧解析。
  4. 渲染层用 P4-09 的"预填、不自动执行"模式打开 Kun 终端。预填内容末尾追加"成功才退出"：POSIX 是 `… && exit`，PowerShell 是 `…; if ($?) { exit }`。这样"进程以 0 退出 = 登录成功"的规范语义自然落在终端退出上，终端退出后重新检测。
- **agent 类登录方式**：新接口 `POST /v1/harnesses/:id/auth/authenticate { methodId }`，开一条短连接调用 ACP `authenticate`（agent 自己打开浏览器），界面显示"等待授权…"和"取消"，超时 5 分钟。
- **登录态探测**（P5-02）：
  - Claude Code 的凭据文件只用 `stat` 判断是否存在，不再读取和解析。
  - macOS 用 `security find-generic-password -s "Claude Code-credentials"` 查钥匙串条目是否存在，**不带 `-w`**，不读取密码；实施时要实机确认不会弹出钥匙串授权框，会弹就退回 `unknown`。
  - Codex 判断 `${CODEX_HOME:-~/.codex}/auth.json` 是否存在。
  - ACP agent 声明了 `agentCapabilities.auth.status` 时，在就绪探测里顺带调用 `auth/status`。
  - `requiresAuthentication` 不再等于"`authMethods` 非空"：`authMethods` 只说明这个 agent **支持**哪些登录方式。真实 turn 返回认证错误时，把该 agent 的状态更新为 `signed_out`，与 P4-03"真实 turn 失败反过来更新状态"同一条路径。

### 5.5 "模型来源"取代"凭据方式"

一个 agent 的可用来源由 `definition.credentialModes` 和 Kun provider 推导：

| credentialMode | 在界面上显示为 | 什么时候可选 |
| --- | --- | --- |
| `native-login` | "本机 {agent} 账号"，例如"本机 Claude 账号" | 登录态为 `signed-in`，或为 `unknown`（置灰但允许选，并提示"未能确认已登录"） |
| `kun-gateway` | 每个可经网关暴露的 provider 各一行："{provider} · 经 Kun 网关" | provider 分组里有模型（沿用 `groupsWithModels`） |
| `provider` | "{provider}（Kun 供应商）" | 同上 |

- **一对一对话框**：去掉"凭据方式"下拉。流程变成：选 agent → 模型列表按来源分组（第一组是本机账号，后面每个 provider 一组；沿用 composer 现有的 `ade-cred:` 分组键）→ 选隔离方式。选中哪个模型，就推导出对应的 `credentialMode` 和 `providerId`。
- **composer 胶囊**显示 `agent · 模型`，悬停时补充来源，例如"经 Kun 网关 · DeepSeek"。
- 来源不可用时行内给出原因，并附带打开 5.3 深链的"去设置"。

### 5.6 自定义 ACP 与终端 agent 的表单

- **模板**：从注册表快照选一条，自动填入命令、参数和环境变量，填完仍可以修改。
- **环境变量**：改成逐行的"名称 / 值"编辑器，替代原来的文本框。每行有一个"设为密钥"开关：打开后，这一行的值存进凭据库，行内显示"已保存（已隐藏）"，保存时生成 `secretEnv` 引用。这样就不需要原来那套单独的"密钥名 + 值 + 绑定"控件了（`agent-center-custom-form.tsx:351-377`）。
- **编辑已保存的条目**：id 保持不变；任何字段改动都会让上次的测试失效（沿用 P4-12 的指纹比对）；保存前先展示字段差异，用户确认后才覆盖（参考 1.4 的"填充其他 runtime"）。
- **导入**：支持选择 JSON 文件，也支持粘贴 JSON；导入后同样要先测试。导出保持不变。
- **终端 agent 表单**（新增）：名称、命令（可用文件选择器）、参数、`taskFlag`、`resumeArgs`、`hooks`（`none` / `claude-settings`）。"试运行"会打开一个该 agent 的终端标签；保存后写入 `terminalAgents[]`，并立即出现在终端的"新建 agent 终端"菜单里。

### 5.7 首次引导

`AdeReadinessCard` 的"agent"一项没有就绪的一对一 agent 时，展开成一个小列表：

1. 检测到、差一步就能用的 agent（例如"Codex CLI · 安装适配器"），点击后通过深链直达向导第 2 步。
2. 推荐的内置 agent。
3. "＋ 添加 Agent"。

卡片可以关闭；之后一旦出现就绪的 agent，就清除"已关闭"标记（参考 1.5 的模块级订阅）。

## 6. 实施计划

编号 P5-xx，规模与区域的记法同 [README](./README.md) §3。每个 PR 仍然要满足 README §2.2 的完成标准；**改动界面的 PR 都要跑 `npm run smoke:development-ade` 并附截图**。浅色和深色两种模式都要实现；没能实机看过的模式，要在 PR 里如实写明。

### 阶段 A：数据与运行时

**P5-01 Agent 目录与注册表快照（M，K S D）**
- 新脚本 `scripts/update-acp-registry-snapshot.mjs`：拉取 `registry.json`，只保留 `npx`、`uvx`、`binary` 三类分发和清单字段，写入 `kun/src/harness/acp-registry-snapshot.json`，文件里带上拉取时间和注册表版本。快照随代码评审入库，**运行时不联网**（见 D2）。
- 新契约 `AgentCatalogEntry`（`kun/src/contracts/harness-catalog-entry.ts` 与 `src/shared/ade-harnesses.ts` 各一份）：`id`、`name`、`version`、`description`、`iconSvg?`、`distribution`、`builtinAlias?`、`requires: { npx?, uvx? }`。
- 新接口 `GET /v1/harnesses/catalog`：返回内置定义（附 `setup`）和注册表条目。与内置重复的条目（codex-acp、claude-acp、gemini、opencode、cursor 等）通过 `builtinAlias` 合并为同一行；同时报告本机有没有 `npx` 和 `uvx`（复用 harness-detector 的命令解析）。
- 一致性测试：带 `builtinAlias` 的内置定义，其 `setup.adapter.install` 里的包名必须和快照一致。借此核对 Codex 适配器的包名，实机确认后更正 `builtin-harnesses.ts:317-319`。P6-08 合入后 Codex 不再带 `setup.adapter`，这项测试只约束仍走 ACP 的内置定义。
- 测试：快照的 schema 校验、去重合并、`requires` 探测，以及接口在离线状态下可用。

**P5-02 登录态只看存在性（S，K）**
- 实现 5.4 里"登录态探测"的各条规则。
- 测试：
  - 凭据文件内容损坏时仍判为 `signed-in`（只看存在性）。
  - macOS 的钥匙串探测命令注入假实现来测。
  - `auth/status` 只在 agent 声明了该能力时才调用。
  - `authMethods` 非空但 `auth/status` 返回已登录时，状态为就绪。
  - turn 认证错误会把状态更新为 `signed_out`。

**P5-03 ACP 登录：Terminal Auth 与 agent 登录方式（M，K R M）**
- 握手契约（`kun/src/contracts/harness-test.ts`）补全 `authMethods` 的字段；在 `acp-connection.ts` 里声明 `auth.terminal`。
- 实现 5.4 的两个接口，以及渲染层的"成功才退出"预填和重新检测。
- 安全：生成的命令里，程序只能是解析到的 agent 命令，不接受 agent 另指定的程序；agent 声明的环境变量在界面上完整展示；密钥不回显。
- 测试：用假 agent 夹具返回 terminal 类登录方式，验证生成的命令与环境变量合并规则；验证 `authenticate` 的成功、失败、超时和取消；验证远程连接不声明 `auth.terminal`。

### 阶段 B：界面骨架

**P5-04 Agent 中心改为双栏（L，R）**
- 目录 `src/renderer/src/components/ade/agent-center/`：`AgentCenterLayout.tsx`、`AgentList.tsx`、`AgentDetail.tsx`、`agent-list-groups.ts`（纯函数）。每个文件都不超过 700 行；`AgentCenterCard.tsx` 里的状态和操作逻辑搬进 `AgentDetail` 的头部，`agent-center-actions.ts` 保持不变。
- 左栏拖动写 `agentOrder`；设默认写 `defaultHarnessId`；窄屏退化为两层。
- 自定义 ACP 表单从页底移走，入口改为左栏底部的"＋ 添加 Agent"（向导在 P5-06 完成之前，先直接打开旧表单）。
- 测试：分组纯函数（可用、需要处理、未安装、已停用的判定与排序）；键盘操作拖动排序；冒烟截图。

**P5-05 详情：模型来源、默认值与恢复默认（M，R）**
- 实现 5.2 的各区块和 5.5 的来源推导（纯函数 `agent-sources.ts`，一对一对话框共用）。
- 通用组件 `DefaultOverrideControls`（放在 `settings-controls` 旁边）。
- 测试：来源推导（只支持原生登录、带网关、provider 分组为空等情况）；恢复默认会删键，全部删完时整项删除；设置写入后两次生成的配置逐字节相同（沿用 P4-11 的测试）。

**P5-06 添加 Agent 向导（L，R K）**
- `AddAgentWizard.tsx` 与 `add-agent-catalog.ts`（纯函数：分组、推荐最多 3 条、搜索）；实现 5.3 的三步和深链。
- 测试：推荐排序（参考 Cindy 的 `wizardRecommend.ts` 测试写法）；各类条目第 2 步走对分支；首次启动放宽超时；"仍然完成"。

**P5-07 自定义 ACP 表单 v2（M，R S M K）**
- 实现 5.6 的模板、逐行环境变量编辑器、编辑与差异确认、粘贴导入。
- 设置字段：给 `custom[]` 条目加可选的 `catalog?: { id, version }`，用来记录来源，为以后提示"有新版本"做准备。按 README §2.2 做四层同步，并补"两次生成逐字节相同"的测试。
- 测试：行编辑器与 `env` / `secretEnv` 之间互相转换；打开或关闭"设为密钥"时，凭据库里的记录会正确创建和释放；编辑后原来的测试结果失效。

**P5-08 终端 agent 表单（M，R S）**
- 实现 5.6 的终端 agent 表单，写入 `terminalAgents[]`（字段已在 P4-13 完成四层同步，这里只做界面）。
- 测试：保存后出现在终端菜单里；试运行会打开一个终端标签。

### 阶段 C：使用流程

**P5-09 一对一与 composer：用来源替代凭据方式（M，R）**
- 按 5.5 改造 `AdeOneOnOneDialog.tsx` 和 composer 胶囊。沿用 `ade-cred:` 分组键，所以 turn 请求的字段不变。
- 测试：选中模型推导出正确的 `credentialMode` 和 `providerId`；上次的选择在来源不可用时回退；更新冒烟脚本里对应的断言。

**P5-10 首次引导 v2（S，R）**
- 按 5.7 扩展 `AdeReadinessCard`。
- 测试：检测行的筛选条件；关闭后出现就绪 agent 会自动清除关闭标记。

### 阶段 D：可选项与验收

**P5-11 托管安装（L，K M R，待决策 D1）**
- 只覆盖注册表里的 `binary` 分发和内置的 npm 安装：装进 Kun 自有目录 `<dataDir>/harness-tools/<id>/<version>/`，下载有校验值时做校验，写 `.verified` 标记，界面显示进度（参考 Cindy 的 `LocalOllamaInstall.tsx` 和 `DownloadMeter.tsx`）。安装进程经 `spawnOwnedProcess` 启动，完成后自动写入 `binaryPaths`。
- 动手前需要先修改 `docs/AGENTS.md` 的红线说明，并得到确认。

**P5-12 冒烟扩展与人工验收（M，D M）**
- 扩展 `scripts/smoke-development-ade.cjs`：
  1. 用假 agent 夹具构造一条"注册表条目"，走完向导的三步。
  2. 假 agent 返回 terminal 类登录方式，预填后执行并退出，状态从"需要登录"变为"就绪"。
  3. 详情里修改默认模型，出现"已自定义"，再恢复默认。
  4. 一对一对话框里按来源分组，选网关组里的模型后开启会话。
  5. 在表单里添加一个终端 agent，确认它出现在终端菜单里。
- 人工验收清单：

| 步骤 | 期望 |
| --- | --- |
| 首次进入 ADE，本机只装了 Claude Code 且已登录 | 首页就绪卡直接显示 Claude Code 可用；Agent 中心左栏"可用"组里有它，未安装的内置 agent 收在"未安装"组 |
| "＋ 添加 Agent" → 搜索 "codex" | 只出现一行 Codex（内置与注册表已合并）；副标题写出还差哪一步 |
| 缺适配器的 agent（P6 之前的 Codex）→ 在终端中安装 | 终端预填命令；执行完关闭终端后，向导自动进入下一步 |
| 注册表里的 `npx` agent（例如 Qwen Code） | 显示完整命令和版本；首次握手有"正在下载"提示；成功后出现在左栏 |
| 需要登录的 ACP agent | 点"登录"后终端预填 agent 自己声明的登录命令；登录成功后终端自动退出，状态变为就绪 |
| Claude Code 详情里把默认来源改为"DeepSeek · 经 Kun 网关" | 出现"已自定义"；一对一对话框默认选中该来源下的模型；点 ↺ 后恢复为本机账号 |
| 编辑一个自定义 ACP agent 的参数 | 要重新测试；保存前展示差异 |
| macOS 上探测 Claude 登录态 | 不弹钥匙串授权框；已登录时显示"本机已登录" |

### 顺序

```text
A  P5-01 ─ P5-02 ─ P5-03            （P5-02 可与 P5-01 并行）
B  P5-04 ─ P5-05 ─ P5-06（依赖 P5-01）─ P5-07 ─ P5-08
C  P5-09（依赖 P5-05）─ P5-10（依赖 P5-06）
D  P5-11（待决策）；P5-12 贯穿各阶段，阶段 B 结束时先跑一次
```

最短可见收益：P5-04 → P5-05 → P5-09。只调整信息架构和"来源"概念，不依赖注册表和新接口。

## 7. 待决策

| # | 问题 | 选项 | 建议 |
| --- | --- | --- | --- |
| D1 | 要不要做托管安装（P5-11） | a. 不做，保持预填终端；b. 只对注册表里的 `binary` 条目做；c. 内置 npm 安装也改为托管 | **a**。`npx` / `uvx` 条目本来就不需要安装，内置 agent 的预填流程 P4 已经跑通；等出现真实需求再做 b |
| D2 | 注册表数据怎么来 | a. 随版本附带快照；b. 运行时拉取 CDN；c. 附带快照，另加手动"检查更新" | **a**。离线可用，命令来源可审查；运行时联网相当于让远端决定本机执行什么命令 |
| D3 | 未安装的内置 agent 放在哪 | a. 左栏底部折叠组；b. 完全不在左栏，只在向导里（Cindy 的做法） | **a**。Kun 的内置 agent 多，完全隐藏会让用户以为不支持 |
| D4 | composer 要不要改成 Cindy 那样"模型优先" | a. 不改，仍以 agent 为主，只把来源并进模型分组；b. 改成模型优先 | **a**。ADE 的主语是 agent（一对一、派工），P5-09 已经去掉了"凭据方式"这一层 |

## 8. 不做

- 不在 Kun 里做第三方 CLI 的 OAuth，也不写第三方 CLI 的凭据存储。
- 不让项目文件或注册表自动添加 agent；每条都要用户在向导里确认。
- 不做模型级的"显示 / 停用"开关（Cindy 1.3）：agent 的模型列表来自探测结果，数量少，先只做"默认模型"。确有需要时再单独设计 `harnesses.hiddenModels`。
- Gemini 在 `authMethods` 里声明了 `gateway` 方式（`_meta.gateway.protocol: google`），理论上可以接 Kun 网关，但需要网关支持 Google 协议，不在本计划范围内。
