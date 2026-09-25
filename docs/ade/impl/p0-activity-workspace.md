# P0-07 ~ P0-12：ActivityStore 与任务工作区

设计依据：[06](../06-activity-store.md)、[07](../07-task-workspace.md)。

---

## P0-07 ActivityStore：契约、存储、事件投影、挂载（M，K S）

- 分支：`codex/ade-activity-store`；提交：`feat(activity): add execution unit activity store fed by runtime events`
- 依赖：无（`harnessId` 字段在 P0-04 前取 `'kun'` 或按 provider kind 推断）

### 新增

| 文件 | 内容 |
| --- | --- |
| `kun/src/contracts/activity.ts` | `ExecutionUnitKindSchema`、`ActivityStateSchema`、`ActivityRowSchema`、`ActivityPatch`、`ActivityProvenance`（06 §3） |
| `src/shared/activity-rollup.ts` | `rollupState()`（06 §5） |
| `src/shared/activity-display.ts` | `displayBucket()`、`DONE_DECAY_MS`（06 §10） |
| `kun/src/services/activity-store.ts` | `ActivityStore`：`register`、`apply`、`remove`、`get`、`list`、`changesSince`、`waitForChange`、`subscribe`、`epoch`、`cursor` |
| `kun/src/services/activity-event-projection.ts` | `projectRuntimeEvent(event): Array<{ unitId, patch }>`：纯函数，06 §4.2 的映射表 |

kun 不能直接 import `src/shared`：`rollupState` 在 `kun/src/services/activity-rollup.ts` 放一份，两份用同一个 JSON 夹具测试（与 P0-02 的做法一致）。

### `ActivityStore` 的实现要点

1. **结构**：`rows: Map<unitId, StoredRow>`；`changes` 为环形数组（容量 4096），元素 `{ unitId, revision, removed? }`；`revision` 单调递增；`epoch` 为进程启动时的 UUID。
2. **`record(event)`**（实现 `RuntimeEventObserver`，`services/runtime-event-recorder.ts:32`）：
   - 调 `projectRuntimeEvent(event)` 得到 patch 列表；
   - 普通线程首次 `turn_started` 时自动 `register({ kind: 'thread', unitId: threadId, … })`，标题、工作区从 `threadStore.getMetadata` 取（异步，取到之前先用占位标题；取回后再 apply 一次标题）；
   - `assistant_text_delta` 只更新 `lastMessagePreview`，节流 2 秒：用 `lastPreviewAt: Map<unitId, number>`，未到时间只记下最新文本，定时器到点再 apply（避免高频 bump）。
3. **`apply(unitId, patch, provenance)`**：06 §4.1 的代码；`mergeRow` 只覆盖 patch 里出现的键；`state` 永远由 `rollupState` 算出；相等检测用浅比较（行字段都是原始值或小对象）。
4. **父单元计数**：`recomputeParent(parentThreadId)` 遍历 `rows` 中 `parentThreadId` 相同的子行重新计数，O(子单元数)；子单元数上限由 team 的硬上限控制，不需要索引。
5. **`clearThread(threadId)`**：删除 `unitId === threadId` 的行以及以它为父的行，记 `removed` 变化。
6. **容量**：超过 2000 行时，淘汰 `visibility === 'archived' && state === 'closed' && stateSince` 超过 7 天的行；仍超出则淘汰最旧的 `idle` 行。

### 挂载

`kun/src/server/runtime-composition-core.ts:158`：

```ts
const activityStore = new ActivityStore({ nowIso, threadMetadata: (id) => threadStore.getMetadata?.(id) })
const observers = [
  threadActivity,
  activityStore,
  ...(agentObservability ? [agentObservability] : [])
]
```

并把 `activityStore` 放进 core 的返回值，供路由与后续服务使用（与 `threadActivity` 同样的传递方式，`runtime-composition-core.ts:394`、`runtime-composition-runtime.ts:56,175`）。

### 启动重建

`ActivityStore.hydrate(threadStore)`：列出最近 7 天有更新的线程（沿用线程列表的索引查询），对每个线程取最后一个 turn 的状态生成一行：`running` → working（但 `restoredUnconfirmed` 不需要，因为 turn 状态本身是持久化真相，运行中的 turn 会在恢复流程里继续或被标记失败）；`completed` / `failed` / `aborted` 分别映射。

### 测试

| 用例 | 期望 |
| --- | --- |
| 投影表：06 §4.2 每一行 | patch 正确 |
| 权威：对 worker 行用 `callback` 写 `mainState: 'done'` | 被忽略 |
| 权威：`callback` 写 `waiting(question)` | 生效 |
| 折叠：`rollupState` 全分支（夹具与 renderer 共用） | 与表一致 |
| 未登记单元 | apply 被忽略 |
| 父计数 | 两个子行 working → 父 `children.working = 2`，父 mainState done 时 state 仍 working |
| 节流 | 1 秒内 100 次 delta → 只 bump 一次，最终预览为最后一段文本 |
| 热路径性能 | 10_000 次 delta 在 200ms 内处理完（宽松阈值，CI 环境可放宽到 1s） |
| 游标 | epoch 变化 → resetRequired；游标早于环形缓冲下界 → resetRequired；同一行多次变化只返回最新 |
| clearThread | 父行与子行一起移除 |

---

## P0-08 Activity 接口、长轮询、renderer store、用户事实持久化（M，K M R）

- 分支：`codex/ade-activity-api`；提交：`feat(activity): expose activity snapshot, long poll and user facts`
- 依赖：P0-07

### kun

| 文件 | 内容 |
| --- | --- |
| `kun/src/services/activity-facts-store.ts` | `dataDir/ade/activity-facts.json`：`{ version: 1, facts: Record<unitId, { acknowledgedAt?, dismissedAt?, pinned? }> }`；`AtomicJsonFile` + `withManagerDataMutex`；防抖 2 秒写盘 |
| `kun/src/server/routes/activity.ts` | `activitySnapshot`、`activityEventsResponse`（照搬 `thread-activity.ts`：JSON 长轮询 `wait_ms ≤ 30000` 与 SSE 两种形态，SSE 心跳 15 秒）、`ackActivity`、`dismissActivity`、`pinActivity` |
| `kun/src/server/routes/register-activity-routes.ts` | 注册 06 §9 的路由（hooks 入口在 P2-03） |

- 快照接口按 `scope` 过滤：`workspace` 时比较规范化后的路径（复用现有工作区路径规范化函数）。
- ack / dismiss / pin 写 facts store，并 `apply` 到行上（`provenance` 不变，只改用户事实字段），产生变化记录，所有客户端都能收到。
- 删除线程时 `ActivityStore.clearThread` 也清掉 facts 中对应条目。

### 主进程

- `src/main/runtime/kun-adapter.ts:293` 的 `runtimeEventsWaitMs()`：加 `pathNorm.startsWith('/v1/activity/events?')`。
- 不需要改远程白名单（`runtime:request` 已放行）。

### renderer

| 文件 | 内容 |
| --- | --- |
| `src/renderer/src/agent/kun-runtime.ts` | `getActivitySnapshot(scope)`、`pollActivity(cursor, waitMs)`、`ackActivity(id)`、`dismissActivity(id)`、`pinActivity(id)` |
| `src/renderer/src/store/activity-store.ts` | Zustand：`rows: Record<unitId, ActivityRow>`、`cursor`、`status`；`start()` 拉快照后循环长轮询（`wait_ms = 25_000`）；`resetRequired` 时重新拉快照；窗口隐藏时降频到 60 秒一次；错误退避 1s → 30s |
| `src/renderer/src/store/activity-selectors.ts` | `selectBuckets()`（调用 `displayBucket`）、`selectNeedsYouCount()`、`selectRowsForParent(threadId)` |

- 长轮询循环参考现有 `chat-store-sidebar-activity.ts` 的实现方式（代次号防止旧循环写入）。

### 测试

| 用例 | 期望 |
| --- | --- |
| 长轮询：无变化时等待，期间发生变化 | 立即返回该变化 |
| `wait_ms` 超界 | 400 |
| SSE：订阅后发生两次变化 | 收到两条事件，间隔内有心跳 |
| ack 后另一个客户端的长轮询 | 收到该行的新版本（带 acknowledgedAt） |
| facts 持久化 | 重启后 dismissed 仍在 |
| 主进程超时 | `/v1/activity/events?wait_ms=25000` 的请求超时大于 25 秒（kun-adapter 测试） |
| renderer：resetRequired | 重新拉快照，旧行被替换 |
| renderer：隐藏窗口 | 轮询间隔变为 60 秒 |

---

## P0-09 从 Graph 抽取 worktree 生命周期（M，K）

- 分支：`codex/ade-worktree-lifecycle`；提交：`refactor(graph): extract worktree lifecycle for reuse`
- 依赖：无。**纯重构，行为不变**，单独合入。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `kun/src/workspace-tasks/worktree-lifecycle.ts`（新） | `createWorktreeLifecycle({ commitGit, git, fence })` 返回 07 §3 的 `create / capture / applyPatch / remove` |
| `kun/src/workspace-tasks/workspace-git.ts`（新） | 从 `graph/graph-write-coordinator-side-effects.ts` 移入 `graphGit`、`graphCommitGit`、`assertGraphWriteFence`、`withGraphWriteCommit`、`workingTreeChangedFiles`、`workspaceChangeSnapshot`，改名为 `workspaceGit`、`workspaceCommitGit`、`assertWorkspaceWriteFence`、`withWorkspaceWriteCommit`；原文件保留同名再导出 |
| `kun/src/graph/graph-write-coordinator.ts` | `createWorktree`（534 行起）、`captureWorktree`（277）、`integrate`（342）中的 git 操作改为调用 lifecycle；租约、scope 校验、状态持久化、artifact 存储留在原处 |

步骤：

1. 先移动 side-effects 函数（纯搬家 + 再导出），跑 Graph 测试。
2. 再把三个方法里的 git 调用序列抽到 lifecycle 的同名方法，参数只传 git 需要的字段（repositoryRoot、path、baseRevision、changedFiles、patch）。
3. `integrate` 里"HEAD 是否移动、未提交改动是否重叠"的判断属于 `applyPatch` 的前置检查，一起移过去；Graph 特有的 `graphOwned`（其它已接受尝试的文件集合）作为 `ownedPaths` 参数传入。
4. 控制文件长度：抽取后 `graph-write-coordinator.ts` 应从 660 行降到 500 行左右。

测试：`kun/src/graph` 现有全部测试不改一行并通过；新增 `worktree-lifecycle.test.ts` 用临时 git 仓库覆盖四个方法（含 HEAD 移动、重叠未提交改动、apply 冲突三种 needs_human / conflict 路径）。

---

## P0-10 任务工作区：契约、存储、创建、接口、事件（L，K）

- 分支：`codex/ade-task-workspace`；提交：`feat(workspace): host-owned task workspaces`
- 依赖：P0-09

### 新增

| 文件 | 内容 |
| --- | --- |
| `kun/src/contracts/task-workspace.ts` | 07 §4 全部 schema；`TaskWorkspaceEvent`（运行时事件 `task_workspace`） |
| `kun/src/workspace-tasks/task-workspace-store.ts` | `dataDir/ade/task-workspaces.json`：`{ version: 1, records: TaskWorkspaceRecord[] }`；`insert / update / get / list(filter)`；Manager 数据互斥 |
| `kun/src/workspace-tasks/start-from-resolver.ts` | `resolveStartFrom(repo, startFrom, { signal, fetchTimeoutMs })` |
| `kun/src/workspace-tasks/task-workspace-service.ts` | `create`、`runCreate`、`retry`、`markReady`、`get`、`list`、`onChange(listener)` |
| `kun/src/server/routes/task-workspaces.ts` | 07 §11 中的 create / list / get / retry / mark-ready（capture、integrate、discard 在 P0-12） |
| `kun/src/contracts/events.ts` | 新事件 `task_workspace`：`{ workspaceId, state, progress?, setup? }`，挂在 `ownerThreadId` 上 |

### `resolveStartFrom` 的逻辑

```ts
switch (startFrom.kind) {
  case 'current-head': return { sha: await git(repo.root, ['rev-parse', 'HEAD']) }
  case 'default-branch': {
    // 1. origin/HEAD 指向的分支（git symbolic-ref --quiet refs/remotes/origin/HEAD）
    // 2. 失败则取本地当前分支；detached HEAD 时报错 start_from_unresolved
    // 3. 取到远端分支名时先 fetch（受 fetchTimeoutMs 限制；失败则用本地已有的远端引用并记警告）
  }
  case 'branch': return { sha: await git(repo.root, ['rev-parse', '--verify', `${name}^{commit}`]) }
  case 'commit': /* 同上，校验存在 */
  case 'remote-branch': /* fetch <remote> <name>，然后 rev-parse FETCH_HEAD */
  case 'change-request': throw new Error('start_from_unsupported')   // P2 再支持
}
```

所有 git 调用走 `workspaceGit`（带超时，输出有上限）；分支名与 remote 名先用 `git check-ref-format` 校验，防止参数注入。

### 分支名

```ts
export function taskBranchName(prefix: string, label: string, workspaceId: string): string {
  const slug = label.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task'
  return `${prefix}${slug}-${workspaceId.slice(-6)}`
}
```

中文标签会得到 `task-xxxxxx`，这是预期的（分支名不适合放非 ASCII）；UI 显示的仍是原标签。

### 并发与恢复

- 同一仓库的 `git worktree add` 串行（按仓库根加锁，锁在服务内存里）；不同仓库并行。
- 进程启动时：`creating` / `setting-up` 且 `updatedAt` 超过 1 小时 → `failed`（原因 `interrupted`）；小于 1 小时的也置 `failed`（进程已重启，后台任务不存在），用户可重试。
- 取消：`create` 返回记录后，调用方可以 `POST /v1/task-workspaces/:id/cancel`；服务持有每个创建任务的 `AbortController`。

### 测试（临时 git 仓库）

| 用例 | 期望 |
| --- | --- |
| default-branch：有 origin/HEAD | 以远端默认分支为起点 |
| default-branch：无远端 | 以本地当前分支为起点 |
| detached HEAD + default-branch 无远端 | failed，`start_from_unresolved` |
| 非 git 目录 + worktree 隔离 | failed，明确说明 |
| 非 git 目录 + directory 隔离 | ready，path = 源目录 |
| 分支名注入（`name: '--upload-pack=x'`） | 被 `check-ref-format` 拒绝 |
| 并发两个创建（同仓库） | 串行完成，无 git 锁冲突 |
| 取消 | worktree 被移除，记录 failed（cancelled） |
| 重启 | 进行中的记录变 failed，可以 retry |
| 事件 | 每个进度步骤一条 `task_workspace` 事件 |

---

## P0-11 环境补齐与 setup（M，K M S）

- 分支：`codex/ade-workspace-env`；提交：`feat(workspace): share ignored paths, copy local files and run approved setup`
- 依赖：P0-10、P0-06

### 改动

| 文件 | 改什么 |
| --- | --- |
| `kun/src/config/project-config.ts` | `KunProjectConfigSchema` 加 `worktree` 段（07 §6） |
| `kun/src/workspace-tasks/environment-fill.ts`（新） | `shareDirectories()`、`copyIncludedFiles()` |
| `kun/src/workspace-tasks/setup-runner.ts`（新） | 07 §7.2 |
| `src/main/services/project-config-service.ts` | 新增 `approvedWorktreeConfigs(settings)`：与 `approvedProjectMcpServers` 同一套 grant 判断，输出 `{ repoRoot, digest, worktree }[]`（按 repoRoot 排序） |
| `src/main/runtime/kun-runtime-model-config.ts` | `adeConfigForRuntime` 写入 `approvedWorktreeConfigs` |
| `src/shared/app-settings-types-kun-runtime.ts`、`app-settings-kun.ts`、IPC schema | `agents.kun.worktrees.sharedPaths: Record<repoRoot, Array<{ path, mode }>>` |
| 项目配置批准 UI | 说明文字补"包括 worktree 安装命令"（P1-24 顺带） |

### `shareDirectories` / `copyIncludedFiles`

```ts
async function eligible(repoRoot: string, rel: string): Promise<boolean> {
  if (isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return false
  const abs = join(repoRoot, rel)
  const real = await realpath(abs).catch(() => null)
  if (!real || !isInside(repoRoot, real)) return false              // 符号链接指向仓库外 → 拒绝
  const ignored = await workspaceGit(repoRoot, ['check-ignore', '-q', '--', rel]).then(() => true, () => false)
  return ignored
}
```

- `symlink`：`symlink(abs, join(worktree, rel), 'junction' on win32 else 'dir')`；目标父目录不存在时先 `mkdir -p`。
- `clone`：macOS 用 `fs.cp(abs, dst, { recursive: true, mode: fs.constants.COPYFILE_FICLONE })`；其它平台退化为 symlink 并在结果里记 `warnings`。
- `copyFiles`：单文件 `copyFile`，文件权限保持；目标已存在不覆盖。
- 返回 `{ shared: string[], copied: string[], skipped: Array<{ path, reason }> }`，写进记录的 `progress.message` 与 setup 日志开头。

### setup 批准判定（kun 侧）

```ts
function approvedSetup(repoRoot: string): ApprovedSetupStep[] {
  const entry = activeOptions.ade?.approvedWorktreeConfigs?.find((c) => samePath(c.repoRoot, repoRoot))
  if (!entry) return []                                             // 未批准：status 'not-approved'
  const current = loadKunProjectConfigSync(repoRoot)
  if (!current || current.digest !== entry.digest) return []        // 配置已变化：需要重新批准
  return current.config.worktree.setup
}
```

### 测试

| 用例 | 期望 |
| --- | --- |
| 被跟踪的文件出现在 copyFiles | 跳过，reason `tracked` |
| 不存在的路径 | 跳过，reason `missing` |
| `..` 与指向仓库外的符号链接 | 跳过，reason `unsafe_path` |
| symlink 模式 | worktree 里是指向源目录的链接 |
| 未批准 | setup `not-approved`，工作区 ready |
| 批准后改了 `.kun/project.json` 的 MCP 段 | 视为未批准（整份 digest） |
| setup 失败 | 记录 failed，日志 artifact 可读，worktree 保留 |
| setup 环境 | 子进程环境里没有 `KUN_*` 令牌和 provider 密钥 |
| Windows（CI） | `.cmd` 命令能执行；junction 链接 |

---

## P0-12 采集、合入、丢弃、清理、待复核分支（M，K）

- 分支：`codex/ade-workspace-integrate`；提交：`feat(workspace): capture, integrate and clean up task workspaces`
- 依赖：P0-10

### 实现

| 方法 | 逻辑 |
| --- | --- |
| `capture(id)` | `lifecycle.capture` → patch 存 artifact（`origin: task-workspace:<id>`）→ 更新 `changedFiles`、`headRevision`、`patchArtifactId`、`state: 'captured'`（ready 与 captured 之间可以来回：新的 turn 开始时不改状态，采集时总是覆盖） |
| `integrate(id, mode)` | 服务内按目标仓库串行的队列；`apply-patch` 调 `lifecycle.applyPatch`；`merge-branch`：worktree 内 `add -A` + `commit -m <消息>`（有改动时）→ 目标分支前进则 `rebase <target>` → 源 checkout 当前分支 == 目标且干净度允许时 `merge --ff-only <branch>`；任何一步失败 → `conflict` 或 `needs_human`，保留现场 |
| `discard(id, { confirm })` | `confirm !== true` 时返回 409 与"将丢弃 N 个未提交文件 / M 个未推送提交"的预览；确认后 `remove --force` + `branch -D`（丢弃是用户显式动作，允许强制） |
| `cleanupIntegrated(id)` | `remove`（非强制）→ `branch -d`；失败则加入待复核列表 |
| `preservedBranches(repo)` | 列出记录里 `preserved` 的分支：名称、最后提交、`git rev-list --count <target>..<branch>` |

合入前后的安全检查（写成断言函数，测试直接调用）：

```ts
async function assertSourceUntouched(before: PorcelainSnapshot, repoRoot: string): Promise<void> {
  const after = await porcelainSnapshot(repoRoot)          // git status --porcelain=v2 -z 的解析结果
  for (const path of before.untrackedOrModified) {
    if (after.hash(path) !== before.hash(path)) throw new Error(`source change modified: ${path}`)
  }
}
```

`merge-branch` 在 ff-only 之前做一次 `before` 快照，之后调用 `assertSourceUntouched`；触发即中止并报告（理论上 ff-only 不会碰未提交文件，这是防回归断言）。

### 接口

补齐 07 §11 的 capture / integrate / discard / cleanup / preserved-branches；`integrate` 的响应 `{ outcome: 'applied' | 'merged' | 'needs_human' | 'conflict', reason?, recovery?: string[] }`，`recovery` 是给用户看的恢复步骤（例如"在 <path> 里运行 git status 查看冲突"）。

### 测试

| 用例 | 期望 |
| --- | --- |
| agent 在 worktree 里提交过 + 还有未提交改动 | 采集结果包含两者 |
| apply-patch：源 HEAD 移动 | needs_human |
| apply-patch：源有重叠的未提交改动 | needs_human，源文件内容不变 |
| merge-branch：目标前进且可 rebase | merged |
| merge-branch：rebase 冲突 | conflict，worktree 与分支保留，recovery 非空 |
| 两个 worker 同时合入同一目标 | 串行；第二个在第一个之后重新检查 HEAD |
| discard 未确认 | 409 + 预览 |
| cleanup：分支有未合入提交 | 分支保留并出现在待复核列表 |
| 全部路径 | 源 checkout 的未提交文件哈希前后一致 |
