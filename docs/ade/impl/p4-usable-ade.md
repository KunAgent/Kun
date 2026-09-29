# ADE 可用性修复与 Harness 配置计划（P4）

- 日期：2026-09-29
- 基线：`develop@0c6d83fc2`（P0 ~ P3 已全部合入）
- 背景：后端验收脚本（P3-13）能跑通总管派工和 Claude Code 走网关，但在桌面界面里 ADE 基本不可用：点 agent 选择器没有反应，一对一里的外部 agent 全是灰的，设置改了不生效。本文件先给现场诊断，再给"怎么添加、怎么配置 harness"的设计，最后是按 PR 拆分的修复计划。

## 1. 现场诊断（本机开发实例，2026-09-29）

诊断方式：读取本机开发实例的运行时日志与设置文件，对运行中的 `kun serve` 只做只读请求（`GET /v1/harnesses`），并用编译后的 kun 代码单独复现 ACP 就绪探测。没有修改任何设置。

### 1.1 症状与根因

| # | 用户看到的 | 根因 | 证据 |
| --- | --- | --- | --- |
| 1 | 点 composer 上的"kun ▾"没有任何弹层，只在按钮上方多出一条细灰线 | 弹层是 `absolute bottom-full` 画在按钮所在容器里（`FloatingComposerHarnessPicker.tsx`），而该容器 `.ds-composer-toolbar-actions` 设置了 `overflow: hidden`（`src/renderer/src/styles/base-shell/session-sidebar-shell.css:238-242`），向上弹出的菜单被整个裁掉，只剩阴影边 | 截图里的灰线即弹层底边阴影；同一行的模型选择器用 `createPortal` 渲染，不受影响。隔离方式选择器（`FloatingComposerIsolationPicker.tsx:81`）和子代理选择器（`FloatingComposerAgentPicker.tsx:95`）是同样写法，同样会被裁 |
| 2 | 侧栏"一对一"列表里，除 Kun 外全部灰掉，显示"检测中"或英文原因 | 首次 `GET /v1/harnesses` 时检测才在后台启动，所有外部 harness 都返回 `installed: 'unknown'`；`loadHarnesses()` 在 `rowsLoaded` 之后不再刷新（`src/renderer/src/store/harness-store.ts:58`），侧栏打开时也不强制刷新，于是永远停在第一次的"未知"状态 | 第一次请求：7 个 harness 全是 `unknown`；几秒后第二次请求：真实状态已经就绪 |
| 3 | composer 上的标签是小写的 `kun`，不是 "Kun" | 标签取 `row?.definition.displayName ?? harnessId`，说明 composer 里的 harness 行为空：首次加载失败或尚未加载时没有重试 | 截图 |
| 4 | Gemini CLI 被标为"不可用" | ACP 就绪探测超时 10 秒（`kun/src/harness/acp-readiness-probe.ts` 的 `ACP_READINESS_TIMEOUT_MS`）。Gemini 冷启动慢：用 kun 编译产物单独探测耗时 **8.6 秒**；应用内多个 harness 并行探测时超过 10 秒，被判为 `ready: 'no'`。P3-13 把它记成"本机无可就绪 ACP harness"而跳过，结论有误 | 运行时返回 `ACP initialize failed: ... timed out after 10000ms`；单独复现 `{"ready":"yes"}`，8592 ms |
| 5 | 在设置里改 harness 或 ADE 选项后没有效果 | 设置里 `provider.localGateway.enabled = true`，但本地网关没有独立密钥。运行时热应用时直接拒绝**整份**配置（`kun/src/server/runtime-composition-config.ts:278`），所有设置改动都进不了运行中的 runtime；界面只提示一句笼统的"Kun rejected the updated configuration" | 开发实例日志 01:06–01:07 连续 5 次 `Kun rejected hot config without restart: local model gateway requires an independent API key` |
| 6 | 不可用原因是英文原文，如 `ACP initialize failed: ...`、`not installed` | `harnessRowUnavailableReason` 直接透出运行时 message，只有少数几个固定码做了翻译 | `AdeSidebar.tsx` 直接渲染 reason |
| 7 | ADE 新会话页显示的是 Code 的欢迎语，没有任何"先配置 agent"的引导 | ADE 复用了 Code 的空状态文案，没有就绪检查 | 截图 |
| 8 | 以上问题在合入前都没被发现 | P3-13 只走 HTTP；渲染层测试用 `react-test-renderer`，没有真实布局，发现不了被裁剪；仓库已有 `scripts/smoke-development-*.cjs`（`playwright-core` 的 `_electron`），但 ADE 没有界面冒烟 | — |

### 1.2 本机 harness 实际状态（第二次 `GET /v1/harnesses`）

| harness | 状态 | 说明 |
| --- | --- | --- |
| Kun | 可用 | 内置 |
| Claude Code | 已安装 2.1.281，登录状态未知 | 可选；登录状态探测不出来 |
| Cursor | 已安装，已登录 | 走 provider 的 API key |
| Antigravity | 未安装 | — |
| Gemini CLI | 已安装 0.52.0，就绪 = 否 | 实际可用，被 10 秒超时误判（见 1.1 #4） |
| Codex | 缺 ACP 适配器 | 运行时已给出安装提示：`npm i -g @zed-industries/codex-acp` |
| OpenCode | 已安装 1.1.47，就绪 = 否 | `opencode acp` 启动即崩溃，上游问题 |

## 2. 目标：用户怎样用上 ADE

1. 在 实验室 → ADE 打开开关后，模式切换器出现 ADE。
2. 第一次进入 ADE，首页先做**就绪检查**：总管需要至少一个可用的 Kun provider；一对一需要至少一个就绪的 agent。缺什么就给出对应按钮。
3. 进入 **Agent 中心**，每个 agent 一张卡片，依次完成安装、登录、测试连接，并选好默认的凭据方式、模型和权限。
4. 新建会话有两种：
   - **总管会话**：由 Kun 负责拆分任务和派工。
   - **一对一**：在一个对话框里选好 agent、凭据方式（原生登录，或走 Kun 网关用 Kun 的模型）、模型和隔离方式。
5. 会话进行中，可以在 composer 上切换 agent 和模型，切换时带确定性交接。
6. 在任务总控看进度，在审查面板合入结果。

每一步的失败都要说清楚原因和下一步该做什么，不能只把按钮变灰。

## 3. Harness 的添加与配置（设计）

### 3.1 三类 harness

| 类别 | 例子 | 接入方式 | 用户需要做什么 |
| --- | --- | --- | --- |
| 内置结构化 | Claude Code（Agent SDK）、Cursor（SDK）、Gemini CLI / Codex / OpenCode（ACP） | Kun 负责启动进程，事件结构化，可做总管的 worker | 安装 CLI、登录，或选择走 Kun 网关 |
| 自定义 ACP | 任何支持 Agent Client Protocol 的 agent | 用户填命令与参数，Kun 按 ACP 启动 | 填表并测试连接 |
| 终端 agent | 任何命令行 agent | 在 Kun 终端里以 PTY 运行，状态靠 hooks 与 `kun worker` 回调 | 填命令；可选 hooks |

### 3.2 Agent 中心：统一的配置入口

- **位置**：ADE 侧栏新增"Agent"入口；设置 → Agents → Agent harness 复用同一个组件，两处看到的内容一致。
- **卡片内容**：名称与版本、接入方式、当前状态（中文原因）、支持的凭据方式、默认模型、默认权限档，以及一个主操作按钮（随状态变化）。
- **状态与主操作**：

| 状态 | 判定 | 主操作 | 次操作 |
| --- | --- | --- | --- |
| 检测中 | 首次检测未返回 | 转圈，不可点 | — |
| 未安装 | 找不到命令，或缺适配器 | "安装"：在 Kun 终端里预填安装命令 | "指定命令路径" |
| 已安装、未就绪 | 握手失败或崩溃 | "查看原因"：展示 stderr 摘要 | "重试检测"、"指定命令路径" |
| 探测超时 | 握手超时 | "重试检测" | 允许先用，界面给出提示 |
| 需要登录 | 登录探测为 signed-out | "登录"：在 Kun 终端里运行登录命令 | "改用 Kun 网关"（若支持） |
| 就绪 | — | "测试连接" | "设为默认"、"禁用" |
| 已禁用 | 用户关闭 | "启用" | — |

### 3.3 安装与登录

- harness 定义新增 `setup` 元数据，数据驱动，便于更正：

```ts
setup?: {
  install?: Array<{ platform: 'darwin' | 'linux' | 'win32' | 'any'; command: string; note?: string }>
  login?: { command: string; args: string[]; note?: string }
  docsUrl?: string
  adapter?: { command: string; install: string }   // 例如 Codex 需要单独的 ACP 适配器
}
```

- 初始内容以各 CLI 官方文档为准，实施时逐条核对后再写入。本机运行时已给出的一条是 `npm i -g @zed-industries/codex-acp`（Codex 的 ACP 适配器）。
- 执行方式：点"安装"或"登录"时，打开一个 Kun 终端标签页并**预填**命令，由用户按回车执行，Kun 从不自动执行。终端退出后自动重新检测该 harness。
- 只有内置定义里的命令可以预填；自定义 agent 不提供"安装"按钮。
- 走 ACP 的 agent 如果在 `initialize` 里报告了 `authMethods`，卡片上列出可用的登录方式，但第一版仍然引导用户用终端登录；ACP 的 `authenticate` 请求放到后续再做。

### 3.4 凭据方式

| 方式 | 适用 | 用户要做的 | Kun 做的 |
| --- | --- | --- | --- |
| 原生登录 | 所有内置 harness | 在该 CLI 里登录 | 不注入任何凭据 |
| Kun 网关 | Claude Code，以及 P3-10 已接入的 Codex、OpenCode | 选择一个 Kun provider 和模型 | 每个 turn 签发限定路由的 `kgw_` 令牌，子进程拿不到 provider 的原始密钥 |
| provider | Cursor、Kun 本身 | 在 Kun 的 provider 设置里配置 | 沿用现有逻辑 |

- 走 Kun 网关时，可选的模型只列 Kun 已配置且可用的 provider 模型，按 provider 分组。
- 网关令牌不依赖"本地模型网关（Kun API）"对外开关（`authorizeGateway` 先认 `kgw_`），两者在界面上要分开说明，避免用户以为必须打开对外网关。

### 3.5 测试连接

分三级，逐级执行，每级显示耗时和结果：

1. **检测**：版本号与命令路径。
2. **握手**：ACP `initialize`，或 SDK 的模型列表；展示 agent 名称、版本、能力（MCP 传输、图片输入、会话恢复）。
3. **试运行**（可选，会消耗额度，需要用户点击）：在一个不进入会话列表的临时线程里发一句固定提示，确认流式输出、工具调用和结束事件都正常。

新接口 `POST /v1/harnesses/:id/test`，body 为 `{ level: 'detect' | 'handshake' | 'trial', credentialMode?, providerId?, model? }`。

### 3.6 默认值

新增设置 `agents.kun.harnesses.defaults[harnessId]`：

```ts
{
  credentialMode?: 'native-login' | 'provider' | 'kun-gateway'
  providerId?: string          // 仅 kun-gateway / provider
  model?: string
  permissionMode?: string      // 覆盖现有 defaultPermissionMode[harnessId]，两者合并迁移
  isolation?: 'local' | 'worktree'
}
```

读取方：composer 的 agent 选择器、一对一新建对话框、总管的 worker 选择器（`resolveWorkerRoute` 在没有显式指定时用它）。

### 3.7 添加自定义 ACP agent

- **表单字段**：
  - 名称。
  - 命令（可以用文件选择器）。
  - 参数。
  - 普通环境变量。
  - 密钥：通过**引用** Kun 凭据库传入，形如 `{ name: 'FOO_API_KEY', secretRef: '<credentialId>' }`；表单里不能直接写密钥。
- **先测试再保存**：新接口 `POST /v1/harnesses/probe-definition` 对未保存的定义做一次握手，展示 agent 名称、版本和能力。
  - 握手通过才允许保存。
  - 失败时可以点"仍然保存"，保存后该 agent 标为"未就绪"。
- **导入导出**：单个定义可导出为 JSON，也可以从 JSON 导入；导入后同样要先测试。
- **安全边界不变**：自定义 agent 只能在设置里显式添加，项目文件不能自动注册或启动任何程序。

### 3.8 添加终端 agent

- 新增设置 `agents.kun.harnesses.terminalAgents[]`，每项包含：
  - `id`、`displayName`、`command`、`args`。
  - `taskFlag?`、`resumeArgs?`。
  - `hooks?: 'none' | 'claude-settings'`。
- 在终端面板"新建 agent 终端"的列表里出现。
- 在总管的 `harness_list` 里标为"仅终端"，默认不能被自动派工；派工需要走 `kun worker` 回调，而这要求 agent 愿意照做。

### 3.9 配置的存储与生效

| 设置 | 已有 / 新增 | 作用 |
| --- | --- | --- |
| `harnesses.disabledIds` | 已有 | 禁用内置 harness |
| `harnesses.binaryPaths` | 已有 | 覆盖命令路径 |
| `harnesses.custom` | 已有 | 自定义 ACP agent；新增 `secretEnv` 引用 |
| `harnesses.defaultPermissionMode` | 已有 | 并入 `defaults[*].permissionMode` 并迁移 |
| `harnesses.defaultHarnessId`、`agentOrder` | 已有 | 默认 agent、排序 |
| `harnesses.defaults` | 新增 | 见 3.6 |
| `harnesses.terminalAgents` | 新增 | 见 3.8 |

- **生效方式**：harness 设置的改动必须能热应用，并且不受其他设置项校验失败的影响（见 P4-04）。
- **四层同步照旧**：`src/shared` 规范化 → IPC 严格 schema → 配置生成 → kun 配置 schema 与 sanitize；并保留"两次生成逐字节相同"的测试。

## 4. 实施计划

编号 P4-xx。规模与区域记法同 [README](./README.md) §3；每个 PR 仍须满足 README §2.2 的完成标准，另外**所有改动界面的 PR 都要跑 P4-06 的 ADE 界面冒烟并附截图**。

### 阶段 A：先让现有功能能用（约 2~3 天，最先做）

**P4-01 composer 弹层改为 portal 渲染（S，R）**
- harness、隔离方式、子代理三个选择器改为 `createPortal` 挂到 `document.body`。定位复用模型选择器里的浮层定位函数（`calculateFloatingReasoningPopoverPlacement` 一类），支持向上或向下翻转，并且不超出视口。
- 保留点外部关闭，补上 Esc 关闭和焦点返回。
- **不改** `.ds-composer-toolbar-actions` 的 `overflow: hidden`：它负责窄屏时的收缩，删掉会带来其他布局回归。
- 测试：
  - DOM 测试断言弹层节点不在 `.ds-composer-toolbar-actions` 之内。
  - 用 P4-06 的冒烟脚本，断言弹层中心点 `elementFromPoint` 命中弹层自身。

**P4-02 harness 列表的刷新机制（M，K R）**
- 服务端：`GET /v1/harnesses?wait_ms=3000` 在返回前等待进行中的检测，等待时间有上限；检测中的行带 `detecting: true`，不再冒充 `installed: 'unknown'`。
- 客户端（`harness-store.ts`）：
  - 用 `rowsLoadedAt` 代替只加载一次的 `rowsLoaded`。
  - 打开选择器、打开侧栏一对一、打开 Agent 中心时强制刷新。
  - 只要还有检测中的行，每 2 秒轮询一次，最多 30 秒。
  - 加载失败时按退避重试。
- 检测中的行显示转圈和"检测中"，而不是禁用加一行英文原因。
- 测试：首次返回检测中 → 轮询后变为就绪；加载失败后重试成功；轮询在 30 秒后停止。

**P4-03 ACP 就绪探测放宽并区分结果（S，K）**
- 超时改为 30 秒；同一时刻最多探测 2 个 harness。
- 超时记为 `ready: 'unknown'`（界面显示"探测超时，可重试"，仍允许选择），只有进程崩溃或协议错误才记为 `ready: 'no'`。
- 探测成功的结果按"命令路径 + 版本"缓存 24 小时，写入数据目录，重启后不必重新探测。
- 如果真实 turn 启动失败，反过来更新该 harness 的状态。
- 测试：慢启动（9 秒）的假 agent 判为就绪；卡死的判为超时；崩溃的判为未就绪；缓存命中与失效。
- 验收：本机 Gemini 0.52 在 Agent 中心显示"就绪"。

**P4-04 设置热应用与本地网关解耦（M，M K R）**
- GUI 端：
  - 打开本地网关时，先确保已有独立密钥，没有就生成。
  - 对"已开启但没有密钥"的存量设置做一次迁移：自动生成密钥；生成失败则关闭网关，并提示用户。
- 运行时端：热应用改为**分段处理**。网关一段不合法时，只拒绝网关这一段，其余各段照常应用；返回每一段的结果。
- 界面：设置保存结果要写出具体原因，并给"去修复"按钮，不能再只有一句"Kun rejected the updated configuration"。
- 测试：
  - 网关配置有问题时，修改 harness 命令路径仍然生效。
  - 迁移后的设置热应用成功。
- 验收：本机开发实例改 ADE 或 harness 设置后，日志不再出现拒绝。

**P4-05 状态文案与下一步提示（S，R S）**
- 运行时的 harness 状态增加稳定的原因码，例如：
  - `not_installed`、`adapter_missing`、`handshake_timeout`、`handshake_failed`、`signed_out`、`version_too_low`、`disabled`。
- 渲染层按原因码显示中英文文案，并附下一步操作：
  - 例如"安装 Codex 的 ACP 适配器"、"登录 Claude Code"、"探测超时，重试"。
  - 附带跳转到 Agent 中心对应卡片的链接。
- 原始 message 只放进"查看原因"的详情里。

**P4-06 ADE 界面冒烟脚本（M，D M）**
- 新建 `scripts/smoke-development-ade.cjs`，写法参照现有的 `scripts/smoke-development-rooms.cjs`（`playwright-core` 的 `_electron`），使用隔离的数据目录。脚本步骤：
  1. 打开 ADE 开关，进入 ADE。
  2. 打开 harness 选择器，断言弹层可见且可点击。
  3. 等待检测完成后，打开侧栏一对一，断言已安装的 agent 可选。
  4. 选择 Claude Code，检查模型分组，其中"Kun 网关"组下列出的是 Kun 的 provider 模型。
  5. 打开 Agent 中心，修改一个命令路径，然后通过 `GET /v1/harnesses` 确认运行时已收到改动。
  6. 每一步截图，保存到临时目录。
- 在 `package.json` 增加 `smoke:development-ade`，并写进 ADE 的 PR 检查清单。

### 阶段 B：Agent 中心与配置（约 1 周）

**P4-07 harness 定义的 `setup` 元数据（S，K S）**
- 在 `kun/src/contracts/harness.ts` 与 `src/shared/ade-harnesses.ts` 中加入 3.3 的 `setup` 字段，并补上 schema 校验。
- 内置定义里逐条填入官方安装与登录命令（先实机核对）。
- 测试：schema 校验，以及内置定义的快照。

**P4-08 Agent 中心页面（L，R）**
- 新建 `src/renderer/src/components/ade/AgentCenter.tsx`，以及卡片与表单子组件（每个文件不超过 700 行）。
- ADE 侧栏增加入口，设置 → Agents → Agent harness 改为复用这个组件。
- 实现 3.2 的状态与操作表。
- 视觉规范遵守 12 §2：一页只有一个主按钮，红色只出现在确认对话框里，状态颜色 token 与侧栏、看板一致。

**P4-09 安装与登录走 Kun 终端（M，R M）**
- 复用终端面板的建标签能力，新增"预填命令、不自动执行"的模式；终端退出后调用 `POST /v1/harnesses/:id/probe` 重新检测。
- 只允许预填内置定义里的命令。

**P4-10 测试连接（M，K R）**
- 实现 3.5 的 `POST /v1/harnesses/:id/test`。
- 试运行使用一个不进入会话列表的临时线程，结束后删除；在界面上显示本次消耗的 token 数。
- 测试：三个级别各自的成功与失败路径；临时线程不出现在任何列表里。

**P4-11 每个 harness 的默认值（M，S M K R）**
- 实现 3.6 的 `harnesses.defaults`，走四层同步，并把 `defaultPermissionMode` 迁移进来。
- composer、一对一对话框、总管的 worker 选择三处都读取这份默认值。
- 测试：两次生成的配置逐字节相同；迁移前后行为一致。

**P4-12 自定义 ACP agent：先测试再保存，以及密钥引用（M，K R M）**
- 实现 3.7 的 `POST /v1/harnesses/probe-definition` 和 `secretEnv` 引用；启动子进程时从凭据库解析密钥，日志与界面都不回显密钥。
- 支持导入和导出 JSON。

**P4-13 终端 agent 配置（S，S M R）**
- 实现 3.8 的 `terminalAgents[]`，并接入终端面板的"新建 agent 终端"列表。

### 阶段 C：使用流程（约 3~4 天）

**P4-14 ADE 首页的就绪检查（M，R）**
- 任务总控首页和 ADE 新会话页顶部显示一张就绪清单，检查三项：
  - 总管可用的 Kun provider。
  - 就绪的 agent 数量。
  - Kun 网关是否可用。
- 每一项都带对应按钮。
- 替换 ADE 里沿用的 Code 欢迎语，改为说明"总管会话"和"一对一"的区别，并给出示例任务。

**P4-15 一对一新建对话框（M，R）**
- 用一个对话框替换侧栏里的内联列表：选 agent，再选凭据方式（原生登录，或 Kun 网关加 provider 和模型），再选模型和隔离方式。
- 默认值取自 P4-11；对话框记住上次的选择。

**P4-16 总管会话的首屏（M，R K）**
- 新建总管会话时，右侧默认打开 Workers 面板；composer 上方显示"可派的 agent"标签。
- 结合 P3-16 的评测（10 个任务里 worker 数都是 0），在评测集中增加必须并行才能高效完成的任务，据此调整 P3-14 的总管说明，并按 13 §6 做指标对比。

### 阶段 D：验收

**P4-17 人工验收清单（S，D）**

| 步骤 | 期望 |
| --- | --- |
| 打开 ADE 开关，进入 ADE | 首页显示就绪清单，没有 Code 的欢迎语 |
| 点 composer 上的 agent 选择器 | 弹层完整可见，列出全部 agent，状态与原因为中文 |
| 在 Agent 中心安装 Codex 适配器 | 终端预填命令；执行完成后卡片自动变为"就绪"或"需要登录" |
| Gemini 测试连接 | 握手通过，并显示耗时 |
| Claude Code 选"Kun 网关 + DeepSeek" | 一对一会话能正常回答，用量记在该线程上 |
| 添加一个自定义 ACP agent（可以用仓库里的假 agent 夹具） | 测试通过后才能保存；保存后立即出现在选择器里 |
| 在本地网关配置有问题的情况下修改 harness 设置 | harness 改动生效，网关一项单独报错，并有"去修复"按钮 |
| 总管会话派一个 Kun worker 和一个 Claude Code worker | 任务总控实时更新；完成后总管被唤醒并汇总 |

**"ADE 可用"的门槛**：阶段 A 全部完成；P4-06 冒烟脚本通过（`npm run smoke:development-ade`，需先 `npm run build`）；P4-17 清单全部通过，并把截图附在 PR 里。

### 顺序

```text
A  P4-01 ─ P4-02 ─ P4-03 ─ P4-04 ─ P4-05 ─ P4-06   （P4-01 与 P4-04 可并行，先合）
B  P4-07 ─ P4-08 ─ P4-09 / P4-10 / P4-11 ─ P4-12 ─ P4-13
C  P4-14 ─ P4-15 ─ P4-16（依赖 P4-11）
D  P4-17（贯穿每个阶段，阶段 A 结束时先跑一次）
```

## 5. 修复之前的临时绕过（不改代码）

| 问题 | 临时办法 |
| --- | --- |
| composer 上的 agent 选择器打不开 | 改用侧栏"一对一"选 agent；如果列表里全是灰的，等几秒后重新打开，或重载窗口 |
| 设置改了不生效 | 在设置里关闭"本地模型网关（Kun API）"，或为它生成密钥；也可以改完设置后重启应用，启动时会读取最新配置 |
| Gemini 显示未就绪 | 在 设置 → Agents → Agent harness 里点"重新检测"，机器空闲时通常能在 10 秒内通过 |
| Codex 显示未安装 | 按运行时的提示安装 ACP 适配器：`npm i -g @zed-industries/codex-acp` |
| OpenCode 显示未就绪 | 1.1.47 的 `opencode acp` 本身会崩溃，升级 OpenCode 后再重新检测 |
