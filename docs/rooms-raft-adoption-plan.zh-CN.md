# Rooms（bot 模式）借鉴 Raft 的实现计划

> 状态：草案，尚未实现。依据 2026-09-25 对 `raft-source` 与本仓库 `develop`（`8e2956ef0`）的代码阅读。
> 本文只描述 Kun Rooms 的改动；Raft 仅作为思路参照。

## 0. 背景、目标与约束

### 0.1 背景

Raft 是"人与 agent 在频道里协作"的平台：agent 是真实进程，只通过 `raft` CLI 发言，靠频道成员资格、
thread 关注、@ 与静音决定谁被唤醒，靠提示词礼仪与发送前"新鲜度拦截"控制噪音，靠 Action Card
让人以自己的身份确认 agent 起草的结构化动作，靠作者自有的 reminder 做延时跟进。

Kun Rooms 在执行流水线（worktree 隔离、声明检查、固定交付、独立评审、集成/应用/清理）、精确 run
记录、持久化身份与恢复、结构化记忆方面已经更强。本计划只引入 Rooms 目前缺失、且与 Kun 单 runtime
与"只有用户能授权执行"原则相容的部分。

### 0.2 条目与优先级

| 编号 | 条目 | Raft 参照 | 价值 | 改动面 |
| --- | --- | --- | --- | --- |
| P0-1 | 协作礼仪与沟通规范 | `packages/daemon/src/drivers/raftCliGuide.ts` | 减少复读/刷屏，提升可读性 | 小 |
| P0-2 | `send_room_message` 发送时新鲜度拦截 | `agentInboxStateMachine.ts`、`cli/.../message/send.ts` | 少一次整轮重跑，省预算 | 中 |
| P0-3 | 按需协作手册工具 `read_room_playbook` | `raft manual` + `manual/recipes` | 不膨胀提示词即可给出协作套路 | 小 |
| P1-1 | 提议卡（agent 起草、用户确认） | `actionCardsService.ts` | 把文字建议变成一键确认 | 大 |
| P1-2 | 私聊 agent 的提醒 | `daemon/src/apps/reminder`、`manual/.../reminder.md` | 补上"稍后跟进"能力 | 中 |
| P1-3 | 私聊忙碌时新消息并入当前回复 | `drivers/types.ts` 的 `inFlightWake: steer` | 连发多条不再排成多轮 | 中 |
| P1-4 | 成员注意力模式（仅被 @ 时参与） | 频道静音、thread 关注 | 减少参与判断调用 | 中 |
| P2-1 | 调度器空闲退避 | 事件推送式唤醒 | 降低空闲开销 | 小 |
| P2-2 | agent 可见文案登记与快照 | `agentRuntimeInput.ts` 的 `axSurface()` | 防提示词漂移，便于审阅 | 中 |
| P2-3 | 话题"参与者优先"扇出实验 | thread follower 语义 | 进一步减少参与判断 | 中 |
| P2-4 | 轻量认领待办 / agent 工作笔记 | task claim、`MEMORY.md` | 视需求 | 待定 |

### 0.3 非目标

- 不让 Claude Code、Codex 等外部引擎成为房间成员，不引入 CLI 桥接或凭证代理。这违反
  `docs/AGENTS.md` 的单 runtime 规则，且 `docs/rooms-direct-chat.md` 已说明委托型 SDK/CLI 无法强制
  工具与目录限制。
- 不做多人协作、云端执行、跨设备同步、agent 跨机器迁移。
- 不削弱现有边界：讨论只读、只有用户能授权执行、提议永不自动执行、预算 32/8/128 不变。
- 不把动态数据放进稳定前缀；新增提示词只放在每轮输入或线程的静态 system prompt 文本里。

### 0.4 许可边界

`raft-source` 采用 FSL-1.1-ALv2。只借鉴机制与思路，不复制其代码与手册原文；本计划中的提示词、
手册内容全部用 Kun 自己的措辞重写，并贴合 Kun 的术语（邀请、话题、提议卡、执行任务）。

### 0.5 通用约定（所有条目适用）

**分层顺序**：`kun/src/contracts` → `kun/src/rooms`、`kun/src/agents` → `kun/src/server/routes`
→ `src/main/ipc/app-ipc-schemas/runtime.ts`（`compileEndpoint` 白名单）→ `src/shared/rooms-api.ts`
（类型别名）→ `src/renderer/src/components/rooms`（`rooms-client.ts` 与组件）→ 各语言 locale → 文档。

**新增房间工具必须同时改 5 处**，否则会在发现或执行阶段被过滤：

1. 工具实现：`LocalToolHost.defineTool`，`policy: 'auto'`，`sideEffect: 'read-only'`，
   `effects` 全 false，`shouldAdvertise` 限定 step kind；执行时校验线程 `roomContext`、当前 turn
   为 running、run 或 activation 绑定仍然有效（参照 `room-im-message-tool.ts`、`room-peer-tools.ts`）。
2. 注册：`kun/src/rooms/room-result-tools.ts` 的 `roomResultProvider().tools`。
3. 执行期白名单：`kun/src/loop/room-turn-policy.ts` 中 `allowedToolNames` 的交集列表
   （`read_room_rules` 出现的几处都要同步）。
4. 讨论线程白名单：`kun/src/rooms/room-execution.ts` `ensureRoomThread` 中 `allowed.push(...)`。
5. 私聊线程白名单：`kun/src/agents/agent-direct-runner.ts` 创建线程时的 `allowedToolNames`
   （仅当 `policy.allowed` 存在时追加）。

**存储接入**：新文档类型加入 `kun/src/rooms/room-store.ts` 的 `RoomDocumentKindSchema`；由 Runtime
写入的类型加入 `kun/src/manager/service-manager-router-rooms.ts` 第 99 行的 fence 列表；SQLite 使用
通用 `room_documents` 表，`status` 列取自 `value.status`，无需表结构迁移。P1-1 与 P1-2 共用一次能力
升级：在 `kun/src/manager/service-manager-state.ts` 的 `KUN_MANAGER_CAPABILITIES` 增加
`room-store-v6`，旧 Manager 走既有的认证升级路径，并补充 `manager-resolution.test.ts` 用例。

**事务与幂等**：所有写入沿用 `requestId + fingerprint + expectedRevision` 的提交方式；工具调用的
幂等键由 `runId + activeToolCallId` 或 `activation.clientRequestId` 派生，重放不产生第二份副作用。

**功能开关**：在 `kun/src/contracts/agent-identities.ts` 的 `AgentFeaturesSchema` 增加
`proposals`、`reminders`（默认 true），`AgentFeatureControls.tsx` 显示开关；关闭时工具不广告、
执行时拒绝，已有数据保持可读。

**其他**：新增文案同步全部 7 个语言目录（`en zh ja ko ru th hi`），遵守 locale 完整性测试；每个文件不超过 700 行；每个条目落地时更新或新增 `docs/rooms-*.md`。

## 1. P0-1 协作礼仪与沟通规范

**目标**：让成员少复读、不插话、不发空话，交接带证据，面向用户时直白简短。

**现状**：讨论提示词只有几条规则（`room-peer-context.ts` 第 92-101 行）；参与判断的指令在
`room-peer-triage.ts` 第 84-89 行；私聊 system prompt 在 `agent-direct-runner.ts` 第 84-87 行；
交接提示在 `agent-handoff-runner.ts` 第 136-140 行与 `agent-handoff-tools.ts` 的工具描述。

**设计**：新增 `kun/src/rooms/room-collaboration-guidance.ts`，导出四组只读字符串数组，由各处引用，
避免文案散落。文本如下（实现时原样使用，后续调整只改此文件）：

```text
ROOM_PEER_GUIDANCE
- Respect ongoing exchanges. When the user is clearly talking with one specific member, contribute only if you are addressed or hold a concrete correction.
- Only the member who did a piece of work reports on it. Do not restate or summarize another member's result.
- Lead with the answer or decision. Include only what the reader needs to act; cite message, task or file handles instead of pasting logs.
- Separate verified facts from assumptions.
- If you owe a specific person a reply, handoff or decision that currently blocks them, include it before finishing.
- Do not post acknowledgements, thanks or waiting notices; use skip:true instead.

ROOM_DIRECT_GUIDANCE
- For multi-step work, send a one-line plan first, brief progress only when the work is long, and finish with the outcome, any material caveat and the next action.
- Keep messages short and in plain language. Do not paste execution logs; attach a report file when detailed evidence matters.
- Before withholding or delaying an authorized action because of a constraint, re-check its current source. Memory and old messages are not proof that a hold, approval or permission still applies.

ROOM_TRIAGE_GUIDANCE (追加到 contextInstructions)
- Skip when the user is clearly addressing another specific member and you have no correction.
- Skip when your point is already covered by a published response, even if phrased differently.

ROOM_HANDOFF_GUIDANCE
- (send_agent_message 描述追加) Write the body as a compact evidence packet: what you need, why, the handles (message/task ids, file paths), what is verified versus assumed, and the exact question.
- (handoff 回答轮追加) Answer with what you found, where the evidence is, what remains uncertain and what the requester should do next.
```

**改动清单**

| 文件 | 改动 |
| --- | --- |
| `kun/src/rooms/room-collaboration-guidance.ts` | 新增，导出上述常量 |
| `kun/src/rooms/room-peer-context.ts` | `prompt` 数组在现有规则后插入 `ROOM_PEER_GUIDANCE`，删除与之重复的第 95 行措辞 |
| `kun/src/rooms/room-peer-triage.ts` | `contextInstructions` 追加 `ROOM_TRIAGE_GUIDANCE`，保留"Return JSON only"为最后一条 |
| `kun/src/agents/agent-direct-runner.ts` | 线程 `systemPrompt` 数组追加 `ROOM_DIRECT_GUIDANCE`（静态文本，属于线程级前缀，不含动态数据） |
| `kun/src/agents/agent-handoff-tools.ts`、`agent-handoff-runner.ts` | 追加交接文案 |

**边界**：私聊 system prompt 保存在线程记录里，只对新线程生效；不为此改变线程指纹（改指纹会重建
内部会话）。用户执行"重置上下文"后自然生效，文档中说明。参与判断的输入预算（12 KB）只约束
`prompt` JSON，新增指令不占该预算。

**测试**

- 新增 `kun/src/rooms/room-peer-triage.test.ts`：用假 `ModelClient` 捕获 `contextInstructions`，
  断言包含新增两条且最后一条仍要求只返回 JSON。
- 在 `room-peer-runner-correctness.test.ts` 或新增 `room-peer-context.test.ts` 中断言讨论 prompt
  含 `ROOM_PEER_GUIDANCE`，且超长历史的裁剪顺序不变。
- `agent-direct.test.ts` 断言新建私聊线程的 `systemPrompt` 含 `ROOM_DIRECT_GUIDANCE`。

**验收**：离线烟测 `node scripts/smoke-development-rooms.cjs --peer-only` 通过；如用户同意消耗真实
模型额度，再用 `scripts/eval-room-peer.mjs --run` 对比改动前后的消息数、完全重复数和参与判断次数。

## 2. P0-2 `send_room_message` 发送时新鲜度拦截

**目标**：成员起草期间话题有了新消息时，在同一轮内把新消息交给它修改或放弃，而不是等轮次结束后
整轮作废、重新激活（重新激活计入 32/8 预算并增加延迟）。

**现状**

- `send_room_message` 校验 activation 后直接返回 `accepted: true, staged: true`
  （`room-peer-tools.ts` 第 54-61 行）。
- 轮次结束后 `publishPeerMessage` 发现 `basePublicationRevision` 落后即返回 `stale`
  （`room-peer-publication.ts` 第 74 行），runner 释放 activation，未处理的收件箱条目触发新一轮
  （`room-peer-runner.ts` 第 376-379 行）。
- `observeRoomTurn` 取第一个 `accepted === true` 的工具结果作为结构化输出；没有时回退为用
  assistant 文本发布（`room-execution.ts` 第 173-182 行、`room-peer-runner.ts` 第 364-366 行）。

**设计**

1. 常量：`room-peer-types.ts` 增加
   `ROOM_PEER_HOLD_LIMITS = { maxUpdates: 6, maxHolds: 2 } as const`，`RoomPeerActivation` 增加
   `holds?: number`。
2. 在 `RoomPeerStore` 增加 `rebaseActivation`：

   ```ts
   rebaseActivation(rootId: string, memberId: string, activationClientRequestId: string, input: {
     expectedPublicationRevision: number
     itemIds: string[]
   }): Promise<RoomStoredDocument<RoomPeerMemberState> | null>
   ```

   前置条件，任一不满足返回 `null`：activation 存在且 `clientRequestId` 匹配；`phase === 'respond'`；
   `activation.generation === topic.generation`；`current(topic, memberId)` 为真；话题状态为
   `active`、`idle`，或 `paused` 且 `pauseReason === 'budget_exhausted'`；
   `topic.publicationRevision === expectedPublicationRevision`；`seenThroughSeq` 之后本代次全部
   未读条目（`peerInboxRows(..., coalescePeerMessages)`）的 id 与 `itemIds` 完全一致且有序；
   `(holds ?? 0) < maxHolds`。
   提交内容：校验话题与成员的 revision；把新条目追加进 `seenItems`，更新 `seenThroughSeq`、
   `basePublicationRevision = expectedPublicationRevision`、`holds + 1` 与成员的 `seenInboxSeq`；
   `requestId = peerId('rebase', clientRequestId, expectedPublicationRevision, itemIds)`；事件
   `peer.member.updated`。**不改动任何预算计数。**
3. `send_room_message`（非 handoff 分支）在现有校验之后：
   - 若 `topic.publicationRevision === activation.basePublicationRevision`，维持现状返回 staged。
   - 否则读取未读条目：数量在 1 到 `maxUpdates` 之间，且 `holds < maxHolds` 时调用
     `rebaseActivation`；成功则返回（**不是** `isError`，以免触发 `resultError`）：

     ```json
     { "accepted": false, "held": true, "reason": "topic_changed",
       "updates": [{ "id": "<sourceId>", "kind": "message", "authorMemberId": "m2",
                     "body": "<=1500 chars", "truncated": false }],
       "note": "Your draft was not published. These updates arrived after your context was prepared. Revise using them, or call send_room_message with skip:true if they already cover your point." }
     ```

   - 未读超过上限、次数用尽或 rebase 竞争失败时，回退到现有行为（返回 staged，由轮次结束时的
     检查兜底）。这保证新机制只会减少重跑，不会引入新的发布路径。
4. `observeRoomTurn` 增加 `held` 标记：发现 `send_room_message` 的结果含 `output.held === true`
   即置位，并加入 `ObservedRoomTurn` 类型。
5. `RoomPeerRunner.observe` 在解析结构化输出前增加一条：`structured === undefined && held` 时按
   stale 处理（更新 run 为 `stale`、`releasePeerActivation`、记录指标），**绝不回退为发布 assistant
   文本**；`handledInboxSeq` 不前移，未处理条目会在后续激活中重新处理。
6. 指标：`room-peer-runner-metrics.ts` 的响应指标附带 `holds`，经现有
   `GET /v1/rooms/:roomId/topics/:rootRequestId/metrics` 输出（新增字段，向后兼容）；
   `scripts/eval-room-peer.mjs` 报告中增加"拦截次数 / 避免的重跑次数"。
7. 提示词：`ROOM_PEER_GUIDANCE` 增加一条"If send_room_message returns held, read the supplied
   updates, then revise or skip and call it again."；工具描述同步说明 held 语义。

**改动清单**：`room-peer-types.ts`、`room-peer-state.ts`（当前 285 行）、`room-peer-tools.ts`、
`room-execution.ts`、`room-peer-runner.ts`、`room-peer-runner-metrics.ts`、
`room-collaboration-guidance.ts`、`scripts/eval-room-peer.mjs`、`docs/rooms-peer.md`。

**测试**（`room-peer-tools.test.ts`、`room-peer-state.test.ts`、`room-peer-runner-correctness.test.ts`）

1. 起草后新增 2 条消息：返回 held；activation 已 rebase；`responseCount` 与成员计数不变。
2. rebase 后再次调用：返回 staged；轮次结束发布成功，且不是 stale。
3. 未读超过 6 条：直接 staged，轮次结束仍按 stale 处理（与现状一致）。
4. 第 3 次变化：次数用尽，回退为 staged。
5. held 之后模型不再调用就结束：按 stale 释放，assistant 文本未发布，收件箱条目仍待处理。
6. rebase 期间另一成员发布：提交冲突，回退为 staged。
7. 话题停止或代次变化：沿用现有"activation is no longer current"错误。
8. handoff 分支与参与判断阶段不受影响。

**验收**：上述测试加上 `room-peer-runtime.integration.test.ts` 通过；离线 `--peer-only` 烟测通过；
eval 报告中 stale 重跑次数下降、总消息数不上升。

## 3. P0-3 按需协作手册工具 `read_room_playbook`

**目标**：把"先讨论再认领""带证据交接""协调员汇总""对外动作让用户触发""何时询问用户"等套路
做成按需读取的手册，不放进每轮提示词，不影响缓存。

**设计**

- 内容：新增 `kun/src/rooms/room-playbooks.ts`，导出
  `ROOM_PLAYBOOKS: Record<RoomPlaybookId, { title: string; triggers: string[]; body: string }>`。
  用 TypeScript 常量而非 Markdown 文件，因为 Kun 构建只跑 `tsc`，不会复制资源文件。
  首批条目（全部用 Kun 语义重写，每条正文不超过 6000 字符）：

  | id | 用途 | 与 Kun 的对应 |
  | --- | --- | --- |
  | `discuss-then-propose` | 多人都能做时如何收敛 | 讨论只提建议，执行由协调员或用户授权；用提议卡（P1-1） |
  | `evidence-handoff` | 交接要回答的五个问题 | `send_agent_message` 正文与回答格式 |
  | `coordinator-synthesis` | 多条线时给用户一张决策面 | 汇总任务状态、阻塞、待用户决定项 |
  | `user-fires-external` | 对外发送、发布、付款、部署 | 准备到可直接执行，由用户最终触发 |
  | `when-to-ask-user` | 继续还是先问 | 缺目标、范围或授权时澄清 |
  | `follow-up-later` | 稍后跟进 | 使用提醒（P1-2），不要长时间轮询 |

- 工具：新增 `kun/src/rooms/room-playbook-tool.ts`，定义 `read_room_playbook`：
  输入 `{ id?: RoomPlaybookId }`；不带 id 返回索引（id、title、triggers），带 id 返回正文。
  `shouldAdvertise: (context) => Boolean(context.roomStepKind)`，所有房间步骤可用。
  不记录调用意图，不上报遥测。
- 接入：按 0.5 的 5 处清单注册；`ROOM_PEER_GUIDANCE` 与 `ROOM_DIRECT_GUIDANCE` 各追加一行
  "For collaboration patterns such as splitting work, handing off or deciding whether to ask the
  user, call read_room_playbook."

**测试**：新增 `room-playbook-tool.test.ts`（索引、正文、未知 id 报错、只在房间步骤广告）；新增
`kun/src/loop/room-turn-policy.test.ts`，断言 coordination、discussion、execution、review、
conversation 各步骤的 `allowedToolNames` 都包含该工具，并顺带覆盖 P1-1、P1-2 的新工具。

## 4. P1-1 提议卡（agent 起草、用户确认）

**目标**：成员不能建任务、置顶约定、加成员、建 agent，目前只能用文字"建议"。改为提交结构化提议，
在时间线里渲染成卡片；用户点"采纳"后打开预填好的现有界面，确认后走现有接口，以用户的授权执行。

**数据契约**：新增 `kun/src/contracts/room-proposals.ts`

```ts
export const RoomProposalPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pin_agreement'), body: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ kind: z.literal('execution_request'), goal: z.string().trim().min(1).max(8000),
    memberIds: z.array(RoomIdSchema).max(8).default([]), repositoryId: RoomIdSchema.optional() }).strict(),
  z.object({ kind: z.literal('add_member'), participantAgentId: ParticipantAgentId,
    roleNotes: z.string().max(2000).default('') }).strict(),
  z.object({ kind: z.literal('create_agent'), name: z.string().trim().min(1).max(80),
    title: z.string().max(160).default(''), instructions: z.string().max(8000).default('') }).strict()
])
export const RoomProposalSchema = z.object({
  schemaVersion: z.literal(1), proposalId: RoomIdSchema, roomId: RoomIdSchema, messageId: RoomIdSchema,
  payload: RoomProposalPayloadSchema, rationale: z.string().trim().min(1).max(1000),
  status: z.enum(['open', 'committed', 'dismissed', 'withdrawn']),
  authorMemberId: RoomIdSchema, authorAgentId: ParticipantAgentId.optional(),
  originRunId: RoomIdSchema, rootRequestId: RoomIdSchema.optional(),
  resultRef: z.object({ kind: z.enum(['rule', 'message', 'room', 'agent']),
    id: z.string().min(1).max(256) }).strict().optional(),
  withdrawnReason: z.enum(['run_cancelled', 'topic_stopped']).optional(),
  createdAt: Timestamp, resolvedAt: Timestamp.optional()
}).strict()
export const ResolveRoomProposalSchema = z.object({
  clientRequestId: RoomIdSchema, expectedRevision: z.number().int().nonnegative(),
  decision: z.enum(['committed', 'dismissed']), resultRef: RoomProposalSchema.shape.resultRef
}).strict()
```

`kun/src/contracts/rooms.ts`：`presentationKind` 增加 `'proposal'`，`RoomMessageSchema` 增加
`proposalId: RoomIdSchema.optional()`。存储新增文档类型 `room_proposal`（加入 fence 列表，
能力 `room-store-v6`）。

**服务**：新增 `kun/src/rooms/room-proposals.ts`

- `createRoomProposal(store, input)`：一次提交同时写入 `room_proposal` 与一条展示消息
  （`authorKind: 'member'`、`presentationKind: 'proposal'`、`proposalId`、`originRunId`、
  `status: 'final'`，正文为 rationale 摘要，供搜索和侧栏预览）。事件为
  `message.presentation.created` 与 `room.proposal.updated`，属于展示事件，不唤醒成员、不写收件箱、
  不消耗预算。
- `resolveRoomProposal(store, roomId, proposalId, input)`：只允许 `open → committed | dismissed`；
  以 `clientRequestId` 幂等。`committed` 必须带 `resultRef`，并按类型校验：

  | 类型 | 校验 |
  | --- | --- |
  | `pin_agreement` | `rule` 属于本房间且 `rule.messageId === proposal.messageId` |
  | `execution_request` | `message` 属于本房间、`authorKind === 'user'`、创建时间不早于提议 |
  | `add_member` | 房间当前成员包含该 `participantAgentId` 且已启用 |
  | `create_agent` | `agent_identity` 存在且创建时间不早于提议 |

- `withdrawRunProposals(store, runId, reason)`：把该 run 仍为 open 的提议标记为 `withdrawn`。
  在 `RoomPeerRunner.stopActivation`（话题停止）与 `AgentDirectRunner` 的取消分支调用；
  stale 不撤回，因为最终由用户判断。

**工具**：新增 `kun/src/rooms/room-proposal-tool.ts`，定义 `propose_room_action`：

- 输入 `{ payload: RoomProposalPayload, rationale: string }`。
- 广告条件：`context.roomAgent === true` 且 `roomStepKind` 为 `discussion` 或 `conversation`。
  执行、评审轮已有各自协议，不开放；协调员轮留到后续评估。
- 绑定校验：conversation 使用与 `send_im_message` 相同的 run 绑定；peer 讨论复用
  `room-peer-tools.ts` 的 activation 校验，抽成共享的 `assertCurrentPeerActivation`；legacy
  讨论校验 turn 为 running 且 request 未取消。
- 载荷校验：`memberIds` 必须是本房间启用的成员；`repositoryId` 属于本房间；`add_member` 的 agent
  存在、未归档且尚未在房间中；`create_agent` 在 identities 功能关闭时拒绝。
- 限额：每个 run 最多 2 条，每个房间最多 20 条 open；幂等键为
  `agentStableId('proposal', runId, activeToolCallId)`。
- 返回 `{ accepted: true, proposalId }`，并说明"已提交给用户确认，不会自动执行"。

**配套改动**：`agent-memory-coordinator.ts` 的 `discover()` 跳过 `presentationKind === 'proposal'`
的消息，避免把提议当作记忆来源。

**HTTP 与桌面桥**

- 新增 `kun/src/server/routes/register-room-proposal-routes.ts`，在 `register-room-routes.ts` 中注册：
  `GET /v1/rooms/:roomId/proposals/:proposalId`、`POST /v1/rooms/:roomId/proposals/:proposalId/resolve`。
- `src/main/ipc/app-ipc-schemas/runtime.ts` 增加两条 `compileEndpoint`，并更新
  `app-ipc-schemas-rooms.test.ts`；`src/shared/rooms-api.ts` 导出 `RoomProposal` 相关类型。

**界面**（`src/renderer/src/components/rooms`）

- 新增 `RoomProposalCard.tsx`：`RoomMessageRow.tsx` 在 `presentationKind === 'proposal'` 时渲染卡片
  （写法参照 `RoomPollCard.tsx`）。卡片显示提议人、类型、载荷、理由，并明确标注"需要你确认，
  不会自动执行"；载荷文本按普通文本渲染，不抓取链接预览。
- "采纳"按类型走现有流程，完成后调用 resolve：

  | 类型 | 采纳流程 |
  | --- | --- |
  | `pin_agreement` | 用现有 `POST /v1/rooms/:roomId/rules` 置顶这条提议消息；如用户修改文字，再用现有 `PATCH rules/:ruleId` 生成新版本 |
  | `execution_request` | 把目标、@ 成员、仓库和"执行"意图填入主输入框；用户发送成功后（`useRoomPendingSends` 回执）以新消息 id resolve |
  | `add_member` | 打开 `RoomMemberEditor` 预填成员 → 现有房间 `PATCH` → resolve |
  | `create_agent` | 打开 `AgentProfileForm` 预填 → 现有 `POST /v1/agents` → resolve |

- "忽略"直接 resolve 为 dismissed。resolve 失败时卡片保持 open，可重试（接口幂等）。
- `rooms-client.ts` 增加 `getRoomProposal`、`resolveRoomProposal`；文案加入各语言的
  `common/rooms-interactions.json`；样式放在 `rooms-interactions.css`。

**测试**

- 契约：各类载荷的正反例。
- 服务：创建幂等；每 run 与每房间限额；resolve 的四种校验与状态机；撤回；并发 resolve 冲突。
- 工具：绑定失效时拒绝；非成员、跨房间仓库拒绝；创建提议不新增 `peer_inbox`、预算计数不变。
- 记忆：提议消息不产生 `agent_memory_job`。
- 路由与白名单：未授权 401；IPC 白名单包含两条新端点。
- 界面：`RoomProposalCard.test.ts` 覆盖 open、committed、dismissed、withdrawn 的展示，以及四种
  采纳流程调用了正确的客户端方法。

**验收**：`npm run typecheck`、`npm run build`，扩展 `scripts/smoke-development-rooms.cjs`
`--experience-only` 场景：用离线模型夹具让成员提出 `pin_agreement` 提议，UI 采纳后约定生效且卡片
变为 committed；全程不增加模型调用与话题预算。文档新增 `docs/rooms-proposals.md` 并从
`docs/rooms.md` 链接。

## 5. P1-2 私聊 agent 的提醒

**目标**：私聊 agent 可以为自己设置一次性提醒，到期后在自己的私聊里被唤醒，判断是否需要跟进。
v1 只支持 `user_agent` 私聊，不支持群聊（群聊需要与话题代次和预算协同，放到 v2）。

**数据契约**：新增 `kun/src/contracts/room-reminders.ts`

```ts
export const ROOM_REMINDER_LIMITS = { minDelaySec: 60, maxDelaySec: 30 * 86400,
  maxScheduledPerAgent: 20, maxFiresPer24h: 24, maxChainDepth: 3, maxLatenessSec: 7 * 86400 } as const
export const RoomReminderSchema = z.object({
  schemaVersion: z.literal(1), reminderId: RoomIdSchema, roomId: RoomIdSchema,
  participantAgentId: ParticipantAgentId, memberId: RoomIdSchema,
  note: z.string().trim().min(1).max(1000), anchorMessageId: RoomIdSchema.optional(),
  fireAt: Timestamp, status: z.enum(['scheduled', 'fired', 'cancelled', 'expired']),
  chainDepth: z.number().int().min(0).max(3), createdByRunId: RoomIdSchema,
  createdAt: Timestamp, updatedAt: Timestamp, firedAt: Timestamp.optional(),
  firedRequestId: RoomIdSchema.optional(),
  endedReason: z.enum(['agent_cancelled', 'user_cancelled', 'room_archived',
    'agent_unavailable', 'too_late']).optional()
}).strict()
```

新增文档类型 `room_reminder`（加入 fence 列表，与 P1-1 共用 `room-store-v6`）；`presentationKind`
增加 `'reminder'`，`RoomMessageSchema` 增加 `reminderId: RoomIdSchema.optional()`；
`RoomRequestState` 增加：

```ts
privateReminder?: { reminderId: string; chainDepth: number; scheduledFor: string; lateSeconds: number }
```

**工具**：新增 `kun/src/rooms/room-reminder-tools.ts`，广告条件为
`roomStepKind === 'conversation' && roomAgent`，绑定方式与 `send_im_message` 相同：

| 工具 | 输入 | 规则 |
| --- | --- | --- |
| `schedule_reminder` | `{ note, delaySeconds? , fireAt?, anchorMessageId? }` | `delaySeconds` 与 `fireAt` 二选一；时间范围 60 秒到 30 天；锚点默认取本次 run 的触发消息；每个 agent 最多 20 条 scheduled；未来 24 小时内的触发数不超过 24；链深度为触发本轮的提醒深度 + 1，超过 3 拒绝 |
| `list_reminders` | `{ status?: 'scheduled' \| 'all' }` | 只列本 agent 在本私聊中的提醒，最多 50 条 |
| `update_reminder` | `{ reminderId, note?, delaySeconds?, fireAt? }` | 仅 scheduled 可改 |
| `cancel_reminder` | `{ reminderId }` | 标记 cancelled（`agent_cancelled`） |

**触发流程**：新增 `kun/src/rooms/room-reminders.ts` 的 `fireDueRoomReminders(deps, service, now)`，
在 `RoomRuntime.tick()` 中位于 `memoryCapture.tick()` 之后、扫描 request 之前调用：

1. 列出 `status = scheduled` 且 `fireAt <= now` 的提醒（升序，每次最多 200 条）。
2. 房间已归档、agent 已归档或成员已停用：标记 `expired` 并写入原因，不唤醒。
3. 逾期超过 7 天：标记 `expired`（`too_late`），只写一条提醒通知消息，不唤醒。
4. 否则在**一次提交**中写入：提醒改为 fired；一条展示消息（`authorKind: 'system'`、
   `presentationKind: 'reminder'`、`reminderId`，正文为 note）；一个 pending 的私聊 request
   （`privateProtocol: 'direct-v1'`、`privateReminder`，`sourceMessageId` 指向该展示消息）。
   `requestId = 'reminder-fire:' + reminderId`，重启重放不会重复触发。
5. request 所需的房间快照、权限冻结和模型绑定复用 `RoomService.send` 中的逻辑：把
   `room-service.ts` 第 150-198 行构造快照与 request 的部分抽成共享的内部函数，保持该文件在
   700 行以内。

**唤醒轮输入**：`agent-direct-runner.ts` 在 `!request.privateInput` 分支中，若存在
`privateReminder`，用下面的输入替代 `'User message:\n' + body`：

```text
Scheduled reminder you created earlier. It wakes only you and is not a new user instruction:
<note>
Scheduled for <scheduledFor>; fired <lateSeconds> seconds late.
Anchor message (reference only): <≤1500 chars>
Decide whether follow-up is needed now. Use send_im_message only if the user should see something; otherwise finish without a visible reply.
```

**用户侧接口与界面**

- 路由（加入 `register-agent-chat-routes.ts` 或新文件）：`GET /v1/rooms/:roomId/reminders?status=`、
  `POST /v1/rooms/:roomId/reminders/:reminderId/cancel`（`user_cancelled`）。同步 IPC 白名单与
  `rooms-client.ts`。
- 新增 `RoomReminderList.tsx`：放在私聊头部菜单（与资料、记忆、运行记录同级），列出 scheduled 与
  最近结束的提醒，可取消。
- `RoomMessageRow.tsx` 为 `presentationKind === 'reminder'` 渲染本地化的"提醒已触发"行，正文显示 note。

**生命周期说明**：应用退出后 Runtime 停止，提醒不会在后台触发；下次启动时按"逾期不超过 7 天补发、
超过则过期"处理，唤醒输入中带上逾期秒数。这与 `docs/AGENTS.md`"定时执行随应用退出而停止"一致，
需在 `docs/rooms-reminders.md` 中写明。

**测试**：参数校验与所有限额；链深度；恰好触发一次（重放与重启）；逾期补发与过期；取消后不触发；
归档或停用后过期；生成的 request 带 `privateReminder`，唤醒输入中提醒被标注为参考而非用户指令；
用户取消接口；界面列表与触发行渲染。烟测扩展 `scripts/smoke-development-direct-chat.cjs`：用离线
夹具让 agent 设置 60 秒提醒，借助注入的时钟或缩短的测试上限验证触发与界面展示。

## 6. P1-3 私聊忙碌时新消息并入当前回复

**目标**：用户在 agent 回复过程中连发消息时，把新消息作为引导插入正在运行的回复（像 Raft 的
steer），而不是排成独立的下一轮。

**现状**：每条私聊消息各自成为 request，并以 `enqueueIfBusy: true` 排成独立 turn
（`agent-direct-runner.ts` 第 110-113 行）。Kun 已有持久化引导能力：
`TurnService.steerTurn({ operationId, ... })` 与 `admitDurableSteering`
（`kun/src/services/turn-service-steering-operations.ts`、`durable-steering.ts`），回执记录在目标
turn 的 `steeringDeliveries` 中。

**设计**

1. `RoomRequestState` 增加 `steer?: { operationId: string; targetTurnId: string; targetRunId: string }`；
   `kun/src/contracts/room-runs.ts` 的 `RoomRunRecordSchema` 增加 `mergedIntoRunId?: RoomIdSchema`。
2. `AgentDirectRunner.tick` 在"尚无 turn、准备 enqueue"之前判断能否引导，条件全部满足才走引导：
   - 私聊线程中存在一个 `running` 的 turn，其 `clientRequestId` 对应本房间的 conversation run；
   - 本 request 是普通用户消息：没有 `privateContinuation`、`privateReminder`、
     `handoffReturnId`，agent 不在设置访谈中；
   - v1 只处理不带附件的消息（带附件时仍排队，避免触及图片引导的额外约束）；
   - 本 request 计算出的线程 id 与运行中的线程一致（模型、策略、工作区、上下文纪元都未变）。
3. 执行引导：`operationId = agentStableId('private-steer', request.id, request.stepAttempt ?? 0)`；
   先保存 `steer` 与 `admissionAttempted: true`，再调用
   `deps.turns.steerTurn({ threadId, turnId, operationId, text: request.privateInput,
   displayText: body })`。收到 `TurnConflictError`（轮次已封口、不再接受引导）时清除 `steer`，
   下一个 tick 走原有排队路径。
4. 对账（后续 tick）：读取目标 turn，`steeringDeliveries` 中有该 `operationId` 即视为已并入；
   目标 turn 结束后，request 状态跟随它（completed / cancelled / failed），run 记录写
   `mergedIntoRunId` 并跟随状态。如果目标 turn 已结束但没有该回执，说明引导未被接收，清除 `steer`
   并以 `stepAttempt + 1` 走排队路径；`operationId` 天然幂等，不会重复插入。
5. 引导不单独消耗回复预算，也不重复注入记忆（运行中的 turn 已有记忆上下文）。可见回复仍只通过
   目标 run 的 `send_im_message` 发布。
6. 界面：待发送行在已并入时显示"已并入当前回复"（新增 `directSteered` 文案），run 检视器对
   `mergedIntoRunId` 显示跳转链接。

**待确认**：是否需要"排队发送"的开关（例如在输入框提供"作为新消息发送"选项）。v1 默认能引导就引导。

**测试**（`agent-direct.test.ts` 等）：满足条件时调用 `steerTurn` 且不 enqueue；带附件、续写、提醒、
访谈中均走排队；封口冲突回退排队；回执存在时跟随目标状态；无回执时以新 attempt 回退；重放不重复
引导；取消目标 turn 时两个 request 都进入取消状态。烟测扩展
`scripts/smoke-development-direct-chat.cjs`：模型回复进行中连发两条，断言只产生一个 turn、最终回复
覆盖三条消息，页面无报错。

## 7. P1-4 成员注意力模式

**目标**：让用户把某些成员设为"只在被 @ 或被邀请时参与"，像 Raft 的频道静音（@ 仍可穿透），
减少这些成员的参与判断调用。

**设计**

- `RoomMemberSchema` 增加 `attention: z.enum(['all', 'mentions']).optional()`，缺省视为 `all`，
  旧数据无需迁移。
- 在 `room-peer-inbox.ts` 增加 `peerMessageRecipients(roomSnapshot, candidateIds, opts)`，过滤掉
  `attention === 'mentions'` 的成员。以下 4 处的 `message` 类收件人改为经过该函数：
  1. `RoomPeerStore.initialize`（`room-peer-state.ts` 第 77 行）：没有显式 @ 时，默认成员即使是
     `mentions` 模式也保留（它是被直接指定的回复者）；
  2. `publishPeerMessage`（`room-peer-publication.ts` 第 113 行）；
  3. `deliverPeerMessageUpdate`（`room-peer-message-updates.ts` 第 28 行）；
  4. `RoomPeerStore.deliverTask`（第 230 行）：任务通知只发给任务负责人与 `all` 模式成员。
- `invitation` 类收件人不受影响，结构化邀请和 @ 始终送达。
- legacy 协调员模式暂不使用该字段（由协调员选择发言人），在成员编辑器中注明"仅对讨论模式生效"。
- 界面：`RoomMemberEditor.tsx` 增加开关，`RoomMemberDetails.tsx` 显示标记；补充文案。

**测试**：4 处扇出的过滤；邀请与 @ 仍送达；默认成员保底；旧成员缺省为 `all`；房间更新接口接受新
字段。验收：离线 `--peer-only` 烟测，并用话题 metrics 对比参与判断次数。

## 8. P2 条目（设计要点，排期视 P0/P1 结果而定）

### 8.1 P2-1 调度器空闲退避

`RoomRuntime.wake()` 每次 tick 结束后都会重新排定 1 秒后的唤醒（`room-runtime.ts` 第 100-103 行），
即使没有任何活跃工作也持续扫描。改为让 `tick()` 返回是否活跃：存在待处理或运行中的 request、
task、集成、active/idle 话题、进行中的参与判断、记忆任务、忙碌的 handoff 时为活跃。活跃时保持
1 秒；空闲时改为 `min(15 秒, 距最近一条提醒触发的时间)`。服务层原有的 `wake()` 调用保持立即触发。
测试用假时钟覆盖两种间隔，以及空闲期间调用 `wake()` 会立即 tick。上线前需确认所有产生房间工作
的入口都会调用 `wake()`（用户发消息、续写、handoff、提议 resolve、提醒到期）。

### 8.2 P2-2 agent 可见文案登记与快照

新增 `kun/src/rooms/room-ax-surfaces.ts`，把讨论 prompt、参与判断指令、私聊 system prompt、所有
房间工具描述、协作手册、提醒唤醒输入登记为"描述 + 渲染函数 + 至少一个示例"；新增 vitest 快照测试，
渲染全部示例；新增 `scripts/render-room-ax-surfaces.mjs`，把示例输出到 `dist/room-ax-surfaces.md`
供评审。好处是文案改动都会在快照 diff 中暴露，也能发现意外进入稳定前缀的动态内容。

### 8.3 P2-3 话题"参与者优先"扇出实验

在 P1-4 基础上，默认开关关闭：话题中回复过、被邀请或被 @ 的成员为"参与者"，逐条接收新消息；
第一轮判断中选择跳过的成员转为"旁观者"，不再逐条接收成员消息，改为在话题转为 idle 时收到一条
合并摘要，只做一次参与判断。需在 `RoomPeerMemberState` 增加 `engagement` 字段、在 runner 中处理
idle 时的摘要投递，并用 `scripts/eval-room-peer.mjs` 对比判断次数与遗漏纠错的风险后再决定是否默认开启。

### 8.4 P2-4 轻量认领待办 / agent 工作笔记

- 待办：优先复用现有项目看板卡片（Rooms 已支持引用看板卡片），为卡片增加"认领人"字段与只读查询
  工具，而不是再造一种任务；它只用于追踪，不代表执行授权。
- 工作笔记：Kun 的结构化记忆已覆盖事实类记忆。只有在出现"跨话题的长时间工作需要进度恢复"的
  真实需求时，再在 `agents/workspaces/<agentId>/` 下增加有长度上限的进度笔记，并在每轮输入中附带
  摘录（不进入 system prompt）。

## 9. 里程碑与验证

| 里程碑 | 内容 | 必跑检查 |
| --- | --- | --- |
| M1 | P0-1、P0-2、P0-3 | `cd kun && npx vitest run src/rooms/room-peer-*.test.ts src/rooms/room-playbook-tool.test.ts src/loop/room-turn-policy.test.ts`；`npm run typecheck`；`npm run build:kun`；`node scripts/smoke-development-rooms.cjs --peer-only --evidence dist/rooms-raft-m1`；`npm run check:file-lines`；`git diff --check` |
| M2 | P1-1、P1-2（共用 `room-store-v6`） | M1 各项；`kun/src/manager/manager-resolution.test.ts`；`app-ipc-schemas-rooms.test.ts`；`npm run build`；`--experience-only` 与 `smoke-development-direct-chat.cjs` 烟测；新增界面测试 |
| M3 | P1-3、P1-4 | M2 各项；`agent-direct.test.ts`；两个烟测脚本的相关场景 |
| M4 | P2 按需 | 各条目自带测试；全量 `npm run test` 与 `npm run lint` 作为最终门禁 |

- 每个里程碑区分新引入的失败与仓库已有的基线失败（例如 `docs/rooms-direct-chat.md` 记录的 5 项
  非英文设置完整性检查与 1 项看板路由白名单断言），不把基线失败当作通过，也不当作本次引入。
- 真实模型评测（`node scripts/eval-room-peer.mjs --check`，确认后再 `--run`）会消耗用户已配置的
  模型额度，只在用户明确同意后执行；报告不含原文与凭据。
- 烟测运行期间不要修改渲染进程源码或重建 `kun/dist`（与现有烟测文档一致）。

## 10. 风险与待确认问题

1. **P0-2 的正确性边界**：rebase 只在"全部未读条目都已返回给模型"时发生，保证"发布时模型看过
   截至该版本的全部更新"这一不变量；任何不确定都回退到现有的轮次结束检查。
2. **提示词生效范围**：私聊 system prompt 只对新线程生效，已有线程需用户重置上下文。
3. **能力升级**：`room-store-v6` 会要求 Manager 升级；需确认桌面端与 TUI 的升级路径都经过测试。
4. **提议卡的两步提交**：现有接口执行成功而 resolve 失败时，卡片仍为 open，由界面重试或用户手动
   忽略；如需要严格原子性，可在后续版本让现有接口接收 `proposalId` 并在同一事务内完成。
5. **提醒防自循环**：链深度上限 3、每 24 小时最多 24 次触发、每个 agent 最多 20 条 scheduled；
   群聊提醒留到 v2。
6. **待用户确认**
   - P1-3 是否默认引导，还是提供"排队发送"选项；
   - P1-4 的默认值：是否让预设评审员默认为 `mentions` 模式；
   - P1-1 是否向协调员开放 `pin_agreement` 与 `add_member` 提议；
   - 是否授权在 M1、M2 完成后用真实模型运行 `eval-room-peer.mjs`。
