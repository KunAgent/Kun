# 07 宿主持有的任务工作区

- 阶段：P0
- 依赖：无（抽取 Graph 现有实现）
- 被依赖：02（准入：隔离工作区）、03、09、10、11

## 1. 目标

外部 agent 不会遵守 Kun 注入的 worktree 提示协议，所以**工作区必须由宿主创建和管理**：

1. 创建：从指定起点切出 worktree（或在非 git 目录里退化为普通目录），在后台完成，带进度，可取消，可重试。
2. 环境补齐：共享依赖目录、复制被 gitignore 的文件（`.env` 等）、执行安装脚本。
3. 采集：不依赖 agent 配合，按 git 实际状态得到改动与 patch。
4. 合入：应用 patch 或合并分支，**绝不动用户源 checkout 里未提交的改动**。
5. 清理：移除 worktree，删除已合入的分支，保留未合入的分支供复核。

## 2. 现状

| 实现 | 位置 | 特点 |
| --- | --- | --- |
| Graph 写协调器 | `kun/src/graph/graph-write-coordinator.ts`（660 行） | 路径租约；按尝试 `git worktree add --detach`；`captureWorktree`（`add -A` + 相对 base 的 diff + patch 存 artifact）；`integrate`（检查源 HEAD 未动、未提交改动不重叠，`apply --check` 后 `apply --index`）；状态 active / accepted / conflict / preserved / cleaned / orphaned |
| 定时任务 worktree 池 | `src/main/services/worktree-service.ts` | 主进程按编号分配；merge / sync / abort |
| 通用 Git Worktrees 页面 | 主进程 `createGitBranchWorktree` 等 | 手动管理 |
| 计划构建 | `docs/AGENTS.md` "Agent-Managed Plan Worktrees" | 靠提示协议让 agent 自己建、rebase、ff-merge |

方案：把 Graph 写协调器里与 worktree 生命周期相关的部分抽成通用核心，Graph 和新的任务工作区服务都用它。主进程的池和手动页面不动。

## 3. 抽取：`kun/src/workspace-tasks/worktree-lifecycle.ts`（新增）

从 `graph-write-coordinator.ts` 抽出（行为不变，Graph 的现有测试必须全部通过）：

```ts
export interface WorktreeLifecycle {
  create(input: {
    repositoryRoot: string
    path: string
    startRevision: string              // 已解析的 40/64 位 sha
    branch?: string                    // 缺省为 detached（Graph 的现有行为）
  }): Promise<{ repositoryRoot: string; baseRevision: string; branch?: string }>
  capture(record: { path: string; baseRevision: string }): Promise<{
    headRevision: string; changedFiles: string[]; patch: string
  }>
  applyPatch(record: { repositoryRoot: string; baseRevision: string; changedFiles: string[]; patch: string },
    opts: { ownedPaths: ReadonlySet<string> }): Promise<
      | { outcome: 'applied' } | { outcome: 'needs_human'; reason: string } | { outcome: 'conflict'; reason: string }>
  remove(record: { repositoryRoot: string; path: string }, opts: { force: boolean }): Promise<void>
}
```

- `create` / `capture` / `applyPatch` 分别对应现有的 `createWorktree`、`captureWorktree`、`integrate` 中的 git 操作；路径租约、scope 校验、状态文件仍留在 Graph 里。
- 所有写 git 的调用继续走 `graphCommitGit` + `assertGraphWriteFence`（改名为 `workspaceCommitGit` / `assertWorkspaceWriteFence` 并保留旧名导出一个版本周期）。

## 4. 数据模型：`kun/src/contracts/task-workspace.ts`（新增）

```ts
export const TaskWorkspaceIsolationSchema = z.enum([
  'worktree',     // 宿主创建的 git worktree（默认）
  'local',        // 直接用用户的 checkout（一对一默认；worker 需要显式允许，见 §9）
  'directory'     // 非 git 目录，无隔离
])

export const StartFromSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('default-branch') }).strict(),                 // 仓库默认分支（优先 origin/HEAD，退化为本地当前分支）
  z.object({ kind: z.literal('current-head') }).strict(),
  z.object({ kind: z.literal('branch'), name: z.string().min(1).max(256) }).strict(),
  z.object({ kind: z.literal('commit'), sha: z.string().regex(/^[a-f0-9]{7,64}$/) }).strict(),
  z.object({ kind: z.literal('remote-branch'), remote: z.string().max(128), name: z.string().max(256) }).strict(),
  z.object({ kind: z.literal('change-request'), number: z.number().int().positive() }).strict()   // P2
])

export const TaskWorkspaceStateSchema = z.enum([
  'creating', 'setting-up', 'ready', 'failed',
  'captured', 'integrated', 'conflict', 'preserved', 'removed', 'orphaned'
])

export const TaskWorkspaceRecordSchema = z.object({
  workspaceId: z.string().regex(/^tws_[a-z0-9]{8,32}$/),
  ownerThreadId: z.string().min(1),          // 发起者：总管线程、一对一线程、Graph 运行的线程
  unitId: z.string().optional(),             // 绑定的执行单元（06）
  isolation: TaskWorkspaceIsolationSchema,
  sourceRoot: z.string().max(4_096),         // 用户选的项目目录
  repositoryRoot: z.string().max(4_096).optional(),
  path: z.string().max(4_096),               // 执行单元实际使用的 cwd
  startFrom: StartFromSchema,
  baseRevision: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
  branch: z.string().max(256).optional(),
  headRevision: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
  state: TaskWorkspaceStateSchema,
  progress: z.object({
    step: z.enum(['resolve', 'fetch', 'worktree', 'share', 'copy', 'setup']),
    message: z.string().max(256)
  }).strict().optional(),
  setup: z.object({
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped', 'not-approved']),
    logArtifactId: z.string().optional(),
    durationMs: z.number().int().nonnegative().optional()
  }).strict(),
  changedFiles: z.array(z.string().max(4_096)).max(10_000).default([]),
  patchArtifactId: z.string().optional(),
  lastError: z.string().max(2_048).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict()
```

存储：`kun/src/workspace-tasks/task-workspace-store.ts`，`dataDir/ade/task-workspaces.json`，`AtomicJsonFile` + Manager 数据互斥（与 `FileDelegatedSessionBindingStore` 相同模式）。

worktree 位置：`~/.kun/worktrees/tasks/<仓库名>-<仓库路径哈希前 8 位>/<workspaceId>`，与现有 `~/.kun/worktrees/plan-prompt/` 平级。

分支名：`<前缀><任务 slug>-<workspaceId 后 6 位>`，前缀默认 `kun/`，项目配置可覆盖（§6）。Graph 尝试仍用 detached worktree，不建分支。

## 5. 创建流程：`TaskWorkspaceService.create`

```ts
async create(input: CreateTaskWorkspaceInput, signal: AbortSignal): Promise<TaskWorkspaceRecord> {
  const record = await this.store.insert(initialRecord(input))            // state: creating，立即返回给调用方
  void this.runCreate(record.workspaceId, input, signal)                   // 后台执行，进度写回记录并发事件
  return record
}

private async runCreate(id: string, input: CreateTaskWorkspaceInput, signal: AbortSignal) {
  try {
    const repo = await detectRepository(input.sourceRoot)                  // git rev-parse --show-toplevel；失败 → 非 git
    if (!repo) return this.finish(id, input.isolation === 'worktree'
      ? fail('source is not a git repository; choose local or directory isolation')
      : ready({ path: input.sourceRoot }))
    if (input.isolation === 'local') return this.finish(id, ready({ path: input.sourceRoot, repositoryRoot: repo.root }))

    await this.progress(id, 'resolve', 'Resolving start point')
    const start = await resolveStartFrom(repo, input.startFrom, { signal, fetchTimeoutMs: 60_000 })
    await this.progress(id, 'worktree', 'Creating worktree')
    const created = await this.lifecycle.create({ repositoryRoot: repo.root, path: worktreePath(repo, id),
      startRevision: start.sha, branch: branchName(input, id, this.projectConfig(repo.root)) })

    await this.progress(id, 'share', 'Linking shared directories')
    await shareDirectories(repo.root, created.path, this.projectConfig(repo.root), this.userShares(repo.root))
    await this.progress(id, 'copy', 'Copying local files')
    await copyIncludedFiles(repo.root, created.path, this.projectConfig(repo.root))

    await this.store.update(id, { state: 'setting-up', baseRevision: created.baseRevision, branch: created.branch,
      repositoryRoot: repo.root, path: created.path })
    const setup = await this.setupRunner.run(id, created.path, this.approvedSetup(repo.root), signal)   // §7
    await this.finish(id, { state: setup.status === 'failed' ? 'failed' : 'ready', setup })
  } catch (error) {
    await this.finish(id, fail(boundedError(error)))
  }
}
```

- 取消：`signal` 中止时，已创建的 worktree 调用 `lifecycle.remove({ force: true })` 回滚，记录置 `failed`（原因 cancelled）。
- 重试：`POST /v1/task-workspaces/:id/retry` 从失败的步骤重新执行；worktree 已存在时跳过创建。
- setup 失败不回滚 worktree：状态 `failed`，但用户可以查看日志、手动修好后"标记为就绪"。
- 事件：每次进度和状态变化发 `task_workspace` 运行时事件（挂在 ownerThreadId 上），ActivityStore 同步更新行的 `workspace` 字段。

## 6. 项目配置：扩展 `.kun/project.json`

`kun/src/config/project-config.ts` 的 `KunProjectConfigSchema` 加 `worktree` 段：

```ts
worktree: z.object({
  /** 被 gitignore 的目录，在新 worktree 里共享（依赖、缓存这类可重建的大目录） */
  sharedDirectories: z.array(z.object({
    path: RelativeProjectPath,
    mode: z.enum(['symlink', 'clone']).default('symlink')
  }).strict()).max(32).default([]),
  /** 被 gitignore 的文件，复制一份到新 worktree（.env 这类每个 worktree 应各自持有的文件） */
  copyFiles: z.array(RelativeProjectPath).max(64).default([]),
  /** 创建后执行的安装命令，需要用户批准（§7） */
  setup: z.array(z.object({
    name: z.string().min(1).max(64),
    command: z.string().min(1).max(256),
    args: z.array(z.string().max(1_024)).max(32).default([]),
    timeoutMs: z.number().int().positive().max(30 * 60_000).default(10 * 60_000)
  }).strict()).max(8).default([]),
  branchPrefix: z.string().regex(/^[a-z0-9][a-z0-9/_-]{0,31}$/).default('kun/')
}).strict().default({ sharedDirectories: [], copyFiles: [], setup: [], branchPrefix: 'kun/' })
```

规则（在 `shareDirectories` / `copyFiles` 里执行）：

1. 路径必须是相对路径，不能含 `..`，不能是符号链接指向仓库外。
2. 必须**存在于源 checkout 且被 git 忽略**（`git check-ignore -q`）；被跟踪或不存在的路径跳过并记警告。被跟踪的文件本来就在 worktree 里，重复处理会造成冲突。
3. v1 只支持字面路径，不支持通配符（通配符容易误复制大量文件）。
4. `symlink`：快，但所有 worktree 共用同一份，某个 agent 往 `node_modules` 里装东西会影响其它 worktree——在设置说明里写清楚。`clone`：macOS 上用 APFS 写时复制（`fs.cp` 递归 + `COPYFILE_FICLONE`），其它平台退化为 symlink 并记警告。
5. 用户级补充：设置 `agents.kun.worktrees.sharedPaths[<仓库根>]`，与项目配置**合并**（不替换），用于不想提交到仓库的个人配置。

## 7. setup 命令

### 7.1 信任

setup 命令来自仓库，执行它等于运行仓库里的代码。直接复用项目配置的批准记录：

- 现有机制（2026-09-25 核对）：`src/main/services/project-config-service.ts:69` 的 `approvedProjectMcpServers` 读取 `agents.kun.projectConfig.grants: { workspaceRoot, configDigest }[]`，只有 `loadKunProjectConfig(root).digest === grant.configDigest` 时项目 MCP 才生效。digest 覆盖整份 `.kun/project.json`。
- setup 与 checks 命令使用**同一份 grant**：`approvedWorktreeSetup(settings, repoRoot)` 按相同规则判定；项目配置任何一处变化（包括 MCP 段）都需要重新批准。这样用户只面对一个"信任此项目配置"的决定，不会出现 MCP 已批准、setup 未批准的混合状态。
- 批准入口沿用现有的项目配置批准 UI；它的说明文字补上"包括 worktree 安装命令"。
- kun 侧拿不到 GUI 设置：主进程生成 config.json 时，把已批准仓库的 `worktree` 段（命令原文 + digest）写进 `ade.approvedWorktreeConfigs`（数组，按仓库根排序），kun 只执行其中 digest 与当前 `.kun/project.json` 一致的命令。
- 未批准：`setup.status = 'not-approved'`，工作区仍然 `ready`，侧栏显示"此项目的 worktree 安装命令待批准"提示（12 §7），用户批准后可一键补跑。
- 无人值守路径（总管在用户不在时派活）遇到未批准的 setup：跳过，并在派活结果里告诉总管"依赖未安装"，由总管决定是否先问用户。

### 7.2 执行：`kun/src/workspace-tasks/setup-runner.ts`

```ts
async run(workspaceId: string, cwd: string, steps: ApprovedSetupStep[], signal: AbortSignal): Promise<SetupResult> {
  const log = new BoundedLog({ maxBytes: 1024 * 1024 })
  const started = Date.now()
  for (const step of steps) {
    log.line(`$ ${step.command} ${step.args.join(' ')}`)
    const result = await this.launcher.run(step.command, step.args, {
      cwd, env: minimalSetupEnv(process.env),        // 不带任何 Kun 令牌或 provider 凭据
      timeoutMs: step.timeoutMs, signal, onOutput: (chunk) => log.append(chunk)
    })
    if (result.exitCode !== 0) return this.finishSetup(workspaceId, 'failed', log, started)
  }
  return this.finishSetup(workspaceId, steps.length ? 'succeeded' : 'skipped', log, started)
}
```

- 进程通过 Kun 现有的受管启动器启动（进程组 / Windows Job Object），应用退出时整棵树被回收。
- Windows 下 `.cmd` / `.bat` 命令用现有的安全启动封装，不使用 `shell: true`。
- 日志存为 artifact，`GET /v1/task-workspaces/:id/setup-log` 读取。

## 8. 采集与合入

### 8.1 采集

`capture(workspaceId)`：

1. 调用 `lifecycle.capture`：`git add -A` 后 `git diff --cached <baseRevision>`。这同时覆盖 agent 自己提交过的改动和未提交的改动。
2. patch 存 artifact（沿用 Graph 的 `artifactStore.put`），记录 `changedFiles`、`headRevision`、`patchArtifactId`。
3. 调用时机：每次 worker 的 turn 结束（09 §5）、用户打开审查面板、合入前。

采集是 11 审查闭环的**唯一 diff 来源**，不依赖工具调用事件（外部 agent 可能绕过 Kun 直接写盘）。

### 8.2 合入方式

| 方式 | 条件 | 做法 | 失败处理 |
| --- | --- | --- | --- |
| `apply-patch` | 源 checkout 的 HEAD 仍等于 baseRevision，且未提交改动与 patch 不重叠 | 复用 `lifecycle.applyPatch`（`apply --check` → `apply --index`） | `needs_human`，保留 worktree |
| `merge-branch` | 有分支 | worktree 内把未提交改动提交；目标分支前进了就在 worktree 内 rebase；源 checkout 在目标分支且允许时 `merge --ff-only` | rebase 冲突 → `conflict`，保留现场，不强行解决 |
| `push-pr` | 有远程和 forge 凭据 | 推分支、开 PR（11 §6） | 推送失败保留本地 |

硬性规则（沿用计划 worktree 协议的约束，改由宿主执行）：

- **绝不** stash、reset、clean、切换或提交用户源 checkout 里的未提交改动。
- 源 checkout 不在目标分支、或有与 patch 重叠的未提交改动 → 不合入，返回 `needs_human` 并说明原因和恢复步骤。
- 多个 worker 合入同一目标时串行执行（服务内队列），后一个合入前重新检查 HEAD。

### 8.3 清理

- `integrated` 之后：`git worktree remove`（非强制）；分支用 `git branch -d`（不用 `-D`）。git 拒绝删除（有未合入提交）→ 分支保留，记录进"待复核分支"列表，UI 让用户逐个决定。
- 放弃（用户或总管丢弃结果）：先二次确认（worktree 里有未提交改动或未推送提交时），再 `remove --force`。
- 启动时扫描：`creating` / `setting-up` 超过 1 小时的记录置 `failed`；worktree 根目录下存在但记录里没有的目录只报告，**不自动删除**。

## 9. `local` 隔离与写冲突

- 一对一会话默认 `local`（用户就在这个 checkout 里工作），总管派活默认 `worktree`。
- worker 用 `local`：需要设置里显式允许，并且复用 Graph 的路径租约：worker 声明写入范围（可以是整个仓库），同一 checkout 里写入范围重叠的 worker 不能同时运行。
- 无沙箱的 harness（`facts.sandbox === 'none'`）不能用 `local` 做 worker（02 §5.2 的准入）。

## 10. 与计划构建的关系（P2）

外部 harness 执行计划构建时（准入场景 `plan-build`），不再注入提示协议，改为：`TaskWorkspaceService.create` → worker 在 worktree 里实现 → 采集 → 按 §8.2 合入。Kun 原生 loop 的计划构建保持现有提示协议，等这条路径稳定后再评估是否统一。

## 11. HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/task-workspaces` | 创建；立即返回 `creating` 记录 |
| GET | `/v1/task-workspaces?ownerThreadId=...` | 列表 |
| GET | `/v1/task-workspaces/:id` | 单个记录 |
| POST | `/v1/task-workspaces/:id/retry` | 从失败步骤重试 |
| POST | `/v1/task-workspaces/:id/mark-ready` | setup 失败后人工标记就绪 |
| POST | `/v1/task-workspaces/:id/capture` | 采集改动 |
| POST | `/v1/task-workspaces/:id/integrate` | `{ mode: 'apply-patch' \| 'merge-branch' }` |
| POST | `/v1/task-workspaces/:id/discard` | 放弃并清理（需要 `confirm: true`） |
| GET | `/v1/task-workspaces/:id/setup-log` | setup 日志 |
| GET | `/v1/task-workspaces/preserved-branches?repo=...` | 待复核分支 |

## 12. 测试

| 测试 | 断言 |
| --- | --- |
| Graph 回归 | 抽取后 `graph-write-coordinator` 全部现有测试通过 |
| 创建 | 各种 start-from；非 git + worktree 隔离失败；取消时回滚 |
| 环境补齐 | 只处理被忽略且存在的路径；`..` 与仓库外符号链接被拒；symlink / clone 模式；用户级与项目级合并 |
| setup | 未批准时跳过且工作区就绪；内容变化后需要重新批准；超时与失败日志；无凭据环境 |
| 采集 | 覆盖已提交和未提交改动；patch 存 artifact |
| 合入 | HEAD 移动、重叠未提交改动 → needs_human；不修改用户未提交文件（测试前后源 checkout 的 `git status --porcelain` 完全相同）；串行合入 |
| 清理 | `branch -d` 失败时保留分支并出现在待复核列表；启动扫描不删除未知目录 |
| 跨平台 | Windows 路径与 `.cmd` setup 命令（CI 的 Windows job） |

## 13. 文件清单

新增：

- `kun/src/contracts/task-workspace.ts`
- `kun/src/workspace-tasks/worktree-lifecycle.ts`、`task-workspace-service.ts`、`task-workspace-store.ts`、`start-from-resolver.ts`、`environment-fill.ts`、`setup-runner.ts`、`integration-queue.ts`
- `kun/src/server/routes/task-workspaces.ts`

修改：

- `kun/src/graph/graph-write-coordinator.ts`（改用 `worktree-lifecycle.ts`）
- `kun/src/config/project-config.ts`（`worktree` 段）
- `src/shared/app-settings-types-kun-runtime.ts`、`app-settings-kun.ts`、IPC schema（`agents.kun.worktrees.sharedPaths`、setup 批准记录）
- `src/main/runtime/kun-runtime-config-service.ts`（setup 批准与项目 MCP 批准共用存储）
