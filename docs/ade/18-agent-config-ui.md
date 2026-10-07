# 18 第三方 Agent 配置界面重构

- 日期：2026-10-08
- 基线：`develop@2dd1145a2`（[17 Provider 模块](./17-provider-modules.md) P0-P4 已合入）
- 状态：已实施（U1-U6，见 §9 实施记录；未推送）
- 设计稿（画布，7 个页面 + 2 个组件）：<https://claude.ai/artifact/DsY2hkKqtgFVFQM6WAVafW>
- 设计输入：参考项目（同 17）的 provider 列表、目录和诊断面板；Kun 自己的设置页规则（[desktop-renderer-and-operations §7.6](../design/desktop-renderer-and-operations.md)）和 ADE 界面原则（[12 §2](./12-workbench-ui.md)）。
  源码、文件名、类名、注释、i18n 键里不得出现参考项目的名字。

## 1. 为什么要改

17 把运行时按引擎收口了，但「设置 → 协作与连接 → 第三方 Agent」还是 P4 时期叠出来的界面：每加一种能力就在详情里多叠一个边框盒子。

| 问题 | 现在的代码 | 用户看到的 |
| --- | --- | --- |
| 四种「检查」 | 头部「测试连接」「重试检测」（`agent-center-actions.ts`）、启用面板「检查并启用 / 重新检查」（`AgentEnablementPanel.tsx`）、版本盒子「检查更新」（`AgentUpdateControl.tsx`） | 不知道该点哪个，点完结果出现在不同位置 |
| 同一状态四处显示 | 列表副标题（`AgentCenterCatalog.tsx`）、头部 `statusLine()`（`AgentCenterCard.tsx`）、启用面板状态文字、`HarnessTestBlock` | 经常互相矛盾，例如头部「可用」而面板「需要检查就绪状态」 |
| 详情没有主次 | 安装、启用、版本、命令路径、权限、高级设置依次堆叠；版本盒子常驻 | 长页面，真正要做的一步埋在中间 |
| 凭据方式出现两次 | 头部 `credentialModes` 徽标 + 启用面板的下拉 | 徽标看起来像可点击 |
| 添加流程重复 | 添加弹窗第一步又列一遍内置 Agent；「自定义 ACP」和「导入」打开同一个表单；表单只有占位符 | 内置 Agent 有两条接入路径，自定义表单难填 |
| 列表平铺 | 30 多个 Agent 按名称排序；Kun 自己也在列表里 | 已接入的被几十个未安装的挤走；`agentOrder` 没有任何界面 |
| 检查结果不留存 | 诊断行只在 `gate.result` 里，组件卸载就没了 | 无法回看、无法复制给别人或小 Kun |

## 2. 目标与非目标

目标：

1. 每个 Agent 任意时刻只有一个状态、一个开关「在对话中使用」、最多一个主按钮。
2. 还没接入的 Agent 走三步接入（安装 → 连接方式 → 检查并启用）；接入后用四个标签管理（连接 · 模型 · 启动 · 版本）。
3. 「检查」只有一种免费的「重新检查」；会消耗额度的「试运行一轮」单独放并二次确认。
4. 检查结果常驻、可复制、失败时可交给小 Kun。
5. 「添加 Agent」只负责列表之外的：基于已有 Agent、任意 ACP 命令、导入配置。

非目标：

- 不改 17 的运行时契约，只加 §6 列出的两个小字段。
- 终端 / 应用类集成继续不进这个页面（`orderedAgentCatalog` 现状不变）。
- 不改输入框里的 Agent 控件（模型、权限、P3 通用会话设置）。

## 3. 页面结构

### 3.1 工作区

和「模型供应商」页用同一个工作区（`ds-provider-workspace`，宽 1240）：

```text
┌ 第三方 Agent ─────────── [↻] [+ 添加] ┬ 说明一句 ················ 新对话默认 [Codex ▾] ┐
├ 搜索 Agent                             ┼ 头部：图标 名称 版本 传输 来源        开关 [⋯] │
│ 已接入 3（可拖动排序）                  │ 提示条（只在有下一步时出现）                    │
│   Codex        gpt-5.5 · 原生登录 默认  │ 未接入：接入步骤 ①②③                          │
│   Claude Code  需要重新登录             │ 已接入：[连接][模型][启动][版本]               │
│   CodeMaker    基于 OpenCode · 原生登录 │                                               │
│ 可以接入 5                              │                                               │
│ 未安装 21（默认显示 3 个，其余折叠）     │                                               │
│ 想接入列表里没有的？在扩展里找          │                                               │
└────────────────────────────────────────┴───────────────────────────────────────────────┘
```

- 窄于 `lg` 时列表收成顶部的 Agent 切换按钮（同模型供应商页的紧凑选择），详情单列，所有点击区域不小于 44px（画布 06）。
- 「新对话默认」是页面级设置，选项是 Kun 加上所有「可以使用」的 Agent。Kun 不再作为列表里的一行（它在「助手」页配置）。原「设为默认」按钮和列表里的 Kun 行一并删除。
- 头部「↻」重新检测全部（`loadHarnesses(true)`）；后台检测只在这里转圈，列表保留上次内容，不闪骨架。

### 3.2 列表

- 三组：已接入（`harnessProfileEnabled`）、可以接入（已安装但未启用）、未安装。组内顺序：已接入按 `agentOrder`，其余按名称。
- 已接入组可拖动排序，写 `harnesses.agentOrder`；键盘用 `Alt+↑/↓`。这个顺序就是新建对话和群聊成员选择器里的顺序。
- 未安装组默认只显示前 3 个，「显示其余 N 个」展开；搜索时三组一起过滤，命中的未安装项自动展开。
- 每行：图标（右下角状态点）、名称、来源标记（见 §4.3）、一行副标题。副标题、点的颜色只来自 §4 的状态函数。

### 3.3 详情头部

- 图标、名称、版本（等宽）、传输标记、来源标记、「新对话默认」标记。
- 状态行：点 + 一句话，来自 §4。
- 右侧：开关「在对话中使用」+「更多」菜单（重新检测、复制诊断信息、打开文档、导出配置*、删除此 Agent…*；* 只对自己添加的 Agent）。删除只在确认框里用红色（12 §2「红色只在确认里」）。
- 提示条：状态有下一步时出现在头部下方，带唯一的主按钮（画布 02）。没有下一步时不占位。

### 3.4 接入步骤（未接入时）

画布 03、04。

1. **安装**：已找到就打勾并显示版本和路径，附「不是这个？指定命令路径」（展开一个输入框，写 `providers[id].command`）。没找到时显示一键安装（复用 `AgentInstallControl` 的任务、日志、取消、失败后「让小 Kun 处理」），没有安装方式时只给「官方安装说明」和「指定命令路径」。
2. **连接方式**：三张单选卡（原生登录 / 模型供应商 / Kun 网关，只显示 `credentialModes` 里有的），下面按选择出现账号、供应商或网关路由，以及默认模型。原生模式的模型列表要等检查通过才有，所以这里先是「Agent 默认」。
3. **检查并启用**：主按钮；运行中显示三个阶段（保存配置并同步 → 检查安装、登录和协议 → 确认启用）和「取消检查」。成功后整块收起成「已接入」卡片，保留检查结果，并给「在新对话里试试」。

开关和第 ③ 步是同一个动作（`useAgentEnablement().enable()`）：从关打开就跑检查，失败时开关弹回，原因留在检查结果里。

### 3.5 管理标签（已接入时）

用 `SettingsSubTabs`，四个标签，不嵌套第二行。

**连接**（画布 01）

- 「连接方式」单选卡 + 账号 / 供应商 / 网关路由 + 默认模型 + 默认权限（`permissionFollowsKunLevel` 时只读显示「跟随 Kun」）。
- 改动先是草稿：出现提示「连接方式已修改，重新检查通过后新的对话轮次才会使用它」和「重新检查」按钮。草稿不写 `defaults`；点「重新检查」时一次性保存并启用新 route，成功后替换旧 route，失败或取消就丢弃草稿、旧 route 继续有效（见 §5.2）。
- 「检查结果」卡片常驻：七行诊断（配置、命令、版本、网络、凭据、会话握手、模型；ok / warn / error / 跳过），「上次检查 时间」，「复制诊断信息」「重新检查」。底部一行「试运行一轮…」（点了先确认会消耗额度）。有 error 时底部换成「让小 Kun 处理」。

**模型**

- 「可用模型」：来源一句话（来自 Agent / 供应商 / 网关，版本，更新时间，复用 `AgentModelCatalogFooter` 的 `catalogStatus` 文案），搜索、刷新。
- 每行：模型 ID、推理档位（`modelInfo`）、「默认」标记或「设为默认」。
- 底部「列表里没有？直接用模型 ID」+「使用」（沿用 `AgentSettingsModelPicker` 的手动输入）。

**启动**

- 命令路径（自动检测结果做占位符，「选择…」）、附加参数、环境变量（键值表；「添加敏感值」存系统钥匙串，表里只显示「已存入钥匙串」）、网络（原 `networkSource` 行）。
- 「实际启动命令」只读预览：环境变量名 + 命令 + 参数，敏感值显示为 `•••••`，可复制。
- 扩展声明的 Agent：整页只读，顶部一句「由扩展「名称」管理」和跳转扩展页的链接。
- 内置 Agent 可以编辑附加参数和环境变量（17 §4.3 已支持）；派生 / 自定义 Agent 还能改名称。

**版本**

- 当前版本（大号等宽）、安装来源和路径。
- 有新版本时一块浅蓝区域：「更新到 x」（这一页唯一的主按钮）、「忽略此版本」。标签上一个小圆点。
- 检查更新、改用 Kun 管理的安装、更新记录与日志（含回滚）各一行。逻辑全部沿用 `AgentUpdateControl`，只换布局。

### 3.6 添加 Agent

画布 05，两步弹窗：

1. 选择方式：基于已有 Agent（派生，17 §4.4）/ 任意 ACP Agent / 导入配置文件。说明文字告诉用户内置 Agent 直接在列表里接入。
2. 填写并测试：有标签的表单（基于、名称 + 自动 ID、命令、附加参数、环境变量键值表、将运行预览），「测试连接」通过后「添加」才可点；测试失败可以「仍然添加」。

添加成功后关闭弹窗、列表选中新 Agent，进入 §3.4 的第 ③ 步。原三步向导（`choose / connect / finish`）里列内置 Agent 的那一步删掉。表单逻辑（指纹、探测、密钥绑定、导入导出）沿用 `agent-center-custom-form.tsx`，只重做布局。

## 4. 状态模型

### 4.1 单一来源

新增纯函数 `agentPresentation(row, settings, ctx)`，取代 `agentCardModel`、`statusLine()`、列表里的副标题拼接和启用面板的状态文字：

```ts
type AgentPresentation = {
  group: 'connected' | 'available' | 'notInstalled'
  tone: 'success' | 'warning' | 'muted' | 'running'
  listLine: string          // i18n key + params
  statusLine: string
  switch: 'on' | 'off' | 'busy' | 'locked'
  mode: 'setup' | 'manage'
  next: AgentNextAction | null   // 唯一主按钮
  notice?: 'signedOut' | 'needsRecheck' | 'connectFailed' | 'installFailed'
}
```

`ctx` 带上安装任务、启用 gate、更新状态和连接草稿。列表、头部、开关、提示条只渲染它的结果。

### 4.2 状态表

| 状态 | 来源 | 列表副标题 | 开关 | 下一步 |
| --- | --- | --- | --- | --- |
| 检测中 | `status.detecting` | 保留上次内容 | locked | 无 |
| 未安装 | `not_installed` | 未安装 · 可一键安装 / 查看安装说明 | locked | 一键安装 / 官方安装说明 |
| 安装中 | 安装任务 running / verifying | 正在安装… 用时 | locked | 取消安装 |
| 安装失败 | 安装任务 failed | 安装失败 | locked | 重新安装（+ 让小 Kun 处理） |
| 版本过低 | `version_too_low` | 版本过低 | off | 更新到 x |
| 缺少适配器 | `adapter_missing` | 缺少 ACP 适配器 | off | 安装适配器 |
| 已安装 · 未接入 | 未启用 | 已安装 · 未接入 | off | 检查并启用 |
| 检查中 | gate.checking | 正在检查… | busy | 取消检查 |
| 可以使用 | 就绪 | 默认模型 · 连接方式 | on | 无 |
| 需要重新检查 | 连接 / 启动草稿，或 `readiness_required` | 需要重新检查 | on | 重新检查 |
| 账号已登出 | `signed_out` | 需要重新登录 | on | 在终端登录 |
| 连接失败 | `handshake_failed` / `handshake_timeout` / 配置无效 | 连接失败 | on | 重新检查 |
| 有新版本 | 更新状态 available | 不变 | on | 无（版本标签小圆点） |

已接入的 Agent 出问题时开关保持打开，Kun 不自动停用它。用户关掉开关后回到「已安装 · 未接入」：设置保留，再打开就重新检查（关闭只移除这条连接方式的启用记录，没有单独的「已停用」状态）。

### 4.3 来源标记

- 内置：不显示。
- 派生（`definition.derivedFrom`）：「基于 OpenCode」。
- 通用 ACP（`providers[id].extends === 'acp'`）：「自定义 ACP」。
- 扩展（`definition.extension`）：「来自扩展「名称」」，启动设置只读。

## 5. 交互细节

### 5.1 开关

- 关 → 开：`gate.enable()`；`busy` 期间可「取消检查」；失败弹回 off，错误进检查结果，不弹窗。
- 开 → 关：`gate.disable()`，不确认；配置保留，再打开即重新检查。
- `locked`：不可点，`aria-disabled` 并说明原因（「安装完成后可用」）。

### 5.2 连接草稿

之前 `AgentEnablementPanel.change()` 直接写 `defaults[id]`，改一下下拉就让当前连接失效。现在：

- Agent 还没打开时（接入步骤），连接方式、账号 / 供应商 / 路由、默认模型的改动立即保存，同时取消正在进行的检查。
- Agent 已打开时，这些改动先存成草稿（`useAgentEnablement({ draft })`）：界面显示「设置已修改，需要重新检查」，开关保持打开，已保存的连接不动。
- 「重新检查」把检查对准草稿；检查开始时才把草稿写进 `defaults`（与其他设置一样等待运行时同步），通过后启用新连接并清掉草稿。检查失败、取消，或又改了草稿，都会把这个 Agent 的 `defaults` 写回原样，草稿保留供再试；写回后重新读取目录，运行时会自动重新握手，旧连接随之恢复。
- 开关关闭的永远是已保存的连接，并丢弃草稿。
- 启动设置（命令、参数、环境变量）仍是失焦即保存；保存后运行时让该 Agent 的就绪证明失效，状态变为「需要重新检查」。

### 5.3 复制诊断信息

纯文本：Agent 名称与 id、版本、传输、连接方式、七行诊断、命令路径、附加参数、环境变量**名**（不含值）、平台、检查时间。不读取、不输出任何凭据或环境变量值。

### 5.4 让小 Kun 处理

复用 `AgentSetupHelpButton`，`operation` 增加 `readiness`：带上复制诊断信息的文本和失败项详情。

## 6. 契约增量

1. `GET /v1/harnesses` 每行的 `readyProfiles[]` 多一个可选 `readiness`：取得该就绪证明的那次检查结果（含逐项诊断），运行时已经持有，只是之前没有带出。界面重新打开页面后能直接显示上次通过的检查，不必重新检查。只有通过的检查才有证明；失败的检查结果保存在渲染层的活动 store（`agent-center-activity-store`），页面关闭后清掉。`agent-last-check.ts` 按时间取同一连接最新的一条，不显示别的连接的结果。
2. `AgentSetupIssue.operation` 加 `'readiness'`（只在渲染层，`agent-setup-help.ts`）。
3. `withAgentLaunchPatch` 支持 `secretEnv`（共享层）：内置 Agent 的敏感环境变量走 `providers[id].secretEnv`，设置里只存凭据库引用。

其余全部是渲染层改动，设置结构不变（`agentOrder`、`defaults`、`enabledProfiles`、`providers` 都已存在）。

## 7. 组件拆分（实际落地）

| 模块 | 取代 / 作用 |
| --- | --- |
| `agent-center-presentation.ts`（§4） | 取代卡片动作表、`statusLine()`、列表副标题；`agentPresentationFor` 是列表和详情共用的入口 |
| `agent-center-activity-store.ts`、`use-agent-install-watch.ts` | 列表和详情共享的在途状态：检查中、未保存的连接草稿、已观察到的安装任务、最近一次检查结果 |
| `agent-center-catalog.ts`、`AgentCenterRail.tsx` | 分组、折叠、拖动 / Alt+↑↓ 排序、搜索；取代 `AgentCenterCatalog.tsx` |
| `AgentCenter.tsx` | 工作区外壳：页头（摘要、新对话默认、重新检测、添加）+ 列表 + 详情 |
| `AgentDetail.tsx`、`AgentDetailHeader.tsx` | 一个 Agent 的页面：头部、开关、「更多」菜单、检查进度条、提示条；取代 `AgentCenterCard.tsx` |
| `AgentSetupSteps.tsx` | 未接入时的三步（安装 / 连接方式 / 检查并启用） |
| `AgentConnectionFields.tsx`、`AgentConnectionTab.tsx`、`AgentDraftBar.tsx` | 连接方式卡片、账号 / 供应商 / 路由、默认模型；已接入时的草稿提示；取代 `AgentEnablementPanel.tsx` |
| `AgentDiagnosticsCard.tsx`、`agent-diagnostics-text.ts`、`agent-last-check.ts` | 常驻检查结果、复制诊断、试运行确认、交给小 Kun；取代 `HarnessTestBlock` |
| `AgentModelsTab.tsx` | 可用模型列表、设为默认、手填模型 ID |
| `AgentLaunchTab.tsx`、`AgentEnvTable.tsx`、`AgentCommandPathField.tsx`、`agent-launch-preview.ts` | 命令路径、附加参数、环境变量表（含敏感值）、实际启动命令预览；取代 `AgentLaunchOverrideFields.tsx` |
| `AgentVersionTab.tsx` + `AgentUpdateControl.tsx` | 版本页；更新流程逻辑不变，只重做布局 |
| `AgentAddDialog.tsx`、`agent-center-custom-form.tsx`、`agent-center-custom-entry.ts` | 两步添加弹窗；自定义表单加上标签、模式和命令预览；纯函数（解析、导入导出）拆到 `-entry.ts`；取代 `agent-center-add-wizard.tsx` |

删除：`AgentCenterCard.tsx`、`AgentEnablementPanel.tsx`、`AgentCenterCatalog.tsx`、`AgentLaunchOverrideFields.tsx`、`agent-center-add-wizard.tsx`、`agentCardModel`、`HarnessTestBlock`、列表里的 Kun 行、添加向导的内置列表步骤、「测试连接」「重试检测」「设为默认」按钮。每个文件不超过 700 行。

## 8. 测试与冒烟

- `agent-center-presentation.test.ts`：§4.2 每一行一个用例，外加「出问题时开关保持 on」「用户自己定义的 Agent 不给内置安装命令」「Kun 一直就绪」。
- `use-agent-enablement.test.ts`：草稿只在检查开始时写入；失败、取消、被新一次检查替换都写回原样；开关关闭的是已保存的连接。
- `AgentDetail.test.ts`、`AgentCenterRail.test.ts`、`AgentConnectionFields.test.ts`、`AgentEnvTable.test.ts`、`AgentAddDialog.test.ts`、`agent-center-catalog.test.ts`：开关锁定 / 忙 / 开、登出提示条和登录命令、草稿栏、试运行二次确认、证明里带的检查结果、启动命令里敏感值被遮住、环境变量失焦保存与校验、敏感值只存引用、三种添加方式、草稿恢复不含敏感值、折叠与排序。
- `agent-center-locale.test.ts`：每个 Agent 中心文案在 en / zh 都是字符串（一个键既当标签又当分组会被悄悄变成对象，这个测试和 `i18n-usage.test.ts` 的严格文件清单一起拦住它）。其余五种语言按英文兜底，待翻译。
- 冒烟脚本：
  - `smoke-agent-enablement.mjs`（含 `agent-enablement-smoke.test.mjs` 的静态断言）：开关带 `data-agent-enable`，「检查并启用」按钮带 `data-agent-enable-step`；连接方式是 `data-agent-profile-mode-option` 单选卡；已接入的 Agent 改默认模型后先是草稿，点 `data-agent-draft-check` 才保存。
  - `smoke-development-ade-flow.cjs`：添加流程改为两步；命令路径在「启动」标签里失焦保存；原「在终端准备安装」改为接入步骤里的 `data-agent-setup-terminal`。该脚本需要完整开发构建，这次只按选择器更新，没有运行。
  - `smoke-rooms-harness-controls.cjs`：就绪证明多了 `readiness`，比较前剔除。
- 仍待人工或后续冒烟：`smoke-settings-ui.mjs --quick`（页面数没变）、`--coding-agent-only`（接入一个 Agent 后在新对话里选到并跑一轮）。

## 9. 实施记录

| 阶段 | 内容 | 与计划的差异 |
| --- | --- | --- |
| U1 状态模型 | `agentPresentation` + 测试，列表和详情头部先改用它 | 「已停用」并入「已安装 · 未接入」：关闭开关只移除这条连接的启用记录，没有单独的停用状态 |
| U2 列表与外壳 | 三组、折叠、拖动排序、搜索、新对话默认、移出 Kun；提供商页和 Agent 页共用宽工作区布局 | 顺带修了两个原本就红的测试（自定义 ACP 添加流程、harness 默认值刷新范围） |
| U3 详情框架 | 头部、开关、更多菜单、提示条、三步接入、连接 / 模型标签、连接草稿、常驻检查结果 | 计划里的模型标签提前到这一步；草稿的写回语义见 §5.2 |
| U4 启动 / 版本 / 检查历史 | 环境变量表（含敏感值）、实际启动命令预览、版本页重做、`readyProfiles[].readiness` | 契约从计划的 `lastReadiness` 改为复用已有的就绪证明（§6） |
| U5 添加弹窗 | 两步添加；内置 Agent 不再走弹窗；表单加标签与预览 | 保留「改在终端里安装」和「管理模型供应商」两个入口，避免丢掉一键安装不可用时的退路 |
| U6 清理 | 删除旧卡片模型和未用的部件，补测试 | 其余五种语言的文案先用英文兜底；`adeSettings.agentState_*` 等不再使用的旧文案未删 |
| 复查修复 | 见下 | — |

复查后修复（2026-10-08）：

- 已接入的 Agent 在后台重新检测时，开关不再闪成关、页面不再从标签页跳回接入步骤；有效的就绪证明优先于检测中状态。
- 检查进行中离开页面或切到别的 Agent，已写入的草稿会写回原样（之前只有取消和失败会写回）。
- 接入步骤和「连接」标签都提供「在终端登录」：原卡片上的登录入口在第一版里只剩登出提示条，首次接入需要先登录的 Agent 没有入口。
- 搜索时不允许拖动排序（过滤后的列表无法正确放置被隐藏的 Agent）；折叠按钮移出 listbox；拖动时只在落点变化时重绘。
- 通过 SDK 运行的 Agent（Claude Code、Cursor、Antigravity）不再显示无效的附加参数和环境变量，改为说明。
- 「安装」步骤：版本过低不再标记为完成，检测中不再显示「没找到命令」和安装按钮。
- 有未保存的连接改动时隐藏「试运行」（它会用已保存的连接跑）。
- 删除自己添加的 Agent 时一并清掉 `defaults`、启用记录、排序、默认 Agent 指向，并释放它在钥匙串里的敏感值。
- 窄窗口（< lg）用顶部的 Agent 选择器代替列表，补上 §3.1 里写了但第一版没做的部分。
- `smoke-development-agent-install.cjs`、`smoke-development-ade-visuals.cjs` 改用新控件（这两个脚本需要完整开发构建，未运行）。

每步单独合入 `develop`；U1 之后任何一步出问题都能回退到上一阶段，不会出现两套状态并存。
