# 12 工作台 UI：Mission Control、轨道、一对一、通知

- 阶段：P1（Mission Control、Workers 轨道、agent 选择、通知）；P2（弹出窗口、手机端完整操作）
- 依赖：01、02、06、09、10、11
- 参考：多 agent 控制台的视觉与交互原则（仅作设计输入，命名与样式按 Kun 自己的体系）

## 1. 目标

1. 一眼看清所有 agent 在做什么、哪些在等我、哪些可以审查。
2. 一对一和总管模式共用同一个工作台，切换无需学新界面。
3. 界面安静：视觉只服务两件事——"对这个采取行动"和"理解这个"。

## 2. 设计原则（ADE 界面的约束；实施时补进 `docs/design/desktop-renderer-and-operations.md` 的渲染章节）

| 原则 | 具体规则 |
| --- | --- |
| 复用优先 | 在三处以上出现的语义元素必须是共享组件：状态徽标、状态点、行、卡片、确认对话框、下拉菜单。新增前先查 `src/renderer/src/components/` 里有没有 |
| 层级靠字重和颜色 | 大部分文字同一字号；主行用前景色，次行用弱化色；只有"命名一个区域或分组"的文字用中等字重 |
| 一个主按钮 | 每个界面最多一个强调色填充按钮；审查面板的主操作按状态只显示一个（11 §7.1） |
| 红色只在确认里 | 页面上的删除 / 丢弃是描边按钮；红色只出现在确认对话框里 |
| 状态变化不引起布局跳动 | 徽标、计数、预览行预留空间；骨架、加载、内容占同一个盒子 |
| 每种状态信号只有一个 token | 成功、危险、警告、运行中各一个；PR 状态、CI、diff 统计、状态徽标共用。状态点单独一组更饱和的 token（点太小，同饱和度会显得比旁边文字还暗） |
| 身份色与状态色分开 | agent / 项目的身份色来自固定的 10 色表，只表示"是谁"，不表示状态 |
| 状态出现在最小的作用范围 | 字段错误在字段下；页面错误是横幅；阻断流程的错误才弹窗 |
| 紧凑优先 | 先设计窄布局（也服务手机远程），宽布局只是在外面加框架 |

Kun 既有约束同时适用：

- 颜色 token 来自 Kun 吉祥物调色板（`#3b82d8` / `#6fb0e8` 一系），新增状态 token 在现有主题文件里按同一方法生成，并同时定义亮 / 暗两套。
- 不要对 CSS 变量 token 使用 Tailwind 的 `/NN` 透明度修饰（会静默丢掉规则）；浮层、菜单的不透明背景用内联 `var(--ds-surface-elevated)` 或已验证可生成的类，不用 `bg-ds-surface*` 这一族类（该族类在本项目不生成 CSS）。
- 文案：句首大写（英文）、按钮用祈使动词、行标题不加句号、加载中用"…"。
- 源码、类名、文件名、i18n 键不出现参考产品名。

## 3. 状态的视觉映射

`src/renderer/src/components/activity/activity-glyph.ts`（唯一映射，所有地方调用它）：

| ActivityStore（06） | 展示分组 | 图标 / 点 | token |
| --- | --- | --- | --- |
| working / initializing | 进行中 | 旋转指示 | running |
| waiting（approval / user_input / question / terminal_prompt） | 待你处理 | 琥珀色问号 | warning |
| failed | 待你处理 | 红点 | danger |
| done + 可审查 | 待审查 | 绿色对勾 | success |
| done（不可审查的普通会话） | 已完成 | 绿点 | success |
| idle / closed | 空闲 | 灰点 | muted |
| stalled 标记 | 在原分组内加"可能卡住"提示 | 小时钟 | warning |

分组逻辑只来自 `src/shared/activity-display.ts` 的 `displayBucket()`（06 §10），UI 不自己判断。

## 4. 信息架构

```text
┌ 左侧栏 ─────────────┬ 中间 ─────────────────────────┬ 右侧面板（标签） ──────────┐
│ 新建会话             │ 会话头：标题 · agent · 分支     │ Workers（总管线程）         │
│ Mission Control (3) │                                │ 审查（任务工作区）          │
│ 历史                 │ 时间线                          │ 改动 / 终端 / 浏览器 / 文件 │
│ ─────────────        │                                │                             │
│ 分组：按项目 | 按状态 │ ── 轨道：Workers 3 · 待办 6/6 · 改动 +1.9k −684 ──          │
│  待你处理            │ ┌ composer ───────────────────┐│                             │
│   · 登录修复  ?      │ │ 输入…                         ││                             │
│  进行中              │ │ [agent▾][模型▾][强度▾][权限]  ││                             │
│   · 接口超时  ◌      │ └───────────────────────────────┘│                             │
│  待审查              │                                │                             │
│   · 样式调整  ✓ #42  │                                │                             │
└─────────────────────┴────────────────────────────────┴─────────────────────────────┘
```

### 4.1 左侧栏

- 新增导航行：Mission Control（带"待你处理"计数）。
- 会话列表的分组方式：**按项目**（现状）或**按状态**（新增，待你处理 / 进行中 / 待审查 / 已完成）。设置保存在现有侧栏显示偏好里。
- 行的结构：主行 = 标题；次行（元信息行）= agent 图标 + 分支或工作区徽标 + diff 统计（`+84 −12`，用状态 token 着色）+ PR 号与 CI 状态（有时）+ 相对时间。次行元素按"有才显示、占位不跳动"排布。
- worker 线程默认不出现在列表里，出现在总管线程的展开项里（行首缩进），与现有侧边线程一致。

### 4.2 右侧面板

新增两个内置面板 id（`src/renderer/src/extensions/contribution-ids.ts`）：

- `builtin:right-panel-workers`：总管线程的 worker 列表（§6）。
- `builtin:right-panel-review`：任务工作区的审查面板（11）。

`LEGACY_RIGHT_PANEL_IDS` 不需要改；布局持久化沿用现有机制。

## 5. Mission Control

路由：新增 `AppRoute` `'mission-control'`（与现有 `'subagents'` 等路由同一机制），全宽页面；P2 支持弹出到独立窗口（主进程新建 `BrowserWindow`，加载同一路由）。

### 5.1 看板

| 列 | 内容 | 默认 |
| --- | --- | --- |
| 待你处理 | waiting、failed | 显示 |
| 进行中 | working、initializing | 显示 |
| 待审查 | done 且有改动 | 显示 |
| 已完成 | done 且无改动 | 显示 |
| 空闲 | idle、closed | 隐藏，看板设置里可打开 |

卡片（`MissionCard.tsx`）：

- 头部：agent 图标、标题（会话名或 worker 标签）、状态图标。
- 预览行：`progressNote` 优先，其次 `lastMessagePreview`；等待时显示等待原因（"等待审批：rm -rf dist" / "问题：是否同时修改暗色主题？"）。
- 底部：项目名、分支、diff 统计、验收徽标（10 §4.3）、相对时间。
- 着色：只有"待你处理"（琥珀）和"待审查"（绿）两列的卡片有底色提示，其余中性——有颜色就代表需要看。
- 总管卡片可展开 worker 子卡片。
- 点击：打开对应线程（worker 打开 worker 线程）；"待你处理"卡片上直接放"去审批" / "回答"按钮，回答问题可以在卡片里完成（调用 09 §6.4 的接口，以用户身份回答时写 `answeredBy: 'user'`）。

### 5.2 工具栏

搜索（标题、项目、agent）、筛选（项目、agent、验收状态、PR 状态）、清除筛选；结果计数只在有筛选时显示。

### 5.3 数据

- `src/renderer/src/store/activity-store.ts`（06 §12）：启动时拉快照，之后通过主进程转发的长轮询增量更新。
- 卡片的 diff 统计、PR 状态来自 team / dispatch 接口（`/v1/teams/*`），按需懒加载，加载前预留占位。

## 6. 总管线程

### 6.1 Workers 轨道与面板

- composer 上方的轨道区显示胶囊：`Workers 3`（运行中数量；有等待时变为琥珀色 `Workers · 1 待回答`）、`待办 6/6`（现有 todo）、`改动 +1.9k −684`（打开审查面板或改动面板）。胶囊悬浮在时间线底部，不占用时间线高度。
- 点击 `Workers` 打开右侧 Workers 面板：每行 = worker 标签 + agent 图标与模型 + 状态图标 + 进度说明 + diff 统计 + 验收徽标；行上操作：打开、回答问题（内联）、停止、释放（确认）。
- 面板顶部：team 汇总（运行中 / 等待 / 完成 / 失败计数、合计用量）。

### 6.2 时间线里的派活与通知

- `worker_create` / `worker_send` 的工具卡片沿用现有子代理调用卡片（`SubagentCallCard`）的形态：5 种状态、动画、点击进入 worker 线程；增加 agent 图标与工作区徽标。
- 宿主唤醒总管的那一轮，时间线顶部显示"worker 更新"卡片（结构化列出完成、失败、提问），不显示为用户消息。

### 6.3 worker 线程

- 顶部横幅：「由总管管理 · 接管」或「你正在接管 · 交还给总管」（09 §9）。
- 第一条是"来自总管的任务"卡片（折叠显示任务标题，展开看全文）。
- 交接简报的标记（08 §4）：「已交接上下文（最近 4 轮、2 个文件）」，可展开查看。

## 7. 一对一

### 7.1 新建会话

"新建会话"支持选择：

- 项目（现有）
- **Agent**：harness 选择器（§7.2）
- **隔离**：本地（默认）/ 新 worktree（07；只在 git 项目可选）
- 起点（选了新 worktree 时）：默认分支 / 当前 HEAD / 其它分支

选"新 worktree"后，创建在后台进行：会话立刻打开，时间线顶部显示工作区准备进度（解析起点 → 创建 → 共享目录 → 安装依赖），就绪前 composer 可以输入但发送会排队；失败时显示错误和"重试"按钮。setup 命令待批准时，左侧栏出现一个提示条（跨页面的提示用侧栏提示条，页面内的用页面横幅）。

### 7.2 composer 的 agent 控件

- 位置：composer 底部控件行最左侧，依次为 **agent ▾ · 模型 ▾ · 推理强度 ▾ · 权限图标**。
- agent 选择器：列出 harness，每项显示图标、名称、版本；不可用的项置灰，悬停显示原因（未安装 / 未登录 / 版本过低 / 能力不足，文案来自 `CapabilityStatus.message`）；底部"管理 agent…"跳到设置。
- 模型选择器：按当前 harness 列出模型（01 §9 的 models 接口）；harness 支持的 `credentialMode` 多于一种时，模型按来源分组（"订阅" / "经 Kun 网关"）。
- 会话进行中切换 agent 或模型：弹出确认说明"将为该 agent 开一个新的原生会话，上下文会以交接简报带过去"（08 §8）。
- 推理强度、权限控件按能力显示（02 §6.2）。
- 斜杠菜单：Kun 命令之外，追加当前 harness 上报的原生命令（03 §7.3），分节显示并标注 agent 名。

### 7.3 运行中发送

- harness 支持插话（`sameTurnSteer`）：Enter = 排队，另有"发送并插话"。
- 不支持：只有排队；排队的消息显示在 composer 内部的排队条里，可编辑、撤回。

## 8. 通知与收件箱

- 统一收件箱 = Mission Control 的"待你处理"列 + 顶部铃铛（计数 = 待你处理的行数）。
- 主进程订阅 ActivityStore 的变化（和 renderer 同一个长轮询源），在以下转移时发桌面通知：`→ waiting`、`→ failed`、`→ done`（worker 或任务工作区会话）、`stalled` 被标记。窗口在前台且该会话正显示时不发。
- macOS Dock 角标 = 待你处理计数；Windows / Linux 用任务栏闪烁（可在设置关闭）。
- 设置 → 通知：按类别开关（等待、失败、完成、可能卡住），可选提示音。
- 已读 / 忽略写回 ActivityStore（跨端一致，06 §9）；通知点击后跳到对应会话并标记已读。
- 可选：有 agent 在工作时阻止系统休眠（Electron `powerSaveBlocker`，设置里开关，默认关）。

## 9. 设置页

| 分组 | 内容 |
| --- | --- |
| Agents | harness 列表（检测结果、登录、默认权限档、命令路径、启用开关）；自定义 ACP agent；agent 优先级顺序（10 §3.2）；worker profile 的 agent 与模型 |
| 工作区 | 默认隔离方式；用户级共享路径；setup / checks 命令批准记录；待复核分支清理（11 §7.3） |
| 总管 | 开关（`agents.kun.ade.enabled`）；总管模型；worker 数量上限；预算；`managerMayApprove`；`allowUnattendedFullAccess`；休眠阈值；卡住阈值 |
| 通知 | §8 |

设置行的规范：导航型行末尾放箭头；行内操作放在末尾的"更多"菜单里（悬停显示，触屏常显）；开关与分段控件也放在行末尾；解释性文字用分组标题旁的信息图标或行内提示，不在标题与卡片之间放一段说明文字。

## 10. 手机远程

- 复用 ActivityStore 投影：按状态分组的列表 + 卡片详情。
- 可操作：审批、回答问题、发送审查批注（11 §4.4）、确认已读 / 忽略、停止 worker。
- 不在手机上做：创建 worktree、合入、丢弃（这些需要看 diff，留在桌面）。
- 远程桥白名单（`src/main/remote/remote-allowlist.ts`）只加这些路由；新增的字段都是可选字段，旧版手机端忽略即可。

## 11. 验证

- 组件测试（vitest）：`activity-glyph`、看板分组、卡片预留空间（加载前后尺寸不变）、agent 选择器置灰原因、Workers 面板操作。
- 在开发版应用里用浏览器预览工具验证：亮 / 暗主题、窄窗口（≤ 800px）不出现横向滚动、弹出层背景不透明。
- 视觉走查清单：每页最多一个主按钮；红色只出现在确认对话框；状态 token 在侧栏、看板、审查面板里一致。

## 12. 文件清单

新增：

- `src/renderer/src/components/activity/activity-glyph.ts`、`StatusBadge.tsx`、`StatusDot.tsx`（若现有组件已覆盖则扩展现有组件）
- `src/renderer/src/components/mission-control/MissionControlView.tsx`、`MissionColumn.tsx`、`MissionCard.tsx`、`MissionToolbar.tsx`
- `src/renderer/src/components/workers/WorkersPanel.tsx`、`WorkerRow.tsx`、`WorkersTrackPill.tsx`、`WorkerControlBanner.tsx`、`AssignmentCard.tsx`
- `src/renderer/src/components/chat/FloatingComposerHarnessPicker.tsx`、`FloatingComposerIsolationPicker.tsx`（与现有 `FloatingComposer*` 组件同目录、同命名）
- `src/renderer/src/store/activity-store.ts`、`team-store.ts`
- `src/main/notifications/activity-notifier.ts`

修改：

- `src/renderer/src/extensions/contribution-ids.ts`、`components/workbench/CodeRightPanelTabs.tsx`、`WorkbenchRightPanel.tsx`
- 左侧栏会话列表组件（分组方式、元信息行）
- composer 控件行、斜杠菜单
- `src/renderer/src/locales/{en,zh}/`（新增文案）
- 设置页各分组组件
- `src/main/remote/remote-allowlist.ts`
