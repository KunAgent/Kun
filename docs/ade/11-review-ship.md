# 11 审查闭环与交付

- 阶段：P1（git 来源的 diff、批注回传、合入）；P2（AI 行归属、PR 与 CI、赛马比较视图）
- 依赖：07、09、10
- 被依赖：12

## 1. 目标

1. 按任务工作区看改动，diff 来自 git 的实际状态，不依赖工具调用事件。
2. 在任意 diff 行上留言，**一次打包**发回给对应的 worker、总管，或新开一个 worker。
3. 标出哪些行是哪个 agent 写的。
4. 在应用内完成合入、提交、推送、开 PR、看 CI。

## 2. 现状

- 右侧"Changes"面板（`src/renderer/src/components/ChangeInspector.tsx`、`DiffView.tsx`）从聊天里的工具块推导改动。外部 agent 绕过 Kun 直接写盘时，这里看不到。
- 依赖里已有 `diff` 与 `@codemirror/merge`。
- 有 GitHub MCP 授权流程，但没有 PR / CI 的专用视图。

一对一会话继续使用现有 Changes 面板；任务工作区（worker、赛马、一对一"新建 worktree"会话）使用本章的审查面板。

## 3. diff 数据

### 3.1 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/task-workspaces/:id/diff` | 先触发一次采集（07 §8.1），返回文件列表：路径、状态（新增/修改/删除/重命名）、+/− 行数、是否二进制 |
| GET | `/v1/task-workspaces/:id/diff/file?path=...` | 单个文件的统一 diff 文本与新旧全文（大文件只给 hunk） |

- 服务端从采集得到的 patch artifact 按文件切分，不重复跑 git。
- 单文件超过 1 MiB 或被识别为二进制：只返回统计，UI 显示"二进制或过大文件"。

### 3.2 渲染

`src/renderer/src/components/review/`（新增目录）：

- `ReviewPanel.tsx`：左侧文件树（按目录折叠，每个目录和文件显示 +/− 统计），右侧合并 diff 列表（每个文件一个区块，头部是路径和统计）。
- `ReviewDiffBlock.tsx`：统一视图 / 并排视图切换、自动换行开关（全局设置）、`F7` / `Shift+F7` 在改动间跳转。
- 解析用 `diff` 包的 `parsePatch`；并排视图复用 `@codemirror/merge`。
- 文件树与 diff 列表的宽度、展开状态按工作区记住（沿用 workbench 布局存储）。

## 4. 行级批注

### 4.1 数据：`kun/src/contracts/review.ts`（新增）

```ts
export const ReviewCommentSchema = z.object({
  commentId: z.string().regex(/^rvc_[a-z0-9]{8,32}$/),
  workspaceId: z.string(),                          // 任务工作区
  dispatchId: z.string().optional(),                // 针对哪次派活的结果
  path: z.string().max(4_096),
  side: z.enum(['new', 'old']),
  line: z.number().int().positive(),
  anchor: z.object({
    lineText: z.string().max(2_000),
    before: z.array(z.string().max(2_000)).max(3),
    after: z.array(z.string().max(2_000)).max(3)
  }).strict(),
  body: z.string().min(1).max(4_000),               // markdown
  state: z.enum(['draft', 'sent', 'resolved']),
  outdated: z.boolean().default(false),
  sentInRequestId: z.string().optional(),
  author: z.enum(['user', 'reviewer']),             // reviewer = 10 §5 的审查 agent 产出后转成的批注
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict()
```

存在 kun（`dataDir/ade/reviews/<workspaceId>.json`），这样手机端也能看到和发送。

### 4.2 交互

- 鼠标悬停 diff 行时行号栏出现"+"；键盘焦点在某行时按 `c` 新建批注；`Cmd/Ctrl+Enter` 保存，`Esc` 取消。
- 批注默认是草稿，面板顶部显示"N 条待发送"和"发送给…"按钮。
- 已发送的批注保留，便于核对修改；"解决"后折叠。
- 未解决的批注会进入下一批。

### 4.3 重新定位

每次重新采集后，对未解决的批注执行：

```ts
export function reanchor(comment: ReviewComment, file: FileVersion): { line: number } | { outdated: true } {
  // 1. 原行号附近 ±20 行内，找 lineText 完全相同且前后各 3 行上下文最相似的一行
  // 2. 找不到则在全文件里找 lineText + 上下文完全匹配的唯一一行
  // 3. 仍找不到（或有多个同样好的候选）→ outdated，UI 显示"代码已变化"，批注仍可发送但不再指向具体行
}
```

纯函数，放在 `src/shared/review-anchor.ts`，kun 与 renderer 共用。

### 4.4 发送

`POST /v1/reviews/:workspaceId/send`：

```ts
body: {
  commentIds: string[]
  target:
    | { kind: 'worker'; workerId: string }        // 默认：产生这些改动的 worker
    | { kind: 'manager' }                         // 交给总管，由总管分派
    | { kind: 'new-worker'; harnessId?: string }  // 新开一个 worker 在同一工作区修改
  note?: string                                   // 用户附加的总体说明
}
```

宿主确定性生成"修改请求"：

```text
<kun_review_request round="2" workspace="tws_k2j4">
请根据以下审查意见修改。每条意见都对应具体位置。
{note}

1. src/login/api.ts 第 42 行（新版本）
   代码：const timeout = 5000
   意见：超时应该从配置读取，不要写死。

2. src/login/LoginForm.tsx 第 88 行（代码已变化，原文：setError(e.message)）
   意见：错误信息要走 i18n。

完成后，逐条说明处理结果：已修改 / 不同意（附原因）。
</kun_review_request>
```

- `worker`：作为一次新派活（09 §4 的 `worker_send`，`mode: 'queue'`），同一个 worker、同一个工作区。
- `manager`：作为用户消息的附加上下文进入总管线程（界面上显示为"审查意见 ×N"卡片），总管决定怎么分派。
- `new-worker`：`worker_create`，工作区复用原任务工作区（不新建 worktree），适合原 worker 已释放的情况。
- 发送后批注标为 `sent` 并记录 `sentInRequestId`；worker 完成后重新采集、重新定位。

为什么要批量：逐条发送会让 agent 来回改；一次发出所有意见，agent 做一轮完整的修改，命中率更高。

## 5. 赛马比较视图（P2）

`src/renderer/src/components/review/RaceCompareView.tsx`：

| 行 | 每个参赛者一列 |
| --- | --- |
| agent | 图标、名称、模型 |
| 执行状态 / 验收 | 两个独立徽标（10 §4.3） |
| 改动 | 文件数、+/− 行数，点击打开该工作区的审查面板 |
| 检查 | 检查结果列表 |
| worker 汇报 | 摘要，可展开 |
| 耗时 / 用量 / 估算费用 | 用量来自 Kun 的用量记录（04 §6、ActivityStore） |
| 总管的推荐 | 若有 |

底部操作：「选为胜者」（进入 §7 的合入流程）、「丢弃其余」（确认对话框，列出将被删除的 worktree 与分支）。

## 6. AI 行归属（P2）

### 6.1 来源

| 来源 | 可得信息 |
| --- | --- |
| Kun 原生的文件写入工具 | 写入前后全文 |
| ACP `fs/write_text_file`（03 §8.1 的 `recordFileChange`） | 写入前后全文 |
| ACP 工具调用的 `diff` 内容 | 路径、旧文本、新文本 |
| Claude SDK / Cursor SDK 的编辑类工具事件 | 工具输入里的替换片段 |
| 终端 agent 的 `PostToolUse` hook（尽力而为） | 路径 |

### 6.2 账本：`kun/src/ade/attribution-ledger.ts`

```ts
type AttributionEntry = {
  path: string
  lineHashes: string[]            // 该次写入后，写入范围内每一行内容的哈希
  unitId: string                  // worker / 线程
  harnessId: string
  dispatchId?: string
  at: string
}
```

- 每次记录到写入事件时，计算写入范围内新行的内容哈希存入账本（每个工作区一个文件，`dataDir/ade/attribution/<workspaceId>.json`，上限 50 k 条，超出按时间淘汰）。
- 显示时：对当前文件每一行算哈希，在账本里找**最近一次**写入过这个哈希的条目 → 归属该 agent；找不到 → 归属"人工或未知"。人改过的行哈希变了，自然回到"人工"。
- 行号栏用 agent 的身份色标记（身份色表固定 10 色，与状态色无关，12 §2），悬停显示"由 Codex 写入（派活 dsp_…）"。
- 只存本地，不提交进 git；审查面板提供"导出归属（JSON）"。

限制写进 UI 说明：只能标出经过 Kun 可观察通道的写入；agent 在终端里用脚本批量改文件时无法归属。

## 7. 合入与发布

### 7.1 面板操作

审查面板顶部（按条件显示）：

| 按钮 | 条件 | 调用 |
| --- | --- | --- |
| 应用到当前分支 | 源 checkout HEAD 未动、无重叠未提交改动 | `integrate { mode: 'apply-patch' }`（07 §8.2） |
| 合并分支 | 工作区有分支 | `integrate { mode: 'merge-branch' }` |
| 提交 | 工作区有未提交改动 | 在 worktree 内提交；默认提交信息 = 任务标签 + worker 汇报第一句，用户可改 |
| 推送并创建 PR | 有远程；本机 `gh` 已安装并登录 | §7.2 |
| 丢弃 | 任意 | `discard`，确认对话框 |

- 按钮一次只高亮一个主操作（12 §2 的"一页最多一个主按钮"）：有 PR 时主操作是"查看 PR"，否则是"合并分支"或"应用到当前分支"。
- 总管通过 `workspace_integrate` 工具发起合入时，走审批（envelope kind `file`，目标是源 checkout），用户确认后才执行；无人值守时不合入，只在通知里说明"待你合入"。

### 7.2 PR 与 CI（P2）

- 创建：在 worktree 里 `git push -u <remote> <branch>`，然后 `gh pr create --base <目标分支> --head <branch> --title <标题> --body-file <临时文件>`；正文包含任务说明、worker 汇报、验收结论和检查结果。
- 状态：面板打开时每 60 秒 `gh pr view <number> --json state,title,url,statusCheckRollup` 刷新（面板关闭即停止，节省 `gh` 的 API 额度）。
- 展示：PR 标题、状态（open / merged / closed / draft）、检查列表（名称、状态、耗时）、"全部通过 / N 个失败"汇总；失败的检查可以一键把日志摘要作为修改请求发回 worker（同 §4.4 模板）。
- 内部命名用"change request"，UI 按平台显示 PR 或 MR；只有具体行为依赖某平台时才出现平台名。

### 7.3 待复核分支

`GET /v1/task-workspaces/preserved-branches` 的列表显示在设置 → 工作区清理页：分支名、所属仓库、最后提交、未合入的提交数；每个分支单独确认后才强制删除。

## 8. 测试

| 测试 | 断言 |
| --- | --- |
| diff 接口 | 与 `git diff --cached <base>` 结果一致；二进制与超大文件只给统计 |
| `review-anchor.test.ts` | 行移动后正确重新定位；多候选或找不到时 outdated；纯函数在两端结果一致 |
| 发送 | 三种目标各生成正确的请求；请求文本确定；发送后状态与 requestId 正确 |
| 批注跨端 | 桌面新建的批注在手机端可见，可从手机发送 |
| 归属 | 三种来源写入后行归属正确；人工修改后该行回到人工；账本上限淘汰 |
| 合入按钮 | 按条件显示；总管发起的合入需要审批；无人值守不合入 |
| PR | `gh` 未安装或未登录时按钮置灰并说明原因；状态刷新只在面板打开时进行 |
| 渲染 | 审查面板在窄窗口下不出现横向滚动（文件树可折叠） |

## 9. 文件清单

新增：

- `kun/src/contracts/review.ts`
- `kun/src/ade/review-store.ts`、`revision-request.ts`（修改请求模板；与 10 的交叉审查 `review-request.ts` 区分）、`attribution-ledger.ts`、`change-request-service.ts`
- `kun/src/server/routes/reviews.ts`
- `src/shared/review-anchor.ts`
- `src/renderer/src/components/review/ReviewPanel.tsx`、`ReviewFileTree.tsx`、`ReviewDiffBlock.tsx`、`ReviewCommentThread.tsx`、`ReviewSendMenu.tsx`、`RaceCompareView.tsx`、`ChangeRequestPanel.tsx`

修改：

- `kun/src/server/routes/task-workspaces.ts`（diff 接口）
- `kun/src/runtime/acp/acp-client-host.ts`、SDK 事件映射（写入事件进归属账本）
- `src/renderer/src/extensions/contribution-ids.ts`（新增右侧面板 id `builtin:right-panel-review`）
