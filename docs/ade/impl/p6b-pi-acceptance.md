# P6b：Pi RPC 集成与验收治理（P6-09 ~ P6-13）

承接 `docs/ade/impl/p6-native-agent-adapters.md` §0~§7 与 `p6a-session-codex.md` 的全局约定
（分支命名、行数红线、翻译、验证门槛）。本文给出阶段 C（Pi）与阶段 D（验收/治理）的实现级细节。

**未验证前提（动工前必须先做，见 P6-09 第 0 步）**：本机未安装 Pi。包名、安装命令、
`pi --version` 输出格式、`--mode rpc` 的真实消息 schema、`auth/status` 能力，全部以
实机核对为准；本文只锁定架构与映射策略，不锁定版本号与命令字面量。

## 1. Pi 集成规格（P6-09 ~ P6-11 的契约基准）

### 1.1 进程与协议

- 启动：`pi --mode rpc --no-extensions --extension <kun-bridge.ts> [--model m] [--provider p]`
  （`--no-skills --no-context-files` 视隔离档位附加；stdin JSONL 命令 / stdout JSONL 响应+事件）。
- 传输：复用 P6-03 的 `JsonlTransport`（不是 JSON-RPC——Pi 是"命令/响应/事件"三型 JSONL，
  `pi-client.ts` 做命令 id 关联与事件分发）。
- 生命周期边界：一轮完成信号 = **`agent_settled`（通知型终态）**；`agent_end` 只作内部参考，
  不作完成判定（上游文档明确该要求）。`agent_before_settle` 是最后一个可行动边界。
- 输入转义：以 `/` 开头的用户文本在桥内转义后再交给 Pi（防命令注入）。
- 会话持久：Pi 会话文件由 Pi 自己管；Kun 只在 `providerSessionId` 记会话文件路径/ID 摘要。
  `--resume/--continue/--fork` 的存在与否以实机 RPC 命令面核对为准，缺失则能力位收窄。

### 1.2 Kun 桥接扩展（`kun-bridge`，P6-10）

| 职责 | 实现 |
| --- | --- |
| 工具审批 | 扩展工具拦截点把所有 tool call 先抛给 Kun 审批门；批准/拒绝结果回传 Pi |
| 权限天花板 | 扩展内检查路径落在 workspace/read/write roots 内；越界直接拒绝，不依赖 Pi 自身策略 |
| Kun 工具 | 经扩展暴露 `ask_manager`/`report_progress` 等 worker 回调（仅 delegated worker 会话挂载，普通用户会话不挂） |
| UI 桥 | Pi `extension_ui_request`（select/confirm/input/editor/notify/setStatus/setWidget/setTitle）→ Kun `userInput`/status 事件；不把原始 Pi UI 协议透给 renderer |
| 生命周期 | 长资源（socket/watcher/timer）只在会话 start 起、shutdown 收；模块初始化不启动资源 |
| 信任边界 | 扩展源码随 kun 包构建产物分发（`kun/extensions/pi-kun-bridge/`），只以显式 `--extension` 加载；不读用户/项目扩展目录 |

### 1.3 事件映射

| Pi RPC | Kun |
| --- | --- |
| assistant text delta | `sink.textDelta` |
| thinking/reasoning delta | `sink.reasoningDelta` |
| tool_call / tool_result | `sink.toolCall` / `sink.toolResult` |
| usage 事件 | `sink.usage` |
| extension_ui_request（交互型） | `sink.userInput` 或 `sink.approval` |
| agent_settled | 轮完成（resolve `HarnessTurnResult`） |
| error / process exit | failure 分类（`failure.ts`），会话漂移→重开 |

## 2. PR 明细

### P6-09 · Pi 契约、检测与 PiAgent 骨架

| 项 | 值 |
| --- | --- |
| commit | `feat(kun): add pi rpc harness agent` |
| 依赖 | P6-02、P6-03 |
| 前置 | **第 0 步**：安装 Pi 实机核对：包名/安装命令、`--version` 格式、`--mode rpc` 握手、会话文件位置、`agent_settled` 实际触发点、RPC 命令全集。核对结果写进 `kun/src/session/pi/pi-protocol-notes.md`（≤120 行，作为 schema 缺位期的契约档案） |
| 新增 | `kun/src/session/pi/`：`pi-agent.ts`、`pi-client.ts`、`pi-session.ts`、`pi-event-map.ts`、三个 `.test.ts`、`fixtures/`（清洗录制） |
| 修改 | `kun/src/contracts/harness.ts`（`'pi-rpc'` transport）、`builtin-harnesses.ts`（pi 定义，`detect.command` 与安装命令按第 0 步实值填写）、`harness-detector.ts`、`harness-catalog.ts`、`harness-runtime.ts`、`build-harness-runtimes.ts` |

步骤：

1. 第 0 步核对（人工+脚本）：`pi --help`、跑一次 `pi --mode rpc` 手工 JSONL 会话，
   确认命令/事件名与本文件 §1 假设一致；不一致处改映射表不改架构。
2. `pi-client.ts`：JSONL 命令/响应关联 + 事件分发 + 进程退出全拒（跑在 `JsonlTransport` 上）。
3. `pi-agent.ts`：`initialize`（`--version` + rpc 握手）、`listModels`（RPC model 列表；
   无 RPC 面则走 `modelSource:'static'` 并能力位降级）、`ensureSession`（新/恢复）。
4. `pi-session.ts`：`runTurn` = 发 prompt 命令 → 事件流 → `agent_settled` resolve；
   cancel → interrupt 命令（实机确认存在性）或进程 dispose。
5. 能力声明：`HarnessCapabilities` 对 pi 收窄——同轮插话/原生回退/上下文遥测按实机结果
   标 `unsupported_upstream_limitation` 或 `unsupported_not_implemented`，不假装对等。

测试：`pi-client.test.ts`（假子进程：命令关联、事件流、退出）；`pi-event-map.test.ts`
（录制回放→时间线草稿快照）；`pi-agent.test.ts`（会话生命周期、settled 边界、漂移重开）。

DoD：单测绿 + typecheck；`pi-protocol-notes.md` 入库。回滚 revert（builtin 未启用无用户面）。

### P6-10 · Kun 桥扩展（审批 + 工具回调）

| 项 | 值 |
| --- | --- |
| commit | `feat(kun): bridge pi tool approvals and kun callbacks` |
| 依赖 | P6-09 |
| 新增 | `kun/extensions/pi-kun-bridge/`：`index.ts`、`kun-api.ts`、`approval-bridge.ts`、`ui-bridge.ts`、`README.md`；`kun/src/session/pi/pi-bridge-channel.ts`（Kun↔扩展的带内信道） |
| 修改 | `kun/src/session/pi/pi-agent.ts`（spawn 参数挂 `--extension`）、`kun/src/session/pi/pi-session.ts`（审批/请求经桥信道进 sink）、`kun/scripts/`（如需把扩展打进 kun dist——检查 `build:kun` 产物是否含 `extensions/`）、`docs/ade/05-worker-callbacks.md` |

步骤：

1. 信道选型（实现前先验证）：优先复用 Pi RPC 自带的扩展通信面
   （extension 发 custom message / Kun 经命令应答）；若无双向面，扩展起本地 unix/named-pipe
   与 Kun 会话私有信道（随会话 start 起、shutdown 收）。
2. `approval-bridge.ts`：拦截 tool call → 发 `HarnessApprovalRequest` 语义到 Kun →
   等裁决 → 允许/拒绝。Kun 侧接 `sink.approval`（复用现有审批门与"本会话记住"）。
3. `ui-bridge.ts`：`extension_ui_request` 翻译：confirm→approval 或 userInput；
   select/input/editor→userInput（结构化）；notify/setStatus/setWidget/setTitle→status 事件，
   不入审批。
4. `kun-api.ts`：worker 会话挂载 `ask_manager`/`report_progress`/`worker_result` 回调——
   与现有 ACP Kun-Tools-MCP 面同语义，仅 `credentialMode/worker` 路由时启用。
5. 路径天花板：扩展侧收到 Kun 下发的 roots（workspace 读/写清单），越界工具调用直接拒。

测试：`pi-bridge-channel.test.ts`（假 Kun 端）；`approval-bridge.test.ts`（批准/拒绝/取消/超时/
会话内记住）；`ui-bridge.test.ts`（五类 UI 请求映射）；端到端假 pi：一轮含两次审批 + 一次
ask_manager，断言时序与 `agent_settled` 收尾。

DoD：测试绿；`build:kun` 产物含扩展目录；无明文密钥路径。回滚 revert（pi 未启用）。

### P6-11 · Pi 网关、登录态与目录启用

| 项 | 值 |
| --- | --- |
| commit | `feat(kun): enable pi harness with gateway and native login` |
| 依赖 | P6-10 |
| 新增 | `kun/src/session/pi/pi-gateway-config.ts`、`pi-gateway-config.test.ts` |
| 修改 | `builtin-harnesses.ts`（pi 定义定稿：`native-login`/`provider`/`kun-gateway` 三档）、`harness-login-probes.ts`（pi 分支：存在性探测 Pi 自有登录态，**D2：Kun 不接管 Pi 登录库**，只读 ready 标志）、`services/harness-test-service.ts`（`pi-rpc` handshake case）、`kun/src/server/routes/harnesses.ts`（probe 分发）、`src/shared/ade-harnesses.ts`、Agent Center（transport 标签 + reason codes + 7 语种） |

步骤：

1. 网关档：生成 Kun 托管的 Pi 配置目录（隔离的用户配置，不动 `~/.pi` 之类默认目录），
   内含 `models.json`/等价文件——provider 指 Kun 网关 baseURL，**API key 用环境变量引用
   （`"${env:KUN_PI_GATEWAY_KEY}"` 或 Pi 支持的等价语法），不写明文**；env 注入 spawn env。
   若 Pi 不支持 env 引用：密钥写入托管目录文件（0700）并在 doc 记录偏差。
2. native-login：不动用户 Pi 目录；登录动作=终端预填 `pi` 登录命令（P5 Terminal-Auth 同构），
   就绪判定=Pi 侧可查的登录态存在标志。
3. provider 档：`--provider`/`--model` 直参 + env 密钥。
4. UI：pi 卡片 transport `Pi RPC`；handshake/trial 走 `harness-test-service`。
5. Agent Center 模型源：pi `modelSource` 按 P6-09 实机结果落 `probe` 或 `static`。

DoD：网关/登录/检测测试绿；`smoke:development-ade` 绿（pi 未装时应显示 not-installed 卡片不崩）。
回滚：pi 不进默认目录或 revert。

### P6-12 · 真机验收矩阵（发布门）

| # | 场景 | Codex | Pi |
| --- | --- | --- | --- |
| 1 | 未装/未登录态检测与 reasonCode | ✅ | ✅ |
| 2 | 登录→ready | ✅ | ✅（若 Pi 有登录态） |
| 3 | 完整一轮（text/thinking/工具/diff/usage） | ✅ | ✅ |
| 4 | 命令+文件审批三裁决 | ✅ | ✅（桥） |
| 5 | 中断 | ✅ | ✅ |
| 6 | 重开 kun serve 后 resume | ✅ | ✅（能力内） |
| 7 | fork | ✅ | 能力声明为准 |
| 8 | 同轮插话 | ✅ | 能力声明为准 |
| 9 | 网关档一轮 + 密钥轮换 | ✅ | ✅ |
| 10 | 额度进选路 | ✅ | n/a |
| 11 | worker 会话 ask_manager/report_progress | ✅ | ✅ |
| 12 | 评测集一轮基线对比（ACP/旧路径 vs 新路径） | ✅ | n/a |

- 凭据项不可自动化——矩阵在真机/夜间 CI 跑，结果记录进 PR 描述；
  未过项阻塞对应 harness 的默认启用，不阻塞 PR 本身合入（flag 下）。
- Pi 相关行若实机行为不支持，改能力声明而非硬凑。

### P6-13 · 治理收尾与迁移评估

| 项 | 值 |
| --- | --- |
| commit | `docs(ade): close p6 governance and migration evaluation` |
| 依赖 | P6-08、P6-12 |
| 修改 | `docs/ade/13-governance-rollout.md`（原生适配器准入清单定稿）、`docs/ade/03-acp-runtime.md`（会话层描述更新）、`docs/ade/impl/README.md`（状态表）、`docs/AGENTS.md`（如准入条款需补字）、评估报告 `docs/ade/impl/p6-migration-evaluation.md`（新，≤150 行） |

迁移评估内容（只评估不迁移）：

- Claude Code（`agent-sdk`）：迁移到 `HarnessAgent` 的边际收益 vs 现状（SDK 已原生支持大部分
  能力，主要收益是统一会话管理/审批路径）；给出迁移成本估计与建议。
- Cursor（`cursor-sdk`）：同上。
- Gemini/OpenCode/自定义：维持 ACP 的判定复述。
- 遗留清理：`@zed-industries/codex-acp` → `@agentclientprotocol/codex-acp` 修正的确认状态、
  ACP fallback 保留期的退出条件（下一版本移除 or 长期保留）。

## 3. 回退与开关矩阵

| 开关 | 位置 | 行为 |
| --- | --- | --- |
| `transportOverrides.codex='acp'` | kun-config `adeHarnesses` | codex 走回退 ACP 定义（P6-07）；诊断可见；UI 标"ACP（回退模式）" |
| pi 未进目录 | builtin 定义受 feature 判断 | pi 卡片不出现在目录/选择器（默认直到 P6-12 过） |
| 运行时失败 | `harness-runtime.ts` | App Server 握手/版本失败→blocked reasonCode，**不自动静默回退**；回退必须显式，防止行为漂移不被察觉 |
| 协议漂移 | `protocol:codex --check` | CI/发布前快照哈希比对；漂移→阻断升级版本下限 |

## 4. 测试清单汇总

- **P6-02**：session-turn-runtime（假 agent：resume 漂移、interrupt、审批透传、用量聚合）、
  turn-sink、history-handoff；ACP 全量既有测试不改语义。
- **P6-03**：jsonl-transport 六类帧/退出/背压/超时/取消；jsonrpc-client 并发/server-request/dispose。
- **P6-04**：schema↔手写类型一致性；client 握手/版本门/通知/server-request。
- **P6-05**：event-map 全通知快照、approvals 4×4、agent 生命周期（回放 fixture）。
- **P6-06**：网关配置生成快照、密钥轮换生效、无密钥泄漏断言。
- **P6-07**：detector 版本门、catalog override 切换、handshake case、UI 标签/翻译。
- **P6-09**：pi-client、event-map、agent 生命周期（settled 边界）。
- **P6-10**：桥信道、审批桥、UI 桥、端到端假 pi 一轮。
- **P6-11**：网关生成、登录探测、detector、test-service、smoke。
- **横切**：每 PR `typecheck`+`check:file-lines`；UI 触及处 `smoke:development-ade`。

## 5. 待办开放问题（实现期回答，不阻塞计划合入）

1. Pi 包名/安装命令/版本输出——P6-09 第 0 步实机定。
2. Pi `--resume/--fork` 在 RPC 模式的可用面——同上，定能力位。
3. Pi 扩展↔Kun 双向信道是否复用 RPC 面——P6-10 第 1 步验证。
4. Pi 是否支持 env 变量引用写密钥——P6-11 第 1 步验证，不支持则 0700 文件兜底。
5. Codex `approvalPolicy`/`sandbox` 与 Kun 权限档的最终映射表——P6-05 合入前定稿。
6. `acceptForSession` 等审批裁决枚举以快照为准——P6-04 类型生成时钉死。
7. Claude/Cursor 是否迁入 `HarnessAgent`——P6-13 评估产出决定。
