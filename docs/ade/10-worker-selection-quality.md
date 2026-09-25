# 10 Worker 选择、验收、交叉审查与赛马

- 阶段：P1（选择、额度感知、验收）；P2（赛马、自动检查）
- 依赖：01、02、07、09
- 被依赖：11、12

## 1. 目标

1. 总管不指定 agent 时，宿主按**角色 × harness × 模型**选出合适的 worker，并**避开快用完额度的订阅**。
2. 执行结束（done）和质量合格（passed）是两条独立的轴，分别记录。
3. 支持让另一个 agent 交叉审查，以及同一任务交给多个 agent 并排比较。

## 2. `harness_list` 工具

总管在派活前可以看"手里有什么"：

```ts
output: {
  agents: Array<{
    harnessId: string; displayName: string
    ready: boolean; notReadyReason?: string              // 未安装 / 未登录 / 版本过低
    models: Array<{ model: string; providerId?: string; credentialMode: HarnessCredentialMode }>
    admission: { managerWorker: boolean; missing?: HarnessCapabilityKey[] }
    quota?: { tightestUsedPercent?: number; resetsAt?: string; status: 'ok' | 'tight' | 'exhausted' | 'unknown' }
    notes?: string                                        // 用户写的"适合做什么"（§3.1）
  }>
  profiles: Array<{ id: string; name: string; harnessId?: string; model?: string; description?: string }>
}
```

结果只进工具输出（动态），不进稳定前缀。

## 3. 选择

### 3.1 worker profile

扩展现有 `SubagentProfileConfig`（`kun/src/contracts/capabilities-core.ts:328`），不另建一套：

```ts
harnessId: HarnessIdSchema.optional(),              // 省略 = kun 原生
credentialMode: HarnessCredentialModeSchema.optional(),
/** 写给总管看的使用说明：适合什么任务、不适合什么。参与召回检索 */
delegationNotes: z.string().max(1_000).optional()
```

- 设置页"Agents"分组里，每个 profile 可以选 agent（harness）和模型；内置 profile（general、explore、reviewer 等）默认 `kun`。
- `.kun/agents/*.md` 的 frontmatter 同样可以写 `harness:`、`model:`，由 `workspace-agents.ts` 解析。

### 3.2 算法：`kun/src/ade/worker-selector.ts`

```ts
export async function selectWorkerRoute(input: {
  task: string
  role?: string
  managerCtx: ManagerToolContext
  exclude?: { harnessIds?: string[] }                    // 交叉审查时排除实现者的 harness
}): Promise<{ route: HarnessRoute; profileId?: string; reason: string; alternatives: RouteCandidate[] }> {
  // 1. 候选：启用的 profile（带 harness）+ 每个就绪 harness 的默认路由
  const candidates = await buildCandidates(input.managerCtx)
  // 2. 准入过滤（02 §5，usage 'manager-worker'）
  const admitted = candidates.filter((c) => c.admission.ok && !input.exclude?.harnessIds?.includes(c.route.harnessId))
  if (!admitted.length) throw new NoEligibleWorkerError(summarizeRejections(candidates))
  // 3. 角色匹配：复用 SubagentRouter 的 BM25 召回（subagent-router.ts:236 recallSubagents），文档加上 delegationNotes
  const recall = recallSubagents(`${input.role ?? ''}\n${input.task}`, admitted.map(toRoutingDocument))
  // 4. 确定性打分
  const quota = await quotaSnapshot()                     // ProviderQuotaService.list()，缓存 60 秒
  const scored = admitted.map((c) => ({ c, score:
      1.0 * normalizedRecall(recall, c)
    + 0.5 * userPreference(c)                             // 设置里的 agent 优先级顺序
    - quotaPenalty(quota, c)                              // 见下
    - 0.3 * recentFailurePenalty(input.managerCtx.teamId, c)   // 本 team 最近 1 小时同 harness 失败次数
    - 0.2 * costTier(c)                                   // 按模型定价分档：0 便宜 / 1 中 / 2 贵
  })).sort((a, b) => b.score - a.score)
  // 5. 前两名差距很小（< 0.05）时，可选用小模型裁决（与 SubagentRouter 相同的 JSON 约束与超时）；否则直接取第一
  const pick = await maybeTieBreak(scored, input)
  return { route: pick.c.route, profileId: pick.c.profileId, reason: explain(pick, quota),
    alternatives: scored.slice(1, 4).map((s) => s.c) }
}
```

额度惩罚：

```ts
function quotaPenalty(snapshot: ProviderQuotaListResponse, c: RouteCandidate): number {
  const entry = snapshot.entries.find((e) => e.providerId === quotaProviderIdFor(c.route))
  if (!entry || entry.status !== 'available') return 0              // 未知：不惩罚也不加分
  const tightest = Math.max(0, ...entry.metrics.map((m) => m.usedPercent ?? 0))
  if (tightest >= 95) return Number.POSITIVE_INFINITY               // 视为不可用（直接排除）
  if (tightest >= 80) return 0.8
  return 0
}
```

- `quotaProviderIdFor`：`native-login` 路由映射到对应订阅 provider（例如 Claude Code → `claude-subscription`）；`kun-gateway` / `provider` 路由直接用 providerId。
- `ProviderQuotaService` 已有 `usedPercent`、`resetsAt`（`kun/src/contracts/provider-quota.ts`）；缺少探测器的订阅显示为 unknown，不影响选择。
- `reason` 是给总管和用户看的一句话，例如："选择 Codex（gpt-5.5）：适合实现类任务；Claude 订阅 5 小时额度已用 92%，暂不使用。"它会进入 `worker_create` 的 `userReport`。

### 3.3 可复现

选择结果写进 `WorkerRecord` 和 `ChildRunRecord.routing`（现有字段，记录 route method、候选、理由、置信度），与现有子代理路由的诊断口径一致。

## 4. 验收：完成不等于通过

### 4.1 数据

```ts
export type QualityVerdict = {
  status: 'pending' | 'passed' | 'needs_changes' | 'rejected' | 'waived'
  decidedBy?: 'manager' | 'user' | 'reviewer'
  reviewerWorkerId?: string
  checks: Array<{ name: string; status: 'passed' | 'failed' | 'skipped'; source: 'worker' | 'host' | 'reviewer'; detail?: string }>
  notes?: string
  decidedAt?: string
}
```

- 存在 `DispatchRecord.verdict`（09 §3.2），与 `state`（执行状态）分开。**不要**把"检查没过"塞进 dispatch 的 `failed`：worker 的执行可以是 completed，而验收是 needs_changes。
- 新派活创建时 `verdict.status = 'pending'`。

### 4.2 工具（加入 09 的工具列表）

| 工具 | 作用 |
| --- | --- |
| `worker_verdict({ dispatchId, status, notes? })` | 总管记录验收结论 |
| `workspace_run_checks({ workerId, names? })` | 宿主在 worker 的工作区里跑项目配置的检查命令，结果写入 `verdict.checks`（P2） |

`workspace_run_checks`：检查命令来自 `.kun/project.json` 新增的 `worktree.checks`（结构同 `setup`，07 §6），同样需要用户按内容哈希批准；在 worker 的任务工作区里用受管进程执行，超时和日志规则同 setup。

### 4.3 UI

执行状态与验收结论是两个独立徽标（12 §4）：例如"已完成 · 待验收"、"已完成 · 需修改"、"失败"。用户也可以在审查面板里直接给出结论（`decidedBy: 'user'`，覆盖总管的结论）。

## 5. 交叉审查

`review_request`：

```ts
input: {
  workerId: string                   // 被审查的 worker
  dispatchId?: string                // 默认该 worker 最近一次完成的派活
  reviewer?: { harnessId?: string; model?: string }   // 省略时自动选，且排除被审查者的 harness
  focus?: string                     // 审查重点，如 "并发安全" "接口兼容"
}
```

1. 选审查者：`selectWorkerRoute({ role: 'reviewer', exclude: { harnessIds: [被审查者 harness] } })`。不同 agent 犯的错不同，换一个 agent 审查更容易发现问题。也可以选 `kun` 原生，复用现有的代码审查角色模型（`roles.codeReviewModel`）。
2. 审查者是一个 ephemeral worker：
   - 工作区 = 被审查者的任务工作区，**只读**（sandbox `read-only`，`toolPolicy: 'readOnly'`）。
   - 输入：被审查的 patch（07 的采集结果，超出预算时给文件列表 + 按需读取）、原任务说明、worker 汇报、`focus`。
   - 要求用 `submit_result` 返回结构化发现：`{ outcome, summary, checks: [...], risks: [...] }`。
3. 审查完成 → 通知总管；审查发现合并进被审查派活的 `verdict.checks`（`source: 'reviewer'`）；最终结论由总管或用户写。
4. 需要修改时，总管可以把审查发现原样（或整理后）`worker_send` 给原 worker；这和 11 的批注回传走同一个"修改请求"模板。

## 6. 同题赛马（P2）

`worker_race`：

```ts
input: {
  label: string
  task: string
  contenders: Array<{ harnessId: string; model?: string }>   // 2–3 个
  startFrom?: StartFrom
}
```

1. 为每个参赛者建一个 ephemeral worker，**从同一个起点**各切一个 worktree（07），派同一份任务。
2. `RaceRecord { raceId, label, dispatchIds, state: 'running' | 'ready' | 'decided', winnerDispatchId? }`，存 team 目录。
3. 全部结束（或超过设定时长，未完成的标记为超时）后，宿主生成比较数据：每个参赛者的执行状态、diff 统计、检查结果、worker 汇报、耗时、用量与估算费用。
4. 总管拿到比较数据给出推荐（写进 `notes`），**最终由用户在比较视图里选定**（11 §5）。无人值守场景下总管不能自动合入赛马结果。
5. 选定后：胜者进入正常审查与合入流程；其余参赛者的 worktree 在用户确认后丢弃（有未提交改动时二次确认），分支按 07 §8.3 处理。

## 7. 测试

| 测试 | 断言 |
| --- | --- |
| `worker-selector.test.ts` | 准入过滤；额度 ≥95% 排除、≥80% 降权、未知不影响；用户偏好顺序；最近失败降权；打分确定（相同输入相同输出） |
| 审查排除 | 交叉审查不会选到被审查者的 harness（除非只有它可用，此时明确报错而不是悄悄选它） |
| 理由文案 | `reason` 包含被排除原因（额度、未登录） |
| profile 扩展 | `SubagentProfileConfig` 新字段通过 IPC strict schema 与 kun 配置往返不丢失 |
| 验收 | verdict 与 state 独立；用户结论覆盖总管结论 |
| 检查命令 | 未批准不执行；在 worker 工作区执行；结果写入 checks |
| 审查者 | 只读沙箱；输入包含 patch 与任务；发现合并进 verdict.checks |
| 赛马 | 同起点；超时参赛者标记；无人值守不自动合入；丢弃需要确认 |

## 8. 文件清单

新增：

- `kun/src/ade/worker-selector.ts`、`quota-snapshot.ts`、`quality-verdict.ts`、`review-request.ts`、`race.ts`、`check-runner.ts`
- `kun/src/ade/tools/harness-list.ts`、`worker-verdict.ts`、`workspace-run-checks.ts`、`review-request.ts`、`worker-race.ts`

修改：

- `kun/src/contracts/capabilities-core.ts`（profile 字段）
- `kun/src/delegation/workspace-agents.ts`（frontmatter 字段）
- `kun/src/config/project-config.ts`（`worktree.checks`）
- `src/shared/app-settings-types-kun-runtime.ts`、`app-settings-kun.ts`、`src/main/ipc/app-ipc-schemas/settings-model.ts`（profile 字段、agent 优先级）
