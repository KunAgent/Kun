# P1-17 ~ P1-24：审查与工作台界面

设计依据：[11](../11-review-ship.md)、[12](../12-workbench-ui.md)。界面约束见 12 §2（复用组件、一个主按钮、红色只在确认里、状态不跳动、不用 `bg-ds-surface*` 类、不对 var token 用 `/NN` 透明度）。

---

## P1-17 审查：diff 接口与审查面板（L，K R）

- 分支：`codex/ade-review-panel`；依赖：P0-12

### kun

| 文件 | 内容 |
| --- | --- |
| `kun/src/server/routes/task-workspaces.ts` | `GET /v1/task-workspaces/:id/diff`：先 `capture`，再用 artifact 里的 patch 按文件切分 → `{ files: Array<{ path, oldPath?, status, insertions, deletions, binary, tooLarge }>, headRevision }`；`GET …/diff/file?path=` → `{ patch, oldText?, newText? }`（单文件 > 1 MiB 或二进制时只给统计） |
| `kun/src/workspace-tasks/patch-split.ts` | `splitPatchByFile(patch)`：按 `diff --git a/… b/…` 切分；统计 `+` / `-` 行（排除 `+++` / `---` 头）；识别 `Binary files … differ` |

新旧全文：`newText` 读 worktree 里的当前文件；`oldText` 用 `git show <baseRevision>:<path>`（受大小上限约束）。

### renderer

| 文件 | 内容 |
| --- | --- |
| `src/renderer/src/extensions/contribution-ids.ts:3` | `BUILTIN_RIGHT_PANEL_IDS.review = 'builtin:right-panel-review'` |
| `src/renderer/src/components/workbench/CodeRightPanelTabs.tsx`、`WorkbenchRightPanel.tsx` | 注册审查标签（图标 `GitCompare`），只在当前线程绑定了任务工作区时出现 |
| `src/renderer/src/components/review/ReviewPanel.tsx` | 顶部：工作区信息（分支、起点、状态）+ 主操作（P1-19）；下方左右分栏 |
| `ReviewFileTree.tsx` | 目录折叠树，每个节点 `+N −M`（`statusSuccess` / `statusDanger` token）；点击滚动到对应文件块 |
| `ReviewDiffBlock.tsx` | 单文件块：头部（路径、统计、折叠）、统一 / 并排切换；统一视图用 `diff` 包的 `parsePatch` 自绘行（行号栏为批注留钩子）；并排视图复用 `@codemirror/merge` |
| `src/renderer/src/store/review-store.ts` | 每个工作区的文件列表、展开状态、视图模式；按需懒加载单文件 |

性能：文件块用 IntersectionObserver 懒渲染（进入视口才请求 `diff/file`）；单文件超过 5000 行时默认折叠并提示"展开大文件"。

### 测试

| 用例 | 期望 |
| --- | --- |
| `splitPatchByFile` | 新增、删除、重命名、二进制四种 |
| diff 接口 | 文件列表与 `git diff --cached --stat <base>` 一致 |
| 面板 | 没有任务工作区时不显示标签；窄窗口（≤ 800px）文件树可折叠、无横向滚动 |
| 懒加载 | 不在视口的文件不请求 |

---

## P1-18 审查：批注、重新定位、批量发送（L，K R S）

- 分支：`codex/ade-review-comments`；依赖：P1-17、P1-14

### kun

| 文件 | 内容 |
| --- | --- |
| `kun/src/contracts/review.ts` | `ReviewCommentSchema`（11 §4.1）、`SendReviewRequestSchema` |
| `kun/src/ade/review-store.ts` | `dataDir/ade/reviews/<workspaceId>.json`；`create / update / resolve / list / markSent` |
| `kun/src/ade/revision-request.ts` | `renderRevisionRequest(comments, note, round)`（11 §4.4 模板，确定性） |
| `kun/src/ade/review-anchor.ts` | 与 `src/shared/review-anchor.ts` 相同的纯函数（两份 + 共用夹具） |
| `kun/src/server/routes/reviews.ts` | `GET/POST /v1/reviews/:workspaceId/comments`、`PATCH …/comments/:id`、`POST /v1/reviews/:workspaceId/send` |

发送的三种目标：

```ts
switch (target.kind) {
  case 'worker':      // 默认：产生改动的 worker
    return teamsApi.dispatchFromGui(workerId, { title: `审查意见 第 ${round} 轮`, task: request, mode: 'queue' })  // P1-14 的 GUI 派活路由
  case 'manager':     // 交给总管：作为用户消息的 composerContexts 进入总管线程（renderer 负责发送，kun 只返回渲染好的上下文）
    return { composerContext: { kind: 'review_request', title, body: request } }
  case 'new-worker':  // 新 worker 复用同一任务工作区（不新建 worktree）
    return managerRuntime.createWorker({ …, workspace: { reuseTaskWorkspaceId: workspaceId } })
}
```

`reanchor` 在每次 `capture` 之后对该工作区所有未解决批注运行（在 `TaskWorkspaceService.onChange` 里触发），结果写回 `line` 与 `outdated`。

### renderer

| 文件 | 内容 |
| --- | --- |
| `src/renderer/src/components/review/ReviewCommentGutter.tsx` | 悬停行显示"+"；`c` 键在焦点行新建 |
| `ReviewCommentThread.tsx` | 行下方展开的批注：markdown 编辑（复用现有 markdown 输入组件）、保存（`Cmd/Ctrl+Enter`）、取消（`Esc`）、解决 |
| `ReviewSendMenu.tsx` | 顶部"N 条待发送 · 发送给…"：下拉（worker / 总管 / 新 worker）+ 可选总体说明 |

交互细节：

- 草稿批注本地先写 store，防抖 1 秒同步到 kun（离线时保留在内存，重连后补发）。
- 发送成功后批注标 `sent`，面板顶部显示"已发送给 登录修复（第 2 轮）"，worker 完成后自动刷新 diff 并重新定位。
- `outdated` 的批注显示在文件块顶部的"代码已变化"区域，仍可发送。

### 测试

| 用例 | 期望 |
| --- | --- |
| reanchor 夹具（两端一致） | 行移动、行删除、重复行 |
| 请求文本 | 确定、编号正确、outdated 批注写原文 |
| 发送给 worker | 产生一个 GUI 派活，`parentTurnId` 为总管最近 turn |
| 发送给总管 | 总管线程收到带 `review_request` 上下文的用户消息 |
| 跨端 | 手机端能看到并发送 |

---

## P1-19 合入按钮与 `workspace_integrate`（M，K R）

- 分支：`codex/ade-integrate-ui`；依赖：P1-17、P0-16

| 文件 | 内容 |
| --- | --- |
| `src/renderer/src/components/review/ReviewPrimaryAction.tsx` | 11 §7.1 的按钮组；按条件只高亮一个主操作；"丢弃"是描边按钮，确认对话框里才是红色 |
| `src/renderer/src/components/review/IntegrateResultDialog.tsx` | 显示 `needs_human` / `conflict` 的原因与 `recovery` 步骤，提供"在终端打开该 worktree" |
| `kun/src/ade/tools/workspace-integrate.ts` | 总管工具：`awaitApproval` 一个 `file` 类信封（目标 = 源 checkout 路径），用户确认后调用 `integrate`；无人值守直接返回"待你合入" |

按钮可用条件的数据来源：`GET /v1/task-workspaces/:id/integrate-preview` → `{ canApplyPatch, applyBlockReason?, canMergeBranch, mergeBlockReason?, hasUncommitted, hasRemote }`（kun 用只读 git 命令计算，不改任何状态）。

测试：条件组合矩阵（HEAD 移动、源有重叠改动、无分支、无远程）下按钮状态正确；工具在无人值守时不合入；合入成功后 ActivityStore 行更新。

---

## P1-20 Mission Control（M→L，R S）

> 2026-09-26 修订：Mission Control 是 ADE 模式首页（`AdeStage` 的默认视图，00 §4），不改 `board` 路由；下表中关于 `board` / `BoardStage` 的两行作废，其余组件与数据设计不变。左侧栏计数挂在 ADE 侧栏的 Mission Control 行上。

- 分支：`codex/ade-mission-control`；依赖：P0-08

### 结构

| 文件 | 内容 |
| --- | --- |
| `src/renderer/src/components/workbench/WorkbenchStageRouter.tsx:155` | `board` 路由改为渲染 `BoardStage`：顶部两个标签（Agents / 任务卡片），默认 Agents；`agents.kun.ade.enabled` 关闭时只显示现有项目看板 |
| `src/renderer/src/components/mission-control/MissionControlView.tsx` | 工具栏 + 列 |
| `MissionColumn.tsx` | 列头（名称 + 计数）+ 卡片列表（虚拟化：超过 100 张时用现有的列表虚拟化方案） |
| `MissionCard.tsx` | 12 §5.1 的卡片；高度固定三行，预览行单行截断 |
| `MissionToolbar.tsx` | 搜索、筛选（项目、agent、验收、PR）、看板设置（显示空闲列） |
| `src/renderer/src/components/activity/activity-glyph.ts` | 12 §3 的唯一映射 |
| `src/renderer/src/components/activity/StatusDot.tsx`、`StatusBadge.tsx` | 若现有组件已有同类实现（先搜 `StatusDot` / `status-dot`），扩展现有的，不新建第二套 |
| 左侧栏导航 | 现有"项目看板"入口改名 Mission Control，右侧显示 `selectNeedsYouCount()` |
| 主题 token | 在现有主题文件新增 `--ds-status-success/danger/warning/running` 与 `--ds-status-dot-*`，亮 / 暗两套；从吉祥物调色板推导，用对比度脚本校验（点与侧栏背景 ≥ 3:1） |

### 数据

- 行来自 `activity-store`；卡片上的 diff 统计、验收、PR 状态来自 `GET /v1/teams/by-manager/:id`（总管卡片展开时懒加载）与 `GET /v1/task-workspaces/:id`（只取统计字段）。加载前在卡片底部预留同高度的占位。
- 卡片点击：`kind === 'worker'` 打开 worker 线程（作为侧边会话打开，沿用现有"打开子会话"行为）；其它打开对应线程。
- "待你处理"卡片的内联操作：审批 → 调现有 `approval:decide`；回答问题 → `POST /v1/teams/questions/:id/answer`。

### 测试

| 用例 | 期望 |
| --- | --- |
| 分组 | 与 `displayBucket` 一致（用 activity-display 的夹具） |
| 空闲列 | 默认隐藏，设置打开后出现 |
| 布局稳定 | 懒加载前后卡片尺寸相同（测量断言） |
| 开关关闭 | `board` 路由与改动前一致 |
| 着色 | 只有待你处理与待审查两列有底色 |

---

## P1-21 Workers 面板、轨道胶囊、接管横幅、任务卡片（M，R）

- 分支：`codex/ade-workers-panel`；依赖：P1-14、P1-20

| 文件 | 内容 |
| --- | --- |
| `contribution-ids.ts` | `BUILTIN_RIGHT_PANEL_IDS.workers = 'builtin:right-panel-workers'` |
| `src/renderer/src/components/workers/WorkersPanel.tsx`、`WorkerRow.tsx` | 12 §6.1 |
| `src/renderer/src/components/chat/FloatingComposerWorkersPill.tsx` | 轨道胶囊，与现有 `FloatingComposerGraphProgress`、`FloatingComposerQueuedMessageBadges` 同一排布区域 |
| `src/renderer/src/components/workers/WorkerControlBanner.tsx` | worker 线程顶部横幅，按钮调接管 / 交还路由 |
| `src/renderer/src/components/workers/AssignmentCard.tsx` | 识别 worker 线程首条用户消息中的 `<kun_assignment>`，渲染为折叠卡片（原文仍保存在消息里） |
| `SubagentCallCard.tsx` | `worker_create` / `worker_send` 的工具卡片复用它：加 agent 图标与工作区徽标 |

`worker_update` 卡片（P1-13）与 Workers 面板共用 `WorkerRow` 的展示逻辑。

测试：胶囊计数随 activity 变化；有等待问题时胶囊变琥珀色并显示"1 待回答"；接管后横幅切换；任务卡片解析失败时回退为普通消息。

---

## P1-22 composer 的 agent 选择器、模型分组、原生斜杠命令（M，R K）

> 2026-09-26 修订：只在 ADE 模式（`mode="ade"`）的 composer 渲染这些控件；Code composer 不变。

- 分支：`codex/ade-harness-picker`；依赖：P0-05、P1-05

| 文件 | 内容 |
| --- | --- |
| `src/renderer/src/components/chat/FloatingComposerHarnessPicker.tsx` | 12 §7.2；数据来自 `GET /v1/harnesses`（缓存到 renderer store，设置页修改后刷新） |
| 现有模型选择器（`FloatingComposer.model-menu` 相关组件） | 按当前 harness 过滤模型；多种 credentialMode 时分组 |
| `src/renderer/src/store/chat-store-*.ts` | 新会话的 `harnessId` 进入 `createThread` 请求；会话中切换 → 确认对话框 → 之后的 turn 带 `harnessId` |
| 斜杠菜单 | 追加 `harness_session_state` 事件里的命令（按线程缓存），分节显示；选择后原样作为消息发送（例如 `/review`），由 harness 自己解释 |
| `src/renderer/src/components/chat/FloatingComposerIsolationPicker.tsx` | 新会话的隔离选项（本地 / 新 worktree）；选新 worktree 时先 `POST /v1/task-workspaces`，线程 `workspace` 设为返回的路径（创建中时发送排队） |

kun 侧补充：一对一线程绑定任务工作区时，线程需要记录 `taskWorkspaceId`（`ThreadSchemaBase` 加可选字段），供 02 的准入（`workspace.isolated`）与审查面板使用。

测试：不可用 harness 置灰并显示原因；会话中切换弹确认；harness 命令出现在斜杠菜单；新 worktree 会话在就绪前发送的消息排队。

---

## P1-23 通知接入 ActivityStore（S，R M）

- 分支：`codex/ade-activity-notifications`；依赖：P0-08

| 文件 | 改什么 |
| --- | --- |
| `src/renderer/src/store/activity-notifications.ts`（新） | 订阅 `activity-store` 的行变化，检测转移（06 §3 的 state 与 stalled），按设置决定是否通知；去重键 `unitId + state + stateSince` |
| `src/renderer/src/store/chat-store-runtime-notifications.ts` | 现有"turn 完成"通知对 worker 与任务工作区线程让位给新逻辑（避免重复）；普通线程保持现状 |
| `src/main/ipc/register-app-content-ipc-handlers.ts:425` 的 `notificationPayloadSchema` | 加可选 `category` |
| 角标 | `app:badge-count` = 待你处理计数 |

测试：同一转移只通知一次；窗口在前台且该线程可见时不通知；旧载荷（无 category）照常显示。

---

## P1-24 设置页：Agents、工作区、总管（M，R S）

- 分支：`codex/ade-settings-pages`；依赖：P0-06、P0-11

| 分组 | 组件 | 内容 |
| --- | --- | --- |
| Agents | `settings-section-agents-harnesses.tsx`（新，挂在现有 `settings-section-agents.tsx` 下） | harness 列表行：图标、名称、版本、登录态、启用开关；更多菜单：重新检测、命令路径、默认权限档；"添加自定义 ACP agent"表单（命令、参数、环境变量——环境变量值输入框标注"不要填写密钥"） |
| Agents | 现有子代理设置 | profile 编辑加 agent（harness）与模型选择、"适合做什么"说明 |
| 工作区 | `settings-section-worktree.tsx`（已有） | 默认隔离方式；用户级共享路径；项目配置批准列表说明补"包括 worktree 安装命令"；待复核分支清理入口 |
| 总管 | `settings-section-lab-ade.tsx`（新，P1 期间在实验室分组） | 13 §3.1 的所有字段；`managerMayApprove`、`allowUnattendedFullAccess` 旁边的说明写清风险 |
| 通知 | 现有通知设置 | 四个类别开关 |

每个字段都走 P0-06 已建立的四层同步；新增的设置组件测试覆盖"修改 → 保存 → 重新打开仍是新值"。
