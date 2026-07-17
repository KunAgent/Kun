# Kun 对证循环协议

本文提供 `orchestrating-kun-evidence-loops` 的可执行数据契约。它提炼自《多 Agent 对证循环协作架构：Hermes + Claude Code + Codex 三角色工作流实战》，并把 Hermes 的头尾职责替换为 Kun，同时遵守 Kun 的单运行时边界。

来源：<https://blog.csdn.net/qq_36710118/article/details/161525417>

## 目录

1. 标识与存储
2. STATUS.md 模板
3. 状态机与路由
4. 派发信封与幂等
5. Claude Code 输出契约
6. Codex 输出契约
7. 角色提示模板
8. Kun 证据验证
9. 故障恢复
10. 归档门禁
11. 产品化边界

## 1. 标识与存储

为每次大任务生成 `run_id`，为每个可独立验收的子任务生成 `workspace_id`：

```text
run_id: RUN-20260716-auth-hardening
workspace_id: WS-017
```

使用现有项目约定；没有约定时，运行态默认放在配置的 Kun data dir：

```text
<kun-data>/collaboration/<repo-id>/<run-id>/<workspace-id>/STATUS.md
<kun-data>/collaboration/<repo-id>/<run-id>/<workspace-id>/events.jsonl
<kun-data>/collaboration/<repo-id>/<run-id>/archive/<workspace-id>.md
```

Git 工作目录和状态目录分离。不要把运行日志、临时 worktree 或归档误提交到业务仓库。分支名服从仓库规则；Kun 项目新分支使用 `codex/` 前缀。

## 2. STATUS.md 模板

结构化 front matter 是机器可校验的状态真源。正文是面向 Agent 的任务与证据。

```markdown
---
schema_version: 1
run_id: RUN-20260716-auth-hardening
workspace_id: WS-017
revision: 1
state: created
owner: kun
repository: D:/work/repo
worktree: D:/worktrees/ws-017
branch: codex/ws-017-auth-hardening
base_sha: 1111111111111111111111111111111111111111
candidate_sha: null
reviewed_sha: null
iteration: 0
updated_at: 2026-07-16T12:00:00+08:00
---

# WS-017: Harden authorization boundary

## Task
<one bounded outcome>

## Acceptance Criteria
- [ ] <observable behavior>
- [ ] <regression behavior>

## Constraints
- <architecture, security, compatibility constraints>

## Allowed Paths
- `src/auth/**`
- `src/auth/**/*.test.ts`

## Verification
| Command | Required | Last exit | Evidence |
| --- | --- | ---: | --- |
| `npm test -- auth` | yes | - | - |

## Implementation Evidence
- Candidate SHA: pending
- Changed files: pending
- Summary: pending

## Review Findings
No review yet.

## Transition Log
| Revision | From | To | Actor | SHA | Evidence/Event |
| ---: | --- | --- | --- | --- | --- |
| 1 | - | created | kun | 1111111 | initialized |
```

规则：

- `revision` 每次合法转换加 1；更新前必须重读并比较 revision。
- `base_sha` 创建后不变；需要换基线时取消旧工作间并新建，不静默改写。
- `candidate_sha` 每次实现/修复后更新。
- `reviewed_sha` 只由已解析的 Codex 结果写入。
- 转换记录只追加，不删除历史。冲突字段不能用“最后写入者获胜”。
- Worker 返回转换请求；Kun 是状态裁决者。无法由 Kun 单写时，必须串行交接并使用 revision compare-and-swap。

## 3. 状态机与路由

### 规范状态

| State | Owner | 含义 |
| --- | --- | --- |
| `created` | `kun` | 契约已创建，等待实现 |
| `implementing` | `claude-code` | 正在实现或修复 |
| `waiting-review` | `kun` | 候选证据已验证，等待审查 |
| `reviewing` | `codex` | 正在审查固定候选 SHA |
| `waiting-fix` | `kun` | REVIEW-FAIL 已记录，等待修复 |
| `completed` | `kun` | 最新候选通过全部门禁，待归档 |
| `archived` | `none` | 归档清单已持久化 |
| `blocked` | `kun` | 需要用户输入、权限或外部条件 |
| `failed` | `kun` | 进程/协议/证据故障，需恢复或终止 |
| `cancelled` | `none` | 用户或策略终止 |

禁止同义状态。`in-progress` 过于含糊，不用于新工作间。

### 合法转换

| From | To | 必需证据 |
| --- | --- | --- |
| `created` | `implementing` | 实现派发回执 |
| `waiting-fix` | `implementing` | 修复派发回执和上一轮 findings |
| `implementing` | `waiting-review` | 可验证 candidate SHA、范围检查、必需测试 |
| `waiting-review` | `reviewing` | 审查派发回执和固定 candidate SHA |
| `reviewing` | `waiting-fix` | `FAIL`、准确 reviewed SHA、findings |
| `reviewing` | `completed` | `PASS`、`reviewed_sha == candidate_sha`、全部门禁 |
| `completed` | `archived` | 归档清单和内容哈希 |
| 任意非终态 | `blocked` | 阻塞原因和恢复条件 |
| 任意非终态 | `failed` | 错误、已尝试动作和恢复建议 |
| 任意非终态 | `cancelled` | 用户/策略取消证据 |

从 `blocked`/`failed` 恢复时，根据最后一个有效 revision、Git 证据和事件回执回到对应非终态；不得猜测跳到 `completed`。

### 确定性路由

```text
created | waiting-fix  -> Claude Code
waiting-review         -> Codex
completed              -> Kun archive
blocked | failed       -> Kun reconcile/escalate
其他状态                -> 不派发
```

路由器只读结构化状态和版本，不解析自然语言、提交标题或聊天内容来决定下一角色。

## 4. 派发信封与幂等

所有派发使用同一信封：

```json
{
  "event_id": "RUN-20260716-auth-hardening:WS-017:r4:codex:def456",
  "run_id": "RUN-20260716-auth-hardening",
  "workspace_id": "WS-017",
  "revision": 4,
  "target_role": "codex",
  "action": "review",
  "base_sha": "1111111111111111111111111111111111111111",
  "candidate_sha": "def456def456def456def456def456def456def4",
  "status_path": "<absolute-status-path>",
  "worktree": "<absolute-worktree-path>"
}
```

幂等键为：

```text
(run_id, workspace_id, revision, target_role, candidate_sha)
```

同一幂等键只产生一个有效派发结果。超时后先查回执；无法查询时可重投同一键，不能生成新 revision 后盲目重投。

## 5. Claude Code 输出契约

```json
{
  "role": "claude-code",
  "workspace_id": "WS-017",
  "result": "success",
  "base_sha": "1111111111111111111111111111111111111111",
  "candidate_sha": "def456def456def456def456def456def456def4",
  "changed_files": ["src/auth/authorize.ts", "src/auth/authorize.test.ts"],
  "tests": [
    {
      "command": "npm test -- auth",
      "exit_code": 0,
      "summary": "12 tests passed"
    }
  ],
  "summary": "Closed the cross-tenant authorization path and added regression coverage.",
  "blockers": []
}
```

`result` 只能是 `success` 或 `blocked`。Kun 必须自行核对 SHA、changed files 和测试，不相信字符串声明。

## 6. Codex 输出契约

```json
{
  "role": "codex",
  "workspace_id": "WS-017",
  "verdict": "FAIL",
  "reviewed_sha": "def456def456def456def456def456def456def4",
  "findings": [
    {
      "severity": "high",
      "blocking": true,
      "file": "src/auth/authorize.ts",
      "line": 73,
      "expected": "Resource ownership must be checked before mutation.",
      "observed": "The handler authorizes by role only.",
      "verification": "Add and pass a cross-tenant mutation regression test."
    }
  ],
  "tests": [
    {
      "command": "npm test -- auth",
      "exit_code": 0,
      "summary": "Existing tests pass but do not cover the attack path."
    }
  ],
  "summary": "Authorization remains bypassable across tenants."
}
```

`verdict` 只能是 `PASS` 或 `FAIL`。`PASS` 必须有空的 blocking findings；`FAIL` 至少有一个可执行 finding。格式错误进入 `failed`，不能由 Kun 猜测结论。

## 7. 角色提示模板

### Claude Code

```text
你是工作间 <workspace_id> 的实现者。
先读取根/局部 AGENTS.md 和 <status_path>。
只在 <worktree>、分支 <branch> 工作，只修改 Allowed Paths。
只有状态 created 或 waiting-fix 才能开始。
按 Task、Acceptance Criteria、Constraints 实现；执行 Verification 中必需命令。
遵循仓库提交规范，创建候选提交；不 push、不 merge。
不得自审放行、归档或调度其他 Agent。
最终只返回协议中的 Claude Code JSON，不要用散文代替字段。
```

### Codex

```text
你是工作间 <workspace_id> 的独立审查者。
先读取根/局部 AGENTS.md 和 <status_path>。
只审查 <base_sha>..<candidate_sha>，并确认当前候选 SHA 未变化。
逐项核对 Acceptance Criteria、Constraints、Allowed Paths 和 Verification。
检查功能、逻辑、安全、边界条件、回归风险和测试证据。
默认不编写业务功能，不 push、不 merge、不归档。
任何 blocking finding 都必须 FAIL；没有 blocking finding 才能 PASS。
最终只返回协议中的 Codex JSON，并写准确 reviewed_sha。
```

### Kun

```text
你是唯一状态裁决者和路由者。
解析 worker JSON，但独立核对 Git、文件范围、测试和候选 SHA。
用 revision compare-and-swap 执行且只执行一个合法转换。
FAIL 路由修复；PASS 只有在 reviewed_sha 等于 candidate_sha 时才完成。
超时、冲突、证据不一致进入对账，不得猜测成功。
未经明确批准，不 push、merge、发布或修改第三方资源。
```

## 8. Kun 证据验证

在实现转审查前至少核对：

1. `git cat-file -e <candidate_sha>^{commit}` 成功。
2. candidate 是目标分支可达提交，且 base 是 candidate 的祖先。
3. `git diff --name-only <base_sha>..<candidate_sha>` 全部符合 Allowed Paths。
4. 工作树状态已解释；不得覆盖用户既有未提交改动。
5. 必需测试输出来自当前候选，不是上一轮缓存或口头报告。
6. 提交信息满足仓库规范；角色/workspace 元数据放 trailer 或 STATUS 证据，不破坏规范。

在审查转完成前再核对：

1. 输出 schema 可解析。
2. `reviewed_sha` 精确等于当前 `candidate_sha`。
3. PASS 没有 blocking finding。
4. 候选 SHA 在审查期间未变化。
5. 所有必需验证仍满足；修复后应重跑受影响门禁。

## 9. 故障恢复

| 故障 | 正确动作 | 禁止动作 |
| --- | --- | --- |
| 派发超时 | 查询同一幂等键回执；必要时同键重投 | 创建新任务并假设旧任务没运行 |
| 残留 `completed` 与新 FAIL 冲突 | 从最后合法 revision、reviewed SHA 和事件重建，恢复到 `waiting-fix`/`failed` | 保留 completed 后先归档 |
| 审查期间 candidate 变化 | 废弃结论，回到 `waiting-review`，审查新 SHA | 把旧 PASS 套到新提交 |
| Worker 退出或 JSON 不可解析 | 进入 `failed`，保存 stderr/exit code，人工或策略恢复 | 猜测它本来想返回 PASS |
| revision 冲突 | 重读状态和事件，合并只追加证据，执行一个合法 CAS | last-write-wins 覆盖 |
| 高危安全 finding | 强制 `waiting-fix`，修复并重新验证/审查 | 接受“以后补审查” |
| 连续失败达到策略上限 | `blocked` 并向用户给出历史、选项和建议 | 无限自动循环 |
| 用户取消 | 记录取消证据，转 `cancelled`，停止派发 | 继续后台运行 |

## 10. 归档门禁

归档前必须全部满足：

- 最新 candidate SHA 已持久化且可达；
- Codex 对该 SHA 返回 PASS；
- 必需测试和路径范围核验通过；
- 没有 unresolved blocking finding；
- 状态 revision 与所有事件已对账；
- 工作树中的用户改动没有被误收纳；
- 用户要求的审批门禁已满足。

归档至少记录：

```yaml
run_id: RUN-20260716-auth-hardening
workspace_id: WS-017
base_sha: 1111111111111111111111111111111111111111
candidate_sha: def456def456def456def456def456def456def4
reviewed_sha: def456def456def456def456def456def456def4
final_revision: 8
verdict: PASS
tests:
  - command: npm test -- auth
    exit_code: 0
iterations: 2
archive_hash: <sha256>
```

归档是不可变证据，不是 merge/push 授权。外部动作仍需用户明确批准。

## 11. 产品化边界

只有用户明确要求把协议做进 Kun 产品时，才设计或实现运行时组件。遵循：

1. 在 `kun/src/contracts/` 定义 Run、Workspace、状态、worker 结果和事件 schema。
2. 在 `kun/src/ports/` 定义 worker、store、workspace、clock 等端口。
3. 在 `kun/src/adapters/` 实现受 sandbox/approval 约束的适配器。
4. 在 `kun/src/loop/` 或 `kun/src/services/` 放确定性 coordinator；不要放 renderer。
5. 在 `kun/src/server/routes/` 暴露 HTTP/SSE；主进程仅托管/转发。
6. 在 shared/preload/main/renderer 映射契约，GUI 只显示状态和证据。

禁止新增第二 AgentLoop、外部 provider switch、HWND 注入、旧 RPC bridge 或不受控 CLI 权限绕过。任何产品化方案都必须补状态机、幂等、崩溃恢复、安全、跨层契约和打包验证测试。
