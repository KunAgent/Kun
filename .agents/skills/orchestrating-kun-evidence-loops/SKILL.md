---
name: orchestrating-kun-evidence-loops
description: Use when a coding change in Kun or a Kun-managed repository needs independent implementation and review roles, persistent handoff state, or a repeatable failure/fix loop; especially for multi-step, security-sensitive, cross-layer, or audit-heavy work.
---

# Kun 多 Agent 对证循环编排

## Overview

用 Kun 负责规划、状态裁决和归档，让 Claude Code 只实现、Codex 只独立审查。核心原则是：**Agent 产出证据，确定性协议决定流转；任何角色都不能靠自报成功越过门禁。**

## 先选择工作模式

根据用户授权选择最小模式，不要把“设计工作流”自动扩大成“开发新运行时”。

| 模式 | 触发条件 | 允许动作 |
| --- | --- | --- |
| 协议设计 | 用户要方案、Skill、模板或评审 | 只产出协议和本地文档，不派发 worker |
| 辅助执行 | 用户要实际完成变更，且现有子 Agent/CLI 可用 | 建工作间，串行派发实现与审查，维护状态和证据 |
| 产品化 | 用户明确要求把协作能力做进 Kun | 按 Kun 现有 contracts/ports/adapters/server/renderer 边界实现 |

## 不可破坏的边界

- Kun 仍是产品中唯一 live Agent runtime；不得恢复 AgentSwitcher、第二 AgentLoop、旧 provider、RPC bridge 或运行时诊断面板。
- Claude Code 和 Codex 是受 Kun 协调的角色或外部 worker，不是新的 GUI provider。
- 不采用文章中的 HWND、剪贴板、键盘注入或常驻终端作为默认传输层。优先使用现有任务、线程、子 Agent 或显式 CLI 接口。
- 不使用 `--permission-mode bypassPermissions`，不降低 sandbox、approval、workspace trust 或凭据保护。
- 未经用户明确批准，不 push、merge、发布、修改第三方资源或凭据。
- 不碰任务范围外的用户改动；每次派发前后都核对工作树和目标 SHA。

## 角色契约

| 角色 | 必须做 | 禁止做 |
| --- | --- | --- |
| Kun | 拆任务、建工作间、裁决状态、验证证据、路由、归档 | 代替实现者写业务代码；代替审查者给 PASS |
| Claude Code | 按验收标准实现/修复、测试、提交候选 SHA | 自审后放行；归档；调度其他角色；push/merge |
| Codex | 审查精确 diff 与候选 SHA，验证约束，输出 PASS/FAIL | 默认写业务功能；归档；更改基线；push/merge |

若执行环境没有 Claude Code，明确报告缺失并让独立实现 worker 承担同一契约；不要假装已调用 Claude Code。若没有独立 Codex reviewer，不得把 Kun 自审伪装成对证通过。

## 核心工作流

### 1. 定义可验证工作间

先读取根 `AGENTS.md`、目标目录的局部说明、相关设计/规范和当前 Git 状态。把任务拆成互不重叠的工作间，每个工作间至少包含：

- 稳定 `workspace_id`；
- 固定 `base_sha`、分支和工作目录；
- 任务、验收标准、约束、允许修改路径；
- 必跑验证命令；
- 依赖工作间与是否允许并行。

只有无依赖且文件范围不重叠的工作间才能并行。同一工作间内，Claude Code 与 Codex 必须串行交接。

### 2. 初始化唯一状态源

按 [references/protocol.md](references/protocol.md) 创建 `STATUS.md`。结构化 front matter 是状态真源，正文保存任务、证据、审查发现和只追加的转换记录。

只使用以下状态：

```text
created -> implementing -> waiting-review -> reviewing
reviewing -> waiting-fix -> implementing
reviewing -> completed -> archived
* -> blocked | failed | cancelled
```

不得临时发明 `review-failed`、`changes-requested` 等同义状态。旧记录中的 `completed` 与最新证据冲突时，以候选 SHA、最新合法转换和审查结果重建状态。

### 3. 派发实现者

只在 `created` 或 `waiting-fix` 派发 Claude Code。传入状态文件路径、工作目录、允许路径、验收标准和验证命令。要求它返回协议定义的结构化结果。

Kun 收到结果后独立验证：

- 候选提交存在且属于目标分支；
- diff 基于指定 `base_sha`；
- changed files 没有越界；
- 工作树没有无法解释的脏改动；
- 验证命令和退出码有可复查证据。

证据不足时进入 `blocked` 或回到实现，不得进入 `waiting-review`。

### 4. 派发独立审查者

只在 `waiting-review` 派发 Codex。传入任务契约、验收标准、`base_sha..candidate_sha` 和必要仓库规则，不传实现者的自我评价。

审查必须：

- 核对功能完整性、正确性、安全性、边界条件、路径约束和测试证据；
- 对每个阻断问题给出 severity、file、line、expected、observed；
- 在结果中写回准确 `reviewed_sha`；
- 只输出 `PASS` 或 `FAIL`。

任何阻断 finding 都是 `FAIL`。候选 SHA 在审查期间变化时，本次结论作废并重新审查。

### 5. 让协议闭环

- `FAIL`：写入 findings，状态转为 `waiting-fix`，再派发 Claude Code。
- 修复完成：重新运行适用验证，再交给新的独立审查回合。
- `PASS`：仅当 `reviewed_sha == candidate_sha` 且证据门禁全绿时转为 `completed`。
- `completed`：由 Kun 生成归档清单并转为 `archived`。

不要把“固定三次提交”当作规则。最少需要候选实现与审查结论；每轮 FAIL/FIX 都会自然增加提交或状态事件。

### 6. 异常时先对账

路由超时表示“结果未知”，不表示失败或成功。按协议中的幂等键查询/重投，并核对状态 revision、候选 SHA、进程结果和事件回执。

遇到以下情况必须停止自动推进：

- 状态 revision 冲突；
- worker 崩溃或输出无法解析；
- 目标分支、base SHA 或候选 SHA 漂移；
- 审查发现高危安全问题；
- 用户要求跳过 FAIL 直接归档。

最多保存 checkpoint；没有对最新 SHA 的 PASS，绝不正式归档。

## Kun 适配规则

| 原文章概念 | Kun 适配 |
| --- | --- |
| Hermes | Kun 的规划、状态裁决、路由和归档职责 |
| `route-agent.py` | 现有协调工具；产品化时才做 Kun 内确定性 coordinator |
| post-commit -> HWND inject | 结构化任务/线程/子 Agent/CLI 派发；Git hook 仅可作薄事件入口 |
| `~/.hermes/*` | 配置的 Kun data dir 或用户明确选择的项目状态目录 |
| `[CC-WS001]` 提交前缀 | 遵循目标仓库提交规范；把角色和 workspace 放在 trailer/状态证据中 |
| `bypassPermissions` | 禁止；继承 Kun sandbox 和 approval policy |

如果用户明确要求产品化，先读 `docs/AGENTS.md` 和 `docs/kun-architecture.md`，再按共享 schema -> Kun runtime -> HTTP/SSE -> preload/main -> renderer 的既有路径落地。GUI 只映射状态，不承载编排逻辑。

## 一次完整示例

认证工作间 `WS-017` 的 Claude Code 提交 `abc123` 并请求审查。Kun 验证 diff 与测试后把状态转为 `waiting-review`。Codex 对 `base..abc123` 发现高危越权，输出带文件行号的 `FAIL`。即使用户催促归档，Kun 也只能记录 checkpoint，将状态转为 `waiting-fix` 并把发现交回 Claude Code。修复提交为 `def456` 后，Kun 重跑适用验证并启动针对 `def456` 的新审查；只有 Codex 对 `def456` 给出 PASS，Kun 才能完成并归档。

## 快速检查

- [ ] 工作模式与用户授权一致，没有自动扩大为运行时开发
- [ ] 三个角色边界清楚，Kun 不实现、Codex 不默认修功能
- [ ] 状态只来自规范枚举，revision 单调递增
- [ ] 实现和审查绑定到明确 SHA，证据由 Kun 独立核验
- [ ] FAIL 一定回到修复；最新 SHA 未 PASS 就不归档
- [ ] 超时、冲突和重投使用幂等对账
- [ ] 不使用 UI 注入、权限绕过、自动 push 或 merge

## 详细协议

初始化 `STATUS.md`、生成派发提示、解析角色 JSON、恢复异常或生成归档时，必须读取 [references/protocol.md](references/protocol.md)。
