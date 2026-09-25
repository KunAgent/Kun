# 关键流程时序

记号：`R` = renderer，`M` = main，`K` = kun serve，`A` = 外部 agent 进程，`W` = worker 线程，`Mgr` = 总管线程。
每个流程先写正常路径，再列失败分支。实现与测试以此为准。

---

## F1 一对一：ACP harness 上的一轮（含审批、写文件、取消）

```text
R  → K   POST /v1/threads/:id/turns { prompt, harnessId: 'gemini-cli' }
K        准入（P0-04）：冻结 harnessId / credentialMode；usage = one-to-one
K        HarnessRouter.resolve → AcpRuntime（P0-05 准入通过）
K        AcpRuntime.runTurn
K  → A   （连接池没有进程）spawnOwnedProcess；initialize
K  → A   session/new { cwd, mcpServers: [kun-tools(http, Bearer kgw_…)] }  或 session/load（有原生会话）
K  → A   session/prompt { prompt: [handoff?（新会话且有历史）, 用户文本, 图片?] }
A  → K   session/update agent_message_chunk ×N        → K 记录 assistant_text_delta（增量）
A  → K   session/update tool_call { kind: 'edit' }      → K tool_call_ready + item_created
A  → K   session/request_permission                     → K ApprovalGate → R 显示审批
R  → K   POST /v1/approvals/:id allow                   → K 回复 { selected: allow_once }，记入 ApprovalMemo
A  → K   fs/write_text_file { path }                    → K 路径校验 → 命中 memo 不再审批 → 检查点 → 原子写 → file_change 结果
A  → K   session/update tool_call_update completed      → K tool_call_finished
A  → K   response { stopReason: 'end_turn' }
K        mapper.flush → assistant_text item；coordinator.commit（native 会话 id）
K        TurnRunOutcome = completed → ActivityStore done → R 通知（若不在前台）
```

失败分支：

| 情况 | 处理 |
| --- | --- |
| 命令不存在 / 未登录 | 准入阶段就失败：turn failed `harness_not_ready`，没有进程被启动 |
| initialize 超时 | turn failed，附脱敏 stderr；连接标记不健康 |
| 用户点"停止" | K 先把挂起的权限回复 cancelled → `session/cancel` → 等 10 秒 → agent 回复 cancelled → turn aborted；不回复 → 连接不健康，下次重建进程 |
| 写工作区外的路径 | `fs/write_text_file` 回 JSON-RPC 错误，agent 自行处理；文件不变 |
| agent 进程在一轮中崩溃 | turn failed `harness_crashed`；绑定标 native_state_unavailable；下一轮全新会话 + 全量简报 |
| 10 分钟没有任何 update 且无挂起审批 | ActivityStore `stalled`，通知用户；不自动终止 |

---

## F2 同一线程切换 harness：停泊与增量（A → B → A）

```text
第 5 轮：harness = claude-code（native 会话 s1）
  commit：binding { route: claude-code…, nativeSessionId: s1, priorItemCount: 40, digest: d40 }

第 6 轮：用户在 composer 选 Codex，确认"将开新的原生会话"
  prepare(route = codex)：route 不匹配
    → 当前绑定停泊：parked = [{ key: claude-code…, s1, lastCommittedTurnId: t5, digest: d40, priorItemCount: 40 }]
    → 没有 codex 的停泊项 → 全新会话，rebaseReason route_changed
  prompt = <kun_handoff reason="harness-switch" mode="full">…</kun_handoff> + 用户文本
  commit：binding { route: codex…, nativeSessionId: c1 }

第 8 轮：用户切回 Claude Code
  prepare(route = claude-code)：route 不匹配
    → codex 绑定停泊；找到 claude-code 的停泊项
    → 前缀校验：当前历史前 40 条的 digest == d40 ✓
    → resumed: true, nativeSessionId: s1, parkedDelta: { lastCommittedTurnId: t5 }
  prompt = <kun_handoff mode="delta">你离开期间发生了：第 6、7 轮…</kun_handoff> + 用户文本
  SDK query({ resume: s1, … })
```

失败分支：

| 情况 | 处理 |
| --- | --- |
| 第 6、7 轮之间用户删除了第 3 轮消息 | 前缀校验失败 → 放弃停泊，全新会话 + 全量简报 |
| s1 在 harness 侧已过期（resume 报错） | `rejectResume` → 全新会话 + 全量简报（reason rebase） |
| 停泊超过 3 条 | 淘汰最旧的，并清除其 provider-state 子目录 |

---

## F3 总管派活到唤醒（主流程）

```text
用户 → Mgr   "把登录错误提示和接口超时两个问题并行修掉"
Mgr（原生 loop）调用 worker_create_batch([{ label: 登录修复, … }, { label: 接口超时, agent: { harnessId: 'codex' } }])
K  对每一项（顺序执行）：
   1. team.ensure；数量上限检查
   2. 路由：第一项自动选择（P1-15）→ claude-code；第二项显式 codex
   3. 权限：clampPermission（总管 approve-for-me）→ 两个 worker 均不高于该档
   4. 准入 manager-worker（isolated worktree）✓
   5. TaskWorkspaceService.create → 记录 creating（后台：解析起点 → worktree add → 共享目录 → 复制 .env → setup）
   6. 预分配 childId；team.upsertWorker；ActivityStore.register(worker, initializing)
   7. dispatch.create(pending)；tryDeliver → 工作区未就绪 → pending('workspace')
K  → Mgr   工具结果 { created: 2, userReport: "已创建 2 个 worker……就绪后自动开始" }
Mgr        向用户说明后结束本轮（不等待）

（后台）工作区 ready → handleWorkspaceChange → tryDeliver
K  dispatch → delivering（落盘）
K  runChild({ childId, launcher: 'manager-worker', detach: true, clientRequestId: dispatchId,
             prompt: <kun_assignment>…, security, workspace: tws.path, harnessId })
K  child executor 建 side 线程 W（executionUnit.kind = worker），startTurn（带 clientRequestId）
K  dispatch → accepted；turn_started 事件回填 turnId
W  （Claude SDK / Codex ACP 运行，工具桥里有 report_progress / ask_manager / submit_result）
W  report_progress → ActivityStore.progressNote（看板实时显示）
W  submit_result → dispatch.workerReport
W  turn completed
K  runAgentTurn 钩子 → handleWorkerTurnTerminal
     capture（git add -A + diff --cached base）→ dispatch completed + diff 统计
     notices.enqueue(完成通知) → 3 秒合并窗口
     tryDeliverNext（队列里没有）
（两个 worker 相继完成，都在 3 秒窗口内）
K  deliverForManager：Mgr 空闲 → startTurn({ messageSource: 'worker_update', clientRequestId: batchId,
                                            prompt: <kun_worker_updates>两条… })
Mgr  读到更新：调用 review_request 让另一个 agent 审查"接口超时"；把"登录修复"的结论写 worker_verdict(passed)
Mgr  向用户汇报：两个任务由谁完成、改动统计、验收状态、下一步
```

失败分支：

| 情况 | 处理 |
| --- | --- |
| 第二项准入失败（Codex 未登录） | 该项 failed，第一项正常；userReport 写明原因 |
| 批量中途达到硬上限 | 其余项 skipped |
| 工作区创建失败（setup 失败） | dispatch failed（`workspace failed: …`），通知总管；worktree 保留供查看 |
| worker turn failed | dispatch failed，通知里附失败原因与 worker 线程链接 |
| 总管在通知到达时正在运行 | 退避重试，总管这一轮结束后投递 |
| 用户正在总管线程打字 | hold 生效；用户发送时通知作为上下文附上并确认 |

---

## F4 worker 提问

```text
W   ask_manager({ question: "是否同时修改暗色主题？", options: ["是", "否"], timeoutSeconds: 600 })
K   找到 accepted dispatch；questions.create；ActivityStore W → waiting(question)
K   notices.enqueue(question) → 唤醒 Mgr（同 F3 的合并与重试）
Mgr 读到问题：
    (a) 能回答 → worker_answer({ questionId, answer: "是" })
    (b) 需要用户 → user_input（问题出现在总管线程的输入面板）→ 用户回答 → Mgr worker_answer
K   questions.answer → 唤醒等待中的 askManager → W 的工具调用返回 { status: 'answered', answer }
K   ActivityStore W → working
```

失败分支：

| 情况 | 处理 |
| --- | --- |
| 超时 | 返回 `{ status: 'timeout' }`；问题记录 timeout；worker 按保守假设继续并在结果里写明 |
| 用户在 Mission Control 卡片上直接回答 | `answeredBy: 'user'`，同样唤醒 worker；总管下次被唤醒时看到"问题已由用户回答" |
| worker 的 turn 在等待中被停止 | 返回 cancelled；问题记录 cancelled |
| 应用重启 | 未回答问题置 timeout（worker 那一轮已随进程结束） |

---

## F5 崩溃恢复

应用或 kun 进程在任意时刻退出后重新启动，`ManagerRuntime.reconcileOnStartup` 与各服务的启动逻辑：

| 退出时所处的状态 | 恢复 |
| --- | --- |
| dispatch `pending` | 保持；工作区就绪或 worker 空闲时再投递 |
| dispatch `delivering` / `uncertain` | 在 W 里找 `clientRequestId === dispatchId` 的 turn：有 → accepted；无 → 用同一 id 重新投递（幂等） |
| dispatch `accepted`，W 的 turn 已终态 | 补跑 `handleWorkerTurnTerminal`（采集 + 通知） |
| dispatch `accepted`，W 的 turn 被中断 | Kun 现有的中断 turn 恢复流程处理 turn；dispatch 随其终态更新 |
| 通知未确认 | `replayPending` 重新投递（批次幂等键不变） |
| 问题 open | 置 timeout |
| 任务工作区 `creating` / `setting-up` | 置 failed（interrupted），用户或总管可重试 |
| ActivityStore | 结构化单元从 ThreadStore 重建；终端 agent 行 restoredUnconfirmed |
| 停泊会话 | 持久化在绑定文件里，不受影响 |
| ACP 连接 | 进程已随应用结束；下一轮重新启动并 load / 新建会话 |

---

## F6 审查闭环：批注 → 修改 → 合入

```text
R   用户在审查面板对 3 行留言（草稿，防抖同步到 K 的 review-store）
R → K  POST /v1/reviews/:tws/send { commentIds, target: { kind: 'worker', workerId } }
K   renderRevisionRequest(round 2) → teams.dispatchFromGui(workerId, { task: request, mode: 'queue' })
K   批注 → sent（sentInRequestId）
W   修改 → turn completed → capture → reanchor（未解决批注重新定位）→ 通知总管
R   面板刷新 diff；用户确认修改，解决批注
R → K  GET /v1/task-workspaces/:id/integrate-preview → { canMergeBranch: true, … }
R   主操作"合并分支" → POST …/integrate { mode: 'merge-branch' }
K   worktree 内提交 → 目标前进则 rebase → 源 checkout ff-only 合并 → 断言源未提交文件未被改动
K   → { outcome: 'merged' } → cleanupIntegrated（worktree remove、branch -d）
```

失败分支：

| 情况 | 处理 |
| --- | --- |
| rebase 冲突 | `conflict`，保留 worktree 与分支，结果对话框给恢复步骤 |
| 源 checkout 不在目标分支 | `needs_human`，提示切换分支或改用 apply-patch |
| worker 已被用户接管 | 发送目标为 worker 时被拒绝，提示发给当前接管者（即用户自己在该线程继续） |
| branch -d 失败 | 分支进入待复核列表 |

---

## F7 权限升级确认

```text
Mgr（ask-for-approval 档）调用 worker_create({ …, permissionMode: 'bypassPermissions' })
K   clampPermission：请求档（full-access）> 总管档 → effective 降级；交互场景 needsUserConfirmation
K   requestUserOnlyEscalation → awaitApproval(信封 external-effect, reviewerRequirement: 'user')
R   审批卡片："允许 worker「登录修复」以完全访问运行，仅限工作区 …"
    (a) 允许 → effective = bypassPermissions，继续创建
    (b) 拒绝 / 超时 → 工具返回 escalation_declined，没有任何副作用
```

无人值守（IM / 定时触发的总管 turn）：不发审批，直接降级（`allowUnattendedFullAccess` 打开时除外）。

---

## F8 Claude Code + DeepSeek（经网关）

```text
R → K  POST turns { harnessId: 'claude-code', providerId: 'deepseek', model: 'deepseek-v4-pro' }
K   准入：credentialMode = kun-gateway（claude-code + http provider）；网关已启用 ✓
K   HarnessTokenService.issue({ threadId, harnessId, scopes: ['gateway', 'kun-tools'],
      routes: [{ deepseek, deepseek-v4-pro, main }, { roles.smallModel, small }] })
K   Claude SDK query：env ANTHROPIC_BASE_URL=http://127.0.0.1:<port>，ANTHROPIC_AUTH_TOKEN=kgw_…，
      ANTHROPIC_MODEL=kun/deepseek/deepseek-v4-pro；剥离 CLAUDE_CODE_OAUTH_TOKEN 与 provider 密钥
A → K  POST /v1/messages（Bearer kgw_…）
K   kgw guard：scope gateway 允许 /v1/messages ✓；parseGatewayModelId → deepseek / deepseek-v4-pro ∈ grant ✓
K   anthropicToModelRequest → modelClient.stream → DeepSeek → toAnthropicSse
K   usage 记账：thread = grant.threadId，turn = 该线程当前运行的 turn，source harness-gateway
A   （SDK 自报的 usage 只进 context_snapshot，不重复入账）
```

失败分支：

| 情况 | 处理 |
| --- | --- |
| harness 请求 grant 外的模型 | 404 model_not_found，SDK 报错，turn failed 并提示检查模型设置 |
| 带图片且目标模型不支持视觉 | 400 unsupported_content，说明原因 |
| DeepSeek 返回错误 | 映射为 Anthropic `error` 事件；Kun 的模型请求重试策略照常生效（重试对 harness 透明） |
